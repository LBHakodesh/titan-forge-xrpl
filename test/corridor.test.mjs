// Demand Proof Score + corridor lifecycle: pure logic, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scoreEvidence, emptyEvidence, classifyTxs, holderStats, bookStats, assembleEvidence, newSimState, simulate, simEvidence, COMPONENTS } from '../lib/demand.mjs';
import { ringsActiveFor, evaluatePromotion, thresholdCheck, allowedTransitions, nextStage, demoteTargets, Corridor, THRESHOLDS } from '../lib/corridor.mjs';
import { Bus } from '../lib/store.mjs';

const base = () => ({ ...emptyEvidence(), validatedTx: 20, participants: 8, depthXrp: 500, fillDays: 3, volumeXrp: 200, spreadBps: 300, impactBps: 200, costXrp: 2, topHolderShare: 0.4, topCounterpartyShare: 0.3, sentinel: { critical: 0, high: 0, medium: 0, low: 0 } });
const S = (e) => scoreEvidence(e).total;

test('weights sum to 100 and breakdown sums to total', () => {
  assert.equal(COMPONENTS.reduce((s, c) => s + c.weight, 0), 100);
  const r = scoreEvidence(base());
  assert.ok(Math.abs(r.components.reduce((s, c) => s + c.points, 0) - r.total) < 0.1);
  const noSent = scoreEvidence({ ...base(), sentinel: null });
  assert.equal(noSent.sentinelPresent, false);
  assert.ok(Math.abs(noSent.components.reduce((s, c) => s + c.weight, 0) - 100) < 0.05, 'weight redistributed when Sentinel absent');
});

test('score is monotone in demand evidence', () => {
  const steps = { participants: [0, 2, 5, 10, 25, 40], validatedTx: [0, 1, 10, 100, 500], fillDays: [0, 1, 3, 7], volumeXrp: [0, 10, 100, 1000, 5000] };
  for (const [k, vals] of Object.entries(steps)) {
    let prev = -1;
    for (const v of vals) { const s = S({ ...base(), [k]: v }); assert.ok(s >= prev, `${k}=${v} lowered score`); prev = s; }
  }
  let prev = 101;
  for (const v of [30, 100, 500, 1500, 3000]) { const s = S({ ...base(), spreadBps: v }); assert.ok(s <= prev, 'wider spread raised score'); prev = s; }
  prev = 101;
  for (const c of [0, 1, 2]) { const s = S({ ...base(), sentinel: { critical: c, high: 0, medium: 0, low: 0 } }); assert.ok(s <= prev, 'more findings raised score'); prev = s; }
  assert.equal(S(emptyEvidence()), 0);
});

test('quality components are gated on independent participants', () => {
  const r = scoreEvidence({ ...emptyEvidence(), sentinel: { critical: 0, high: 0, medium: 0, low: 0 }, spreadBps: 10, impactBps: 10, topHolderShare: 0, topCounterpartyShare: 0 });
  assert.equal(r.total, 0, 'no participants → no points for "clean" quality metrics');
});

test('demo accounts are excluded from organic evidence', () => {
  const demo = new Set(['rIssuer', 'rMaker', 'rTaker']);
  const lines = [
    { account: 'rMaker', currency: 'BBL', balance: '-999900' }, { account: 'rTaker', currency: 'BBL', balance: '-100' },
    { account: 'rAlice', currency: 'BBL', balance: '-50' }, { account: 'rBob', currency: 'XYZ', balance: '-5' },
  ];
  const h = holderStats(lines, 'BBL', demo);
  assert.deepEqual([...h.organic.accounts], ['rAlice']);
  assert.equal(h.demo.accounts.size, 2);
  const book = { asks: [{ account: 'rMaker', qty: 900, priceXrp: 0.01 }, { account: 'rAlice', qty: 10, priceXrp: 0.011 }], bids: [{ account: 'rMaker', qty: 100, priceXrp: 0.008 }] };
  const b = bookStats(book, demo);
  assert.ok(Math.abs(b.organic.depthXrp - 0.11) < 1e-9);
  assert.equal(b.organic.spreadBps, null, 'organic spread needs organic quotes on both sides');
  const fill = (acct, owner) => ({ validated: true, close_time_iso: new Date().toISOString(), tx_json: { Account: acct, TransactionType: 'OfferCreate', Fee: '12' },
    meta: { AffectedNodes: [{ ModifiedNode: { LedgerEntryType: 'Offer', FinalFields: { Account: owner, TakerGets: { currency: 'BBL', value: '800' }, TakerPays: '8000000' }, PreviousFields: { TakerGets: { currency: 'BBL', value: '900' }, TakerPays: '9000000' } } }] } });
  const t = classifyTxs([fill('rTaker', 'rMaker'), fill('rAlice', 'rMaker')], 'BBL', demo);
  assert.equal(t.demo.fills, 1); assert.equal(t.organic.fills, 1);
  assert.equal(t.organic.volumeXrp, 1);
  assert.deepEqual([...t.organic.accounts], ['rAlice']);
  // Only-demo world: organic score is exactly 0 however busy the demo accounts are.
  const t2 = classifyTxs(Array.from({ length: 50 }, () => fill('rTaker', 'rMaker')), 'BBL', demo);
  const h2 = holderStats(lines.slice(0, 2), 'BBL', demo);
  const b2 = bookStats({ asks: book.asks.slice(0, 1), bids: book.bids }, demo);
  const organic = assembleEvidence({ txs: t2.organic, book: b2.organic, holders: h2.organic, isDemo: false });
  const demoEv = assembleEvidence({ txs: t2.demo, book: b2.demo, holders: h2.demo, validatedSteps: 6, isDemo: true });
  assert.equal(S(organic), 0);
  assert.ok(S(demoEv) > 0, 'demo activity is scored separately');
});

