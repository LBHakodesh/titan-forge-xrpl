<pre>
  xls: XLS-XXXX (unassigned)
  title: Dynamic Liquidity Corridors
  description: Self-custodial provider liquidity, pegged to an existing XRPL AMM, that the payment engine quotes at a deterministic improvement over the AMM at every depth level, with tenure priority and priced early exit.
  author: GYW1313 (Titan Forge team)
  category: Amendment
  status: Draft-Local (not submitted)
  proposal-from: none (no XRPL-Standards Discussion has been opened)
  requires: none (builds on XLS-30 AMM; interacts with XLS-39, XLS-56, XLS-73, XLS-75, XLS-80, XLS-81, XLS-85)
  created: 2026-10-25
  updated: 2026-10-25 (v0.2: AMM-pegged corridor design)
</pre>

# XDLC: XRPL Dynamic Liquidity Corridors (proposed amendment)

## 0. Status and honesty

Read this first.

- **This is a local draft.** It has **not** been submitted to XRPL-Standards, opened as a Discussion, reviewed by XLS
  Editors, implemented in xrpld, merged, voted on, or activated on any network.
- **No XLS number is assigned.** `XLS-XXXX (unassigned)` is a placeholder. Under XLS-0001, Editors assign numbers when
  a Draft PR is merged. In XLS-process terms this document is pre-Idea. `Draft-Local` is used because `Draft` is
  reserved for editor-merged documents.
- **XDLC is a neutral protocol.** It is infrastructure that any organization can use to provide liquidity. GYW1313's
  proprietary software (Titan Ghost, TG Intelligence) is **one participant** that would use it, entirely off-ledger.
  Nothing proprietary is in consensus.
- **Titan Forge is not the amendment.** Titan Forge runs a corridor lifecycle as **application logic** on XRPL Testnet
  with ordinary `OfferCreate` and existing auto-bridging. That shows the workflow is useful. It proves nothing about the
  soundness of a protocol change. XDLC is not XRPL-native today (`CONTRACT.md` rule 6).
- **The reference model is not xrpld.** `lib/xdlc-spec/model.mjs` is an executable specification in JavaScript. It runs
  the candidate rules and 22 invariants against 80 deterministic vectors and 10,000 seeded random transactions. It is
  not consensus code, has not been ported to C++, and models one book step, not the full payment engine.
- **Identifiers are design candidates.** Every name here (`LiquidityCorridor`, `CorridorCommit`, `ImprovementBps`,
  `tecCORRIDOR_TERMS`, field names, caps) is a candidate for discussion. None is reserved.
- **The design changed on 2026-10-25 (v0.2).** The earlier draft (operator-placed bounded offers, group funding with
  automatic release, absolute `LockUntil`) is withdrawn. Section 4.5 says what was removed and why.
- **Publishing needs approval.** Opening an XRPL-Standards Discussion or PR requires explicit Commander approval.

## 1. Abstract

XDLC lets independent liquidity providers form a **corridor** next to an existing XRPL AMM (XLS-30). Providers commit
funds that **stay in their own accounts**; a ledger **hold** stops those funds being spent by any other path. When a
payment or offer crossing reaches that AMM's order book, the payment engine **synthesizes a corridor quote**: the AMM's
current spot quality, including its trading fee, improved by the corridor's `ImprovementBps` (at least 1 bp). This is
the same mechanism rippled already uses to inject AMM liquidity into `BookStep`; the corridor is a second synthetic
source. As the AMM is consumed and its price moves, the corridor re-quotes at the next depth level, so it undercuts the
AMM **at every depth**. Corridor liquidity at a level is drawn from commitments in **tenure order**, bounded by each
provider's `MinRate`/`MaxRate` and `MaxPerLevel` and by per-step protocol caps. A deterministic **volatility pause**
stops quoting when the AMM price moves too far from a reference snapshotted in an earlier ledger. Term commitments
start their clock when the corridor activates. Exit is always possible: an early exit pays a **prorated fee**, fixed at
commit and capped at 10%, into a **fee pool** shared by the providers who stay, weighted by tenure, through an O(1)
accumulator. No oracle, no AI and no off-ledger input touches consensus.

## 2. Motivation

### 2.1 The problem

An XRPL AMM quotes along a curve: each extra unit costs more. A liquidity provider who wants to sell near the AMM's
current price, a little better than the AMM, at whatever depth the AMM happens to be, has no way to do that on XRPL
today without trusting a bot. A provider (or a project funding liquidity for its token) wants all of:

| # | Property | Meaning |
|---|---|---|
| P1 | Self-custody | Funds stay on the provider's AccountRoot / trust line. No other account can move them. |
| P2 | Always better than the AMM, at every depth | The provider's liquidity is quoted at the AMM's current effective price improved by a fixed margin, re-pricing itself as the AMM moves, with no transactions per ledger. |
| P3 | Binding but exit-able term | Committed funds cannot be spent elsewhere during a term, verifiable by anyone; leaving early is allowed at a known, prorated price that compensates those who stay. |
| P4 | Fair, bounded participation | Older commitments fill first; each provider bounds worst price and size per level; anyone (or only credentialed providers) can join. |

What existing primitives provide (statuses verified 2026-10-25, see section 13):

