// TG Sentinel universal observability: pure collectors over injected inputs, coverage map, audit trail. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executionFindings, fillRecords, fillFindings, ledgerFindings, feeFindings, depthFindings, inventoryFindings, fundingTierFindings,
  x402TelemetryFindings, apiFindings, externalSignalFindings, infraFindings, processSnapshot, universalCollectors,
  SUBSYSTEMS, classify, provenanceClass, universalView, coverage, auditTrail, SENTINEL_STATEMENT, THRESHOLDS,
} from '../lib/findings/universal.mjs';
import { FindingsRegistry, FindingsService, allCollectors } from '../lib/findings/index.mjs';
import { STATIC_SEEDS } from '../lib/findings/seeds.mjs';
import { register as registerSentinelRoutes } from '../lib/routes/50-sentinel.mjs';

let t0 = Date.parse('2026-10-25T09:00:00Z');
const clock = () => (t0 += 1000);
const AT = '2026-10-25T09:00:00.000Z';
const H = (c) => c.repeat(64);
const REQUIRED = ['key', 'title', 'severity', 'verification', 'provenance', 'source', 'seenAt'];

// Every collector output must be recordable, carry evidence and the required fields.
function assertWellFormed(findings, label) {
  const r = new FindingsRegistry({ now: clock });
  for (const f of findings) {
    for (const k of REQUIRED) assert.ok(f[k], `${label}: ${f.key} missing ${k}`);
    assert.ok(Array.isArray(f.evidence) && f.evidence.length && f.evidence.every((e) => e.ref != null && String(e.ref).trim()), `${label}: ${f.key} has no evidence`);
    const { finding } = r.record(f);
    assert.equal(finding.evidenceStatus, 'present', `${label}: ${f.key}`);
    const v = universalView(finding);
    for (const k of ['id', 'severity', 'timestamp', 'affectedSystem', 'provenance', 'owner', 'remediationStatus']) assert.ok(v[k], `${label}: view ${k}`);
    assert.ok(v.evidenceCount > 0);
  }
  return r;
}

const okPay = (i, extra = {}) => ({ i, route: 'token_to_token', from: 'BBL', to: 'LDN', sizeXrp: 1.5, at: AT, status: 'success', hash: H('A'), result: 'tesSUCCESS', ledger: 21773211, pathfind: { vsMidBps: 30 }, attribution: { bridged: true, capturedBy: { maker: 3, rival: 0, other: 0 } }, ...extra });
const run = (extra = {}) => ({ id: 'run-1', status: 'done', organic: false, createdAt: AT, finishedAt: AT, feeXrp: 0.000012, options: { tokens: ['BBL', 'LDN'] }, payments: [okPay(0), okPay(1, { hash: H('B') })], scorecard: { payments: { succeeded: 2, skipped: 0, failed: 0 } }, ...extra });

test('healthy inputs produce no findings (no fake incidents)', () => {
  const runs = [run()];
  assert.deepEqual(executionFindings(runs, { now: Date.parse(AT) }), []);
  const fills = fillFindings(fillRecords([{ id: 'l1', code: 'BBL', status: 'live', organic: false, fillHash: H('C'), steps: [{ key: 'fill', result: 'tesSUCCESS', ledger: 1 }] }], runs));
  assert.equal(fills.findings.length, 0); assert.equal(fills.detail.fills, 3); assert.equal(fills.detail.classified, 3);
  assert.equal(ledgerFindings({ network_id: 1, server_state: 'full', validated_ledger: { seq: 5, age: 2 } }, { ledgerReady: true, at: AT }).findings.length, 0);
  assert.equal(feeFindings({ load_factor: 1, validated_ledger: { base_fee_xrp: 0.00001 } }, runs, { at: AT }).findings.length, 0);
  assert.equal(depthFindings([{ code: 'BBL', validatedLedger: 9, book: { offers: [{ side: 'ask', fundedXrp: 9 }, { side: 'bid', fundedXrp: 0.8 }] } }], { at: AT }).findings.length, 0);
  assert.equal(inventoryFindings({ maker: { address: 'rM', xrp: 200, ownerCount: 12 } }, { at: AT }).findings.length, 0);
  assert.equal(x402TelemetryFindings({ books: { OBSERVED: { requests: 3 } } }, { at: AT }).findings.length, 0);
  assert.equal(apiFindings([{ path: '/api/health', status: 200, ms: 3 }], { skippedRoutes: [] }, { at: AT }).findings.length, 0);
  assert.equal(infraFindings({ pid: 1, uptimeSec: 9, rssMb: 100, heapUsedMb: 30, heapLimitMb: 4000, eventLoopP99Ms: 20, disk: { freeRatio: 0.8, freeGb: 100 }, dataFiles: [{ file: 'a.json', mb: 2 }] }, { at: AT }).findings.length, 0);
});

