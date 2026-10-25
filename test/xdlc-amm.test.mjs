// XDLC corridor vs AMM simulation: AMM math, ladder, routing, tenure priority, early-exit fee, arbitrage, pause.
// Pure logic, no network (the reference service is exercised with a fake observer).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as M from '../lib/xdlc-amm/model.mjs';
import { createReferenceService, parseAmmInfo, ILLUSTRATIVE } from '../lib/xdlc-amm/reference.mjs';
import { parseParams, register } from '../lib/routes/47-xdlc-amm.mjs';
import mod from '../public/modules/47-xdlc-amm.js';
import { NAV } from '../public/shell.js';

// Mainnet XRP/RLUSD AMM shape (fee 214 = 0.214%); fixed numbers so the tests are deterministic.
const POOL = M.makePool({ xrp: 1839293.715078, rlusd: 2379857.606829642, tradingFee: 214 });
const REF = { pool: { xrp: POOL.xrp, rlusd: POOL.rlusd, tradingFee: 214 }, mode: 'MAINNET_OBSERVED' };
const close = (a, b, rel = 1e-9) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);

test('AMM: constant product with fee; k invariant (fee-adjusted equality, raw k grows)', () => {
  assert.equal(POOL.feeBps, 21.4);
  const k = POOL.xrp * POOL.rlusd, f = POOL.feeBps / 1e4;
  for (const q of [1, 1000, 50000, 400000]) {
    const c = M.ammBuyCost(POOL, q);
    close((POOL.xrp - q) * (POOL.rlusd + c * (1 - f)), k);
    const after = M.ammApply(POOL, 'buy', q);
    assert.ok(after.xrp * after.rlusd > k);
    const o = M.ammSellProceeds(POOL, q);
    close((POOL.xrp + q * (1 - f)) * (POOL.rlusd - o), k);
    const after2 = M.ammApply(POOL, 'sell', q);
    assert.ok(after2.xrp * after2.rlusd > k);
  }
  // Marginal price includes the fee and is monotone; depthAt inverts it.
  close(M.ammMarginal(POOL, 'buy', 0), M.spot(POOL) / (1 - f));
  close(M.ammMarginal(POOL, 'sell', 0), M.spot(POOL) * (1 - f));
  for (const side of ['buy', 'sell']) {
    let prev = M.ammMarginal(POOL, side, 0);
    for (const q of [100, 1000, 10000, 100000]) {
      const m = M.ammMarginal(POOL, side, q);
      assert.ok(side === 'buy' ? m > prev : m < prev); prev = m;
      close(M.ammDepthAt(POOL, side, m), q, 1e-6);
    }
  }
  assert.equal(M.ammBuyCost(POOL, POOL.xrp), Infinity);
  // Effective quote for a taker order: worse than mid by more than the fee for size > 0.
  const qt = M.ammQuote(POOL, 'buy', 10000);
  assert.ok(qt.slippageBps > POOL.feeBps);
});

test('ladder: every corridor level is >= ImprovementBps better than the AMM marginal anywhere in its band', () => {
  for (const side of ['buy', 'sell']) for (const imp of [1, 3, 20]) {
    const lad = M.buildLadder(POOL, { side, improvementBps: imp });
    assert.equal(lad.levels.length, 20);
    for (const l of lad.levels) {
      for (const q of [l.depthFromXrp, (l.depthFromXrp + l.depthToXrp) / 2, l.depthToXrp]) {
        const m = M.ammMarginal(POOL, side, q);
        const impBps = (side === 'buy' ? 1 - l.price / m : l.price / m - 1) * 1e4;
        assert.ok(impBps >= imp - 1e-9, `${side} imp ${imp} level ${l.level}: ${impBps}`);
      }
      assert.ok(side === 'buy' ? l.price < l.ammSliceAvg : l.price > l.ammSliceAvg);
    }
  }
  // ImprovementBps is clamped to [1, 20] (min 1 bp per corridor).
  assert.equal(M.buildLadder(POOL, { improvementBps: 0 }).improvementBps, 1);
  assert.equal(M.buildLadder(POOL, { improvementBps: 99 }).improvementBps, 20);
});

