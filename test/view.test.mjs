// Titan View pure-logic tests: layout, ring bands, event reducer, hydrate, replay builder.
import test from 'node:test';
import assert from 'node:assert/strict';
import view, { initialState, reduce, hydrate, layoutNodes, ringBands, buildReplay, corridorItems, progressOf, phaseOf, normMode, explorerUrl, mergeStep, STEP_KEYS } from '../public/modules/20-view.js';
import { RINGS } from '../public/domain.js';

const H = 'A'.repeat(64);
const rec = (over = {}) => ({
  id: 'L1', code: 'BBL', name: 'Brooklyn Bullies', category: 'community', status: 'live', stage: 'spoke', fillHash: H, issuer: 'rISSUER',
  createdAt: '2026-10-23T22:51:51.384Z', completedAt: '2026-10-23T22:52:30.537Z', organic: false,
  steps: STEP_KEYS.map((key, i) => ({ key, label: key, status: 'done', startedAt: new Date(Date.parse('2026-10-23T22:51:51.385Z') + i * 5000).toISOString(), ...(i && i < 7 ? { hash: H, result: 'tesSUCCESS', ledger: 100 + i } : {}) })),
  ...over,
});
const run = (events, st = initialState()) => events.reduce((s, ev) => reduce(s, ev).state, st);

test('module shape', () => {
  assert.equal(view.id, 'view'); assert.equal(view.title, 'Titan View'); assert.equal(view.order, 20); assert.equal(typeof view.mount, 'function');
});

test('layoutNodes: evenly spaced on one orbit, first node at top', () => {
  const p = layoutNodes(4, { radius: 300 });
  assert.equal(p.length, 4);
  assert.ok(Math.abs(p[0].x) < 1e-6 && Math.abs(p[0].y + 300) < 1e-6);
  for (const n of p) assert.ok(Math.abs(Math.hypot(n.x, n.y) - 300) < 0.05);
  assert.deepEqual(layoutNodes(0), []);
});

test('layoutNodes: many nodes stagger, shrink and stay inside the viewBox', () => {
  const p = layoutNodes(40);
  assert.equal(new Set(p.map((n) => n.r)).size, 2);
  assert.ok(p[0].nodeR < 34 && p[0].nodeR >= 16);
  for (const n of p) assert.ok(Math.hypot(n.x, n.y) + n.nodeR + n.bandMax < 500);
});

test('ringBands: six bands in RINGS order, thickness proportional to allocation', () => {
  const rings = [{ id: 'CEILING', allocUsd: 100 }, { id: 'VELOCITY', allocUsd: 300 }, { id: 'EARN', allocUsd: 600 }];
  const b = ringBands(rings, { inner: 40, total: 60 });
  assert.deepEqual(b.map((x) => x.id), RINGS.map((r) => r.id));
  assert.equal(b[0].r0, 40); assert.ok(Math.abs(b[5].r1 - 100) < 0.05);
  for (let i = 1; i < 6; i++) assert.ok(Math.abs(b[i].r0 - b[i - 1].r1) < 0.02);
  const t = (id) => { const x = b.find((y) => y.id === id); return x.r1 - x.r0; };
  assert.ok(t('EARN') > t('VELOCITY') && t('VELOCITY') > t('CEILING') && t('CEILING') > t('DEEP'));
  assert.equal(b[0].illustrative, false);
});

test('ringBands: no allocation → equal illustrative bands', () => {
  const b = ringBands(undefined, { inner: 10, total: 30 });
  assert.ok(b.every((x) => x.illustrative && Math.abs(x.r1 - x.r0 - 5) < 0.02));
});

