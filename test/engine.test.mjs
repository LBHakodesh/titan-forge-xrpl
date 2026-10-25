// Engine contract tests: schemas, validator, enum drift, real launch evidence, demo + Rust adapter bridging. No XRPL network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, getSchema, schemaNames, unsupportedKeywords, registry } from '../lib/engine/validate.mjs';
import { enumDrift, txEvidenceFromStep, tokenRefFromLaunch, CONTRACT_VERSION } from '../lib/engine/contracts.mjs';
import { getEngine, initEngine, resetEngine, engineStatus, TemporaryDemoAdapter } from '../lib/engine/index.mjs';
import { RustEngineAdapter, StdioTransport, HttpTransport } from '../lib/engine/rust-adapter.mjs';
import { runConformance } from '../contracts/conformance.mjs';
import { Bus } from '../lib/store.mjs';
import { PROFILES, MARKETS } from '../public/domain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STUB = path.join(ROOT, 'contracts/stub-engine.mjs');
const ex = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts/examples', `${n}.example.json`), 'utf8'));
const ok = (name, v) => { const r = validate(name, v); assert.ok(r.valid, `${name}: ${JSON.stringify(r.errors)}`); };
const bad = (name, v, re) => { const r = validate(name, v); assert.equal(r.valid, false, `${name} should reject ${JSON.stringify(v)}`); if (re) assert.match(JSON.stringify(r.errors), re); };
const stub = (behaviour = '') => new StdioTransport(process.execPath, [STUB], { env: { STUB_BEHAVIOUR: behaviour } });

const EXPECTED = ['allocation', 'asset', 'common', 'corridor-state', 'engine-info', 'financial-event', 'quote-request', 'quote-response',
  'recommendation', 'ring-metrics', 'rpc-request', 'rpc-response', 'strategy-request', 'strategy-response', 'token-ref', 'tx-evidence'];

test('all contract schemas present, 2020-12, only supported keywords, examples valid', () => {
  assert.deepEqual(schemaNames(), EXPECTED);
  for (const n of schemaNames()) {
    const s = getSchema(n);
    assert.equal(s.$schema, 'https://json-schema.org/draft/2020-12/schema', n);
    assert.equal(s.$id, `${n}.schema.json`);
    assert.deepEqual(unsupportedKeywords(s), [], `${n} uses keywords the validator ignores`);
    ok(n, ex(n));
  }
});

test('schema enums match public/domain.js (drift guard)', () => {
  assert.deepEqual(enumDrift(), []);
  const ring = registry.get('common').$defs.RingId;
  const saved = ring.enum; ring.enum = [...saved, 'EXTRA'];
  try { assert.match(enumDrift().join(), /RingId/); } finally { ring.enum = saved; }
  for (const m of MARKETS) ok('recommendation', { source: 's', action: 'hold', rationale: 'r', mode: 'SIMULATION', fromMarket: m.id });
});

