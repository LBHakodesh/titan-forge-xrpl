import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../lib/arena.mjs';

const QUIZ_KEY = { q_stage: 'titan', q_score: 'titan', q_capital: 'titan', q_recs: 'titan', q_rings: 'titan', q_xdlc: 'xdlc', q_xdlc2: 'xdlc' };
const right = (s) => Object.fromEntries(s.scenario.quiz.map((q) => [q, QUIZ_KEY[q] || 'xrpl']));
const strip = (s) => { const c = structuredClone(s); delete c.id; delete c.createdAt; delete c.completedAt; return c; };

// A careful player: balanced spoke, verifiable diverse LPs, no traps, honest assessment.
function careful(seed) {
  let s = A.createSession({ seed });
  const go = (a) => (s = A.applyAction(s, a));
  go({ type: 'name', name: 'Harbour Coffee Club', code: 'HCC', category: 'community' });
  go({ type: 'market', marketId: 'currencies' });
  go({ type: 'spoke', capitalUsd: 100_000, spread: 'balanced' });
  go({ type: 'recruit', accept: [], custom: [{ profileId: 'pro_mm', tier: 'T2' }, { profileId: 'pro_mm', tier: 'T3' }] });
  go({ type: 'rounds' });
  const t = A.riskTruth(s);
  go({ type: 'assess', flags: Object.keys(t).filter((k) => t[k]), efficiency: A.efficiencyTruth(s) });
  go({ type: 'promote', request: s.gate.eligible });
  go({ type: 'compared' });
  go({ type: 'quiz', answers: right(s) });
  return s;
}
// A reckless player: takes every offer including traps, flags nothing, requests promotion anyway.
function reckless(seed) {
  let s = A.createSession({ seed });
  const go = (a) => (s = A.applyAction(s, a));
  go({ type: 'name', name: 'Moon Rocks', code: 'MRK', category: 'community' });
  go({ type: 'market', marketId: 'real_estate' });
  go({ type: 'spoke', capitalUsd: 1_000, spread: 'tight' });
  go({ type: 'recruit', accept: s.scenario.offers.map((o) => o.id) });
  go({ type: 'rounds' });
  go({ type: 'assess', flags: [], efficiency: 'add' });
  go({ type: 'promote', request: true });
  go({ type: 'compared' });
  go({ type: 'quiz', answers: Object.fromEntries(s.scenario.quiz.map((q) => [q, 'xdlc'])) });
  return s;
}

test('same seed and actions give identical sessions; different seeds differ', () => {
  assert.deepEqual(strip(careful(7)), strip(careful(7)));
  assert.deepEqual(strip(reckless('booth-1')), strip(reckless('booth-1')));
  assert.notDeepEqual(careful(7).rounds, careful(8).rounds);
  const r1 = A.rng(5), r2 = A.rng(5);
  for (let i = 0; i < 20; i++) assert.equal(r1(), r2());
});

test('full playthrough reaches debrief with a breakdown and debrief', () => {
  const s = careful(42);
  assert.equal(s.step, 'debrief');
  assert.equal(s.mode, 'SIMULATION');
  assert.equal(s.rounds.length, A.ROUNDS);
  assert.ok(s.rounds.every((r) => r.mode === 'SIMULATION'));
  assert.ok(s.score.total > 80, `careful score ${s.score.total}`);
  assert.equal(s.score.max, 100);
  assert.ok(s.debrief.length >= 1);
  assert.ok(s.promotion.granted);
  assert.equal(s.comparison.reinforced.mode, 'SIMULATION');
  const v = A.publicView(s);
  assert.equal(v.scenario.quiz, undefined); // answers not exposed via scenario
});

test('careful play beats reckless play for many seeds', () => {
  for (const seed of [1, 2, 3, 4, 5, 99, 'abc']) assert.ok(careful(seed).score.total > reckless(seed).score.total + 40, `seed ${seed}`);
});