test('execution integrity: unvalidated success, scorecard mismatch and stuck runs are flagged with evidence', () => {
  const bad = [run({ payments: [okPay(0, { result: 'tecPATH_DRY', hash: 'nope' }), okPay(1)], scorecard: { payments: { succeeded: 3, skipped: 0, failed: 0 } } }),
    { id: 'run-2', status: 'running', createdAt: '2026-10-25T05:00:00Z', startedAt: '2026-10-25T05:00:00Z', payments: [] }];
  const f = executionFindings(bad, { now: Date.parse(AT) });
  assert.deepEqual(f.map((x) => x.key).sort(), ['execution:run-stuck', 'execution:scorecard-mismatch', 'execution:success-without-validated-result']);
  assert.equal(f.find((x) => x.key.endsWith('validated-result')).severity, 'high');
  assertWellFormed(f, 'execution');
});

test('fill classification: unlabeled organic flag, unvalidated and unattributed fills', () => {
  const runs = [run({ organic: undefined, payments: [okPay(0, { attribution: null }), okPay(1, { result: 'tecX' })] })];
  const r = fillFindings(fillRecords([], runs));
  const keys = r.findings.map((x) => x.key).sort();
  assert.deepEqual(keys, ['fills:not-validated', 'fills:organic-flag-missing', 'fills:unattributed']);
  assertWellFormed(r.findings, 'fills');
});

