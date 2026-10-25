// XDLC (XRPL Dynamic Liquidity Corridors): executable specification model, v0.2 (AMM-pegged corridor design).
//
// This is a pure JavaScript state-transition model of a PROPOSED XRP Ledger amendment (XLS-XXXX, unassigned).
// It is NOT xrpld code, it is NOT the amendment, and nothing here touches a network. It exists so that the candidate
// rules in docs/XDLC_AMENDMENT_PROPOSAL.md can be executed and checked: apply(state, tx) -> { result, state, trace }.
//
// Design in one paragraph: a corridor references an existing XLS-30 AMM. Providers commit funds that STAY in their
// own accounts (a ledger "hold" makes them unspendable). When a payment or offer crossing reaches the AMM's book, the
// payment engine synthesizes a corridor quote whose quality is the AMM's current spot quality (including its trading
// fee) improved by the corridor's ImprovementBps. Corridor liquidity at each depth level is drawn from commitments in
// tenure order, bounded per commitment (MaxPerLevel, MinRate/MaxRate) and per step (protocol caps). Term commitments
// can always exit; early exit pays a prorated fee into a fee pool that is shared by the providers who stay, weighted
// by tenure, through an O(1) accumulator. No oracle, no AI, no off-ledger input.
//
// Modeling simplifications (documented in docs/XDLC_DETERMINISTIC_TESTS.md):
//  - Amounts are safe non-negative integers (XRP in drops; issued tokens in integer micro-units). Real xrpld uses
//    STAmount (IOU decimal floating point / MPT 64-bit integers) and Number with its own rounding rules.
//  - `ModelSwap` stands in for one BookStep of the existing payment engine on one book (exact-out, partial allowed):
//    it interleaves CLOB offers, the AMM and corridor quotes by quality. Multi-path Flow, strand ranking and
//    auto-bridging are not modeled (see proposal section 3.6).
//  - Payment, TicketCreate, Clawback and AccountDelete are reduced to the subset of existing behavior that interacts
//    with XDLC objects. AMM LP tokens are not modeled; the AMM is its pool balances, trading fee and a usable flag.
//  - Object IDs are readable strings derived deterministically from (type, account, sequence), standing in for keylets.
//
// Deterministic: no clock, no randomness, no I/O. Time is `state.closeTime` (parent ledger close time, seconds) and
// `state.ledgerSeq`, both advanced explicitly with closeLedger().

export const MODEL_VERSION = '0.2.0-draft';

// Candidate protocol caps (design candidates, open for review).
export const CAPS = Object.freeze({
  BPS: 10_000,
  MIN_IMPROVEMENT_BPS: 1,            // a corridor quote is always at least 1 bp better than the AMM it references
  MAX_IMPROVEMENT_BPS: 500,
  MAX_EXIT_FEE_BPS: 1_000,           // early-exit fee cap: 10% of the withdrawn amount at the very start of a term
  MAX_PAUSE_BPS: 5_000,
  MAX_LOCK_DURATION: 126_230_400,    // 4 years in seconds
  MAX_PARTICIPANTS: 512,             // commitments per corridor (16 directory pages of 32)
  DIR_PAGE_SIZE: 32,
  MAX_CORRIDORS_PER_BOOK: 4,         // corridors evaluated for one AMM book in one step (highest ImprovementBps first)
  MAX_CORRIDOR_LEVELS_PER_STEP: 16,  // corridor depth levels consumed in one step, across all corridors on the book
  MAX_COMMITMENTS_PER_LEVEL: 8,      // commitments examined (filled or skipped) per corridor level
  MAX_STEP_ITERATIONS: 64,           // total source selections in one step (model stand-in for engine limits)
  MAX_TICKETS_PER_TX: 250,
  AMM_FEE_DEN: 100_000,              // XLS-30 TradingFee unit: 1/100,000 (max 1000 = 1%)
  MAX_AMM_FEE: 1_000,
});
export const ACC_SCALE = 10n ** 18n; // fixed-point scale of the fee-pool accumulator indices

export const STAGES = Object.freeze(['FORMING', 'ACTIVE', 'MATURED', 'CLOSED']);
export const XDLC_TX_TYPES = Object.freeze(['CorridorCreate', 'CorridorCommit', 'CorridorWithdraw', 'CorridorClaim', 'CorridorAdvance', 'CorridorDelete']);
export const EXISTING_TX_TYPES = Object.freeze(['Payment', 'TicketCreate', 'Clawback', 'AccountDelete', 'TrustSet', 'AMMWithdraw', 'ModelSwap']);
export const tfClose = 0x00010000;

// Result codes. Existing xrpld codes are reused where the meaning matches; names marked NEW are candidates only.
export const RESULT_CODES = Object.freeze({
  tesSUCCESS: 'existing',
  temDISABLED: 'existing', temMALFORMED: 'existing', temBAD_AMOUNT: 'existing', temBAD_FEE: 'existing', temINVALID_FLAG: 'existing',
  temBAD_EXPIRATION: 'existing',
  tefPAST_SEQ: 'existing', tefNO_TICKET: 'existing', terPRE_SEQ: 'existing', terNO_ACCOUNT: 'existing', terINSUF_FEE_B: 'existing', terNO_AMM: 'existing',
  tecNO_ENTRY: 'existing', tecNO_PERMISSION: 'existing', tecINSUFFICIENT_RESERVE: 'existing', tecUNFUNDED: 'existing',
  tecUNFUNDED_PAYMENT: 'existing', tecINSUFFICIENT_FUNDS: 'existing', tecHAS_OBLIGATIONS: 'existing',
  tecNO_LINE: 'existing', tecFROZEN: 'existing', tecEXPIRED: 'existing', tecNO_DST: 'existing', tecINVARIANT_FAILED: 'existing',
  tecAMM_EMPTY: 'existing', tecPATH_DRY: 'existing', tecNO_AUTH: 'existing', tecOBJECT_NOT_FOUND: 'existing',
  tecCORRIDOR_STAGE: 'NEW (candidate)', tecCORRIDOR_LIMIT: 'NEW (candidate)', tecCORRIDOR_BOUND: 'NEW (candidate)',
  tecCORRIDOR_ASSET: 'NEW (candidate)', tecCORRIDOR_TERMS: 'NEW (candidate)', tecCORRIDOR_NO_OP: 'NEW (candidate)',
});

const B = BigInt;
const { BPS } = CAPS;
const FD = B(CAPS.AMM_FEE_DEN);
const clone = (x) => structuredClone(x);
const isAmt = (v) => Number.isSafeInteger(v) && v > 0;
const isTime = (v) => Number.isSafeInteger(v) && v >= 0;
const isAsset = (a) => a === 'XRP' || (typeof a === 'string' && /^[A-Z0-9]{3,40}\.r[A-Za-z0-9]+$/.test(a));
const isRate = (r) => Array.isArray(r) && r.length === 2 && isAmt(r[0]) && isAmt(r[1]);
const issuerOf = (a) => (a === 'XRP' ? null : a.split('.')[1]);
const idCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const maxB = (a, b) => (a > b ? a : b);

// Exact integer helpers (no floating point anywhere in consensus-relevant math).
export const ceilDiv = (a, d) => (a + d - 1n) / d; // a >= 0, d > 0
export function isqrt(n) { if (n < 2n) return n; let x0 = n, x1 = (n >> 1n) + 1n; while (x1 < x0) { x0 = x1; x1 = (x1 + n / x1) >> 1n; } return x0; }
const ceilSqrt = (m) => { const r = isqrt(m); return r * r < m ? r + 1n : r; };
// Rationals {n, d} (BigInt, d > 0). Quality = units OUT per unit IN for the taker: higher is better for the taker.
export const qGt = (a, b) => a.n * b.d > b.n * a.d;

// ---------------------------------------------------------------------------------------------------------------
// State construction
// ---------------------------------------------------------------------------------------------------------------
export const ammId = (a, b) => `AMM:${[a, b].sort().join('/')}`;
export const corridorId = (owner, seq) => `CORRIDOR:${owner}:${seq}`;
export const commitmentId = (cid, account, asset) => `COMMIT:${cid}:${account}:${asset}`;
export const offerId = (account, seq) => `OFFER:${account}:${seq}`;

