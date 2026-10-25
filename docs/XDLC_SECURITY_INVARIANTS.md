# XDLC security invariants and threat model

Companion to `XDLC_AMENDMENT_PROPOSAL.md` (XLS-XXXX, unassigned; Draft-Local, not submitted, not implemented in
xrpld). The table is generated from `lib/xdlc-spec/invariants.mjs`. The reference model (`checkInvariants` in
`lib/xdlc-spec/model.mjs`) checks INV-1 to INV-19 after every applied transaction, several from the step or withdraw
trace; INV-20 to INV-22 are covered by common checks and tests. Each checked invariant has a negative control in
`test/xdlc-spec.test.mjs`.

## Invariants

<!-- XDLC_INVARIANTS:BEGIN -->
| ID | Invariant | Statement | Reference model | xrpld implementation plan |
|---|---|---|---|---|
| INV-1 | XRP is never created | sum(XRP in accounts, AMM pools and corridor fee pools) + fees destroyed is unchanged; only the transaction fee is destroyed. | checkInvariants | Existing XRPNotCreated invariant; corridor fee pools are held by a pseudo-account, so no change expected. |
| INV-2 | Issued tokens are not created | Per issued asset, holders + AMM pools + corridor fee pools change only through issuer actions (Clawback). Exit fees and claims are transfers. | checkInvariants | Existing trust line / MPT accounting. |
| INV-3 | Holds never exceed funds | For every account and asset: 0 <= held <= balance. XRP holds come only from balance above the owner reserve at commit time. | checkInvariants; CorridorCommit availability check | New InvariantCheck (ValidCorridorHolds). |
| INV-4 | Hold cache equals commitments | The per-account aggregate hold equals the sum of that account's CorridorCommitment amounts. | checkInvariants | New InvariantCheck; or compute holds from the owner directory (slower). |
| INV-5 | Corridor side accounting is exact | Per side: Committed = sum(Amount), TenureSum = sum(Amount * TenureStart), Count = number of commitments; no dangling links. | checkInvariants | New InvariantCheck (ValidLiquidityCorridor). |
| INV-6 | Corridor fills beat the AMM by at least ImprovementBps | Every corridor fill satisfies out/in >= AMMspotQuality(incl. trading fee, at that depth) * (10000 + ImprovementBps)/10000, with ImprovementBps >= 1. The taker-side amount is rounded in the taker's favor so this holds exactly. | checkInvariants (trace) | Assert in the corridor liquidity source (BookStep) + InvariantCheck on offer-crossing metadata. |
| INV-7 | Provider limits hold | Every corridor fill respects the provider's MinRate (base side) or MaxRate (Asset2 side) on executed amounts, and MaxPerLevel per level. | checkInvariants (trace) | Checked per commitment when the level is built. |
| INV-8 | Exit fee is bounded | fee <= floor(withdrawn * ExitFeeBps * remaining / LockDuration / 10000) <= withdrawn * 10%; fee = 0 unless the corridor is ACTIVE and the term has not ended; ExitFeeBps immutable and <= 1000. | checkInvariants (trace) | Computed in CorridorWithdraw doApply; InvariantCheck on the pool delta. |
| INV-9 | Fee pool is solvent and exact | Per side: Pool = FeesIn - PaidOut >= sum of every provider's unpaid entitlement; a side with no commitments has an empty pool. | checkInvariants | New InvariantCheck; guaranteed by accumulator rounding (I1 down, I0 up). |
| INV-10 | Fees go only to providers who stay | The payer accrues nothing from its own fee; the other side accrues nothing; stayers on the side accrue at most the fee (plus < 1 unit per stayer of previously withheld rounding remainder); no entitlement shrinks except by payment. | checkInvariants (trace) | Payer snapshot set to the post-event index in the same transaction. |
| INV-11 | Tenure is monotonic | TenureStart never moves earlier; for an untouched commitment, tenure = Amount * (tau - TenureStart) never decreases. Top-ups average the start (rounded later); partial withdrawals reduce tenure proportionally. | checkInvariants | InvariantCheck comparing before/after SLE. |
| INV-12 | Deterministic fill priority | Within a corridor level, fills follow (TenureStart, CommitmentID) ascending. | checkInvariants (trace) | Corridor directory kept sorted by (TenureStart, CommitmentID), or a bounded sort per step. |
| INV-13 | Bounded resources | Corridors per book step <= 4; corridor levels per step <= 16; commitments examined per level <= 8; commitments per corridor <= MaxParticipants <= 512; 1 <= ImprovementBps <= 500. | preflight caps; checkInvariants (+ trace) | preflight + step counters + InvariantCheck. |
| INV-14 | Monotonic lifecycle | Stage moves only FORMING->ACTIVE->MATURED, or {FORMING, ACTIVE, MATURED}->CLOSED. ActivatedAt is written once. | checkInvariants | InvariantCheck comparing before/after SLE. |
| INV-15 | Quotes only when allowed | A corridor fills only while (effectively) ACTIVE, its AMM exists, is non-empty and not frozen, and the volatility pause is not tripped. | checkInvariants (trace) | Checked when the corridor liquidity source is constructed for a BookStep. |
| INV-16 | Reserve consistency | OwnerCount equals owned objects (trust lines, tickets, corridors, commitments, offers). Each XDLC object costs exactly one owner reserve to its owner. | checkInvariants | Existing owner-count bookkeeping (adjustOwnerCount). |
| INV-17 | AMM curve unaffected | In any swap the AMM constant product never decreases. Corridor fills do not touch AMM balances. | checkInvariants | Existing AMM invariant (ValidAMM). |
| INV-18 | XDLC transactions move value only as fees and claims | Create/Commit/Advance/Delete change no balance except the signer's XRP by the transaction fee. Withdraw/Claim change only the signer's balance in the commitment asset by (claimed + swept - exit fee), mirrored by the fee pool. | checkInvariants | New InvariantCheck keyed on transaction type. |
| INV-19 | Immutable ownership and terms | A commitment's Account, Asset, LockDuration and ExitFeeBps never change after creation. | checkInvariants | Fields never written after create. |
| INV-20 | Replay protection | Each signed transaction applies at most once (Sequence or a consumed Ticket). | apply() common checks; replay vectors | Existing Transactor common fields; no change. |
| INV-21 | Withdrawal right | The owner of a commitment can always withdraw it (exit is priced, never prohibited); this never depends on the corridor owner, another provider or a crank. Only an issuer freeze can block a fee- or claim-bearing exit. | property test (40 seeded streams x 250 tx) | CorridorWithdraw has no preclaim dependency on the corridor owner; unit tests. |
| INV-22 | Determinism | Validation and application depend only on the transaction, parent-ledger state, the open-ledger view and parent close time/sequence. No oracle, clock, randomness, AI score or off-ledger input. | determinism test; model has no I/O | Standard Transactor / payment-engine discipline. |
<!-- XDLC_INVARIANTS:END -->

