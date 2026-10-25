import test from 'node:test';
import assert from 'node:assert/strict';
import { Entitlements, policyFromEnv, measureParticipant, measureWallet, timeWeightedUsd, statusFor, requiresPayment, ESSENTIAL, CATEGORIES, publicPolicy, checkAccess } from '../lib/entitlement/index.mjs';
import { buildLiveSnapshot } from '../lib/entitlement/live.mjs';
import { PROFILES } from '../public/domain.js';

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 24, 12);
const mk = (extra = {}) => {
  let t = T0;
  const e = new Entitlements({ policy: { ...policyFromEnv({}), ...extra }, now: () => t });
  e.setNow = (x) => { t = x; };
  return e;
};
const DECISIONS = ['essential', 'free', 'subscription', 'x402', 'deny'];

test('policy: demo default threshold is labeled as an example, env var overrides it, no onboarding minimum', () => {
  const p = policyFromEnv({});
  assert.equal(p.thresholdUsd, 50_000);
  assert.match(publicPolicy(p).thresholdLabel, /example — not an approved threshold/);
  assert.equal(publicPolicy(p).onboardingMinimumUsd, 0);
  const q = policyFromEnv({ FREE_LIQUIDITY_THRESHOLD_USD: '120000' });
  assert.equal(q.thresholdUsd, 120_000);
  assert.equal(q.thresholdSource, 'env:FREE_LIQUIDITY_THRESHOLD_USD');
  assert.equal(policyFromEnv({ FREE_LIQUIDITY_THRESHOLD_USD: 'abc' }).thresholdUsd, 50_000);
});

test('category neutrality: every category gets the identical decision at every amount', () => {
  const e = mk();
  for (const amt of [0, 100, 5_000, 49_999.99, 50_000, 50_000.01, 100_000, 1_000_000, 25_000_000]) {
    const res = CATEGORIES.map((c) => {
      const s = e.simulate({ id: `sim-n-${c.id}`, category: c.id, capitalUsd: amt });
      assert.ok(s.ok);
      const d = e.decide(s.participant.id, 'tglw.provide_liquidity');
      const prem = e.decide(s.participant.id, 'data.depth_history');
      return [s.participant.status, d.decision, d.offer?.planId ?? null, prem.decision, s.participant.qualifyingUsd].join('|');
    });
    assert.equal(new Set(res).size, 1, `amount ${amt}: ${res.join(' vs ')}`);
  }
  // The preset capital of each profile does not matter either: same amount, same answer.
  assert.equal(CATEGORIES.length, PROFILES.length);
});

test('threshold boundary: below and exactly at are free; above (after grace) is paid-plan', () => {
  const e = mk();
  const at = (amt) => { const s = e.simulate({ id: 'sim-b', category: 'retail', capitalUsd: amt }); return [s.participant.status, e.decide('sim-b', 'tglw.provide_liquidity').decision]; };
  assert.deepEqual(at(49_999), ['free', 'free']);
  assert.deepEqual(at(50_000), ['free', 'free']);
  assert.deepEqual(at(50_001), ['over', 'deny']);
  const d = e.decide('sim-b', 'tglw.provide_liquidity');
  assert.equal(d.offer.planId, 'capacity_plus');
  assert.equal(d.offer.freeCoveredUsd, 50_000);
  assert.equal(d.offer.demo, true);
  assert.match(d.offer.disclaimer, /not a live offer/);
  // Runtime demo control moves the boundary identically.
  e.setPolicy({ thresholdUsd: 60_000 });
  assert.equal(e.describe('sim-b').status, 'free');
});

