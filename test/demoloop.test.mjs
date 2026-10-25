// Demo loop: pure logic with fake launch / pathfinder services (no network, nothing signed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoLoop, LoopError, normalizeLoopConfig, nextCode, LOOP_CAPS } from '../lib/demoloop.mjs';

function harness({ launchFails = false, runFails = false, launchRefuse = null, perHour = 0, clockStepMs = 1000 } = {}) {
  const taken = new Set(['BBL', 'LDN', 'L01']);
  const events = [], launches = [], runs = [];
  let t = Date.parse('2026-10-25T09:00:00Z');
  const sc = (k) => ({ payments: { planned: k, sent: k, succeeded: k, skipped: 0, failed: 0, bridged: k }, capture: { maker: { xrp: 0.8 * k, share: 0.8 }, rival: { xrp: 0.2 * k, share: 0.2 }, other: { xrp: 0, share: 0 } } });
  const loop = new DemoLoop({
    launch: (spec, extra) => {
      if (launchRefuse) return { status: launchRefuse, body: { errors: ['nope'] } };
      launches.push({ spec, extra }); taken.add(spec.code);
      return { status: 202, body: { id: `L${launches.length}` }, done: Promise.resolve(launchFails ? { status: 'failed', error: 'tecFAIL', steps: [] } : { status: 'live', fillHash: `H${launches.length}`, steps: [{ hash: 'a' }, { hash: 'b' }] }) };
    },
    pathfinder: {
      liveTokens: () => [...taken],
      paymentsLastHour: () => perHour,
      start: (body, o) => { const run = { id: `R${runs.length + 1}`, body, o }; runs.push(run); return run; },
      done: async (id) => {
        const r = runs.find((x) => x.id === id), k = r.body.k;
        return runFails ? { status: 'failed', error: 'Budget check failed', scorecard: sc(0), payments: [], actions: [] }
          : { status: 'done', scorecard: sc(k), payments: Array.from({ length: k }, () => ({ status: 'success', sizeXrp: 0.5 })), actions: [{ hash: 'q' }] };
      },
    },
    isTaken: (c) => taken.has(c),
    bus: { publish: (type, mode, p) => events.push({ type, mode, ...p }) },
    now: () => (t += clockStepMs),
    sleep: async () => {},
    readonly: () => false,
    id: () => 'S1',
  });
  return { loop, events, launches, runs, taken };
}

test('hourly cap is the Pathfinder cap (600, operator decision 2026-10-25)', () => {
  assert.equal(LOOP_CAPS.pathfinderPerHour, 600);
});

test('normalizeLoopConfig: defaults, anchor and bounds', () => {
  const c = normalizeLoopConfig({}, ['BBL', 'LDN']);
  assert.equal(c.rounds, LOOP_CAPS.rounds.def); assert.equal(c.anchor, 'LDN'); assert.equal(c.strategy, 'bridge_leg'); assert.equal(c.quoteXrp, null);
  assert.equal(normalizeLoopConfig({ quoteXrp: 10 }, ['LDN']).quoteXrp, 10);
  for (const bad of [{ rounds: 0 }, { rounds: 21 }, { k: 11 }, { minutes: 61 }, { quoteXrp: 16 }, { quoteXrp: 0.5 }, { maxVolumeXrp: 101 }, { anchor: 'ZZZ' }, { rounds: 2.5 }])
    assert.throws(() => normalizeLoopConfig(bad, ['LDN']), LoopError, JSON.stringify(bad));
});

test('nextCode skips taken and reserved tickers', () => {
  const taken = new Set(['L00', 'L01']);
  assert.deepEqual(nextCode((c) => taken.has(c)), { code: 'L02', n: 2 });
  assert.deepEqual(nextCode(() => false, 37), { code: 'L11', n: 37 });
  assert.match(nextCode(() => false).code, /^L[0-9A-Z]{2}$/);
  assert.equal(nextCode(() => true), null);
});

test('start requires explicit approval and refuses read-only', () => {
  const { loop } = harness();
  const cfg = normalizeLoopConfig({ rounds: 1 }, ['LDN']);
  assert.throws(() => loop.start(cfg, {}), (e) => e.status === 400 && /approval/.test(e.message));
  assert.throws(() => loop.start(cfg, { approved: 'yes' }), (e) => e.status === 400);
  const ro = new DemoLoop({ launch() {}, pathfinder: {}, isTaken: () => false, readonly: () => true });
  assert.throws(() => ro.start(cfg, { approved: true }), (e) => e.status === 403);
});

