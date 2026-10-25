// Regenerates lib/xdlc-spec/summary.json and the generated tables in docs/XDLC_*.md from the model's single sources.
// Usage: node lib/xdlc-spec/render.mjs   (pure, local; no network)
import { readFileSync, writeFileSync } from 'node:fs';
import * as M from './model.mjs';
import { VECTORS, buildPre, txFor } from './vectors.mjs';
import { GAPS, gapCounts } from './gaps.mjs';
import { INVARIANTS } from './invariants.mjs';

const root = new URL('../../', import.meta.url);
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const txText = (tx) => {
  const { TransactionType, ...rest } = tx;
  const keep = Object.entries(rest).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
  return `${TransactionType}${keep.length ? ` (${keep.join(', ')})` : ''}`;
};

export function vectorsTable() {
  const rows = ['| ID | Group | Case | Pre-state | Transaction | Expected | Post-state |', '|---|---|---|---|---|---|---|'];
  for (const v of VECTORS) {
    const { state } = buildPre(v, M);
    const tx = txFor(v, state); delete tx.Fee;
    rows.push(`| ${v.id} | ${v.group} | ${esc(v.title)} | ${esc(v.pre)}${v.setup.length ? ` (setup: ${v.setup.map((s) => (s.close != null ? `close@${s.close}` : s.TransactionType)).join(' -> ')})` : ''} | \`${esc(txText(tx))}\` | \`${v.expect}\` | ${esc(v.post)} |`);
  }
  return rows.join('\n');
}

export function gapsTable() {
  const rows = ['| # | Needed capability | Existing XRPL mechanism(s) | Adequate today? | Amendment necessary? | Rationale |', '|---|---|---|---|---|---|'];
  for (const g of GAPS) rows.push(`| ${g.id} | ${esc(g.capability)} | ${esc(g.existing)} | ${esc(g.adequate)} | **${esc(g.amendment)}** | ${esc(g.rationale)} |`);
  return rows.join('\n');
}

export function invariantsTable() {
  const rows = ['| ID | Invariant | Statement | Reference model | xrpld implementation plan |', '|---|---|---|---|---|'];
  for (const i of INVARIANTS) rows.push(`| ${i.id} | ${esc(i.name)} | ${esc(i.statement)} | ${esc(i.where)} | ${esc(i.xrpld)} |`);
  return rows.join('\n');
}

function splice(file, tag, body) {
  const url = new URL(file, root);
  const src = readFileSync(url, 'utf8');
  const re = new RegExp(`(<!-- ${tag}:BEGIN -->)[\\s\\S]*?(<!-- ${tag}:END -->)`);
  if (!re.test(src)) throw new Error(`${file}: missing ${tag} markers`);
  writeFileSync(url, src.replace(re, `$1\n${body}\n$2`));
}

