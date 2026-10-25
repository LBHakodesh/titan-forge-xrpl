// SIMULATION ocean: modeled fills sized by which liquidity rings are active, so the full creature ladder
// (plankton … kraken) can be shown. Nothing here is on-ledger: every fill it produces is SIMULATION.
//   - Rings unlock sizes (zones from the NY-Node trading console ladder): VELOCITY = smallest … CEILING = krakens.
//   - Active rings come from the token's corridor stage (spoke 2, growing spoke 3–4, corridor/mature 6, standby 1).
//   - Injected capital (SIMULATION) scales how often fills happen, not how big they are.
// Pure and deterministic given `rand`; shared by the browser (Titan View) and node:test.
import { CREATURES } from './creatures.js';

export const MODE = 'SIMULATION';
export const RING_ORDER = ['VELOCITY', 'BRIDGE', 'EARN', 'MONEY', 'DEEP', 'CEILING'];
export const RINGS_BY_STAGE = { entered: 0, spoke: 2, growing_spoke: 4, corridor: 6, mature: 6, standby: 1 };
// Modeled fills per minute per ring at $1M injected (inner rings fill often, outer rings rarely but big).
export const RING_RATE_PER_MIN = { VELOCITY: 18, BRIDGE: 9, EARN: 4, MONEY: 2, DEEP: 1.2, CEILING: 2.4 };
export const CAPITAL_REF_USD = 1_000_000;
export const MAX_FILLS_PER_TICK = 6;
export const SIZE_DECAY = 0.72; // each size step up within a ring is 0.72× as likely

// Creatures each ring can produce: any creature whose console zone names the ring.
export const RING_CREATURES = Object.fromEntries(RING_ORDER.map((ring) => [ring, CREATURES.filter((c) => c.zone.split('/').includes(ring))]));

export const capitalFactor = (usd) => Math.max(0.2, Math.min(3, (Number(usd) || 0) / CAPITAL_REF_USD));
export function activeRings(stage, rings) {
  if (Array.isArray(rings) && rings.some((r) => Number(r.allocUsd) > 0)) return RING_ORDER.filter((id) => rings.some((r) => r.id === id && Number(r.allocUsd) > 0));
  return RING_ORDER.slice(0, RINGS_BY_STAGE[stage] ?? 0);
}

// Pick a creature within a ring: smaller creatures in the ring are more common (SIZE_DECAY per size step up).
export function pickCreature(ring, rand) {
  const list = RING_CREATURES[ring] || [];
  if (!list.length) return null;
  const smallFirst = [...list].reverse();
  const weights = smallFirst.map((_, i) => SIZE_DECAY ** i);
  let u = rand() * weights.reduce((a, b) => a + b, 0);
  let c = smallFirst.at(-1);
  for (let i = 0; i < smallFirst.length; i++) { if ((u -= weights[i]) <= 0) { c = smallFirst[i]; break; } }
  // Size within the creature's band, log-uniform; the open-ended kraken band runs 100K–1M XRP.
  const lo = Math.max(c.min, 0.01), hi = c.max === Infinity ? c.min * 10 : c.max;
  const xrp = Math.exp(Math.log(lo) + rand() * (Math.log(hi) - Math.log(lo)));
  return { creature: c.id, emoji: c.emoji, xrp: Number(xrp.toPrecision(4)), ring };
}

// Fills for one tick of `dtSec` across tokens [{ code, stage, rings }], given injected capital.
// Poisson-ish: each ring's expected count = rate × dt × capital factor; capped per tick so the screen stays readable.
export function oceanTick(tokens, { capitalUsd, dtSec, rand = Math.random }) {
  if (!(capitalUsd > 0) || !tokens.length) return [];
  const f = capitalFactor(capitalUsd);
  const out = [];
  for (const t of tokens) {
    for (const ring of activeRings(t.stage, t.rings)) {
      let expect = (RING_RATE_PER_MIN[ring] / 60) * dtSec * f;
      while (expect > 0) {
        if (rand() < Math.min(1, expect)) { const p = pickCreature(ring, rand); if (p) out.push({ ...p, code: t.code, mode: MODE }); }
        expect -= 1;
      }
    }
  }
  // Keep the biggest when over the cap, so outer-ring creatures are never crowded out by plankton.
  return out.sort((a, b) => b.xrp - a.xrp).slice(0, MAX_FILLS_PER_TICK);
}

// Seeded PRNG (mulberry32) for repeatable demos and tests.
export function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
