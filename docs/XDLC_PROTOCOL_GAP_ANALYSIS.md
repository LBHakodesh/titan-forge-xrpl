# XDLC protocol gap analysis

Companion to `XDLC_AMENDMENT_PROPOSAL.md` (XLS-XXXX, unassigned; Draft-Local, not submitted; v0.2 AMM-pegged corridor
design). Amendment statuses were read on 2026-10-25 with the read-only `feature` method (Mainnet validated ledger
107895208); rippled facts from `XRPLF/rippled` develop @ `1f46f75` (proposal section 13). The table is generated from
`lib/xdlc-spec/gaps.mjs`.

## Bottom line

- **XDLC is a neutral corridor of provider liquidity that undercuts the XRPL AMM at every depth level.** Any
  organization can provide liquidity; GYW1313 (Titan Ghost, TG Intelligence) is one participant, off-ledger.
- **Three things genuinely need the protocol:** G3 engine-synthesized quotes pegged to the AMM, G5 self-custodial holds,
  G6 term commitments with a priced exit and a fee pool. Tenure priority, provider limits and the volatility pause
  (G7-G9) are parts of G3.
- **Routing, static offers, the AMM, permissioning, Batch, replay protection need no amendment.**
- **Two capabilities from the earlier draft are removed** (G12 automatic release, G13 operator-placed offers).
- **A future smart-contract amendment could subsume most of this** (G20); the engine-synthesized quote is the hardest
  part to express as a contract.

## Why not ...

- **... existing offers?** XRPL has no pegged or dynamic offers. Emulating a peg means cancel-and-replace every ledger:
  a fee and sequence per offer per ledger, quotes one ledger stale, ordering races, stale quotes picked off. rippled
  already computes AMM liquidity inside `BookStep` (`AMMLiquidity`/`AMMOffer`); a corridor is a second synthetic source
  of the same kind and only the protocol can add one.
- **... just depositing into the AMM?** Pooled custody (AMM pseudo-account), no term, no tenure priority, no per-LP
  price or size limits, no permissioned providers (AMM liquidity is skipped in domain books). The corridor needs the AMM
  as its price reference; it does not replace it.
- **... Hooks or smart contracts?** Not available: no Hooks, Smart Escrow or WASM feature in the Mainnet feature list on
  2026-10-25 (ledger 107895208); XLS-100/101/102 are Draft. If one ships, XDLC should be re-evaluated and possibly
  withdrawn or reduced to the engine hook.
- **... keep group funding with automatic release?** Commander decision: locks start at launch (activation) and exit
  is priced, not prohibited. Before activation withdrawal is free, so nothing needs releasing. An optional activation
  gate (Threshold / MinParticipants) remains, with no FAILED stage.
- **... keep operator-placed bounded offers?** Unnecessary: corridor quotes are protocol-synthesized, nobody places
  offers on a provider's behalf.

## Capability table

