// Capability-by-capability gap analysis for XDLC (v0.2 AMM-pegged corridor design). Single source for
// docs/XDLC_PROTOCOL_GAP_ANALYSIS.md and summary.json.
// amendment: 'NO'      = existing XRPL is adequate (or the capability must stay off-ledger);
//            'YES'     = cannot be enforced by the ledger today without a protocol change;
//            'OTHER'   = a protocol gap exists but belongs to a different, more general amendment;
//            'REMOVED' = dropped from the design (Commander decision or no longer needed); kept here for the record.
export const GAPS = [
  { id: 'G1', capability: 'Cross-currency routing through XRP as a bridge asset', existing: 'Payment / OfferCreate auto-bridging (Flow, FlowCross, enabled); pathfinding RPCs', adequate: 'Yes', amendment: 'NO',
    rationale: 'Auto-bridging already composes TOKEN/XRP and XRP/TOKEN books. Corridor liquidity plugs into each book step of such a path; XDLC adds nothing to routing itself.' },
  { id: 'G2', capability: 'Static resting liquidity at a fixed price', existing: 'OfferCreate / OfferCancel, tfPassive, tfSell, Expiration', adequate: 'Yes', amendment: 'NO',
    rationale: 'Any account can quote a fixed price. Titan Forge already places real Testnet offers with ordinary OfferCreate.' },
  { id: 'G3', capability: 'Liquidity that re-prices itself to the AMM at every depth (pegged / dynamic quotes)', existing: 'None. Offers have a fixed quality; there are no pegged or oracle-relative offers on XRPL. Approximation: cancel-and-replace offers every ledger.', adequate: 'No', amendment: 'YES',
    rationale: 'Re-pricing by transaction costs a fee and a sequence per offer per ledger, is always one ledger stale, races other submitters for ordering, and leaves stale quotes exposed to adverse selection between ledgers. A synthetic quote computed inside the payment engine from current AMM state (the way AMMLiquidity/AMMOffer already work in BookStep) has none of these problems, but only the protocol can do it.' },
  { id: 'G4', capability: 'Pooled passive liquidity for a pair', existing: 'AMM (XLS-30, enabled on Mainnet), LP tokens, AMMDeposit / AMMWithdraw / AMMBid', adequate: 'Yes (for pooled liquidity)', amendment: 'NO',
    rationale: 'The AMM is the reference the corridor pegs to. Depositing into it is the obvious alternative, but it is pooled custody (AMM pseudo-account), has no term commitments, no tenure priority, no per-provider price or size limits, and no permissioned-provider option (AMM is not supported in permissioned-domain books). XDLC does not replace the AMM; it needs one.' },
  { id: 'G5', capability: 'Self-custodial commitment: funds stay in the provider account but cannot be spent elsewhere', existing: 'Escrow / TokenEscrow (XLS-85) move funds out of the balance; offers do not reserve funds; Checks and Payment Channels are payment promises', adequate: 'No', amendment: 'YES',
    rationale: 'There is no ledger state meaning "this balance is unspendable except by this corridor". Escrowed funds cannot back liquidity; offer-backing funds can be spent at any time. Holds respected by every funding path (accountHolds / xrpLiquid) are the core change.' },
  { id: 'G6', capability: 'Term commitment with a priced early exit (prorated fee) paid to the providers who stay', existing: 'None on-ledger. Off-ledger contracts can promise it; nobody can verify or enforce it.', adequate: 'No', amendment: 'YES',
    rationale: 'Requires G5 plus an atomic withdraw-and-charge rule and a fee pool. The fee is fixed at commit, capped (1000 bps), zero before activation, after the term, and after maturity or owner close.' },
  { id: 'G7', capability: 'Fill priority by tenure among providers at the same corridor level', existing: 'None. CLOB offers at equal quality fill in directory (time-of-placement) order; the AMM is a single pool.', adequate: 'No', amendment: 'YES (part of G3)',
    rationale: 'Only meaningful once corridor quotes are protocol-synthesized (G3). Deterministic order: tenure start, then CommitmentID; bounded per step.' },
  { id: 'G8', capability: 'Provider-set limits on synthesized liquidity (worst price, max per depth level)', existing: 'For plain offers the offer quality is the limit; nothing exists for engine-synthesized liquidity', adequate: 'No', amendment: 'YES (part of G3)',
    rationale: 'MinRate / MaxRate and MaxPerLevel bound what the engine may take from each commitment. Checked on executed amounts.' },
  { id: 'G9', capability: 'Volatility guard without an oracle', existing: 'Price Oracles (XLS-47, enabled) exist but are deliberately not used', adequate: 'Not wanted (oracle)', amendment: 'YES (part of G3)',
    rationale: 'The pause compares the AMM price with a reference snapshotted from AMM state in an earlier ledger. Deterministic, oracle-free; trade-offs listed as an open question.' },
  { id: 'G10', capability: 'Permissioned providers (KYC / accredited / region rules)', existing: 'Credentials (XLS-70), Permissioned Domains (XLS-80), Permissioned DEX (XLS-81), DepositAuth / DepositPreauth', adequate: 'Yes', amendment: 'NO',
    rationale: 'A corridor may reference a DomainID; only domain members may commit. Reuses existing machinery. Credentials alone do not establish legal compliance.' },
  { id: 'G11', capability: 'Atomic multi-step setup (trust line + commitment, several providers at once)', existing: 'Batch (XLS-56; BatchV1_1 enabled on Mainnet), up to 8 inner transactions', adequate: 'Yes (single ledger)', amendment: 'NO',
    rationale: 'Batch gives one-ledger atomicity for setup. It creates no persistent state, so it cannot carry a commitment.' },
  { id: 'G12', capability: 'Group funding threshold with automatic release if unmet', existing: 'n/a', adequate: 'n/a', amendment: 'REMOVED',
    rationale: 'Commander decision: term clocks start when the corridor becomes ACTIVE, and exit is priced, not prohibited. Before activation withdrawal is free, so there is nothing to release. An optional activation gate (Threshold / MinParticipants) remains, with no release machinery and no FAILED stage.' },
  { id: 'G13', capability: 'Operator-placed offers bounded by the participant', existing: 'Permission Delegation (XLS-75) is transaction-level only', adequate: 'Partial', amendment: 'REMOVED',
    rationale: 'Not needed: corridor quotes are synthesized by the payment engine from AMM state, so no operator places offers on a provider\'s behalf. Titan Ghost participates as an ordinary provider. If bounded delegation is ever wanted, a general parameterized-delegation amendment is the right place, not XDLC.' },
  { id: 'G14', capability: 'Lifecycle stage as consensus state', existing: 'None directly; off-ledger application state', adequate: 'Partial', amendment: 'YES (only as needed)',
    rationale: 'ACTIVE gates quoting and starts term clocks; MATURED/CLOSED zero the exit fee. Market-maturity labels that depend on scoring (Titan Forge spoke -> corridor -> mature) stay off-ledger.' },
  { id: 'G15', capability: 'Pooled vault capital and on-ledger credit (Tier 3)', existing: 'Single Asset Vault (XLS-65; SingleAssetVault not enabled on Mainnet), Lending Protocol (XLS-66; not enabled)', adequate: 'Pending activation', amendment: 'OTHER',
    rationale: 'Belongs to XLS-65/66. XDLC must not duplicate vault or lending semantics.' },
  { id: 'G16', capability: 'Reserve / fee sponsorship for providers', existing: 'Sponsored Fees and Reserves (XLS-68; Sponsor amendment supported, not enabled on Mainnet)', adequate: 'Pending activation', amendment: 'OTHER',
    rationale: 'Out of scope. XDLC objects charge the normal owner reserve to their owner.' },
  { id: 'G17', capability: 'Replay protection and out-of-order submission', existing: 'Account Sequence, Tickets (TicketBatch, enabled), LastLedgerSequence', adequate: 'Yes', amendment: 'NO',
    rationale: 'Candidate transactions use the standard common fields.' },
  { id: 'G18', capability: 'External price reference in consensus', existing: 'Price Oracles (XLS-47, enabled)', adequate: 'Not wanted', amendment: 'NO',
    rationale: 'Deliberately excluded. Oracle-driven consensus conditions add manipulation and liveness risk. The corridor pegs to AMM ledger state instead.' },
  { id: 'G19', capability: 'Which corridors to fund, how much, risk and inventory management, customer tooling', existing: 'Off-ledger: GYW1313 TG Intelligence, Titan Ghost, any other operator\'s own software', adequate: 'Yes (off-ledger)', amendment: 'NO',
    rationale: 'Proprietary and non-deterministic. Must never be consensus-relevant. XDLC is neutral infrastructure; any organization can provide liquidity with its own tools.' },
  { id: 'G20', capability: 'General programmability that could host XDLC as a contract', existing: 'No Hooks, Smart Escrow or WASM feature in the Mainnet feature list (read-only `feature`, validated ledger 107895208, 2026-10-25); Smart Escrows XLS-100, Smart Contracts XLS-101, WASM VM XLS-102 are Draft', adequate: 'Not available', amendment: 'OTHER',
    rationale: 'A future smart-contract amendment could subsume holds, terms, fee pools and priority. Synthesized liquidity inside the payment engine (G3) is the part least likely to be expressible as a contract, because it needs the engine to call out during BookStep. If such an amendment ships, XDLC should be re-evaluated and possibly withdrawn.' },
];

export function gapCounts(rows = GAPS) {
  const c = { total: rows.length, amendmentRequired: 0, noAmendment: 0, otherAmendment: 0, removed: 0 };
  for (const r of rows) {
    if (r.amendment.startsWith('YES')) c.amendmentRequired += 1;
    else if (r.amendment.startsWith('NO')) c.noAmendment += 1;
    else if (r.amendment.startsWith('REMOVED')) c.removed += 1;
    else c.otherAmendment += 1;
  }
  return c;
}