| Existing approach | P1 | P2 | P3 | P4 | Why it falls short |
|---|---|---|---|---|---|
| Plain offers (OfferCreate) | yes | **no** | **no** | partial | Fixed quality. Re-pricing needs cancel-and-replace every ledger: a fee and sequence per offer, always one ledger stale, races other submitters, stale quotes get picked off. Funds can be spent at any time. |
| AMM deposit (XLS-30) | **no** | n/a (it *is* the curve) | **no** | **no** | Pooled custody in the AMM pseudo-account; LPs withdraw any time; no term, no tenure priority, no per-LP limits; AMM liquidity is not used in permissioned-domain books. |
| Escrow / TokenEscrow (XLS-85) | partial | no | partial | no | Escrowed funds leave the balance and cannot back liquidity. |
| Delegation (XLS-75) + bot | yes | partial | **no** | no | Transaction-level permissions with no price or amount bounds; still per-ledger repricing; participant can revoke at will. |
| Single Asset Vault (XLS-65; not enabled) | **no** | no | no | no | Pseudo-account custody; spec does not deploy vault assets as DEX liquidity. |
| Hooks / smart contracts | n/a | n/a | n/a | n/a | No Hooks, Smart Escrow or WASM amendment in the Mainnet feature list (2026-10-25). XLS-100/101/102 are Draft. |

The missing primitives are (a) a **synthetic liquidity source pegged to the AMM** inside the payment engine and (b) a
**hold**: a claim on a provider's own balance that every funding path respects and that only the corridor can consume
or release.

### 2.2 What does not need an amendment

Routing and XRP auto-bridging, static offers, the AMM itself, access control (Credentials, Permissioned Domains,
Permissioned DEX), atomic setup (Batch), replay protection and observability are adequate today
(`XDLC_PROTOCOL_GAP_ANALYSIS.md`). XDLC reuses them and duplicates none.

### 2.3 Neutrality and what stays off-ledger

The protocol knows nothing about who the providers are or why they provide. Off-ledger and proprietary (for GYW1313:
TG Intelligence and Titan Ghost; for anyone else: their own tools): which corridors to fund, how much capital, risk and
inventory management, when to top up or exit, customer tooling. Titan Forge's market-maturity ladder (spoke,
growing_spoke, corridor, mature) is application logic and maps onto an on-ledger `ACTIVE` corridor at most.

## 3. Specification

### 3.1 Summary

| Kind | Candidate | Purpose |
|---|---|---|
| Ledger entry | `LiquidityCorridor` | AMM reference, ImprovementBps, pause settings, lifecycle, per-side accounting, fee pools and accumulator indices |
| Ledger entry | `CorridorCommitment` | One per (corridor, account, asset): amount held, term, exit fee, provider limits, tenure, accumulator snapshot |
| Pseudo-account | corridor fee-pool account | Holds exit fees until claimed (AMM / Vault pseudo-account precedent). Provider principal never moves there. |
| Modified entries | `AccountRoot`, `RippleState`, `MPToken` | Option A: optional aggregate `HeldAmount`. Option B: computed from the owner directory (section 7) |
| Payment engine | `CorridorLiquidity` (beside `AMMLiquidity`) | Synthesizes corridor quotes in `BookStep` |
| Transactions | `CorridorCreate`, `CorridorCommit`, `CorridorWithdraw`, `CorridorClaim`, `CorridorAdvance`, `CorridorDelete` | Lifecycle |
| Feature | `LiquidityCorridors` (candidate) | Amendment gate, `Supported::No` until complete, `DefaultNo` vote |

### 3.2 Ledger entry: `LiquidityCorridor`

Keylet (candidate): `sha512Half(<new namespace>, Owner, Sequence)`. In the Owner's directory, and in a **per-AMM
corridor directory** rooted at `sha512Half(<namespace>, AMMID)` so `BookStep` can find corridors for a book. Reserve:
one owner reserve (Owner).

| Field | Type | Req. | Description |
|---|---|---|---|
| `Owner` | AccountID | yes | Creator. May close (releases everyone, fees become zero) and delete when empty. Cannot touch commitments. |
| `Asset`, `Asset2` | STIssue | yes | The base asset and the quote asset. Must match an existing AMM (`keylet::amm(Asset, Asset2)`). |
| `AMMID` | Hash256 | yes | The referenced AMM. v1: a corridor cannot exist without one. |
| `ImprovementBps` | UInt16 | yes | 1 to 500. Corridor quote = AMM spot quality x (10000 + ImprovementBps) / 10000. |
| `PauseBps` | UInt16 | no | 1 to 5000. Volatility pause threshold (section 3.5). Absent = no pause (not recommended). |
| `MinCommit` | STArray of STAmount | no | Per-asset minimum first commitment (anti-dust). |
| `MaxParticipants` | UInt32 | yes | Commitments cap, at most 512. |
| `Threshold`, `MinParticipants` | STArray / UInt32 | no | Optional activation gate. Nothing is released if unmet; providers simply withdraw for free. |
| `MaturityTime` | UInt32 | no | Ripple-epoch seconds; absent = open-ended. Evaluated lazily against parent close time. |
| `DomainID` | Hash256 | no | Optional Permissioned Domain (XLS-80): only members may commit. |
| `Stage` | UInt8 | yes | `FORMING`, `ACTIVE`, `MATURED`, `CLOSED`. |
| `ActivatedAt` | UInt32 | no | Set once at activation. Tenure time `tau` = close time - ActivatedAt. |
| per side (Asset, Asset2): `Committed`, `TenureSum`, `Count`, `FeePool`, `FeesIn`, `FeesPaid`, `FeeIndex0`, `FeeIndex1` | STAmount / UInt64 / 128-bit or Number | yes | Side accounting (INV-5, INV-9) and accumulator (section 3.7). |
| `RefPrice`, `RefLedger`, `NextPrice`, `NextLedger` | Number pair / UInt32 | yes | Volatility-pause reference and candidate (section 3.5). |

