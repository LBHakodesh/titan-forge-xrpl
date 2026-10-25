// TG Intelligence Opportunity Radar (demo adapter). Pure, deterministic, no network.
//
// Scores candidate XRP-connected markets on observed liquidity need (MAINNET_OBSERVED / LIVE_TESTNET where we have data)
// and on an explicitly named economic model (SIMULATION) for the forecast part. A thin market is NOT automatically
// profitable: the modeled net benefit after deployment costs can be negative, and such markets rank below every
// market with a positive modeled net benefit.
//
// This is a TEMPORARY DEMO ADAPTER, not proprietary TG Intelligence and not running on Mainnet. Titan Forge holds no
// Mainnet accounts; Mainnet figures are read-only observations of third-party liquidity. XDLC is a PROPOSED amendment:
// the corridor lifecycle that consumes this ranking is Titan Ghost application logic.
import { MODES } from '../../public/domain.js';
import { getEngine } from '../engine/index.mjs';
import { REF_TRADE_XRP } from '../demand.mjs';
import { RADAR_RULES } from '../incubator/program.mjs';
import { PROPRIETARY_BUDGET_USD, DEMO_INTAKES } from '../incubator/demo.mjs';

export const ORIGINS = ['RADAR_DISCOVERED', 'PROJECT_REQUESTED'];
export const ADAPTER_NOTE = 'Demo adapter: illustrative scoring over observed data plus a named SIMULATION model. Not proprietary TG Intelligence; not running on Mainnet; no capital is allocated.';

// ---------- Named economic model (all assumptions surfaced in every response) ----------
export const MODEL = Object.freeze({
  name: 'TG-RADAR-NETBENEFIT-v1 (demo)',
  horizonDays: 30,
  assumptions: Object.freeze({
    targetSideDepthXrp: RADAR_RULES.lowDepthXrp2pct, // funded depth per side within ±2% we would want to reach
    minDeployXrp: 20_000, // smallest two-sided deployment worth operating (≈ 6 rings × 2 sides of meaningful size)
    volumeQualityHaircut: 0.5, // provider 24h volume is discounted 50% (bots / wash / self-trades)
    ammFlowTakeShare: 0.5, // fraction of the AMM share of depth assumed to take flow before our offers
    maxCaptureShare: 0.5,
    spreadCapBps: 200, // spreads above this are assumed to compress once depth arrives
    spreadRealization: 0.4, // fraction of the half-spread kept after adverse selection and competition
    setupCostUsd: 1_500, // same defaults as the incubator interim model (simulateInterim)
    opsCostUsdPerMonth: 750,
    capitalCostAnnual: 0.05, // opportunity cost of proprietary capital
    inventoryRiskFactor: 0.1, // expected adverse inventory drift = deploy × dailyVolProxy × √horizon × factor
    dailyVolProxyFromSpread: 0.5, // daily volatility proxy = clamp(spread × 0.5, 0.05%, 2%)
    offersPerDeployment: 12, // 6 rings × 2 sides
    ownerReserveXrpPerOffer: 0.2, // locked, released on cancel: never counted as profit or cost
    feeXrpPerTx: 0.000012,
    requotesPerOfferPerDay: 96,
    scenarios: { low: { capture: 0.5, risk: 1.5 }, base: { capture: 1, risk: 1 }, high: { capture: 1.5, risk: 0.75 } },
    impactModel: 'linear-band: impact(bps) = 200 × size / funded depth within the 2% band on that side (capped 10,000)',
  }),
});

// Factor weights. Positive = opportunity, negative = penalty. Each contribution = weight × norm (norm in [0,1],
// except net_benefit which is signed in [-1,1]). Score = 100 × Σ contributions.
export const FACTORS = Object.freeze([
  { id: 'thin_liquidity', label: 'Thin liquidity', weight: 0.06 },
  { id: 'funded_depth_gap', label: 'Inadequate funded depth', weight: 0.06 },
  { id: 'wide_spread', label: 'Wide spread', weight: 0.05 },
  { id: 'price_impact', label: 'Price impact', weight: 0.05 },
  { id: 'missing_paths', label: 'Missing payment paths (NO_PATH)', weight: 0.05 },
  { id: 'bridge_leg_underfunded', label: 'Underfunded XRP bridge leg', weight: 0.05 },
  { id: 'maker_concentration', label: 'Maker concentration (HHI)', weight: 0.03 },
  { id: 'market_demand', label: 'Market demand', weight: 0.10 },
  { id: 'amm_competition', label: 'AMM competition', weight: -0.07 },
  { id: 'issuer_risk', label: 'Issuer risk', weight: -0.12 },
  { id: 'net_benefit', label: 'Expected marginal economic benefit (net of costs)', weight: 0.30 },
  { id: 'capital_fit', label: 'Available capital fit', weight: 0.04 },
  { id: 'deployment_cost', label: 'Deployment costs', weight: -0.04 },
]);

