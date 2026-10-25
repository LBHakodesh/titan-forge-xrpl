import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, simulateInjection, simulateSequence, snapshot, earningCurve, reserveCapacity, describeState, SEQUENCE, BASE_LIQUIDITY_USD } from '../lib/capital.mjs';
import { RINGS, MARKETS, PROFILES } from '../public/domain.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);

test('allocation covers all six rings and sums to deployed; deployed + idle = total', () => {
  const r = simulateInjection(createState(), { profileId: 'family_office', marketId: 'currencies', tierId: 'T1' });
  assert.ok(r.ok);
  for (const s of [r.before, r.after]) {
    assert.equal(s.rings.length, RINGS.length);
    assert.deepEqual(s.rings.map((x) => x.id), RINGS.map((x) => x.id));
    close(s.rings.reduce((a, x) => a + x.allocUsd, 0), s.deployedUsd);
    close(s.deployedUsd + s.idleUsd, s.totalUsd);
    assert.equal(s.mode, 'SIMULATION');
  }
  close(r.after.totalUsd, BASE_LIQUIDITY_USD + 1_000_000);
  close(r.after.proprietaryShare + r.after.independentShare, 1);
});

test('state is not mutated (pure)', () => {
  const s = createState();
  const r = simulateInjection(s, { profileId: 'retail', marketId: 'securities', tierId: 'T1' });
  assert.equal(s.markets.securities.injections.length, 0);
  assert.equal(r.nextState.markets.securities.injections.length, 1);
});

test('idle: small market sits fully deployed, institutional capital in a thin market goes partly idle', () => {
  const small = snapshot(createState(), 'real_estate');
  assert.equal(small.idleUsd, 0);
  const r = simulateInjection(createState(), { profileId: 'institutional', marketId: 'real_estate', tierId: 'T1' });
  assert.ok(r.after.idleUsd > 0, 'expected idle capital');
  assert.ok(r.contribution.productiveShare < 1);
  const curve = earningCurve('real_estate');
  assert.ok(curve.productiveCapacityUsd > 0 && curve.productiveCapacityUsd < r.after.totalUsd);
  assert.ok(curve.points.some((p) => p.marginalBps === 0), 'curve should show where extra capital stops being productive');
  // Marginal yield is (weakly) diminishing along the curve.
  assert.ok(curve.points[0].marginalBps >= curve.points.at(-1).marginalBps);
});

test('tier is independent of participant size: same allocation for every tier', () => {
  const allocs = ['T1', 'T2', 'T3'].map((tierId) => simulateInjection(createState(), { profileId: 'pro_mm', marketId: 'precious_metals', tierId }).after.rings.map((x) => x.allocUsd));
  assert.deepEqual(allocs[0], allocs[1]);
  assert.deepEqual(allocs[0], allocs[2]);
  // Any tier works with any size.
  for (const p of PROFILES) assert.ok(simulateInjection(createState(), { profileId: p.id, marketId: 'currencies', tierId: 'T3' }).ok);
  const t2 = simulateInjection(createState(), { profileId: 'retail', marketId: 'currencies', tierId: 'T2' });
  assert.equal(t2.after.sentinel.delegation[0].tierId, 'T2');
  const t1 = simulateInjection(createState(), { profileId: 'retail', marketId: 'currencies', tierId: 'T1' });
  assert.equal(t1.after.sentinel.delegation.length, 0);
});

test('concentration: HHI and systemic-risk flag when one participant > 50%', () => {
  const retail = simulateInjection(createState(), { profileId: 'retail', marketId: 'currencies', tierId: 'T1' });
  assert.equal(retail.after.sentinel.systemicRisk, false);
  const inst = simulateInjection(retail.nextState, { profileId: 'institutional', marketId: 'currencies', tierId: 'T1' });
  assert.equal(inst.after.sentinel.systemicRisk, true);
  assert.ok(inst.after.sentinel.topParticipant.share > 0.5);
  assert.equal(inst.after.sentinel.topParticipant.capitalUsd, 25_000_000);
  assert.ok(inst.after.sentinel.hhi > 5000 && inst.after.sentinel.hhi <= 10000);
  // Base-only market: HHI 10000 (one provider) but no independent-participant flag.
  const base = snapshot(createState(), 'currencies');
  assert.equal(base.sentinel.hhi, 10000);
  assert.equal(base.sentinel.systemicRisk, false);
});

test('Guardian rejects out-of-range or invalid amounts and unknown markets', () => {
  for (const capitalUsd of [0, -5, 2_000_000_000, 'abc']) {
    const r = simulateInjection(createState(), { profileId: 'retail', marketId: 'currencies', tierId: 'T1', capitalUsd });
    assert.equal(r.ok, false, `amount ${capitalUsd}`);
    assert.equal(r.guardian.allowed, false);
  }
  const bad = simulateInjection(createState(), { profileId: 'retail', marketId: 'mars', tierId: 'T1' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /Unknown market/.test(e)));
  assert.equal(simulateInjection(createState(), { profileId: 'whale', marketId: 'currencies', tierId: 'T1' }).ok, false);
  assert.equal(simulateInjection(createState(), { profileId: 'retail', marketId: 'currencies', tierId: 'T9' }).ok, false);
  const ok = simulateInjection(createState(), { profileId: 'retail', marketId: 'currencies', tierId: 'T1', capitalUsd: 1234 });
  assert.ok(ok.ok && ok.guardian.allowed);
  assert.equal(ok.injection.capitalUsd, 1234, 'manual override');
});

test('sequence runs retail -> institutional in order into one market', () => {
  const s0 = simulateInjection(createState(), { profileId: 'pro_mm', marketId: 'securities', tierId: 'T1' }).nextState;
  const r = simulateSequence(s0, { marketId: 'securities', tierId: 'T2' });
  assert.deepEqual(r.steps.map((x) => x.input.profileId), SEQUENCE);
  assert.deepEqual(SEQUENCE, PROFILES.map((p) => p.id));
  assert.ok(r.steps.every((x) => x.ok && x.input.marketId === 'securities' && x.input.tierId === 'T2'));
  for (let i = 1; i < r.steps.length; i++) close(r.steps[i].before.totalUsd, r.steps[i - 1].after.totalUsd);
  close(r.steps[0].before.totalUsd, BASE_LIQUIDITY_USD, 0); // fresh start
  assert.equal(r.nextState.markets.securities.injections.length, 5);
});

test('outputs: impact table, recommendations across four markets, engine label', () => {
  const r = simulateInjection(createState(), { profileId: 'institutional', marketId: 'real_estate', tierId: 'T1' });
  assert.deepEqual(r.after.impact.map((x) => x.sizeUsd), [1_000, 100_000, 5_000_000]);
  assert.ok(r.recommendations.items.length > 0);
  assert.ok(r.recommendations.engine.label);
  assert.ok(r.engine.label);
  const d = describeState(r.nextState);
  assert.equal(Object.keys(d.snapshots).length, MARKETS.length);
  assert.ok(JSON.stringify(d)); // serializable (no Infinity)
  assert.ok(!JSON.stringify(r).includes('Infinity'));
});

test('live reserve capacity math', () => {
  const c = reserveCapacity({ xrp: 100, ownerCount: 4, reserveBaseXrp: 1, reserveIncXrp: 0.2 });
  close(c.lockedXrp, 1.8);
  close(c.spendableXrp, 98.2);
  assert.equal(c.additionalOffers, Math.floor((98.2 - 1) / 0.2));
  assert.equal(reserveCapacity({ xrp: 1, ownerCount: 10, reserveBaseXrp: 1, reserveIncXrp: 0.2 }).additionalOffers, 0);
});
