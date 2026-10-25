import test from 'node:test';
import assert from 'node:assert/strict';
import { oceanTick, activeRings, pickCreature, RING_CREATURES, seeded, capitalFactor, MAX_FILLS_PER_TICK } from '../public/ocean.js';
import { creatureFor } from '../public/creatures.js';

const run = (stage, sec, capitalUsd = 1e6, seed = 9) => {
  const rand = seeded(seed), out = [];
  for (let i = 0; i < sec; i++) out.push(...oceanTick([{ code: 'L00', stage }], { capitalUsd, dtSec: 1, rand }));
  return out;
};

test('rings unlock sizes: spoke never shows outer-ring creatures; corridor reaches krakens', () => {
  assert.deepEqual(activeRings('spoke'), ['VELOCITY', 'BRIDGE']);
  assert.deepEqual(activeRings('standby'), ['VELOCITY']);
  assert.equal(activeRings('corridor').length, 6);
  assert.deepEqual(activeRings('corridor', [{ id: 'VELOCITY', allocUsd: 5 }, { id: 'CEILING', allocUsd: 1 }, { id: 'DEEP', allocUsd: 0 }]), ['VELOCITY', 'CEILING']);
  assert.ok(run('spoke', 600).every((f) => f.xrp < 50), 'spoke stays at barracuda or smaller');
  assert.ok(run('standby', 600).every((f) => f.xrp < 2), 'standby stays at crab or smaller');
  const big = run('corridor', 600).map((f) => f.creature);
  for (const id of ['KRAKEN', 'MEGALODON', 'LEVIATHAN', 'ORCA']) assert.ok(big.includes(id), `${id} appears in 10 min of corridor`);
});

test('every modeled fill is SIMULATION and its size matches its creature', () => {
  const fills = run('corridor', 300);
  assert.ok(fills.length > 50);
  for (const f of fills) { assert.equal(f.mode, 'SIMULATION'); assert.equal(creatureFor(f.xrp).id, f.creature, `${f.xrp} ${f.creature}`); assert.ok(RING_CREATURES[f.ring].some((c) => c.id === f.creature)); }
});

test('capital scales frequency, not size; no capital means no ocean; per-tick cap', () => {
  assert.equal(oceanTick([{ code: 'A', stage: 'corridor' }], { capitalUsd: 0, dtSec: 1 }).length, 0);
  assert.equal(capitalFactor(1e6), 1); assert.equal(capitalFactor(1e9), 3); assert.equal(capitalFactor(1), 0.2);
  assert.ok(run('corridor', 300, 3e6).length > run('corridor', 300, 2e5).length * 3);
  const burst = oceanTick(Array.from({ length: 20 }, (_, i) => ({ code: `T${i}`, stage: 'corridor' })), { capitalUsd: 3e6, dtSec: 1, rand: seeded(3) });
  assert.ok(burst.length <= MAX_FILLS_PER_TICK);
  assert.ok(pickCreature('CEILING', seeded(1)).xrp >= 5000);
});
