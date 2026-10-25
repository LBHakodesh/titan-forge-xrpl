// XDLC corridor vs XRPL AMM: pure, deterministic SIMULATION model (no network, no hashes, no claims of real fills).
//
// XDLC is a PROPOSED XRPL amendment (draft). This file models the Commander's design:
//   - A corridor of liquidity that undercuts the XRPL AMM by ImprovementBps (per corridor, min 1 bp) at every depth
//     level. The corridor quote at level i is the AMM's marginal price INCLUDING its trading fee at depth i·L, improved
//     by ImprovementBps. The AMM marginal price only gets worse with depth, so every unit in level i is at least
//     ImprovementBps better than any AMM unit in the same depth band.
//   - Providers: Titan Ghost (proprietary capital), TGLW Tier 1 (flexible), TGLW Tier 2 (term commitments, term clock
//     starts at corridor activation, prorated early-exit fee paid to stayers weighted by tenure) and other organizations.
//   - Fill priority at a level = tenure (oldest first). Provider limits: MinRate (a static, on-ledger worst acceptable price,
//     modeled as a minimum spread vs the reference price the provider set it against),
//     MaxPerLevel. Volatility pause when AMM spot moves more than PauseBps from the reference.
//
// Units: base asset = XRP, quote asset = RLUSD (≈ USD). Prices are RLUSD per XRP. Provider money amounts are RLUSD.
// The ladder is a snapshot taken when an order arrives (one transaction); it re-pegs between transactions.
// Everything returned is labeled SIMULATION except the pool inputs, which carry the reference's own label.

export const MODEL_VERSION = 'xdlc-amm-model/1';
export const MODE = 'SIMULATION';
export const MIN_IMPROVEMENT_BPS = 1;
export const MAX_IMPROVEMENT_BPS = 20;
const EPS = 1e-9;

