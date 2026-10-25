// Vendor integrations (Workstream F): status logic per env, no secrets in outputs, samples only from real probes,
// x402 never invoked with a payment. Pure logic, no network: every fetch / observer is a stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVendors, sentinelSignals, merchantFlow, VENDOR_IDS, LIQUIDITY_LOOP, liquidityLoop } from '../lib/vendors/index.mjs';
import { observationSource, observeServerInfo, observeFills, QUICKNODE_LABEL, PUBLIC_TESTNET_LABEL } from '../lib/vendors/observation.mjs';
import { renderStreamFilter, loadStreamFilter } from '../lib/vendors/quicknode.mjs';
import { isNonExecutable as browserIsNonExecutable } from '../public/vendors-ledger.js';
import { SampleStore, STATUSES, redactUrl, safeMessage } from '../lib/vendors/common.mjs';
import { createQuicknodeAdapter, quicknodeStatus } from '../lib/vendors/quicknode.mjs';
import { createT54Adapter, localChallenge, T54_TESTNET_SUPPORTED } from '../lib/vendors/t54.mjs';
import { createAgentcoreAdapter, agentcoreStatus, loadManifest, otelSpanFor } from '../lib/vendors/agentcore.mjs';
import { evaluateIntent, demoIntent, createMastercardAdapter } from '../lib/vendors/mastercard.mjs';
import { buildReviewTx, buildCommitmentTx, isNonExecutableReview, compressPublicKey, createLedgerAdapter } from '../lib/vendors/ledger.mjs';
import { decode } from 'xrpl';
import { createXrplAdapter } from '../lib/vendors/xrpl.mjs';
import { MainnetObserver } from '../lib/mainnet-observer.mjs';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-vendors-')), 'samples.json');
const NOW = () => Date.parse('2026-10-25T12:00:00Z');
const SECRETS = { QUICKNODE_XRPL_HTTP: 'https://fancy-node.xrp-mainnet.quiknode.pro/SECRETTOKEN123abc/', QUICKNODE_XRPL_WSS: 'wss://fancy-node.xrp-mainnet.quiknode.pro/SECRETTOKEN456def/', QUICKNODE_STREAMS_KEY: 'QN_streams_SECRET789',
  AWS_ACCESS_KEY_ID: 'AKIASECRETKEYID0000', AWS_SECRET_ACCESS_KEY: 'awsSECRETaccesskeyvalue', MASTERCARD_CONSUMER_KEY: 'mcSECRETconsumerkey', MASTERCARD_SIGNING_KEY_PATH: '/secret/path/key.p12', MASTERCARD_SIGNING_KEY_PASSWORD: 'mcSECRETpassword' };
const res = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), headers: { get: (k) => headers[k.toLowerCase()] ?? null } });
const fakeObserver = (calls = []) => () => ({ request: async (r) => { calls.push(r); return { result: { info: { network_id: 0, validated_ledger: { seq: 100 }, build_version: 'x' } } }; }, disconnect: async () => {} });

test('every adapter exposes the contract fields and a valid status', () => {
  const v = createVendors({ env: {}, samples: new SampleStore(null), now: NOW });
  assert.deepEqual(Object.keys(v.adapters).sort(), [...VENDOR_IDS].sort());
  for (const a of Object.values(v.adapters)) {
    for (const k of ['id', 'name', 'docs', 'capability', 'credentialEnv']) assert.ok(a[k] !== undefined, `${a.id}.${k}`);
    assert.ok(Array.isArray(a.docs) && a.docs.every((d) => d.startsWith('https://')));
    assert.equal(typeof a.status, 'function'); assert.equal(typeof a.probe, 'function');
    assert.ok(STATUSES.includes(a.status()));
    assert.equal(a.sample, null);
    assert.deepEqual(Object.keys(a.telemetry).sort(), ['calls', 'errors', 'lastCallAt', 'lastError', 'lastOkAt', 'latencyMs'].sort());
  }
});

