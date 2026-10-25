// Titan Ghost Engine Theater: DOLPHIN / SHARK / WHALE / KRAKEN scenarios.
// SIMULATION ONLY. Deterministic, seeded replay of hypothetical taker fills against MODELED ring depth.
// Pure: no I/O, no clock, no network. Same (id, seed, options) -> byte-identical output.
// Fake fills never carry a transaction hash (hash: null) and every number object carries mode SIMULATION.
// Ring depth comes from the engine seam (`allocate`, normally getEngine().allocate) — today the temporary demo
// adapter, later the authentic Rust Strategic Engine. Nothing here is a Titan Ghost proprietary parameter.
import { RINGS, allocateRings } from '../../public/domain.js';
import { CREATURES } from '../../public/creatures.js';

export const SIM = 'SIMULATION';
// Illustrative XRP/USD conversion for the model only (same demo default as the access policy). Not a price feed.
export const MODEL_XRP_USD = 2.0;
export const MODEL_BOOK_USD = 1_000_000;

// Fill counts per scenario; Infinity-capped creatures (KRAKEN) draw from [min, 3×min).
export const SCENARIOS = [
  { id: 'DOLPHIN', fills: 4, side: 'mixed', blurb: 'Retail-size taker flow. Lands in the innermost VELOCITY ring.' },
  { id: 'SHARK', fills: 4, side: 'mixed', blurb: 'Larger tickets. Still absorbed by the tight rings.' },
  { id: 'WHALE', fills: 4, side: 'ask', blurb: 'Block-size buying. Drains VELOCITY and spills into BRIDGE.' },
  { id: 'KRAKEN', fills: 1, side: 'ask', blurb: 'One sweep across several rings, inventory shifts, then a capital-optimization step.' },
].map((s) => { const c = CREATURES.find((x) => x.id === s.id); return { ...s, emoji: c.emoji, minXrp: c.min, maxXrp: c.max === Infinity ? c.min * 3 : c.max, zone: c.zone }; });

export const SCENARIO_IDS = SCENARIOS.map((s) => s.id);

