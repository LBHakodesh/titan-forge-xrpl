// XDLC deterministic test vectors (executable specification, v0.2 AMM-pegged corridor design). Each vector: pre-state
// (fixture + setup steps), one transaction, the expected result code, and a post-state check. Rendered into
// docs/XDLC_DETERMINISTIC_TESTS.md by lib/xdlc-spec/render.mjs and executed by test/xdlc-spec.test.mjs.
// Amounts: XRP in drops, USD/EUR in micro-units (1 USD = 1,000,000).
import { genesis, corridorId, commitmentId, ammId, tfClose, closeLedger, termEnd, entitlement, tau, spotQuality } from './model.mjs';

export const USD = 'USD.rIssuer';
export const EUR = 'EUR.rIssuer';
export const XRP = 'XRP';
const X = (n) => Math.round(n * 1_000_000); // whole XRP -> drops; whole USD -> micro-units
export const AMM = ammId(USD, XRP);
export const DOMAIN = 'DOMAIN:rIssuer:1';

export function fixture(opts = {}) {
  return genesis({
    closeTime: 1_000,
    ...opts,
    accounts: {
      rOwner: { xrp: X(100) },
      rAlice: { xrp: X(1000), lines: { [USD]: X(1000) } },
      rBob: { xrp: X(1000), lines: { [USD]: X(1000) } },
      rCarol: { xrp: X(5000), lines: { [USD]: 0 } },
      rDave: { xrp: X(1000), lines: { [USD]: X(500) } },
      rTaker: { xrp: X(100_000), lines: { [USD]: X(100_000) } },
      rMaker: { xrp: X(1000), lines: { [USD]: X(1000) } },
      rLP: { xrp: X(100), lines: { [USD]: 0 } },
      rFrozen: { xrp: X(100), lines: { [USD]: { balance: X(10), frozen: true } } },
      rNoLine: { xrp: X(100) },
      rPoor: { xrp: 1_100_000 },
      rOutsider: { xrp: X(1000), lines: { [USD]: X(100) } },
      rIssuer: { xrp: X(100) },
      ...(opts.extraAccounts || {}),
    },
    amms: opts.amms || [{ asset: USD, asset2: XRP, amount: X(10_000), amount2: X(20_000), TradingFee: 300, lp: 'rLP' }],
    offers: opts.offers || [],
    domains: { [DOMAIN]: { members: ['rAlice', 'rBob', 'rCarol'] } },
  });
}

export const C = corridorId('rOwner', 1);
export const K = (acct, asset = USD) => commitmentId(C, acct, asset);

export const CREATE = {
  TransactionType: 'CorridorCreate', Account: 'rOwner', Asset: USD, Asset2: XRP, ImprovementBps: 10, PauseBps: 500,
  MinCommit: { [USD]: X(1), [XRP]: X(1) }, MaxParticipants: 8, MinParticipants: 2, Threshold: { [USD]: X(100) }, MaturityTime: 100_000,
};
// Alice: 100 USD, 10,000 s term with a 5% (500 bps) early-exit fee, at most 20 USD per depth level, sells USD only at
// >= 1 XRP per USD. Bob: 100 USD flexible (no term), at most 20 USD per level.
export const COMMIT_ALICE = { TransactionType: 'CorridorCommit', Account: 'rAlice', CorridorID: C, Asset: USD, Amount: X(100), LockDuration: 10_000, ExitFeeBps: 500, MaxPerLevel: X(20), MinRate: [1, 1] };
export const COMMIT_BOB = { TransactionType: 'CorridorCommit', Account: 'rBob', CorridorID: C, Asset: USD, Amount: X(100), MaxPerLevel: X(20) };
export const COMMIT_DAVE = { TransactionType: 'CorridorCommit', Account: 'rDave', CorridorID: C, Asset: USD, Amount: X(100), MaxPerLevel: X(20) };
export const COMMIT_CAROL = { TransactionType: 'CorridorCommit', Account: 'rCarol', CorridorID: C, Asset: XRP, Amount: X(200), MaxPerLevel: X(40) };
export const ADVANCE = { TransactionType: 'CorridorAdvance', Account: 'rTaker', CorridorID: C };
export const CLOSE = { TransactionType: 'CorridorAdvance', Account: 'rOwner', CorridorID: C, Flags: tfClose };
export const BUY_USD = (n) => ({ TransactionType: 'ModelSwap', Account: 'rTaker', SendAsset: XRP, DeliverAsset: USD, DeliverAmount: X(n) });
export const BUY_XRP = (n) => ({ TransactionType: 'ModelSwap', Account: 'rTaker', SendAsset: USD, DeliverAsset: XRP, DeliverAmount: X(n) });
const WD = (acct, amount, asset = USD) => ({ TransactionType: 'CorridorWithdraw', Account: acct, CorridorID: C, Asset: asset, ...(amount != null ? { Amount: amount } : {}) });
const CLAIM = (acct, asset = USD) => ({ TransactionType: 'CorridorClaim', Account: acct, CorridorID: C, Asset: asset });
const close = (t) => ({ close: t });
const MANIP = BUY_XRP(1000); // taker sells ~526 USD into the AMM: USD price (XRP per USD) falls ~9.75%