export const CAPABILITIES = [
  { id: 'C1', name: 'AMM-pegged corridor liquidity', summary: 'For a pair with an XLS-30 AMM, the payment engine synthesizes a corridor quote at the AMM\'s current spot quality (including its trading fee) improved by ImprovementBps (>= 1 bp), at every depth level. No repricing transactions, no directory entries for quotes, no oracle.' },
  { id: 'C2', name: 'Wallet-held commitments', summary: 'Providers keep funds in their own accounts; a ledger hold makes committed funds unspendable by any other path (the accountHolds / xrpLiquid change). Flexible (Tier 1-like) or term (Tier 2-like).' },
  { id: 'C3', name: 'Activation-start terms', summary: 'LockDuration starts when the corridor becomes ACTIVE, or at commit time if already ACTIVE. Before activation, withdrawal is free. Providers can join while FORMING or ACTIVE.' },
  { id: 'C4', name: 'Prorated early-exit fee to a tenure-weighted fee pool', summary: 'fee = withdrawn x ExitFeeBps x remaining/term (fixed at commit, cap 1000 bps, rounded down), charged atomically in CorridorWithdraw, distributed to the providers who stay by tenure through an O(1) accumulator; claim on withdraw or via CorridorClaim.' },
  { id: 'C5', name: 'Tenure fill priority', summary: 'At the same corridor level, commitments fill in (TenureStart, CommitmentID) order, bounded per step.' },
  { id: 'C6', name: 'Provider limits', summary: 'Per commitment MinRate (base side) or MaxRate (Asset2 side) as the worst acceptable price, and MaxPerLevel; checked on executed amounts.' },
  { id: 'C7', name: 'Deterministic volatility pause', summary: 'A corridor stops quoting while the AMM price deviates more than PauseBps from a reference taken from AMM state in an earlier ledger (one candidate per ledger, promoted in a later ledger).' },
  { id: 'C8', name: 'Optional permissioned providers', summary: 'A corridor may reference a Permissioned Domain (XLS-80); only members may commit. Takers are not restricted (corridor quotes sit in the open book).' },
];
export const REMOVED_CAPABILITIES = [
  { name: 'Group-funding threshold with automatic release', why: 'Commander decision: terms start at activation and exit is priced, not prohibited. Nothing is locked before activation, so there is nothing to release. An optional activation gate remains.' },
  { name: 'Operator-placed offers bounded by the participant', why: 'Corridor quotes are synthesized by the payment engine, so no operator places offers for providers. Bounded delegation, if ever needed, belongs to a general amendment.' },
];
export const OPEN_QUESTIONS = [
  'Volatility pause reference: earlier-ledger AMM snapshot (chosen) vs. reading the parent ledger directly vs. a time-weighted reference; and whether BookStep may write the corridor SLE when the corridor did not fill.',
  'Should the corridor also quote when the AMM is not the best non-corridor source (i.e. peg to the best of AMM and CLOB)? v1 pegs only to the AMM; a best-CLOB peg is future work with manipulation concerns.',
  'Level definition in multi-path payments: one corridor level per Flow iteration (like AMM offers) vs. the model\'s spot-step levels.',
  'Precision and storage type of the accumulator indices (model: 10^18 fixed point in arbitrary precision; xrpld: Number / 128-bit / STNumber?).',
  'Exit fee while the AMM is unusable (model: waived when missing, empty or frozen) and whether an LP could empty the AMM to free providers from fees.',
  'Issuer transfer fees (TransferRate) on exit fees and claims; frozen fee-pool pseudo-account lines.',
  'Per-ledger fill caps per commitment (MaxPerLedger) as additional manipulation protection.',
  'Whether ineligible commitments (MinRate not met) should count toward MAX_COMMITMENTS_PER_LEVEL (model: they do; a griefing vector mitigated by MinCommit and reserves).',
];