test('ledger freshness + fees + depth + inventory + tiers + x402 + api + infra thresholds', () => {
  const stale = ledgerFindings({ network_id: 1, server_state: 'full', validated_ledger: { seq: 7, age: THRESHOLDS.ledgerStaleHighSec + 5 } }, { ledgerReady: true, at: AT });
  assert.equal(stale.findings[0].key, 'ledger:stale-validated-ledger'); assert.equal(stale.findings[0].severity, 'high');
  assert.equal(ledgerFindings(null, { ledgerReady: false, ledgerError: 'ECONNREFUSED', at: AT }).findings[0].key, 'ledger:testnet-unavailable');
  assert.equal(ledgerFindings(null, { offline: true }).findings.length, 0, 'offline replay is by design, not an incident');
  assert.equal(ledgerFindings(null, { ledgerReady: false, ledgerError: null }).findings.length, 0, 'bootstrapping is not an incident');
  const fees = feeFindings({ load_factor: 50, validated_ledger: { base_fee_xrp: 0.00001, seq: 3 } }, [run({ feeXrp: 0.001, payments: [okPay(0, { pathfind: { vsMidBps: 500 } })] })], { at: AT });
  assert.deepEqual(fees.findings.map((x) => x.key).sort(), ['fees:network-load', 'fees:path-cost-over-mid', 'fees:run-tx-fee']);
  const depth = depthFindings([{ code: 'BBL', validatedLedger: 9, scannedAt: AT, book: { offers: [{ side: 'ask', fundedXrp: 0.5 }, { side: 'bid', fundedXrp: 0 }] } }, { code: 'LDN', validatedLedger: 9, book: { offers: [] } }], { at: AT });
  assert.deepEqual(depth.findings.map((x) => x.key).sort(), ['depth:BBL:bid-side-depleted', 'depth:BBL:thin-book'], 'empty book left to Sentinel book.depth');
  const inv = inventoryFindings({ router: { address: 'rR', xrp: 3, ownerCount: 2 }, rival: { address: 'rV', unfunded: true }, maker: null }, { at: AT, ledger: 11 });
  assert.deepEqual(inv.findings.map((x) => [x.key, x.severity]).sort(), [['inventory:rival:low-xrp', 'high'], ['inventory:router:low-xrp', 'medium']]);
  const tiers = fundingTierFindings({ live: { participants: [{ id: 'live-maker', mode: 'LIVE_TESTNET', status: 'free', permittedTiers: ['T1', 'T2'], underwriting: { approved: false } }] }, simulated: { participants: [{ id: 's', mode: 'SIMULATION', status: 'over', permittedTiers: ['T1', 'T2', 'T3'], qualifyingUsd: 1e6, thresholdUsd: 5e4 }] } }, { at: AT });
  assert.deepEqual(tiers.findings.map((x) => [x.key, x.provenance, x.verification]), [['tiers:live:tier3-restricted', 'LIVE_TESTNET', 'CONFIRMED'], ['tiers:simulated:free-threshold-exceeded', 'SIMULATION', 'SIMULATED']]);
  const x = x402TelemetryFindings({ books: { OBSERVED: { denied: 2, guardian: { denied: 1 }, serverErrors: 1, responses: 9 }, SIMULATION: { agent: { blocked: 4 } } } }, { at: AT });
  assert.deepEqual(x.findings.map((f) => [f.key, f.provenance]).sort(), [['api:x402:observed:server-errors', 'LIVE_TESTNET'], ['payauth:x402:observed:refused-requests', 'LIVE_TESTNET'], ['payauth:x402:simulation:refused-requests', 'SIMULATION']]);
  const api = apiFindings([{ path: '/api/spokes', status: 500, ms: 3 }, { path: '/api/loop/status', error: 'timeout after 5000 ms', ms: 5000 }, { path: '/api/x', status: 404 }], { skippedRoutes: [{ file: '99-x.mjs', error: 'SyntaxError' }] }, { at: AT });
  assert.equal(api.findings.length, 3);
  const infra = infraFindings({ pid: 1, uptimeSec: 9, rssMb: 3000, heapUsedMb: 3900, heapLimitMb: 4000, eventLoopP99Ms: 2000, eventLoopMaxMs: 3000, disk: { freeRatio: 0.02, freeGb: 1 }, dataFiles: [{ file: 'findings.json', mb: 80 }] }, { at: AT });
  assert.equal(infra.findings.length, 5);
  for (const [label, list] of Object.entries({ stale: stale.findings, fees: fees.findings, depth: depth.findings, inv: inv.findings, tiers: tiers.findings, x: x.findings, api: api.findings, infra: infra.findings })) assertWellFormed(list, label);
  assert.ok(processSnapshot({ dataDir: '/nonexistent' }).rssMb > 0);
});

test('external signals (vendors/XDLC): label/value evidence, provenance honored, simulation never CONFIRMED, bad body throws', () => {
  const body = { mode: 'SIMULATION', signals: [
    { key: 'xdlc:a', title: 'A', severity: 'medium', provenance: 'MAINNET_OBSERVED', verification: 'SIMULATED', evidence: [{ label: 'clawback', value: 'on' }], remediation: 'Review', observedAt: AT },
    { key: 'b', title: 'B', severity: 'bogus' }, { title: 'no key' }] };
  const r = externalSignalFindings(body, { source: 'xdlc', endpoint: 'GET /api/xdlc/sentinel-signals', product: 'XDLC', at: AT });
  assert.equal(r.findings.length, 2);
  const [a, b] = r.findings;
  assert.equal(a.key, 'xdlc:a'); assert.equal(a.provenance, 'MAINNET_OBSERVED_READ_ONLY'); assert.equal(a.verification, 'SIMULATED');
  assert.deepEqual(a.evidence[0], { kind: 'metric', ref: 'clawback', detail: 'on' }); assert.equal(a.remediation.status, 'proposed');
  assert.equal(b.key, 'xdlc:b'); assert.equal(b.provenance, 'SIMULATION'); assert.equal(b.severity, 'info'); assert.equal(b.verification, 'SIMULATED');
  assertWellFormed(r.findings, 'signals');
  // Same signal re-read with a new observedAt is not a recurrence (no count spam).
  const reg = new FindingsRegistry({ now: clock });
  reg.record(a); assert.equal(reg.record({ ...a, seenAt: '2026-10-25T10:00:00Z' }).changed, false);
  assert.throws(() => externalSignalFindings({ error: 'Not found' }, { source: 'vendors', endpoint: 'GET /api/vendors/sentinel-signals' }), /no signals/);
});