test('scoring never rewards price appreciation', () => {
  const s = careful(11);
  const base = A.computeScore(s);
  const pumped = structuredClone(s);
  pumped.rounds.forEach((r, i) => { r.midXrp = r.midXrp * 10 ** (i + 1); });
  const dumped = structuredClone(s);
  dumped.rounds.forEach((r) => { r.midXrp = r.midXrp / 1000; });
  assert.deepEqual(A.computeScore(pumped), base);
  assert.deepEqual(A.computeScore(dumped), base);
  assert.ok(base.notScored.some((x) => /price/i.test(x.label) && x.pts === 0));
  // Wash trading inflates displayed volume and the sim mid, yet costs points.
  const r = reckless(11);
  assert.ok(r.rounds.some((x) => x.washVolumeUsd > 0));
  const washItem = r.score.categories.find((c) => c.id === 'risk').items.find((x) => /wash/i.test(x.label) && x.max === 6);
  assert.equal(washItem.pts, 0);
});

test('promotion is gated on evidence and shows what is missing', () => {
  const r = reckless(3);
  assert.equal(r.gate.eligible, false);
  assert.ok(r.gate.missing.length >= 3);
  assert.ok(r.gate.missing.some((m) => /wash/i.test(m)));
  assert.ok(r.gate.missing.some((m) => /unfunded/i.test(m)));
  assert.equal(r.promotion.requested, true);
  assert.equal(r.promotion.granted, false);
  assert.notEqual(r.promotion.stage, 'corridor');
  const promoItem = r.score.categories.find((c) => c.id === 'informed').items.find((x) => x.label === 'Promotion decision');
  assert.equal(promoItem.pts, 0);
});

test('flagging wash/unfunded excludes them from evidence', () => {
  let s = A.createSession({ seed: 21 });
  const go = (a) => (s = A.applyAction(s, a));
  go({ type: 'name', name: 'Test Coin', code: 'TCN', category: 'community' });
  go({ type: 'market', marketId: 'currencies' });
  go({ type: 'spoke', capitalUsd: 100_000, spread: 'balanced' });
  const traps = s.scenario.offers.filter((o) => o.kind !== 'genuine').map((o) => o.id);
  go({ type: 'recruit', accept: traps, custom: [{ profileId: 'pro_mm', tier: 'T2' }, { profileId: 'pro_mm', tier: 'T3' }] });
  go({ type: 'rounds' });
  go({ type: 'assess', flags: ['unfunded', 'wash', 'issuer_controls'], efficiency: 'hold' });
  assert.deepEqual(s.excluded.sort(), traps.sort());
  const g = Object.fromEntries(s.gate.checks.map((c) => [c.id, c.ok]));
  assert.equal(g.wash, true); assert.equal(g.unfunded, true);
});