test('routing: never worse than AMM-only; corridor fills first while strictly better; fills conserve quantity', () => {
  for (const side of ['buy', 'sell']) for (const imp of [1, 7, 20]) for (const usd of [60, 1000, 9999, 50000, 120000, 250000]) {
    const lad = M.buildLadder(POOL, { side, improvementBps: imp });
    const q = usd / M.spot(POOL);
    const r = M.route(POOL, lad, q);
    close(r.qtyXrp, q, 1e-7);
    const sv = M.savings(POOL, side, r);
    assert.ok(sv.savedRlusd >= -1e-9, `${side} ${imp} ${usd}: ${sv.savedRlusd}`);
    close(r.corridorQtyXrp + r.ammQtyXrp, r.qtyXrp, 1e-7);
    for (const leg of r.legs.filter((l) => l.venue === 'corridor')) close(leg.fills.reduce((s, f) => s + f.qtyXrp, 0), leg.qtyXrp, 1e-9);
  }
  // A small order is filled entirely by corridor level 0 and saves at least ImprovementBps.
  const lad = M.buildLadder(POOL, { side: 'buy', improvementBps: 1 });
  const r = M.route(POOL, lad, 500 / M.spot(POOL));
  assert.equal(r.legs[0].venue, 'corridor'); assert.equal(r.legs[0].level, 0); assert.equal(r.ammQtyXrp, 0);
  assert.ok(M.savings(POOL, 'buy', r).savedBps >= 1);
  // With an empty corridor (paused) routing equals AMM-only.
  const p = M.route(POOL, M.buildLadder(POOL, { paused: true }), 10000);
  close(p.amountRlusd, M.ammBuyCost(POOL, 10000)); assert.equal(p.corridorQtyXrp, 0);
});

test('tenure priority: oldest provider fills first at a level, up to MaxPerLevel', () => {
  const ord = M.byTenure(M.DEFAULT_PROVIDERS).map((p) => p.id);
  assert.deepEqual(ord, ['ghost', 't2a', 't2b', 't1', 'org']);
  const lad = M.buildLadder(POOL, { side: 'buy', improvementBps: 1 });
  const mid = M.spot(POOL);
  // $1,200 at level 0: Titan Ghost's $1,000 max fills first, then Tier 2 A gets the remaining $200; nobody else.
  const r = M.route(POOL, lad, 1200 / mid);
  const fills = r.legs[0].fills;
  assert.deepEqual(fills.map((f) => f.providerId), ['ghost', 't2a']);
  close(fills[0].qtyXrp * mid, 1000, 1e-9); close(fills[1].qtyXrp * mid, 200, 1e-9);
  const pnl = M.providerPnl(lad, r);
  assert.deepEqual(pnl.rows.map((x) => x.priority), [1, 2, 3, 4, 5]);
  assert.ok(pnl.rows[0].spreadCapturedRlusd > 0 && pnl.rows[2].filledXrp === 0);
  // A newer provider with an earlier joinedDay jumps ahead.
  const prov = [...M.DEFAULT_PROVIDERS, { id: 'early', kind: 'org', name: 'Early org', joinedDay: -10, seq: 9, capitalUsd: 5000, maxPerLevelUsd: 300, minRateBps: 0 }];
  assert.equal(M.byTenure(prov)[0].id, 'early');
  // MinRate: a provider requiring more spread than the level offers is skipped at that level.
  const hi = M.buildLadder(POOL, { side: 'buy', improvementBps: 20 }); // level-0 spread ≈ 21.4 − 20 = 1.4 bps
  assert.equal(hi.levels[0].offers.length, 0);
  assert.ok(hi.levels[1].offers.length > 0);
});

test('early exit: prorated fee, capped at withdrawn × ExitFeeBps, zero after term', () => {
  const f = (d) => M.earlyExitFee({ withdrawnUsd: 10000, exitFeeBps: 200, termDays: 90, exitDay: d });
  assert.equal(f(45).feeUsd, 100); assert.equal(f(45).remainingDays, 45);
  assert.equal(f(0).feeUsd, 200); assert.equal(f(-30).feeUsd, 200); // cap: remaining never exceeds the term
  assert.equal(f(90).feeUsd, 0); assert.equal(f(120).feeUsd, 0);
  close(f(30).feeUsd, 133.333333, 1e-9);
  for (let d = 0; d <= 90; d++) assert.ok(f(d).feeUsd <= f(d).maxFeeUsd && f(d).feeUsd >= 0);
});

