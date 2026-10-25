// Titan View — Multi-Scale Capital Injection (pure, testable; no network, no I/O).
// Every figure produced here is SIMULATION: hypothetical capital run through the engine seam
// (today the temporary demo adapter). Nothing here is a funded balance, an investment minimum,
// an eligibility threshold, or evidence of organic demand.
import { MARKETS, RINGS, PROFILES, TIERS, MODES, priceImpactBps } from '../public/domain.js';
import { getEngine } from './engine/index.mjs';
import { guardCheck } from './guardian.mjs';

const SIM = MODES.SIM;

// Illustrative Titan Ghost proprietary base liquidity per market (labeled demo value, not a real balance).
export const BASE_LIQUIDITY_USD = 250_000;

// Illustrative modeled-demand scale per market (fed to the engine as flowScale). Demo values only.
export const MARKET_FLOW_SCALE = { currencies: 1, securities: 0.6, precious_metals: 0.4, real_estate: 0.25 };

export const SAMPLE_ORDERS_USD = [1_000, 100_000, 5_000_000];
export const SEQUENCE = ['retail', 'adv_retail', 'pro_mm', 'family_office', 'institutional'];
export const SYSTEMIC_SHARE = 0.5;

export const TIER_NOTES = {
  T1: 'Tier 1 (TGLW flexible): funds stay self-custodial and can be withdrawn; no term commitment, so this depth can leave quickly.',
  T2: 'Tier 2 (TGLW term-committed): funds stay self-custodial but quoting is delegated to Titan Ghost within Guardian limits for the committed term. Delegated authority must be monitored and revocable at term end.',
  T3: 'Tier 3 (TGLB underwritten): a separate formal credit / lending-vault pathway with underwriting. Capital is delegated under a credit agreement, which adds counterparty and credit risk that Sentinel must track separately from TGLW liquidity.',
};

export const EDUCATION = [
  'Small participants contribute meaningfully: early dollars land where modeled marginal yield is highest, and many small participants together match one large one without concentration risk.',
  'Large participants add depth and lower price impact, but they also concentrate the book. One participant above 50% of liquidity is a systemic-risk flag.',
  'More capital is not always more productive: once every ring’s modeled marginal yield falls below the hurdle, extra capital sits idle.',
  'Funding tier (T1/T2/T3) is chosen independently of participant size: a $100 participant can commit for a term and a $25M participant can stay flexible. The tier changes custody and delegation, not the modeled allocation.',
];

export const marketById = (id) => MARKETS.find((m) => m.id === id);
export const profileById = (id) => PROFILES.find((p) => p.id === id);
export const tierById = (id) => TIERS.find((t) => t.id === id);
const flowScaleOf = (marketId) => MARKET_FLOW_SCALE[marketId] ?? 1;

export function createState(baseUsd = BASE_LIQUIDITY_USD) {
  return { mode: SIM, baseUsd, seq: 0, markets: Object.fromEntries(MARKETS.map((m) => [m.id, { injections: [] }])) };
}

export function resetState(state, marketId) {
  if (!marketId) return createState(state?.baseUsd);
  return { ...state, markets: { ...state.markets, [marketId]: { injections: [] } } };
}

export const marketTotalUsd = (state, marketId) =>
  state.baseUsd + state.markets[marketId].injections.reduce((s, i) => s + i.capitalUsd, 0);

function allocate(capitalUsd, marketId) {
  return getEngine().allocate(capitalUsd, { flowScale: flowScaleOf(marketId), ringsActive: RINGS.length });
}

const finite = (x) => (Number.isFinite(x) ? x : null);