test('grace period: crossing starts grace (still free); plan applies only after sustained grace; dips restore free', () => {
  const e = mk({ graceHours: 72 });
  e.upsert({ id: 'sim-g', category: 'family_office', mode: 'SIMULATION' });
  const w = (usd) => [{ address: 'g1', balances: { USD_SIM: usd }, offers: [{ asset: 'USD_SIM', amount: usd }] }];
  e.record('sim-g', { wallets: w(10_000), prices: { USD_SIM: 1 }, at: T0 - 48 * H });
  e.setNow(T0);
  e.record('sim-g', { wallets: w(500_000), prices: { USD_SIM: 1 }, at: T0 });
  // Spike: TWA over 24h at the instant of the spike is still the old level (spike has no duration yet).
  assert.equal(e.describe('sim-g').status, 'free');
  e.setNow(T0 + 2 * H);
  let d = e.describe('sim-g');
  assert.equal(d.status, 'grace');
  assert.equal(e.decide('sim-g', 'tglw.provide_liquidity').decision, 'free');
  e.setNow(T0 + 60 * H);
  assert.equal(e.describe('sim-g').status, 'grace');
  e.setNow(T0 + 2 * H + 72 * H + 1);
  assert.equal(e.describe('sim-g').status, 'over');
  assert.equal(e.decide('sim-g', 'tglw.provide_liquidity').decision, 'deny');
  // Volatility down: immediately free again, and crossing again restarts the grace clock.
  e.record('sim-g', { wallets: w(0), prices: { USD_SIM: 1 }, at: T0 + 75 * H });
  e.setNow(T0 + 100 * H);
  assert.equal(e.describe('sim-g').status, 'free');
  assert.deepEqual(statusFor({ qualifyingUsd: 2, thresholdUsd: 1, aboveSince: null, now: 0, graceHours: 1 }).status, 'grace');
});

test('time-weighted average', () => {
  const s = [{ at: 0, usd: 0 }, { at: 12 * H, usd: 100 }];
  assert.equal(timeWeightedUsd(s, { now: 24 * H, windowHours: 24 }), 50);
  assert.equal(timeWeightedUsd([], { now: 1 }), 0);
});

test('linked-account aggregation: splitting wallets cannot multiply the free allowance', () => {
  const e = mk();
  const one = e.simulate({ id: 'sim-one', category: 'pro_mm', capitalUsd: 200_000, linkedWallets: 1 });
  const ten = e.simulate({ id: 'sim-ten', category: 'pro_mm', capitalUsd: 200_000, linkedWallets: 10 });
  assert.equal(ten.demonstrations.linkedAccounts.everyWalletBelowThreshold, true);
  assert.equal(ten.participant.qualifyingUsd, one.participant.qualifyingUsd);
  assert.equal(ten.participant.status, 'over');
  // Organization-level linking across participant records.
  e.simulate({ id: 'sim-orgA', category: 'institutional', capitalUsd: 30_000 });
  e.simulate({ id: 'sim-orgB', category: 'institutional', capitalUsd: 30_000 });
  assert.equal(e.describe('sim-orgA').status, 'free');
  e.upsert({ id: 'sim-orgA', orgId: 'acme' });
  e.upsert({ id: 'sim-orgB', orgId: 'acme' });
  e.setNow(T0 + 100 * H);
  const a = e.describe('sim-orgA');
  assert.equal(a.qualifyingUsd, 60_000);
  assert.notEqual(a.status, 'free');
  // Listing the same wallet twice is ignored.
  const m = measureParticipant([{ address: 'x', balances: { A: 10 }, offers: [{ asset: 'A', amount: 10 }] }, { address: 'x', balances: { A: 10 }, offers: [{ asset: 'A', amount: 10 }] }], { A: 1 });
  assert.equal(m.usd, 10);
  assert.deepEqual(m.duplicateWalletsIgnored, ['x']);
});

test('overlapping offers backed by one inventory count once; unrelated assets and own-quoted tokens excluded', () => {
  const e = mk();
  const s = e.simulate({ id: 'sim-ov', category: 'adv_retail', capitalUsd: 30_000, overlappingOffers: 5 });
  assert.equal(s.demonstrations.overlappingOffers.naiveOfferedUsd, 150_000);
  assert.equal(s.participant.qualifyingUsd, 30_000);
  assert.equal(s.participant.status, 'free');
  const w = measureWallet({ address: 'a', balances: { XRP: 100, TOK: 1e9, IDLE: 5 }, offers: [{ asset: 'XRP', amount: 80 }, { asset: 'XRP', amount: 80 }, { asset: 'TOK', amount: 1e9 }], other: { 'TOK supply': 1e12 } }, { XRP: 2, TOK: null, IDLE: 1 });
  const xrp = w.assets.find((a) => a.asset === 'XRP');
  assert.equal(xrp.counted, 100); assert.equal(xrp.overlapExcluded, 60);
  assert.equal(w.usd, 200); // TOK has no independent valuation; IDLE backs no offer
  assert.ok(w.excluded.some((x) => x.asset === 'IDLE'));
  assert.ok(w.excluded.some((x) => x.asset === 'TOK supply'));
});