test('early exit: fees go to stayers only, weighted by tenure, and sum exactly to the fee', () => {
  const x = M.exitDemo({ exitDay: 45 });
  assert.equal(x.feeUsd, 100);
  const ids = x.distribution.shares.map((s) => s.id);
  assert.ok(!ids.includes('t2b')); assert.deepEqual(ids, ['ghost', 't2a', 't1', 'org']);
  close(x.distribution.distributedUsd, 100, 1e-12);
  // Weights: tenure days 45, 45, 33, 15.
  const sh = Object.fromEntries(x.distribution.shares.map((s) => [s.id, s.shareUsd]));
  assert.ok(sh.ghost > sh.t1 && sh.t1 > sh.org); close(sh.ghost, sh.t2a, 1e-6);
  for (const fee of [0.000001, 0.01, 1, 33.333333, 1e6]) {
    const d = M.distributeExitFee(fee, M.DEFAULT_PROVIDERS, { exitId: 't2a', day: 7 });
    const sum = Math.round(d.shares.reduce((s, z) => s + z.shareUsd * 1e6, 0));
    assert.equal(sum, Math.round(fee * 1e6));
  }
  // Nobody stays: no fee distributed (and nothing is invented).
  const solo = M.distributeExitFee(50, [M.DEFAULT_PROVIDERS[1]], { exitId: 't2a', day: 10 });
  assert.equal(solo.shares.length, 0); assert.equal(solo.distributedUsd, 0);
});

test('arbitrage: deterministic; corridor absorbs the first part; protocol pause and provider software cap the loss', () => {
  const a1 = M.arbitrageComparison(POOL, { jumpPct: 3 }), a2 = M.arbitrageComparison(POOL, { jumpPct: 3 });
  assert.deepEqual(a1, a2);
  const { none, pause, pauseSoftware: both } = a1.variants;
  assert.ok(none.corridorMtmLossRlusd > 0);
  assert.ok(pause.corridorMtmLossRlusd < none.corridorMtmLossRlusd);
  assert.ok(both.corridorMtmLossRlusd <= pause.corridorMtmLossRlusd);
  assert.ok(none.steps[0].corridorXrp > 0); // the first step hits the corridor
  // No oracle in the protocol: without provider software, MinRate stays static at the pre-jump reference.
  for (const v of [none, pause]) for (const st of v.steps) assert.equal(st.minRateRef, none.mid0);
  assert.equal(both.steps[0].minRateRef, both.mid0); assert.equal(both.steps[1].minRateRef, both.fairPrice);
  assert.match(both.protectionLabel, /off-ledger/); assert.match(a1.note, /No oracle/);
  assert.ok(!/oracle/i.test(JSON.stringify(a1.labels)));
  // After arbitrage the AMM's marginal price is (about) the external price.
  for (const v of [none, pause, both]) close(v.ammSpotAfter / (1 - POOL.feeBps / 1e4) / v.fairPrice, 1, 0.002);
  // Down move: arbitrageur sells; same protections apply.
  const d = M.arbitrageComparison(POOL, { jumpPct: -3 });
  assert.equal(d.variants.none.side, 'sell');
  assert.ok(d.variants.pauseSoftware.corridorMtmLossRlusd < d.variants.none.corridorMtmLossRlusd);
});

test('pause: no corridor fills once AMM spot has moved more than PauseBps from the reference', () => {
  const v = M.arbitrage(POOL, { jumpPct: 5, protections: 'pause', pauseBps: 40 });
  assert.ok(v.pausedAtStep != null);
  for (const s of v.steps) {
    if (s.moveBps > 40) { assert.equal(s.paused, true); assert.equal(s.corridorXrp, 0); }
    if (s.step < v.pausedAtStep) assert.equal(s.paused, false);
  }
  // A huge pause threshold never pauses.
  assert.equal(M.arbitrage(POOL, { jumpPct: 3, protections: 'pause', pauseBps: 1e6 }).pausedAtStep, null);
});

