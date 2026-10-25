// TGLB Liquidity Incubation & Graduation Program: radar discovery over lib/spokes data, the provisional XRP/RLUSD
// interim market-making model, and Testnet REPLAY illustrations. Pure; deterministic; no network.
// The interim program makes markets in XRP/RLUSD ONLY. It does not create a market or a price for the project's token.
import { SOURCES, SIM, REPLAY } from './model.mjs';

export const INTERIM_DISCLAIMER = 'Provisional XRP/RLUSD market-making while the project\'s own token market is not yet legally eligible or economically justified. This does not create a market or a price for the project\'s unlaunched token. All execution and performance shown is SIMULATION (or REPLAY where labeled).';
export const RADAR_RULES = { lowDepthXrp2pct: 2_000, wideSpreadBps: 150, lowVol24hXrp: 20_000 };

const r2 = (x) => Math.round(x * 100) / 100;
const depthAt = (m, band) => {
  const b = m?.depthXrp?.bids?.find((x) => x.band === band)?.xrp ?? 0;
  const a = m?.depthXrp?.asks?.find((x) => x.band === band)?.xrp ?? 0;
  return { bids: b, asks: a, total: b + a };
};

// Real Mainnet RLUSD spoke (read-only MAINNET_OBSERVED) from the spokes list.
export function rlusdContext(spokes = [], { xrpUsd = null } = {}) {
  const s = spokes.find((x) => x && !x.placeholder && x.network === 'mainnet' && String(x.currency).toUpperCase() === 'RLUSD');
  if (!s) return { mode: 'UNAVAILABLE', note: 'No Mainnet RLUSD spoke in the current spokes snapshot.' };
  const m = s.market || {};
  return {
    mode: 'MAINNET_OBSERVED', spokeId: s.id, issuer: s.issuer, name: s.name, eligible: !!s.eligibility?.eligible,
    spreadBps: m.spreadBps ?? null, vol24hXrp: m.vol24hXrp ?? null, refPriceXrp: m.refPrice ?? null,
    depth2pctXrp: depthAt(m, '2%'), depth1pctXrp: depthAt(m, '1%'), amm: m.amm ? { present: !!m.amm.present, xrp: m.amm.xrp ?? 0 } : null,
    observedAt: m.observedAt ?? null, xrpUsd,
    note: 'Read-only XRPL Mainnet observation of third-party XRP/RLUSD liquidity: context for spread and depth only. Titan Forge holds no Mainnet accounts.',
  };
}