test('essential functions always allowed — over threshold, unpaid, x402 disabled, Tier 3 denied', () => {
  const e = mk();
  e.simulate({ id: 'sim-ess', category: 'institutional', capitalUsd: 900_000_000 });
  e.upsert({ id: 'sim-ess', x402Eligible: false, subscription: null });
  assert.equal(e.describe('sim-ess').status, 'over');
  assert.equal(e.decide('sim-ess', 'tglw.provide_liquidity').decision, 'deny');
  assert.equal(e.decide('sim-ess', 'data.depth_history').decision, 'deny');
  assert.equal(e.decide('sim-ess', 'tglb.tier3.vault').decision, 'deny');
  for (const r of ESSENTIAL) {
    const d = e.decide('sim-ess', r);
    assert.equal(d.decision, 'essential', r);
    assert.equal(requiresPayment(d), false);
  }
  assert.ok(ESSENTIAL.includes('offers.cancel') && ESSENTIAL.includes('permissions.revoke') && ESSENTIAL.includes('withdrawals.permitted') && ESSENTIAL.includes('security.warnings') && ESSENTIAL.includes('positions.view'));
  assert.equal(e.decide(null, 'positions.view').decision, 'essential');
});

test('premium decision order: free entitlement -> subscription -> x402 -> deny', () => {
  const e = mk();
  e.simulate({ id: 'sim-p', category: 'retail', capitalUsd: 1_000 });
  assert.equal(e.decide('sim-p', 'data.market_summary').decision, 'free');
  assert.equal(e.decide('sim-p', 'data.depth_history').decision, 'x402');
  e.simulate({ id: 'sim-p', category: 'retail', capitalUsd: 1_000, subscriptionPlanId: 'capacity_plus' });
  assert.equal(e.decide('sim-p', 'data.depth_history').decision, 'subscription');
  assert.equal(e.decide('sim-p', 'data.wake_signals').decision, 'x402'); // not in that plan
  e.upsert({ id: 'sim-p', x402Eligible: false });
  const d = e.decide('sim-p', 'data.wake_signals');
  assert.equal(d.decision, 'deny'); assert.match(d.reason, /essential functions are unaffected/i);
  // Over the threshold the free-included feed moves to plan/x402, but never blocks basic participation.
  e.simulate({ id: 'sim-q', category: 'retail', capitalUsd: 10_000_000 });
  assert.equal(e.decide('sim-q', 'data.market_summary').decision, 'x402');
  e.simulate({ id: 'sim-q', category: 'retail', capitalUsd: 10_000_000, subscriptionPlanId: 'capacity_plus' });
  assert.equal(e.decide('sim-q', 'data.market_summary').decision, 'subscription'); // a plan keeps everything the free tier had
  // Unlisted resources default to optional x402; anonymous callers get optional x402 for premium data.
  assert.equal(e.decide('sim-p2', 'data.something_new').decision, 'x402');
  assert.equal(e.decide(undefined, 'data.depth_history').decision, 'x402');
});

test('no double charging: only x402 decisions are chargeable; subscribed or free requests never get 402', () => {
  const e = mk();
  e.simulate({ id: 'sim-dc', category: 'pro_mm', capitalUsd: 10_000_000, subscriptionPlanId: 'capacity_unlimited' });
  for (const r of ['data.depth_history', 'data.wake_signals', 'data.anything', 'tglw.provide_liquidity']) {
    const d = e.decide('sim-dc', r);
    assert.equal(d.decision, 'subscription', r);
    assert.equal(d.charge.x402, false);
    assert.equal(requiresPayment(d), false);
  }
  e.simulate({ id: 'sim-dc2', category: 'retail', capitalUsd: 10 });
  const f = e.decide('sim-dc2', 'data.market_summary');
  assert.equal(f.decision, 'free'); assert.equal(f.charge.x402, false);
  const x = e.decide('sim-dc2', 'data.depth_history');
  assert.equal(x.charge.x402, true); assert.equal(x.charge.billed, false);
  for (const d of [f, x]) assert.ok(DECISIONS.includes(d.decision));
});