// ---------------------------------------------------------------- seeded PRNG
export function mulberry32(seed) {
  let a = (Number(seed) >>> 0) || 0x9e3779b9;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function seedFrom(v) {
  if (Number.isFinite(Number(v)) && String(v).trim() !== '') return Number(v) >>> 0;
  let h = 2166136261; for (const c of String(v ?? 'xdlc')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0;
}

// ---------------------------------------------------------------- constant-product AMM with fee
// pool = { xrp, rlusd, feeBps } ; XRPL trading_fee is in 1/100,000 units (1000 = 1%), so feeBps = trading_fee / 10.
export function makePool({ xrp, rlusd, tradingFee = null, feeBps = null }) {
  const fb = feeBps != null ? Number(feeBps) : Number(tradingFee) / 10;
  if (!(xrp > 0 && rlusd > 0 && fb >= 0 && fb < 10000)) throw new Error('invalid pool');
  return { xrp: Number(xrp), rlusd: Number(rlusd), feeBps: fb };
}
export const spot = (p) => p.rlusd / p.xrp; // mid price, RLUSD per XRP (no fee)
const fee = (p) => p.feeBps / 1e4;

// Taker BUYS q XRP from the pool, paying RLUSD (fee charged on the input): (X − q)(Y + in·(1−f)) = X·Y.
export function ammBuyCost(p, q) {
  if (q <= 0) return 0;
  if (q >= p.xrp) return Infinity;
  return (p.rlusd * q) / ((p.xrp - q) * (1 - fee(p)));
}
// Taker SELLS q XRP into the pool, receiving RLUSD (fee charged on the input): (X + q·(1−f))(Y − out) = X·Y.
export function ammSellProceeds(p, q) {
  if (q <= 0) return 0;
  const xin = q * (1 - fee(p));
  return p.rlusd - (p.xrp * p.rlusd) / (p.xrp + xin);
}
// Marginal price (incl. fee) of the next unit after q XRP have already been traded on that side.
export function ammMarginal(p, side, q) {
  const f = fee(p), X = p.xrp, Y = p.rlusd;
  if (side === 'buy') return q >= X ? Infinity : (X * Y) / ((X - q) ** 2 * (1 - f));
  return (X * Y * (1 - f)) / (X + q * (1 - f)) ** 2;
}
// Depth q at which the marginal price reaches `price` (inverse of ammMarginal); never negative.
export function ammDepthAt(p, side, price) {
  const f = fee(p), X = p.xrp, Y = p.rlusd;
  if (!(price > 0) || !Number.isFinite(price)) return side === 'buy' ? (Number.isFinite(price) ? 0 : X) : Infinity;
  if (side === 'buy') return Math.max(0, X - Math.sqrt((X * Y) / (price * (1 - f))));
  return Math.max(0, (Math.sqrt((X * Y * (1 - f)) / price) - X) / (1 - f));
}
// Pool after a trade of q XRP (fee stays in the pool, so k grows).
export function ammApply(p, side, q) {
  if (side === 'buy') { const c = ammBuyCost(p, q); return { ...p, xrp: p.xrp - q, rlusd: p.rlusd + c }; }
  const o = ammSellProceeds(p, q); return { ...p, xrp: p.xrp + q, rlusd: p.rlusd - o };
}
// Quote-side amount for q XRP on [from, from+q] of the AMM curve.
function ammLeg(p, side, from, q) {
  return side === 'buy' ? ammBuyCost(p, from + q) - ammBuyCost(p, from) : ammSellProceeds(p, from + q) - ammSellProceeds(p, from);
}
// AMM-only quote for a taker order of q XRP: amount, effective price, slippage vs mid.
export function ammQuote(p, side, q) {
  const amount = side === 'buy' ? ammBuyCost(p, q) : ammSellProceeds(p, q);
  const eff = q > 0 ? amount / q : ammMarginal(p, side, 0);
  return { side, qtyXrp: q, amountRlusd: amount, effPrice: eff, mid: spot(p), slippageBps: ((side === 'buy' ? eff / spot(p) - 1 : 1 - eff / spot(p)) * 1e4), mode: MODE };
}

// ---------------------------------------------------------------- providers
export const PROVIDER_KINDS = Object.freeze({
  ghost: { label: 'Titan Ghost', note: 'proprietary capital' },
  tglw1: { label: 'TGLW Tier 1', note: 'flexible, self-custodial' },
  tglw2: { label: 'TGLW Tier 2', note: 'term commitment, clock starts at corridor activation' },
  org: { label: 'Other organization', note: 'any organization can provide liquidity' },
});
// Illustrative provider set (hypothetical amounts, not real commitments). joinedDay is relative to corridor activation
// (day 0); Tier 2 tenure starts at activation by definition. `seq` breaks ties in commitment order.
export const DEFAULT_PROVIDERS = Object.freeze([
  { id: 'ghost', kind: 'ghost', name: 'Titan Ghost', joinedDay: 0, seq: 0, capitalUsd: 25000, maxPerLevelUsd: 1000, minRateBps: 2 },
  { id: 't2a', kind: 'tglw2', name: 'TGLW Tier 2 · Participant A', joinedDay: 0, seq: 1, capitalUsd: 10000, maxPerLevelUsd: 400, minRateBps: 3, termDays: 90 },
  { id: 't2b', kind: 'tglw2', name: 'TGLW Tier 2 · Participant B', joinedDay: 0, seq: 2, capitalUsd: 10000, maxPerLevelUsd: 400, minRateBps: 3, termDays: 90 },
  { id: 't1', kind: 'tglw1', name: 'TGLW Tier 1 · flexible pool', joinedDay: 12, seq: 3, capitalUsd: 8000, maxPerLevelUsd: 500, minRateBps: 4 },
  { id: 'org', kind: 'org', name: 'Other organization · independent LP', joinedDay: 30, seq: 4, capitalUsd: 12000, maxPerLevelUsd: 600, minRateBps: 6 },
].map(Object.freeze));

export const tenureDays = (pr, day) => Math.max(0, day - pr.joinedDay);
// Fill priority: tenure (oldest first), then commitment order, then id.
export function byTenure(providers) {
  return [...providers].sort((a, b) => (a.joinedDay - b.joinedDay) || ((a.seq ?? 0) - (b.seq ?? 0)) || String(a.id).localeCompare(String(b.id)));
}

// ---------------------------------------------------------------- corridor ladder
// Spread a provider earns at price c vs reference price r (bps, positive = provider gains vs reference).
export const spreadBps = (side, c, r) => (side === 'buy' ? (c - r) / r : (r - c) / r) * 1e4;
// Taker side 'buy' => providers sell XRP (asks below the AMM); 'sell' => providers buy XRP (bids above the AMM).
export function buildLadder(pool, { side = 'buy', improvementBps = 1, levelUsd = 2500, levels = 20, providers = DEFAULT_PROVIDERS, day = 60,
  referencePrice = null, inventory = null, paused = false } = {}) {
  const imp = clampImprovement(improvementBps) / 1e4;
  const mid = spot(pool);
  const ref = referencePrice ?? mid; // price the provider's static MinRate was set against (no oracle in the protocol)
  const L = levelUsd / mid; // depth band width in XRP
  const order = byTenure(providers);
  const left = new Map(order.map((pr) => [pr.id, inventory?.get?.(pr.id) ?? pr.capitalUsd / mid])); // XRP-equivalent inventory
  const out = [];
  for (let i = 0; i < levels; i++) {
    const depthFrom = i * L, depthTo = (i + 1) * L;
    const ammMarg = ammMarginal(pool, side, depthFrom);
    const ammSliceAvg = ammLeg(pool, side, depthFrom, L) / L;
    const price = side === 'buy' ? ammMarg * (1 - imp) : ammMarg * (1 + imp);
    const offers = [];
    for (const pr of order) {
      const sp = spreadBps(side, price, ref);
      const eligible = !paused && !pr.exited && sp + EPS >= (pr.minRateBps ?? 0);
      const qty = eligible ? Math.min(pr.maxPerLevelUsd / mid, left.get(pr.id)) : 0;
      if (qty > EPS) { left.set(pr.id, left.get(pr.id) - qty); offers.push({ providerId: pr.id, qtyXrp: qty }); }
    }
    out.push({ level: i, depthFromXrp: depthFrom, depthToXrp: depthTo, ammMarginal: ammMarg, ammSliceAvg, price,
      improvementVsMarginalBps: Math.abs(price / ammMarg - 1) * 1e4, spreadVsRefBps: spreadBps(side, price, ref),
      capacityXrp: offers.reduce((s, o) => s + o.qtyXrp, 0), offers });
  }
  return { side, improvementBps: imp * 1e4, levelUsd, levelXrp: L, mid, referencePrice: ref, paused, levels: out, mode: MODE };
}
export function clampImprovement(bps) {
  const n = Number(bps); return Math.min(MAX_IMPROVEMENT_BPS, Math.max(MIN_IMPROVEMENT_BPS, Number.isFinite(n) ? n : MIN_IMPROVEMENT_BPS));
}

// ---------------------------------------------------------------- routing
// Route a taker order of qty XRP across the corridor ladder + AMM. The corridor fills while it is STRICTLY better than
// the AMM's current marginal price; otherwise the AMM fills until its marginal price reaches the next corridor level.
// limitPrice (optional) stops the order once the best available price is no better than it (used by arbitrageurs).
export function route(pool, ladder, qty, { limitPrice = null } = {}) {
  const side = ladder.side;
  const better = side === 'buy' ? (a, b) => a < b - EPS * b : (a, b) => a > b + EPS * b;
  const caps = ladder.levels.map((l) => l.offers.map((o) => ({ ...o })));
  const legs = [];
  let qa = 0, rem = qty, li = 0, amt = 0;
  const nextLevel = () => { while (li < caps.length && caps[li].reduce((s, o) => s + o.qtyXrp, 0) <= EPS) li++; return li < caps.length ? ladder.levels[li] : null; };
  const pushAmm = (q) => {
    const a = ammLeg(pool, side, qa, q);
    const last = legs[legs.length - 1];
    if (last && last.venue === 'amm') { last.qtyXrp += q; last.amountRlusd += a; last.toDepthXrp = qa + q; last.price = last.amountRlusd / last.qtyXrp; }
    else legs.push({ venue: 'amm', qtyXrp: q, amountRlusd: a, price: a / q, fromDepthXrp: qa, toDepthXrp: qa + q });
    qa += q; rem -= q; amt += a;
  };
  let guard = 0;
  while (rem > EPS * Math.max(1, qty) && guard++ < 10000) {
    const lvl = nextLevel();
    const pa = ammMarginal(pool, side, qa);
    const cBest = lvl ? lvl.price : (side === 'buy' ? Infinity : 0);
    const best = lvl && better(lvl.price, pa) ? lvl.price : pa;
    if (limitPrice != null && !better(best, limitPrice)) break;
    if (lvl && better(lvl.price, pa)) {
      // Corridor level: allocate among providers by tenure (offers are already in tenure order).
      let take = Math.min(rem, caps[li].reduce((s, o) => s + o.qtyXrp, 0));
      const fills = [];
      let t = take;
      for (const o of caps[li]) { if (t <= EPS) break; const f = Math.min(o.qtyXrp, t); if (f > EPS) { o.qtyXrp -= f; t -= f; fills.push({ providerId: o.providerId, qtyXrp: f, amountRlusd: f * lvl.price }); } }
      const a = take * lvl.price;
      legs.push({ venue: 'corridor', level: lvl.level, qtyXrp: take, amountRlusd: a, price: lvl.price, ammMarginal: lvl.ammMarginal, fills });
      rem -= take; amt += a;
    } else {
      // AMM until its marginal price reaches the next corridor level (or the limit), or the order is done.
      let target = lvl ? ammDepthAt(pool, side, cBest) : Infinity;
      if (limitPrice != null) target = Math.min(target, ammDepthAt(pool, side, limitPrice));
      let q = Math.min(rem, target - qa);
      if (side === 'buy') q = Math.min(q, (pool.xrp - qa) * 0.999);
      if (!(q > EPS)) {
        if (lvl && (limitPrice == null || better(lvl.price, limitPrice))) { // tie: nudge so the corridor becomes strictly better
          const nudge = Math.min(rem, Math.max(EPS, qty * 1e-9)); pushAmm(nudge); continue;
        }
        break;
      }
      pushAmm(q);
    }
  }
  const filled = qty - Math.max(0, rem);
  const corridorQty = legs.filter((l) => l.venue === 'corridor').reduce((s, l) => s + l.qtyXrp, 0);
  return { side, qtyXrp: filled, unfilledXrp: Math.max(0, rem), amountRlusd: amt, effPrice: filled > 0 ? amt / filled : null,
    ammQtyXrp: qa, corridorQtyXrp: corridorQty, legs, poolAfter: ammApply(pool, side, qa), mode: MODE };
}

// Taker savings vs AMM-only for the same quantity (positive = taker better off).
export function savings(pool, side, routed) {
  const amm = ammQuote(pool, side, routed.qtyXrp);
  const diff = side === 'buy' ? amm.amountRlusd - routed.amountRlusd : routed.amountRlusd - amm.amountRlusd;
  // Decomposition: the corridor's ImprovementBps on its own fills vs the AMM marginal at its level, and the rest, which
  // comes from added depth (the AMM leg goes less deep than an AMM-only order would).
  let fromImprovement = 0;
  for (const l of routed.legs) if (l.venue === 'corridor' && l.ammMarginal) fromImprovement += Math.abs(l.ammMarginal - l.price) * l.qtyXrp;
  return { ammOnly: amm, savedRlusd: diff, savedBps: amm.amountRlusd > 0 ? (diff / amm.amountRlusd) * 1e4 : 0,
    fromImprovementRlusd: fromImprovement, fromAddedDepthRlusd: diff - fromImprovement,
    fromImprovementBps: amm.amountRlusd > 0 ? (fromImprovement / amm.amountRlusd) * 1e4 : 0,
    fromAddedDepthBps: amm.amountRlusd > 0 ? ((diff - fromImprovement) / amm.amountRlusd) * 1e4 : 0,
    labels: { improvement: 'price improvement from the corridor rule (ImprovementBps on corridor fills)',
      addedDepth: 'extra depth from illustrative providers (amounts are hypothetical)' },
    note: 'Savings scale with how much liquidity providers actually commit; only the improvement part follows from the rule itself.', mode: MODE };
}

// Provider P&L components from corridor fills. spreadCaptured is vs the AMM mid at order arrival (modeled).
export function providerPnl(ladder, routed, providers = DEFAULT_PROVIDERS, { day = 60, mid = ladder.mid } = {}) {
  const side = ladder.side;
  const rows = byTenure(providers).map((pr, rank) => ({ id: pr.id, kind: pr.kind, name: pr.name, priority: rank + 1, tenureDays: tenureDays(pr, day),
    offeredXrp: ladder.levels.reduce((s, l) => s + (l.offers.find((o) => o.providerId === pr.id)?.qtyXrp || 0), 0),
    filledXrp: 0, notionalRlusd: 0, spreadCapturedRlusd: 0, levelsFilled: [], minRateBps: pr.minRateBps, maxPerLevelUsd: pr.maxPerLevelUsd, capitalUsd: pr.capitalUsd, exited: !!pr.exited }));
  const by = new Map(rows.map((r) => [r.id, r]));
  for (const leg of routed.legs) if (leg.venue === 'corridor') for (const f of leg.fills) {
    const r = by.get(f.providerId); if (!r) continue;
    r.filledXrp += f.qtyXrp; r.notionalRlusd += f.amountRlusd;
    r.spreadCapturedRlusd += side === 'buy' ? (leg.price - mid) * f.qtyXrp : (mid - leg.price) * f.qtyXrp;
    if (!r.levelsFilled.includes(leg.level)) r.levelsFilled.push(leg.level);
  }
  for (const r of rows) r.spreadBps = r.notionalRlusd > 0 ? (r.spreadCapturedRlusd / r.notionalRlusd) * 1e4 : 0;
  return { rows, label: 'modeled spread captured vs AMM mid at order arrival; excludes inventory risk (see arbitrage scenario)', mode: MODE };
}

// ---------------------------------------------------------------- early exit (TGLW Tier 2)
const MICRO = 1e6; // integer micro-RLUSD so distribution conserves exactly
// fee = withdrawn × ExitFeeBps × remaining / term, remaining = term − elapsed since activation, clamped to [0, term].
export function earlyExitFee({ withdrawnUsd, exitFeeBps = 200, termDays = 90, exitDay }) {
  const term = Math.max(1, Number(termDays));
  const remaining = Math.min(term, Math.max(0, term - Number(exitDay)));
  const maxFee = Math.round(Math.max(0, withdrawnUsd) * (exitFeeBps / 1e4) * MICRO) / MICRO;
  const raw = Math.max(0, withdrawnUsd) * (exitFeeBps / 1e4) * (remaining / term);
  const feeUsd = Math.min(maxFee, Math.round(raw * MICRO) / MICRO);
  return { withdrawnUsd, exitFeeBps, termDays: term, exitDay: Number(exitDay), remainingDays: remaining, feeUsd, maxFeeUsd: maxFee,
    formula: 'withdrawn × ExitFeeBps × remaining / term', mode: MODE };
}
// Distribute the fee to providers who STAY, weighted by tenure days. Largest-remainder in micro units (exact sum).
export function distributeExitFee(feeUsd, providers, { exitId, day }) {
  const stayers = byTenure(providers).filter((p) => p.id !== exitId && !p.exited);
  const total = Math.round(feeUsd * MICRO);
  if (!stayers.length || total <= 0) return { shares: [], distributedUsd: 0, undistributedUsd: feeUsd, note: stayers.length ? null : 'no stayers: fee not charged', mode: MODE };
  let w = stayers.map((p) => tenureDays(p, day));
  if (w.every((x) => x === 0)) w = w.map(() => 1);
  const W = w.reduce((s, x) => s + x, 0);
  const base = w.map((x) => Math.floor((total * x) / W));
  let left = total - base.reduce((s, x) => s + x, 0);
  const order = w.map((x, i) => [((total * x) / W) - base[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) base[order[k][1]]++;
  const shares = stayers.map((p, i) => ({ id: p.id, kind: p.kind, name: p.name, tenureDays: w[i] && W ? tenureDays(p, day) : 0, weight: w[i] / W, shareUsd: base[i] / MICRO }));
  return { shares, distributedUsd: base.reduce((s, x) => s + x, 0) / MICRO, undistributedUsd: 0, mode: MODE };
}
export function exitDemo({ providers = DEFAULT_PROVIDERS, exitId = 't2b', exitDay = 45, exitFeeBps = 200 } = {}) {
  const pr = providers.find((p) => p.id === exitId);
  if (!pr) return null;
  const fee = earlyExitFee({ withdrawnUsd: pr.capitalUsd, exitFeeBps, termDays: pr.termDays ?? 90, exitDay });
  const dist = distributeExitFee(fee.feeUsd, providers, { exitId, day: exitDay });
  return { exiting: { id: pr.id, name: pr.name, kind: pr.kind }, ...fee, netReturnedUsd: pr.capitalUsd - fee.feeUsd, distribution: dist, mode: MODE };
}

// ---------------------------------------------------------------- arbitrage burst
// External price jumps by jumpPct. An arbitrageur trades in steps until the AMM's marginal price (incl. fee) matches the
// new external price. The corridor re-pegs to the AMM before each step and absorbs the first part; its fills are marked
// to market at the new external price. There is NO oracle in the protocol:
//   - On-ledger, each provider's MinRate is a static worst acceptable price, set against the pre-jump reference.
//   - The protocol's own protection is the deterministic AMM-based volatility pause (AMM spot moved > pauseBps from the
//     reference).
//   - 'pause+software' adds the PROVIDER'S OWN OFF-LEDGER SOFTWARE (e.g. Titan Ghost's proprietary risk engine) that sees
//     the external price and, `providerUpdateLagSteps` steps later, submits a transaction updating its MinRate. That is
//     provider behaviour, not a protocol feature.
export const PROTECTION_LABELS = Object.freeze({
  none: 'Unprotected (static on-ledger MinRate only)',
  pause: 'Protocol volatility pause (AMM-based, deterministic)',
  'pause+software': 'Pause + provider software (off-ledger, e.g. Titan Ghost risk engine, updates MinRate by transaction)',
});
export function arbitrage(pool, { jumpPct = 3, improvementBps = 1, levelUsd = 2500, levels = 20, providers = DEFAULT_PROVIDERS, day = 60,
  steps = 8, pauseBps = 50, providerUpdateLagSteps = 1, protections = 'pause+software' } = {}) {
  const side = jumpPct >= 0 ? 'buy' : 'sell'; // price up: arb buys XRP (corridor asks get lifted); down: arb sells XRP
  const mid0 = spot(pool);
  const fair = mid0 * (1 + jumpPct / 100);
  const usePause = protections === 'pause+software' || protections === 'pause';
  const useSoftware = protections === 'pause+software';
  const totalDepth = ammDepthAt(pool, side, fair); // AMM depth an AMM-only arb would take
  const chunk = Math.max(totalDepth / Math.max(1, steps), 1e-6);
  const inv = new Map(providers.map((p) => [p.id, p.capitalUsd / mid0]));
  let p = pool, paused = false, pausedAt = null;
  const log = [];
  let corridorQty = 0, corridorLoss = 0, arbProfit = 0;
  for (let s = 0; s < steps * 4 && log.length < steps * 4; s++) {
    const moveBps = Math.abs(spot(p) / mid0 - 1) * 1e4;
    if (usePause && !paused && moveBps > pauseBps) { paused = true; pausedAt = s; }
    // Static on-ledger MinRate (set against mid0) until the provider's off-ledger software re-sets it by transaction.
    const minRateRef = useSoftware && s >= providerUpdateLagSteps ? fair : mid0;
    const lad = buildLadder(p, { side, improvementBps, levelUsd, levels, providers, day, referencePrice: minRateRef, inventory: inv, paused });
    const r = route(p, lad, chunk, { limitPrice: fair });
    if (r.qtyXrp <= EPS) { log.push({ step: s, ammSpot: spot(p), moveBps, paused, minRateRef, corridorXrp: 0, ammXrp: 0, done: true }); break; }
    let cq = 0, cl = 0;
    for (const leg of r.legs) if (leg.venue === 'corridor') for (const f of leg.fills) {
      inv.set(f.providerId, inv.get(f.providerId) - f.qtyXrp); cq += f.qtyXrp;
      cl += side === 'buy' ? (fair - leg.price) * f.qtyXrp : (leg.price - fair) * f.qtyXrp;
    }
    arbProfit += side === 'buy' ? fair * r.qtyXrp - r.amountRlusd : r.amountRlusd - fair * r.qtyXrp;
    corridorQty += cq; corridorLoss += cl;
    log.push({ step: s, ammSpot: spot(p), moveBps, paused, minRateRef, corridorXrp: cq, corridorLossRlusd: cl, ammXrp: r.ammQtyXrp });
    p = r.poolAfter;
  }
  return { jumpPct, side, mid0, fairPrice: fair, pauseBps, providerUpdateLagSteps, protections, protectionLabel: PROTECTION_LABELS[protections], pausedAtStep: pausedAt,
    corridorFilledXrp: corridorQty, corridorFilledUsd: corridorQty * mid0, corridorMtmLossRlusd: corridorLoss, arbitrageurProfitRlusd: arbProfit,
    ammSpotAfter: spot(p), steps: log, mode: MODE };
}
export function arbitrageComparison(pool, opts = {}) {
  const v = { none: arbitrage(pool, { ...opts, protections: 'none' }), pause: arbitrage(pool, { ...opts, protections: 'pause' }), pauseSoftware: arbitrage(pool, { ...opts, protections: 'pause+software' }) };
  const cut = (x) => (v.none.corridorMtmLossRlusd > 0 ? 1 - x.corridorMtmLossRlusd / v.none.corridorMtmLossRlusd : 0);
  return { variants: v, pauseCut: cut(v.pause), pauseSoftwareCut: cut(v.pauseSoftware), labels: PROTECTION_LABELS,
    note: 'No oracle in the protocol. On-ledger MinRate is static; the protocol protection is the AMM-based volatility pause. The software variant is a provider\'s own off-ledger system updating its MinRate by transaction.', mode: MODE };
}

// ---------------------------------------------------------------- scenarios
export const SCENARIOS = Object.freeze([
  { id: 'single', title: 'Single taker order', note: 'One order routed corridor-first vs AMM-only.' },
  { id: 'flow', title: 'Seeded taker flow', note: 'A seeded day of 40 taker orders (random sizes and sides); pool re-centred between orders by arbitrage.' },
  { id: 'arb-burst', title: 'Arbitrage burst', note: 'External price jumps; arbitrageur trades until the AMM matches. Shows the AMM-based protocol pause, plus a provider\'s own off-ledger software, capping corridor loss.' },
]);

export function seededFlow(pool, { seed = 1313, orders = 40, improvementBps = 1, levelUsd, levels, providers = DEFAULT_PROVIDERS, day = 60 } = {}) {
  const rnd = mulberry32(seedFrom(seed));
  const mid = spot(pool);
  const list = [];
  let saved = 0, ammTotal = 0;
  const earn = new Map(providers.map((p) => [p.id, 0]));
  for (let i = 0; i < orders; i++) {
    const sizeUsd = Math.round(250 * Math.exp(rnd() * Math.log(240))); // $250 .. $60,000, log-uniform
    const side = rnd() < 0.5 ? 'buy' : 'sell';
    const lad = buildLadder(pool, { side, improvementBps, levelUsd, levels, providers, day });
    const r = route(pool, lad, sizeUsd / mid);
    const sv = savings(pool, side, r);
    const pnl = providerPnl(lad, r, providers, { day });
    for (const row of pnl.rows) earn.set(row.id, earn.get(row.id) + row.spreadCapturedRlusd);
    saved += sv.savedRlusd; ammTotal += sv.ammOnly.amountRlusd;
    list.push({ i, side, sizeUsd, savedBps: sv.savedBps, savedRlusd: sv.savedRlusd, corridorShare: r.qtyXrp ? r.corridorQtyXrp / r.qtyXrp : 0 });
  }
  return { seed: seedFrom(seed), orders: list, takerSavedRlusd: saved, takerSavedBps: ammTotal ? (saved / ammTotal) * 1e4 : 0,
    providerEarnings: byTenure(providers).map((p) => ({ id: p.id, name: p.name, kind: p.kind, spreadCapturedRlusd: earn.get(p.id) })), mode: MODE };
}

// Depth chart points: AMM marginal curve vs corridor ladder steps, as bps vs mid against cumulative depth (USD).
export function depthChart(pool, ladder, { points = 60, maxUsd = null } = {}) {
  const mid = spot(pool), side = ladder.side;
  const maxX = (maxUsd ?? ladder.levelUsd * ladder.levels.length) / mid;
  const toBps = (pr) => spreadBps(side, pr, mid); // cost to the taker vs mid (positive = worse than mid)
  const amm = Array.from({ length: points + 1 }, (_, k) => { const q = (maxX * k) / points; return { depthUsd: q * mid, bps: toBps(ammMarginal(pool, side, q)) }; });
  const corridor = ladder.levels.filter((l) => l.depthFromXrp <= maxX).map((l) => ({ fromUsd: l.depthFromXrp * mid, toUsd: Math.min(l.depthToXrp, maxX) * mid, bps: toBps(l.price), capacityUsd: l.capacityXrp * mid, level: l.level }));
  return { amm, corridor, unit: 'bps vs AMM mid (taker cost)', mode: MODE };
}

// One call that the route and UI use. reference = { pool:{xrp, rlusd, tradingFee|feeBps}, mode, ... }.
export function simulate(reference, { sizeUsd = 10000, improvementBps = 1, side = 'buy', scenario = 'single', seed = 1313, levelUsd = 2500, levels = 20,
  day = 60, jumpPct = 3, pauseBps = 50, exitDay = 45, exitFeeBps = 200, providers = DEFAULT_PROVIDERS } = {}) {
  const pool = makePool(reference.pool);
  const imp = clampImprovement(improvementBps);
  const sd = side === 'sell' ? 'sell' : 'buy';
  const size = Math.min(250000, Math.max(50, Number(sizeUsd) || 10000));
  const mid = spot(pool);
  const ladder = buildLadder(pool, { side: sd, improvementBps: imp, levelUsd, levels, providers, day });
  const routed = route(pool, ladder, size / mid);
  const sv = savings(pool, sd, routed);
  const pnl = providerPnl(ladder, routed, providers, { day });
  const sc = SCENARIOS.some((s) => s.id === scenario) ? scenario : 'single';
  const sizes = [1000, 10000, 50000, 100000].map((u) => { const lad = buildLadder(pool, { side: sd, improvementBps: imp, levelUsd, levels, providers, day }); const r = route(pool, lad, u / mid); const s = savings(pool, sd, r); return { sizeUsd: u, savedBps: s.savedBps, savedRlusd: s.savedRlusd, fromImprovementBps: s.fromImprovementBps, fromAddedDepthBps: s.fromAddedDepthBps, corridorShare: r.corridorQtyXrp / r.qtyXrp }; });
  return {
    mode: MODE, model: MODEL_VERSION, hypothetical: true,
    inputs: { pool: { ...pool, mid, mode: reference.mode, observedAt: reference.observedAt ?? null, ledgerIndex: reference.ledgerIndex ?? null, source: reference.source ?? null } },
    params: { sizeUsd: size, sizeXrp: size / mid, improvementBps: imp, side: sd, scenario: sc, seed: seedFrom(seed), levelUsd, levels, day, jumpPct, pauseBps, exitDay, exitFeeBps },
    ladder, depth: depthChart(pool, ladder), route: routed, savings: sv, providers: pnl, sizes,
    exit: exitDemo({ providers, exitDay, exitFeeBps }),
    arbitrage: arbitrageComparison(pool, { jumpPct, improvementBps: imp, levelUsd, levels, providers, day, pauseBps }),
    flow: sc === 'flow' ? seededFlow(pool, { seed, improvementBps: imp, levelUsd, levels, providers, day }) : null,
    disclaimers: ['SIMULATION: modeled quotes and fills; nothing is signed, submitted or filled on any network.',
      'XDLC is a proposed XRPL amendment (draft): not submitted, reviewed, implemented in xrpld or activated.',
      'Providers and amounts are illustrative; only the AMM pool inputs come from the reference.'],
  };
}