// ---------- Radar: thin-liquidity spokes ----------
export function radarFromSpokes(spokes = []) {
  const out = [];
  for (const s of spokes) {
    if (!s || s.placeholder) continue;
    if (String(s.currency).toUpperCase() === 'RLUSD') continue; // the interim quote asset, not a candidate
    const m = s.market || {};
    const d2 = depthAt(m, '2%');
    const blocking = (s.eligibility?.checks || []).filter((c) => c.blocking && !c.ok).map((c) => c.id);
    const signals = [];
    if (d2.total < RADAR_RULES.lowDepthXrp2pct) signals.push({ id: 'low_funded_depth', label: 'Low funded depth (±2%)', value: `${Math.round(d2.total).toLocaleString('en-US')} XRP`, threshold: `< ${RADAR_RULES.lowDepthXrp2pct.toLocaleString('en-US')} XRP` });
    if (m.spreadBps == null) signals.push({ id: 'no_two_sided_spread', label: 'No measurable two-sided spread', value: 'one-sided, empty or crossed', threshold: 'two-sided CLOB' });
    else if (m.spreadBps > RADAR_RULES.wideSpreadBps) signals.push({ id: 'wide_spread', label: 'Wide spread', value: `${Math.round(m.spreadBps).toLocaleString('en-US')} bps`, threshold: `> ${RADAR_RULES.wideSpreadBps} bps` });
    if (blocking.includes('two_sided_liquidity')) signals.push({ id: 'ineligible_two_sided', label: 'Ineligible for two-sided liquidity', value: 'two_sided_liquidity check failed', threshold: 'eligible' });
    if (m.vol24hXrp != null && m.vol24hXrp < RADAR_RULES.lowVol24hXrp) signals.push({ id: 'low_volume', label: 'Low 24h volume', value: `${Math.round(m.vol24hXrp).toLocaleString('en-US')} XRP`, threshold: `< ${RADAR_RULES.lowVol24hXrp.toLocaleString('en-US')} XRP` });
    if (!signals.length) continue;
    const otherBlocks = blocking.filter((b) => b !== 'two_sided_liquidity' && b !== 'mainnet_read');
    out.push({
      id: `radar:${s.id}`, spokeId: s.id, name: s.name, currency: s.currency, issuer: s.issuer, network: s.network, group: s.group,
      source: 'RADAR_DISCOVERED', mode: s.network === 'testnet' ? 'LIVE_TESTNET' : 'MAINNET_OBSERVED',
      signals, thinnessScore: signals.length, screeningBlocks: otherBlocks,
      candidate: otherBlocks.length === 0,
      note: otherBlocks.length ? `Screened out (${otherBlocks.join(', ')}): shown for awareness only, never a funding candidate.` : 'Observation only: not an endorsement, no issuer contact made. Must pass intake and both graduation gates.',
      metrics: { spreadBps: m.spreadBps ?? null, depth2pctXrp: Math.round(d2.total), vol24hXrp: m.vol24hXrp ?? null, observedAt: m.observedAt ?? null },
    });
  }
  return out.sort((a, b) => Number(b.candidate) - Number(a.candidate) || b.thinnessScore - a.thinnessScore || (a.metrics.depth2pctXrp - b.metrics.depth2pctXrp));
}

