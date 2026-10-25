// Stability: offline replay mode, route-loader resilience, and no network from pure logic. No network, no ledger.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns';
import { Wallet } from 'xrpl';

// Record (and refuse) every outbound connection or DNS lookup made by anything in this test file.
const attempts = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const o = typeof args[0] === 'object' && args[0] ? args[0] : { port: args[0], host: args[1] };
  attempts.push(`${o.host || o.path}:${o.port ?? ''}`);
  process.nextTick(() => this.destroy(Object.assign(new Error('network disabled in test'), { code: 'ENETUNREACH' })));
  return this;
};
const realLookup = dns.lookup;
dns.lookup = (host, opts, cb) => { attempts.push(`dns:${host}`); (typeof opts === 'function' ? opts : cb)(Object.assign(new Error('dns disabled in test'), { code: 'ENOTFOUND' })); };

let S; // server.mjs helpers
let tmp;
before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-stability-'));
  S = await import('../server.mjs');
});

test('importing server.mjs starts nothing and opens no socket', () => {
  assert.equal(typeof S.loadRoutes, 'function');
  assert.equal(S.OFFLINE, process.env.TF_OFFLINE === '1');
  assert.deepEqual(attempts, []);
});

test('offline: the locked ledger refuses every signing / network path with a clear offline error', async () => {
  const { Ledger } = await import('../lib/ledger.mjs');
  const seed = Wallet.generate().seed; // local key generation, no network
  fs.writeFileSync(path.join(tmp, 'wallets.json'), JSON.stringify({ network: 'testnet', roles: { issuer: seed, maker: seed } }), { mode: 0o600 });
  const ledger = S.lockLedgerOffline(new Ledger(tmp));
  for (const m of ['submit', 'signOffline', 'submitSigned', 'exclusive', 'launch', 'bootstrap', 'connect', 'status', 'book']) {
    await assert.rejects(() => ledger[m]('maker', { TransactionType: 'Payment' }), (e) => e.code === 'TF_OFFLINE' && /Offline replay mode/.test(e.message), m);
  }
  // Addresses only: no key material survives in the wallet objects, so nothing could sign even if a guard were bypassed.
  assert.match(ledger.wallets.maker.address, /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/);
  for (const w of Object.values(ledger.wallets)) {
    assert.deepEqual(Object.keys(w).sort(), ['address', 'classicAddress']);
    assert.ok(!JSON.stringify(w).includes(seed));
  }
  assert.deepEqual(attempts, []);
});

test('offline: guards make every xrpl Client and Wallet unable to connect or sign, and fetch loopback-only', async () => {
  class FakeClient { async connect() { return 'connected'; } async request() { return 'net'; } async submitAndWait() { return 'sent'; } async autofill() { return {}; } isConnected() { return true; } }
  class FakeWallet { sign() { return { tx_blob: 'signed' }; } }
  const seen = [];
  const scope = { fetch: async (u) => { seen.push(String(u)); return { ok: true }; } };
  S.installOfflineGuards({ Client: FakeClient, Wallet: FakeWallet, scope });
  const c = new FakeClient();
  for (const m of ['connect', 'request', 'submitAndWait', 'autofill']) await assert.rejects(() => c[m]({}), { code: 'TF_OFFLINE' });
  assert.equal(c.isConnected(), false);
  assert.throws(() => new FakeWallet().sign({}), { code: 'TF_OFFLINE' });
  await assert.rejects(() => scope.fetch('https://s.altnet.rippletest.net/'), { code: 'TF_OFFLINE' });
  await assert.rejects(() => scope.fetch('https://api.xrpl.to/x'), { code: 'TF_OFFLINE' });
  await scope.fetch('http://127.0.0.1:4131/api/health');
  assert.deepEqual(seen, ['http://127.0.0.1:4131/api/health']);
});

test('offline: live-only actions are refused before any handler runs; simulations still allowed', () => {
  const refused = [
    ['POST', '/api/launch'], ['POST', '/api/pathfinder/run'], ['POST', '/api/pathfinder/profile/refresh'],
    ['POST', '/api/x402/live/purchase'], ['POST', '/api/spokes/refresh'], ['GET', '/api/book/BBL'],
  ];
  for (const [m, p] of refused) {
    const r = S.offlineRefusal(m, p, {});
    assert.ok(r, `${m} ${p} must be refused`);
    assert.equal(r.offline, true); assert.equal(r.mode, 'REPLAY'); assert.match(r.error, /Offline replay mode/);
  }
  assert.ok(S.offlineRefusal('POST', '/api/corridor/BBL/promote', { mode: 'LIVE_TESTNET', approved: true }));
  for (const [m, p, b] of [['POST', '/api/corridor/BBL/promote', { mode: 'SIMULATION' }], ['POST', '/api/capital/inject', {}], ['POST', '/api/x402/sim/purchase', {}], ['GET', '/api/launches'], ['GET', '/api/x402/runs']]) {
    assert.equal(S.offlineRefusal(m, p, b), null, `${m} ${p} stays available`);
  }
});