### 3.3 Ledger entry: `CorridorCommitment`

Keylet (candidate): `sha512Half(<namespace>, CorridorID, Account, Asset)`. In the provider's owner directory and the
corridor directory. Reserve: one owner reserve (provider).

| Field | Type | Req. | Description |
|---|---|---|---|
| `Account`, `Asset` | AccountID / STIssue | yes | Provider and the asset it sells. Immutable (INV-19). A provider may hold one commitment per side. |
| `Amount` | STAmount | yes | Currently held. Falls when takers fill it or the issuer claws back; proceeds are credited to the provider unheld. |
| `LockDuration` | UInt32 | no | Term in seconds (at most 4 years). Absent = flexible (Tier 1-like); present = term (Tier 2-like). Immutable. |
| `ExitFeeBps` | UInt16 | with `LockDuration` | 1 to 1000. Immutable. |
| `TermEnd` | UInt32 | no | Absent while the corridor is FORMING (term end is `ActivatedAt + LockDuration`, computed lazily). Set to `now + LockDuration` when committing or topping up while ACTIVE. |
| `TenureStart` | UInt32 | yes | In `tau` seconds. 0 for pre-activation commitments; `tau` at commit if ACTIVE; amount-weighted average (rounded up) on top-up. |
| `MinRate` / `MaxRate` | {UInt64, UInt64} | no | Worst acceptable price in Asset2 per unit of Asset. `MinRate` on base-side commitments, `MaxRate` on Asset2-side. |
| `MaxPerLevel` | STAmount | no | Maximum this commitment provides at one depth level. |
| `FeeIndex0`, `FeeIndex1`, `PendingFees` | as corridor / STAmount | yes | Accumulator snapshot and settled, unpaid share. |

### 3.4 Corridor liquidity in the payment engine

This is the core of the amendment and its biggest implementation risk.

**Precedent.** In `XRPLF/rippled` develop @ `1f46f75`, `src/libxrpl/tx/paths/` contains `AMMLiquidity.cpp` and
`AMMOffer.cpp`. `BookStep` constructs an `AMMLiquidity` when `keylet::amm(in, out)` exists and is non-empty, and in
`forEachOffer` tries one synthetic AMM offer per iteration (`tryAMM`) before consuming CLOB offers. A synthetic AMM
offer is sized to the CLOB tip quality in single-path mode and by a Fibonacci sequence in multi-path mode; it is skipped
for permissioned-domain books and when the AMM's assets are frozen. **Corridor liquidity is a second synthetic source
built the same way.** Corridor quotes are never written to the ledger as offers: no repricing transactions, no
quality-sorted directory entries, no stale quotes.

**Quote.** For a taker paying `in` and receiving `out` on a book with AMM pools `Pin`, `Pout` and trading fee `f`
(XLS-30 units of 1/100,000):

```
AMM spot quality      qAMM = Pout * (100000 - f) / (Pin * 100000)          (out per in, fee included)
corridor quality      qC   = qAMM * (10000 + ImprovementBps) / 10000
```

Everything is ledger state: AMM balances and fee, corridor fields. No oracle.

**Levels and sizing.** A *level* is one corridor quote at the current AMM state. At a level:

1. Commitments on the `out` side with `Amount > 0` are taken in **(TenureStart, CommitmentID)** order.
2. At most `MAX_COMMITMENTS_PER_LEVEL` = 8 are examined (filled or skipped).
3. A commitment is skipped if it belongs to the taker, its line is frozen, it cannot receive `in`, or the executed
   price would break its `MinRate`/`MaxRate`.
4. It provides `min(remaining demand, Amount, MaxPerLevel)`; the taker pays `floor(out / qC)`.
5. Level size = the sum. A level is used at most once per AMM state. After it, the AMM is consumed in a slice that
   stops where the AMM's spot quality has fallen by a factor `10000 / (10000 + ImprovementBps)` (or reaches the CLOB tip
   quality, whichever comes first). The corridor then re-quotes at the new spot. The slice size is exact integer math,
   `y = Pout - ceilSqrt(Pout^2 * ratio)` for a constant-product pool (rippled's `changeSpotPriceQuality` solves the same
   kind of problem today).
6. Per step: at most 4 corridors per AMM (highest `ImprovementBps` first, then CorridorID) and at most 16 corridor
   levels. After that the corridor yields and the step continues with CLOB and AMM only.

**Ordering against CLOB offers and the AMM.** Best quality wins. A corridor quote is always better than the AMM spot by
at least `ImprovementBps`, so the AMM never fills while a corridor level with eligible liquidity is open. CLOB offers
with quality greater than **or equal to** the corridor quote fill first (ties go to the CLOB, as they do for AMM offers
today: `AMMLiquidity::getOffer` declines when the spot quality is not better than the CLOB tip).

