// XDLC executable specification tests (v0.2 AMM-pegged corridor design). Pure, deterministic, no network. This
// exercises the reference MODEL of a proposed amendment (lib/xdlc-spec/model.mjs); it is not xrpld and proves nothing
// about an xrpld implementation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as M from '../lib/xdlc-spec/model.mjs';
import { VECTORS, buildPre, txFor, fixture, ACTIVE, COMMIT_DAVE, COMMIT_CAROL, CREATE, C, K, USD, XRP, AMM, BUY_USD } from '../lib/xdlc-spec/vectors.mjs';

const t = { equal: assert.equal, deepEqual: assert.deepEqual, ok: assert.ok };

for (const v of VECTORS) {
  test(`${v.id} ${v.title} -> ${v.expect}`, () => {
    const { state, setupResults } = buildPre(v, M);
    for (const r of setupResults) assert.equal(r.result, 'tesSUCCESS', `${v.id} setup ${r.tx} failed: ${r.result}`);
    const frozen = structuredClone(state);
    const tx = txFor(v, state);
    const r = M.apply(state, tx);
    assert.equal(r.result, v.expect);
    assert.deepEqual(r.violations || [], []);
    assert.deepEqual(state, frozen, 'apply must not mutate its input state');
    assert.deepEqual(M.checkInvariants(state, r.state, tx, r.result, r.trace), []);
    v.check(r.state, state, t, r);
  });
}

test('vector ids are unique and every result code used is registered', () => {
  assert.equal(new Set(VECTORS.map((v) => v.id)).size, VECTORS.length);
  for (const v of VECTORS) assert.ok(v.expect in M.RESULT_CODES, v.expect);
});

test('determinism: identical (state, tx) yields identical (result, state, trace)', () => {
  for (const v of VECTORS) {
    const a = buildPre(v, M), b = buildPre(v, M);
    const ra = M.apply(a.state, txFor(v, a.state)), rb = M.apply(b.state, txFor(v, b.state));
    assert.equal(ra.result, rb.result);
    assert.deepEqual(ra.state, rb.state);
    assert.deepEqual(ra.trace, rb.trace);
  }
});

const setupActive = (extra = []) => M.applyAll(fixture(), [...ACTIVE, ...extra]);

test('invariant checker detects corrupted states (negative controls)', () => {
  const { state } = setupActive([{ close: 6_000 }, COMMIT_DAVE, { TransactionType: 'CorridorWithdraw', Account: 'rAlice', CorridorID: C, Asset: USD, Amount: 50_000_000 }]);
  const tx = { TransactionType: 'CorridorAdvance', Account: 'rTaker', CorridorID: C, Fee: 10 };
  const ok = structuredClone(state); ok.accounts.rTaker.xrp -= 10; ok.burned += 10;
  assert.deepEqual(M.checkInvariants(state, ok, tx, 'tecCORRIDOR_NO_OP'), []);
  const mutate = (fn) => { const s = structuredClone(ok); fn(s); return M.checkInvariants(state, s, tx, 'tecCORRIDOR_NO_OP').join(); };
  assert.match(mutate((s) => { s.accounts.rAlice.xrp += 1; }), /INV-1/);
  assert.match(mutate((s) => { s.accounts.rAlice.lines[USD].balance += 1; }), /INV-2/);
  assert.match(mutate((s) => { const d = s.accounts.rAlice.lines[USD].balance - 10; s.accounts.rAlice.lines[USD].balance = 10; s.accounts.rTaker.lines[USD].balance += d; }), /INV-3/);
  assert.match(mutate((s) => { s.accounts.rAlice.held[USD] += 1; }), /INV-4/);
  assert.match(mutate((s) => { s.corridors[C].sides[USD].committed += 1; }), /INV-5/);
  assert.match(mutate((s) => { s.corridors[C].sides[USD].S += 1n; }), /INV-5/);
  assert.match(mutate((s) => { s.commitments[K('rBob')].ExitFeeBps = 2_000; }), /INV-8/);
  assert.match(mutate((s) => { s.corridors[C].sides[USD].pool -= 1; s.accounts.rBob.lines[USD].balance += 1; }), /INV-9/);
  assert.match(mutate((s) => { s.commitments[K('rBob')].Pending += 2_000_000; }), /INV-9/);
  assert.match(mutate((s) => { s.commitments[K('rDave')].TenureStart -= 1; s.corridors[C].sides[USD].S -= 100_000_000n; }), /INV-11/);
  assert.match(mutate((s) => { s.commitments[K('rBob')].Pending = 0; s.commitments[K('rBob')].I0 = s.corridors[C].sides[USD].I0; s.commitments[K('rBob')].I1 = s.corridors[C].sides[USD].I1; }), /INV-10/);
  assert.match(mutate((s) => { s.corridors[C].MaxParticipants = 2; }), /INV-13/);
  assert.match(mutate((s) => { s.corridors[C].stage = 'FORMING'; }), /INV-14/);
  assert.match(mutate((s) => { s.accounts.rAlice.ownerCount += 1; }), /INV-16/);
  assert.match(mutate((s) => { s.commitments[K('rBob')].LockDuration = 1; }), /INV-19/);
});