test('full cycle: each round launches a new token then runs a bridge_leg batch against the anchor', async () => {
  const { loop, launches, runs, events } = harness();
  const cfg = normalizeLoopConfig({ rounds: 3, k: 4, quoteXrp: 8, maxVolumeXrp: 100, holdSec: 0 }, ['BBL', 'LDN']);
  const s = loop.start(cfg, { approved: true });
  assert.throws(() => loop.start(cfg, { approved: true }), (e) => e.status === 409);
  await loop.done.get(s.id);
  assert.equal(s.status, 'stopped'); assert.match(s.stopReason, /3 rounds completed/);
  assert.equal(launches.length, 3);
  assert.deepEqual(launches.map((l) => l.spec.code), ['L00', 'L02', 'L03']); // L01 already taken
  assert.ok(launches.every((l) => l.spec.consent === true && l.extra.loop.sessionId === 'S1'));
  assert.equal(runs.length, 3);
  for (const [i, r] of runs.entries()) {
    assert.deepEqual(r.body.tokens, [launches[i].spec.code, 'LDN']);
    assert.equal(r.body.strategy, 'bridge_leg'); assert.equal(r.body.quoteXrp, 8); assert.equal(r.o.approved, true);
  }
  assert.equal(s.totals.rounds, 3); assert.equal(s.totals.directFills, 3); assert.equal(s.totals.pathPayments, 12); assert.equal(s.totals.bridged, 12);
  assert.equal(s.totals.volumeXrp, 3 * (1 + 4 * 0.5));
  assert.ok(Math.abs(s.totals.makerCaptureXrp / s.totals.capturedXrp - 0.8) < 1e-9);
  assert.equal(loop.active, null);
  assert.ok(events.some((e) => e.type === 'loop.started') && events.at(-1).type === 'loop.stopped');
  assert.ok(events.every((e) => e.mode === 'LIVE_TESTNET' && e.type.startsWith('loop.') && e.organic === false || e.type === 'loop.stopping'));
});

test('volume cap stops before a round that could exceed it', async () => {
  const { loop, launches } = harness();
  // worst case per round = 1 + 2 × 2 = 5 XRP; actual per round = 1 + 2 × 0.5 = 2 XRP
  const s = loop.start(normalizeLoopConfig({ rounds: 20, k: 2, maxVolumeXrp: 9, holdSec: 0 }, ['LDN']), { approved: true });
  await loop.done.get(s.id);
  assert.match(s.stopReason, /Volume cap/);
  // payments are clipped so the 2 XRP worst case always fits: k 2,2,2,1 (volume 2 -> 4 -> 6 -> 7.5), then no room
  assert.equal(launches.length, 4);
  assert.deepEqual(s.rounds.map((r) => r.k), [2, 2, 2, 1]);
  assert.ok(s.totals.volumeXrp <= 9);
});

test('time cap stops the session', async () => {
  const { loop } = harness({ clockStepMs: 61_000 });
  const s = loop.start(normalizeLoopConfig({ rounds: 20, minutes: 1, maxVolumeXrp: 100 }, ['LDN']), { approved: true });
  await loop.done.get(s.id);
  assert.match(s.stopReason, /Time cap/);
});

test('a failed launch or Pathfinder run stops the loop (fail safe)', async () => {
  const a = harness({ launchFails: true });
  const s1 = a.loop.start(normalizeLoopConfig({ rounds: 5 }, ['LDN']), { approved: true });
  await a.loop.done.get(s1.id);
  assert.match(s1.stopReason, /Launch L.. failed: tecFAIL/); assert.equal(a.runs.length, 0);

  const b = harness({ runFails: true });
  const s2 = b.loop.start(normalizeLoopConfig({ rounds: 5 }, ['LDN']), { approved: true });
  await b.loop.done.get(s2.id);
  assert.match(s2.stopReason, /Pathfinder run failed/); assert.equal(b.launches.length, 1);

  const c = harness({ launchRefuse: 429 });
  const s3 = c.loop.start(normalizeLoopConfig({ rounds: 5 }, ['LDN']), { approved: true });
  await c.loop.done.get(s3.id);
  assert.match(s3.stopReason, /Launch refused/);
});