const clamp01 = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const r0 = (x) => (Number.isFinite(x) ? Math.round(x) : null);
const band = (m, side, b = '2%') => m?.depthXrp?.[side]?.find((d) => d.band === b) || null;

export function impactBps(sizeXrp, sideDepthXrp) {
  if (!(sideDepthXrp > 0)) return 10_000;
  return Math.min(10_000, 200 * sizeXrp / sideDepthXrp);
}

// Observed market metrics from one lib/spokes spoke (MAINNET_OBSERVED or LIVE_TESTNET).
export function marketMetrics(spoke) {
  const m = spoke.market || {};
  const b = band(m, 'bids'), a = band(m, 'asks');
  const bids = b?.xrp ?? 0, asks = a?.xrp ?? 0;
  const clobB = b?.clobXrp ?? (spoke.network === 'testnet' ? bids : 0), clobA = a?.clobXrp ?? (spoke.network === 'testnet' ? asks : 0);
  const amm = (b?.ammXrp ?? 0) + (a?.ammXrp ?? 0);
  const makers = m.makers ? (m.makers.asks || 0) + (m.makers.bids || 0) : null;
  return {
    depth2Xrp: bids + asks, bids2Xrp: bids, asks2Xrp: asks, minSide2Xrp: Math.min(bids, asks), clobMinXrp: Math.min(clobB, clobA),
    ammShare: bids + asks > 0 ? amm / (bids + asks) : 0, ammPoolXrp: m.amm?.xrp ?? 0, spreadBps: m.spreadBps ?? null,
    vol24hXrp: m.vol24hXrp ?? null, makers, refPriceXrp: m.refPrice ?? null, observedAt: m.observedAt ?? null,
  };
}

function issuerRisk(spoke) {
  const checks = spoke.eligibility?.checks || [];
  const blocking = checks.filter((c) => c.blocking && !c.ok && c.id !== 'two_sided_liquidity' && c.id !== 'mainnet_read');
  const soft = checks.filter((c) => !c.blocking && !c.ok);
  const weights = { clawback: 0.3, concentration: 0.1, blackholed: 0.05, market_age: 0.15 };
  const norm = blocking.length ? 1 : clamp01(soft.reduce((s, c) => s + (weights[c.id] ?? 0.1), 0));
  return { norm, blocking: blocking.map((c) => c.id), soft: soft.map((c) => ({ id: c.id, detail: c.detail })) };
}

// NO_PATH evidence per currency from lib/pathfinder evidence (LIVE_TESTNET, demo-generated).
export function noPathIndex(evidence) {
  const idx = {};
  for (const r of evidence?.runs || []) for (const p of r.payments || []) {
    if (!p.diagnosis && !/no path/i.test(p.skip || p.reason || '')) continue;
    for (const c of [p.from, p.to]) {
      if (!c || c === 'XRP') continue;
      const e = (idx[c] ||= { count: 0, pairs: new Set(), runs: new Set(), ledgers: [] });
      e.count++; e.pairs.add(`${p.from}→${p.to}`); e.runs.add(r.run);
      if (p.pathfindLedger?.ledger && e.ledgers.length < 3) e.ledgers.push(p.pathfindLedger.ledger);
    }
  }
  for (const k of Object.keys(idx)) idx[k] = { ...idx[k], pairs: [...idx[k].pairs], runs: [...idx[k].runs] };
  return idx;
}