// Smallest capital at which the engine starts leaving capital idle (null if none up to maxUsd).
const capacityCache = new Map();
export function productiveCapacityUsd(marketId, maxUsd = 1_000_000_000) {
  const key = `${getEngine().info().id}|${marketId}|${maxUsd}`;
  if (capacityCache.has(key)) return capacityCache.get(key);
  let out = null;
  if (allocate(maxUsd, marketId).idleUsd > 0) {
    let lo = 1_000, hi = maxUsd;
    for (let i = 0; i < 40 && hi / lo > 1.005; i++) {
      const mid = Math.sqrt(lo * hi);
      if (allocate(mid, marketId).idleUsd > 0) hi = mid; else lo = mid;
    }
    out = Math.round(lo);
  }
  capacityCache.set(key, out);
  return out;
}

// Marginal yield (bps/day on the next dollar) vs total capital, for the earning-curve chart.
export function earningCurve(marketId, { minUsd = 1_000, maxUsd, points = 36 } = {}) {
  const cap = productiveCapacityUsd(marketId);
  const top = maxUsd ?? Math.max(50_000_000, (cap ?? 10_000_000) * 4);
  const pts = [];
  for (let i = 0; i < points; i++) {
    const c = minUsd * Math.pow(top / minUsd, i / (points - 1));
    const a = allocate(c, marketId);
    const nextMarginal = a.idleUsd > 0 ? 0 : Math.max(0, ...a.rings.map((r) => r.marginalBps));
    pts.push({ capitalUsd: c, dailyEarnUsd: a.dailyEarnUsd, marginalBps: nextMarginal,
      avgYieldBps: c ? (a.dailyEarnUsd / c) * 10_000 : 0, deployedUsd: a.deployedUsd, idleUsd: a.idleUsd });
  }
  return { mode: SIM, marketId, productiveCapacityUsd: cap, points: pts,
    note: cap ? `Beyond about $${Math.round(cap).toLocaleString('en-US')} the modeled marginal yield in every ring is below the engine hurdle, so extra capital is idle.` : 'No idle capital within the modeled range.' };
}