test('status logic per env with no credentials', () => {
  const v = createVendors({ env: {}, samples: new SampleStore(null), now: NOW });
  const s = Object.fromEntries(v.list().map((x) => [x.id, x.status]));
  assert.deepEqual(s, { xrpl: 'DOCUMENTATION_ONLY', quicknode: 'CREDENTIALS_REQUIRED', ledger: 'SANDBOX_ONLY', t54: 'DOCUMENTATION_ONLY', agentcore: 'CREDENTIALS_REQUIRED', mastercard: 'DOCUMENTATION_ONLY' });
});

test('QuickNode: credentials required -> connected -> tested / error', () => {
  assert.equal(quicknodeStatus({ env: {} }), 'CREDENTIALS_REQUIRED');
  assert.equal(quicknodeStatus({ env: { QUICKNODE_XRPL_WSS: '  ' } }), 'CREDENTIALS_REQUIRED');
  assert.equal(quicknodeStatus({ env: { QUICKNODE_XRPL_WSS: 'wss://x' } }), 'CONNECTED');
  assert.equal(quicknodeStatus({ env: { QUICKNODE_XRPL_WSS: 'wss://x' }, lastProbe: { ok: true } }), 'CONNECTED_TESTED');
  assert.equal(quicknodeStatus({ env: { QUICKNODE_XRPL_WSS: 'wss://x' }, lastProbe: { ok: false } }), 'ERROR');
});

