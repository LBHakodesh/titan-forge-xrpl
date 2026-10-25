// Titan Sentinel findings registry: pure tests, fixtures only, no network, no ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FindingsRegistry, FindingsService, redact, redactString, GENESIS, summarize, markdownReport, PATHFINDER_NO_PATH_KEY, X402_UNAPPROVED_KEY } from '../lib/findings/index.mjs';
import { runCollectors, x402Findings, pathfinderFindings, launchFindings, mainnetProfileFindings, sentinelFindings, spokesFindings, findingFromEvent, defaultCollectors, systemsView, SYSTEMS } from '../lib/findings/collectors.mjs';
import { STATIC_SEEDS } from '../lib/findings/seeds.mjs';
import { isLocalRequest } from '../lib/routes/55-findings.mjs';
import { Sentinel } from '../lib/sentinel.mjs';
import { Bus } from '../lib/store.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TX = '63DA627435F660DF27BA4EFB22A7D1D612CFEECDC7D94BD644D5EC9DBA358270';
let t0 = Date.parse('2026-10-24T01:00:00Z');
const clock = () => { t0 += 1000; return t0; };
const base = (o = {}) => ({ key: 'test:k', title: 'Test finding', category: 'test', product: 'P', market: 'BBL', severity: 'medium', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'unit', occurrence: 'o1', evidence: [{ kind: 'tx', ref: TX, detail: 'payment' }], ...o });

const X402_RUN = {
  id: 'run-44dd51e5', at: '2026-10-24T00:11:06.835Z', mode: 'LIVE_TESTNET', resource: 'wake', ok: true,
  steps: [{ step: 'AUTHORIZATION', detail: { signedPayload: '[redacted]' } }, { step: 'SETTLEMENT', ok: true, detail: { success: true, transaction: TX, ledger: 21773074, validated: true } }],
  challenge: { accepts: [{ amount: '50000', payTo: 'rLXCWBHdR489cqwtcwai6QHEdFSkhFoFGP' }] },
};
const PF = (id, createdAt, strategy, status, pays) => ({ id, createdAt, status: 'done', options: { strategy, k: 6, tokens: ['BBL', 'LDN'] }, payments: pays.map((p, i) => ({ i, route: 'token_to_token', status, at: new Date(Date.parse(createdAt) + 60_000 + i * 4000).toISOString(), sizeXrp: 0.1, ...p, ...(status === 'skipped' ? { reason: 'No path: no funded liquidity connects these assets right now.' } : { hash: 'AB'.repeat(32) }) })) });
const PF_DOC = { runs: [
  PF('8c069811-aaaa', '2026-10-24T00:11:51.011Z', 'bridge_leg', 'skipped', [{ from: 'BBL', to: 'LDN' }, { from: 'LDN', to: 'BBL' }, { from: 'BBL', to: 'LDN' }]),
  PF('f2ccaa8e-bbbb', '2026-10-24T00:14:07.005Z', 'one_sided', 'skipped', [{ from: 'BBL', to: 'LDN' }, { from: 'LDN', to: 'BBL' }, { from: 'BBL', to: 'LDN' }]),
  PF('8342bff8-cccc', '2026-10-24T00:17:27.894Z', 'bridge_leg', 'success', [{ from: 'BBL', to: 'LDN' }]),
] };

// ---------- capture ----------
test('capture: records a finding with id, provenance, evidence link and one hashed history entry', () => {
  const r = new FindingsRegistry({ now: clock });
  const { finding: f, created } = r.record(base());
  assert.equal(created, true);
  assert.equal(f.id, 'TS-0001');
  assert.equal(f.provenance, 'LIVE_TESTNET');
  assert.equal(f.status, 'open');
  assert.equal(f.count, 1);
  assert.equal(f.evidence[0].url, `https://testnet.xrpl.org/transactions/${TX}`);
  assert.equal(f.history.length, 1);
  assert.equal(f.history[0].prevHash, GENESIS);
  assert.match(f.history[0].hash, /^[0-9a-f]{64}$/);
  assert.throws(() => r.record(base({ severity: 'severe' })), /severity/);
  assert.throws(() => r.record(base({ provenance: 'MAINNET' })), /provenance/);
  assert.equal(r.record(base({ key: 'test:k2' })).finding.id, 'TS-0002');
});