test('invalid actions are rejected', () => {
  const s0 = A.createSession({ seed: 1 });
  const bad = (s, a, re) => assert.throws(() => A.applyAction(s, a), (e) => e instanceof A.ArenaError && (!re || re.test(e.message)));
  bad(s0, null);
  bad(s0, { type: 'hack' }, /Unknown action/);
  bad(s0, { type: 'market', marketId: 'currencies' }, /current step/);
  bad(s0, { type: 'name', name: 'Ripple Bucks', code: 'RPB', category: 'community' }, /ripple/);
  bad(s0, { type: 'name', name: 'Dollar', code: 'USD', category: 'community' }, /reserved/);
  bad(s0, { type: 'link' }, /live Testnet token/);
  bad(s0, { type: 'link' }, /live/);
  assert.throws(() => A.applyAction(s0, { type: 'link' }, { launch: { status: 'failed' } }), A.ArenaError);
  let s = A.applyAction(s0, { type: 'name', name: 'Good Name', code: 'GDN', category: 'community' });
  bad(s, { type: 'market', marketId: 'mainnet' }, /Unknown market/);
  s = A.applyAction(s, { type: 'market', marketId: 'securities' });
  bad(s, { type: 'spoke', capitalUsd: 5e12, spread: 'tight' }, /Starting capital/);
  bad(s, { type: 'spoke', capitalUsd: 1000, spread: 'zero' }, /Spread/);
  s = A.applyAction(s, { type: 'spoke', capitalUsd: 10_000, spread: 'wide' });
  bad(s, { type: 'recruit', accept: ['o1', 'o1'] }, /Duplicate/);
  bad(s, { type: 'recruit', accept: ['nope'] }, /Unknown offer/);
  bad(s, { type: 'recruit', custom: [{ profileId: 'whale', tier: 'T1' }] }, /profile/);
  bad(s, { type: 'recruit', custom: [{ profileId: 'retail', tier: 'T9' }] }, /Tier/);
  bad(s, { type: 'recruit', custom: [1, 2, 3].map(() => ({ profileId: 'retail', tier: 'T1' })) }, /At most/);
  s = A.applyAction(s, { type: 'recruit', accept: [] });
  bad(s, { type: 'assess', flags: [], efficiency: 'hold' }, /current step/);
  s = A.applyAction(s, { type: 'rounds' });
  bad(s, { type: 'round' }, /current step/);
  bad(s, { type: 'assess', flags: ['moon'], efficiency: 'hold' }, /risk flag/);
  bad(s, { type: 'assess', flags: [], efficiency: 'yolo' }, /efficiency/);
  s = A.applyAction(s, { type: 'assess', flags: [], efficiency: 'hold' });
  bad(s, { type: 'promote', request: 'yes' }, /true or false/);
  s = A.applyAction(s, { type: 'promote', request: false });
  s = A.applyAction(s, { type: 'compared' });
  bad(s, { type: 'quiz', answers: {} }, /Answer every/);
  bad(s, { type: 'quiz', answers: right(s), alias: 'Official Bank of X' });
  s = A.applyAction(s, { type: 'quiz', answers: right(s) });
  bad(s, { type: 'round' }, /finished/);
  bad(s, { type: 'alias', alias: 'x'.repeat(30) });
  s = A.applyAction(s, { type: 'alias', alias: 'Booth Hero' });
  assert.equal(s.alias, 'Booth Hero');
  assert.throws(() => A.createSession({ seed: 'bad seed!' }), A.ArenaError);
  assert.equal(A.validateAlias('Coinbase fan').ok, false);
});

test('round-by-round equals play-all; reducer does not mutate input', () => {
  let a = A.createSession({ seed: 5 });
  for (const act of [{ type: 'name', name: 'Abc Def', code: 'ABD', category: 'currency' }, { type: 'market', marketId: 'precious_metals' }, { type: 'spoke', capitalUsd: 10_000, spread: 'tight' }, { type: 'recruit', accept: ['o1'] }]) a = A.applyAction(a, act);
  const frozen = JSON.stringify(a);
  let b = A.applyAction(a, { type: 'rounds' });
  assert.equal(JSON.stringify(a), frozen);
  let c = a; for (let i = 0; i < A.ROUNDS; i++) c = A.applyAction(c, { type: 'round' });
  assert.deepEqual(b.rounds, c.rounds);
  assert.equal(c.step, 'assess');
});

test('linking a live launch shows LIVE_TESTNET facts, organic false, game stays SIMULATION', () => {
  const launch = { id: 'L1', status: 'live', name: 'Brooklyn Bullies', code: 'BBL', category: 'community', issuer: 'rISSUER', fillHash: 'ABC',
    steps: [{ key: 'fill', label: 'fill', hash: 'ABC', result: 'tesSUCCESS', ledger: 1, explorer: 'https://testnet.xrpl.org/transactions/ABC' }], book: { asks: [], bids: [] } };
  const s = A.applyAction(A.createSession({ seed: 1 }), { type: 'link', launchId: 'L1' }, { launch });
  assert.equal(s.mode, 'SIMULATION');
  assert.equal(s.project.linked.mode, 'LIVE_TESTNET');
  assert.equal(s.project.linked.bookMode, 'REPLAY');
  assert.equal(s.project.linked.organic, false);
  assert.equal(s.project.linked.txs.length, 1);
  assert.equal(s.step, 'market');
});

test('reference markets: reinforced passes the gate checks, underfunded fails', () => {
  const s = careful(9);
  const ok = s.comparison.reinforced.metrics, poor = s.comparison.underfunded.metrics;
  assert.ok(ok.maxShare <= 0.5 && ok.medianImpactBps <= 40 && ok.shockFillRatio >= 0.5 && ok.washFills === 0);
  assert.ok(poor.washFills > 0 && poor.pledgedUsd > 0 && poor.shockFillRatio < 0.5);
});