test('reducer: created → steps → done lights the spoke and emits a fill pulse', () => {
  let s = initialState(), fx;
  ({ state: s } = reduce(s, { type: 'launch.created', mode: 'LIVE_TESTNET', launchId: 'L9', code: 'NEW', name: 'New Co', category: 'currency' }));
  assert.deepEqual(s.order, ['NEW']); assert.equal(s.nodes.NEW.status, 'queued'); assert.equal(s.nodes.NEW.stage, 'entered');
  s = run([
    { type: 'launch.step', mode: 'LIVE_TESTNET', launchId: 'L9', code: 'NEW', step: { key: 'validate', status: 'done' } },
    { type: 'launch.step', mode: 'LIVE_TESTNET', launchId: 'L9', code: 'NEW', step: { key: 'trust_maker', status: 'running' } },
  ], s);
  assert.equal(s.nodes.NEW.status, 'running');
  assert.equal(progressOf(s.nodes.NEW), 1 / 8);
  assert.equal(phaseOf(s.nodes.NEW), 'Trustlines');
  ({ state: s, fx } = reduce(s, { type: 'launch.done', mode: 'LIVE_TESTNET', launchId: 'L9', code: 'NEW', name: 'New Co', fillHash: H, issuer: 'rX' }));
  assert.equal(s.nodes.NEW.status, 'live'); assert.equal(s.nodes.NEW.stage, 'spoke'); assert.equal(progressOf(s.nodes.NEW), 1);
  assert.deepEqual(fx, [{ kind: 'fill', code: 'NEW', mode: 'LIVE_TESTNET' }, { kind: 'creature', from: 'XRP', to: 'NEW', xrp: 1, mode: 'LIVE_TESTNET' }]);
  assert.equal(s.ticker[0].type, 'launch.done'); assert.match(s.ticker[0].text, /demo counterparty/);
});

test('reducer: step status never downgrades (SSE backlog)', () => {
  const st = mergeStep(mergeStep({}, { key: 'issue', status: 'done', hash: H }), { key: 'issue', status: 'running' });
  assert.equal(st.issue.status, 'done'); assert.equal(st.issue.hash, H);
});

test('reducer: duplicate launch.created is idempotent; failed launch greys out', () => {
  const ev = { type: 'launch.created', mode: 'LIVE_TESTNET', launchId: 'L1', code: 'ABC', name: 'A' };
  let s = run([ev, ev]);
  assert.equal(s.order.length, 1);
  s = run([{ type: 'launch.failed', mode: 'LIVE_TESTNET', launchId: 'L1', code: 'ABC', error: 'tecNO_LINE' }], s);
  assert.equal(s.nodes.ABC.status, 'failed'); assert.equal(phaseOf(s.nodes.ABC), 'Launch failed');
  s = run([{ type: 'launch.created', mode: 'LIVE_TESTNET', launchId: 'L2', code: 'ABC', name: 'A2' }], s); // retry after failure
  assert.equal(s.nodes.ABC.status, 'queued'); assert.equal(s.nodes.ABC.launchId, 'L2'); assert.equal(s.order.length, 1);
});

test('reducer: corridor stage graduation draws rings, demotion shrinks them back', () => {
  let s = hydrate(initialState(), [rec()]), fx;
  const rings = RINGS.map((r, i) => ({ id: r.id, allocUsd: 1000 * (i + 1), utilization: 0.5 }));
  ({ state: s, fx } = reduce(s, { type: 'corridor.stage_changed', mode: 'SIMULATION', code: 'BBL', from: 'spoke', to: 'corridor', rings }));
  assert.equal(s.nodes.BBL.ringsOn, true); assert.equal(s.nodes.BBL.ringsMode, 'SIMULATION');
  // A simulated graduation never relabels the token's real (live) stage.
  assert.equal(s.nodes.BBL.simStage, 'corridor'); assert.equal(s.nodes.BBL.stage, 'spoke'); assert.equal(s.nodes.BBL.stageMode, 'LIVE_TESTNET');
  assert.equal(fx[0].kind, 'graduate');
  ({ state: s, fx } = reduce(s, { type: 'corridor.stage_changed', mode: 'SIMULATION', code: 'BBL', from: 'corridor', to: 'standby' }));
  assert.equal(s.nodes.BBL.ringsOn, false); assert.equal(fx[0].kind, 'demote');
  const liveTrack = reduce(s, { type: 'corridor.stage_changed', mode: 'LIVE_TESTNET', code: 'BBL', from: 'spoke', to: 'corridor', rings }).state;
  assert.equal(liveTrack.nodes.BBL.ringsMode, 'SIMULATION', 'modeled ring capital is never labeled live');
  assert.equal(liveTrack.nodes.BBL.stage, 'corridor'); assert.equal(liveTrack.nodes.BBL.stageMode, 'LIVE_TESTNET');
  assert.equal(s.nodes.BBL.rings.length, 6, 'allocation retained so re-graduation is reversible');
  // a later hydrate keeps the simulated track and the live stage from the record
  s = hydrate(s, [rec()]);
  assert.equal(s.nodes.BBL.simStage, 'standby'); assert.equal(s.nodes.BBL.stage, 'spoke');
});