test('Pathfinder hourly cap blocks the next round', async () => {
  const { loop, launches } = harness({ perHour: LOOP_CAPS.pathfinderPerHour });
  const s = loop.start(normalizeLoopConfig({ rounds: 5, k: 6 }, ['LDN']), { approved: true });
  await loop.done.get(s.id);
  assert.match(s.stopReason, /hourly cap/); assert.equal(launches.length, 0);
  // near the cap the round still runs, trimmed to what is left
  const near = harness({ perHour: LOOP_CAPS.pathfinderPerHour - 2 });
  const s2 = near.loop.start(normalizeLoopConfig({ rounds: 1, k: 6, holdSec: 0 }, ['LDN']), { approved: true });
  await near.loop.done.get(s2.id);
  assert.equal(near.runs[0].body.k, 2);
});

test('stop: the in-flight step finishes, no new round starts, and the reason is kept', async () => {
  const { loop, launches, runs } = harness();
  const s = loop.start(normalizeLoopConfig({ rounds: 10, maxVolumeXrp: 100 }, ['LDN']), { approved: true });
  loop.stop();
  assert.equal(s.status, 'stopping');
  await loop.done.get(s.id);
  assert.equal(s.status, 'stopped'); assert.match(s.stopReason, /operator/);
  assert.ok(launches.length <= 1 && runs.length <= 1);
  assert.equal(loop.stop(), null);
});

test('sessions interrupted by a restart are marked stopped and never resume', () => {
  const loop = new DemoLoop({ launch() {}, pathfinder: {}, isTaken: () => false, persist: { load: () => ({ sessions: [{ id: 'x', status: 'running', totals: {}, config: {} }] }), save() {} } });
  assert.equal(loop.active, null);
  assert.equal(loop.get('x').status, 'stopped'); assert.match(loop.get('x').stopReason, /restart/);
});

test('full cycle order: capital (SIM) -> launch (LIVE) -> corridor up (SIM) -> Pathfinder (LIVE) -> corridor down (SIM)', async () => {
  const order = [];
  const stages = {};
  const LADDER = ['spoke', 'growing_spoke', 'corridor'];
  const loop = new DemoLoop({
    launch: (spec) => { order.push(`launch ${spec.code} ${spec.category}`); stages[spec.code] = 'spoke'; return { status: 202, body: { id: 'L' }, done: Promise.resolve({ status: 'live', fillHash: 'H', steps: [] }) }; },
    pathfinder: { liveTokens: () => ['LDN'], paymentsLastHour: () => 0, start: (b) => { order.push(`pathfinder ${b.tokens.join('+')} at ${stages[b.tokens[0]]}`); return { id: 'R' }; }, done: async () => ({ status: 'done', scorecard: { payments: { planned: 1, sent: 1, succeeded: 1, skipped: 0, bridged: 1 }, capture: { maker: { xrp: 1, share: 1 }, rival: { xrp: 0, share: 0 }, other: { xrp: 0, share: 0 } } }, payments: [{ status: 'success', sizeXrp: 0.4 }], actions: [] }) },
    isTaken: () => false,
    capital: { inject: (b) => { order.push(`capital ${b.capitalUsd} ${b.marketId}`); return { ok: true, deployedUsd: 1 }; } },
    corridor: {
      simulate: (c, sc) => order.push(`simulate ${sc}`),
      promote: async (c, o) => { assert.equal(o.mode, 'SIMULATION'); assert.equal(o.approved, true); const from = stages[c]; const to = LADDER[LADDER.indexOf(from) + 1]; if (!to) return { status: 409, body: {} }; stages[c] = to; order.push(`promote ${to}`); return { status: 200, body: { from, to, score: 60 } }; },
      demote: (c, o) => { assert.equal(o.mode, 'SIMULATION'); const from = stages[c]; stages[c] = o.to; order.push(`demote ${o.to}`); return { status: 200, body: { from, to: o.to, releasedUsd: 290000 } }; },
      stage: (c) => stages[c],
    },
    sleep: async () => {}, readonly: () => false, id: () => 'S',
  });
  const s = loop.start(normalizeLoopConfig({ rounds: 1, capitalUsd: 250000 }, ['LDN']), { approved: true });
  await loop.done.get(s.id);
  assert.deepEqual(order, ['capital 250000 currencies', 'launch L00 currency', 'simulate growth', 'promote growing_spoke', 'promote corridor', 'pathfinder L00+LDN at corridor', 'simulate fade', 'demote standby']);
  const r = s.rounds[0];
  assert.equal(r.corridor.mode, 'SIMULATION'); assert.equal(r.corridor.peak, 'corridor'); assert.equal(r.corridor.down[0].releasedUsd, 290000);
  assert.equal(r.capital.mode, 'SIMULATION');
});

