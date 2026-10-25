// Capital redeployment walk-through (ALL SIMULATION). Pure, deterministic, no network, no Mainnet transfers, no signing.
//
// INITIAL corridor: XRP/RLUSD (Mainnet depth observed read-only). DESTINATION: the best eligible XRP-connected market
// from the Opportunity Radar. Only authorized PROPRIETARY capital is reallocatable. Tier 1 / Tier 2 TGLW participant
// assets (self-custodial) and Tier 3 TGLB loan proceeds are excluded and shown as such. Reserve release is NOT profit.
// Guardian approval requires an explicit operator flag (approved: true) that only a human sets from the console:
// without it the walk-through stops at the approval step and nothing (even simulated) moves.
import { MODES, RINGS } from '../../public/domain.js';
import { guardCheck } from '../guardian.mjs';
import { getEngine } from '../engine/index.mjs';
import { rlusdContext } from '../incubator/program.mjs';
import { proprietaryNeedUsd, PROPRIETARY_FLOOR } from '../incubator/intelligence.mjs';
import { mulberry32 } from '../spokes/replay.mjs';
import { pickDestination, impactBps, economics, MODEL } from './radar.mjs';
import { transition, seedCorridors, sha256, canonical } from './lifecycle.mjs';

const SIM = MODES.SIM;
export const RUN_AT = '2026-10-25T12:00:00.000Z';
export const STATEMENT = 'SIMULATION walk-through. No Mainnet transfers, no signing, no offers placed or cancelled on any network. Modeled outcomes are ranges and may be negative. Reserve release is not profit.';

// Demo capital pool attached to the initial corridor (SIMULATION; matches the seeded xrp-rlusd corridor's sources).
export const DEMO_POOL = Object.freeze({
  proprietaryUsd: 40_000,
  excluded: Object.freeze([
    { id: 'T1', label: 'Tier 1 — TGLW flexible', product: 'TGLW', usd: 25_000, why: 'Participant-owned, self-custodial (TGLW). Titan Ghost cannot move or reallocate it.' },
    { id: 'T2', label: 'Tier 2 — TGLW term-committed', product: 'TGLW', usd: 35_000, why: 'Participant-owned, self-custodial, term-committed (TGLW). Not Titan Ghost capital.' },
    { id: 'T3', label: 'Tier 3 — TGLB loan proceeds', product: 'TGLB', usd: 20_000, why: 'Underwritten loan proceeds bound to the lending-vault purpose. Never reallocated as proprietary capital.' },
  ]),
  offersPerCorridor: 12,
  ownerReserveXrpPerOffer: 0.2,
});

const r0 = (x) => (Number.isFinite(x) ? Math.round(x) : null);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const usd = (x) => `${x < 0 ? "−" : ""}$${Math.abs(Math.round(x)).toLocaleString("en-US")}`;

function initialMetrics(radar, rl) {
  const entry = radar.ranking.find((c) => c.role === 'INITIAL_CORRIDOR') || null;
  return { entry, depth2Xrp: entry?.metrics.depth2Xrp ?? ((rl?.depth2pctXrp?.total) || 0), minSide2Xrp: entry?.metrics.minSide2Xrp ?? Math.min(rl?.depth2pctXrp?.bids || 0, rl?.depth2pctXrp?.asks || 0), spreadBps: entry?.metrics.spreadBps ?? rl?.spreadBps ?? null, vol24hXrp: entry?.metrics.vol24hXrp ?? rl?.vol24hXrp ?? null, ammPoolXrp: entry?.metrics.ammPoolXrp ?? rl?.amm?.xrp ?? 0, metrics: entry?.metrics || null };
}

function ringPlan(capitalUsd, flowScale, engine) {
  const a = engine.allocate(capitalUsd, { flowScale, ringsActive: RINGS.length });
  return { deployedUsd: r0(a.deployedUsd), idleUsd: r0(a.idleUsd), rings: a.rings.map((r) => ({ id: r.id, allocUsd: r0(r.allocUsd) })) };
}