test('Tier separation: Tier 1/2 funding never billed; Tier 3 needs underwriting and no plan grants it', () => {
  const e = mk();
  e.simulate({ id: 'sim-t', category: 'family_office', capitalUsd: 999_000_000, subscriptionPlanId: 'capacity_unlimited' });
  const t1 = e.decide('sim-t', 'tglb.tier1.fund'), t2 = e.decide('sim-t', 'tglb.tier2.commit');
  assert.equal(t1.decision, 'free'); assert.equal(t1.billing, 'separate-funding-arrangement');
  assert.equal(t2.decision, 'free');
  const t3 = e.decide('sim-t', 'tglb.tier3.vault');
  assert.equal(t3.decision, 'deny'); assert.match(t3.reason, /underwriting/);
  e.upsert({ id: 'sim-t', underwriting: { approved: true } });
  assert.equal(e.decide('sim-t', 'tglb.tier3.vault').decision, 'free');
  e.upsert({ id: 'sim-t', permittedTiers: ['T1'] });
  assert.equal(e.decide('sim-t', 'tglb.tier2.commit').decision, 'deny');
  // Same answers for a tiny participant: funding arrangements don't depend on size.
  e.simulate({ id: 'sim-t2', category: 'retail', capitalUsd: 1 });
  assert.equal(e.decide('sim-t2', 'tglb.tier1.fund').decision, 'free');
  assert.equal(e.decide('sim-t2', 'tglb.tier3.vault').decision, 'deny');
});

test('capital never overrides authorization, delegation, limits or confidentiality', () => {
  const e = mk();
  e.simulate({ id: 'sim-big', category: 'institutional', capitalUsd: 25_000_000, subscriptionPlanId: 'capacity_unlimited' });
  e.upsert({ id: 'sim-big', underwriting: { approved: true }, delegates: [{ address: 'rDelegate', allowed: ['positions.view', 'tglw.provide_liquidity'], maxAmountXrp: 5 }] });
  e.simulate({ id: 'sim-other', category: 'retail', capitalUsd: 10 });
  // Stranger acting on the big participant's account.
  for (const r of ['offers.cancel', 'tglw.provide_liquidity', 'data.depth_history', 'tglb.tier3.vault']) assert.equal(e.decide('sim-big', r, { actorAddress: 'rStranger' }).decision, 'deny', r);
  // Delegate restrictions.
  assert.equal(e.decide('sim-big', 'positions.view', { actorAddress: 'rDelegate' }).decision, 'essential');
  assert.equal(e.decide('sim-big', 'withdrawals.permitted', { actorAddress: 'rDelegate' }).decision, 'deny');
  assert.equal(e.decide('sim-big', 'permissions.revoke', { actorAddress: 'sim-big-wallet-1' }).decision, 'essential');
  // Confidential data boundary.
  assert.equal(e.decide('sim-big', 'records.view', { targetParticipantId: 'sim-other' }).decision, 'deny');
  assert.equal(e.decide('sim-big', 'records.view', { targetParticipantId: 'sim-big' }).decision, 'essential');
  // Guardian transaction limits still apply to live essential transactions.
  e.upsert({ id: 'live-x', category: 'institutional', mode: 'LIVE_TESTNET', wallets: [{ address: 'rLiveX', balances: {}, offers: [] }] });
  const w = e.decide('live-x', 'withdrawals.permitted', { role: 'maker', amountXrp: 500 });
  assert.equal(w.decision, 'deny'); assert.match(w.reason, /Guardian/);
  assert.equal(e.decide('live-x', 'withdrawals.permitted', { role: 'maker', amountXrp: 1 }).decision, 'essential');
  assert.equal(e.decide('live-x', 'offers.cancel', { role: 'outsider' }).decision, 'deny');
});