// Full simulated picture of one market for a given state.
export function snapshot(state, marketId) {
  const m = state.markets[marketId];
  const totalUsd = marketTotalUsd(state, marketId);
  const a = allocate(totalUsd, marketId);
  const rings = a.rings.map((r) => {
    const spec = RINGS.find((x) => x.id === r.id);
    return { id: r.id, allocUsd: r.allocUsd, depthUsd: r.allocUsd, halfSpreadBps: spec.spreadBps, dailyEarnUsd: r.dailyEarnUsd,
      marginalBps: r.marginalBps, utilization: r.utilization, shareOfDeployed: a.deployedUsd ? r.allocUsd / a.deployedUsd : 0 };
  });
  const touch = rings.find((r) => r.allocUsd >= 1_000) || rings.find((r) => r.allocUsd > 0);
  const weightedHalf = a.deployedUsd ? rings.reduce((s, r) => s + r.halfSpreadBps * r.allocUsd, 0) / a.deployedUsd : null;
  const impact = SAMPLE_ORDERS_USD.map((sizeUsd) => {
    const bps = priceImpactBps(sizeUsd, a.rings);
    return { sizeUsd, impactBps: finite(bps), exceedsDepth: !Number.isFinite(bps) };
  });
  const independentUsd = totalUsd - state.baseUsd;

  // Liquidity providers: Titan Ghost base + each independent injection (each injection = one participant).
  const providers = [{ id: 'titan_ghost_base', label: 'Titan Ghost proprietary base (illustrative)', capitalUsd: state.baseUsd, proprietary: true },
    ...m.injections.map((i) => ({ id: i.id, label: `${profileById(i.profileId)?.label ?? i.profileId} · ${i.tierId}`, capitalUsd: i.capitalUsd, tierId: i.tierId, profileId: i.profileId, proprietary: false }))];
  const shares = providers.map((p) => ({ ...p, share: totalUsd ? p.capitalUsd / totalUsd : 0 }));
  const hhi = Math.round(shares.reduce((s, p) => s + (p.share * 100) ** 2, 0));
  const indep = shares.filter((p) => !p.proprietary).sort((x, y) => y.share - x.share);
  const top = indep[0] || null;
  const outer = rings.filter((r) => r.id === 'DEEP' || r.id === 'CEILING').reduce((s, r) => s + r.allocUsd, 0);
  const turnoverUsd = a.rings.reduce((s, r) => s + r.allocUsd * (RINGS.find((x) => x.id === r.id).turnover), 0);
  const tiersPresent = [...new Set(m.injections.map((i) => i.tierId))].filter((t) => t !== 'T1');

  const sentinel = {
    mode: SIM,
    hhi, hhiBand: hhi >= 2500 ? 'highly concentrated' : hhi >= 1500 ? 'moderately concentrated' : 'unconcentrated',
    topParticipant: top ? { id: top.id, label: top.label, share: top.share, capitalUsd: top.capitalUsd } : null,
    systemicRisk: !!top && top.share > SYSTEMIC_SHARE,
    systemicNote: top && top.share > SYSTEMIC_SHARE ? `One independent participant supplies ${(top.share * 100).toFixed(1)}% of this market's liquidity (> 50%). Its withdrawal would remove most depth at once.` : null,
    inventory: { bidUsd: a.deployedUsd / 2, askUsd: a.deployedUsd / 2, outerRingShare: a.deployedUsd ? outer / a.deployedUsd : 0,
      turnDays: turnoverUsd ? a.deployedUsd / turnoverUsd : null, idleShare: totalUsd ? a.idleUsd / totalUsd : 0,
      note: 'Modeled two-sided inventory (half bid, half ask). Outer-ring capital turns slowly, so it is held as inventory longer.' },
    delegation: tiersPresent.map((t) => ({ tierId: t, note: TIER_NOTES[t] })),
  };

  return {
    mode: SIM, marketId, totalUsd, proprietaryUsd: state.baseUsd, independentUsd,
    proprietaryShare: totalUsd ? state.baseUsd / totalUsd : 0, independentShare: totalUsd ? independentUsd / totalUsd : 0,
    deployedUsd: a.deployedUsd, idleUsd: a.idleUsd, dailyEarnUsd: a.dailyEarnUsd, yieldBpsOnDeployed: a.yieldBpsOnDeployed,
    rings, touchSpreadBps: touch ? touch.halfSpreadBps * 2 : null, weightedSpreadBps: weightedHalf == null ? null : weightedHalf * 2,
    capacityUsd: a.deployedUsd, productiveCapacityUsd: productiveCapacityUsd(marketId),
    impact, participants: shares, sentinel,
  };
}

export function recommendations(state) {
  const eng = getEngine();
  const recs = eng.recommend(MARKETS.map((m) => ({ marketId: m.id, capitalUsd: marketTotalUsd(state, m.id), flowScale: flowScaleOf(m.id), ringsActive: RINGS.length })));
  return { mode: SIM, engine: eng.info(), items: recs };
}

export function validateInjection(input = {}) {
  const errors = [];
  const profile = profileById(input.profileId);
  if (!profile) errors.push(`Unknown profile ${input.profileId}.`);
  if (!tierById(input.tierId)) errors.push(`Unknown tier ${input.tierId}.`);
  const raw = input.capitalUsd ?? profile?.capitalUsd;
  const capitalUsd = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof capitalUsd !== 'number' || Number.isNaN(capitalUsd)) errors.push('capitalUsd must be a number.');
  return { errors, value: { profileId: input.profileId, tierId: input.tierId, marketId: input.marketId, capitalUsd } };
}