export function genesis({ closeTime = 1_000, ledgerSeq = 1, fees = { base: 10, reserveBase: 1_000_000, reserveInc: 200_000 }, amendments = { XDLC: true }, accounts = {}, amms = [], offers = [], domains = {} } = {}) {
  const s = { amendments: { ...amendments }, closeTime, ledgerSeq, fees: { ...fees }, burned: 0, accounts: {}, amms: {}, corridors: {}, commitments: {}, offers: {}, domains: clone(domains) };
  for (const [id, a] of Object.entries(accounts)) {
    s.accounts[id] = { xrp: a.xrp ?? 0, seq: a.seq ?? 1, ownerCount: 0, tickets: [], lines: {}, held: {} };
    for (const [asset, bal] of Object.entries(a.lines || {})) {
      s.accounts[id].lines[asset] = { balance: typeof bal === 'number' ? bal : bal.balance, frozen: typeof bal === 'object' && !!bal.frozen };
      s.accounts[id].ownerCount += 1; // a trust line costs one owner reserve
    }
  }
  for (const m of amms) {
    const id = ammId(m.asset, m.asset2);
    s.amms[id] = { id, assets: [m.asset, m.asset2].sort(), pool: { [m.asset]: m.amount, [m.asset2]: m.amount2 }, TradingFee: m.TradingFee ?? 0, lpTokens: m.lpTokens ?? 1, lp: m.lp ?? null, frozen: !!m.frozen };
  }
  offers.forEach((o, i) => {
    const id = offerId(o.owner, 1000 + i);
    s.offers[id] = { id, owner: o.owner, gets: { ...o.gets }, pays: { ...o.pays }, quality: { gets: o.gets.value, pays: o.pays.value } };
    s.accounts[o.owner].ownerCount += 1;
  });
  return s;
}

export function closeLedger(state, closeTime) {
  if (!isTime(closeTime) || closeTime < state.closeTime) throw new Error('closeTime must be monotonic');
  const s = clone(state); s.closeTime = closeTime; s.ledgerSeq += 1; return s;
}

export const reserve = (s, ownerCount) => s.fees.reserveBase + s.fees.reserveInc * ownerCount;
const heldOf = (acct, asset) => acct.held[asset] || 0;
export const balanceOf = (acct, asset) => (asset === 'XRP' ? acct.xrp : acct.lines[asset]?.balance ?? 0);

// Spendable amount of `asset` for `acct` assuming `extraObjects` new owned objects. Holds are never spendable.
export function available(s, acct, asset, extraObjects = 0) {
  if (asset === 'XRP') return acct.xrp - reserve(s, acct.ownerCount + extraObjects) - heldOf(acct, 'XRP');
  const line = acct.lines[asset];
  if (!line) return 0;
  return line.balance - heldOf(acct, asset);
}
const adjustHeld = (acct, asset, delta) => { const v = heldOf(acct, asset) + delta; if (v === 0) delete acct.held[asset]; else acct.held[asset] = v; };
const credit = (acct, asset, v) => { if (asset === 'XRP') acct.xrp += v; else acct.lines[asset].balance += v; };

// ---------------------------------------------------------------------------------------------------------------
// AMM reads (existing XLS-30 math; the corridor only READS AMM state)
// ---------------------------------------------------------------------------------------------------------------
export const ammUsable = (amm) => !!amm && !amm.frozen && amm.lpTokens > 0 && amm.assets.every((a) => amm.pool[a] > 0);
// Spot quality for a taker paying inA and receiving outA, including the AMM trading fee.
export function spotQuality(amm, inA, outA) { return { n: B(amm.pool[outA]) * (FD - B(amm.TradingFee)), d: B(amm.pool[inA]) * FD }; }
// Corridor quote quality: AMM spot quality improved by `bps` basis points.
export function corridorQuality(spot, bps) { return { n: spot.n * B(BPS + bps), d: spot.d * B(BPS) }; }
// Price of the corridor base asset in units of Asset2, fee-free (used only by the volatility pause).
export function ammPrice(amm, base, quote) { return { n: B(amm.pool[quote]), d: B(amm.pool[base]) }; }
// XLS-30 swap-out: input needed to take `y` out of the pool, rounded up in the AMM's favor.
export function ammInFor(amm, inA, outA, y) {
  const pin = B(amm.pool[inA]), pout = B(amm.pool[outA]), fee = B(amm.TradingFee), yy = B(y);
  return Number(ceilDiv(pin * yy * FD, (pout - yy) * (FD - fee)));
}
// Largest output y such that the post-trade spot quality stays >= ratio * current spot (ratio < 1).
// Constant product: spot'/spot = ((P - y) / P)^2 (fee-exact for the curve), so y = P - ceil(sqrt(P^2 * ratio)).
export function ammSliceTo(amm, outA, ratio) {
  const p = B(amm.pool[outA]);
  return Number(p - ceilSqrt(ceilDiv(p * p * ratio.n, ratio.d)));
}

// ---------------------------------------------------------------------------------------------------------------
// Corridor helpers (deterministic, ledger-state-only conditions)
// ---------------------------------------------------------------------------------------------------------------
export function effectiveStage(s, c) {
  if (c.stage === 'ACTIVE' && c.MaturityTime != null && s.closeTime >= c.MaturityTime) return 'MATURED'; // lazy maturity
  return c.stage;
}
export const tau = (s, c) => (c.ActivatedAt == null ? 0 : s.closeTime - c.ActivatedAt); // seconds since activation
export const termEnd = (c, k) => (k.LockDuration == null ? null : k.TermEnd ?? (c.ActivatedAt == null ? null : c.ActivatedAt + k.LockDuration));
export const priorityCmp = (a, b) => a.TenureStart - b.TenureStart || idCmp(a.id, b.id);
export const tenureOf = (s, c, k) => B(k.Amount) * B(Math.max(0, tau(s, c) - k.TenureStart));

export function gateMet(s, c) {
  const n = c.commitments.filter((id) => s.commitments[id].Amount > 0).length;
  if (n < c.MinParticipants) return false;
  for (const [asset, min] of Object.entries(c.Threshold)) if (c.sides[asset].committed < min) return false;
  return true;
}

// Volatility pause: quoting stops when the AMM price deviates from the reference by more than PauseBps.
export function paused(s, c, amm) {
  if (c.PauseBps == null || !c.RefPrice) return false;
  const p = ammPrice(amm, c.Asset, c.Asset2), r = c.RefPrice;
  const dev = p.n * r.d > r.n * p.d ? p.n * r.d - r.n * p.d : r.n * p.d - p.n * r.d;
  return dev * B(BPS) > B(c.PauseBps) * r.n * p.d;
}
// Reference refresh, at most one candidate per ledger, promoted only in a LATER ledger (so a same-ledger AMM
// manipulation can never become the reference it is checked against).
export function refreshRef(s, c) {
  let changed = false;
  if (c.NextLedger != null && c.NextLedger < s.ledgerSeq) { c.RefPrice = c.NextPrice; c.RefLedger = c.NextLedger; c.NextPrice = null; c.NextLedger = null; changed = true; }
  const amm = s.amms[c.AMMID];
  if (c.NextLedger == null && ammUsable(amm)) { c.NextPrice = ammPrice(amm, c.Asset, c.Asset2); c.NextLedger = s.ledgerSeq; changed = true; }
  return changed;
}

// Fee-pool accumulator (reward-per-tenure pattern). For one side, with A = sum(a_i), S = sum(a_i * s_i) and tenure
// T_i(t) = a_i * (t - s_i), the total tenure is W(t) = t*A - S. A fee F at time t adds F*t/W to I1 and F/W to I0;
// commitment i's accrued share over a window where a_i and s_i are constant is a_i * (dI1 - s_i * dI0).
// I1 rounds down and I0 rounds up, so every rounding error is an under-payment; dust stays in the pool.
function accrued(c, k) {
  const side = c.sides[k.Asset];
  const v = (B(k.Amount) * ((side.I1 - k.I1) - B(k.TenureStart) * (side.I0 - k.I0))) / ACC_SCALE;
  return v > 0n ? Number(v) : 0;
}
export const entitlement = (c, k) => k.Pending + accrued(c, k);
function settle(c, k) { k.Pending += accrued(c, k); k.I0 = c.sides[k.Asset].I0; k.I1 = c.sides[k.Asset].I1; }