// ---------- dedupe / recurrence ----------
test('dedupe: same occurrence is a no-op; a new occurrence is a recurrence that keeps all evidence', () => {
  const r = new FindingsRegistry({ now: clock });
  const first = r.record(base({ seenAt: '2026-10-24T00:12:00Z' })).finding;
  assert.equal(r.record(base({ seenAt: '2026-10-24T00:12:00Z' })).changed, false);
  assert.equal(first.count, 1);
  const again = r.record(base({ occurrence: 'o2', seenAt: '2026-10-24T00:15:00Z', evidence: [{ kind: 'run', ref: 'run-2' }] }));
  assert.equal(again.created, false);
  assert.equal(again.finding.id, first.id);
  assert.equal(r.all().length, 1);
  assert.equal(first.count, 2);
  assert.equal(first.lastSeen, '2026-10-24T00:15:00Z');
  assert.deepEqual(first.evidence.map((e) => e.ref), [TX, 'run-2']); // original evidence never removed
  assert.equal(first.history.at(-1).action, 'recurred');
  // A recurrence after closure reopens it, with history.
  r.update(first.id, { status: 'resolved' }, { note: 'fixed' });
  r.record(base({ occurrence: 'o3' }));
  assert.equal(first.status, 'open');
  assert.equal(first.history.at(-1).detail.changes.status.reason, 'recurred after closure');
  assert.equal(r.verify().ok, true);
});

// ---------- provenance ----------
test('provenance is preserved: same key in another provenance is a separate finding and provenance is immutable', () => {
  const r = new FindingsRegistry({ now: clock });
  const live = r.record(base()).finding;
  const sim = r.record(base({ provenance: 'SIMULATION', verification: 'SIMULATED' })).finding;
  assert.notEqual(live.id, sim.id);
  assert.equal(live.provenance, 'LIVE_TESTNET');
  assert.equal(sim.provenance, 'SIMULATION');
  assert.equal(sim.evidence[0].provenance, 'SIMULATION');
  assert.equal(sim.evidence[0].url, null); // explorer links only for LIVE_TESTNET evidence
  assert.throws(() => r.update(live.id, { provenance: 'SIMULATION' }), /Immutable/);
  assert.throws(() => r.update(live.id, { evidence: [] }), /Immutable/);
  assert.equal(summarize(r.all()).realVsSimulated.real, 1);
  assert.equal(summarize(r.all()).realVsSimulated.simulated, 1);
});

test('bus events carry mode = provenance; UNAVAILABLE provenance is never relabeled', () => {
  const bus = new Bus();
  const seen = []; bus.on('event', (e) => seen.push(e));
  const r = new FindingsRegistry({ now: clock, bus });
  r.record(base());
  r.record(base({ key: 'm', provenance: 'MAINNET_OBSERVED_READ_ONLY', verification: 'CONFIRMED' }));
  r.record(base({ key: 'u', provenance: 'UNAVAILABLE', verification: 'UNVERIFIED_EXTERNAL', evidence: [] }));
  r.record(base({ occurrence: 'o2' }));
  assert.deepEqual(seen.map((e) => [e.type, e.mode]), [['findings.recorded', 'LIVE_TESTNET'], ['findings.recorded', 'MAINNET_OBSERVED'], ['findings.recorded', 'UNAVAILABLE'], ['findings.updated', 'LIVE_TESTNET']]);
  assert.equal(seen[1].provenance, 'MAINNET_OBSERVED_READ_ONLY');
  assert.equal(r.eventsSuppressed, 0); // the bus accepts UNAVAILABLE since the merge
  assert.equal(r.all().length, 3);
});