// ---------- Economic model ----------
export function economics(mx, { xrpUsd, availableCapitalUsd, model = MODEL } = {}) {
  const A = model.assumptions;
  const px = xrpUsd > 0 ? xrpUsd : 1;
  const gap = Math.max(0, A.targetSideDepthXrp - mx.minSide2Xrp);
  const wantXrp = Math.max(A.minDeployXrp, 2 * gap);
  const capXrp = Math.max(0, availableCapitalUsd) / px;
  const deployXrp = Math.min(wantXrp, capXrp);
  const deployUsd = deployXrp * px;
  const vol = Math.max(0, mx.vol24hXrp ?? 0) * A.volumeQualityHaircut;
  const baseShare = deployXrp > 0 ? Math.min(A.maxCaptureShare, deployXrp / (mx.depth2Xrp + deployXrp)) * (1 - mx.ammShare * A.ammFlowTakeShare) : 0;
  const spread = mx.spreadBps == null ? A.spreadCapBps : Math.min(mx.spreadBps, A.spreadCapBps);
  const capturedBps = (spread / 2) * A.spreadRealization;
  const dailyVol = Math.max(0.0005, Math.min(0.02, ((mx.spreadBps ?? A.spreadCapBps * 5) / 10_000) * A.dailyVolProxyFromSpread));
  const H = model.horizonDays;
  const fixedUsd = A.setupCostUsd + A.opsCostUsdPerMonth * (H / 30);
  const feeUsd = A.offersPerDeployment * A.requotesPerOfferPerDay * H * A.feeXrpPerTx * px;
  const capitalCostUsd = deployUsd * A.capitalCostAnnual * (H / 365);
  const reserveLockedXrp = A.offersPerDeployment * A.ownerReserveXrpPerOffer;
  const scen = {};
  for (const [k, s] of Object.entries(A.scenarios)) {
    const revenueUsd = vol * baseShare * s.capture * (capturedBps / 10_000) * H * px;
    const inventoryRiskUsd = deployUsd * dailyVol * Math.sqrt(H) * A.inventoryRiskFactor * s.risk;
    scen[k] = { revenueUsd: r0(revenueUsd), inventoryRiskUsd: r0(inventoryRiskUsd), netUsd: r0(revenueUsd - inventoryRiskUsd - fixedUsd - feeUsd - capitalCostUsd) };
  }
  const sideAdd = deployXrp / 2;
  const impactBefore = impactBps(REF_TRADE_XRP, mx.minSide2Xrp);
  const impactAfter = impactBps(REF_TRADE_XRP, mx.minSide2Xrp + sideAdd);
  return {
    mode: MODES.SIM, model: model.name, horizonDays: H,
    deployXrp: r0(deployXrp), deployUsd: r0(deployUsd), wantXrp: r0(wantXrp), capitalLimited: wantXrp > capXrp,
    captureShare: r2(baseShare * 100) / 100, capturedBps: r2(capturedBps), dailyVolProxy: dailyVol,
    costs: { fixedUsd: r0(fixedUsd), feeUsd: r2(feeUsd), capitalCostUsd: r0(capitalCostUsd), totalExRiskUsd: r0(fixedUsd + feeUsd + capitalCostUsd) },
    reserveLockedXrp: r2(reserveLockedXrp), reserveNote: 'Owner reserves are locked while offers exist and released on cancel. Reserve release is NOT profit.',
    netBenefitUsd: { low: scen.low.netUsd, base: scen.base.netUsd, high: scen.high.netUsd }, scenarios: scen,
    roiBase: deployUsd > 0 ? scen.base.netUsd / deployUsd : 0,
    marketBenefit: { refTradeXrp: REF_TRADE_XRP, impactBeforeBps: r2(impactBefore), impactAfterBps: r2(impactAfter), note: 'Modeled reduction in price impact for a reference trade if the deployment is added (linear-band model).' },
  };
}