test('swap-trace controls: a fill worse than AMM+ImprovementBps, out of priority, or below MinRate is detected', () => {
  const pre = setupActive().state;
  const tx = { ...BUY_USD(30), Fee: 10, Sequence: pre.accounts.rTaker.seq };
  const r = M.apply(pre, tx);
  assert.equal(r.result, 'tesSUCCESS');
  assert.deepEqual(M.checkInvariants(pre, r.state, tx, r.result, r.trace), []);
  const bad = (fn) => { const tr = structuredClone(r.trace); fn(tr); return M.checkInvariants(pre, r.state, tx, r.result, tr).join(); };
  assert.match(bad((tr) => { tr.levels[0].fills[0].in += 100_000; }), /INV-6/);
  assert.match(bad((tr) => { tr.levels[0].fills[0].in = 1; tr.levels[0].fills[0].out = 2; }), /INV-7/);
  assert.match(bad((tr) => { tr.levels[0].fills.reverse(); }), /INV-12/);
  assert.match(bad((tr) => { tr.levels[0].examined = 9; }), /INV-13/);
  assert.match(bad((tr) => { tr.levels[0].fills[0].price = { n: 1n, d: 1n }; }), /INV-15/);
});

test('withdraw-trace controls: a fee above the formula or a payer sharing its own fee is detected', () => {
  const pre = setupActive([{ close: 6_000 }]).state;
  const tx = { TransactionType: 'CorridorWithdraw', Account: 'rAlice', CorridorID: C, Asset: USD, Amount: 50_000_000, Fee: 10, Sequence: pre.accounts.rAlice.seq };
  const r = M.apply(pre, tx);
  assert.equal(r.trace.fee, 1_250_000);
  assert.match(M.checkInvariants(pre, r.state, tx, r.result, { ...r.trace, fee: 1_250_001 }).join(), /INV-8|INV-18/);
  const s2 = structuredClone(r.state); s2.commitments[K('rAlice')].I0 = 0n; s2.commitments[K('rAlice')].I1 = 0n;
  assert.match(M.checkInvariants(pre, s2, tx, r.result, r.trace).join(), /INV-10|INV-9/);
});

test('an XDLC transaction that moved value would be rejected (INV-18)', () => {
  const { state } = M.applyAll(fixture(), [CREATE]);
  const tx = { TransactionType: 'CorridorAdvance', Account: 'rTaker', CorridorID: C, Fee: 10, Sequence: 1 };
  const bad = structuredClone(state); bad.accounts.rTaker.xrp -= 10; bad.burned += 10; bad.accounts.rOwner.xrp -= 5; bad.accounts.rTaker.xrp += 5;
  assert.match(M.checkInvariants(state, bad, tx, 'tesSUCCESS').join(), /INV-18/);
});