test('corridor off: no stand-up or teardown', async () => {
  const calls = [];
  const loop = new DemoLoop({
    launch: () => ({ status: 202, body: { id: 'L' }, done: Promise.resolve({ status: 'live', fillHash: 'H', steps: [] }) }),
    pathfinder: { liveTokens: () => ['LDN'], paymentsLastHour: () => 0, start: () => ({ id: 'R' }), done: async () => ({ status: 'done', scorecard: { payments: { planned: 0, sent: 0, succeeded: 0, skipped: 0, bridged: 0 }, capture: { maker: { xrp: 0, share: 0 }, rival: { xrp: 0, share: 0 }, other: { xrp: 0, share: 0 } } }, payments: [], actions: [] }) },
    isTaken: () => false,
    corridor: { simulate: () => calls.push('sim'), promote: async () => calls.push('p'), demote: () => calls.push('d'), stage: () => 'spoke' },
    sleep: async () => {}, readonly: () => false,
  });
  const s = loop.start(normalizeLoopConfig({ rounds: 1, corridor: false }, ['LDN']), { approved: true });
  await loop.done.get(s.id);
  assert.deepEqual(calls, []);
});

test('corridor window: Pathfinder pays on every router for the whole window, with replenish on', async () => {
  const { loop, runs } = harness();
  const s = loop.start(normalizeLoopConfig({ rounds: 1, k: 6, holdSec: 90, routers: 3, maxVolumeXrp: 100 }, ['LDN']), { approved: true });
  await loop.done.get(s.id);
  // 90 s / 4 s pace = 22 batches × 3 routers = 66 payments, within the 100 XRP worst case (1 + 66 × 2 > 100 -> clipped to 49)
  assert.equal(runs[0].body.routers, 3); assert.equal(runs[0].body.replenish, true);
  assert.equal(runs[0].body.k, 49);
  const one = harness();
  const s1 = one.loop.start(normalizeLoopConfig({ rounds: 1, k: 6, holdSec: 40, routers: 1 }, ['LDN']), { approved: true });
  await one.loop.done.get(s1.id);
  assert.equal(one.runs[0].body.k, 10); // 40 s / 4 s × 1 router
  assert.throws(() => normalizeLoopConfig({ routers: 4 }, ['LDN']), /routers/);
});

test('stop during a long window asks the running Pathfinder run to stop', async () => {
  const stopped = [];
  let release;
  const loop = new DemoLoop({
    launch: () => ({ status: 202, body: { id: 'L' }, done: Promise.resolve({ status: 'live', fillHash: 'H', steps: [] }) }),
    pathfinder: { liveTokens: () => ['LDN'], paymentsLastHour: () => 0, start: () => ({ id: 'R1' }), stop: (id) => { stopped.push(id); release(); }, done: () => new Promise((r) => { release = () => r({ status: 'done', scorecard: { payments: { planned: 9, sent: 3, succeeded: 3, skipped: 0, bridged: 3 }, capture: { maker: { xrp: 1, share: 1 }, rival: { xrp: 0, share: 0 }, other: { xrp: 0, share: 0 } } }, payments: [], actions: [] }); }) },
    isTaken: () => false, sleep: async () => {}, readonly: () => false,
  });
  const s = loop.start(normalizeLoopConfig({ rounds: 3, corridor: false }, ['LDN']), { approved: true });
  await new Promise((r) => setTimeout(r, 10));
  loop.stop();
  await loop.done.get(s.id);
  assert.deepEqual(stopped, ['R1']); assert.equal(s.status, 'stopped'); assert.equal(s.totals.rounds, 1);
});
