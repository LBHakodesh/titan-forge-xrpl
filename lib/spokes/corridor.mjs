// Spokes: modeled corridor lifecycle and engine recommendation. Always SIMULATION.
// Lifecycle: DISCOVERY -> BOOTSTRAP -> REINFORCED -> MATURE -> OPTIMIZED | STANDBY (reversible; recomputed every snapshot).
// Recommendations come from the engine seam (getEngine().recommend) and are advisory only: nothing is allocated, and the
// modeled notional per spoke is derived from each spoke's own observed depth (never equal capital across spokes).
import { getEngine } from '../engine/index.mjs';
import { depthAt } from './market.mjs';

export const LIFECYCLE = ['DISCOVERY', 'BOOTSTRAP', 'REINFORCED', 'MATURE', 'OPTIMIZED', 'STANDBY'];
export const STAGE_RULES = { reinforcedDepthXrp: 2_000, matureDepthXrp: 20_000, optimizedSpreadBps: 30 };
const RINGS_BY_STAGE = { DISCOVERY: 0, BOOTSTRAP: 2, REINFORCED: 3, MATURE: 6, OPTIMIZED: 6, STANDBY: 6 };
const MAX_NOTIONAL_USD = 250_000;

export function stageFor(spoke) {
  if (spoke.status === 'UNAVAILABLE') return { stage: 'DISCOVERY', why: 'No data this snapshot.' };
  if (!spoke.eligibility.eligible) return { stage: 'DISCOVERY', why: 'Failed screening; not a funding candidate.' };
  if (spoke.network === 'testnet') {
    if (!spoke.testnet?.funded) return { stage: 'DISCOVERY', why: 'Testnet token not funded.' };
    return spoke.flows.liveTestnet > 0 ? { stage: 'REINFORCED', why: `Funded Testnet book with ${spoke.flows.liveTestnet} validated demo payments (organic:false).` } : { stage: 'BOOTSTRAP', why: 'Funded Testnet book, no routed payments yet.' };
  }
  const d = Math.min(depthAt(spoke.market, 'bids', '2%'), depthAt(spoke.market, 'asks', '2%'));
  const s = spoke.market.spreadBps;
  if (d < STAGE_RULES.reinforcedDepthXrp) return { stage: 'BOOTSTRAP', why: `Thinner side within 2%: ${Math.round(d)} XRP.` };
  if (d < STAGE_RULES.matureDepthXrp) return { stage: 'REINFORCED', why: `Thinner side within 2%: ${Math.round(d)} XRP.` };
  if (s != null && s <= STAGE_RULES.optimizedSpreadBps) {
    return spoke.flows.mainnetObserved > 0 ? { stage: 'OPTIMIZED', why: `Deep (${Math.round(d)} XRP) and tight (${s} bps) with observed flow.` } : { stage: 'STANDBY', why: `Deep and tight but no matched payments in the scanned window.` };
  }
  return { stage: 'MATURE', why: `Deep (${Math.round(d)} XRP within 2%), spread ${s ?? 'n/a'} bps.` };
}

// Modeled notional (USD) used only as engine input for comparison. Proportional to observed depth; 0 if ineligible.
export function modeledNotionalUsd(spoke, xrpUsd) {
  if (!spoke.eligibility.eligible || spoke.status === 'UNAVAILABLE') return 0;
  const d = depthAt(spoke.market, 'bids', '2%') + depthAt(spoke.market, 'asks', '2%');
  const usd = d * (xrpUsd || 1) * 0.1;
  return Math.round(Math.min(MAX_NOTIONAL_USD, usd));
}

export function corridorFor(spokes, { xrpUsd = null, engine = getEngine() } = {}) {
  const info = engine.info();
  const markets = [];
  const stages = new Map();
  for (const s of spokes) {
    const st = stageFor(s);
    stages.set(s.id, st);
    const capitalUsd = modeledNotionalUsd(s, xrpUsd);
    if (capitalUsd > 0) {
      const vol = s.market?.vol24hXrp ?? s.flows.validated;
      markets.push({ marketId: s.id, capitalUsd, flowScale: Math.max(0.05, Math.min(3, Math.log10(1 + (vol || 0)) / 4)), ringsActive: Math.max(1, RINGS_BY_STAGE[st.stage] || 1) });
    }
  }
  let recs = [];
  try { recs = engine.recommend(markets) || []; } catch (e) { recs = []; }
  const out = new Map();
  for (const s of spokes) {
    const st = stages.get(s.id);
    const mkt = markets.find((m) => m.marketId === s.id);
    const into = recs.filter((r) => r.toMarket === s.id);
    const outOf = recs.filter((r) => r.fromMarket === s.id);
    let recommendation;
    if (!mkt) recommendation = s.eligibility.eligible ? 'Hold: no modeled notional (no measured depth).' : 'Not a funding candidate (failed screening). Monitor only.';
    else if (outOf.length) recommendation = `Engine suggests shifting ~$${outOf.reduce((x, r) => x + (r.amountUsd || 0), 0).toLocaleString('en-US')} of modeled notional elsewhere. ${outOf[0].rationale}`;
    else if (into.length) recommendation = `Engine ranks this spoke highest on marginal modeled yield (${into.length} spoke(s) would shift modeled notional here).`;
    else recommendation = 'Hold modeled notional; no reallocation suggested.';
    out.set(s.id, {
      stage: st.stage, stageReason: st.why, recommendation: `${recommendation} Advisory only: nothing is allocated automatically.`,
      mode: 'SIMULATION', engineLabel: info.label, engineId: info.id,
      modeledNotionalUsd: mkt?.capitalUsd ?? 0, autoAllocate: false,
    });
  }
  return out;
}