function rationaleFor(c, contributions, econ) {
  const pos = contributions.filter((f) => f.contribution > 0).sort((a, b) => b.contribution - a.contribution).slice(0, 3);
  const neg = contributions.filter((f) => f.contribution < 0).sort((a, b) => a.contribution - b.contribution).slice(0, 2);
  const out = [];
  if (pos.length) out.push(`Strongest signals: ${pos.map((f) => `${f.label.toLowerCase()} (${f.display})`).join('; ')}.`);
  if (neg.length) out.push(`Held back by: ${neg.map((f) => `${f.label.toLowerCase()} (${f.display})`).join('; ')}.`);
  const n = econ.netBenefitUsd;
  out.push(`Modeled ${econ.horizonDays}-day net benefit (SIMULATION, ${econ.model}) ranges $${n.low.toLocaleString('en-US')} to $${n.high.toLocaleString('en-US')}, base $${n.base.toLocaleString('en-US')} on a $${econ.deployUsd.toLocaleString('en-US')} deployment.`);
  if (!c.candidate) out.push(`Not a funding candidate: ${c.exclusion}.`);
  else if (n.base <= 0) out.push('Thin does not mean profitable: after costs the base case loses money, so it ranks below every positive-benefit market.');
  else out.push('Positive base case: eligible for an opportunity evaluation (operator review and Guardian approval still required).');
  return out;
}

// Score one candidate. `c` = { id, origin, name, currency, network, spoke?, metrics, provenance, candidate, exclusion?, issuer? }
export function scoreCandidate(c, ctx) {
  const { xrpUsd, availableCapitalUsd, noPath = {}, profileHhi = null, model = MODEL } = ctx;
  const mx = c.metrics;
  const prov = c.provenance; // MAINNET_OBSERVED | LIVE_TESTNET | SIMULATION
  const econ = economics(mx, { xrpUsd, availableCapitalUsd, model });
  const np = noPath[c.currency] || null;
  const iss = c.issuerRisk || { norm: 0, blocking: [], soft: [] };
  const hhiProxy = mx.makers == null ? null : mx.makers > 0 ? 10_000 / mx.makers : 10_000;
  const values = {
    thin_liquidity: { norm: 1 - clamp01(Math.log10(mx.depth2Xrp + 1) / 5), display: `${r0(mx.depth2Xrp).toLocaleString('en-US')} XRP within ±2%`, provenance: prov },
    funded_depth_gap: { norm: clamp01(1 - mx.minSide2Xrp / model.assumptions.targetSideDepthXrp), display: `thinner side ${r0(mx.minSide2Xrp).toLocaleString('en-US')} / ${model.assumptions.targetSideDepthXrp.toLocaleString('en-US')} XRP`, provenance: prov },
    wide_spread: { norm: mx.spreadBps == null ? 1 : clamp01(mx.spreadBps / 500), display: mx.spreadBps == null ? 'no two-sided spread' : `${r2(mx.spreadBps)} bps`, provenance: prov },
    price_impact: { norm: clamp01(econ.marketBenefit.impactBeforeBps / 200), display: `${r2(econ.marketBenefit.impactBeforeBps)} bps for ${REF_TRADE_XRP} XRP (modeled on observed depth)`, provenance: prov },
    missing_paths: np ? { norm: clamp01(np.count / 6), display: `${np.count} NO_PATH payment(s) ${np.pairs.join(', ')} (runs ${np.runs.join(', ')})`, provenance: MODES.LIVE }
      : { norm: 0, display: c.network === 'mainnet' ? 'no per-market NO_PATH evidence (Mainnet sample is aggregate only)' : 'no NO_PATH evidence', provenance: c.network === 'mainnet' ? MODES.MAINNET : prov },
    bridge_leg_underfunded: { norm: clamp01(1 - mx.clobMinXrp / 1_000), display: `order-book (CLOB) thinner side ${r0(mx.clobMinXrp).toLocaleString('en-US')} XRP vs 1,000`, provenance: prov },
    maker_concentration: { norm: hhiProxy == null ? 0.5 : clamp01(hhiProxy / 10_000), display: hhiProxy == null ? 'maker count unknown' : `≈${r0(hhiProxy).toLocaleString('en-US')} HHI lower bound (${mx.makers} maker offers)${profileHhi != null ? `; Mainnet pathfound-flow HHI ${profileHhi}` : ''}`, provenance: hhiProxy == null ? MODES.SIM : prov },
    market_demand: { norm: clamp01(Math.log10((mx.vol24hXrp ?? 0) + 1) / 6), display: mx.vol24hXrp == null ? 'no observed volume' : `${r0(mx.vol24hXrp).toLocaleString('en-US')} XRP / 24h`, provenance: mx.vol24hXrp == null ? MODES.SIM : prov },
    amm_competition: { norm: clamp01(mx.ammShare), display: `AMM ${r0(mx.ammShare * 100)}% of ±2% depth`, provenance: prov },
    issuer_risk: { norm: iss.norm, display: iss.blocking.length ? `blocking: ${iss.blocking.join(', ')}` : iss.soft.length ? iss.soft.map((s) => s.id).join(', ') : 'no flags', provenance: c.issuerProvenance || prov },
    net_benefit: { norm: Math.tanh(econ.roiBase * 10), display: `base $${econ.netBenefitUsd.base.toLocaleString('en-US')} / ${econ.horizonDays}d`, provenance: MODES.SIM },
    capital_fit: { norm: econ.capitalLimited ? 0.3 : 1, display: econ.capitalLimited ? 'needs more than available capital' : `fits available $${r0(availableCapitalUsd).toLocaleString('en-US')}`, provenance: MODES.SIM },
    deployment_cost: { norm: clamp01(econ.deployUsd > 0 ? econ.costs.totalExRiskUsd / econ.deployUsd * 5 : 1), display: `$${econ.costs.totalExRiskUsd.toLocaleString('en-US')} fixed+fees+capital cost`, provenance: MODES.SIM },
  };
  const contributions = FACTORS.map((f) => ({ id: f.id, label: f.label, weight: f.weight, norm: r2(values[f.id].norm * 1000) / 1000, contribution: r2(100 * f.weight * values[f.id].norm), display: values[f.id].display, provenance: values[f.id].provenance }));
  const score = r2(contributions.reduce((s, f) => s + f.contribution, 0));
  return { ...c, metrics: mx, score, contributions, economics: econ, netPositive: c.candidate && econ.netBenefitUsd.base > 0, rationale: rationaleFor(c, contributions, econ) };
}