test('AgentCore: CREDENTIALS_REQUIRED without AWS env, never claims connected with it', () => {
  assert.equal(agentcoreStatus({ env: {} }), 'CREDENTIALS_REQUIRED');
  assert.equal(agentcoreStatus({ env: { AWS_ACCESS_KEY_ID: 'a' } }), 'CREDENTIALS_REQUIRED');
  assert.equal(agentcoreStatus({ env: { AWS_PROFILE: 'p' } }), 'DOCUMENTATION_ONLY');
  assert.equal(agentcoreStatus({ env: { AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b' } }), 'DOCUMENTATION_ONLY');
});

test('Mastercard stays DOCUMENTATION_ONLY even with MASTERCARD_* set; Ledger is SANDBOX_ONLY', () => {
  assert.equal(createMastercardAdapter({ env: SECRETS }).status(), 'DOCUMENTATION_ONLY');
  assert.equal(createLedgerAdapter({ env: SECRETS }).status(), 'SANDBOX_ONLY');
});

test('no secret values appear in any vendor output (list, views, probes, errors)', async () => {
  const fetchFn = async (url) => { if (String(url).includes('streams')) return res(200, { data: [] }); return res(500, {}); };
  const v = createVendors({ env: SECRETS, samples: new SampleStore(null), now: NOW, fetchFn, observerAt: () => ({ request: async () => { throw new Error(`connect failed to ${SECRETS.QUICKNODE_XRPL_WSS}`); }, disconnect: async () => {} }) });
  const outs = [JSON.stringify(v.list())];
  outs.push(JSON.stringify(await v.adapters.quicknode.probe()));
  outs.push(JSON.stringify(await v.adapters.agentcore.probe()));
  outs.push(JSON.stringify(await v.adapters.mastercard.probe()));
  outs.push(JSON.stringify(v.list()));
  const all = outs.join('\n');
  for (const s of Object.values(SECRETS)) assert.ok(!all.includes(s), `leaked ${s}`);
  assert.ok(!all.includes('SECRETTOKEN'));
  assert.equal(redactUrl(SECRETS.QUICKNODE_XRPL_HTTP), 'https://fancy-node.xrp-mainnet.quiknode.pro/…');
  assert.ok(!safeMessage(new Error(`bad ${SECRETS.QUICKNODE_XRPL_HTTP}`)).includes('SECRETTOKEN'));
  assert.equal(v.adapters.quicknode.status(), 'ERROR');
});

test('samples: stored only from a successful real probe, never on failure or fallback', async () => {
  const file = tmp();
  const samples = new SampleStore(file);
  assert.throws(() => samples.set('x', { result: 1 }), /unverified/);
  let fail = true;
  const t54 = createT54Adapter({ env: {}, samples, now: NOW, fetchFn: async (url) => (fail ? res(503, {}) : res(200, { kinds: [{ x402Version: 2, scheme: 'exact', network: 'xrpl:1' }], extensions: [] })) });
  const r1 = await t54.probe();
  assert.equal(r1.ok, false); assert.equal(t54.sample, null); assert.equal(t54.status(), 'ERROR'); assert.equal(fs.existsSync(file), false);
  fail = false;
  const r2 = await t54.probe();
  assert.equal(r2.ok, true); assert.equal(r2.sampleStored, true); assert.equal(t54.status(), 'CONNECTED_TESTED');
  assert.equal(t54.sample.verified, true); assert.equal(t54.sample.source, T54_TESTNET_SUPPORTED); assert.ok(t54.sample.capturedAt);
  assert.equal(t54.sample.result.exactTestnetSupported, true);
  // A fresh process sees the stored sample as CONNECTED (verified earlier), not CONNECTED_TESTED.
  const again = createT54Adapter({ env: {}, samples: new SampleStore(file), now: NOW, fetchFn: async () => res(500, {}) });
  assert.equal(again.status(), 'CONNECTED');
  // QuickNode public fallback is not a QuickNode sample.
  const qs = new SampleStore(null);
  const qn = createQuicknodeAdapter({ env: {}, samples: qs, now: NOW, observer: fakeObserver() });
  const r3 = await qn.probe();
  assert.equal(r3.ok, true); assert.equal(r3.fallback, true); assert.equal(qn.sample, null); assert.equal(qn.status(), 'CREDENTIALS_REQUIRED');
});

test('t54 probe only GETs the testnet /supported endpoint (never verify/settle/mainnet)', async () => {
  const seen = [];
  const t54 = createT54Adapter({ env: {}, now: NOW, fetchFn: async (url, opts) => { seen.push([opts?.method, String(url)]); return res(200, { kinds: [] }); } });
  await t54.probe();
  assert.deepEqual(seen, [['GET', 'https://xrpl-facilitator-testnet.t54.ai/supported']]);
});

test('x402 showcase: challenge is fetched without any payment header and never POSTs', async () => {
  const seen = [];
  const pr = { x402Version: 2, accepts: [{ scheme: 'exact', network: 'xrpl:1', amount: '50000', asset: 'XRP', payTo: 'rX', maxTimeoutSeconds: 60, extra: { invoiceId: 'tf-1' } }] };
  const fetchFn = async (url, opts = {}) => {
    seen.push({ url: String(url), method: opts.method, headers: Object.keys(opts.headers || {}).map((k) => k.toLowerCase()) });
    return res(402, { x402: 'payment required', paymentRequired: pr }, { 'payment-required': Buffer.from(JSON.stringify(pr)).toString('base64') });
  };
  const c = await localChallenge({ baseUrl: 'http://127.0.0.1:1', fetchFn });
  assert.equal(c.httpStatus, 402); assert.equal(c.paid, false); assert.equal(c.paymentRequiredHeader.accepts[0].network, 'xrpl:1');
  const v = createVendors({ env: {}, samples: new SampleStore(null), now: NOW });
  const flow = await merchantFlow({ vendors: v, baseUrl: 'http://127.0.0.1:1', fetchFn, now: NOW });
  assert.equal(flow.paymentExecuted, false);
  for (const s of seen) {
    assert.equal(s.method, 'GET');
    assert.ok(!s.headers.includes('payment-signature') && !s.headers.includes('x-payment'));
    assert.ok(!/\/live\//.test(s.url) && /\/api\/x402\/(data\/|supported$)/.test(s.url));
    assert.ok(!/\/(verify|settle)\b/.test(s.url));
  }
  // Facilitator options: TG Merchant's own next to t54 (no t54 call from the flow itself: it uses the stored probe sample).
  assert.ok(seen.some((x) => x.url.endsWith('/api/x402/supported')));
  assert.ok(!seen.some((x) => /t54\.ai/.test(x.url)));
  assert.equal(flow.facilitators.t54.role, 'drop-in option (not in the settlement path)');
  assert.match(flow.facilitators.calls, /No \/verify, no \/settle/);
  assert.deepEqual(flow.steps.map((x) => x.id), ['discover', 'challenge', 'intent', 'policy', 'approval', 'settlement', 'audit']);
  for (const s of flow.steps) assert.ok(s.mode, `${s.id} has a mode label`);
  const approval = flow.steps.find((x) => x.id === 'approval');
  assert.equal(approval.detail.given, false);
  const audit = flow.steps.find((x) => x.id === 'audit').detail.audit;
  assert.equal(audit.executed, false); assert.equal(audit.charged, false); assert.equal(audit.ownerApproved, false);
});

test('route file never references live purchase, launch or loop start', () => {
  const src = ['lib/routes/92-vendors.mjs', ...fs.readdirSync('lib/vendors').filter((f) => f.endsWith('.mjs')).map((f) => `lib/vendors/${f}`)].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.ok(!/x402\/live\/purchase/.test(src));
  assert.ok(!/\/api\/launch['"`]/.test(src));
  assert.ok(!/loop\/start/.test(src));
  assert.ok(!/submitAndWait|\.submit\(|\.sign\(/.test(src));
});

test('Mastercard intent: mandate + Guardian decide; nothing executes', () => {
  const ok = evaluateIntent(demoIntent(), { now: NOW });
  assert.equal(ok.policyAllowed, true); assert.equal(ok.authorization.executed, false); assert.equal(ok.authorization.ownerApproved, false);
  const big = evaluateIntent(demoIntent({ amountUsd: 50 }), { now: NOW });
  assert.equal(big.policyAllowed, false); assert.ok(big.mandateReasons.some((r) => /per-transaction/.test(r)));
  const cat = evaluateIntent(demoIntent({ category: 'gift-cards' }), { now: NOW });
  assert.equal(cat.policyAllowed, false);
  const late = evaluateIntent(demoIntent(), { now: () => Date.parse('2026-10-27T00:00:00Z') });
  assert.ok(late.mandateReasons.includes('Mandate expired.'));
});

test('AgentCore manifest: read-only GET tools only; OTEL span shape', async () => {
  const m = loadManifest();
  assert.ok(m.tools.length >= 5);
  for (const t of m.tools) { assert.equal(t.annotations.readOnlyHint, true); assert.equal(t['x-titanforge'].method, 'GET'); assert.equal(t.inputSchema.type, 'object'); }
  assert.ok(!JSON.stringify(m.tools).match(/POST|launch"|loop\/start|live\/purchase/));
  const a = createAgentcoreAdapter({ env: {}, now: NOW, routeExists: () => true });
  const r = await a.probe();
  assert.equal(r.ok, true); assert.equal(a.sample, null);
  const missing = await createAgentcoreAdapter({ env: {}, now: NOW, routeExists: () => false }).probe();
  assert.equal(missing.ok, false);
  const span = otelSpanFor({ type: 'vendors.probe', mode: 'SIMULATION', at: '2026-10-25T12:00:00Z', vendor: 'xrpl' });
  assert.equal(span.span.name, 'vendors.probe'); assert.equal(span.span.attributes['tf.vendor'], 'xrpl'); assert.equal(span.span.startTimeUnixNano, '1792929600000000000');
});

test('Ledger review tx: unsigned, Testnet, expired by construction, validates inputs', async () => {
  const ledger = { client: { isConnected: () => true, request: async (r) => (r.command === 'ledger' ? { result: { ledger_index: 5000 } } : { result: { account_data: { Sequence: 42 } } }) } };
  const out = await buildReviewTx({ account: 'rLXCWBHdR489cqwtcwai6QHEdFSkhFoFGP', publicKey: '02' + 'A'.repeat(64), destination: 'rno84rguzSP8uPD1JhCi2tKRc2P1b4TdBH', ledger, ledgerReady: () => true });
  assert.equal(out.unsigned, true); assert.equal(out.submitted, false); assert.equal(out.executable, false); assert.equal(out.mode, 'LIVE_TESTNET');
  assert.ok(out.tx.LastLedgerSequence < 5000); assert.equal(out.tx.Sequence, 42); assert.equal(out.tx.Amount, '1');
  assert.equal(out.tx.TxnSignature, undefined); assert.equal(out.tx.NetworkID, undefined);
  assert.match(out.encoded, /^[0-9A-F]+$/);
  await assert.rejects(buildReviewTx({ account: 'nope', publicKey: '02' + 'A'.repeat(64), destination: 'rno84rguzSP8uPD1JhCi2tKRc2P1b4TdBH' }), /classic/);
  await assert.rejects(buildReviewTx({ account: 'rLXCWBHdR489cqwtcwai6QHEdFSkhFoFGP', publicKey: 'zz', destination: 'rno84rguzSP8uPD1JhCi2tKRc2P1b4TdBH' }), /publicKey/);
  assert.equal(compressPublicKey('04' + '1'.repeat(64) + '2'.repeat(63) + '3'), '03' + '1'.repeat(64));
});

test('XRPL adapter: offline does not error or store a sample; mainnet observer allowlist stays read-only', async () => {
  const x = createXrplAdapter({ env: {}, samples: new SampleStore(null), now: NOW, offline: true });
  const r = await x.probe();
  assert.equal(r.ok, false); assert.equal(x.status(), 'DOCUMENTATION_ONLY'); assert.equal(x.sample, null);
  const obs = new MainnetObserver('wss://example.invalid');
  for (const cmd of ['submit', 'sign', 'wallet_propose', 'submit_multisigned']) await assert.rejects(obs.request({ command: cmd }), /not an allowed read command/);
  await assert.rejects(obs.request({ command: 'feature', feature: 'AMM', vetoed: true }), /not a read command/);
});

test('sentinel signals report vendor probe failures', async () => {
  const v = createVendors({ env: {}, samples: new SampleStore(null), now: NOW, fetchFn: async () => res(500, {}) });
  await v.adapters.t54.probe();
  const s = sentinelSignals(v, NOW);
  const sig = s.signals.find((x) => x.key === 'vendors:t54:probe_failed');
  assert.ok(sig); assert.equal(sig.severity, 'medium'); assert.equal(sig.category, 'vendor-integration');
});

test('stored data/vendor-samples.json only holds verified, timestamped probe output without secrets', () => {
  const f = 'data/vendor-samples.json';
  if (!fs.existsSync(f)) return;
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const [id, s] of Object.entries(d.samples)) {
    assert.equal(s.vendor, id); assert.equal(s.verified, true); assert.ok(!Number.isNaN(Date.parse(s.capturedAt))); assert.ok(s.source);
  }
  assert.ok(!/"seed"|secret|"sEd[1-9A-HJ-NP-Za-km-z]{20,}"|"s[1-9A-HJ-NP-Za-km-z]{28}"/.test(JSON.stringify(d.samples)));
});

// ---------- Vendors in the liquidity loop ----------
const TESTNET_INFO = { network_id: 1, validated_ledger: { seq: 777, age: 2 }, server_state: 'full' };
const qnObserver = (info, calls = []) => (url) => ({ url, request: async (r) => { calls.push({ url, ...r }); if (r.command === 'server_info') return { result: { info } }; if (r.command === 'tx') return { result: { validated: true, ledger_index: 770, meta: { TransactionResult: 'tesSUCCESS' }, tx_json: { TransactionType: 'Payment' } } }; throw new Error('unexpected'); } });
const QN_WSS = 'wss://fancy-node.xrp-testnet.quiknode.pro/SECRETTOKEN456def/';

test('QuickNode is preferred for Sentinel ledger freshness only when QUICKNODE_XRPL_WSS is set', async () => {
  const pub = []; const fallbackRequest = async (r) => { pub.push(r); return { result: { info: { ...TESTNET_INFO, validated_ledger: { seq: 555, age: 3 } } } }; };
  // Unset: public source, and the observer is never constructed.
  let built = 0;
  const off = await observeServerInfo({ env: {}, fallbackRequest, makeObserver: () => { built++; return null; } });
  assert.equal(off.source.provider, 'public'); assert.equal(off.source.label, PUBLIC_TESTNET_LABEL); assert.equal(off.info.validated_ledger.seq, 555); assert.equal(built, 0);
  assert.equal(observationSource({ QUICKNODE_XRPL_WSS: '  ' }).provider, 'public');
  assert.equal(observationSource({ QUICKNODE_XRPL_WSS: 'https://not-wss' }).provider, 'public');
  // Set and serving Testnet: QuickNode, labelled, and the token never appears.
  const calls = []; pub.length = 0;
  const on = await observeServerInfo({ env: { QUICKNODE_XRPL_WSS: QN_WSS }, fallbackRequest, makeObserver: qnObserver(TESTNET_INFO, calls) });
  assert.equal(on.source.provider, 'quicknode'); assert.equal(on.source.label, QUICKNODE_LABEL); assert.equal(on.info.validated_ledger.seq, 777);
  assert.equal(pub.length, 0); assert.deepEqual(calls.map((c) => c.command), ['server_info']);
  assert.ok(!JSON.stringify(on.source).includes('SECRETTOKEN'));
  // Set but Mainnet endpoint (network_id 0) or failing: falls back to the public Testnet source and says why.
  const mainnet = await observeServerInfo({ env: { QUICKNODE_XRPL_WSS: QN_WSS }, fallbackRequest, makeObserver: qnObserver({ network_id: 0, validated_ledger: { seq: 1 } }) });
  assert.equal(mainnet.source.provider, 'public'); assert.match(mainnet.source.quicknodeSkipped, /network_id 0/); assert.equal(mainnet.info.validated_ledger.seq, 555);
  const broken = await observeServerInfo({ env: { QUICKNODE_XRPL_WSS: QN_WSS }, fallbackRequest, makeObserver: () => ({ request: async () => { throw new Error(`connect failed ${QN_WSS}`); } }) });
  assert.equal(broken.source.provider, 'public'); assert.ok(!JSON.stringify(broken).includes('SECRETTOKEN'));
});

test('Theater fill observation: QuickNode when set (Testnet), public fallback otherwise; tx reads only', async () => {
  const h = 'A'.repeat(64);
  const calls = [];
  const on = await observeFills({ env: { QUICKNODE_XRPL_WSS: QN_WSS }, hashes: [h, h, 'bad'], makeObserver: qnObserver(TESTNET_INFO, calls), fallbackRequest: async () => { throw new Error('should not fall back'); } });
  assert.equal(on.source.label, QUICKNODE_LABEL); assert.equal(on.mode, 'LIVE_TESTNET'); assert.equal(on.organic, false);
  assert.equal(on.fills.length, 1); assert.equal(on.confirmed, 1); assert.equal(on.validatedLedger, 777);
  for (const c of calls) assert.ok(['server_info', 'tx'].includes(c.command));
  const pub = [];
  const off = await observeFills({ env: {}, hashes: [h], fallbackRequest: async (r) => { pub.push(r.command); return r.command === 'server_info' ? { result: { info: TESTNET_INFO } } : { result: { validated: true, ledger_index: 9, meta: { TransactionResult: 'tesSUCCESS' } } }; } });
  assert.equal(off.source.provider, 'public'); assert.deepEqual(pub, ['server_info', 'tx']);
  await assert.rejects(observeFills({ env: {}, hashes: [h] }), /No observation source/);
});

test('QuickNode Streams filter template: addresses from /api/status at render time, never seeds, not deployed', () => {
  const t = loadStreamFilter();
  assert.match(t.status, /NOT DEPLOYED/); assert.ok(t.filterFunction.includes(t.addresses.placeholder));
  assert.ok(!/r[1-9A-HJ-NP-Za-km-z]{24,34}/.test(t.filterFunction), 'no hardcoded addresses');
  assert.ok(!/"s[1-9A-HJ-NP-Za-km-z]{20,}"|seed|secret/i.test(JSON.stringify(t).replace(/seeds never leave the server|No seeds, keys or tokens/g, '')));
  const status = { accounts: { issuer: { address: 'rno84rguzSP8uPD1JhCi2tKRc2P1b4TdBH' }, maker: { address: 'rLXCWBHdR489cqwtcwai6QHEdFSkhFoFGP' }, router: { address: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh' }, taker: { address: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe' } } };
  const r = renderStreamFilter(status);
  assert.equal(r.deployed, false);
  assert.deepEqual(r.accounts.map((a) => a.role), ['maker', 'router']);
  assert.ok(r.filterFunction.includes('rLXCWBHdR489cqwtcwai6QHEdFSkhFoFGP') && !r.filterFunction.includes('rno84rguz') && !r.filterFunction.includes('rPT1Sjq'));
  const main = new Function(`${r.filterFunction}; return main;`)();
  const ledger = { ledger_index: 10, transactions: [
    { hash: 'H1', tx_json: { TransactionType: 'OfferCreate', Account: 'rLXCWBHdR489cqwtcwai6QHEdFSkhFoFGP' }, meta: { TransactionResult: 'tesSUCCESS', AffectedNodes: [] } },
    { hash: 'H2', tx_json: { TransactionType: 'Payment', Account: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe' }, meta: { TransactionResult: 'tesSUCCESS', AffectedNodes: [{ ModifiedNode: { FinalFields: { Account: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh' } } }] } },
    { hash: 'H3', tx_json: { TransactionType: 'Payment', Account: 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe' }, meta: { AffectedNodes: [] } } ] };
  assert.deepEqual(main({ data: [ledger] }).titanForge.map((x) => x.hash), ['H1', 'H2']);
  assert.equal(main({ data: [{ transactions: [] }] }), null);
  assert.throws(() => renderStreamFilter({ accounts: {} }), /No maker\/router/);
});

test('Ledger TGLW commitment (Tier 1/2): unsigned OfferCreate from the participant, never executable', async () => {
  const ledger = { client: { isConnected: () => true, request: async (r) => (r.command === 'ledger' ? { result: { ledger_index: 5000 } } : { result: { account_data: { Sequence: 42 } } }) } };
  const base = { account: 'rLXCWBHdR489cqwtcwai6QHEdFSkhFoFGP', publicKey: '02' + 'B'.repeat(64), token: { currency: 'BBL', issuer: 'rno84rguzSP8uPD1JhCi2tKRc2P1b4TdBH' }, priceXrp: 0.008 };
  for (const tier of ['T1', 'T2']) {
    const out = await buildCommitmentTx({ ...base, tier, termDays: 90, amountXrp: 2, ledger, ledgerReady: () => true });
    assert.equal(out.unsigned, true); assert.equal(out.submitted, false); assert.equal(out.executable, false); assert.equal(out.mode, 'LIVE_TESTNET');
    assert.equal(out.custody, 'Your funds stay in your wallet; Titan Ghost never holds your keys.');
    assert.equal(out.tx.TransactionType, 'OfferCreate'); assert.equal(out.tx.Account, base.account); assert.equal(out.tx.TakerGets, '2000000');
    assert.equal(out.tx.TakerPays.value, '250'); assert.equal(out.tx.Flags & 0x00010000, 0x00010000);
    assert.ok(out.tx.LastLedgerSequence < 5000); assert.equal(out.tx.TxnSignature, undefined); assert.equal(out.tx.NetworkID, undefined);
    assert.ok(isNonExecutableReview(out)); assert.ok(browserIsNonExecutable(out), 'browser check mirrors the server');
    const d = decode(out.encoded); assert.equal(d.LastLedgerSequence, out.tx.LastLedgerSequence); assert.equal(d.TxnSignature, undefined);
  }
  // Without a ledger read the LLS is the minimum (1), still non-executable.
  const cold = await buildCommitmentTx({ ...base, tier: 'T1' });
  assert.equal(cold.tx.LastLedgerSequence, 1); assert.ok(isNonExecutableReview(cold));
  // Tampering makes the check fail in both places: never offered to the device.
  for (const bad of [{ submitted: true }, { executable: true }, { unsigned: false }, { mode: 'MAINNET' }, { tx: { ...cold.tx, LastLedgerSequence: 99999999 } }, { tx: { ...cold.tx, TxnSignature: 'AB' } }, { tx: { ...cold.tx, NetworkID: 0 } }]) {
    const r = { ...cold, ...bad };
    assert.equal(isNonExecutableReview(r), false, JSON.stringify(bad)); assert.equal(browserIsNonExecutable(r), false);
  }
  const live = await buildCommitmentTx({ ...base, tier: 'T1', ledger, ledgerReady: () => true });
  assert.equal(isNonExecutableReview({ ...live, validatedLedgerAtBuild: live.tx.LastLedgerSequence }), false);
  await assert.rejects(buildCommitmentTx({ ...base, tier: 'T3' }), /T1 or T2/);
  await assert.rejects(buildCommitmentTx({ ...base, account: base.token.issuer }), /own wallet/);
  await assert.rejects(buildCommitmentTx({ ...base, token: null }), /demo token/);
  // The existing review tx passes the same check.
  const rv = await buildReviewTx({ account: base.account, publicKey: base.publicKey, destination: base.token.issuer, ledger, ledgerReady: () => true });
  assert.ok(isNonExecutableReview(rv) && browserIsNonExecutable(rv));
});

test('AgentCore tools map to registered GET routes (radar, sentinel coverage, corridor, theater state)', () => {
  const src = fs.readdirSync('lib/routes').filter((f) => f.endsWith('.mjs')).map((f) => fs.readFileSync(path.join('lib/routes', f), 'utf8')).join('\n');
  const routes = [...src.matchAll(/app\.get\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
  const re = (p) => new RegExp('^' + p.replace(/:(\w+)/g, '[^/]+') + '$');
  const tools = loadManifest().tools;
  for (const t of tools) {
    const p = t['x-titanforge'].path.replace(/\{(\w+)\}/g, 'XYZ');
    assert.ok(routes.some((r) => re(r).test(p)), `${t.name}: GET ${t['x-titanforge'].path} is registered`);
  }
  const paths = tools.map((t) => t['x-titanforge'].path);
  for (const need of ['/api/xdlc/radar', '/api/sentinel/coverage', '/api/corridor', '/api/theater/state']) assert.ok(paths.includes(need), need);
});

test('liquidity loop map: every vendor placed, Mastercard kept out of the loop (docs only, TG Merchant)', () => {
  assert.deepEqual(LIQUIDITY_LOOP.map((x) => x.vendor).sort(), [...VENDOR_IDS].sort());
  const mc = LIQUIDITY_LOOP.find((x) => x.vendor === 'mastercard');
  assert.equal(mc.inLoop, false); assert.deepEqual([...mc.tabs], ['merchant']);
  const v = createVendors({ env: {}, samples: new SampleStore(null), now: NOW });
  const loop = liquidityLoop(v);
  assert.equal(loop.find((x) => x.vendor === 'mastercard').status, 'DOCUMENTATION_ONLY');
  assert.equal(loop.find((x) => x.vendor === 'ledger').status, 'SANDBOX_ONLY');
  assert.equal(loop.find((x) => x.vendor === 'quicknode').step, 'observe fills');
  for (const x of loop) assert.ok(STATUSES.includes(x.status));
  // Liquidity surfaces never mention Mastercard.
  for (const f of ['public/modules/32-incubator.js', 'public/vendors-ledger.js', 'lib/vendors/observation.mjs', 'public/modules/05-theater.js']) assert.ok(!/mastercard/i.test(fs.readFileSync(f, 'utf8')), f);
});