export function summary() {
  const groups = {};
  for (const v of VECTORS) groups[v.group] = (groups[v.group] || 0) + 1;
  return {
    title: 'XDLC: XRPL Dynamic Liquidity Corridors',
    xls: 'XLS-XXXX (unassigned)',
    category: 'Amendment',
    authors: 'GYW1313 (Titan Forge team)',
    status: {
      label: 'Draft-Local (not submitted)',
      submitted: false, reviewed: false, implementedInXrpld: false, activated: false,
      note: 'Proposed amendment drafted locally. Not submitted to XRPL-Standards, not reviewed, not implemented in xrpld, not activated on any network. The Titan Forge application-level corridor lifecycle is evidence of usefulness, not the amendment.',
    },
    modelVersion: M.MODEL_VERSION,
    design: 'Neutral protocol: a corridor of provider liquidity pegged to an existing XRPL AMM that undercuts it by ImprovementBps at every depth level. Any organization can provide liquidity; GYW1313 (Titan Ghost, TG Intelligence) is one participant, off-ledger.',
    capabilities: CAPABILITIES,
    removedCapabilities: REMOVED_CAPABILITIES,
    offLedger: ['TG Intelligence', 'which corridors to fund and how much capital', 'Titan Ghost risk and inventory management', 'customer tooling', 'any other operator\'s strategy software'],
    candidateLedgerEntries: [
      { name: 'LiquidityCorridor', reserve: 'one owner reserve (corridor owner); fee pools held by a corridor pseudo-account (AMM / Vault precedent)' },
      { name: 'CorridorCommitment', reserve: 'one owner reserve (provider); one per (corridor, account, asset)' },
    ],
    candidateTransactions: M.XDLC_TX_TYPES.map((name) => ({ name, signer: { CorridorCreate: 'owner', CorridorCommit: 'provider', CorridorWithdraw: 'provider', CorridorClaim: 'provider', CorridorAdvance: 'anyone (close: owner)', CorridorDelete: 'owner' }[name] })),
    newResultCodes: Object.entries(M.RESULT_CODES).filter(([, v]) => v.startsWith('NEW')).map(([k]) => k),
    stages: [...M.STAGES],
    caps: { ...M.CAPS, ACC_SCALE: M.ACC_SCALE.toString() },
    invariants: { count: INVARIANTS.length, ids: INVARIANTS.map((i) => i.id) },
    gapAnalysis: gapCounts(GAPS),
    amendmentNecessaryFor: GAPS.filter((g) => g.amendment.startsWith('YES')).map((g) => `${g.id} ${g.capability}`),
    vectors: { count: VECTORS.length, groups },
    tests: { file: 'test/xdlc-spec.test.mjs', vectorTests: VECTORS.length, propertyAndControlTests: 10, total: VECTORS.length + 10, seededRandomTransactions: 40 * 250 },
    openQuestions: OPEN_QUESTIONS,
    biggestRisk: 'Payment-engine complexity and consensus risk: a second synthetic liquidity source inside BookStep, plus hold-awareness in every funding path.',
    excludedFromConsensus: ['AI scoring', 'market recommendations', 'external price oracles', 'TG Intelligence / Titan Ghost proprietary logic', 'capital allocation decisions'],
    docs: ['docs/XDLC_AMENDMENT_PROPOSAL.md', 'docs/XDLC_PROTOCOL_GAP_ANALYSIS.md', 'docs/XDLC_SECURITY_INVARIANTS.md', 'docs/XDLC_DETERMINISTIC_TESTS.md'],
    referenceModel: { path: 'lib/xdlc-spec/model.mjs', tests: 'test/xdlc-spec.test.mjs', note: 'Executable specification model in JavaScript. Not xrpld code.' },
    verifiedFacts: {
      mainnetFeatures: 'Read-only `feature` via the Titan Forge Mainnet observer (wss://xrplcluster.com), validated ledger 107895208, 2026-10-25 14:35 UTC: AMM, AMMClawback, BatchV1_1, PermissionDelegationV1_1, PermissionedDomains, PermissionedDEX, Credentials, TokenEscrow, PriceOracle enabled; SingleAssetVault, LendingProtocol, Sponsor, DynamicMPT not enabled; no Hooks, Smart Escrow or WASM feature listed.',
      rippledPrecedent: 'XRPLF/rippled develop @ 1f46f75: src/libxrpl/tx/paths/ contains AMMLiquidity.cpp and AMMOffer.cpp; BookStep tries a synthetic AMM offer once per iteration before CLOB offers and skips AMM for permissioned-domain books.',
    },
    researchAccessed: '2026-10-25',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(new URL('lib/xdlc-spec/summary.json', root), JSON.stringify(summary(), null, 2) + '\n');
  splice('docs/XDLC_DETERMINISTIC_TESTS.md', 'XDLC_VECTORS', vectorsTable());
  splice('docs/XDLC_PROTOCOL_GAP_ANALYSIS.md', 'XDLC_GAPS', gapsTable());
  splice('docs/XDLC_SECURITY_INVARIANTS.md', 'XDLC_INVARIANTS', invariantsTable());
  console.log('summary.json + doc tables regenerated');
}