export function sentinelRisks({ initial, destination }) {
  const out = [];
  const add = (id, severity, market, title, evidence, provenance) => out.push({ id, key: `xdlc:${id}`, severity, market, title, evidence, provenance, verification: 'SIMULATED', category: 'xdlc', product: 'TG' });
  for (const [role, c] of [['initial', initial], ['destination', destination]]) {
    if (!c) continue;
    for (const s of c.issuerRisk?.soft || []) add(`${role}:${c.currency}:issuer:${s.id}`, s.id === 'clawback' ? 'medium' : 'low', c.marketId, `${c.currency}: issuer flag ${s.id}`, [{ label: s.id, value: s.detail }], c.issuerProvenance || c.provenance);
    if (c.metrics?.ammShare > 0.6) add(`${role}:${c.currency}:amm_dominance`, 'low', c.marketId, `${c.currency}: AMM supplies ${Math.round(c.metrics.ammShare * 100)}% of ±2% depth`, [{ label: 'ammShare', value: c.metrics.ammShare.toFixed(3) }], c.provenance);
    if (c.metrics?.makers != null && c.metrics.makers < 10) add(`${role}:${c.currency}:maker_concentration`, 'medium', c.marketId, `${c.currency}: only ${c.metrics.makers} maker offers on the book`, [{ label: 'makers', value: String(c.metrics.makers) }], c.provenance);
    if (role === 'destination' && c.economics?.netBenefitUsd?.low < 0) add(`${role}:${c.currency}:downside`, 'medium', c.marketId, `${c.currency}: modeled downside case is negative (${usd(c.economics.netBenefitUsd.low)} / ${c.economics.horizonDays}d)`, [{ label: 'netBenefitUsd', value: JSON.stringify(c.economics.netBenefitUsd) }], SIM);
  }
  return out;
}