test('fee-pool accumulator: many exits, never insolvent, payer excluded, residual is dust', () => {
  // Five providers join at different times; three exit early at different times; the rest claim.
  const extra = Object.fromEntries(['rP1', 'rP2', 'rP3', 'rP4', 'rP5'].map((a) => [a, { xrp: 1_000_000_000, lines: { [USD]: 1_000_000_000 } }]));
  let s = fixture({ extraAccounts: extra });
  const commit = (a, amt, term) => ({ TransactionType: 'CorridorCommit', Account: a, CorridorID: C, Asset: USD, Amount: amt, ...(term ? { LockDuration: 50_000, ExitFeeBps: 1_000 } : {}) });
  const steps = [{ ...CREATE, MaxParticipants: 16 }, commit('rP1', 300_000_000, true), commit('rP2', 7_000_001, false), { TransactionType: 'CorridorAdvance', Account: 'rTaker', CorridorID: C },
    { close: 4_000 }, commit('rP3', 123_456_789, true), { close: 9_000 }, commit('rP4', 55_555_555, true), { close: 12_345 },
    { TransactionType: 'CorridorWithdraw', Account: 'rP1', CorridorID: C, Asset: USD, Amount: 100_000_000 }, { close: 20_000 }, commit('rP5', 9_999_999, false),
    { TransactionType: 'CorridorWithdraw', Account: 'rP3', CorridorID: C, Asset: USD }, { close: 30_000 },
    { TransactionType: 'CorridorWithdraw', Account: 'rP4', CorridorID: C, Asset: USD, Amount: 5_555_555 }];
  const { state, results } = M.applyAll(s, steps);
  assert.ok(results.every((x) => x === 'tesSUCCESS'), results.join());
  const c = state.corridors[C];
  const ents = c.commitments.map((id) => M.entitlement(c, state.commitments[id]));
  const total = ents.reduce((n, x) => n + x, 0);
  assert.ok(c.sides[USD].feesIn > 0);
  assert.ok(total <= c.sides[USD].pool, `${total} > ${c.sides[USD].pool}`);
  assert.ok(c.sides[USD].pool - total <= 3 * c.commitments.length + 3, `dust ${c.sides[USD].pool - total}`);
  // Everyone leaves (fees after term end are zero by t=200000); the pool empties exactly.
  const out = M.applyAll(state, [{ close: 200_000 }, ...c.commitments.map((id) => ({ TransactionType: 'CorridorWithdraw', Account: state.commitments[id].Account, CorridorID: C, Asset: USD }))]);
  assert.ok(out.results.every((x) => x === 'tesSUCCESS'), out.results.join());
  assert.equal(out.state.corridors[C].sides[USD].pool, 0);
  assert.equal(out.state.corridors[C].sides[USD].feesIn, out.state.corridors[C].sides[USD].paidOut);
});

// Seeded pseudo-random transaction stream (LCG): no Math.random, reproducible across runs.
function lcg(seed) { let x = seed >>> 0; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32; }
const PROVIDERS = ['rAlice', 'rBob', 'rDave', 'rCarol', 'rMaker'];

function randomTx(rnd, s) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const a = pick(PROVIDERS);
  const kind = pick(['commit', 'commit', 'commit', 'swapUsd', 'swapUsd', 'swapXrp', 'swapXrp', 'withdraw', 'withdrawPart', 'claim', 'advance', 'pay', 'claw', 'close', 'close']);
  const amt = 1_000_000 + Math.floor(rnd() * 60_000_000);
  switch (kind) {
    case 'commit': {
      const asset = a === 'rCarol' ? XRP : pick([USD, USD, XRP]);
      const term = rnd() < 0.5 ? { LockDuration: 1_000 + Math.floor(rnd() * 20_000), ExitFeeBps: 1 + Math.floor(rnd() * 1_000) } : {};
      const bound = asset === USD ? (rnd() < 0.3 ? { MinRate: [1 + Math.floor(rnd() * 25), 10] } : {}) : (rnd() < 0.3 ? { MaxRate: [15 + Math.floor(rnd() * 10), 10] } : {});
      return { TransactionType: 'CorridorCommit', Account: a, CorridorID: C, Asset: asset, Amount: amt, ...term, ...bound, ...(rnd() < 0.6 ? { MaxPerLevel: 1 + Math.floor(rnd() * 20_000_000) } : {}) };
    }
    case 'swapUsd': return { TransactionType: 'ModelSwap', Account: pick(['rTaker', 'rTaker', a]), SendAsset: XRP, DeliverAsset: USD, DeliverAmount: Math.floor(amt * (rnd() < 0.2 ? 20 : 1)) };
    case 'swapXrp': return { TransactionType: 'ModelSwap', Account: pick(['rTaker', 'rTaker', a]), SendAsset: USD, DeliverAsset: XRP, DeliverAmount: Math.floor(amt * (rnd() < 0.2 ? 20 : 1)) };
    case 'withdraw': return { TransactionType: 'CorridorWithdraw', Account: a, CorridorID: C, Asset: pick([USD, XRP]) };
    case 'withdrawPart': return { TransactionType: 'CorridorWithdraw', Account: a, CorridorID: C, Asset: pick([USD, XRP]), Amount: Math.floor(amt / 3) };
    case 'claim': return { TransactionType: 'CorridorClaim', Account: a, CorridorID: C, Asset: pick([USD, XRP]) };
    case 'advance': return { TransactionType: 'CorridorAdvance', Account: pick(['rTaker', a]), CorridorID: C, Flags: rnd() < 0.02 ? M.tfClose : 0, ...(rnd() < 0.02 ? { Account: 'rOwner' } : {}) };
    case 'pay': return { TransactionType: 'Payment', Account: a, Destination: pick(PROVIDERS.filter((x) => x !== a && x !== 'rCarol')), Asset: pick([USD, XRP]), Amount: amt };
    case 'claw': return { TransactionType: 'Clawback', Account: 'rIssuer', Holder: pick(['rAlice', 'rBob', 'rDave']), Asset: USD, Amount: Math.floor(amt * 5) };
    default: return { close: s.closeTime + Math.floor(rnd() * 3_000) };
  }
}