// mulberry32 over a string-hashed seed.
function rng(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r2 = (x) => Math.round(x * 100) / 100;

// Build per-side ring depth (USD) from an allocation: half of each ring quotes ASK (XRP out), half BID (RLUSD out).
export function bookFromAllocation(alloc) {
  return RINGS.map((spec) => { const a = alloc.rings.find((r) => r.id === spec.id)?.allocUsd || 0; return { id: spec.id, spreadBps: spec.spreadBps, askUsd: a / 2, bidUsd: a / 2, allocUsd: a }; });
}

// Walk rings innermost -> outermost taking depth on one side. Mutates `book`. Returns hits + unfilled remainder.
export function sweep(book, side, sizeUsd) {
  const key = side === 'ask' ? 'askUsd' : 'bidUsd';
  let remaining = sizeUsd; const hits = [];
  for (const r of book) {
    if (remaining <= 1e-9) break;
    const take = Math.min(remaining, r[key]);
    if (take <= 0) continue;
    r[key] -= take; remaining -= take;
    hits.push({ ring: r.id, takeUsd: r2(take), spreadBps: r.spreadBps, captureUsd: r2(take * r.spreadBps / 10_000) });
  }
  return { hits, unfilledUsd: r2(Math.max(0, remaining)) };
}

export function generateScenario(id, { seed = 1, allocate = allocateRings, engineLabel = null, xrpUsd = MODEL_XRP_USD, bookUsd = MODEL_BOOK_USD } = {}) {
  const sc = SCENARIOS.find((s) => s.id === String(id).toUpperCase());
  if (!sc) throw Object.assign(new Error(`Unknown scenario ${id}. Use one of ${SCENARIO_IDS.join(', ')}.`), { status: 404 });
  const rand = rng(`${sc.id}:${seed}`);
  const alloc = allocate(bookUsd, {});
  const book = bookFromAllocation(alloc);
  const initialBook = book.map((r) => ({ ...r, askUsd: r2(r.askUsd), bidUsd: r2(r.bidUsd), allocUsd: r2(r.allocUsd) }));
  const inv = { xrp: (bookUsd / 2) / xrpUsd, rlusd: bookUsd / 2 };
  const startInv = { xrp: r2(inv.xrp), rlusd: r2(inv.rlusd) };
  const steps = [];
  let captureUsd = 0, volumeUsd = 0;
  for (let i = 0; i < sc.fills; i++) {
    // KRAKEN: one block taker sweep from the lower part of its band (100k-160k XRP), sized to cross several rings.
    const u = sc.id === 'KRAKEN' ? rand() * 0.3 : rand();
    const sizeXrp = r2(sc.minXrp + u * (sc.maxXrp - sc.minXrp));
    const side = sc.side === 'mixed' ? (rand() < 0.5 ? 'ask' : 'bid') : sc.side;
    const sizeUsd = sizeXrp * xrpUsd;
    const { hits, unfilledUsd } = sweep(book, side, sizeUsd);
    const filledUsd = sizeUsd - unfilledUsd;
    const cap = hits.reduce((s, h) => s + h.captureUsd, 0);
    // Taker buys XRP on our ASK: we deliver XRP, receive RLUSD (+ spread). Taker sells XRP on our BID: the reverse.
    if (side === 'ask') { inv.xrp -= filledUsd / xrpUsd; inv.rlusd += filledUsd + cap; }
    else { inv.rlusd -= filledUsd; inv.xrp += (filledUsd + cap) / xrpUsd; }
    captureUsd += cap; volumeUsd += filledUsd;
    steps.push({
      i, kind: 'fill', mode: SIM, hash: null, creature: sc.id, emoji: sc.emoji,
      side: side.toUpperCase(), takerAction: side === 'ask' ? 'taker buys XRP (hits our ASK)' : 'taker sells XRP (hits our BID)',
      sizeXrp, sizeUsd: r2(sizeUsd), filledUsd: r2(filledUsd), unfilledUsd,
      rings: hits.map((h) => h.ring), hits, impactBps: hits.length ? hits.at(-1).spreadBps : null,
      spreadCaptureUsd: r2(cap),
      inventory: { mode: SIM, xrp: r2(inv.xrp), rlusd: r2(inv.rlusd) },
      depth: book.map((r) => ({ ring: r.id, askUsd: r2(r.askUsd), bidUsd: r2(r.bidUsd) })),
    });
  }
  let optimization = null;
  if (sc.id === 'KRAKEN') {
    // Capital-optimization step: re-run the engine on the post-sweep portfolio value, and size the inventory rebalance.
    const valueUsd = inv.xrp * xrpUsd + inv.rlusd;
    const re = allocate(valueUsd, {});
    const target = re.rings.map((r) => ({ ring: r.id, beforeUsd: r2(book.find((b) => b.id === r.id).askUsd + book.find((b) => b.id === r.id).bidUsd), afterUsd: r2(r.allocUsd) }));
    const xrpShare = (inv.xrp * xrpUsd) / valueUsd;
    const rebalanceUsd = r2(Math.abs(0.5 - xrpShare) * valueUsd);
    optimization = {
      kind: 'optimize', mode: SIM, hash: null, executed: false,
      source: engineLabel || 'engine seam (allocate)',
      portfolioUsd: r2(valueUsd), xrpShare: r2(xrpShare * 100) / 100,
      rebalance: { usd: rebalanceUsd, direction: xrpShare < 0.5 ? 'RLUSD -> XRP' : 'XRP -> RLUSD', note: 'Modeled rebalance back to a 50/50 inventory. Proposal only, never executed.' },
      rings: target, deployedUsd: r2(re.deployedUsd), idleUsd: r2(re.idleUsd), yieldBpsOnDeployed: r2(re.yieldBpsOnDeployed),
      ringsRefilled: target.filter((t) => t.afterUsd > t.beforeUsd + 1).map((t) => t.ring),
    };
  }
  const swept = [...new Set(steps.flatMap((s) => s.rings))];
  return {
    mode: SIM, scenario: sc.id, emoji: sc.emoji, blurb: sc.blurb, seed, hypothetical: true,
    statement: 'SIMULATION: hypothetical fills against modeled ring depth. No transaction was signed or submitted; no fill here has a hash.',
    assumptions: { xrpUsd, xrpUsdSource: 'illustrative model constant, not a market price', bookUsd, market: 'XRP/RLUSD (modeled)', engine: engineLabel || 'engine seam (allocate)', sizeBandXrp: [sc.minXrp, sc.maxXrp] },
    initialBook, startInventory: startInv, steps, optimization,
    totals: { mode: SIM, fills: steps.length, volumeUsd: r2(volumeUsd), spreadCaptureUsd: r2(captureUsd), ringsSwept: swept, unfilledUsd: r2(steps.reduce((s, x) => s + x.unfilledUsd, 0)), endInventory: { xrp: r2(inv.xrp), rlusd: r2(inv.rlusd) } },
  };
}

export function scenarioCatalog() {
  return SCENARIOS.map(({ id, emoji, minXrp, maxXrp, zone, fills, blurb }) => ({ id, emoji, minXrp, maxXrp, zone, fills, blurb, mode: SIM }));
}