test('validator rejects contract violations', () => {
  bad('financial-event', { type: 'launch.done', mode: 'MAINNET', at: '2026-10-24T00:00:00Z' }, /mode/);
  bad('financial-event', { type: 'Launch', mode: 'SIMULATION', at: '2026-10-24T00:00:00Z' }, /type/);
  bad('financial-event', { type: 'a.b', mode: 'SIMULATION', at: 'yesterday' }, /date-time/);
  const tx = ex('tx-evidence');
  bad('tx-evidence', { ...tx, explorer: tx.explorer.replace('testnet.', 'livenet.') }, /explorer/);
  bad('tx-evidence', { ...tx, hash: 'abc' }, /hash/);
  bad('tx-evidence', { ...tx, mode: 'SIMULATION' }, /mode/);
  bad('tx-evidence', { ...tx, ledger: 1.5 }, /integer/);
  bad('allocation', { ...ex('allocation'), mode: 'LIVE_TESTNET' }, /mode/);   // hypothetical capital is never live
  bad('recommendation', { ...ex('recommendation'), mode: 'LIVE_TESTNET' });
  bad('ring-metrics', { ...ex('ring-metrics'), id: 'TURBO' });
  bad('ring-metrics', { ...ex('ring-metrics'), utilization: 1.2 });
  bad('ring-metrics', { ...ex('ring-metrics'), secretSauce: 1 }, /unexpected/);
  bad('corridor-state', { ...ex('corridor-state'), stage: 'xdlc_native' });
  bad('token-ref', { currency: 'XRP', issuer: 'rLXCWBHdR489cqwtcwai6QHEdFSkhFoFGP' });
  ok('asset', { currency: 'XRP' }); ok('asset', ex('token-ref'));
  bad('asset', { currency: 'XRP', issuer: 'rLXCWBHdR489cqwtcwai6QHEdFSkhFoFGP' });
  bad('quote-request', { ...ex('quote-request'), size: 0 });
  bad('strategy-request', { markets: [], mode: 'SIMULATION' });
  bad('strategy-request', { ...ex('strategy-request'), mode: 'LIVE_TESTNET' });
  bad('rpc-response', { v: 1, id: 'x', ok: true }, /oneOf|result/);
  bad('rpc-response', { v: 1, id: 'x', ok: false, error: { code: 'OOPS', message: 'm' } });
  ok('rpc-response', { v: 1, id: 'x', ok: true, result: {} });
  bad('rpc-request', { v: 2, id: 'x', method: 'info', params: {} });
});

test('bus events are valid FinancialEvent envelopes', () => {
  const bus = new Bus();
  for (const mode of ['LIVE_TESTNET', 'SIMULATION', 'REPLAY']) ok('financial-event', bus.publish('launch.step', mode, { launchId: 'x', step: { key: 'issue' } }));
  ok('financial-event', ex('financial-event'));
  assert.throws(() => bus.publish('launch.step', 'MAINNET'));
});

test('real BBL launch record: token ref and every tx step validate as TxEvidence', () => {
  const launches = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/launches.json'), 'utf8'));
  const bbl = launches.find((l) => l.code === 'BBL' && l.status === 'live');
  assert.ok(bbl, 'BBL launch record present');
  assert.equal(bbl.organic, false);
  ok('token-ref', tokenRefFromLaunch(bbl));
  const evidence = bbl.steps.map(txEvidenceFromStep).filter(Boolean);
  assert.equal(evidence.length, 6); // trust_maker, trust_taker, issue, ask, bid, fill
  for (const e of evidence) { ok('tx-evidence', e); assert.equal(e.validated, true); }
  assert.equal(txEvidenceFromStep(bbl.steps.find((s) => s.key === 'validate')), null);
  assert.ok(evidence.some((e) => e.hash === bbl.fillHash));
});

test('default engine is the synchronous TemporaryDemoAdapter; outputs are schema-valid SIMULATION', async () => {
  resetEngine();
  const eng = getEngine();
  const info = eng.info();
  assert.equal(info.id, 'temporary-demo-adapter'); assert.equal(info.authentic, false); assert.match(info.label, /Temporary/);
  assert.equal(engineStatus().configured, 'none');
  for (const p of PROFILES) for (let ringsActive = 1; ringsActive <= 6; ringsActive++) {
    const a = eng.allocate(p.capitalUsd, { flowScale: 1, ringsActive });
    assert.ok(!(a instanceof Promise));
    ok('allocation', a); assert.equal(a.rings.length, ringsActive);
  }
  const recs = eng.recommend(MARKETS.map((m, i) => ({ marketId: m.id, capitalUsd: 50_000 * (i + 1) ** 3, flowScale: 1, ringsActive: 6 })));
  assert.ok(Array.isArray(recs) && recs.length > 0);
  for (const r of recs) ok('recommendation', r);
  ok('strategy-response', await eng.strategyAsync(ex('strategy-request')));
  await assert.rejects(eng.quoteAsync(ex('quote-request')), (e) => e.code === 'NOT_READY');
});