test('reducer: corridor event for an unknown code creates an external node in its own mode', () => {
  const s = run([{ type: 'corridor.stage_changed', mode: 'SIMULATION', code: 'TUS', from: 'spoke', to: 'mature' }]);
  assert.equal(s.nodes.TUS.external, true); assert.equal(s.nodes.TUS.stageMode, 'SIMULATION'); assert.equal(s.nodes.TUS.ringsOn, true);
});

test('reducer: capital.injected → domino fx; sentinel.finding marks node; unknown events only tick', () => {
  let s = hydrate(initialState(), [rec()]), fx;
  ({ state: s, fx } = reduce(s, { type: 'capital.injected', mode: 'SIMULATION', marketId: 'currencies', profileId: 'retail', capitalUsd: 5000, tierId: 'T1' }));
  assert.equal(fx[0].kind, 'domino'); assert.equal(s.capital.mode, 'SIMULATION');
  ({ state: s, fx } = reduce(s, { type: 'sentinel.finding', mode: 'SIMULATION', code: 'BBL', severity: 'high', title: 'Thin book' }));
  assert.equal(s.nodes.BBL.findings.length, 1); assert.equal(fx[0].kind, 'warn');
  const before = s;
  ({ state: s, fx } = reduce(s, { type: 'arena.completed', mode: 'SIMULATION' }));
  assert.deepEqual(fx, []); assert.deepEqual(s.nodes, before.nodes); assert.equal(s.ticker[0].type, 'arena.completed');
  assert.equal(reduce(s, null).state, s);
});

test('reducer: unlabeled modes are never treated as live; ticker capped at 20', () => {
  assert.equal(normMode(undefined), 'SIMULATION'); assert.equal(normMode('MAINNET'), 'SIMULATION'); assert.equal(normMode('LIVE_TESTNET'), 'LIVE_TESTNET');
  const s = run(Array.from({ length: 30 }, (_, i) => ({ type: 'x.y', mode: 'SIMULATION', at: String(i) })));
  assert.equal(s.ticker.length, 20); assert.equal(s.ticker[0].at, '29');
});

test('reducer: running steps are not added to the ticker', () => {
  const s = run([{ type: 'launch.step', mode: 'LIVE_TESTNET', code: 'QQQ', step: { key: 'issue', status: 'running' } }]);
  assert.equal(s.ticker.length, 0);
});

test('hydrate prefers the non-failed record per ticker and keeps step hashes', () => {
  const s = hydrate(initialState(), [rec({ id: 'old', status: 'failed', stage: 'entered' }), rec()]);
  assert.equal(s.nodes.BBL.launchId, 'L1'); assert.equal(s.nodes.BBL.status, 'live');
  assert.equal(s.nodes.BBL.steps.issue.hash, H);
  assert.equal(explorerUrl(s.nodes.BBL.steps.issue), `https://testnet.xrpl.org/transactions/${H}`);
  assert.equal(explorerUrl({ explorer: 'https://evil.example/x', hash: 'zz' }), null);
});