test('missing sources never throw into the registry: universal collectors go UNAVAILABLE, nothing invented', async () => {
  const r = new FindingsRegistry({ now: clock });
  const svc = new FindingsService({ registry: r, env: { dataDir: '/nonexistent-dir', infra: () => ({ pid: 1, uptimeSec: 1, rssMb: 50, heapUsedMb: 10, heapLimitMb: 4000 }) } });
  const st = await svc.collect();
  for (const id of ['execution', 'fills', 'fees', 'depth', 'inventory', 'funding-tiers', 'x402-telemetry', 'vendors', 'xdlc']) assert.equal(st[id].status, 'unavailable', id);
  assert.equal(st.ledger.status, 'connected'); assert.equal(st.ledger.observed, 0); // ledger never came up, no error recorded: bootstrapping
  assert.equal(st.api.status, 'connected'); assert.equal(st.api.observed, 0); // no routes on this node -> nothing probed
  assert.equal(st.infra.status, 'connected'); assert.equal(st.infra.observed, 0);
  // Only the operator-report seeds exist: nothing from missing sources.
  assert.deepEqual(r.all().map((f) => f.source).sort(), STATIC_SEEDS.map((s) => s.source).sort());
  const cov = svc.coverage();
  assert.equal(cov.statement, SENTINEL_STATEMENT); assert.match(cov.statement, /does not authorize spending/);
  assert.equal(cov.subsystems.length, SUBSYSTEMS.length);
  for (const s of cov.subsystems) {
    assert.ok(['observed', 'reported', 'unavailable', 'pending'].includes(s.observed), s.id);
    if (s.observed === 'unavailable') assert.ok(s.reason, `${s.id} unavailable needs a reason`);
    assert.deepEqual(Object.keys(s.open), ['critical', 'high', 'medium', 'low', 'info']);
  }
  assert.equal(cov.subsystems.find((s) => s.id === 'vendors').observed, 'unavailable');
  assert.equal(cov.subsystems.find((s) => s.id === 'bc07').observed, 'reported');
  assert.ok(allCollectors().length >= universalCollectors().length + 10);
});

test('BC-07 stays reported, not reproduced: REPORTED class, UNVERIFIED_EXTERNAL, no evidence, explicit note', () => {
  const r = new FindingsRegistry({ now: clock });
  for (const s of STATIC_SEEDS) r.record(s);
  const bc = r.all().find((f) => f.key.startsWith('external:bc-07'));
  const v = universalView(bc);
  assert.equal(v.subsystem, 'bc07'); assert.equal(v.provenance, 'REPORTED'); assert.equal(v.provenanceRaw, 'UNAVAILABLE');
  assert.equal(v.verification, 'UNVERIFIED_EXTERNAL'); assert.equal(v.evidenceCount, 0); assert.match(v.evidenceNote, /not present on London/);
  // The x402 code-review finding is preserved as a Sentinel finding under unauthorized payments.
  const pid = universalView(r.all().find((f) => f.key === 'code-review:x402:client-asserted-participant-id'));
  assert.equal(pid.subsystem, 'payments'); assert.equal(pid.provenance, 'REPORTED');
  // Every universal record carries the required fields, and evidence or a recorded-report note.
  for (const f of r.all()) { const u = universalView(f); for (const k of ['id', 'severity', 'timestamp', 'affectedSystem', 'provenance', 'owner', 'remediationStatus']) assert.ok(u[k], k); assert.ok(u.evidenceCount > 0 || u.evidenceNote); }
});