test('property: 40 seeded random streams x 250 tx keep every invariant; withdrawal is always possible', () => {
  const tally = {}; let fills = 0, fees = 0, claims = 0, pausedSkips = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const rnd = lcg(seed);
    let s = M.applyAll(fixture(), [{ ...CREATE, MaxParticipants: 12, PauseBps: 300 + Math.floor(rnd() * 1_000), ImprovementBps: 1 + Math.floor(rnd() * 50), MaturityTime: 1_000 + Math.floor(rnd() * 400_000) }]).state;
    const xrp0 = M.totalXrp(s) + s.burned;
    for (let i = 0; i < 250; i++) {
      const raw = randomTx(rnd, s);
      if (raw.close != null) { s = M.closeLedger(s, raw.close); continue; }
      const { state, results, traces } = M.applyAll(s, [raw]);
      const res = results[0], tr = traces[0];
      tally[res] = (tally[res] || 0) + 1;
      assert.notEqual(res, 'tecINVARIANT_FAILED', `seed ${seed} step ${i} ${JSON.stringify(raw)}`);
      assert.equal(M.totalXrp(state) + state.burned, xrp0);
      if (tr?.kind === 'swap') { fills += tr.levels.reduce((n, l) => n + l.fills.length, 0); if (tr.corridor === 0 && state.corridors[C] && M.effectiveStage(state, state.corridors[C]) === 'ACTIVE' && M.paused(state, state.corridors[C], state.amms[AMM])) pausedSkips += 1; }
      if (tr?.kind === 'withdraw' && tr.fee > 0) fees += 1;
      if ((tr?.kind === 'withdraw' || tr?.kind === 'claim') && tr.claimed > 0) claims += 1;
      // Exit is priced, never prohibited: every commitment's owner can always withdraw it in full.
      for (const k of Object.values(state.commitments)) {
        const w = M.applyAll(state, [{ TransactionType: 'CorridorWithdraw', Account: k.Account, CorridorID: k.CorridorID, Asset: k.Asset }]);
        assert.equal(w.results[0], 'tesSUCCESS', `seed ${seed} step ${i}: withdraw ${k.id} -> ${w.results[0]}`);
      }
      s = state;
    }
  }
  assert.ok(tally.tesSUCCESS > 3_000, JSON.stringify(tally));
  assert.ok(fills > 200 && fees > 20 && claims > 10, JSON.stringify({ fills, fees, claims }));
  assert.ok(pausedSkips > 0, 'volatility pause never triggered in the random streams');
  for (const code of ['tecUNFUNDED_PAYMENT', 'tecCORRIDOR_NO_OP', 'tecUNFUNDED']) assert.ok(tally[code] > 0, `${code} not exercised: ${JSON.stringify(tally)}`);
});

test('summary.json matches the model, vectors and status', () => {
  const sum = JSON.parse(readFileSync(new URL('../lib/xdlc-spec/summary.json', import.meta.url)));
  assert.equal(sum.vectors.count, VECTORS.length);
  assert.deepEqual(sum.candidateTransactions.map((x) => x.name), [...M.XDLC_TX_TYPES]);
  assert.equal(sum.status.submitted, false);
  assert.equal(sum.status.implementedInXrpld, false);
  assert.equal(sum.status.activated, false);
  assert.equal(sum.xls, 'XLS-XXXX (unassigned)');
  assert.equal(sum.modelVersion, M.MODEL_VERSION);
  assert.ok(Array.isArray(sum.capabilities) && sum.capabilities.length >= 6);
  assert.ok(sum.removedCapabilities.some((c) => /automatic release/i.test(c.name)));
  assert.equal(sum.docs.length, 4);
});

test('XRP-side commitment fixture is valid (used by docs)', () => {
  const { results } = M.applyAll(fixture(), [CREATE, COMMIT_CAROL]);
  assert.deepEqual(results, ['tesSUCCESS', 'tesSUCCESS']);
});