// Pure plan + run. `approved` must come from a human operator action (UI button); this module never defaults it to true.
export function runRedeploy({ radar, spokes = [], xrpUsd = null, approved = false, approvedBy = null, pool = DEMO_POOL, engine = getEngine(), now = null } = {}) {
  const px = xrpUsd > 0 ? xrpUsd : 1;
  const info = engine.info();
  const rl = rlusdContext(spokes, { xrpUsd });
  const init = initialMetrics(radar, rl);
  const pick = pickDestination(radar);
  const dest = pick.candidate;
  const isApproved = approved === true;
  const steps = [];
  const step = (id, title, provenance, data, status = 'done') => steps.push({ index: steps.length, id, title, provenance, status, ...data });

  // 1 opportunity
  step('opportunity_identification', 'Opportunity identification', SIM, {
    summary: dest ? `${dest.currency}/XRP ranked #${dest.rank} by the radar${pick.recommended ? '' : ' (no positive candidate: not recommended)'}.` : 'No eligible destination.',
    destination: dest ? { marketId: dest.marketId, currency: dest.currency, issuer: dest.issuer, rank: dest.rank, score: dest.score, rationale: dest.rationale, netBenefitUsd: dest.economics.netBenefitUsd, provenance: dest.provenance } : null,
    engineLabel: info.label,
  });
  if (!dest || !pick.recommended) {
    return finish({ steps, approved: isApproved, blocked: 'NO_DESTINATION', reason: pick.reason || 'No destination.', init, dest, pool, px, info, rl, approvedBy, radar, now });
  }

  // 2 current proprietary deployment (engine seam)
  const flowInit = Math.max(0.05, Math.min(3, Math.log10(1 + (init.vol24hXrp || 0)) / 4));
  const ringsInit = ringPlan(pool.proprietaryUsd, flowInit, engine);
  step('current_proprietary_deployment', 'Current proprietary deployment (XRP/RLUSD)', SIM, {
    summary: `${usd(pool.proprietaryUsd)} authorized proprietary capital modeled across six rings (${info.label}).`, proprietaryUsd: pool.proprietaryUsd, rings: ringsInit.rings,
    excluded: pool.excluded.map((e) => ({ ...e, reallocatable: false })), note: 'Titan Forge holds no Mainnet accounts: this deployment is modeled.',
  });

  // 3 external funded liquidity (observed)
  step('external_funded_liquidity', 'External funded liquidity', rl.mode === 'MAINNET_OBSERVED' ? MODES.MAINNET : 'UNAVAILABLE', {
    summary: rl.mode === 'MAINNET_OBSERVED' ? `Third-party XRP/RLUSD depth within ±2%: ${r0(init.depth2Xrp).toLocaleString('en-US')} XRP; spread ${r2(init.spreadBps)} bps; AMM pool ${r0(init.ammPoolXrp).toLocaleString('en-US')} XRP.` : rl.note,
    depth2Xrp: r0(init.depth2Xrp), spreadBps: init.spreadBps, vol24hXrp: r0(init.vol24hXrp), ammPoolXrp: r0(init.ammPoolXrp), observedAt: rl.observedAt ?? null,
  });

  // 4 maturity / resilience (modeled share vs observed depth)
  const ourXrp = pool.proprietaryUsd / px;
  const indepShare = init.depth2Xrp > 0 ? init.depth2Xrp / (init.depth2Xrp + ourXrp) : 0;
  const block = 5_000;
  const sideOurs = ourXrp / 2;
  const impWith = impactBps(block, init.minSide2Xrp + sideOurs), impWithout = impactBps(block, init.minSide2Xrp);
  step('maturity_resilience', 'Maturity and resilience', SIM, {
    summary: `Modeled independent share ${(indepShare * 100).toFixed(1)}% (observed external depth vs modeled Titan depth). A ${block.toLocaleString('en-US')} XRP trade moves price ${r2(impWithout)} bps without our support vs ${r2(impWith)} bps with it.`,
    independentShare: r2(indepShare * 1000) / 1000, persistence: 0.9, impactWithBps: r2(impWith), impactWithoutBps: r2(impWithout), mature: indepShare >= 0.6,
  });

  // 5 economic value of existing support
  const econInit = init.metrics ? economics({ ...init.metrics }, { xrpUsd, availableCapitalUsd: pool.proprietaryUsd }) : null;
  step('economic_value_existing_support', 'Economic value of existing support', SIM, {
    summary: econInit ? `Modeled ${MODEL.horizonDays}-day net value of continuing full support in XRP/RLUSD: ${usd(econInit.netBenefitUsd.low)} to ${usd(econInit.netBenefitUsd.high)} (base ${usd(econInit.netBenefitUsd.base)}); impact improvement ${r2(impWithout - impWith)} bps for a ${block.toLocaleString('en-US')} XRP trade.` : 'Initial corridor metrics unavailable.',
    netBenefitUsd: econInit?.netBenefitUsd ?? null, model: MODEL.name,
  });

  // 6 comparative attractiveness
  const d = dest.economics.netBenefitUsd, i0 = econInit?.netBenefitUsd || { low: 0, base: 0, high: 0 };
  step('comparative_attractiveness', 'Comparative attractiveness', SIM, {
    summary: `Destination ${dest.currency}/XRP base ${usd(d.base)} vs XRP/RLUSD base ${usd(i0.base)} per ${MODEL.horizonDays} days on comparable capital. Range overlap is possible: ${dest.currency} low case ${usd(d.low)}.`,
    destination: d, initial: i0, deltaBaseUsd: r0(d.base - i0.base),
  });

  // 7 releasable capital (reuses the incubator proprietary floor)
  const needUsd = proprietaryNeedUsd(pool.proprietaryUsd, indepShare);
  const releasableUsd = Math.max(0, pool.proprietaryUsd - needUsd);
  const releaseUsd = Math.min(releasableUsd, dest.economics.deployUsd);
  step('estimated_releasable_capital', 'Estimated releasable capital', SIM, {
    summary: `Keep ${usd(needUsd)} (floor ${PROPRIETARY_FLOOR * 100}% or the non-independent share); releasable ${usd(releasableUsd)}; proposed release ${usd(releaseUsd)} (capped at the destination deployment size).`,
    keepUsd: needUsd, releasableUsd, releaseUsd, excludedUsd: pool.excluded.reduce((s, e) => s + e.usd, 0), excludedNote: 'Tier 1/2 TGLW and Tier 3 TGLB amounts are excluded from releasable capital.',
  });

  // 8 Guardian approval (human flag only)
  const verdict = guardCheck({ mode: SIM, amountUsd: Math.max(1, releaseUsd), requiresApproval: true, approved: isApproved });
  const allowed = verdict.allowed && isApproved;
  step('guardian_approval', 'Guardian approval', SIM, {
    summary: allowed ? `Operator approved (${approvedBy || 'operator console'}); Guardian verdict: allowed.` : 'Awaiting explicit operator approval. The server never self-approves: press "Approve redeployment" in the console.',
    guardian: verdict, operatorApproved: isApproved, approvedBy: isApproved ? (approvedBy || 'operator console') : null,
  }, allowed ? 'done' : 'awaiting_approval');

  // 9 Sentinel risks (shown before anything moves, approved or not)
  const risks = sentinelRisks({ initial: init.entry, destination: dest });
  step('sentinel_risks', 'Sentinel risks', SIM, { summary: `${risks.length} risk signal(s) across both markets.`, risks });

  if (!allowed) return finish({ steps, approved: false, blocked: 'AWAITING_OPERATOR_APPROVAL', reason: 'Operator approval not given.', init, dest, pool, px, info, rl, releaseUsd, approvedBy, radar, now, ringsInit, indepShare });

  // 10 candidate offer cancellation: outermost rings first until the release is covered
  const cancel = []; let covered = 0;
  if (ringsInit.idleUsd > 0) { const take = Math.min(ringsInit.idleUsd, releaseUsd); covered += take; cancel.push({ ring: 'IDLE', releaseUsd: r0(take), offers: 0, tx: 'none (idle capital, no offers to cancel)' }); }
  for (const r of [...ringsInit.rings].reverse()) { if (covered >= releaseUsd || r.allocUsd <= 0) continue; const take = Math.min(r.allocUsd, releaseUsd - covered); covered += take; cancel.push({ ring: r.id, releaseUsd: r0(take), offers: 2, tx: 'OfferCancel (modeled, not submitted)' }); }
  const cancelledOffers = cancel.reduce((s, c) => s + c.offers, 0);
  step('candidate_offer_cancellation', 'Candidate offer cancellation', SIM, { summary: `${cancelledOffers} modeled OfferCancel across ${cancel.map((c) => c.ring).join(', ')} (outermost funded rings first; inner rings keep XRP/RLUSD tight).`, cancellations: cancel });

  // 11 available-balance verification
  const reserveXrp = cancelledOffers * pool.ownerReserveXrpPerOffer;
  const avail = { xrpUsd: r0(covered / 2), rlusdUsd: r0(covered / 2) };
  step('available_balance_verification', 'Available-balance verification', SIM, {
    summary: `Modeled released balance ${usd(covered)} (≈ ${usd(avail.xrpUsd)} XRP + ${usd(avail.rlusdUsd)} RLUSD) ≥ release ${usd(releaseUsd)}: verified. Owner reserve released: ${r2(reserveXrp)} XRP (reserve release is NOT profit).`,
    verified: covered >= releaseUsd - 1, balances: avail, reserveReleasedXrp: r2(reserveXrp), excludedUntouched: pool.excluded.map((e) => ({ id: e.id, usd: e.usd, moved: 0 })),
  });

  // 12 asset conversion (RLUSD → XRP → destination token, XRP auto-bridging is an existing XRPL feature)
  const destM = dest.metrics;
  const rlusdXrp = avail.rlusdUsd / px, tokenXrp = covered / 2 / px;
  const leg1Bps = (init.spreadBps ?? 50) / 2 + impactBps(rlusdXrp, init.minSide2Xrp);
  const leg2Bps = (destM.spreadBps ?? 200) / 2 + impactBps(tokenXrp, destM.minSide2Xrp);
  const conv1 = avail.rlusdUsd * leg1Bps / 10_000, conv2 = (covered / 2) * leg2Bps / 10_000;
  const convCost = conv1 + conv2;
  step('asset_conversion', 'Asset conversion', SIM, {
    summary: `RLUSD → XRP (${r2(leg1Bps)} bps) then XRP → ${dest.currency} for half the release (${r2(leg2Bps)} bps). Modeled conversion cost ${usd(convCost)} (a real cost, deducted).`,
    legs: [{ from: 'RLUSD', to: 'XRP', usd: avail.rlusdUsd, costBps: r2(leg1Bps), costUsd: r0(conv1) }, { from: 'XRP', to: dest.currency, usd: r0(covered / 2), costBps: r2(leg2Bps), costUsd: r0(conv2) }],
    costUsd: r0(convCost), note: 'Cross-currency fills may use XRP auto-bridging, an existing XRPL feature. Nothing is executed.',
  });

  // 13 destination funding
  const fundedUsd = Math.max(0, covered - convCost);
  step('destination_funding', 'Destination funding', SIM, { summary: `${dest.currency}/XRP funded with ${usd(fundedUsd)} (≈ half XRP, half ${dest.currency}) after conversion costs.`, fundedUsd: r0(fundedUsd), marketId: dest.marketId });

  // 14 new offers
  const flowDest = Math.max(0.05, Math.min(3, Math.log10(1 + (destM.vol24hXrp || 0)) / 4));
  const ringsDest = ringPlan(fundedUsd, flowDest, engine);
  step('new_offers', 'New offers', SIM, { summary: `${RINGS.length * 2} modeled offers across six rings in ${dest.currency}/XRP (${info.label}).`, rings: ringsDest.rings, offers: RINGS.length * 2, tx: 'OfferCreate (modeled, not submitted)' });

  // 15 subsequent fills (seeded, ranges, can be negative)
  const rnd = mulberry32(1313);
  const e = dest.economics; const days = 7;
  const fills = []; let base = 0;
  const dailyBase = (e.scenarios.base.revenueUsd / e.horizonDays) * (fundedUsd / Math.max(1, e.deployUsd));
  for (let k = 0; k < days; k++) { const f = dailyBase * (0.4 + 1.2 * rnd()); base += f; fills.push({ day: k + 1, modeledFillRevenueUsd: r2(f), fills: Math.max(0, Math.round(f / 4)) }); }
  const scale = days / e.horizonDays;
  const costs7 = (e.costs.totalExRiskUsd) * scale + convCost;
  const range = { low: r0(e.scenarios.low.revenueUsd * scale - e.scenarios.low.inventoryRiskUsd * scale - costs7), base: r0(base - e.scenarios.base.inventoryRiskUsd * scale - costs7), high: r0(e.scenarios.high.revenueUsd * scale - e.scenarios.high.inventoryRiskUsd * scale - costs7) };
  step('subsequent_fills', 'Subsequent fills (modeled)', SIM, { summary: `7-day modeled net after costs: ${usd(range.low)} to ${usd(range.high)} (base ${usd(range.base)}). SIMULATION: not earnings.`, daily: fills, netUsd: range, model: MODEL.name });

  return finish({ steps, approved: true, init, dest, pool, px, info, rl, releaseUsd, covered, convCost, fundedUsd, reserveXrp, approvedBy, radar, now, ringsInit, ringsDest, indepShare, range });
}