// ---------- severity ----------
test('severity change needs a reason and is recorded in history; recurrences escalate but never silently downgrade', () => {
  const r = new FindingsRegistry({ now: clock });
  const f = r.record(base()).finding;
  assert.throws(() => r.update(f.id, { severity: 'high' }), /reason/);
  r.update(f.id, { severity: 'high' }, { actor: 'operator:test', note: 'Confirmed real value moved' });
  const h = f.history.at(-1);
  assert.equal(h.action, 'severity_changed');
  assert.deepEqual(h.detail.changes.severity, { from: 'medium', to: 'high' });
  assert.equal(h.actor, 'operator:test');
  r.record(base({ occurrence: 'o2', severity: 'low' }));
  assert.equal(f.severity, 'high');
  r.record(base({ occurrence: 'o3', severity: 'critical' }));
  assert.equal(f.severity, 'critical');
  assert.equal(r.verify().ok, true);
});

// ---------- hash chain ----------
test('hash chain detects edited fields, removed evidence, edited or removed history and deleted findings', () => {
  const mk = () => { const r = new FindingsRegistry({ now: () => Date.parse('2026-10-24T02:00:00Z') }); r.record(base()); r.record(base({ key: 'b', evidence: [{ kind: 'run', ref: 'r1' }, { kind: 'run', ref: 'r2' }] })); r.record(base({ key: 'c' })); r.update('TS-0001', { status: 'investigating' }); return r; };
  assert.equal(mk().verify().ok, true);
  let r = mk(); r.get('TS-0001').severity = 'low'; assert.equal(r.verify().ok, false);
  r = mk(); r.get('TS-0002').evidence.pop(); assert.match(r.verify().problems.map((p) => p.problem).join(), /state differs/);
  r = mk(); r.get('TS-0001').history[0].detail = { forged: true }; assert.match(r.verify().problems.map((p) => p.problem).join(), /hash mismatch/);
  r = mk(); r.findings.delete('TS-0002'); assert.match(r.verify().problems.map((p) => p.problem).join(), /sequence gap|prevHash/);
  r = mk(); r.get('TS-0001').history.pop(); assert.equal(r.verify().ok, false);
  r = mk(); r.get('TS-0003').provenance = 'SIMULATION'; assert.match(r.verify().problems.map((p) => p.problem).join(), /provenance rewritten|state differs/);
  // Persisted roundtrip verifies; a tampered file does not.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-findings-'));
  const file = path.join(dir, 'findings.json');
  const p = new FindingsRegistry({ file, now: clock }); p.record(base()); p.addNote('TS-0001', 'checked');
  assert.equal(new FindingsRegistry({ file }).verify().ok, true);
  const d = JSON.parse(fs.readFileSync(file, 'utf8')); d.findings[0].verification = 'SUSPECTED'; fs.writeFileSync(file, JSON.stringify(d));
  assert.equal(new FindingsRegistry({ file }).verify().ok, false);
  fs.rmSync(dir, { recursive: true });
});