// Pure: never mutates `state`. Returns { ok, guardian, before, after, nextState, ... }.
export function simulateInjection(state, input) {
  const { errors, value } = validateInjection(input);
  const guardian = guardCheck({ mode: SIM, amountUsd: Number.isFinite(value.capitalUsd) ? value.capitalUsd : NaN, marketId: value.marketId });
  if (!value.marketId) guardian.reasons.push('marketId is required.'), (guardian.allowed = false);
  if (errors.length || !guardian.allowed) {
    return { ok: false, mode: SIM, errors: [...errors, ...guardian.reasons], guardian: { ...guardian, allowed: false }, input: value, nextState: state };
  }
  const { marketId, profileId, tierId, capitalUsd } = value;
  const before = snapshot(state, marketId);
  const injection = { id: `inj-${state.seq + 1}`, profileId, tierId, capitalUsd, at: new Date().toISOString(), mode: SIM };
  const nextState = { ...state, seq: state.seq + 1, markets: { ...state.markets, [marketId]: { injections: [...state.markets[marketId].injections, injection] } } };
  const after = snapshot(nextState, marketId);
  const deltaEarn = after.dailyEarnUsd - before.dailyEarnUsd;
  const contribution = {
    deltaDeployedUsd: after.deployedUsd - before.deployedUsd,
    deltaIdleUsd: after.idleUsd - before.idleUsd,
    deltaDailyEarnUsd: deltaEarn,
    incrementalYieldBps: (deltaEarn / capitalUsd) * 10_000,
    productiveShare: capitalUsd ? Math.max(0, Math.min(1, (after.deployedUsd - before.deployedUsd) / capitalUsd)) : 0,
    retailEquivalents: capitalUsd / PROFILES[0].capitalUsd,
    shareOfMarket: capitalUsd / after.totalUsd,
  };
  return {
    ok: true, mode: SIM, injection, input: value, profile: profileById(profileId), tier: tierById(tierId), market: marketById(marketId),
    tierNote: TIER_NOTES[tierId], guardian, before, after, contribution,
    earningCurve: earningCurve(marketId), recommendations: recommendations(nextState), engine: getEngine().info(), nextState,
  };
}

// Retail -> institutional into one market. Pure; returns each step in order.
export function simulateSequence(state, { marketId, tierId = 'T1', fresh = true } = {}) {
  let s = fresh ? resetState(state, marketId) : state;
  const steps = [];
  for (const profileId of SEQUENCE) {
    const r = simulateInjection(s, { profileId, marketId, tierId });
    steps.push(r);
    if (!r.ok) break;
    s = r.nextState;
  }
  return { mode: SIM, marketId, tierId, steps, nextState: s };
}

// Public view of state (all markets) for GET /state.
export function describeState(state) {
  return {
    mode: SIM, baseUsd: state.baseUsd, baseNote: 'Illustrative Titan Ghost proprietary base liquidity per market (demo value, not a real balance).',
    profiles: PROFILES.map((p) => ({ ...p, note: 'Demonstration preset only: not an investment minimum, eligibility threshold or funded balance.' })),
    tiers: TIERS.map((t) => ({ ...t, note: TIER_NOTES[t.id] })), markets: MARKETS, flowScale: MARKET_FLOW_SCALE, sampleOrdersUsd: SAMPLE_ORDERS_USD,
    education: EDUCATION, engine: getEngine().info(),
    snapshots: Object.fromEntries(MARKETS.map((m) => [m.id, { ...snapshot(state, m.id), injections: state.markets[m.id].injections }])),
    curves: Object.fromEntries(MARKETS.map((m) => [m.id, earningCurve(m.id)])),
    recommendations: recommendations(state),
  };
}

// LIVE_TESTNET reserve math from server_info + account_info (pure helper for the read-only route).
export function reserveCapacity({ xrp, ownerCount, reserveBaseXrp, reserveIncXrp, feeBufferXrp = 1 }) {
  const lockedXrp = reserveBaseXrp + ownerCount * reserveIncXrp;
  const spendableXrp = Math.max(0, xrp - lockedXrp);
  const additionalOffers = reserveIncXrp > 0 ? Math.max(0, Math.floor((spendableXrp - feeBufferXrp) / reserveIncXrp)) : null;
  return { xrp, ownerCount, lockedXrp, spendableXrp, additionalOffers, feeBufferXrp };
}