**Rounding.** The taker-side amount is rounded **down** (in the taker's favor), so every fill satisfies
`out / in >= qAMM * (10000 + ImprovementBps) / 10000` exactly (INV-6). The provider absorbs less than one unit of `in`
per fill; its `MinRate`/`MaxRate` is checked on the executed, rounded amounts (INV-7). AMM input is rounded up (existing
XLS-30 behavior). Exit fees round down (section 3.7).

**Multi-path, auto-bridging and offer crossing.** Corridor liquidity is per book. In an auto-bridged path
TOKEN -> XRP -> TOKEN2, each `BookStep` may have its own AMM and corridors. Strand quality estimation
(`qualityUpperBound`) must include the corridor quote. In multi-path Flow, a corridor contributes at most one level per
engine iteration, mirroring "an AMM offer can only be consumed once per payment engine iteration". `OfferCreate`
crossing (FlowCross) consumes corridor liquidity exactly like AMM liquidity; `tfPassive` offers do not cross it.
`LimitQuality` and `SendMax` apply unchanged. The model covers one book step only (section 8).

**When the AMM cannot be used, the corridor stops quoting.** If the AMM is deleted (`AMMDelete`), empty (zero LP
tokens), or either asset is frozen for the AMM (individual or global freeze), no corridor quote is produced (XV-48,
XV-49). Exit fees are waived while the AMM is unusable: a corridor that cannot quote cannot charge for leaving it
(XV-70). `AMMClawback` shrinks the pools; the corridor simply re-reads them, and the volatility pause may trip.

**No AMM (not allowed in v1).** `CorridorCreate` without an AMM returns `terNO_AMM` (XV-09). Pegging to the best CLOB
offer is future work: a CLOB tip can be placed and cancelled cheaply by an attacker in the same ledger, so a CLOB peg
invites quote manipulation (place a bad tip, take the corridor, cancel), and the tip's size does not reveal depth.

**Permissioned domains.** AMM liquidity is not used in domain books (BookStep skips it). Corridor quotes therefore
appear only in the open book. `DomainID` restricts who may **provide**, not who may take.

### 3.5 Volatility pause

The AMM price can be pushed within a ledger (several transactions or one Batch) and pushed back, so a corridor pegged
to it could be filled at a manipulated price (XV-52 shows the effect without a pause). Candidate rule:

- The corridor stores a **reference** price `RefPrice` = AMM `Asset2/Asset` pool ratio (fee-free) and a **candidate**
  `NextPrice` with the ledger sequence it was taken in.
- On the first corridor touch in ledger L (any `BookStep` that evaluates the corridor, or a permissionless
  `CorridorAdvance`): if the candidate is from a ledger earlier than L, promote it to `RefPrice`; then, if there is no
  candidate, record the current AMM price as the candidate for L. At most one candidate per ledger.
- A corridor level is not offered while `|price - RefPrice| / RefPrice > PauseBps / 10000`. This is checked at every
  level, so `PauseBps` also caps how far one large payment can walk the corridor down the curve.

Properties: a same-ledger manipulation is always checked against a reference from an earlier ledger (XV-51); a moved
price is accepted once it has persisted into a later ledger and been seen there (XV-53), so a legitimate move costs at
most about two ledgers of pause. A manipulator who wants a bad reference must hold the AMM off-price across ledger
closes, exposed to arbitrage. Deterministic: inputs are AMM state, corridor fields and ledger sequence.

Trade-offs and alternatives (open question 1): reading the AMM state from the parent ledger directly would be cleaner
but is not how transactors normally read state; a time-weighted reference needs more fields and still has the same
first-touch issue; the chosen design requires `BookStep` to write the corridor SLE even when the corridor does not fill
(the write is discarded with the sandbox if the payment fails).

### 3.6 Holds and interaction with existing transactions

After activation of the amendment, every code path that computes **spendable** funds subtracts holds, or P1 + P3 fail:

- `accountHolds` / `accountFunds` (`TokenHelpers.cpp`), `xrpLiquid` (`AccountRootHelpers.cpp`): available =
  balance - held (XRP: also minus reserve). This covers `Payment`, `CheckCash`, `EscrowCreate`, `PaymentChannelCreate`/
  `Fund`, `AMMDeposit`, `AMMCreate`, `NFTokenAcceptOffer`, `VaultDeposit` (when enabled) and the provider's **own**
  ordinary offers (unfunded beyond the unheld balance).
- Corridor fills spend from the hold: `Amount` and the hold fall by the amount sold; the proceeds are credited to the
  provider unheld.
- Fees: held XRP cannot pay transaction fees (`terINSUF_FEE_B`, XV-29).
- **Issuer controls take precedence.** Freeze and deep freeze skip the commitment when quoting; an exit that must move
  a frozen asset (fee or claim) returns `tecFROZEN` (XV-72). `Clawback` (XLS-39) reduces the balance first, then clamps
  holds in ascending CommitmentID order, settling the accumulator before each change (XV-77). XDLC never shields funds
  from issuer controls.
- `AccountDelete`: blocked while the account owns a corridor or a commitment (`tecHAS_OBLIGATIONS`, XV-76).
- `Batch` (XLS-56): all XDLC transactions may be inner transactions.
- Delegation (XLS-75): candidate rule: `CorridorCommit`, `CorridorWithdraw`, `CorridorClaim` and `CorridorDelete` are
  non-delegable in v1, mirroring Vault/Loan transactions, so the commitment decision stays with the key holder.

### 3.7 Terms, exit fee and the fee pool

**Term clock.** A term starts when the corridor becomes ACTIVE (pre-activation commitments: term end =
`ActivatedAt + LockDuration`, computed lazily, so activation never iterates commitments), or at commit time if the
corridor is already ACTIVE. A top-up while ACTIVE restarts the term (`TermEnd = now + LockDuration`); the provider signs
that. Before activation, withdrawal is free (XV-56). Providers may join at any time while FORMING or ACTIVE.

**Exit fee.** `CorridorWithdraw` is the only way to release held funds and it is never refused for being "locked":

```
fee = floor( withdrawn * ExitFeeBps * remaining / (10000 * LockDuration) ),   remaining = max(0, TermEnd - closeTime)
```

`ExitFeeBps` is fixed at commit (`tecCORRIDOR_TERMS` on change, XV-23) and capped at 1000 bps (10%, `temMALFORMED`
above, XV-05). The fee is zero after the term (XV-59), before activation (XV-56), when the corridor is MATURED (lazy,
XV-61) or CLOSED by the owner (XV-60), for flexible commitments (XV-62), while the AMM is unusable (XV-70), and when no
other provider on that side has positive tenure (nobody stays to compensate, XV-69). The fee is taken atomically from
the withdrawn amount and moved to the corridor fee pool (pseudo-account).

**Tenure.** `tenure_i = Amount_i x (tau - TenureStart_i)`. Pre-activation commitments start at `tau = 0`. A top-up
moves `TenureStart` to the amount-weighted average, rounded up (new money never inherits old tenure; XV-25). A partial
withdrawal keeps `TenureStart`, so tenure falls in proportion to the amount withdrawn (XV-63). Fills and clawbacks
reduce `Amount` the same way.

**Accumulator (O(1) per transaction).** Per side keep `A = Committed = sum(a_i)` and `S = TenureSum = sum(a_i * s_i)`.
Total tenure at time `t` is `W(t) = t*A - S`, exact in integers. When a fee `F` is paid at time `t` by commitment `x`:

```
W' = t*A - S - tenure_x            (the payer is excluded)
FeeIndex1 += floor( F * t * 10^18 / W' )
FeeIndex0 += ceil ( F     * 10^18 / W' )
snapshot_x := current indices      (the payer accrues nothing from its own fee)
```

Commitment `i`'s accrued share since its last snapshot is
`max(0, floor( a_i * ((FeeIndex1 - snap1_i) - s_i * (FeeIndex0 - snap0_i)) / 10^18 ))`. Because `a_i` and `s_i` are
constant between snapshots (every change settles first), this equals the exact tenure-weighted share
`sum_e F_e * a_i * (t_e - s_i) / W_e` minus rounding. Rounding is always **against** the recipient (FeeIndex1 down,
FeeIndex0 up, final floor, clamp at 0), so the sum of entitlements never exceeds the pool (INV-9). Shares are settled
into `PendingFees` on every change to the commitment and paid on `CorridorWithdraw` or `CorridorClaim`. When the last
commitment on a side leaves, it receives the residual rounding dust and the pool becomes exactly zero (XV-68).

Precision: with `tau` measured from activation (at most ~1.3 x 10^8 s for a 4-year term) and amounts below 2^63, the
products fit in 256 bits; the model uses arbitrary precision. Each settlement under-pays by less than one unit plus at
most `a_i * s_i / 10^18` units per fee event from the FeeIndex0 round-up (for `a_i = 10^15`, `s_i = 10^8`: 0.1 unit).
Per fee event, a floor may release up to one unit per stayer of remainder withheld earlier; cumulative solvency is
exact. The xrpld storage type for the indices is open question 4.

### 3.8 Transactions

Every transaction carries the standard common fields and returns `temDISABLED` when the amendment is not enabled. All
conditions use only the transaction, the open-ledger view and the parent close time and sequence.

#### `CorridorCreate` (Owner)
Fields: `Asset`, `Asset2`, `ImprovementBps`, `PauseBps?`, `MinCommit?`, `MaxParticipants`, `MinParticipants?`,
`Threshold?`, `MaturityTime?`, `DomainID?`.
- preflight: `temMALFORMED` (same asset twice, ImprovementBps outside 1..500, PauseBps outside 1..5000, caps, gate
  assets not in the pair), `temBAD_AMOUNT`, `temBAD_EXPIRATION`.
- preclaim/doApply: `terNO_AMM` (no AMM), `tecAMM_EMPTY`, `tecFROZEN` (AMM frozen), `tecEXPIRED` (MaturityTime passed),
  `tecOBJECT_NOT_FOUND` (DomainID), `tecINSUFFICIENT_RESERVE`.
- Effect: corridor in FORMING; reference price snapshotted; added to the AMM's corridor directory.

#### `CorridorCommit` (provider)
Fields: `CorridorID`, `Asset`, `Amount`, `LockDuration?` + `ExitFeeBps?` (both or neither), `MinRate?` | `MaxRate?`,
`MaxPerLevel?`.
- Failure codes: `tecNO_ENTRY`, `tecCORRIDOR_STAGE` (not FORMING/ACTIVE), `tecCORRIDOR_ASSET`, `tecCORRIDOR_BOUND`
  (below MinCommit; rate field on the wrong side), `tecNO_AUTH` (domain), `tecNO_LINE`, `tecFROZEN`, `tecCORRIDOR_LIMIT`
  (MaxParticipants), `tecCORRIDOR_TERMS` (changing LockDuration/ExitFeeBps on top-up), `tecINSUFFICIENT_RESERVE`,
  `tecUNFUNDED` (Amount > balance - holds, XRP also minus reserve).
- Effect: creates or tops up the commitment and increases the hold. Funds do not move. Limits may be updated on top-up.

#### `CorridorWithdraw` (provider)
Fields: `CorridorID`, `Asset`, `Amount?` (absent = all).
- Failure codes: `tecNO_ENTRY`, `tecINSUFFICIENT_FUNDS` (Amount > committed), `tecFROZEN` (fee or claim would move a
  frozen asset). Never `locked`.
- Effect: settles the accumulator; computes the fee; releases the hold; moves the fee to the pool and distributes it to
  the stayers; pays the provider's pending share; deletes the commitment at zero (reserve released) and sweeps residual
  dust if it was the last on its side.

#### `CorridorClaim` (provider)
Fields: `CorridorID`, `Asset`. Pays the pending share. `tecCORRIDOR_NO_OP` if nothing is due.

#### `CorridorAdvance` (anyone; `tfClose` by the Owner)
- Without flags: `FORMING -> ACTIVE` if the gate is met and the AMM is usable (sets `ActivatedAt`); persists a lazily
  reached `MATURED`; refreshes the pause reference. Otherwise `tecCORRIDOR_NO_OP` (fee charged, discourages spam).
- With `tfClose`: the Owner moves FORMING/ACTIVE/MATURED to `CLOSED`. Closing only releases (fees become zero).

#### `CorridorDelete` (Owner)
`tecNO_PERMISSION`, `tecHAS_OBLIGATIONS` (commitments or a non-empty pool remain), `tecCORRIDOR_STAGE` (ACTIVE).
Never iterates providers.

### 3.9 Lifecycle

```
            gate met + AMM usable (Advance, anyone)        close >= MaturityTime (lazy)
  FORMING ─────────────────────────────────────▶ ACTIVE ──────────────────────────────▶ MATURED
     │  withdraw free, no quoting                   │  quoting, terms running              │  no quoting, no fees
     └──────────── tfClose (owner) ──────────▶ CLOSED ◀── tfClose ──┘◀──── tfClose ───────┘
```

There is no FAILED stage and no automatic release: an unmet gate just leaves the corridor FORMING, where withdrawal is
free.

### 3.10 Fees, reserves and resource limits

- **Transaction fees:** base fee for all six transactions. The work in `CorridorWithdraw`, `CorridorClaim` and
  `CorridorAdvance` is O(1) (accumulator; lazy activation and maturity). Payment-engine work per book step is bounded:
  <= 4 corridors x <= 16 levels in total x <= 8 commitments examined per level.
- **Reserves:** one owner reserve per corridor (Owner) and per commitment (provider). The fee-pool pseudo-account needs
  trust lines for IOU assets (Vault/AMM precedent). Model values: Mainnet `server_info` 2026-10-25 (base 1 XRP,
  increment 0.2 XRP).
- **Caps (candidates):** ImprovementBps 1..500; ExitFeeBps <= 1000; PauseBps <= 5000; LockDuration <= 4 years;
  MaxParticipants <= 512.

### 3.11 Explicitly excluded from consensus

AI scoring; market recommendations; external price oracles (XLS-47 is deliberately not referenced); TG Intelligence,
Titan Ghost and any operator's proprietary logic; capital allocation; legal or regulatory gate outcomes; USD
valuations. The protocol enforces only ledger state and what providers signed.

### 3.12 Invariants

22 invariants in `XDLC_SECURITY_INVARIANTS.md`. The reference model checks them after every applied transaction
(several via the step/withdraw trace). In xrpld they become `InvariantCheck` classes plus assertions in the corridor
liquidity source; a violation yields `tecINVARIANT_FAILED`.

### 3.13 API / RPC

No new methods in v1. `ledger_entry` and `account_objects` gain the two entry types. `amm_info` could list corridors
for an AMM; `book_offers` could optionally show the current corridor quote as a synthetic entry, as clients already
have to reason about AMM liquidity. Holds appear in metadata as modified-node diffs.

## 4. Rationale

### 4.1 Why not existing offers
XRPL has no pegged or dynamic offers. Emulating a peg means cancel-and-replace every ledger: a fee and sequence per
offer per ledger, quotes that are always one ledger stale and get picked off in between, ordering races against other
submitters, and directory churn for every validator. A synthetic quote computed inside `BookStep` from current AMM
state is exact at the moment of crossing and costs nothing when unused.

### 4.2 Why not just deposit into the AMM
AMM deposits are pooled custody in the AMM pseudo-account, withdrawable any time, with no term, no tenure priority, no
per-LP price or size limits, and no permissioned-provider option. The corridor needs the AMM (it is the price
reference) but serves a different provider: one who keeps custody, accepts a term, and wants to sell near spot rather
than along the whole curve.

### 4.3 Why not Hooks or smart contracts
No Hooks, Smart Escrow or WASM amendment appears in the Mainnet feature list (read-only `feature`, validated ledger
107895208, 2026-10-25). Smart Escrows (XLS-100), Smart Contracts (XLS-101) and the WASM VM (XLS-102) are Draft. A
future smart-contract amendment **could subsume** holds, terms, fee pools and priority. The synthetic liquidity source
inside the payment engine is the part least likely to be expressible as a contract, because it needs the engine to
call out during `BookStep`. If such an amendment ships, XDLC should be re-evaluated and possibly withdrawn or reduced to
the engine hook.

### 4.4 Other choices
- **In-account holds, not a principal pool.** A pseudo-account pool (like AMM or Vault) would be simpler but breaks P1.
  Only exit fees are pooled.
- **Peg to the AMM, not an oracle or the CLOB.** AMM balances are ledger state and cost real capital to move; oracles
  add trust and liveness risk; a CLOB tip is cheap to place and cancel (section 3.4).
- **Exit priced, not prohibited.** A hard lock makes withdrawal depend on time alone and was the reason for the old
  automatic-release machinery. A prorated fee keeps the commitment binding in expectation, compensates those who stay,
  and keeps the withdrawal right unconditional (INV-21).
- **Tenure-weighted fee sharing, O(1).** Distributing to n stayers directly would be O(n) per exit; the two-index
  accumulator keeps every transaction constant-time with provable solvency.

### 4.5 Removed from the earlier draft
- **Group funding with automatic release.** Commander decision: locks start at launch and exit is priced, not
  prohibited. Nothing is locked before activation, so there is nothing to release. An optional activation gate remains.
- **Operator-placed offers bounded by the participant.** Corridor quotes are synthesized by the engine; no operator
  places offers for providers. Titan Ghost participates as an ordinary provider. Bounded delegation, if ever needed,
  belongs in a general parameterized-delegation amendment.
- **Absolute `LockUntil`.** Replaced by `LockDuration` starting at activation.

## 5. Risks (honest list)

1. **Payment-engine complexity and consensus risk (biggest).** A second synthetic source in `BookStep`, its interaction
   with multi-path Flow, strand ranking, limit quality, offer crossing and the AMM's own sizing logic, plus hold-aware
   funding in every path. Any divergence between nodes is a consensus failure. Mitigation: mirror `AMMLiquidity`
   closely, exhaustive jtx tests, fuzzing, a long Devnet/Testnet period.
2. **Adverse selection.** The corridor is pegged to the AMM, so whenever the AMM is stale relative to outside markets,
   the corridor is staler by `ImprovementBps` and arbitrageurs hit it **before** the AMM. Providers absorb that loss
   before AMM LPs do. The pause does not help (the AMM has not moved yet). Mitigations are the provider's own:
   `MinRate`/`MaxRate`, `MaxPerLevel`, choice of `ImprovementBps`, flexible commitments. This is the main economic risk
   for providers and must be disclosed.
3. **AMM LP flow impact.** The corridor takes the first slice of every trade at each level; the AMM fills only between
   levels (XV-37: 90 of 100 USD went to the corridor). AMM LPs earn fewer trading fees and see less volume; the AMM's
   price moves less per trade. AMM LPs and corridor providers compete for the same flow. Reviewers should weigh whether
   this is healthy competition or a drain on AMM depth.
4. **Manipulation.** Same-ledger AMM pushes are blocked by the pause (XV-51); without `PauseBps` they work (XV-52).
   Multi-ledger pushes are exposed to arbitrage but possible for well-capitalized attackers; provider bounds cap losses.
5. **Performance.** Bounded per step (section 3.10), but each step now reads corridor directories and commitments. The
   caps (4 / 16 / 8) need benchmarking against current BookStep cost.
6. **Griefing.** Dust commitments occupying slots or priority positions (mitigated by `MinCommit` and the per-commitment
   reserve); ineligible commitments consuming the 8-per-level budget (open question 8); corridor squatting on popular
   AMMs (any number of corridors may exist; the step evaluates the 4 with the highest `ImprovementBps`); crank spam
   (fee-charged no-ops).
7. **Owner close.** The owner can close at any time, zeroing exit fees. It can never seize or extend anything.

## 6. Backwards compatibility

Before activation nothing changes. After activation, accounts without commitments behave identically and payments on
books without corridors are unchanged. Clients need new binary-codec definitions. Quotes from corridors change what a
payment delivers on affected books (always better for the taker than the AMM alone).

## 7. Amendment gating, migration and rollback

1. **Gate:** feature `LiquidityCorridors`. Every new transaction, hold-aware path and the corridor liquidity source are
   conditioned on `view.rules().enabled(featureLiquidityCorridors)`.
2. **Holds representation:** Option A, aggregate `HeldAmount` on balances (fast funding checks, format change); Option
   B, computed from the owner directory (no format change, slower). The model uses a cache plus INV-4.
3. **Migration:** none; only new objects.
4. **Rollback:** an enabled amendment cannot be disabled. A conservative `fix` path exists: disable quoting and new
   commits while keeping `CorridorWithdraw`/`CorridorClaim` working, so funds and fee shares are always releasable.

## 8. Test plan

- Executable reference model: `lib/xdlc-spec/model.mjs`; 80 deterministic vectors, negative controls for every
  invariant, an accumulator stress test and 40 seeded random streams x 250 transactions (`XDLC_DETERMINISTIC_TESTS.md`).
  A specification aid, not an implementation test. It models one book step (single strand), not multi-path Flow.
- Planned xrpld tests (not written): jtx tests per transaction and result code; `BookStep` tests interleaving CLOB,
  AMM and corridor liquidity in single- and multi-path payments, auto-bridged paths and offer crossing; hold-awareness
  for every funding path in section 3.6; accumulator tests with adversarial amounts; invariant tests that force
  violations; Batch and delegation interaction; fuzzing.

## 9. Reference implementation

**None in xrpld.** No fork, branch or PR exists. Plan, based on a read-only look at `XRPLF/rippled` develop @ `1f46f75`
(2026-10-23):

| Area | Location (develop @ 1f46f75) | Change (plan) |
|---|---|---|
| Feature flag | `include/xrpl/protocol/detail/features.macro` | `XRPL_FEATURE(LiquidityCorridors, Supported::No, VoteBehavior::DefaultNo)` |
| Fields, entries, transactions | `sfields.macro`, `ledger_entries.macro`, `transactions.macro`; keylets in `Indexes.h/.cpp` | Two entries, a corridor-per-AMM directory, six transactions |
| Transactors | `src/libxrpl/tx/transactors/` (new `corridor/`) | `preflight`/`preclaim`/`doApply` |
| Corridor liquidity | `src/libxrpl/tx/paths/` beside `AMMLiquidity.cpp`, `AMMOffer.cpp`; `BookStep.cpp` (`forEachOffer`, `tip`, `qualityUpperBound`) | `CorridorLiquidity` / `CorridorOffer` synthetic source; level sizing; tenure order; pause |
| Funding paths | `TokenHelpers.cpp` (`accountHolds`, `accountFunds`), `AccountRootHelpers.cpp` (`xrpLiquid`), `OfferHelpers.cpp` | Subtract holds |
| Pseudo-account | AMM/Vault pseudo-account helpers | Fee-pool account |
| Invariants | `src/libxrpl/tx/invariants/` | INV-3..INV-19 |
| Delegation | `permissions.macro` | Commit/Withdraw/Claim/Delete non-delegable |
| Tests | `src/test/app/` (`Corridor_test.cpp` beside `AMM_test.cpp`, `Offer_test.cpp`) | Section 8 |

## 10. Result codes (candidates)

| Code | Status | Meaning |
|---|---|---|
| `tecCORRIDOR_STAGE` | new | Operation not allowed in the current stage |
| `tecCORRIDOR_LIMIT` | new | Participant cap reached |
| `tecCORRIDOR_BOUND` | new | Below MinCommit, or a rate bound on the wrong side |
| `tecCORRIDOR_ASSET` | new | Asset not part of the corridor |
| `tecCORRIDOR_TERMS` | new | Attempt to change LockDuration or ExitFeeBps |
| `tecCORRIDOR_NO_OP` | new | Advance or Claim had nothing to do (fee charged) |
| `terNO_AMM`, `tecAMM_EMPTY`, `tecPATH_DRY`, `tecNO_AUTH`, `tecOBJECT_NOT_FOUND`, `temDISABLED`, `temMALFORMED`, `temBAD_AMOUNT`, `temBAD_EXPIRATION`, `temINVALID_FLAG`, `tecNO_ENTRY`, `tecNO_PERMISSION`, `tecEXPIRED`, `tecINSUFFICIENT_RESERVE`, `tecUNFUNDED`, `tecUNFUNDED_PAYMENT`, `tecINSUFFICIENT_FUNDS`, `tecHAS_OBLIGATIONS`, `tecNO_LINE`, `tecFROZEN`, `tefPAST_SEQ`, `tefNO_TICKET`, `terPRE_SEQ`, `terINSUF_FEE_B`, `tecINVARIANT_FAILED` | existing | Reused with their existing meaning |

## 11. Open questions

1. Pause reference design (section 3.5): earlier-ledger snapshot (chosen) vs. parent-ledger read vs. time-weighted;
   whether `BookStep` may write the corridor SLE when the corridor does not fill.
2. Peg to the best of AMM and CLOB (future work, manipulation concerns), or AMM only (v1).
3. Level definition in multi-path Flow: one level per engine iteration (like AMM offers) vs. the model's spot-step
   levels.
4. Storage type and precision of the accumulator indices (Number, 128-bit integer, new STNumber field).
5. Whether exit fees should also be waived while the AMM is frozen (model: waived whenever the AMM is unusable), and
   whether an LP could empty an AMM to free providers from fees.
6. Issuer transfer fees on exit fees and claims; frozen fee-pool lines.
7. A per-ledger fill cap per commitment as extra manipulation protection.
8. Whether skipped (ineligible) commitments should count toward the 8-per-level budget.
9. Several corridors on one AMM: keep "top 4 by ImprovementBps", or one corridor per AMM with open membership.

## 12. Security considerations

See `XDLC_SECURITY_INVARIANTS.md`: threat model, 22 invariants, griefing vectors and mitigations. The largest
implementation risk is the payment-engine change (section 5.1); the largest economic risk for providers is adverse
selection (section 5.2).

## 13. Sources (accessed 2026-10-25)

- XLS process and standards index: https://xls.xrpl.org/xls/XLS-0001-xls-process.html, https://xls.xrpl.org/ (XLS-30,
  56, 70, 73, 75, 80, 81, 85 Final; XLS-65, 66, 100, 101, 102 Draft; no Hooks XLS listed).