// The only way a commitment's amount or tenure start changes: settle first, then keep A, S and the account hold exact.
function setAmount(s, c, k, amount, start = k.TenureStart) {
  settle(c, k);
  const side = c.sides[k.Asset];
  side.S += B(amount) * B(start) - B(k.Amount) * B(k.TenureStart);
  side.committed += amount - k.Amount;
  adjustHeld(s.accounts[k.Account], k.Asset, amount - k.Amount);
  k.Amount = amount; k.TenureStart = start;
}

// Distribute `fee` (already debited from the payer) to the side's providers other than `exiter`, by tenure.
function distribute(s, c, asset, fee, exiter) {
  const side = c.sides[asset], t = B(tau(s, c));
  const w = t * B(side.committed) - side.S - (exiter ? tenureOf(s, c, exiter) : 0n);
  if (w <= 0n || fee <= 0) return false;
  side.I0 += ceilDiv(B(fee) * ACC_SCALE, w);
  side.I1 += (B(fee) * t * ACC_SCALE) / w;
  side.pool += fee; side.feesIn += fee;
  if (exiter) { exiter.I0 = side.I0; exiter.I1 = side.I1; } // the payer never shares in its own fee
  return true;
}
function remainingTenure(s, c, asset, exiter) {
  const side = c.sides[asset];
  return B(tau(s, c)) * B(side.committed) - side.S - (exiter ? tenureOf(s, c, exiter) : 0n);
}

// Early-exit fee: withdrawn * ExitFeeBps * remaining / LockDuration, rounded down (in the participant's favor).
// Zero unless the corridor is ACTIVE, the commitment has a term that has not ended, and the AMM is usable.
export function exitFee(s, c, k, withdrawn) {
  if (k.LockDuration == null || !k.ExitFeeBps || effectiveStage(s, c) !== 'ACTIVE') return 0;
  if (!ammUsable(s.amms[c.AMMID])) return 0; // a corridor that cannot quote cannot charge for leaving it
  const remaining = termEnd(c, k) - s.closeTime;
  if (remaining <= 0) return 0;
  return Number((B(withdrawn) * B(k.ExitFeeBps) * B(remaining)) / (B(BPS) * B(k.LockDuration)));
}

function deleteCommitment(s, c, k) {
  c.commitments = c.commitments.filter((x) => x !== k.id);
  c.sides[k.Asset].count -= 1;
  s.accounts[k.Account].ownerCount -= 1;
  delete s.commitments[k.id];
}
function payOut(s, c, k, amount) { if (amount <= 0) return 0; const side = c.sides[k.Asset]; side.pool -= amount; side.paidOut += amount; credit(s.accounts[k.Account], k.Asset, amount); return amount; }