## Threat model

| Actor | Can | Cannot (by construction) |
|---|---|---|
| Provider | Commit, top up, set limits, withdraw any time (fee if early in a term), claim fee shares | Spend held funds elsewhere; change its term or fee; fill its own payment; share in its own exit fee |
| Corridor owner | Create, close (releases everyone, fees zero), delete when empty | Touch commitments, move funds, extend terms, reopen a closed corridor |
| Taker / anyone | Take corridor liquidity through normal payments and offer crossing; crank `CorridorAdvance` | Get a corridor fill worse than AMM + ImprovementBps or below a provider's bound |
| AMM manipulator | Move the AMM price with capital | Have a same-ledger move become the pause reference |
| Issuer | Freeze, deep freeze, clawback | n/a: XDLC never weakens issuer controls |
| Validators | Apply deterministic rules | Read any oracle, AI score or off-ledger input (INV-22) |

Out of scope: key compromise; market risk inside a provider's own bounds; legal status; off-ledger operator decisions
(TG Intelligence, Titan Ghost or anyone else's).

## Griefing vectors and mitigations

| # | Vector | Mitigation | Residual risk |
|---|---|---|---|
| T1 | Arbitrage against a stale AMM hits the corridor first (adverse selection) | Provider MinRate/MaxRate, MaxPerLevel, choice of ImprovementBps, flexible commitments | **Real, economic.** Disclosed; not solvable without an oracle. |
| T2 | Same-ledger AMM manipulation to fill providers at a bad price | Volatility pause against an earlier-ledger reference (XV-51) | Multi-ledger manipulation exposed to arbitrage; bounded by provider limits. |
| T3 | Dust commitments occupying slots or priority | MinCommit, one reserve per commitment, MaxParticipants, optional DomainID | Capital can still occupy slots, at real cost. |
| T4 | Ineligible commitments consuming the 8-per-level budget | Tenure order means griefers need old tenure and real capital | Open question. |
| T5 | Exit-fee rounding drift or pool insolvency | Rounding against recipients; INV-9 solvency; last provider sweeps dust | None material. |
| T6 | Splitting withdrawals to rebate one's own fee | Payer excluded from its own fee (INV-10) | None. |
| T7 | Top-up to inherit old tenure | Weighted-average start, rounded later (XV-25) | None. |
| T8 | Owner closes at an inconvenient time | Close only releases; fees become zero | Business risk only. |
| T9 | Crank spam | No-op `CorridorAdvance`/`CorridorClaim` returns `tecCORRIDOR_NO_OP` and charges the fee | None material. |
| T10 | Validator load in the payment engine | Per-step caps (INV-13), O(1) accumulator, lazy activation/maturity | Caps need benchmarking. |
| T11 | Held funds re-pledged through an unaudited funding path | Holds subtracted in every funding path | **Largest implementation risk**; depends on completeness. |
| T12 | Issuer freeze or clawback during a term | Issuer powers take precedence; holds clamped with accumulator settlement | Inherent to issued assets. |