- Contributing code / amendment workflow: https://xrpl.org/resources/contribute-code
- Amendment status: read-only `feature` request through the Titan Forge Mainnet observer (`lib/mainnet-observer.mjs`,
  `wss://xrplcluster.com`), validated ledger 107895208, close time 2026-10-25 14:35:10 UTC. Enabled: AMM, AMMClawback,
  fixAMMv1_1/1_2/1_3, fixAMMOverflowOffer, BatchV1_1, fixBatchV1_2, Credentials, PermissionedDomains, PermissionedDEX,
  PermissionDelegationV1_1, MPTokensV1, TokenEscrow, Escrow, TicketBatch, PriceOracle. Not enabled: SingleAssetVault,
  LendingProtocol, LendingProtocolV1_1, Sponsor, DynamicMPT. No feature whose name contains Hook, Smart or WASM. An
  earlier read the same day from `s1.ripple.com` (ledger 107891238) and Testnet (`s.altnet.rippletest.net`, ledger
  21810780) gave the same picture.
- xrpld source: `XRPLF/rippled` develop @ `1f46f75` via the GitHub API (read-only): `src/libxrpl/tx/paths/`
  (`AMMLiquidity.cpp`, `AMMOffer.cpp`, `BookStep.cpp`: `tryAMM` once per iteration before CLOB offers, skipped for
  domain books; `AMMLiquidity::getOffer` declines when spot quality is not better than the CLOB tip or the AMM's
  assets are frozen; Fibonacci-sized offers in multi-path mode).
- Reserves: Mainnet `server_info`, 2026-10-25: base 1 XRP, increment 0.2 XRP, base fee 10 drops.
- Titan Forge terminology: `CONTRACT.md`, `lib/corridor.mjs`, `docs/INCUBATOR.md`.