// Candidate builders
export function candidatesFromSpokes(spokes = [], { initialCurrency = 'RLUSD' } = {}) {
  const out = [];
  for (const s of spokes) {
    if (!s || s.placeholder || s.status === 'UNAVAILABLE') continue;
    const isInitial = String(s.currency).toUpperCase() === initialCurrency;
    const iss = issuerRisk(s);
    const testnet = s.network === 'testnet';
    let exclusion = null;
    if (iss.blocking.length) exclusion = `screening failed (${iss.blocking.join(', ')})`;
    else if (!s.eligibility?.eligible) exclusion = 'ineligible for two-sided liquidity';
    out.push({
      id: `radar:${s.id}`, marketId: s.id, origin: 'RADAR_DISCOVERED', name: s.name, currency: s.currency, issuer: s.issuer, network: s.network,
      pair: `${s.currency}/XRP`, xrpConnected: true, provenance: testnet ? MODES.LIVE : MODES.MAINNET, metrics: marketMetrics(s), issuerRisk: iss,
      candidate: !exclusion, exclusion, role: isInitial ? 'INITIAL_CORRIDOR' : 'CANDIDATE',
      note: testnet ? 'Testnet demo token (organic:false): demonstrates the mechanics only.' : isInitial ? 'XRP/RLUSD is the initial corridor; scored for comparison.' : 'Read-only Mainnet observation of third-party liquidity. Not an endorsement; no issuer contact made.',
    });
  }
  return out;
}

// PROJECT_REQUESTED candidates (fictional incubator intakes). No order book exists: metrics are SIMULATION placeholders.
export function candidatesFromProjects(intakes = Object.values(DEMO_INTAKES)) {
  return intakes.map((p) => ({
    id: `request:${p.id}`, marketId: `project:${p.id}`, origin: 'PROJECT_REQUESTED', name: p.name, currency: p.token?.currency, issuer: p.token?.issuer, network: p.token?.network,
    pair: `${p.token?.currency}/XRP`, xrpConnected: true, provenance: MODES.SIM, issuerProvenance: MODES.SIM,
    metrics: { depth2Xrp: 0, bids2Xrp: 0, asks2Xrp: 0, minSide2Xrp: 0, clobMinXrp: 0, ammShare: 0, ammPoolXrp: 0, spreadBps: null, vol24hXrp: null, makers: 0, refPriceXrp: null, observedAt: null },
    issuerRisk: { norm: 0.5, blocking: [], soft: [{ id: 'not_issued', detail: 'Token not yet issued; issuer unknown.' }] },
    candidate: false, exclusion: `token ${p.token?.issuer === 'NOT_YET_ISSUED' ? 'not yet issued' : 'not observed'}; must pass incubator legal and economic gates first`, role: 'PROJECT_REQUEST', fictional: !!p.fictional,
    note: 'Fictional project request from the incubator demo. No market exists, so there is no observed demand: the model cannot show a positive benefit yet.',
  }));
}