test('ringsActive per stage', () => {
  assert.equal(ringsActiveFor('entered'), 0);
  assert.equal(ringsActiveFor('spoke'), 2);
  assert.equal(ringsActiveFor('growing_spoke', 40), 3);
  assert.equal(ringsActiveFor('growing_spoke', 55), 4);
  assert.equal(ringsActiveFor('corridor'), 6);
  assert.equal(ringsActiveFor('mature'), 6);
  assert.equal(ringsActiveFor('standby'), 1);
});

test('threshold gating and approval requirement', () => {
  const low = scoreEvidence({ ...base(), participants: 2 });
  assert.equal(thresholdCheck('spoke', 'growing_spoke', low).met, false);
  let s = newSimState(); s = simulate(s, 'growth');
  const sc = scoreEvidence(simEvidence(s), 'SIMULATION');
  assert.ok(sc.total >= THRESHOLDS.growing_spoke.minScore);
  const noApproval = evaluatePromotion({ mode: 'SIMULATION', from: 'spoke', to: 'growing_spoke', score: sc, approved: false });
  assert.equal(noApproval.allowed, false);
  assert.ok(noApproval.reasons.some((r) => /approval/i.test(r)));
  assert.equal(evaluatePromotion({ mode: 'SIMULATION', from: 'spoke', to: 'growing_spoke', score: sc, approved: true }).allowed, true);
  assert.equal(evaluatePromotion({ mode: 'SIMULATION', from: 'spoke', to: 'corridor', score: sc, approved: true }).allowed, false, 'no stage skipping');
  // LIVE: Guardian also enforces approval; insufficient capital refuses.
  const live = evaluatePromotion({ mode: 'LIVE_TESTNET', from: 'spoke', to: 'growing_spoke', score: sc, approved: true, capital: { mode: 'LIVE_TESTNET', sufficient: false, spendableXrp: 3, requiredXrp: 21.8 } });
  assert.equal(live.allowed, false);
  assert.ok(live.reasons.some((r) => /Insufficient funded maker capital/.test(r)));
  const liveNoApproval = evaluatePromotion({ mode: 'LIVE_TESTNET', from: 'spoke', to: 'growing_spoke', score: sc, approved: false, capital: { mode: 'LIVE_TESTNET', sufficient: true } });
  assert.equal(liveNoApproval.guardian.allowed, false);
});

test('lifecycle is reversible', () => {
  assert.equal(nextStage('entered'), 'spoke');
  assert.equal(nextStage('mature'), null);
  assert.equal(nextStage('standby'), 'spoke');
  assert.deepEqual(demoteTargets('mature'), ['corridor', 'standby']);
  assert.deepEqual(demoteTargets('spoke'), ['standby']);
  assert.deepEqual(demoteTargets('standby'), []);
  let s = newSimState(); for (let i = 0; i < 4; i++) s = simulate(s, 'growth');
  const hi = scoreEvidence(simEvidence(s)).total;
  s = simulate(s, 'fade');
  const faded = scoreEvidence(simEvidence(s));
  assert.ok(faded.total < hi);
  const t = allowedTransitions('mature', faded);
  assert.equal(t.demoteRecommended?.to, 'corridor');
  // Fresh spoke with no demand is not "faded".
  assert.equal(allowedTransitions('spoke', scoreEvidence(emptyEvidence()), { peak: 0 }).demoteRecommended, null);
});

test('Corridor service: SIMULATION lifecycle end-to-end with events and persistence', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-cor-'));
  const file = path.join(dir, 'corridor.json');
  const store = { launches: [{ id: 'L1', code: 'BBL', name: 'Brooklyn Bullies', category: 'community', status: 'live', steps: [] }], byCode(c) { return this.launches.find((l) => l.code === c); } };
  const bus = new Bus(); const events = []; bus.on('event', (e) => events.push(e));
  const cor = new Corridor({ store, bus, file });
  assert.equal(cor.token('BBL').tracks.LIVE_TESTNET.stage, 'spoke');
  const v0 = await cor.view('BBL');
  assert.equal(v0.evidence.live.mode, 'REPLAY'); // no ledger in tests
  assert.equal(v0.scores.live.organic.total, 0);
  assert.equal((await cor.promote('BBL', { approved: true, mode: 'LIVE_TESTNET' })).status, 503);
  cor.simulate('BBL', 'growth');
  assert.equal((await cor.promote('BBL', { approved: false, mode: 'SIMULATION' })).status, 403);
  const ok = await cor.promote('BBL', { approved: true, mode: 'SIMULATION' });
  assert.equal(ok.status, 200);
  assert.equal(cor.token('BBL').tracks.SIMULATION.stage, 'growing_spoke');
  assert.equal(cor.token('BBL').tracks.LIVE_TESTNET.stage, 'spoke', 'sim never moves the live track');
  const ch = events.filter((e) => e.type === 'corridor.stage_changed' && e.mode === 'SIMULATION');
  assert.equal(ch.at(-1).to, 'growing_spoke');
  assert.ok(ch.at(-1).rings.length >= 3);
  assert.ok(events.some((e) => e.type === 'corridor.score' && e.mode === 'SIMULATION'));
  const d = cor.demote('BBL', { mode: 'SIMULATION', to: 'standby' });
  assert.equal(d.status, 200);
  assert.ok(d.body.releasedUsd > 0);
  assert.ok(d.body.recommendations.length > 0 && d.body.recommendations.every((r) => r.mode === 'SIMULATION'));
  const reloaded = new Corridor({ store, bus, file });
  assert.equal(reloaded.token('BBL').tracks.SIMULATION.stage, 'standby');
  fs.rmSync(dir, { recursive: true, force: true });
});