test('offline: recorded LIVE_TESTNET data is relabeled REPLAY; other modes and values untouched', () => {
  const body = { mode: 'LIVE_TESTNET', runs: [{ mode: 'LIVE_TESTNET', hash: 'AB', evidence: { kind: 'LIVE_TESTNET_VALIDATED' } }, { mode: 'SIMULATION' }], label: 'LIVE_TESTNET', mainnet: { mode: 'MAINNET_OBSERVED' } };
  assert.deepEqual(S.relabelReplay(body), { mode: 'REPLAY', runs: [{ mode: 'REPLAY', hash: 'AB', evidence: { kind: 'LIVE_TESTNET_VALIDATED' } }, { mode: 'SIMULATION' }], label: 'LIVE_TESTNET', mainnet: { mode: 'MAINNET_OBSERVED' } });
});

test('offline: replay status and event seed are deterministic (recorded order and timestamps only)', async () => {
  const { Bus } = await import('../lib/store.mjs');
  const launches = [
    { id: 'b', code: 'LDN', name: 'L', status: 'live', createdAt: '2026-10-23T23:00:00Z', completedAt: '2026-10-23T23:01:00Z', steps: [{ hash: 'H3', ledger: 30 }] },
    { id: 'a', code: 'BBL', name: 'B', status: 'live', createdAt: '2026-10-23T22:00:00Z', completedAt: '2026-10-23T22:01:00Z', steps: [{ hash: 'H1', ledger: 10 }, { hash: 'H2', ledger: 20 }, { key: 'validate' }] },
    { id: 'c', code: 'BAD', name: 'X', status: 'failed', createdAt: '2026-10-23T21:00:00Z', steps: [] },
  ];
  const ledger = { wallets: { maker: { address: 'rMaker' } } };
  const a = S.replayStatus({ launches }, ledger), b = S.replayStatus({ launches: [...launches].reverse() }, ledger);
  assert.deepEqual(a, b);
  assert.equal(a.mode, 'REPLAY'); assert.equal(a.validatedLedger, 30); assert.equal(a.validatedTxCount, 3);
  assert.deepEqual(a.launches, { live: 2, failed: 1 });
  const seed = (ls) => { const bus = new Bus(); S.seedReplayEvents(bus, { launches: ls }); return bus.recent; };
  const e1 = seed(launches), e2 = seed([...launches].reverse());
  assert.deepEqual(e1, e2);
  assert.deepEqual(e1.map((e) => `${e.type}:${e.code}:${e.mode}:${e.at}`), [
    'launch.created:BBL:REPLAY:2026-10-23T22:00:00Z', 'launch.done:BBL:REPLAY:2026-10-23T22:01:00Z',
    'launch.created:LDN:REPLAY:2026-10-23T23:00:00Z', 'launch.done:LDN:REPLAY:2026-10-23T23:01:00Z',
  ]);
});

test('route loader skips a module whose import or register() throws, logs it, and loads the rest', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'routes-'));
  fs.writeFileSync(path.join(dir, '10-good.mjs'), "export function register(app) { app.get('/api/good', () => 'ok'); }");
  fs.writeFileSync(path.join(dir, '20-import-throws.mjs'), "throw new Error('boom at import');");
  fs.writeFileSync(path.join(dir, '30-no-register.mjs'), 'export const x = 1;');
  fs.writeFileSync(path.join(dir, '40-register-throws.mjs'), "export async function register() { throw new Error('boom in register'); }");
  fs.writeFileSync(path.join(dir, '50-also-good.mjs'), "export function register(app) { app.get('/api/also', () => 'ok'); }");
  fs.writeFileSync(path.join(dir, 'README.txt'), 'not a route');
  const got = [], logs = [];
  const app = { get: (p) => got.push(p), post: (p) => got.push(p) };
  const log = { log: (...a) => logs.push(['log', ...a]), error: (...a) => logs.push(['error', ...a]) };
  const r = await S.loadRoutes(dir, app, {}, log);
  assert.deepEqual(r.loaded, ['10-good.mjs', '50-also-good.mjs']);
  assert.deepEqual(r.skipped.map((s) => s.file), ['20-import-throws.mjs', '30-no-register.mjs', '40-register-throws.mjs']);
  assert.match(r.skipped[0].error, /boom at import/);
  assert.match(r.skipped[2].error, /boom in register/);
  assert.deepEqual(got, ['/api/good', '/api/also']);
  assert.equal(logs.filter(([level]) => level === 'error').length, 3);
});

test('pure logic makes no network calls (domain, guardian, capital, engine adapter, validate)', async () => {
  const before = attempts.length;
  const domain = await import('../public/domain.js');
  const { guardCheck } = await import('../lib/guardian.mjs');
  const capital = await import('../lib/capital.mjs');
  const { getEngine } = await import('../lib/engine/index.mjs');
  const { validateLaunch } = await import('../lib/validate.mjs');
  const alloc = domain.allocateRings(1_000_000);
  assert.equal(alloc.mode, 'SIMULATION');
  assert.equal(typeof domain.priceImpactBps(10_000, alloc.rings), 'number');
  assert.ok(guardCheck({ mode: 'SIMULATION', txType: 'OfferCreate', amountUsd: 100 }));
  const st = capital.createState();
  capital.simulateInjection(st, { profileId: 'retail', capitalUsd: 5000, marketId: 'currencies', tierId: 'T1' });
  assert.ok(capital.snapshot(st, 'currencies'));
  const eng = getEngine();
  assert.ok(eng.info().label);
  await eng.allocate(250_000, { marketId: 'currencies' });
  assert.ok(validateLaunch({ name: 'Test', code: 'TST', supply: 1000, category: 'community', consent: true }));
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(attempts.slice(before), []);
});

test.after(() => {
  net.Socket.prototype.connect = realConnect; dns.lookup = realLookup;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});