// Main entry. Returns the ranked radar.
export function buildRadar({ spokes = [], xrpUsd = null, profile = null, pathfinderEvidence = null, projects = undefined, availableCapitalUsd = PROPRIETARY_BUDGET_USD, engine = getEngine(), model = MODEL, initialCurrency = 'RLUSD' } = {}) {
  const noPath = noPathIndex(pathfinderEvidence);
  const profileHhi = profile?.pathfoundAll?.makerCapture?.hhi ?? null;
  const ctx = { xrpUsd, availableCapitalUsd, noPath, profileHhi, model };
  const list = [...candidatesFromSpokes(spokes, { initialCurrency }), ...candidatesFromProjects(projects)].map((c) => scoreCandidate(c, ctx));
  list.sort((a, b) => Number(b.candidate) - Number(a.candidate) || Number(b.netPositive) - Number(a.netPositive) || b.score - a.score || String(a.id).localeCompare(String(b.id)));
  list.forEach((c, i) => { c.rank = i + 1; });
  const info = engine.info();
  // Advisory engine view over the positive candidates (engine seam; demo adapter unless a Rust engine is attached).
  let engineView = [];
  try {
    const mk = list.filter((c) => c.netPositive).slice(0, 5).map((c) => ({ marketId: c.marketId, capitalUsd: Math.max(1, c.economics.deployUsd), flowScale: Math.max(0.05, Math.min(3, Math.log10(1 + (c.metrics.vol24hXrp || 0)) / 4)), ringsActive: 6 }));
    engineView = mk.length >= 2 ? engine.recommend(mk) || [] : [];
  } catch { engineView = []; }
  return {
    mode: MODES.SIM, adapter: ADAPTER_NOTE, engine: { id: info.id, label: info.label, authentic: !!info.authentic },
    model: { name: model.name, horizonDays: model.horizonDays, assumptions: model.assumptions }, factors: FACTORS, origins: ORIGINS,
    inputs: {
      xrpUsd, xrpUsdNote: xrpUsd ? 'XRP/USD from the spokes snapshot (provider reference).' : 'XRP/USD unavailable: USD figures use 1 XRP = $1 placeholder.',
      availableCapitalUsd, availableCapitalNote: 'Authorized proprietary capital (SIMULATION demo budget). Tier 1/2 TGLW participant assets and Tier 3 loan proceeds are never counted.',
      mainnetProfile: profile ? { mode: MODES.MAINNET, sampledAt: profile.sampledAt, hhi: profileHhi, window: profile.window } : null,
      noPathEvidence: Object.keys(noPath).length ? { mode: MODES.LIVE, organic: false, currencies: noPath } : null,
    },
    ranking: list,
    engineView,
    provenanceNote: 'Factor values carry their own provenance: MAINNET_OBSERVED (read-only third-party Mainnet), LIVE_TESTNET (our demo Testnet evidence, organic:false), SIMULATION (model). Rankings are advisory only.',
  };
}

// Pick the redeployment destination: best eligible, XRP-connected, Mainnet-observed candidate other than the initial corridor.
export function pickDestination(radar, { exclude = ['INITIAL_CORRIDOR'] } = {}) {
  const pool = radar.ranking.filter((c) => c.candidate && c.network === 'mainnet' && c.xrpConnected && !exclude.includes(c.role));
  const best = pool.find((c) => c.netPositive) || null;
  return best ? { candidate: best, recommended: true } : { candidate: pool[0] || null, recommended: false, reason: 'No candidate shows a positive modeled net benefit: redeployment not recommended.' };
}