// ---------- Interim XRP/RLUSD market-making model (SIMULATION) ----------
// Deterministic: fixed price path from `seed`, per-source attribution pro rata to EXECUTABLE capital.
export function simulateInterim({ states, stack, days = 30, seed = 1313, rlusd = null, xrpUsd = null, opsCostUsdPerMonth = 750, setupCostUsd = 1500 } = {}) {
  const positions = Object.fromEntries(SOURCES.map((id) => [id, Math.max(0, states?.[id]?.EXECUTABLE || 0)]));
  const total = SOURCES.reduce((s, id) => s + positions[id], 0);
  const observedSpread = rlusd?.spreadBps ?? 6; // MAINNET_OBSERVED XRP/RLUSD spread when available
  const quoteHalfBps = Math.max(3, observedSpread / 2 + 2);
  const p0 = xrpUsd || rlusd?.xrpUsd || 1.3;
  const path = [];
  let rng = seed >>> 0;
  const rand = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 2 ** 32; };
  for (let d = 0; d <= days; d++) path.push(+(p0 * (1 + 0.0012 * d + 0.035 * Math.sin(d / 4.5) + 0.01 * (rand() - 0.5))).toFixed(6));
  const daily = [];
  let realized = 0;
  for (let d = 1; d <= days; d++) {
    const turnover = 0.8 + 0.4 * rand();            // share of capital turned over per day (modeled; XRP/RLUSD is deep)
    const capture = 0.6 + 0.2 * rand();               // share of quoted half-spread retained after adverse selection
    const adverse = (path[d] - path[d - 1]) / path[d - 1];
    const spreadPnl = total * turnover * (quoteHalfBps / 10_000) * capture;
    const selection = -Math.abs(adverse) * total * 0.004; // adverse-selection drag on volatile days
    const pnl = spreadPnl + selection;
    realized += pnl;
    daily.push({ day: d, pnlUsd: r2(pnl), xrpUsd: path[d] });
  }
  const xrpUnits = total / 2 / p0;                    // 50/50 XRP/RLUSD starting inventory
  const inventoryAppreciation = xrpUnits * (path[days] - p0);
  const skewUnits = xrpUnits * 0.08 * Math.sin(days / 3); // modeled residual skew from fills
  const avgCost = path.slice(Math.max(0, days - 7)).reduce((s, x) => s + x, 0) / Math.min(8, days + 1);
  const unrealized = skewUnits * (path[days] - avgCost);
  const networkFeesUsd = days * 400 * 0.000012 * p0;  // ~400 offer updates/day at 12 drops each
  const t3Interest = (positions.T3 || 0) * ((stack?.terms?.T3?.aprBps ?? 0) / 10_000) * (days / 365);
  const opsCosts = setupCostUsd * (total > 0 ? 1 : 0) + opsCostUsdPerMonth * (days / 30) * (total > 0 ? 1 : 0);

  const perSource = {};
  for (const id of SOURCES) {
    const w = total ? positions[id] / total : 0;
    const costs = opsCosts * w + networkFeesUsd * w + (id === 'T3' ? t3Interest : 0);
    const realizedS = realized * w;
    perSource[id] = {
      positionUsd: r2(positions[id]), inventory: { xrp: r2(xrpUnits * w), rlusd: r2((total / 2) * w) },
      feesEarnedUsd: r2(realizedS > 0 ? realizedS : 0), realizedUsd: r2(realizedS), unrealizedUsd: r2(unrealized * w),
      inventoryAppreciationUsd: r2(inventoryAppreciation * w), costsUsd: r2(costs), unrecoveredCostsUsd: r2(Math.max(0, costs - Math.max(0, realizedS))),
      ...(id === 'T3' ? { interestAccruedUsd: r2(t3Interest) } : {}),
    };
  }
  const totalCosts = opsCosts + networkFeesUsd + t3Interest;
  const posDays = daily.filter((x) => x.pnlUsd > 0).length;
  return {
    mode: SIM, market: 'XRP/RLUSD', days, seed, quoteHalfSpreadBps: r2(quoteHalfBps),
    rlusdContext: rlusd, perSource,
    totals: {
      positionUsd: r2(total), realizedUsd: r2(realized), unrealizedUsd: r2(unrealized), inventoryAppreciationUsd: r2(inventoryAppreciation),
      costsUsd: r2(totalCosts), networkFeesUsd: r2(networkFeesUsd), t3InterestUsd: r2(t3Interest),
      unrecoveredCostsUsd: r2(Math.max(0, totalCosts - Math.max(0, realized))),
      netMmReturnUsd: r2(realized - totalCosts), // excludes inventory appreciation and unrealized marks on purpose
      positiveDayShare: days ? r2(posDays / days) : 0,
    },
    daily, priceBasis: `Modeled XRP/USD path from ${p0} (seed ${seed}); not a forecast.`,
    note: 'Net MM return = realized spread P&L minus costs. Inventory appreciation and unrealized marks are shown separately and never counted as market-making profit.',
    disclaimer: INTERIM_DISCLAIMER,
  };
}

// Funded Testnet spokes as labeled REPLAY illustrations (recorded books / flows from lib/spokes). Never the project's fills.
export function replayIllustration(spokes = [], flows = [], { forProject } = {}) {
  const tn = spokes.filter((s) => s && !s.placeholder && s.network === 'testnet' && s.testnet?.funded);
  return tn.map((s) => ({
    mode: REPLAY, spokeId: s.id, code: s.testnet.code, name: s.name, issuer: s.issuer,
    book: { asks: (s.testnet.book?.asks || []).slice(0, 3), bids: (s.testnet.book?.bids || []).slice(0, 3), at: s.testnet.book?.at ?? null },
    fills: flows.filter((f) => (f.spokeIds || []).includes(s.id)).slice(0, 5).map((f) => ({ hash: f.hash, at: f.at, delivered: f.delivered, explorer: f.explorer, originalKind: f.kind })),
    note: `REPLAY illustration from the existing funded Testnet spoke ${s.testnet.code}. These are recorded demo-account fills (organic:false), not ${forProject || 'the project'}'s fills.`,
  }));
}