test('simulate + seeded flow: deterministic, labeled, no hashes or live claims', () => {
  const a = M.simulate(REF, { sizeUsd: 25000, improvementBps: 2, scenario: 'flow', seed: 42 });
  const b = M.simulate(REF, { sizeUsd: 25000, improvementBps: 2, scenario: 'flow', seed: 42 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(M.seededFlow(POOL, { seed: 1 }).orders, M.seededFlow(POOL, { seed: 2 }).orders);
  assert.equal(a.mode, 'SIMULATION'); assert.equal(a.inputs.pool.mode, 'MAINNET_OBSERVED');
  const s = JSON.stringify(a);
  assert.ok(!/LIVE_TESTNET|"hash"|fillHash/.test(s));
  assert.ok(a.flow.takerSavedRlusd > 0);
  for (const z of a.sizes) assert.ok(z.savedBps >= 0);
  close(a.savings.fromImprovementRlusd + a.savings.fromAddedDepthRlusd, a.savings.savedRlusd, 1e-9);
  close(a.savings.fromImprovementBps + a.savings.fromAddedDepthBps, a.savings.savedBps, 1e-9);
  assert.match(a.savings.labels.addedDepth, /illustrative providers \(amounts are hypothetical\)/);
  // The rule's own part is ImprovementBps on the corridor's share (never more than ImprovementBps overall).
  assert.ok(a.savings.fromImprovementBps <= a.params.improvementBps + 1e-9);
});

test('reference: parses amm_info, caches with timestamp, falls back honestly', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xa-'));
  const file = path.join(dir, 'ref.json');
  const result = { amm: { account: 'rAMM', amount: '1839293715078', amount2: { currency: 'RLUSD', issuer: 'r', value: '2379857.6' }, trading_fee: 214, lp_token: { value: '1' } }, ledger_index: 123, validated: true };
  const okObs = () => ({ request: async (r) => { assert.equal(r.command, 'amm_info'); return { result }; }, disconnect: async () => {} });
  const svc = createReferenceService({ observer: okObs, file, samplesFile: path.join(dir, 'none.json'), now: () => Date.parse('2026-10-25T12:00:00Z') });
  const r = await svc.get();
  assert.equal(r.mode, 'MAINNET_OBSERVED'); assert.equal(r.freshness, 'live'); close(r.pool.xrp, 1839293.715078); assert.equal(r.pool.feeBps, 21.4);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).observedAt, '2026-10-25T12:00:00.000Z');
  // Live read fails -> last cached value (still MAINNET_OBSERVED, with its timestamp).
  const bad = () => ({ request: async () => { throw new Error('down'); }, disconnect: async () => {} });
  const r2 = await createReferenceService({ observer: bad, file, samplesFile: path.join(dir, 'none.json') }).get();
  assert.equal(r2.freshness, 'cached'); assert.equal(r2.mode, 'MAINNET_OBSERVED'); assert.equal(r2.observedAt, '2026-10-25T12:00:00.000Z');
  // Nothing cached -> illustrative pool, clearly labeled.
  const r3 = await createReferenceService({ observer: bad, file: path.join(dir, 'missing.json'), samplesFile: path.join(dir, 'none.json') }).get();
  assert.equal(r3.label, 'ILLUSTRATIVE'); assert.equal(r3.mode, 'SIMULATION');
  // Offline: no network, cached value relabeled REPLAY.
  const r4 = await createReferenceService({ observer: () => { throw new Error('no network allowed'); }, file, offline: true }).get();
  assert.equal(r4.mode, 'REPLAY');
  assert.equal(parseAmmInfo({}), null); assert.equal(ILLUSTRATIVE.pool.tradingFee, 200);
});

test('route: GET-only endpoints, param clamping, reference injected', async () => {
  const routes = {};
  const app = { get: (p, h) => { routes[p] = h; }, post: () => { throw new Error('no POST routes'); } };
  const ref = { get: async () => ({ ...REF, label: 'MAINNET_OBSERVED', freshness: 'live', observedAt: '2026-10-25T12:00:00Z' }) };
  let out;
  register(app, { json: (res, status, body) => { out = { status, body }; }, xdlcAmmReference: ref });
  assert.deepEqual(Object.keys(routes).sort(), ['/api/xdlc-amm/reference', '/api/xdlc-amm/scenarios', '/api/xdlc-amm/simulate']);
  await routes['/api/xdlc-amm/simulate']({}, {}, {}, undefined, new URL('http://x/api/xdlc-amm/simulate?size=5000&improvementBps=50&scenario=nope'));
  assert.equal(out.status, 200); assert.equal(out.body.params.improvementBps, 20); assert.equal(out.body.params.scenario, 'single');
  assert.equal(out.body.reference.mode, 'MAINNET_OBSERVED');
  const p = parseParams(new URLSearchParams('size=-5&improvementBps=0&seed=../../x'));
  assert.equal(p.sizeUsd, 50); assert.equal(p.improvementBps, 1); assert.equal(p.seed, 1313);
});

test('module contract + nav', () => {
  assert.equal(mod.id, 'xdlc-amm'); assert.equal(mod.title, 'XDLC Corridor vs AMM'); assert.equal(mod.order, 47);
  assert.ok(NAV.find((n) => n.key === 'xdlc').modules.includes('xdlc-amm'));
});