test('live vs simulated strictly separate', () => {
  const e = mk();
  e.simulate({ id: 'sim-s', category: 'retail', capitalUsd: 1_000_000_000 });
  const d = e.decide('sim-s', 'tglw.provide_liquidity', { mode: 'LIVE_TESTNET' });
  assert.equal(d.decision, 'deny'); assert.match(d.reason, /simulated capital never qualifies/);
  e.upsert({ id: 'live-m', category: 'pro_mm', mode: 'LIVE_TESTNET', wallets: [{ address: 'rM', balances: {}, offers: [] }] });
  assert.equal(e.decide('live-m', 'tglw.provide_liquidity').mode, 'LIVE_TESTNET');
  assert.equal(e.decide('sim-s', 'positions.view').mode, 'SIMULATION');
  assert.throws(() => e.upsert({ id: 'live-m', category: 'pro_mm', mode: 'SIMULATION' }), /cannot switch/);
  e.upsert({ id: 'live-m', orgId: 'mixed' });
  assert.throws(() => e.upsert({ id: 'sim-s', orgId: 'mixed' }), /share one mode/);
  assert.ok(!e.simulate({ id: 'live-fake', category: 'retail', capitalUsd: 1 }).ok);
});

test('live snapshot: XRP capped by spendable balance across books, own-quoted tokens count $0', () => {
  const ISS = 'rIss', M = 'rMaker', O = 'rOther';
  const base = { currency: 'BBL', issuer: ISS };
  const snap = buildLiveSnapshot({
    accounts: [{ address: M, xrp: 3, ownerCount: 5 }],
    lines: { [M]: [{ currency: 'BBL', account: ISS, balance: '900' }, { currency: 'LDN', account: ISS, balance: '0' }] },
    offersByBook: [
      { base, asks: [{ Account: M, TakerGets: { ...base, value: '900' }, TakerPays: '9000000', Sequence: 1 }], bids: [{ Account: M, TakerGets: '800000', TakerPays: { ...base, value: '100' }, Sequence: 2 }] },
      { base: { currency: 'LDN', issuer: ISS }, asks: [], bids: [{ Account: M, TakerGets: '1500000', TakerPays: { currency: 'LDN', issuer: ISS, value: '100' }, Sequence: 3 }] },
    ],
    reserveBaseXrp: 1, reserveIncXrp: 0.2, xrpUsd: 2, linked: [M],
  });
  const m = measureParticipant(snap.wallets, snap.prices);
  const xrp = m.wallets[0].assets.find((a) => a.asset === 'XRP');
  assert.equal(xrp.offered, 2.3); assert.equal(xrp.balance, 1); assert.equal(xrp.counted, 1);
  assert.equal(snap.prices['BBL.rIss'], null);
  assert.equal(m.usd, 2);
  // An independent bid values the token (at the bid, not the maker's own ask).
  const snap2 = buildLiveSnapshot({
    accounts: [{ address: M, xrp: 100, ownerCount: 1 }], lines: { [M]: [{ currency: 'BBL', account: ISS, balance: '10' }] },
    offersByBook: [{ base, asks: [{ Account: M, TakerGets: { ...base, value: '10' }, TakerPays: '1000000' }], bids: [{ Account: O, TakerGets: '50000', TakerPays: { ...base, value: '10' } }] }],
    reserveBaseXrp: 1, reserveIncXrp: 0.2, xrpUsd: 2, linked: [M],
  });
  assert.equal(measureParticipant(snap2.wallets, snap2.prices).usd, 10 * 0.005 * 2);
});

test('checkAccess seam keeps its signature and returns one of the five decisions', () => {
  for (const r of ['positions.view', 'data.depth_history', 'tglw.provide_liquidity', 'nope']) {
    const d = checkAccess({ participantId: 'sim-retail', resource: r, mode: 'SIMULATION' });
    assert.ok(DECISIONS.includes(d.decision)); assert.equal(typeof d.reason, 'string'); assert.equal(d.mode, 'SIMULATION');
  }
  assert.equal(checkAccess({ resource: 'data.depth_history' }).decision, 'x402');
  assert.equal(checkAccess().decision, 'x402');
});