export const ACTIVE = [CREATE, COMMIT_ALICE, COMMIT_BOB, ADVANCE]; // activated at t=1000
const AT = (t) => [...ACTIVE, close(t)];
const filled = (r) => r.trace.levels.flatMap((l) => l.fills);
const filledBy = (r, acct) => filled(r).filter((f) => f.account === acct).reduce((n, f) => n + f.out, 0);
const near = (t, actual, expected, tol, msg) => t.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} vs ${expected}`);
const same = (a, b, t) => t.deepEqual(a, b);

export const VECTORS = [
  // ---------------- Amendment gating and preflight (tem: no fee, no sequence consumed) ----------------
  { id: 'XV-01', group: 'gating', title: 'Amendment not enabled', fixtureOpts: { amendments: { XDLC: false } }, setup: [], tx: CREATE, expect: 'temDISABLED',
    pre: 'XDLC amendment disabled', post: 'state identical; no fee; Sequence unchanged', check: same },
  { id: 'XV-02', group: 'preflight', title: 'Asset and Asset2 identical', setup: [], tx: { ...CREATE, Asset2: USD }, expect: 'temMALFORMED', pre: 'fixture', post: 'state identical', check: same },
  { id: 'XV-03', group: 'preflight', title: 'ImprovementBps below the protocol minimum (1 bp)', setup: [], tx: { ...CREATE, ImprovementBps: 0 }, expect: 'temMALFORMED', pre: 'fixture', post: 'state identical', check: same },
  { id: 'XV-04', group: 'preflight', title: 'LockDuration without ExitFeeBps', setup: [CREATE], tx: { ...COMMIT_ALICE, ExitFeeBps: undefined }, expect: 'temMALFORMED', pre: 'corridor FORMING', post: 'state identical', check: same },
  { id: 'XV-05', group: 'preflight', title: 'ExitFeeBps above the protocol cap (1000 bps = 10%)', setup: [CREATE], tx: { ...COMMIT_ALICE, ExitFeeBps: 1001 }, expect: 'temMALFORMED', pre: 'corridor FORMING', post: 'state identical', check: same },
  { id: 'XV-06', group: 'preflight', title: 'Both MinRate and MaxRate on one commitment', setup: [CREATE], tx: { ...COMMIT_ALICE, MaxRate: [3, 1] }, expect: 'temMALFORMED', pre: 'corridor FORMING', post: 'state identical', check: same },
  { id: 'XV-07', group: 'preflight', title: 'Commit with zero Amount', setup: [CREATE], tx: { ...COMMIT_ALICE, Amount: 0 }, expect: 'temBAD_AMOUNT', pre: 'corridor FORMING', post: 'state identical; rAlice Sequence still usable',
    check: (a, b, t) => { t.deepEqual(a, b); t.equal(a.accounts.rAlice.seq, 1); } },

  // ---------------- CorridorCreate ----------------
  { id: 'XV-08', group: 'create', title: 'Valid CorridorCreate references the USD/XRP AMM', setup: [], tx: CREATE, expect: 'tesSUCCESS',
    pre: 'AMM USD/XRP 10,000 / 20,000, fee 0.3%', post: 'corridor FORMING; AMMID set; reference price 2 XRP/USD snapshotted; rOwner OwnerCount 1; fee burned',
    check: (a, b, t) => { const c = a.corridors[C]; t.equal(c.stage, 'FORMING'); t.equal(c.AMMID, AMM); t.equal(c.RefPrice.n * 1n, 20_000_000_000n); t.equal(c.RefPrice.d, 10_000_000_000n); t.equal(a.accounts.rOwner.ownerCount, 1); t.equal(a.burned - b.burned, 10); } },
  { id: 'XV-09', group: 'create', title: 'No AMM for the pair (not allowed in v1)', setup: [], tx: { ...CREATE, Asset: EUR, MinCommit: undefined, Threshold: undefined }, expect: 'terNO_AMM',
    pre: 'no EUR/XRP AMM', post: 'not applied; no corridor; no fee', check: same },
  { id: 'XV-10', group: 'create', title: 'AMM exists but is empty', fixtureOpts: { amms: [{ asset: USD, asset2: XRP, amount: 0, amount2: 0, TradingFee: 300, lpTokens: 0 }] }, setup: [], tx: CREATE, expect: 'tecAMM_EMPTY',
    pre: 'AMM with zero LP tokens', post: 'no corridor; fee claimed', check: (a, b, t) => { t.equal(Object.keys(a.corridors).length, 0); t.equal(a.burned - b.burned, 10); } },

  // ---------------- CorridorCommit: wallet-held commitments ----------------
  { id: 'XV-11', group: 'commit', title: 'Term commitment before activation: funds stay, held, term clock not started', setup: [CREATE], tx: COMMIT_ALICE, expect: 'tesSUCCESS',
    pre: 'corridor FORMING; rAlice 1000 USD', post: 'rAlice USD balance still 1000; held 100; TermEnd unset (starts at activation); TenureStart 0; OwnerCount 2',
    check: (a, b, t) => { const al = a.accounts.rAlice, k = a.commitments[K('rAlice')]; t.equal(al.lines[USD].balance, X(1000)); t.equal(al.held[USD], X(100)); t.equal(k.TermEnd, null); t.equal(termEnd(a.corridors[C], k), null); t.equal(k.TenureStart, 0); t.equal(al.ownerCount, 2); t.equal(a.corridors[C].sides[USD].committed, X(100)); } },
  { id: 'XV-12', group: 'commit', title: 'Flexible commitment (no term, no exit fee)', setup: [CREATE], tx: COMMIT_BOB, expect: 'tesSUCCESS',
    pre: 'corridor FORMING', post: 'held 100 USD; LockDuration null; ExitFeeBps 0', check: (a, b, t) => { const k = a.commitments[K('rBob')]; t.equal(k.LockDuration, null); t.equal(k.ExitFeeBps, 0); t.equal(a.accounts.rBob.held[USD], X(100)); } },
  { id: 'XV-13', group: 'commit', title: 'XRP-side commitment (provides XRP to takers selling USD)', setup: [CREATE], tx: COMMIT_CAROL, expect: 'tesSUCCESS',
    pre: 'rCarol 5000 XRP', post: 'rCarol XRP held 200; corridor XRP side committed 200', check: (a, b, t) => { t.equal(a.accounts.rCarol.held[XRP], X(200)); t.equal(a.corridors[C].sides[XRP].committed, X(200)); } },
  { id: 'XV-14', group: 'commit', title: 'Amount exceeds unheld balance', setup: [CREATE, COMMIT_ALICE], tx: { ...COMMIT_ALICE, Amount: X(901) }, expect: 'tecUNFUNDED',
    pre: 'rAlice 1000 USD, 100 already held', post: 'hold unchanged', check: (a, b, t) => t.equal(a.accounts.rAlice.held[USD], X(100)) },
  { id: 'XV-15', group: 'commit', title: 'XRP commitment may not consume the reserve', setup: [CREATE], tx: { ...COMMIT_CAROL, Amount: X(4998.6) }, expect: 'tecUNFUNDED',
    pre: 'rCarol 5000 XRP, OwnerCount 1; reserve after commit 1.4 XRP; fee 10 drops', post: 'no commitment', check: (a, b, t) => t.deepEqual(a.accounts.rCarol.held, {}) },
  { id: 'XV-16', group: 'commit', title: 'Below MinCommit (anti-dust)', setup: [CREATE], tx: { ...COMMIT_BOB, Amount: X(1) - 1 }, expect: 'tecCORRIDOR_BOUND',
    pre: 'MinCommit USD 1', post: 'no commitment', check: (a, b, t) => t.equal(Object.keys(a.commitments).length, 0) },
  { id: 'XV-17', group: 'commit', title: 'MinRate on an Asset2-side (XRP) commitment', setup: [CREATE], tx: { ...COMMIT_CAROL, MinRate: [1, 1] }, expect: 'tecCORRIDOR_BOUND',
    pre: 'MinRate applies to base-asset (USD) sellers only', post: 'no commitment', check: (a, b, t) => t.equal(Object.keys(a.commitments).length, 0) },
  { id: 'XV-18', group: 'commit', title: 'No trust line for the asset', setup: [CREATE], tx: { ...COMMIT_BOB, Account: 'rNoLine' }, expect: 'tecNO_LINE',
    pre: 'rNoLine has no USD line', post: 'no commitment', check: (a, b, t) => t.equal(Object.keys(a.commitments).length, 0) },
  { id: 'XV-19', group: 'commit', title: 'Frozen trust line', setup: [CREATE], tx: { ...COMMIT_BOB, Account: 'rFrozen', Amount: X(5) }, expect: 'tecFROZEN',
    pre: 'rFrozen USD line frozen by issuer', post: 'no commitment', check: (a, b, t) => t.equal(Object.keys(a.commitments).length, 0) },
  { id: 'XV-20', group: 'commit', title: 'MaxParticipants reached', setup: [{ ...CREATE, MaxParticipants: 2 }, COMMIT_ALICE, COMMIT_BOB], tx: COMMIT_DAVE, expect: 'tecCORRIDOR_LIMIT',
    pre: '2 of 2 commitments', post: 'rDave has no commitment', check: (a, b, t) => t.equal(a.commitments[K('rDave')], undefined) },
  { id: 'XV-21', group: 'commit', title: 'Permissioned corridor: non-member refused', setup: [{ ...CREATE, DomainID: DOMAIN }], tx: { ...COMMIT_BOB, Account: 'rOutsider', Amount: X(10) }, expect: 'tecNO_AUTH',
    pre: 'corridor DomainID set (XLS-80); rOutsider not a member', post: 'no commitment', check: (a, b, t) => t.equal(Object.keys(a.commitments).length, 0) },
  { id: 'XV-22', group: 'commit', title: 'Permissioned corridor: member accepted', setup: [{ ...CREATE, DomainID: DOMAIN }], tx: COMMIT_BOB, expect: 'tesSUCCESS',
    pre: 'rBob is a domain member', post: 'commitment created', check: (a, b, t) => t.ok(a.commitments[K('rBob')]) },
  { id: 'XV-23', group: 'commit', title: 'Top-up may not change the exit fee', setup: [CREATE, COMMIT_ALICE], tx: { ...COMMIT_ALICE, Amount: X(10), ExitFeeBps: 100 }, expect: 'tecCORRIDOR_TERMS',
    pre: 'rAlice ExitFeeBps 500', post: 'terms and hold unchanged', check: (a, b, t) => { t.equal(a.commitments[K('rAlice')].ExitFeeBps, 500); t.equal(a.accounts.rAlice.held[USD], X(100)); } },
  { id: 'XV-24', group: 'commit', title: 'Joining an ACTIVE corridor starts the term and tenure at commit time', setup: AT(3_000), tx: { ...COMMIT_DAVE, LockDuration: 5_000, ExitFeeBps: 200 }, expect: 'tesSUCCESS',
    pre: 'ACTIVE since t=1000; now t=3000', post: 'rDave TermEnd 8000; TenureStart 2000 (seconds since activation)',
    check: (a, b, t) => { const k = a.commitments[K('rDave')]; t.equal(k.TermEnd, 8_000); t.equal(k.TenureStart, 2_000); } },
  { id: 'XV-25', group: 'commit', title: 'Top-up while ACTIVE: amount-weighted tenure start (rounded later), term restarts', setup: AT(5_000), tx: { ...COMMIT_ALICE, Amount: X(50) }, expect: 'tesSUCCESS',
    pre: 'rAlice 100 USD since activation (TenureStart 0); now tau=4000', post: 'Amount 150; TenureStart ceil((100*0 + 50*4000)/150) = 1334; TermEnd 15000; tenure 150*(4000-1334) <= old 100*4000',
    check: (a, b, t) => { const k = a.commitments[K('rAlice')]; t.equal(k.Amount, X(150)); t.equal(k.TenureStart, 1_334); t.equal(k.TermEnd, 15_000); t.ok(BigInt(k.Amount) * BigInt(4_000 - k.TenureStart) <= BigInt(X(100)) * 4_000n); } },
  { id: 'XV-26', group: 'commit', title: 'Commit to a CLOSED corridor', setup: [...ACTIVE, CLOSE], tx: COMMIT_DAVE, expect: 'tecCORRIDOR_STAGE',
    pre: 'corridor CLOSED by owner', post: 'no commitment', check: (a, b, t) => t.equal(a.commitments[K('rDave')], undefined) },

  // ---------------- Holds bind spending (the core accountHolds change) ----------------
  { id: 'XV-27', group: 'holds', title: 'Payment of held funds is refused', setup: [CREATE, COMMIT_ALICE], tx: { TransactionType: 'Payment', Account: 'rAlice', Destination: 'rTaker', Asset: USD, Amount: X(900) + 1 }, expect: 'tecUNFUNDED_PAYMENT',
    pre: 'rAlice 1000 USD, 100 held', post: 'balances unchanged', check: (a, b, t) => t.equal(a.accounts.rAlice.lines[USD].balance, X(1000)) },
  { id: 'XV-28', group: 'holds', title: 'Payment of unheld funds succeeds', setup: [CREATE, COMMIT_ALICE], tx: { TransactionType: 'Payment', Account: 'rAlice', Destination: 'rTaker', Asset: USD, Amount: X(900) }, expect: 'tesSUCCESS',
    pre: 'rAlice 1000 USD, 100 held', post: 'rAlice 100 USD (all held)', check: (a, b, t) => { t.equal(a.accounts.rAlice.lines[USD].balance, X(100)); t.equal(a.accounts.rAlice.held[USD], X(100)); } },
  { id: 'XV-29', group: 'holds', title: 'Held XRP cannot pay transaction fees', fixtureOpts: { fees: { base: 10, reserveBase: 0, reserveInc: 0 } }, setup: [CREATE, { ...COMMIT_CAROL, Amount: X(5000) - 10 }],
    tx: { TransactionType: 'CorridorAdvance', Account: 'rCarol', CorridorID: C }, expect: 'terINSUF_FEE_B', pre: 'reserves 0 for the vector; all of rCarol\'s remaining XRP held', post: 'not applied; no fee', check: same },

  // ---------------- Lifecycle ----------------
  { id: 'XV-30', group: 'lifecycle', title: 'Activation gate unmet: nothing to do', setup: [CREATE, COMMIT_ALICE], tx: ADVANCE, expect: 'tecCORRIDOR_NO_OP',
    pre: 'FORMING; 1 of 2 participants', post: 'stage FORMING; submitter paid fee', check: (a, b, t) => { t.equal(a.corridors[C].stage, 'FORMING'); t.equal(a.burned - b.burned, 10); } },
  { id: 'XV-31', group: 'lifecycle', title: 'Permissionless activation starts every term clock (lazily)', setup: [CREATE, COMMIT_ALICE, COMMIT_BOB, close(3_000)], tx: ADVANCE, expect: 'tesSUCCESS',
    pre: 'FORMING; gate met (200 USD, 2 participants); now t=3000', post: 'ACTIVE; ActivatedAt 3000; rAlice term ends 13000 without touching her commitment',
    check: (a, b, t) => { const c = a.corridors[C]; t.equal(c.stage, 'ACTIVE'); t.equal(c.ActivatedAt, 3_000); t.equal(a.commitments[K('rAlice')].TermEnd, null); t.equal(termEnd(c, a.commitments[K('rAlice')]), 13_000); } },
  { id: 'XV-32', group: 'lifecycle', title: 'Owner closes an ACTIVE corridor', setup: ACTIVE, tx: CLOSE, expect: 'tesSUCCESS', pre: 'ACTIVE', post: 'CLOSED; quoting stops; exit fees become zero',
    check: (a, b, t) => t.equal(a.corridors[C].stage, 'CLOSED') },
  { id: 'XV-33', group: 'lifecycle', title: 'Close by a non-owner', setup: ACTIVE, tx: { ...CLOSE, Account: 'rTaker' }, expect: 'tecNO_PERMISSION', pre: 'ACTIVE', post: 'stage ACTIVE',
    check: (a, b, t) => t.equal(a.corridors[C].stage, 'ACTIVE') },
  { id: 'XV-34', group: 'lifecycle', title: 'Maturity is lazy: no crank needed for quoting to stop', setup: [...ACTIVE, close(100_000)], tx: BUY_USD(10), expect: 'tesSUCCESS',
    pre: 'ACTIVE stored; MaturityTime 100000 reached; never advanced', post: 'corridor fills 0; AMM fills 10 USD',
    check: (a, b, t, r) => { t.equal(r.trace.corridor, 0); t.equal(r.trace.amm, X(10)); } },
  { id: 'XV-35', group: 'lifecycle', title: 'Advance persists MATURED', setup: [...ACTIVE, close(100_000)], tx: ADVANCE, expect: 'tesSUCCESS', pre: 'maturity reached', post: 'stage MATURED',
    check: (a, b, t) => t.equal(a.corridors[C].stage, 'MATURED') },
  { id: 'XV-36', group: 'lifecycle', title: 'Reference refresh crank in a later ledger', setup: [...ACTIVE, close(1_005)], tx: ADVANCE, expect: 'tesSUCCESS',
    pre: 'candidate recorded at activation (ledger 1); now ledger 2', post: 'candidate promoted to RefPrice (RefLedger 1); new candidate at ledger 2',
    check: (a, b, t) => { const c = a.corridors[C]; t.equal(c.RefLedger, 1); t.equal(c.NextLedger, 2); } },

  // ---------------- AMM-pegged corridor quotes (the step function) ----------------
  { id: 'XV-37', group: 'quote', title: 'Corridor undercuts the AMM at every depth level', setup: ACTIVE, tx: BUY_USD(100), expect: 'tesSUCCESS',
    pre: 'ACTIVE; Alice and Bob 100 USD each, MaxPerLevel 20', post: 'corridor 90.009991 USD over 3 levels, AMM 9.990009 USD between levels; taker pays 200.561959 XRP (AMM alone: 202.628087)',
    check: (a, b, t, r) => { t.equal(r.trace.corridor, 90_009_991); t.equal(r.trace.amm, 9_990_009); t.equal(r.trace.paid, 200_561_959); t.equal(r.trace.levels.length, 3); t.equal(a.accounts.rTaker.lines[USD].balance, X(100_100)); } },
  { id: 'XV-38', group: 'quote', title: 'Quote = AMM spot quality incl. fee, improved by ImprovementBps, rounded for the taker', setup: ACTIVE, tx: BUY_USD(20), expect: 'tesSUCCESS',
    pre: 'AMM spot 0.4985 USD per XRP (fee included); ImprovementBps 10', post: 'Alice sells 20 USD for 40.080280 XRP = floor(20e6 * 20000e6 * 100000 * 10000 / (10000e6 * 99700 * 10010)); AMM untouched',
    check: (a, b, t, r) => { const f = filled(r); t.equal(f.length, 1); t.equal(f[0].out, X(20)); t.equal(f[0].in, 40_080_280); t.equal(r.trace.amm, 0); t.equal(f[0].in, Number(20_000_000n * 20_000_000_000n * 100_000n * 10_000n / (10_000_000_000n * 99_700n * 10_010n))); t.deepEqual(a.amms[AMM].pool, b.amms[AMM].pool); } },
  { id: 'XV-39', group: 'quote', title: 'MaxPerLevel spreads a provider across depth; AMM fills between levels', setup: ACTIVE, tx: BUY_USD(60), expect: 'tesSUCCESS',
    pre: 'Alice and Bob MaxPerLevel 20', post: 'no fill above 20 USD; level 2 quotes a worse price than level 1 (AMM moved)',
    check: (a, b, t, r) => { for (const f of filled(r)) t.ok(f.out <= X(20)); t.ok(r.trace.amm > 0); const [l1, l2] = r.trace.levels; t.ok(l2.fills[0].in * l1.fills[0].out > l1.fills[0].in * l2.fills[0].out); } },
  { id: 'XV-40', group: 'quote', title: 'Tenure priority: older tenure fills first', setup: [...AT(1_500), COMMIT_DAVE], tx: BUY_USD(30), expect: 'tesSUCCESS',
    pre: 'Alice, Bob TenureStart 0; Dave joined at tau=500', post: 'level 1: Alice 20, Bob 10; Dave nothing',
    check: (a, b, t, r) => { t.equal(filledBy(r, 'rAlice'), X(20)); t.equal(filledBy(r, 'rBob'), X(10)); t.equal(filledBy(r, 'rDave'), 0); } },
  { id: 'XV-41', group: 'quote', title: 'Equal tenure: tie broken by CommitmentID', setup: [CREATE, COMMIT_BOB, COMMIT_ALICE, ADVANCE], tx: BUY_USD(30), expect: 'tesSUCCESS',
    pre: 'Bob committed before Alice; both TenureStart 0 (pre-activation)', post: 'rAlice (lower CommitmentID) fills first',
    check: (a, b, t, r) => { const f = filled(r); t.equal(f[0].account, 'rAlice'); t.equal(f[1].account, 'rBob'); } },
  { id: 'XV-42', group: 'quote', title: 'Commitments examined per level are capped (8)',
    fixtureOpts: { extraAccounts: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [`rP${i}`, { xrp: X(100), lines: { [USD]: X(10) } }])) },
    setup: [{ ...CREATE, MaxParticipants: 12, MinParticipants: 1, Threshold: undefined }, ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ TransactionType: 'CorridorCommit', Account: `rP${i}`, CorridorID: C, Asset: USD, Amount: X(2), MaxPerLevel: X(1) })), ADVANCE],
    tx: BUY_USD(9), expect: 'tesSUCCESS', pre: '9 providers, 2 USD each, MaxPerLevel 1', post: 'level 1 examines 8 and fills rP1..rP8; rP9 waits (priority, not round-robin)',
    check: (a, b, t, r) => { const l1 = r.trace.levels[0]; t.equal(l1.examined, 8); t.equal(l1.fills.length, 8); t.ok(!l1.fills.some((f) => f.account === 'rP9')); } },
  { id: 'XV-43', group: 'quote', title: 'Provider MinRate above the quote: provider skipped', setup: [CREATE, { ...COMMIT_ALICE, MinRate: [21, 10] }, COMMIT_BOB, ADVANCE], tx: BUY_USD(30), expect: 'tesSUCCESS',
    pre: 'Alice sells only at >= 2.1 XRP/USD; quote ~2.004', post: 'Alice fills nothing; Bob fills',
    check: (a, b, t, r) => { t.equal(filledBy(r, 'rAlice'), 0); t.ok(filledBy(r, 'rBob') > 0); } },
  { id: 'XV-44', group: 'quote', title: 'XRP-side provider fills a USD seller within MaxRate', setup: [CREATE, COMMIT_ALICE, COMMIT_BOB, { ...COMMIT_CAROL, MaxRate: [2, 1] }, ADVANCE], tx: BUY_XRP(40), expect: 'tesSUCCESS',
    pre: 'Carol sells XRP at <= 2 XRP per USD; quote ~1.996', post: 'Carol sells 40 XRP; her XRP hold falls 40; she receives USD (unheld)',
    check: (a, b, t, r) => { t.equal(filledBy(r, 'rCarol'), X(40)); t.equal(a.accounts.rCarol.held[XRP], X(160)); t.ok(a.accounts.rCarol.lines[USD].balance > 0); t.equal(a.accounts.rCarol.held[USD], undefined); } },
  { id: 'XV-45', group: 'quote', title: 'XRP-side MaxRate below the quote: provider skipped', setup: [CREATE, COMMIT_ALICE, COMMIT_BOB, { ...COMMIT_CAROL, MaxRate: [19, 10] }, ADVANCE], tx: BUY_XRP(40), expect: 'tesSUCCESS',
    pre: 'Carol MaxRate 1.9 XRP per USD', post: 'corridor fills 0; AMM fills all', check: (a, b, t, r) => { t.equal(r.trace.corridor, 0); t.equal(r.trace.amm, X(40)); } },
  { id: 'XV-46', group: 'quote', title: 'A better CLOB offer is consumed before the corridor', fixtureOpts: { offers: [{ owner: 'rMaker', gets: { asset: USD, value: X(10) }, pays: { asset: XRP, value: X(19) } }] }, setup: ACTIVE, tx: BUY_USD(30), expect: 'tesSUCCESS',
    pre: 'rMaker sells 10 USD at 1.9 XRP/USD (better than the corridor ~2.004)', post: 'CLOB 10 USD first, then corridor 20 USD',
    check: (a, b, t, r) => { t.equal(r.trace.clob, X(10)); t.equal(r.trace.corridor, X(20)); t.equal(Object.keys(a.offers).length, 0); } },
  { id: 'XV-47', group: 'quote', title: 'A worse CLOB offer waits behind corridor and AMM', fixtureOpts: { offers: [{ owner: 'rMaker', gets: { asset: USD, value: X(10) }, pays: { asset: XRP, value: X(21) } }] }, setup: ACTIVE, tx: BUY_USD(30), expect: 'tesSUCCESS',
    pre: 'rMaker sells at 2.1 XRP/USD', post: 'CLOB untouched', check: (a, b, t, r) => { t.equal(r.trace.clob, 0); t.equal(Object.values(a.offers)[0].gets.value, X(10)); } },
  { id: 'XV-48', group: 'quote', title: 'AMM emptied: corridor stops quoting', setup: [...ACTIVE, { TransactionType: 'AMMWithdraw', Account: 'rLP', Asset: USD, Asset2: XRP, WithdrawAll: true }], tx: BUY_USD(10), expect: 'tecPATH_DRY',
    pre: 'ACTIVE; LP withdrew everything (AMM empty)', post: 'no corridor quote without its AMM; nothing delivered', check: (a, b, t) => t.equal(a.accounts.rAlice.held[USD], X(100)) },
  { id: 'XV-49', group: 'quote', title: 'AMM frozen by the issuer: corridor stops quoting', setup: [...ACTIVE, { TransactionType: 'TrustSet', Account: 'rIssuer', Holder: AMM, Asset: USD, Freeze: true }], tx: BUY_USD(10), expect: 'tecPATH_DRY',
    pre: 'issuer froze the AMM\'s USD line', post: 'nothing delivered', check: (a, b, t) => t.equal(a.accounts.rBob.held[USD], X(100)) },
  { id: 'XV-50', group: 'quote', title: 'FORMING corridor does not quote', setup: [CREATE, COMMIT_ALICE, COMMIT_BOB], tx: BUY_USD(10), expect: 'tesSUCCESS',
    pre: 'gate met but not activated', post: 'AMM only', check: (a, b, t, r) => { t.equal(r.trace.corridor, 0); t.equal(r.trace.amm, X(10)); } },
  { id: 'XV-51', group: 'quote', title: 'Volatility pause blocks a same-ledger AMM manipulation', setup: [...ACTIVE, MANIP], tx: BUY_USD(50), expect: 'tesSUCCESS',
    pre: 'same ledger: AMM USD price pushed ~9.75% below the reference; PauseBps 500', post: 'corridor fills 0 (paused); AMM fills 50 USD',
    check: (a, b, t, r) => { t.equal(r.trace.corridor, 0); t.equal(r.trace.amm, X(50)); } },
  { id: 'XV-52', group: 'quote', title: 'Without PauseBps the same manipulation fills providers at the depressed price', setup: [{ ...CREATE, PauseBps: undefined }, COMMIT_ALICE, COMMIT_BOB, ADVANCE, MANIP], tx: BUY_USD(50), expect: 'tesSUCCESS',
    pre: 'as XV-56 but no pause', post: 'corridor fills; first fill below 1.82 XRP/USD (vs ~2.004 before manipulation) — Alice\'s MinRate 1.0 still holds',
    check: (a, b, t, r) => { const f = filled(r); t.ok(r.trace.corridor > 0); t.ok(f[0].in * 100 < f[0].out * 182); } },
  { id: 'XV-53', group: 'quote', title: 'Pause clears once the moved price persists into a later ledger', setup: [...ACTIVE, MANIP, close(1_005), ADVANCE, close(1_010), ADVANCE], tx: BUY_USD(50), expect: 'tesSUCCESS',
    pre: 'moved price recorded in ledger 2, promoted in ledger 3', post: 'corridor quotes again around the new AMM price',
    check: (a, b, t, r) => { t.ok(r.trace.corridor > 0); t.equal(a.corridors[C].RefLedger, 2); } },
  { id: 'XV-54', group: 'quote', title: 'A provider never fills its own payment', setup: ACTIVE, tx: { ...BUY_USD(30), Account: 'rAlice' }, expect: 'tesSUCCESS',
    pre: 'rAlice is the taker and a provider', post: 'rAlice\'s commitment skipped; Bob fills', check: (a, b, t, r) => { t.equal(filledBy(r, 'rAlice'), 0); t.ok(filledBy(r, 'rBob') > 0); } },
  { id: 'XV-55', group: 'quote', title: 'Taker cannot fund the step', setup: ACTIVE, tx: { ...BUY_USD(1000), Account: 'rOutsider' }, expect: 'tecUNFUNDED_PAYMENT',
    pre: 'rOutsider 1000 XRP; ~2,100 XRP needed', post: 'whole step rolled back', check: (a, b, t) => { t.equal(a.accounts.rAlice.held[USD], X(100)); t.deepEqual(a.amms, b.amms); } },

  // ---------------- Withdraw, prorated exit fee, tenure-weighted fee pool ----------------
  { id: 'XV-56', group: 'withdraw', title: 'Withdrawal before activation is free', setup: [CREATE, COMMIT_ALICE, COMMIT_BOB], tx: WD('rAlice'), expect: 'tesSUCCESS',
    pre: 'FORMING; rAlice term commitment 100 USD', post: 'no fee; commitment deleted; hold released; balance 1000',
    check: (a, b, t, r) => { t.equal(r.trace.fee, 0); t.equal(a.commitments[K('rAlice')], undefined); t.equal(a.accounts.rAlice.lines[USD].balance, X(1000)); t.deepEqual(a.accounts.rAlice.held, {}); } },
  { id: 'XV-57', group: 'withdraw', title: 'Early exit at half term pays a prorated fee to the stayers', setup: AT(6_000), tx: WD('rAlice'), expect: 'tesSUCCESS',
    pre: 'activated t=1000; term 10000; now 6000 (remaining 5000); ExitFeeBps 500', post: 'fee = 100 * 5% * 5000/10000 = 2.5 USD into the pool; Bob entitled to it (within rounding dust)',
    check: (a, b, t, r) => { t.equal(r.trace.fee, 2_500_000); t.equal(a.accounts.rAlice.lines[USD].balance, X(997.5)); const c = a.corridors[C]; t.equal(c.sides[USD].pool, 2_500_000); near(t, entitlement(c, a.commitments[K('rBob')]), 2_500_000, 1, 'Bob share'); } },
  { id: 'XV-58', group: 'withdraw', title: 'Term clock starts at activation, not at commit', setup: [CREATE, COMMIT_ALICE, COMMIT_BOB, close(3_000), ADVANCE, close(8_000)], tx: WD('rAlice'), expect: 'tesSUCCESS',
    pre: 'committed t=1000, activated t=3000, now t=8000', post: 'remaining 13000-8000 = 5000: fee 2.5 USD (it would be 1.5 if the clock had started at commit)',
    check: (a, b, t, r) => t.equal(r.trace.fee, 2_500_000) },
  { id: 'XV-59', group: 'withdraw', title: 'No fee once the term has ended', setup: AT(11_000), tx: WD('rAlice'), expect: 'tesSUCCESS', pre: 'term ended at 11000', post: 'fee 0; commitment deleted',
    check: (a, b, t, r) => { t.equal(r.trace.fee, 0); t.equal(a.accounts.rAlice.lines[USD].balance, X(1000)); } },
  { id: 'XV-60', group: 'withdraw', title: 'No fee after the owner closes the corridor', setup: [...AT(2_000), CLOSE], tx: WD('rAlice'), expect: 'tesSUCCESS', pre: 'CLOSED at t=2000, term not over', post: 'fee 0',
    check: (a, b, t, r) => t.equal(r.trace.fee, 0) },
  { id: 'XV-61', group: 'withdraw', title: 'No fee after maturity (lazy, no crank)', setup: [{ ...CREATE, MaturityTime: 4_000 }, COMMIT_ALICE, COMMIT_BOB, ADVANCE, close(4_000)], tx: WD('rAlice'), expect: 'tesSUCCESS',
    pre: 'MaturityTime 4000 reached; stage still stored ACTIVE', post: 'fee 0', check: (a, b, t, r) => t.equal(r.trace.fee, 0) },
  { id: 'XV-62', group: 'withdraw', title: 'Flexible commitment exits free while ACTIVE', setup: AT(2_000), tx: WD('rBob', X(40)), expect: 'tesSUCCESS', pre: 'rBob flexible', post: 'fee 0; hold 60',
    check: (a, b, t, r) => { t.equal(r.trace.fee, 0); t.equal(a.accounts.rBob.held[USD], X(60)); } },
  { id: 'XV-63', group: 'withdraw', title: 'Partial early exit: fee on the withdrawn part, tenure reduced proportionally', setup: AT(6_000), tx: WD('rAlice', X(50)), expect: 'tesSUCCESS',
    pre: 'rAlice 100 USD, tenure 100*5000', post: 'fee 1.25 USD; Amount 50; TenureStart unchanged (tenure halves to 50*5000); payer accrues nothing from its own fee',
    check: (a, b, t, r) => { t.equal(r.trace.fee, 1_250_000); const k = a.commitments[K('rAlice')], c = a.corridors[C]; t.equal(k.Amount, X(50)); t.equal(k.TenureStart, 0); t.equal(entitlement(c, k), 0); t.equal(a.accounts.rAlice.held[USD], X(50)); } },
  { id: 'XV-64', group: 'withdraw', title: 'Exit fee rounds down (participant\'s favor)', setup: AT(6_000), tx: WD('rAlice', 999_999), expect: 'tesSUCCESS',
    pre: 'withdraw 0.999999 USD at half term', post: 'fee floor(999999 * 500 * 5000 / (10000 * 10000)) = 24999 (exact 24999.975)', check: (a, b, t, r) => t.equal(r.trace.fee, 24_999) },
  { id: 'XV-65', group: 'withdraw', title: 'Fee shared by stayers in proportion to tenure', setup: [...AT(3_500), COMMIT_DAVE, close(6_000)], tx: WD('rAlice'), expect: 'tesSUCCESS',
    pre: 'Bob 100 USD since tau=0 (tenure 100*5000); Dave 100 USD since tau=2500 (tenure 100*2500)', post: 'Bob ~1.666666 USD, Dave ~0.833333 USD; total <= 2.5 USD',
    check: (a, b, t) => { const c = a.corridors[C]; const eb = entitlement(c, a.commitments[K('rBob')]), ed = entitlement(c, a.commitments[K('rDave')]); near(t, eb, 1_666_666, 1, 'Bob'); near(t, ed, 833_333, 1, 'Dave'); t.ok(eb + ed <= 2_500_000); } },
  { id: 'XV-66', group: 'withdraw', title: 'Claim pays a stayer its share without withdrawing', setup: [...AT(6_000), WD('rAlice')], tx: CLAIM('rBob'), expect: 'tesSUCCESS',
    pre: 'pool 2.5 USD from Alice\'s exit', post: 'rBob +~2.5 USD (free balance); hold unchanged; dust stays in the pool',
    check: (a, b, t, r) => { near(t, r.trace.claimed, 2_500_000, 1, 'claimed'); t.equal(a.accounts.rBob.held[USD], X(100)); t.equal(a.corridors[C].sides[USD].pool, 2_500_000 - r.trace.claimed); } },
  { id: 'XV-67', group: 'withdraw', title: 'Claim with nothing accrued', setup: AT(2_000), tx: CLAIM('rBob'), expect: 'tecCORRIDOR_NO_OP', pre: 'no exit fees yet', post: 'fee claimed; nothing else', check: (a, b, t) => t.equal(a.accounts.rBob.lines[USD].balance, X(1000)) },
  { id: 'XV-68', group: 'withdraw', title: 'Last provider on a side sweeps rounding dust; pool empties', setup: [...AT(6_000), WD('rAlice')], tx: WD('rBob'), expect: 'tesSUCCESS',
    pre: 'Bob is the last USD provider', post: 'Bob receives his share plus dust (2.5 USD total); USD pool 0',
    check: (a, b, t, r) => { t.equal(r.trace.claimed + r.trace.swept, 2_500_000); t.equal(a.corridors[C].sides[USD].pool, 0); t.equal(a.accounts.rBob.lines[USD].balance, X(1002.5)); } },
  { id: 'XV-69', group: 'withdraw', title: 'Fee waived when no other provider has tenure', setup: [...AT(6_000), WD('rBob')], tx: WD('rAlice'), expect: 'tesSUCCESS',
    pre: 'Bob already left; Alice alone with term remaining', post: 'fee 0 (nobody stays to compensate)', check: (a, b, t, r) => t.equal(r.trace.fee, 0) },
  { id: 'XV-70', group: 'withdraw', title: 'Fee waived while the referenced AMM is empty', setup: [...AT(6_000), { TransactionType: 'AMMWithdraw', Account: 'rLP', Asset: USD, Asset2: XRP, WithdrawAll: true }], tx: WD('rAlice'), expect: 'tesSUCCESS',
    pre: 'AMM emptied during the term', post: 'fee 0: a corridor that cannot quote cannot charge for leaving', check: (a, b, t, r) => t.equal(r.trace.fee, 0) },
  { id: 'XV-71', group: 'withdraw', title: 'Partial withdraw larger than the commitment', setup: ACTIVE, tx: WD('rBob', X(101)), expect: 'tecINSUFFICIENT_FUNDS', pre: 'rBob 100 USD', post: 'hold unchanged',
    check: (a, b, t) => t.equal(a.accounts.rBob.held[USD], X(100)) },
  { id: 'XV-72', group: 'withdraw', title: 'Issuer freeze blocks a fee-bearing exit', setup: [...AT(6_000), { TransactionType: 'TrustSet', Account: 'rIssuer', Holder: 'rAlice', Asset: USD, Freeze: true }], tx: WD('rAlice'), expect: 'tecFROZEN',
    pre: 'rAlice\'s USD line frozen; fee 2.5 USD would move', post: 'hold unchanged (issuer controls take precedence)', check: (a, b, t) => t.equal(a.accounts.rAlice.held[USD], X(100)) },
  { id: 'XV-73', group: 'withdraw', title: 'Fully filled commitment: withdraw deletes it and frees the reserve', setup: [...ACTIVE, BUY_USD(100), BUY_USD(100), BUY_USD(100)], tx: WD('rBob'), expect: 'tesSUCCESS',
    pre: 'Bob\'s 100 USD all sold to takers through corridor levels', post: 'commitment deleted; OwnerCount back to 1 (trust line)',
    check: (a, b, t) => { t.equal(b.commitments[K('rBob')].Amount, 0); t.equal(a.commitments[K('rBob')], undefined); t.equal(a.accounts.rBob.ownerCount, 1); } },

  // ---------------- Deletion, account deletion, issuer controls ----------------
  { id: 'XV-74', group: 'delete', title: 'Delete with live commitments', setup: [CREATE, COMMIT_ALICE], tx: { TransactionType: 'CorridorDelete', Account: 'rOwner', CorridorID: C }, expect: 'tecHAS_OBLIGATIONS',
    pre: '1 commitment', post: 'corridor exists', check: (a, b, t) => t.ok(a.corridors[C]) },
  { id: 'XV-75', group: 'delete', title: 'Delete an empty CLOSED corridor', setup: [...ACTIVE, CLOSE, WD('rAlice'), WD('rBob')], tx: { TransactionType: 'CorridorDelete', Account: 'rOwner', CorridorID: C }, expect: 'tesSUCCESS',
    pre: 'CLOSED; everyone withdrew free', post: 'corridor deleted; rOwner OwnerCount 0', check: (a, b, t) => { t.equal(a.corridors[C], undefined); t.equal(a.accounts.rOwner.ownerCount, 0); } },
  { id: 'XV-76', group: 'account', title: 'Provider with a commitment cannot delete the account', setup: [CREATE, { ...COMMIT_CAROL, Account: 'rNoLine', Amount: X(10) }], tx: { TransactionType: 'AccountDelete', Account: 'rNoLine', Destination: 'rTaker' }, expect: 'tecHAS_OBLIGATIONS',
    pre: 'rNoLine (no trust lines) holds an XRP commitment', post: 'account exists; hold unchanged', check: (a, b, t) => t.equal(a.accounts.rNoLine.held[XRP], X(10)) },
  { id: 'XV-77', group: 'issuer', title: 'Clawback clamps the hold and settles the fee accumulator first', setup: [...AT(6_000), COMMIT_DAVE, WD('rAlice')], tx: { TransactionType: 'Clawback', Account: 'rIssuer', Holder: 'rBob', Asset: USD, Amount: X(950) }, expect: 'tesSUCCESS',
    pre: 'rBob 1000 USD, 100 held, fee share accrued', post: 'balance 50; hold clamped to 50; accrued share preserved in Pending',
    check: (a, b, t) => { const k = a.commitments[K('rBob')]; t.equal(a.accounts.rBob.held[USD], X(50)); t.equal(k.Amount, X(50)); t.equal(entitlement(a.corridors[C], k), entitlement(b.corridors[C], b.commitments[K('rBob')])); t.ok(k.Pending > 0); } },

  // ---------------- Replay protection ----------------
  { id: 'XV-78', group: 'replay', title: 'Replay of an applied transaction', setup: [CREATE], tx: { ...CREATE, Sequence: 1 }, expect: 'tefPAST_SEQ', pre: 'rOwner Sequence now 2', post: 'state identical', check: same },
  { id: 'XV-79', group: 'replay', title: 'Commit using a Ticket', setup: [CREATE, { TransactionType: 'TicketCreate', Account: 'rAlice', TicketCount: 2 }], tx: { ...COMMIT_ALICE, Sequence: 0, TicketSequence: 2 }, expect: 'tesSUCCESS',
    pre: 'rAlice tickets [2,3]', post: 'ticket 2 consumed; commitment created; Sequence unchanged', check: (a, b, t) => { t.deepEqual(a.accounts.rAlice.tickets, [3]); t.ok(a.commitments[K('rAlice')]); t.equal(a.accounts.rAlice.seq, b.accounts.rAlice.seq); } },
  { id: 'XV-80', group: 'replay', title: 'Reuse of a consumed Ticket', setup: [CREATE, { TransactionType: 'TicketCreate', Account: 'rAlice', TicketCount: 2 }, { ...COMMIT_ALICE, Sequence: 0, TicketSequence: 2 }], tx: { ...COMMIT_ALICE, Sequence: 0, TicketSequence: 2 }, expect: 'tefNO_TICKET',
    pre: 'ticket 2 consumed', post: 'state identical', check: same },
];

// Build the pre-state for a vector; returns { state, setupResults }.
export function buildPre(v, { apply }) {
  let s = fixture(v.fixtureOpts || {});
  const results = [];
  for (const step of v.setup) {
    if (step.close != null) { s = closeLedger(s, step.close); continue; }
    const tx = { Fee: s.fees.base, ...step };
    for (const k of Object.keys(tx)) if (tx[k] === undefined) delete tx[k];
    if (tx.TicketSequence == null && tx.Sequence == null && s.accounts[tx.Account]) tx.Sequence = s.accounts[tx.Account].seq;
    const r = apply(s, tx); results.push({ tx: tx.TransactionType, result: r.result }); s = r.state;
  }
  return { state: s, setupResults: results };
}

export function txFor(v, state) {
  const tx = { Fee: state.fees.base, ...v.tx };
  for (const k of Object.keys(tx)) if (tx[k] === undefined) delete tx[k];
  if (tx.TicketSequence == null && tx.Sequence == null && state.accounts[tx.Account]) tx.Sequence = state.accounts[tx.Account].seq;
  if (tx.TicketSequence != null) tx.Sequence = 0;
  return tx;
}

export { tau, spotQuality };