// ---------- missing evidence ----------
test('missing evidence: CONFIRMED without evidence is downgraded, malformed items dropped, external reports allowed', () => {
  const r = new FindingsRegistry({ now: clock });
  const f = r.record(base({ evidence: [] })).finding;
  assert.equal(f.verification, 'SUSPECTED');
  assert.equal(f.evidenceStatus, 'missing');
  assert.match(f.history[0].detail.notes[0], /CONFIRMED requires evidence/);
  assert.throws(() => r.update(f.id, { verification: 'CONFIRMED' }), /evidence/);
  const g = r.record(base({ key: 'g', evidence: [{ kind: 'tx' }, null, { kind: 'run', ref: '' }, { kind: 'run', ref: 'ok-1' }] })).finding;
  assert.deepEqual(g.evidence.map((e) => e.ref), ['ok-1']);
  const bc = STATIC_SEEDS.find((s) => s.key.includes('bc-07'));
  const b = r.record(bc).finding;
  assert.equal(b.verification, 'UNVERIFIED_EXTERNAL');
  assert.equal(b.provenance, 'UNAVAILABLE');
  assert.equal(b.severityBasis, 'as-reported');
  assert.equal(b.evidence.length, 0);
  assert.match(b.evidenceNote, /not present on London/);
  assert.match(b.actual, /not present on London/);
  assert.equal(summarize(r.all()).realVsSimulated.unverified_or_unavailable, 1);
  // Adding evidence later appends without touching the record's provenance.
  r.addEvidence(f.id, { kind: 'run', ref: 'late' }); r.update(f.id, { verification: 'CONFIRMED' });
  assert.equal(f.verification, 'CONFIRMED');
  assert.equal(r.verify().ok, true);
});

// ---------- redaction ----------
test('redaction removes seeds, secrets, private keys and signed blobs but keeps hashes and addresses', () => {
  const seed = 'sEdTM1uX8pu2do5XvTnutH6HsouMaM2'; const seed2 = 'snoPBrXtMeMyMHUVTgbuqAfg1SUTb';
  const priv = 'ED' + 'A1'.repeat(32);
  const out = redact({ seed, secret: 'x', privateKey: priv, nested: { signedTxBlob: '1200'.repeat(80), note: `wallet seed: ${seed2} and ${seed}` }, tx: TX, account: 'rno84rguzSP8uPD1JhCi2tKRc2P1b4TdBH', text: `key ${priv} blob ${'12'.repeat(150)}` });
  const s = JSON.stringify(out);
  for (const bad of [seed, seed2, priv, '1200'.repeat(80)]) assert.equal(s.includes(bad), false, bad);
  assert.equal(out.seed, '[redacted]'); assert.equal(out.secret, '[redacted]'); assert.equal(out.nested.signedTxBlob, '[redacted]');
  assert.equal(out.tx, TX);
  assert.equal(out.account, 'rno84rguzSP8uPD1JhCi2tKRc2P1b4TdBH');
  assert.match(redactString('secret=abc123'), /secret=\[redacted\]/);
  const r = new FindingsRegistry({ now: clock });
  const f = r.record(base({ observed: `leaked ${seed}`, evidence: [{ kind: 'run', ref: 'r', detail: { secret: 'zzz', signedPayload: 'AA' } }] })).finding;
  assert.equal(JSON.stringify(f).includes(seed), false);
  assert.equal(JSON.stringify(f).includes('zzz'), false);
  r.addNote(f.id, `operator pasted ${seed2}`);
  assert.equal(JSON.stringify(f).includes(seed2), false);
});

