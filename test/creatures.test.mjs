import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATURES, creatureFor, catchBoard, sizeLabel } from '../public/creatures.js';

test('creature ladder: contiguous bands from plankton to kraken, matching the trading console', () => {
  assert.equal(CREATURES.length, 17);
  for (let i = 0; i < CREATURES.length - 1; i++) assert.equal(CREATURES[i].min, CREATURES[i + 1].max, CREATURES[i].id);
  assert.deepEqual(CREATURES.map(sizeLabel).slice(0, 2), ['100K+', '30K-100K']);
  assert.equal(sizeLabel(CREATURES.at(-1)), '<.1');
  const cases = { 0.01: 'PLANKTON', 0.1: 'AMOEBA', 0.25: 'KRILL', 0.4: 'SHRIMP', 0.7: 'MINNOW', 1: 'CRAB', 3: 'GOLDFISH', 10: 'OCTOPUS', 30: 'BARRACUDA', 60: 'DOLPHIN', 200: 'SHARK', 700: 'MANTA', 2000: 'WHALE', 7000: 'ORCA', 20000: 'LEVIATHAN', 50000: 'MEGALODON', 1e6: 'KRAKEN' };
  for (const [x, id] of Object.entries(cases)) assert.equal(creatureFor(Number(x)).id, id, x);
  assert.equal(creatureFor(-1).id, 'PLANKTON'); assert.equal(creatureFor('x').id, 'PLANKTON');
});

test('catchBoard: counts, biggest beast and last-5-minute window', () => {
  const now = Date.parse('2026-10-25T10:00:00Z');
  const b = catchBoard([{ xrp: 1.2, at: '2026-10-25T09:58:00Z' }, { xrp: 0.3, at: '2026-10-25T09:00:00Z' }, { xrp: 150, at: '2026-10-25T09:59:00Z' }], now);
  assert.equal(b.total, 3); assert.equal(b.biggest.creature, 'SHARK'); assert.equal(b.last5, 2); assert.equal(b.last5Big, 1);
  assert.equal(b.rows.find((r) => r.id === 'CRAB').caught, 1);
  assert.equal(catchBoard([]).biggest, null);
});
