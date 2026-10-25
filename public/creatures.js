// Fill-size creature ladder (matches the Titan trading console on NY-Node). Size = XRP value of one fill.
// Shared by the browser (import '/creatures.js') and Node (import '../public/creatures.js'). Pure, no DOM.
export const CREATURES = [
  { id: 'KRAKEN', emoji: '🦑', min: 100_000, max: Infinity, zone: 'DEEP/CEILING' },
  { id: 'MEGALODON', emoji: '🦖', min: 30_000, max: 100_000, zone: 'DEEP/CEILING' },
  { id: 'LEVIATHAN', emoji: '🐉', min: 10_000, max: 30_000, zone: 'DEEP/CEILING' },
  { id: 'ORCA', emoji: '🐳', min: 5_000, max: 10_000, zone: 'DEEP/CEILING' },
  { id: 'WHALE', emoji: '🐋', min: 1_000, max: 5_000, zone: 'MONEY/DEEP' },
  { id: 'MANTA', emoji: '🛸', min: 500, max: 1_000, zone: 'MONEY/DEEP' },
  { id: 'SHARK', emoji: '🦈', min: 100, max: 500, zone: 'MONEY' },
  { id: 'DOLPHIN', emoji: '🐬', min: 50, max: 100, zone: 'EARN/MONEY' },
  { id: 'BARRACUDA', emoji: '🔱', min: 25, max: 50, zone: 'BRIDGE/EARN' },
  { id: 'OCTOPUS', emoji: '🐙', min: 5, max: 25, zone: 'BRIDGE' },
  { id: 'GOLDFISH', emoji: '🐠', min: 2, max: 5, zone: 'BRIDGE' },
  { id: 'CRAB', emoji: '🦀', min: 1, max: 2, zone: 'VELOCITY/BRIDGE' },
  { id: 'MINNOW', emoji: '🐟', min: 0.5, max: 1, zone: 'VELOCITY' },
  { id: 'SHRIMP', emoji: '🍤', min: 0.35, max: 0.5, zone: 'VELOCITY' },
  { id: 'KRILL', emoji: '🦐', min: 0.2, max: 0.35, zone: 'VELOCITY' },
  { id: 'AMOEBA', emoji: '🦠', min: 0.1, max: 0.2, zone: 'VELOCITY' },
  { id: 'PLANKTON', emoji: '💧', min: 0, max: 0.1, zone: 'VELOCITY' },
];
// "Big" = SHARK and above (100+ XRP), for the last-5-minutes counter.
export const BIG_MIN_XRP = 100;

const label = (c) => (c.max === Infinity ? `${short(c.min)}+` : c.min === 0 ? `<${short(c.max)}` : `${short(c.min)}-${short(c.max)}`);
function short(x) { return x >= 1000 ? `${x / 1000}K` : String(x).replace(/^0\./, '.'); }
export const sizeLabel = label;

export function creatureFor(xrp) {
  const v = Number(xrp);
  if (!(v >= 0)) return CREATURES.at(-1);
  return CREATURES.find((c) => v >= c.min && v < c.max) || CREATURES.at(-1);
}

// Catch board from a list of fills [{ xrp, at }]. Pure: pass `now` for the last-5-minutes window.
export function catchBoard(fills, now = Date.now()) {
  const counts = Object.fromEntries(CREATURES.map((c) => [c.id, 0]));
  let biggest = null, last5Big = 0, last5 = 0;
  for (const f of fills) {
    const c = creatureFor(f.xrp);
    counts[c.id]++;
    if (!biggest || f.xrp > biggest.xrp) biggest = { ...f, creature: c.id, emoji: c.emoji };
    const recent = now - Date.parse(f.at) <= 5 * 60_000;
    if (recent) { last5++; if (f.xrp >= BIG_MIN_XRP) last5Big++; }
  }
  const max = Math.max(1, ...Object.values(counts));
  return {
    total: fills.length, biggest, last5, last5Big,
    rows: CREATURES.map((c) => ({ id: c.id, emoji: c.emoji, size: label(c), zone: c.zone, caught: counts[c.id], share: counts[c.id] / max })),
  };
}