function finish(o) {
  const { steps, init, dest, pool, info } = o;
  const moved = o.approved && o.fundedUsd != null;
  const destLabel = dest ? `${dest.currency}/XRP` : 'Destination';
  const before = [
    { bucket: 'proprietary', market: 'XRP/RLUSD', usd: pool.proprietaryUsd, reallocatable: true },
    { bucket: 'proprietary', market: destLabel, usd: 0, reallocatable: true },
    ...pool.excluded.map((e) => ({ bucket: e.id, market: 'XRP/RLUSD', usd: e.usd, reallocatable: false, why: e.why })),
  ];
  const after = moved ? [
    { bucket: 'proprietary', market: 'XRP/RLUSD', usd: r0(pool.proprietaryUsd - o.covered), reallocatable: true },
    { bucket: 'proprietary', market: destLabel, usd: r0(o.fundedUsd), reallocatable: true },
    { bucket: 'conversion_cost', market: '—', usd: r0(o.convCost), reallocatable: false, why: 'Spent on modeled conversion (cost, not a transfer).' },
    ...pool.excluded.map((e) => ({ bucket: e.id, market: 'XRP/RLUSD', usd: e.usd, reallocatable: false, why: e.why })),
  ] : before.map((x) => ({ ...x }));
  if (moved || o.blocked) steps.push({ index: steps.length, id: 'before_after_allocation', title: 'Before / after allocation', provenance: SIM, status: moved ? 'done' : 'blocked',
    summary: moved ? `Moved ${usd(o.covered)} of proprietary capital from XRP/RLUSD to ${destLabel}; ${usd(o.convCost)} conversion cost; Tier 1/2/3 untouched. Reserve released ${r2(o.reserveXrp)} XRP is not profit.` : `Nothing moved: ${o.reason}`,
    before, after });
  // Lifecycle records for the walk-through, using the same state machine (fixed clock => deterministic hashes).
  const lifecycle = [];
  try {
    let c = seedCorridors().a; let t = Date.parse(o.now || RUN_AT);
    const clock = () => new Date((t += 60_000)).toISOString();
    const seq = [
      { to: 'SUPPORT_REDUCTION', evidence: { releasableUsd: o.releaseUsd || 0, independentShare: o.indepShare ?? null }, approved: o.approved, approvedBy: o.approvedBy || 'operator console' },
      { to: 'CAPITAL_AVAILABLE', evidence: { availableBalanceVerified: moved, reserveReleasedXrp: o.reserveXrp ?? 0, note: 'Reserve release is not profit.' } },
      { to: 'REDEPLOYMENT_RECOMMENDED', evidence: { destinationMarketId: dest?.marketId || null, radarRank: dest?.rank ?? null, netBenefitUsd: dest?.economics?.netBenefitUsd ?? null } },
      { to: 'APPROVED_REDEPLOYMENT', evidence: { releaseUsd: o.releaseUsd || 0 }, approved: o.approved, approvedBy: o.approvedBy || 'operator console' },
      { to: 'NEW_CORRIDOR_ACTIVE', evidence: { destinationMarketId: dest?.marketId || null, destinationFundedUsd: r0(o.fundedUsd || 0) } },
    ];
    for (const s of seq) {
      const r = transition(c, s, { now: clock });
      if (!r.ok) { lifecycle.push({ to: s.to, ok: false, reasons: r.reasons }); break; }
      lifecycle.push({ to: s.to, ok: true, hash: r.record.hash, prevHash: r.record.prevHash, at: r.record.at, approved: r.record.authorization.approved, guardian: r.record.authorization.guardian.allowed });
      c = r.corridor;
    }
  } catch (e) { lifecycle.push({ ok: false, reasons: [e.message] }); }
  const runId = sha256(canonical({ approved: !!o.approved, dest: dest?.marketId || null, release: o.releaseUsd ?? null, funded: o.fundedUsd ?? null, steps: steps.map((s) => [s.id, s.status]) })).slice(0, 16);
  return {
    mode: SIM, statement: STATEMENT, runId, at: o.now || RUN_AT, approved: !!o.approved, blocked: o.blocked || null, reason: o.reason || null,
    engine: { id: info.id, label: info.label, authentic: !!info.authentic },
    markets: { initial: { pair: 'XRP/RLUSD', marketId: init.entry?.marketId || null, provenance: o.rl?.mode || 'UNAVAILABLE' }, destination: dest ? { pair: destLabel, marketId: dest.marketId, rank: dest.rank, provenance: dest.provenance } : null },
    steps, allocation: { before, after, moved }, lifecycle,
    exclusions: pool.excluded.map((e) => ({ id: e.id, usd: e.usd, reallocatable: false, why: e.why })),
  };
}

// Plan = the run without approval (read-only preview).
export function planRedeploy(args = {}) { return runRedeploy({ ...args, approved: false }); }