test('RustEngineAdapter over stdio: handshake, v2 calls, v1 sync bridge via cache', async () => {
  const fallback = new TemporaryDemoAdapter();
  const eng = new RustEngineAdapter(stub(), { fallback });
  try {
    const info = await eng.connect();
    assert.equal(info.contractVersion, CONTRACT_VERSION);
    assert.equal(eng.info().authentic, false); assert.match(eng.info().label, /NOT the authentic/);
    const q = await eng.quoteAsync(ex('quote-request')); ok('quote-response', q);
    const s = await eng.strategyAsync(ex('strategy-request')); ok('strategy-response', s);
    // v1 sync: miss -> demo result, tagged; prefetch; hit -> engine result
    const miss = eng.allocate(5000, { flowScale: 1, ringsActive: 2 });
    assert.match(miss.source, /cache miss/); ok('allocation', miss);
    await eng.prefetchAllocate(5000, { flowScale: 1, ringsActive: 2 });
    const hit = eng.allocate(5000, { flowScale: 1, ringsActive: 2 });
    ok('allocation', hit); assert.match(hit.source, /PLACEHOLDER/); assert.equal(hit.rings.length, 2); assert.equal(hit.idleUsd, 5000);
    const mk = [{ marketId: 'currencies', capitalUsd: 1000 }, { marketId: 'securities', capitalUsd: 9000 }];
    for (const r of eng.recommend(mk)) ok('recommendation', r);
    await eng.prefetchRecommend(mk);
    assert.equal(eng.recommend(mk)[0].action, 'hold');
    await assert.rejects(eng.strategyAsync({ markets: 'x', mode: 'SIMULATION' }), /strategy request failed/);
  } finally { eng.close(); }
});

test('RustEngineAdapter rejects bad engines', async () => {
  const fb = new TemporaryDemoAdapter();
  const cases = [
    ['bad-result', (e) => e.connect().then(() => e.strategyAsync(ex('strategy-request'))), /strategy-response schema/],
    ['live-mode', (e) => e.connect().then(() => e.strategyAsync(ex('strategy-request'))), /mode/],
    ['bad-version', (e) => e.connect(), /contract 2\.0\.0/],
  ];
  for (const [b, fn, re] of cases) {
    const eng = new RustEngineAdapter(stub(b), { fallback: fb });
    try { await assert.rejects(fn(eng), re, b); } finally { eng.close(); }
  }
  const silent = new RustEngineAdapter(stub('silent'), { fallback: fb, timeoutMs: 300 });
  try { await assert.rejects(silent.connect(), (e) => e.code === 'TIMEOUT'); } finally { silent.close(); }
});

test('initEngine selects Rust via env when healthy, keeps demo otherwise', async () => {
  resetEngine();
  const st = await initEngine({ TF_ENGINE_BIN: process.execPath, TF_ENGINE_ARGS: STUB }, { log: () => {} });
  assert.equal(st.state, 'active'); assert.equal(st.configured, 'stdio');
  assert.equal(getEngine().info().id, 'rust:conformance-stub');
  ok('allocation', getEngine().allocate(100, { flowScale: 1, ringsActive: 1 })); // sync even when Rust is active
  resetEngine();
  const st2 = await initEngine({ TF_ENGINE_BIN: '/nonexistent/titan-engine' }, { log: () => {} });
  assert.equal(st2.state, 'unhealthy');
  assert.equal(getEngine().info().id, 'temporary-demo-adapter');
  assert.match(getEngine().info().note, /unhealthy/);
  resetEngine();
  const st3 = await initEngine({ TF_ENGINE_URL: 'http://example.com/rpc' }, { log: () => {} });
  assert.equal(st3.configured, 'invalid'); assert.equal(getEngine().info().id, 'temporary-demo-adapter');
  resetEngine();
});

test('HTTP transport + conformance suite against the stub', async () => {
  const back = stub();
  const srv = http.createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const out = await back.send(JSON.parse(b), 2000);
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    assert.throws(() => new HttpTransport('http://10.0.0.1/rpc'), /loopback/);
    const r = await runConformance(new HttpTransport(`http://127.0.0.1:${srv.address().port}/rpc`), { log: () => {} });
    assert.ok(r.ok, JSON.stringify(r.results.filter((x) => !x.ok)));
    const r2 = await runConformance(stub(), { log: () => {} });
    assert.ok(r2.ok, JSON.stringify(r2.results.filter((x) => !x.ok)));
  } finally { srv.close(); back.close(); }
});