test('classification and provenance classes', () => {
  const c = (key, extra = {}) => classify({ key, title: '', ...extra }).id;
  assert.equal(c('x402:live-settlement-without-independent-approval'), 'payments');
  assert.equal(c('pathfinder:no_path:token_to_token:BBL/LDN'), 'routing');
  assert.equal(c('token:BBL:supply.concentration'), 'inventory');
  assert.equal(c('token:BBL:book.unfunded'), 'offers');
  assert.equal(c('token:BBL:book.concentration'), 'depth');
  assert.equal(c('token:BBL:delegate.maker'), 'delegation');
  assert.equal(c('token:BBL:activity.demo'), 'fills');
  assert.equal(c('token:BBL:identity.collision'), 'token-risk');
  assert.equal(c('anything', { source: 'incubator' }), 'lending');
  assert.equal(c('xdlc:initial:x', { source: 'xdlc' }), 'redeployment');
  assert.equal(c('something-new'), 'reports');
  assert.equal(provenanceClass({ provenance: 'MAINNET_OBSERVED_READ_ONLY' }), 'MAINNET_OBSERVED');
  assert.equal(provenanceClass({ provenance: 'UNAVAILABLE', source: 'operator-directive' }), 'REPORTED');
  assert.equal(provenanceClass({ provenance: 'UNAVAILABLE', source: 'collector-x' }), 'UNAVAILABLE');
  assert.equal(provenanceClass({ provenance: 'LIVE_TESTNET' }), 'LIVE_TESTNET');
});

test('audit trail: status changes with timestamps from the hash-chained history, newest first', () => {
  const r = new FindingsRegistry({ now: clock });
  const [f] = executionFindings([run({ scorecard: { payments: { succeeded: 9 } } })]);
  const id = r.record(f).finding.id;
  r.update(id, { status: 'investigating' }, { note: 'looking' });
  r.addNote(id, 'n');
  const st = auditTrail(r.all(), { kind: 'status' });
  assert.deepEqual(st.entries.map((e) => [e.action, e.status?.from ?? null, e.status?.to]), [['status_changed', 'open', 'investigating'], ['recorded', null, 'open']]);
  assert.ok(st.entries.every((e) => e.at && e.hash && e.seq));
  assert.equal(auditTrail(r.all(), { kind: 'all' }).total, 3);
  assert.equal(auditTrail(r.all(), { subsystem: 'infra' }).total, 0);
  const cov = coverage(r.all(), {}, { now: Date.parse(AT) });
  assert.equal(cov.subsystems.find((s) => s.id === 'execution').open.medium, 1);
  assert.equal(cov.topFindings[0].id, id);
});

test('GET /api/sentinel/coverage and /audit are registered before /:code and degrade without the registry', async () => {
  const routes = [];
  const app = { get: (p, h) => routes.push([p, h]), post: () => {} };
  const out = [];
  const ctx = { json: (res, code, body) => out.push([code, body]), ledger: { wallets: {} }, store: { launches: [] }, bus: { publish() {} }, ledgerReady: false };
  registerSentinelRoutes(app, ctx);
  const idx = (p) => routes.findIndex(([x]) => x === p);
  assert.ok(idx('/api/sentinel/coverage') >= 0 && idx('/api/sentinel/coverage') < idx('/api/sentinel/:code'));
  assert.ok(idx('/api/sentinel/audit') < idx('/api/sentinel/:code'));
  routes[idx('/api/sentinel/coverage')][1]({}, {});
  assert.equal(out[0][0], 503);
  ctx.findings = new FindingsService({ registry: new FindingsRegistry({ now: clock }), collectors: [] });
  routes[idx('/api/sentinel/coverage')][1]({}, {});
  assert.equal(out[1][0], 200); assert.equal(out[1][1].subsystems.length, SUBSYSTEMS.length);
  routes[idx('/api/sentinel/audit')][1]({}, {}, {}, {}, new URL('http://x/api/sentinel/audit?kind=status'));
  assert.equal(out[2][1].kind, 'status');
});