// ---------------------------------------------------------------------------------------------------------------
// Preflight (tem): context-free checks; failing transactions never touch the ledger and claim no fee.
// ---------------------------------------------------------------------------------------------------------------
function preflight(s, tx) {
  const t = tx.TransactionType;
  if (![...XDLC_TX_TYPES, ...EXISTING_TX_TYPES].includes(t)) return 'temMALFORMED';
  if (XDLC_TX_TYPES.includes(t) && !s.amendments.XDLC) return 'temDISABLED';
  if (typeof tx.Account !== 'string') return 'temMALFORMED';
  if (!Number.isSafeInteger(tx.Fee) || tx.Fee < 0) return 'temBAD_FEE';
  if (tx.TicketSequence != null && tx.Sequence != null && tx.Sequence !== 0) return 'temMALFORMED';
  const flags = tx.Flags || 0;
  if (flags & ~(t === 'CorridorAdvance' ? tfClose : 0)) return 'temINVALID_FLAG';
  switch (t) {
    case 'CorridorCreate': {
      if (!isAsset(tx.Asset) || !isAsset(tx.Asset2) || tx.Asset === tx.Asset2) return 'temMALFORMED';
      if (!Number.isSafeInteger(tx.ImprovementBps) || tx.ImprovementBps < CAPS.MIN_IMPROVEMENT_BPS || tx.ImprovementBps > CAPS.MAX_IMPROVEMENT_BPS) return 'temMALFORMED';
      if (tx.PauseBps != null && (!Number.isSafeInteger(tx.PauseBps) || tx.PauseBps < 1 || tx.PauseBps > CAPS.MAX_PAUSE_BPS)) return 'temMALFORMED';
      if (!Number.isSafeInteger(tx.MaxParticipants) || tx.MaxParticipants < 1 || tx.MaxParticipants > CAPS.MAX_PARTICIPANTS) return 'temMALFORMED';
      const minP = tx.MinParticipants ?? 1;
      if (!Number.isSafeInteger(minP) || minP < 1 || minP > tx.MaxParticipants) return 'temMALFORMED';
      for (const obj of [tx.MinCommit || {}, tx.Threshold || {}]) {
        if (Object.keys(obj).some((a) => a !== tx.Asset && a !== tx.Asset2)) return 'temMALFORMED';
        if (Object.values(obj).some((v) => !isAmt(v))) return 'temBAD_AMOUNT';
      }
      if (tx.MaturityTime != null && !isTime(tx.MaturityTime)) return 'temBAD_EXPIRATION';
      if (tx.DomainID != null && typeof tx.DomainID !== 'string') return 'temMALFORMED';
      return null;
    }
    case 'CorridorCommit': {
      if (typeof tx.CorridorID !== 'string' || !isAsset(tx.Asset)) return 'temMALFORMED';
      if (!isAmt(tx.Amount)) return 'temBAD_AMOUNT';
      if ((tx.LockDuration == null) !== (tx.ExitFeeBps == null)) return 'temMALFORMED'; // a term is a duration AND a price
      if (tx.LockDuration != null && (!Number.isSafeInteger(tx.LockDuration) || tx.LockDuration < 1 || tx.LockDuration > CAPS.MAX_LOCK_DURATION)) return 'temBAD_EXPIRATION';
      if (tx.ExitFeeBps != null && (!Number.isSafeInteger(tx.ExitFeeBps) || tx.ExitFeeBps < 1 || tx.ExitFeeBps > CAPS.MAX_EXIT_FEE_BPS)) return 'temMALFORMED';
      if ((tx.MinRate != null && !isRate(tx.MinRate)) || (tx.MaxRate != null && !isRate(tx.MaxRate))) return 'temMALFORMED';
      if (tx.MinRate != null && tx.MaxRate != null) return 'temMALFORMED'; // one side per commitment, one bound per side
      if (tx.MaxPerLevel != null && !isAmt(tx.MaxPerLevel)) return 'temBAD_AMOUNT';
      return null;
    }
    case 'CorridorWithdraw':
      if (typeof tx.CorridorID !== 'string' || !isAsset(tx.Asset)) return 'temMALFORMED';
      if (tx.Amount != null && !isAmt(tx.Amount)) return 'temBAD_AMOUNT';
      return null;
    case 'CorridorClaim':
      return typeof tx.CorridorID === 'string' && isAsset(tx.Asset) ? null : 'temMALFORMED';
    case 'CorridorAdvance': case 'CorridorDelete':
      return typeof tx.CorridorID === 'string' ? null : 'temMALFORMED';
    case 'Payment':
      if (typeof tx.Destination !== 'string' || tx.Destination === tx.Account || !isAsset(tx.Asset)) return 'temMALFORMED';
      return isAmt(tx.Amount) ? null : 'temBAD_AMOUNT';
    case 'TicketCreate':
      return Number.isSafeInteger(tx.TicketCount) && tx.TicketCount >= 1 && tx.TicketCount <= CAPS.MAX_TICKETS_PER_TX ? null : 'temMALFORMED';
    case 'Clawback':
      if (typeof tx.Holder !== 'string' || !isAsset(tx.Asset) || tx.Asset === 'XRP' || issuerOf(tx.Asset) !== tx.Account) return 'temMALFORMED';
      return isAmt(tx.Amount) ? null : 'temBAD_AMOUNT';
    case 'AccountDelete':
      return typeof tx.Destination === 'string' && tx.Destination !== tx.Account ? null : 'temMALFORMED';
    case 'TrustSet': // subset: an issuer sets or clears freeze on a holder's line (an account, or an AMM's line)
      if (typeof tx.Holder !== 'string' || !isAsset(tx.Asset) || tx.Asset === 'XRP' || issuerOf(tx.Asset) !== tx.Account) return 'temMALFORMED';
      return typeof tx.Freeze === 'boolean' ? null : 'temMALFORMED';
    case 'AMMWithdraw': // subset: the (single, modeled) LP withdraws everything, leaving the AMM empty
      return isAsset(tx.Asset) && isAsset(tx.Asset2) && tx.WithdrawAll === true ? null : 'temMALFORMED';
    case 'ModelSwap':
      if (!isAsset(tx.SendAsset) || !isAsset(tx.DeliverAsset) || tx.SendAsset === tx.DeliverAsset) return 'temMALFORMED';
      return isAmt(tx.DeliverAmount) ? null : 'temBAD_AMOUNT';
    default: return 'temMALFORMED';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The corridor step: one BookStep on the book (inA -> outA). Sources are chosen by quality each iteration:
// CLOB offers (ties go to the CLOB), corridor quotes (always better than the AMM by >= ImprovementBps), the AMM.
// ---------------------------------------------------------------------------------------------------------------
function fillCorridorLevel(s, c, ctx, q, spot, levelNo) {
  const { inA, outA, taker, trace } = ctx;
  const amm = s.amms[c.AMMID];
  const level = { corridor: c.id, level: levelNo, quote: q, spot, examined: 0, fills: [] };
  const list = c.commitments.map((id) => s.commitments[id]).filter((k) => k.Asset === outA && k.Amount > 0).sort(priorityCmp);
  let total = 0;
  for (const k of list) {
    if (ctx.got + total >= ctx.want || level.examined >= CAPS.MAX_COMMITMENTS_PER_LEVEL) break;
    level.examined += 1;
    if (k.Account === taker) continue; // a provider never fills its own payment
    const owner = s.accounts[k.Account];
    if (outA !== 'XRP' && owner.lines[outA].frozen) continue;
    if (inA !== 'XRP' && (!owner.lines[inA] || owner.lines[inA].frozen)) continue;
    const out = Math.min(ctx.want - ctx.got - total, k.Amount, k.MaxPerLevel ?? Infinity);
    const pay = Number((B(out) * q.d) / q.n); // rounded DOWN: the taker never gets less than the quoted improvement
    if (pay <= 0) continue;
    // Provider price bound on the executed amounts. Price = units of Asset2 per unit of the base Asset.
    if (outA === c.Asset && k.MinRate && B(pay) * B(k.MinRate[1]) < B(out) * B(k.MinRate[0])) continue;
    if (outA === c.Asset2 && k.MaxRate && B(out) * B(k.MaxRate[1]) > B(pay) * B(k.MaxRate[0])) continue;
    credit(owner, outA, -out);
    setAmount(s, c, k, k.Amount - out);
    credit(owner, inA, pay);
    credit(s.accounts[taker], outA, out); credit(s.accounts[taker], inA, -pay);
    level.fills.push({ commitment: k.id, account: k.Account, key: [k.TenureStart, k.id], out, in: pay, price: ammPrice(amm, c.Asset, c.Asset2) });
    total += out;
  }
  trace.levels.push(level);
  return total;
}

function clobTip(s, inA, outA, taker) {
  let best = null;
  for (const o of Object.values(s.offers).sort((a, b) => idCmp(a.id, b.id))) {
    if (o.gets.asset !== outA || o.pays.asset !== inA || o.owner === taker) continue;
    if (inA !== 'XRP' && !s.accounts[o.owner]?.lines[inA]) continue;
    const q = { n: B(o.quality.gets), d: B(o.quality.pays) };
    if (!best || qGt(q, best.q)) best = { o, q };
  }
  return best;
}

function swapStep(s, tx) {
  const inA = tx.SendAsset, outA = tx.DeliverAsset, taker = tx.Account;
  const amm = s.amms[ammId(inA, outA)];
  const corridors = Object.values(s.corridors)
    .filter((c) => c.AMMID === ammId(inA, outA) && effectiveStage(s, c) === 'ACTIVE')
    .sort((a, b) => b.ImprovementBps - a.ImprovementBps || idCmp(a.id, b.id))
    .slice(0, CAPS.MAX_CORRIDORS_PER_BOOK);
  for (const c of corridors) refreshRef(s, c);
  const trace = { kind: 'swap', corridorsEvaluated: corridors.length, levels: [], amm: 0, clob: 0, corridor: 0 };
  const ctx = { inA, outA, taker, trace, want: tx.DeliverAmount, got: 0 };
  const usedAt = new Map();
  let paid = 0, iters = 0, levels = 0;
  const hasProviders = (c) => c.commitments.some((id) => { const k = s.commitments[id]; return k.Asset === outA && k.Amount > 0 && k.Account !== taker; });
  while (ctx.got < ctx.want && iters < CAPS.MAX_STEP_ITERATIONS) {
    iters += 1;
    const ammOk = ammUsable(amm);
    const spot = ammOk ? spotQuality(amm, inA, outA) : null;
    const key = ammOk ? `${amm.pool[inA]}:${amm.pool[outA]}` : '-';
    let corr = null;
    if (ammOk && levels < CAPS.MAX_CORRIDOR_LEVELS_PER_STEP) {
      for (const c of corridors) {
        if (usedAt.get(c.id) === key || !hasProviders(c) || paused(s, c, amm)) continue;
        const q = corridorQuality(spot, c.ImprovementBps);
        if (!corr || qGt(q, corr.q)) corr = { c, q };
      }
    }
    const tip = clobTip(s, inA, outA, taker);
    if (tip && (!corr || !qGt(corr.q, tip.q)) && (!ammOk || !qGt(spot, tip.q))) {
      // CLOB tip wins ties against synthetic liquidity (as AMM offers do in BookStep today).
      const o = tip.o, owner = s.accounts[o.owner];
      const take = Math.min(ctx.want - ctx.got, o.gets.value, Math.max(0, available(s, owner, outA)));
      if (take <= 0) { owner.ownerCount -= 1; delete s.offers[o.id]; continue; } // unfunded offer removed, as today
      const pay = Number(ceilDiv(B(take) * B(o.quality.pays), B(o.quality.gets)));
      credit(owner, outA, -take); credit(owner, inA, pay); credit(s.accounts[taker], outA, take); credit(s.accounts[taker], inA, -pay);
      o.gets.value -= take; o.pays.value = Number(ceilDiv(B(o.gets.value) * B(o.quality.pays), B(o.quality.gets)));
      if (o.gets.value === 0) { owner.ownerCount -= 1; delete s.offers[o.id]; }
      ctx.got += take; paid += pay; trace.clob += take;
      continue;
    }
    if (corr) {
      levels += 1; usedAt.set(corr.c.id, key);
      const filled = fillCorridorLevel(s, corr.c, ctx, corr.q, spot, levels);
      ctx.got += filled; trace.corridor += filled;
      paid += trace.levels[trace.levels.length - 1].fills.reduce((n, f) => n + f.in, 0);
      continue; // a level that filled nothing is still spent: the corridor re-quotes only after the AMM moves
    }
    if (!ammOk) break;
    // AMM slice: stop where the next corridor level opens (spot worsened by the best ImprovementBps), or where the
    // CLOB tip becomes better, whichever comes first. With no corridor or CLOB in play, take the rest.
    const pout = amm.pool[outA];
    let ratio = null;
    if (levels < CAPS.MAX_CORRIDOR_LEVELS_PER_STEP) {
      const live = corridors.filter((c) => hasProviders(c));
      if (live.length) { const bmax = Math.max(...live.map((c) => c.ImprovementBps)); ratio = { n: B(BPS), d: B(BPS + bmax) }; }
    }
    if (tip) { const r2 = { n: tip.q.n * spot.d, d: tip.q.d * spot.n }; if (!ratio || qGt(r2, ratio)) ratio = r2; }
    let y = ctx.want - ctx.got;
    if (ratio) y = Math.min(y, Math.max(1, ammSliceTo(amm, outA, ratio)));
    y = Math.min(y, pout - 1);
    if (y <= 0) break;
    const pay = ammInFor(amm, inA, outA, y);
    amm.pool[inA] += pay; amm.pool[outA] -= y;
    credit(s.accounts[taker], outA, y); credit(s.accounts[taker], inA, -pay);
    ctx.got += y; paid += pay; trace.amm += y;
  }
  trace.delivered = ctx.got; trace.paid = paid; trace.iterations = iters;
  return { got: ctx.got, paid, trace };
}

// ---------------------------------------------------------------------------------------------------------------
// doApply handlers: return a tes/tec code (or ter: not applied), mutate `s` only on tesSUCCESS.
// ---------------------------------------------------------------------------------------------------------------
const H = {
  CorridorCreate(s, tx, me) {
    const amm = s.amms[ammId(tx.Asset, tx.Asset2)];
    if (!amm) return 'terNO_AMM'; // v1: a corridor exists only for a pair that has an XLS-30 AMM
    if (!ammUsable(amm)) return amm.frozen ? 'tecFROZEN' : 'tecAMM_EMPTY';
    if (tx.MaturityTime != null && s.closeTime >= tx.MaturityTime) return 'tecEXPIRED';
    if (tx.DomainID != null && !s.domains[tx.DomainID]) return 'tecOBJECT_NOT_FOUND';
    if (available(s, me, 'XRP', 1) < 0) return 'tecINSUFFICIENT_RESERVE';
    const id = corridorId(tx.Account, tx._seqUsed);
    const side = () => ({ committed: 0, count: 0, S: 0n, I0: 0n, I1: 0n, pool: 0, feesIn: 0, paidOut: 0 });
    s.corridors[id] = {
      id, Owner: tx.Account, Asset: tx.Asset, Asset2: tx.Asset2, AMMID: amm.id, ImprovementBps: tx.ImprovementBps, PauseBps: tx.PauseBps ?? null,
      MinCommit: { ...(tx.MinCommit || {}) }, Threshold: { ...(tx.Threshold || {}) }, MinParticipants: tx.MinParticipants ?? 1, MaxParticipants: tx.MaxParticipants,
      MaturityTime: tx.MaturityTime ?? null, DomainID: tx.DomainID ?? null,
      stage: 'FORMING', ActivatedAt: null, commitments: [], sides: { [tx.Asset]: side(), [tx.Asset2]: side() },
      RefPrice: ammPrice(amm, tx.Asset, tx.Asset2), RefLedger: s.ledgerSeq, NextPrice: null, NextLedger: null,
    };
    me.ownerCount += 1;
    return 'tesSUCCESS';
  },

  CorridorCommit(s, tx, me) {
    const c = s.corridors[tx.CorridorID];
    if (!c) return 'tecNO_ENTRY';
    const stage = effectiveStage(s, c);
    if (stage !== 'FORMING' && stage !== 'ACTIVE') return 'tecCORRIDOR_STAGE';
    if (tx.Asset !== c.Asset && tx.Asset !== c.Asset2) return 'tecCORRIDOR_ASSET';
    if ((tx.MinRate && tx.Asset !== c.Asset) || (tx.MaxRate && tx.Asset !== c.Asset2)) return 'tecCORRIDOR_BOUND'; // MinRate: base side; MaxRate: Asset2 side
    if (c.DomainID && !s.domains[c.DomainID]?.members.includes(tx.Account)) return 'tecNO_AUTH';
    if (tx.Asset !== 'XRP') {
      const line = me.lines[tx.Asset];
      if (!line) return 'tecNO_LINE';
      if (line.frozen) return 'tecFROZEN';
    }
    const kid = commitmentId(c.id, tx.Account, tx.Asset);
    const existing = s.commitments[kid];
    if (!existing) {
      if (c.commitments.length >= c.MaxParticipants) return 'tecCORRIDOR_LIMIT';
      if (tx.Amount < (c.MinCommit[tx.Asset] ?? 1)) return 'tecCORRIDOR_BOUND';
    } else if ((tx.LockDuration ?? existing.LockDuration) !== existing.LockDuration || (tx.ExitFeeBps ?? existing.ExitFeeBps) !== existing.ExitFeeBps) {
      return 'tecCORRIDOR_TERMS'; // term and exit fee are fixed at the first commit
    }
    const extra = existing ? 0 : 1;
    if (tx.Asset === 'XRP') {
      if (available(s, me, 'XRP', extra) < tx.Amount) return available(s, me, 'XRP', extra) < 0 ? 'tecINSUFFICIENT_RESERVE' : 'tecUNFUNDED';
    } else {
      if (available(s, me, 'XRP', extra) < 0) return 'tecINSUFFICIENT_RESERVE';
      if (available(s, me, tx.Asset) < tx.Amount) return 'tecUNFUNDED';
    }
    const t = tau(s, c), active = stage === 'ACTIVE';
    let k = existing;
    if (!k) {
      const side = c.sides[tx.Asset];
      k = s.commitments[kid] = {
        id: kid, CorridorID: c.id, Account: tx.Account, Asset: tx.Asset, Amount: 0, CommittedAt: s.closeTime,
        LockDuration: tx.LockDuration ?? null, ExitFeeBps: tx.ExitFeeBps ?? 0, TermEnd: null, TenureStart: active ? t : 0,
        MinRate: null, MaxRate: null, MaxPerLevel: null, I0: side.I0, I1: side.I1, Pending: 0,
      };
      c.commitments.push(kid); c.commitments.sort(); side.count += 1;
      me.ownerCount += 1;
    }
    if (tx.MinRate) k.MinRate = [...tx.MinRate];
    if (tx.MaxRate) k.MaxRate = [...tx.MaxRate];
    if (tx.MaxPerLevel != null) k.MaxPerLevel = tx.MaxPerLevel;
    // Term clock: starts at activation (lazy, TermEnd stays null) or now if already ACTIVE; a top-up restarts it.
    if (active && k.LockDuration != null) k.TermEnd = s.closeTime + k.LockDuration;
    // Tenure start: amount-weighted average, rounded UP (later), so new money never inherits old tenure.
    const start = active ? Number(ceilDiv(B(k.Amount) * B(k.TenureStart) + B(tx.Amount) * B(t), B(k.Amount + tx.Amount))) : k.TenureStart;
    setAmount(s, c, k, k.Amount + tx.Amount, start);
    return 'tesSUCCESS';
  },

  // The only way to release held funds. Never refused for being "locked": exit is priced, not prohibited.
  CorridorWithdraw(s, tx, me) {
    const c = s.corridors[tx.CorridorID];
    if (!c) return 'tecNO_ENTRY';
    const k = s.commitments[commitmentId(c.id, tx.Account, tx.Asset)];
    if (!k) return 'tecNO_ENTRY';
    const amount = tx.Amount ?? k.Amount;
    if (amount > k.Amount) return 'tecINSUFFICIENT_FUNDS';
    let fee = exitFee(s, c, k, amount);
    setAmount(s, c, k, k.Amount - amount); // settles k first; releases the hold
    if (fee > 0 && remainingTenure(s, c, k.Asset, k) <= 0n) fee = 0; // nobody stays with tenure: nothing to compensate
    const frozen = k.Asset !== 'XRP' && me.lines[k.Asset].frozen;
    if (frozen && (fee > 0 || k.Pending > 0)) return 'tecFROZEN'; // issuer freeze blocks any movement of the asset
    if (fee > 0) { credit(me, k.Asset, -fee); distribute(s, c, k.Asset, fee, k); }
    const claimed = payOut(s, c, k, k.Pending); k.Pending = 0;
    let swept = 0;
    if (k.Amount === 0) {
      deleteCommitment(s, c, k);
      const side = c.sides[k.Asset];
      if (side.count === 0 && side.pool > 0) { swept = side.pool; side.pool = 0; side.paidOut += swept; credit(me, k.Asset, swept); } // rounding dust to the last provider
    }
    s._trace = { kind: 'withdraw', corridor: c.id, commitment: k.id, asset: k.Asset, withdrawn: amount, fee, exitFeeBps: k.ExitFeeBps, claimed, swept, deleted: k.Amount === 0 };
    return 'tesSUCCESS';
  },

  CorridorClaim(s, tx, me) {
    const c = s.corridors[tx.CorridorID];
    if (!c) return 'tecNO_ENTRY';
    const k = s.commitments[commitmentId(c.id, tx.Account, tx.Asset)];
    if (!k) return 'tecNO_ENTRY';
    settle(c, k);
    if (k.Pending === 0) return 'tecCORRIDOR_NO_OP';
    if (k.Asset !== 'XRP' && me.lines[k.Asset].frozen) return 'tecFROZEN';
    const claimed = payOut(s, c, k, k.Pending); k.Pending = 0;
    s._trace = { kind: 'claim', corridor: c.id, commitment: k.id, claimed };
    return 'tesSUCCESS';
  },

  CorridorAdvance(s, tx) {
    const c = s.corridors[tx.CorridorID];
    if (!c) return 'tecNO_ENTRY';
    if ((tx.Flags || 0) & tfClose) {
      if (tx.Account !== c.Owner) return 'tecNO_PERMISSION';
      if (c.stage === 'CLOSED') return 'tecCORRIDOR_NO_OP';
      c.stage = 'CLOSED'; return 'tesSUCCESS'; // closing only ever releases providers (fees become zero)
    }
    let changed = false;
    if (c.stage === 'FORMING' && gateMet(s, c) && ammUsable(s.amms[c.AMMID])) { c.stage = 'ACTIVE'; c.ActivatedAt = s.closeTime; changed = true; }
    else if (c.stage === 'ACTIVE' && effectiveStage(s, c) === 'MATURED') { c.stage = 'MATURED'; changed = true; }
    if (c.stage === 'ACTIVE' && refreshRef(s, c)) changed = true;
    return changed ? 'tesSUCCESS' : 'tecCORRIDOR_NO_OP';
  },

  CorridorDelete(s, tx, me) {
    const c = s.corridors[tx.CorridorID];
    if (!c) return 'tecNO_ENTRY';
    if (tx.Account !== c.Owner) return 'tecNO_PERMISSION';
    if (c.commitments.length > 0 || Object.values(c.sides).some((x) => x.pool > 0)) return 'tecHAS_OBLIGATIONS';
    if (effectiveStage(s, c) === 'ACTIVE') return 'tecCORRIDOR_STAGE';
    delete s.corridors[c.id]; me.ownerCount -= 1;
    return 'tesSUCCESS';
  },

  // ---- Existing behavior (subset), included only where it interacts with XDLC state ----
  Payment(s, tx, me) {
    const dst = s.accounts[tx.Destination];
    if (!dst) return 'tecNO_DST';
    if (tx.Asset !== 'XRP') {
      if (!me.lines[tx.Asset] || !dst.lines[tx.Asset]) return 'tecNO_LINE';
      if (me.lines[tx.Asset].frozen || dst.lines[tx.Asset].frozen) return 'tecFROZEN';
    }
    if (available(s, me, tx.Asset) < tx.Amount) return 'tecUNFUNDED_PAYMENT'; // XDLC: held balances are not spendable
    credit(me, tx.Asset, -tx.Amount); credit(dst, tx.Asset, tx.Amount);
    return 'tesSUCCESS';
  },

  TicketCreate(s, tx, me) {
    if (available(s, me, 'XRP', tx.TicketCount) < 0) return 'tecINSUFFICIENT_RESERVE';
    for (let i = 0; i < tx.TicketCount; i++) me.tickets.push(me.seq + i);
    me.seq += tx.TicketCount; me.ownerCount += tx.TicketCount;
    return 'tesSUCCESS';
  },

  // Issuer clawback (XLS-39) takes precedence over holds: commitments on the clawed asset are reduced in ascending
  // CommitmentID order until held <= balance (each reduction settles the accumulator first).
  Clawback(s, tx) {
    const h = s.accounts[tx.Holder];
    if (!h || !h.lines[tx.Asset]) return 'tecNO_LINE';
    const amt = Math.min(tx.Amount, h.lines[tx.Asset].balance);
    h.lines[tx.Asset].balance -= amt;
    let excess = heldOf(h, tx.Asset) - h.lines[tx.Asset].balance;
    const mine = Object.values(s.commitments).filter((k) => k.Account === tx.Holder && k.Asset === tx.Asset && k.Amount > 0).sort((a, b) => idCmp(a.id, b.id));
    for (const k of mine) {
      if (excess <= 0) break;
      const cut = Math.min(excess, k.Amount);
      setAmount(s, s.corridors[k.CorridorID], k, k.Amount - cut);
      excess -= cut;
    }
    s.clawedByAsset = { ...(s.clawedByAsset || {}), [tx.Asset]: ((s.clawedByAsset || {})[tx.Asset] || 0) + amt };
    return 'tesSUCCESS';
  },

  AccountDelete(s, tx, me) {
    if (!s.accounts[tx.Destination]) return 'tecNO_DST';
    const blockers = Object.values(s.corridors).some((c) => c.Owner === tx.Account) || Object.values(s.commitments).some((k) => k.Account === tx.Account);
    if (blockers || me.ownerCount > 0) return 'tecHAS_OBLIGATIONS';
    s.accounts[tx.Destination].xrp += me.xrp;
    delete s.accounts[tx.Account];
    return 'tesSUCCESS';
  },

  TrustSet(s, tx) {
    const amm = s.amms[tx.Holder];
    if (amm) { if (!amm.assets.includes(tx.Asset)) return 'tecNO_LINE'; amm.frozen = tx.Freeze; return 'tesSUCCESS'; }
    const h = s.accounts[tx.Holder];
    if (!h || !h.lines[tx.Asset]) return 'tecNO_LINE';
    h.lines[tx.Asset].frozen = tx.Freeze;
    return 'tesSUCCESS';
  },

  AMMWithdraw(s, tx, me) {
    const amm = s.amms[ammId(tx.Asset, tx.Asset2)];
    if (!amm) return 'terNO_AMM';
    if (amm.lp !== tx.Account || amm.lpTokens === 0) return 'tecAMM_EMPTY';
    for (const a of amm.assets) if (a !== 'XRP' && !me.lines[a]) return 'tecNO_LINE';
    for (const a of amm.assets) { credit(me, a, amm.pool[a]); amm.pool[a] = 0; }
    amm.lpTokens = 0;
    return 'tesSUCCESS';
  },

  // Stand-in for the payment engine on one book (exact-out, partial allowed). Fails as a whole if the taker
  // cannot fund what the step consumed.
  ModelSwap(s, tx, me) {
    for (const a of [tx.SendAsset, tx.DeliverAsset]) {
      if (a === 'XRP') continue;
      if (!me.lines[a]) return 'tecNO_LINE';
      if (me.lines[a].frozen) return 'tecFROZEN';
    }
    const { got, trace } = swapStep(s, tx);
    if (got === 0) return 'tecPATH_DRY';
    if (balanceOf(me, tx.SendAsset) - heldOf(me, tx.SendAsset) - (tx.SendAsset === 'XRP' ? reserve(s, me.ownerCount) : 0) < 0) return 'tecUNFUNDED_PAYMENT';
    s._trace = trace;
    return 'tesSUCCESS';
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Invariants (checked after every applied transaction; mirrors xrpld InvariantCheck semantics)
// ---------------------------------------------------------------------------------------------------------------
export function totalXrp(s) {
  return Object.values(s.accounts).reduce((n, a) => n + a.xrp, 0)
    + Object.values(s.amms).reduce((n, m) => n + (m.pool.XRP || 0), 0)
    + Object.values(s.corridors).reduce((n, c) => n + (c.sides.XRP?.pool || 0), 0);
}
export function totalAsset(s, asset) {
  return Object.values(s.accounts).reduce((n, a) => n + (a.lines[asset]?.balance || 0), 0)
    + Object.values(s.amms).reduce((n, m) => n + (m.pool[asset] || 0), 0)
    + Object.values(s.corridors).reduce((n, c) => n + (c.sides[asset]?.pool || 0), 0);
}
const allAssets = (s) => [...new Set([...Object.values(s.accounts).flatMap((a) => Object.keys(a.lines)), ...Object.values(s.amms).flatMap((m) => m.assets)])].filter((a) => a !== 'XRP').sort();
const ALLOWED = { FORMING: ['FORMING', 'ACTIVE', 'CLOSED'], ACTIVE: ['ACTIVE', 'MATURED', 'CLOSED'], MATURED: ['MATURED', 'CLOSED'], CLOSED: ['CLOSED'] };

export function checkInvariants(before, after, tx, result, trace = null) {
  const v = [];
  const fee = result === 'tesSUCCESS' || result.startsWith('tec') ? tx.Fee : 0;
  // INV-1 XRP is never created; only the transaction fee is destroyed (AMM pools and fee pools included).
  if (totalXrp(after) + after.burned !== totalXrp(before) + before.burned) v.push('INV-1 XRP conservation');
  if (after.burned - before.burned !== fee) v.push('INV-1 burned != fee');
  // INV-2 issued-token supply (holders + AMM pools + fee pools) changes only by issuer clawback.
  for (const a of allAssets(before)) {
    const claw = ((after.clawedByAsset || {})[a] || 0) - ((before.clawedByAsset || {})[a] || 0);
    if (totalAsset(after, a) + claw !== totalAsset(before, a)) v.push(`INV-2 token conservation ${a}`);
  }
  for (const [id, acct] of Object.entries(after.accounts)) {
    // INV-3 0 <= held <= balance; INV-4 the account hold equals the sum of its commitments.
    const sum = {};
    for (const k of Object.values(after.commitments)) if (k.Account === id && k.Amount) sum[k.Asset] = (sum[k.Asset] || 0) + k.Amount;
    for (const a of new Set([...Object.keys(sum), ...Object.keys(acct.held)])) {
      if ((sum[a] || 0) !== heldOf(acct, a)) v.push(`INV-4 held cache ${id} ${a}`);
      if (heldOf(acct, a) > balanceOf(acct, a)) v.push(`INV-3 held>balance ${id} ${a}`);
      if (heldOf(acct, a) < 0) v.push(`INV-3 negative hold ${id} ${a}`);
    }
    if (acct.xrp < 0 || Object.values(acct.lines).some((l) => l.balance < 0)) v.push(`INV-3 negative balance ${id}`);
    // INV-16 owner count equals owned objects.
    const owned = Object.keys(acct.lines).length + acct.tickets.length
      + Object.values(after.corridors).filter((c) => c.Owner === id).length
      + Object.values(after.commitments).filter((k) => k.Account === id).length
      + Object.values(after.offers).filter((o) => o.owner === id).length;
    if (owned !== acct.ownerCount) v.push(`INV-16 ownerCount ${id}`);
  }
  for (const c of Object.values(after.corridors)) {
    // INV-5 per-side accounting: committed = sum(Amount), S = sum(Amount * TenureStart), count = commitments.
    for (const [asset, side] of Object.entries(c.sides)) {
      const ks = c.commitments.map((id) => after.commitments[id]).filter((k) => k && k.Asset === asset);
      if (ks.reduce((n, k) => n + k.Amount, 0) !== side.committed) v.push(`INV-5 committed ${c.id} ${asset}`);
      if (ks.reduce((n, k) => n + B(k.Amount) * B(k.TenureStart), 0n) !== side.S) v.push(`INV-5 tenure sum ${c.id} ${asset}`);
      if (ks.length !== side.count) v.push(`INV-5 count ${c.id} ${asset}`);
      // INV-9 fee-pool solvency: pool = fees in - paid out >= every unpaid entitlement; empty side => empty pool.
      if (side.pool !== side.feesIn - side.paidOut || side.pool < 0) v.push(`INV-9 pool accounting ${c.id} ${asset}`);
      if (ks.reduce((n, k) => n + entitlement(c, k), 0) > side.pool) v.push(`INV-9 pool insolvent ${c.id} ${asset}`);
      if (ks.length === 0 && side.pool !== 0) v.push(`INV-9 orphaned pool ${c.id} ${asset}`);
    }
    if (c.commitments.some((id) => !after.commitments[id] || after.commitments[id].CorridorID !== c.id)) v.push(`INV-5 dangling commitment ${c.id}`);
    // INV-13 resource limits on stored state.
    if (c.commitments.length > c.MaxParticipants || c.MaxParticipants > CAPS.MAX_PARTICIPANTS) v.push(`INV-13 participants cap ${c.id}`);
    if (c.ImprovementBps < CAPS.MIN_IMPROVEMENT_BPS || c.ImprovementBps > CAPS.MAX_IMPROVEMENT_BPS) v.push(`INV-13 improvement bounds ${c.id}`);
    // INV-14 lifecycle is monotonic.
    const p = before.corridors[c.id];
    if (p && !ALLOWED[p.stage].includes(c.stage)) v.push(`INV-14 stage ${p.stage}->${c.stage}`);
    if (p && p.ActivatedAt != null && p.ActivatedAt !== c.ActivatedAt) v.push(`INV-14 activation time changed ${c.id}`);
  }
  for (const k of Object.values(after.commitments)) {
    if (!after.corridors[k.CorridorID]?.commitments.includes(k.id)) v.push(`INV-5 orphan commitment ${k.id}`);
    if (k.ExitFeeBps > CAPS.MAX_EXIT_FEE_BPS) v.push(`INV-8 exit fee above cap ${k.id}`);
    const prev = before.commitments[k.id];
    if (!prev) continue;
    // INV-19 owner, asset and terms are immutable.
    if (prev.Account !== k.Account || prev.Asset !== k.Asset || prev.LockDuration !== k.LockDuration || prev.ExitFeeBps !== k.ExitFeeBps) v.push(`INV-19 immutable field changed ${k.id}`);
    // INV-11 tenure start never moves earlier; an untouched commitment's tenure never decreases.
    if (k.TenureStart < prev.TenureStart) v.push(`INV-11 tenure start decreased ${k.id}`);
    const cA = after.corridors[k.CorridorID], cB = before.corridors[k.CorridorID];
    if (cB && k.Amount === prev.Amount && k.TenureStart === prev.TenureStart && tenureOf(after, cA, k) < tenureOf(before, cB, prev)) v.push(`INV-11 tenure decreased ${k.id}`);
    // Entitlements never shrink except by being paid out.
    if (cB && k.id !== trace?.commitment && entitlement(cA, k) < entitlement(cB, prev)) v.push(`INV-10 entitlement decreased ${k.id}`);
  }
  // INV-17 the AMM constant product never decreases in a swap (existing AMM invariant, unaffected by corridors).
  if (tx.TransactionType === 'ModelSwap') for (const m of Object.values(after.amms)) {
    const pm = before.amms[m.id];
    if (pm && B(m.pool[m.assets[0]]) * B(m.pool[m.assets[1]]) < B(pm.pool[pm.assets[0]]) * B(pm.pool[pm.assets[1]])) v.push(`INV-17 AMM product decreased ${m.id}`);
  }
  // INV-18 XDLC transactions move value only as exit fee (provider -> pool) and claims/sweep (pool -> provider).
  if (XDLC_TX_TYPES.includes(tx.TransactionType)) {
    for (const [id, a] of Object.entries(after.accounts)) {
      const b = before.accounts[id]; if (!b) continue;
      if (id !== tx.Account) {
        if (a.xrp !== b.xrp || Object.keys(b.lines).some((x) => a.lines[x]?.balance !== b.lines[x].balance)) v.push(`INV-18 value moved for non-signer ${id}`);
        continue;
      }
      const allowed = ['CorridorWithdraw', 'CorridorClaim'].includes(tx.TransactionType) && result === 'tesSUCCESS';
      const t = trace || {};
      const net = allowed ? (t.claimed || 0) + (t.swept || 0) - (t.fee || 0) : 0;
      const dx = a.xrp - b.xrp + fee;
      const assetOf = t.asset ?? (t.commitment ? before.commitments[t.commitment]?.Asset : null);
      if (dx !== (assetOf === 'XRP' ? net : 0)) v.push(`INV-18 XRP moved by XDLC tx ${id}`);
      for (const x of Object.keys(b.lines)) if (a.lines[x].balance - b.lines[x].balance !== (assetOf === x ? net : 0)) v.push(`INV-18 token moved by XDLC tx ${id}`);
    }
  }
  if (trace?.kind === 'withdraw') {
    const cB = before.corridors[trace.corridor], kB = before.commitments[trace.commitment], cA = after.corridors[trace.corridor];
    // INV-8 the exit fee never exceeds the formula, the commitment's ExitFeeBps, or the protocol cap.
    const formula = exitFee(before, cB, kB, trace.withdrawn);
    if (trace.fee > formula || trace.fee * BPS > trace.withdrawn * Math.min(kB.ExitFeeBps, CAPS.MAX_EXIT_FEE_BPS)) v.push('INV-8 exit fee above bound');
    if (trace.fee > 0 && effectiveStage(before, cB) !== 'ACTIVE') v.push('INV-8 exit fee outside ACTIVE term');
    // INV-10 the fee goes only to providers who stay: the payer accrues nothing from it, other sides nothing at all,
    // and the stayers' combined accrual from it never exceeds it.
    const kA = after.commitments[trace.commitment];
    if (kA && accrued(cA, kA) !== 0) v.push('INV-10 payer shares its own fee');
    // (Per event, floor() may release up to 1 unit per stayer of fractional remainders withheld earlier; cumulative
    // solvency, INV-9, is exact.)
    let gained = 0, stayers = 0;
    for (const k of Object.values(after.commitments)) {
      if (k.CorridorID !== trace.corridor || k.id === trace.commitment) continue;
      const d = entitlement(cA, k) - entitlement(cB, before.commitments[k.id]);
      if (k.Asset !== trace.asset && d !== 0) v.push(`INV-10 other side accrued ${k.id}`);
      if (k.Asset === trace.asset) { gained += d; stayers += 1; }
    }
    if (gained > trace.fee + stayers) v.push('INV-10 stayers accrued more than the fee');
  }
  if (trace?.kind === 'swap') {
    const levelsTotal = trace.levels.length;
    if (levelsTotal > CAPS.MAX_CORRIDOR_LEVELS_PER_STEP || trace.corridorsEvaluated > CAPS.MAX_CORRIDORS_PER_BOOK) v.push('INV-13 step resource bound');
    for (const L of trace.levels) {
      const cA = after.corridors[L.corridor], cB = before.corridors[L.corridor];
      if (L.examined > CAPS.MAX_COMMITMENTS_PER_LEVEL) v.push('INV-13 commitments per level');
      // INV-15 quotes only from an ACTIVE corridor whose AMM is usable.
      if (!cB || effectiveStage(before, cB) !== 'ACTIVE' || !ammUsable(before.amms[cB.AMMID])) v.push(`INV-15 quote from inactive corridor ${L.corridor}`);
      let prevKey = null;
      for (const f of L.fills) {
        // INV-6 every corridor fill beats the AMM spot (incl. fee) at that depth by >= ImprovementBps.
        if (B(f.out) * L.spot.d * B(BPS) < B(f.in) * L.spot.n * B(BPS + cA.ImprovementBps)) v.push(`INV-6 fill not better than AMM by ImprovementBps ${f.commitment}`);
        // INV-7 never worse than the provider's own bound.
        const k = before.commitments[f.commitment];
        if (k.Asset === cA.Asset && k.MinRate && B(f.in) * B(k.MinRate[1]) < B(f.out) * B(k.MinRate[0])) v.push(`INV-7 MinRate violated ${f.commitment}`);
        if (k.Asset === cA.Asset2 && k.MaxRate && B(f.out) * B(k.MaxRate[1]) > B(f.in) * B(k.MaxRate[0])) v.push(`INV-7 MaxRate violated ${f.commitment}`);
        if (k.MaxPerLevel != null && f.out > k.MaxPerLevel) v.push(`INV-7 MaxPerLevel exceeded ${f.commitment}`);
        // INV-15 never while paused (checked against the reference in force for this step).
        if (cA.PauseBps != null && cA.RefPrice) {
          const r = cA.RefPrice, p = f.price;
          const dev = p.n * r.d > r.n * p.d ? p.n * r.d - r.n * p.d : r.n * p.d - p.n * r.d;
          if (dev * B(BPS) > B(cA.PauseBps) * r.n * p.d) v.push(`INV-15 fill while paused ${f.commitment}`);
        }
        // INV-12 within a level, fills follow tenure priority (TenureStart, then CommitmentID).
        if (prevKey && (f.key[0] < prevKey[0] || (f.key[0] === prevKey[0] && f.key[1] <= prevKey[1]))) v.push(`INV-12 priority order ${f.commitment}`);
        prevKey = f.key;
      }
    }
  }
  return v;
}

// ---------------------------------------------------------------------------------------------------------------
// apply(state, tx) -> { result, state, applied, violations, trace }
// ---------------------------------------------------------------------------------------------------------------
export function apply(state, tx) {
  const pf = preflight(state, tx);
  if (pf) return { result: pf, state, applied: false };
  const acct0 = state.accounts[tx.Account];
  if (!acct0) return { result: 'terNO_ACCOUNT', state, applied: false };
  let seqUsed;
  if (tx.TicketSequence != null) {
    if (!acct0.tickets.includes(tx.TicketSequence)) return { result: tx.TicketSequence >= acct0.seq ? 'terPRE_SEQ' : 'tefNO_TICKET', state, applied: false };
    seqUsed = tx.TicketSequence;
  } else {
    if (tx.Sequence < acct0.seq) return { result: 'tefPAST_SEQ', state, applied: false };
    if (tx.Sequence > acct0.seq) return { result: 'terPRE_SEQ', state, applied: false };
    seqUsed = tx.Sequence;
  }
  if (tx.Fee < state.fees.base) return { result: 'telINSUF_FEE_P', state, applied: false };
  if (acct0.xrp - tx.Fee < heldOf(acct0, 'XRP')) return { result: 'terINSUF_FEE_B', state, applied: false }; // held XRP never pays fees

  const charged = clone(state);
  const me = charged.accounts[tx.Account];
  me.xrp -= tx.Fee; charged.burned += tx.Fee;
  if (tx.TicketSequence != null) { me.tickets = me.tickets.filter((t) => t !== tx.TicketSequence); me.ownerCount -= 1; } else me.seq += 1;

  const work = clone(charged);
  const result = H[tx.TransactionType](work, { ...tx, _seqUsed: seqUsed }, work.accounts[tx.Account]);
  if (result.startsWith('ter')) return { result, state, applied: false };
  const trace = work._trace || null; delete work._trace;
  const next = result === 'tesSUCCESS' ? work : charged;
  const violations = checkInvariants(state, next, tx, result, result === 'tesSUCCESS' ? trace : null);
  if (violations.length) {
    const v2 = checkInvariants(state, charged, tx, 'tecINVARIANT_FAILED');
    return { result: 'tecINVARIANT_FAILED', state: v2.length ? state : charged, applied: true, violations };
  }
  return { result, state: next, applied: true, violations: [], trace: result === 'tesSUCCESS' ? trace : null };
}

// Convenience: apply a sequence, auto-filling Sequence/Fee when omitted. `{ close: t }` steps close a ledger.
export function applyAll(state, txs) {
  let s = state; const results = [], traces = [];
  for (const raw of txs) {
    if (raw.close != null) { s = closeLedger(s, raw.close); continue; }
    const tx = { Fee: s.fees.base, ...raw };
    if (tx.Sequence == null && tx.TicketSequence == null && s.accounts[tx.Account]) tx.Sequence = s.accounts[tx.Account].seq;
    const r = apply(s, tx); results.push(r.result); traces.push(r.trace || null); s = r.state;
  }
  return { state: s, results, traces };
}