// ---------- collector isolation ----------
test('collector failure isolation: throwing, hanging and bad-output collectors become UNAVAILABLE; others still record', async () => {
  const r = new FindingsRegistry({ now: clock });
  const collectors = [
    { id: 'boom', label: 'throws', run: () => { throw new Error('source exploded'); } },
    { id: 'hang', label: 'hangs', timeoutMs: 30, run: () => new Promise(() => {}) },
    { id: 'bad', label: 'bad input', run: async () => ({ findings: [{ key: 'x' }, base({ key: 'ok2' })] }) },
    { id: 'good', label: 'works', run: async () => ({ findings: [base()] }) },
  ];
  const st = await runCollectors(r, collectors, {});
  assert.equal(st.boom.status, 'unavailable'); assert.equal(st.boom.provenance, 'UNAVAILABLE'); assert.match(st.boom.reason, /exploded/);
  assert.equal(st.hang.status, 'unavailable'); assert.match(st.hang.reason, /timed out/);
  assert.equal(st.bad.status, 'connected'); assert.equal(st.bad.rejected, 1); assert.equal(st.bad.created, 1);
  assert.equal(st.good.status, 'connected'); assert.equal(st.good.created, 1);
  assert.equal(r.all().length, 2);
  // Default collectors with nothing wired: file sources missing -> UNAVAILABLE, static seeds still load.
  const r2 = new FindingsRegistry({ now: clock });
  const svc = new FindingsService({ registry: r2, env: { dataDir: '/nonexistent-dir' } });
  const s2 = await svc.collect();
  for (const id of ['x402', 'pathfinder', 'mainnet-profile', 'submission', 'tokenization', 'access', 'corridor', 'engine', 'sentinel', 'spokes']) assert.equal(s2[id].status, 'unavailable', id);
  assert.equal(s2.seeds.status, 'connected');
  const sys = svc.sources().systems;
  assert.equal(sys.length, SYSTEMS.length);
  assert.ok(sys.every((x) => x.status === 'connected' || (x.status === 'unavailable' && x.reason)));
  assert.match(sys.find((x) => x.id === 'spokes-26').reason, /not present/);
  // A broken bus event never throws into the bus.
  const bus = new Bus(); const svc3 = new FindingsService({ registry: new FindingsRegistry({ now: clock }), bus });
  assert.doesNotThrow(() => bus.publish('sentinel.finding', 'LIVE_TESTNET', { code: 'BBL', findingId: 'supply.concentration', severity: 'bogus', title: 't' }));
  assert.doesNotThrow(() => bus.publish('access.decision', 'SIMULATION', { decision: 'deny', resource: 'wake', participantId: 'sim-x', reason: 'r' }));
  assert.equal(svc3.registry.all().length, 2);
  svc3.detach();
});