<!-- XDLC_GAPS:BEGIN -->
| # | Needed capability | Existing XRPL mechanism(s) | Adequate today? | Amendment necessary? | Rationale |
|---|---|---|---|---|---|
| G1 | Cross-currency routing through XRP as a bridge asset | Payment / OfferCreate auto-bridging (Flow, FlowCross, enabled); pathfinding RPCs | Yes | **NO** | Auto-bridging already composes TOKEN/XRP and XRP/TOKEN books. Corridor liquidity plugs into each book step of such a path; XDLC adds nothing to routing itself. |
| G2 | Static resting liquidity at a fixed price | OfferCreate / OfferCancel, tfPassive, tfSell, Expiration | Yes | **NO** | Any account can quote a fixed price. Titan Forge already places real Testnet offers with ordinary OfferCreate. |
| G3 | Liquidity that re-prices itself to the AMM at every depth (pegged / dynamic quotes) | None. Offers have a fixed quality; there are no pegged or oracle-relative offers on XRPL. Approximation: cancel-and-replace offers every ledger. | No | **YES** | Re-pricing by transaction costs a fee and a sequence per offer per ledger, is always one ledger stale, races other submitters for ordering, and leaves stale quotes exposed to adverse selection between ledgers. A synthetic quote computed inside the payment engine from current AMM state (the way AMMLiquidity/AMMOffer already work in BookStep) has none of these problems, but only the protocol can do it. |
| G4 | Pooled passive liquidity for a pair | AMM (XLS-30, enabled on Mainnet), LP tokens, AMMDeposit / AMMWithdraw / AMMBid | Yes (for pooled liquidity) | **NO** | The AMM is the reference the corridor pegs to. Depositing into it is the obvious alternative, but it is pooled custody (AMM pseudo-account), has no term commitments, no tenure priority, no per-provider price or size limits, and no permissioned-provider option (AMM is not supported in permissioned-domain books). XDLC does not replace the AMM; it needs one. |
| G5 | Self-custodial commitment: funds stay in the provider account but cannot be spent elsewhere | Escrow / TokenEscrow (XLS-85) move funds out of the balance; offers do not reserve funds; Checks and Payment Channels are payment promises | No | **YES** | There is no ledger state meaning "this balance is unspendable except by this corridor". Escrowed funds cannot back liquidity; offer-backing funds can be spent at any time. Holds respected by every funding path (accountHolds / xrpLiquid) are the core change. |
| G6 | Term commitment with a priced early exit (prorated fee) paid to the providers who stay | None on-ledger. Off-ledger contracts can promise it; nobody can verify or enforce it. | No | **YES** | Requires G5 plus an atomic withdraw-and-charge rule and a fee pool. The fee is fixed at commit, capped (1000 bps), zero before activation, after the term, and after maturity or owner close. |
| G7 | Fill priority by tenure among providers at the same corridor level | None. CLOB offers at equal quality fill in directory (time-of-placement) order; the AMM is a single pool. | No | **YES (part of G3)** | Only meaningful once corridor quotes are protocol-synthesized (G3). Deterministic order: tenure start, then CommitmentID; bounded per step. |
| G8 | Provider-set limits on synthesized liquidity (worst price, max per depth level) | For plain offers the offer quality is the limit; nothing exists for engine-synthesized liquidity | No | **YES (part of G3)** | MinRate / MaxRate and MaxPerLevel bound what the engine may take from each commitment. Checked on executed amounts. |
| G9 | Volatility guard without an oracle | Price Oracles (XLS-47, enabled) exist but are deliberately not used | Not wanted (oracle) | **YES (part of G3)** | The pause compares the AMM price with a reference snapshotted from AMM state in an earlier ledger. Deterministic, oracle-free; trade-offs listed as an open question. |
| G10 | Permissioned providers (KYC / accredited / region rules) | Credentials (XLS-70), Permissioned Domains (XLS-80), Permissioned DEX (XLS-81), DepositAuth / DepositPreauth | Yes | **NO** | A corridor may reference a DomainID; only domain members may commit. Reuses existing machinery. Credentials alone do not establish legal compliance. |
| G11 | Atomic multi-step setup (trust line + commitment, several providers at once) | Batch (XLS-56; BatchV1_1 enabled on Mainnet), up to 8 inner transactions | Yes (single ledger) | **NO** | Batch gives one-ledger atomicity for setup. It creates no persistent state, so it cannot carry a commitment. |
| G12 | Group funding threshold with automatic release if unmet | n/a | n/a | **REMOVED** | Commander decision: term clocks start when the corridor becomes ACTIVE, and exit is priced, not prohibited. Before activation withdrawal is free, so there is nothing to release. An optional activation gate (Threshold / MinParticipants) remains, with no release machinery and no FAILED stage. |
| G13 | Operator-placed offers bounded by the participant | Permission Delegation (XLS-75) is transaction-level only | Partial | **REMOVED** | Not needed: corridor quotes are synthesized by the payment engine from AMM state, so no operator places offers on a provider's behalf. Titan Ghost participates as an ordinary provider. If bounded delegation is ever wanted, a general parameterized-delegation amendment is the right place, not XDLC. |
| G14 | Lifecycle stage as consensus state | None directly; off-ledger application state | Partial | **YES (only as needed)** | ACTIVE gates quoting and starts term clocks; MATURED/CLOSED zero the exit fee. Market-maturity labels that depend on scoring (Titan Forge spoke -> corridor -> mature) stay off-ledger. |
| G15 | Pooled vault capital and on-ledger credit (Tier 3) | Single Asset Vault (XLS-65; SingleAssetVault not enabled on Mainnet), Lending Protocol (XLS-66; not enabled) | Pending activation | **OTHER** | Belongs to XLS-65/66. XDLC must not duplicate vault or lending semantics. |
| G16 | Reserve / fee sponsorship for providers | Sponsored Fees and Reserves (XLS-68; Sponsor amendment supported, not enabled on Mainnet) | Pending activation | **OTHER** | Out of scope. XDLC objects charge the normal owner reserve to their owner. |
| G17 | Replay protection and out-of-order submission | Account Sequence, Tickets (TicketBatch, enabled), LastLedgerSequence | Yes | **NO** | Candidate transactions use the standard common fields. |
| G18 | External price reference in consensus | Price Oracles (XLS-47, enabled) | Not wanted | **NO** | Deliberately excluded. Oracle-driven consensus conditions add manipulation and liveness risk. The corridor pegs to AMM ledger state instead. |
| G19 | Which corridors to fund, how much, risk and inventory management, customer tooling | Off-ledger: GYW1313 TG Intelligence, Titan Ghost, any other operator's own software | Yes (off-ledger) | **NO** | Proprietary and non-deterministic. Must never be consensus-relevant. XDLC is neutral infrastructure; any organization can provide liquidity with its own tools. |
| G20 | General programmability that could host XDLC as a contract | No Hooks, Smart Escrow or WASM feature in the Mainnet feature list (read-only `feature`, validated ledger 107895208, 2026-10-25); Smart Escrows XLS-100, Smart Contracts XLS-101, WASM VM XLS-102 are Draft | Not available | **OTHER** | A future smart-contract amendment could subsume holds, terms, fee pools and priority. Synthesized liquidity inside the payment engine (G3) is the part least likely to be expressible as a contract, because it needs the engine to call out during BookStep. If such an amendment ships, XDLC should be re-evaluated and possibly withdrawn. |
<!-- XDLC_GAPS:END -->

## Risks introduced by closing the gaps

| Risk | Note |
|---|---|
| Payment-engine complexity and consensus risk | **Biggest implementation risk.** New synthetic source in BookStep plus hold-aware funding paths. |
| Adverse selection | When the AMM is stale, the corridor is staler by ImprovementBps and gets arbitraged first. Providers bear it before AMM LPs. |
| AMM LP flow impact | The corridor takes the first slice at every level; AMM LPs earn fewer fees (XV-37: 90 of 100 USD went to the corridor). |
| Manipulation | Same-ledger AMM pushes blocked by the pause (XV-51); without it they work (XV-52). |
| Performance | Bounded: <= 4 corridors, <= 16 levels, <= 8 commitments per level per step. Needs benchmarking. |
| Griefing | Dust commitments (MinCommit, reserves), ineligible commitments using the per-level budget, crank spam (fee-charged no-ops). |