test('corridorItems tolerates several response shapes', () => {
  assert.deepEqual(corridorItems([{ code: 'bbl', stage: 'corridor', mode: 'SIMULATION' }]).map((x) => [x.code, x.stage]), [['BBL', 'corridor']]);
  assert.equal(corridorItems({ mode: 'SIMULATION', tokens: [{ ticker: 'BBL', stage: 'mature' }] })[0].mode, 'SIMULATION');
  assert.equal(corridorItems({ BBL: { stage: 'spoke' } })[0].code, 'BBL');
  assert.deepEqual(corridorItems({ items: [{ code: 'X', stage: 'nonsense' }] }), []);
  assert.deepEqual(corridorItems(null), []);
  const real = corridorItems({ modes: {}, tokens: [{ code: 'BBL', liveStage: 'spoke', simStage: null }, { code: 'ZZZ', liveStage: 'spoke', simStage: 'corridor' }] });
  assert.deepEqual(real.map((x) => [x.code, x.stage, x.mode]), [['BBL', 'spoke', 'LIVE_TESTNET'], ['ZZZ', 'spoke', 'LIVE_TESTNET'], ['ZZZ', 'corridor', 'SIMULATION']]);
});

test('buildReplay: chronological REPLAY events, compressed gaps, ends with done', () => {
  const ev = buildReplay([rec()]);
  assert.ok(ev.every((e) => e.ev.mode === 'REPLAY'));
  assert.equal(ev[0].ev.type, 'launch.created'); assert.equal(ev.at(-1).ev.type, 'launch.done');
  assert.ok(ev.every((e, i) => i === 0 || (e.delay >= 120 && e.delay <= 700)));
  const s = ev.reduce((st, e) => reduce(st, e.ev).state, initialState());
  assert.equal(s.nodes.BBL.status, 'live'); assert.equal(s.ticker[0].mode, 'REPLAY');
  assert.deepEqual(buildReplay([{ code: 'X' }]), []);
});

test('reducer: a pathfound payment swims a size-classed creature along its route', async () => {
  const { creatureFor } = await import('../public/creatures.js');
  const { fx, state } = reduce(initialState(), { type: 'pathfinder.payment', mode: 'LIVE_TESTNET', from: 'bkb', to: 'LDN', sizeXrp: 0.42, bridged: true, capturedBy: { maker: 0.8, rival: 0.1, other: 0 }, hash: 'H' });
  assert.deepEqual(fx, [{ kind: 'creature', from: 'BKB', to: 'LDN', xrp: 0.42, bridged: true, bucket: 'maker', mode: 'LIVE_TESTNET' }]);
  assert.equal(creatureFor(0.42).id, 'SHRIMP');
  assert.match(state.ticker[0].text, /SHRIMP caught · bkb→LDN 0\.420 XRP · bridged via XRP \(demo payment\)/);
  const rival = reduce(initialState(), { type: 'pathfinder.payment', mode: 'LIVE_TESTNET', from: 'XRP', to: 'LDN', sizeXrp: 1.5, capturedBy: { maker: 0, rival: 1.5, other: 0 } }).fx[0];
  assert.equal(rival.bucket, 'rival');
  assert.equal(reduce(initialState(), { type: 'pathfinder.payment', mode: 'BOGUS', from: 'XRP', to: 'LDN', sizeXrp: 1 }).fx[0].mode, 'SIMULATION'); // unknown mode never shows as live
});

test('ticker skips bookkeeping events; latestCapital picks the newest injection', async () => {
  const { tickerWorthy, latestCapital } = await import('../public/modules/20-view.js');
  for (const type of ['findings.updated', 'pathfinder.step', 'loop.round']) assert.equal(tickerWorthy({ type }), false, type);
  for (const type of ['pathfinder.payment', 'capital.injected', 'loop.started', 'findings.recorded']) assert.equal(tickerWorthy({ type }), true, type);
  assert.equal(latestCapital({}), null);
  const c = latestCapital({ snapshots: { currencies: { injections: [{ capitalUsd: 1, at: '2026-10-25T01:00:00Z', profileId: 'retail', tierId: 'T1' }] }, securities: { injections: [{ capitalUsd: 2e6, at: '2026-10-25T02:00:00Z', profileId: 'pro_mm', tierId: 'T2' }] } } });
  assert.deepEqual(c, { marketId: 'securities', profileId: 'pro_mm', tierId: 'T2', capitalUsd: 2e6, mode: 'SIMULATION', at: '2026-10-25T02:00:00Z' });
});