// ---------- no ledger actions ----------
test('no registry or collector path signs or submits: a fake ledger that throws on every write is never called', async () => {
  const calls = [];
  const trap = (name) => (...a) => { calls.push(name); throw new Error(`${name} must never be called`); };
  const fakeLedger = { submit: trap('submit'), submitSigned: trap('submitSigned'), sign: trap('sign'), signOffline: trap('signOffline'), autofill: trap('autofill'), wallets: { issuer: { address: 'rI' }, maker: { address: 'rM' } },
    client: { request: async (req) => { calls.push(`read:${req.command}`); throw new Error('offline fixture'); }, submit: trap('client.submit'), submitAndWait: trap('client.submitAndWait'), autofill: trap('client.autofill') } };
  const store = { launches: [{ id: 'l1', code: 'BBL', status: 'live', steps: [] }], byCode: (c) => store.launches.find((l) => l.code === c) };
  const sentinel = new Sentinel({ ledger: fakeLedger, store, bus: { publish() {} } });
  const r = new FindingsRegistry({ now: clock });
  const svc = new FindingsService({ registry: r, env: { dataDir: '/nonexistent', ledgerReady: () => true, launches: () => store.launches, sentinel, ledger: fakeLedger } });
  const st = await svc.collect();
  assert.equal(st.sentinel.status, 'unavailable'); // reads failed -> isolated
  r.record(base()); r.update('TS-0001', { status: 'mitigation-proposed' }); r.addNote('TS-0001', 'n'); r.setRootCause('TS-0001', { summary: 'x' }); r.verify();
  assert.deepEqual(calls.filter((c) => !c.startsWith('read:')), []);
  assert.ok(calls.every((c) => /^read:(account_info|account_objects|account_lines|gateway_balances|book_offers|account_tx|tx)$/.test(c)), calls.join());
  // Static guard: nothing in lib/findings references a signing or submitting API.
  for (const f of fs.readdirSync(path.join(ROOT, 'lib/findings'))) {
    const src = fs.readFileSync(path.join(ROOT, 'lib/findings', f), 'utf8');
    assert.doesNotMatch(src, /\.submit\w*\(|signOffline|\.sign\(|autofill|OfferCancel|TrustSet|AccountSet/, f);
  }
});

// ---------- known findings from real-shaped fixtures ----------
test('x402: settlement CONFIRMED and authorization MISSING are separate facets; an approval record suppresses it', () => {
  const [f] = x402Findings([X402_RUN, { ...X402_RUN, id: 'sim', mode: 'SIMULATION' }]);
  assert.equal(f.key, X402_UNAPPROVED_KEY);
  assert.equal(f.severity, 'high'); assert.equal(f.verification, 'CONFIRMED'); assert.equal(f.provenance, 'LIVE_TESTNET');
  assert.equal(f.facets.find((x) => x.facet === 'settlement').status, 'CONFIRMED');
  assert.equal(f.facets.find((x) => x.facet === 'authorization').status, 'MISSING');
  assert.ok(f.evidence.some((e) => e.kind === 'ledger' && e.ref === '21773074'));
  assert.ok(f.evidence.some((e) => e.ref === 'lib/routes/90-x402.mjs:39'));
  assert.equal(f.remediation.status, 'proposed, not implemented');
  assert.equal(x402Findings([X402_RUN], { approvals: () => ({ approver: 'owner' }) }).length, 0);
  const r = new FindingsRegistry({ now: clock }); r.record(f); r.record(f);
  assert.equal(r.all().length, 1); assert.equal(r.all()[0].count, 1); // one-time, re-collection does not double count
});

test('pathfinder NO_PATH: one finding, one occurrence per run, occurrence CONFIRMED, root cause SUSPECTED until set', () => {
  const inputs = pathfinderFindings(PF_DOC);
  assert.equal(inputs.length, 2);
  const r = new FindingsRegistry({ now: clock });
  for (const i of inputs) r.record(i);
  const [f] = r.all();
  assert.equal(r.all().length, 1);
  assert.equal(f.key, PATHFINDER_NO_PATH_KEY('token_to_token', 'BBL/LDN'));
  assert.equal(f.count, 2);
  assert.match(f.observed, /^6 token_to_token payment\(s\) skipped across 2 Pathfinder run\(s\) \(4 BBL→LDN, 2 LDN→BBL\)/);
  assert.equal(f.facets.find((x) => x.facet === 'occurrence').verification, 'CONFIRMED');
  assert.equal(f.facets.find((x) => x.facet === 'rootCause').verification, 'SUSPECTED');
  assert.ok(f.evidence.some((e) => e.kind === 'context' && /8342bff8/.test(e.ref)));
  r.setRootCause(f.key, { summary: 'XRP/LDN leg unfunded', verification: 'CONFIRMED', evidence: [{ kind: 'run', ref: 'diag-1' }], actor: 'agent:pathfinder-diagnosis' });
  assert.equal(f.rootCause.verification, 'CONFIRMED');
  assert.equal(f.facets.find((x) => x.facet === 'rootCause').detail, 'XRP/LDN leg unfunded');
  assert.equal(f.facets.find((x) => x.facet === 'occurrence').verification, 'CONFIRMED');
  assert.equal(f.count, 2);
  for (const i of pathfinderFindings(PF_DOC)) r.record(i); // re-collection keeps the diagnosis
  assert.equal(f.rootCause.summary, 'XRP/LDN leg unfunded');
  assert.equal(r.verify().ok, true);
});

test('launch snapshot concentration and Sentinel import share one fingerprint (no double counting)', () => {
  const launch = { id: 'l1', code: 'BBL', status: 'live', supply: 1_000_000, organic: false, issuer: 'rI', steps: [
    { key: 'issue', hash: 'A4'.repeat(32), ledger: 21771682, startedAt: '2026-10-23T22:52:03Z', result: 'tesSUCCESS' },
    { key: 'fill', hash: 'ED'.repeat(32), ledger: 21771688, startedAt: '2026-10-23T22:52:23Z', result: 'tesSUCCESS' },
    { key: 'verify', startedAt: '2026-10-23T22:52:30Z', detail: { makerTokens: 999900, takerTokens: 100, issuer: 'rI', book: { asks: [{ account: 'rM', qty: 900 }], bids: [{ account: 'rM', qty: 100 }] } } }] };
  const [c] = launchFindings([launch], { part: 'tokenization' });
  assert.equal(c.severity, 'high'); assert.match(c.title, /99\.990%/);
  const r = new FindingsRegistry({ now: clock }); r.record(c);
  const sen = sentinelFindings({ code: 'BBL', validatedLedger: 21780000, scannedAt: '2026-10-24T01:00:00Z', findings: [
    { id: 'supply.concentration', severity: 'high', title: 'Top holder controls 99.8% of supply', evidence: 'HHI 9960', links: [] },
    { id: 'issuer.freeze', severity: 'low', title: 'Issuer can freeze holders' }] });
  assert.equal(sen.length, 1);
  for (const s of sen) r.record(s);
  assert.equal(r.all().length, 1);
  assert.equal(r.all()[0].count, 2);
  assert.deepEqual(r.all()[0].sources, ['launches', 'sentinel']);
  assert.equal(launchFindings([{ ...launch, steps: [...launch.steps.slice(0, 2), { ...launch.steps[2], detail: { ...launch.steps[2].detail, makerTokens: 100 } }] }], { part: 'tokenization' }).length, 0);
});

test('mainnet profile: composition finding is MAINNET_OBSERVED_READ_ONLY with metric evidence', () => {
  const [f] = mainnetProfileFindings({ sampledAt: '2026-10-23T23:58:00Z', window: { fromLedger: 1, toLedger: 33 }, endUser: { count: 0 }, circular: { count: 3 },
    pathfoundAll: { count: 79, ammInvolved: { share: 0.6582 }, makerCapture: { top5Share: 0.9746, hhi: 4222 } }, partial: { count: 76 } });
  assert.equal(f.provenance, 'MAINNET_OBSERVED_READ_ONLY'); assert.equal(f.severity, 'info');
  assert.match(f.title, /76 of 79/); assert.match(f.observed, /65\.8% touched an AMM/); assert.match(f.observed, /97\.5%/);
  assert.throws(() => mainnetProfileFindings({}), /no pathfoundAll/);
});

test('bus events map to findings with the right verification; unknown modes are ignored', () => {
  assert.equal(findingFromEvent({ type: 'access.decision', mode: 'SIMULATION', decision: 'deny', resource: 'wake', participantId: 'p', at: 't' }).verification, 'SIMULATED');
  assert.equal(findingFromEvent({ type: 'access.decision', mode: 'LIVE_TESTNET', decision: 'free' }), null);
  assert.equal(findingFromEvent({ type: 'sentinel.finding', mode: 'BOGUS', code: 'BBL', findingId: 'x' }), null);
  assert.equal(findingFromEvent({ type: 'pathfinder.run_failed', mode: 'LIVE_TESTNET', runId: 'r', error: 'e', at: 't' }).verification, 'CONFIRMED');
});

test('spokes monitor never guesses provenance and flags concentration only with a mode label', () => {
  assert.throws(() => spokesFindings({ nope: 1 }), /no spokes/);
  assert.equal(spokesFindings({ spokes: [{ id: 'a', fundedXrp: 10 }] }).findings.length, 0);
  const r = spokesFindings({ mode: 'SIMULATION', spokes: [{ id: 'a', fundedXrp: 90 }, { id: 'b', fundedXrp: 10 }] });
  assert.equal(r.findings[0].provenance, 'SIMULATION'); assert.equal(r.findings[0].verification, 'SIMULATED'); assert.equal(r.findings[0].severity, 'high');
  // Real shape: groups of 13 + 13 slots, placeholders ignored, per-spoke alerts keep the spoke's own label.
  const slot = (id, extra = {}) => ({ id, placeholder: true, status: 'UNAVAILABLE', alerts: [{ severity: 'info', text: 'Placeholder' }], ...extra });
  const groups = { A: { spokes: [...Array(13)].map((_, i) => slot(`A${i}`)) }, B: { spokes: [...Array(13)].map((_, i) => slot(`B${i}`)) } };
  const empty = spokesFindings({ groups });
  assert.equal(empty.detail.spokes, 26); assert.equal(empty.detail.withData, 0); assert.equal(empty.findings.length, 0);
  groups.B.spokes[0] = { id: 'testnet:BBL', name: 'BBL', status: 'TESTNET_FUNDED', alerts: [{ severity: 'medium', text: 'Book one-sided' }], corridor: { mode: 'SIMULATION', modeledNotionalUsd: 900 } };
  groups.B.spokes[1] = { id: 'testnet:LDN', name: 'LDN', status: 'TESTNET_FUNDED', alerts: [], corridor: { mode: 'SIMULATION', modeledNotionalUsd: 100 } };
  const live = spokesFindings({ groups });
  assert.deepEqual(live.findings.map((f) => [f.provenance, f.verification, f.severity]), [['SIMULATION', 'SIMULATED', 'high']]); // 90% modeled notional in one spoke
  assert.equal(live.detail.alertsMediumPlus, 1); // screening alerts are counted, not imported
});

test('summary and markdown report label every class and never call external reports reproduced', () => {
  const r = new FindingsRegistry({ now: clock });
  r.record(base({ severity: 'high' })); for (const s of STATIC_SEEDS) r.record(s);
  const s = summarize(r.all());
  assert.equal(s.total, 5); assert.equal(s.bySeverity.high, 1 + 1);
  assert.equal(s.bySeverityProvenance.high.UNAVAILABLE, 1); assert.equal(s.bySeverityProvenance.high.LIVE_TESTNET, 1);
  assert.equal(s.openVsResolved.open, 5);
  const md = markdownReport(r.list(), { verify: r.verify() });
  assert.match(md, /hash chain VERIFIED/);
  assert.match(md, /UNVERIFIED_EXTERNAL/);
  assert.match(md, /Evidence: none on this node/);
  const bc = md.slice(md.indexOf('## TS-0002'));
  assert.match(bc, /UNVERIFIED_EXTERNAL · UNAVAILABLE/);
  assert.match(bc, /not reproduced on London/);
});

test('POST guard: only direct localhost JSON callers without a proxy or foreign origin', () => {
  const req = (ip, h = {}) => ({ socket: { remoteAddress: ip }, headers: { 'content-type': 'application/json', ...h } });
  assert.equal(isLocalRequest(req('127.0.0.1')), true);
  assert.equal(isLocalRequest(req('::ffff:127.0.0.1', { origin: 'http://127.0.0.1:4131' })), true);
  assert.equal(isLocalRequest(req('10.0.0.5')), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { 'x-forwarded-for': '1.2.3.4' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { 'content-type': 'text/plain' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { origin: 'https://evil.example' })), false);
});

test('incubator/TGAN signals map to SIMULATED findings and never escalate to confirmed', async () => {
  const { signalFindings } = await import('../lib/findings/collectors.mjs');
  const out = signalFindings([
    { key: 'incubator:demo-aurora:t2_gap', title: 'T2 under-matched', severity: 'medium', product: 'TGLB', evidence: ['$70k of $120k'] },
    { key: 'tgan:UNVERIFIED_ADVISOR:firm-a', title: 'Unverified advisor acting', severity: 'high', product: 'TGAN', detail: { advisorId: 'firm-a' }, verification: 'CONFIRMED', provenance: 'LIVE_TESTNET' },
    { title: 'no key' },
  ], { source: 'test' });
  assert.equal(out.length, 2);
  for (const f of out) { assert.equal(f.verification, 'SIMULATED'); assert.equal(f.provenance, 'SIMULATION'); }
  const r = new FindingsRegistry({ now: clock });
  for (const f of out) r.record(f);
  assert.equal(r.all().length, 2);
  assert.equal(r.verify().ok, true);
});
