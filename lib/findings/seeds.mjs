// Known findings that have no machine-readable source on this node, plus narrative context for findings that
// collectors derive from real data. Nothing here invents evidence: items without on-node evidence say so and are
// labeled UNVERIFIED_EXTERNAL / INFORMATIONAL with provenance UNAVAILABLE.

export const X402_DOC = 'docs/HACKATHON_AGENTIC_PAYMENT_SECURITY.md';

// Narrative attached by the x402 collector when it sees this exact Testnet settlement in data/x402-runs.json.
export const X402_KNOWN = {
  '63DA627435F660DF27BA4EFB22A7D1D612CFEECDC7D94BD644D5EC9DBA358270': {
    initiator: 'An interactive Claude Code development session (one POST /api/x402/live/purchase at about 00:10:53 UTC)',
    approvalClaim: 'Request body carried "approval": true, written by the AI session itself',
    ownerApproval: 'None found. The Commander approved building the x402 demo, not this payment.',
    recurrence: 'One-time. No scheduler, retry queue or agent loop triggers live payments; a 45-minute read-only watch found no repeat.',
    submittedUtc: '2026-10-24T00:11:02Z',
  },
};

export const X402_REMEDIATION = {
  status: 'proposed, not implemented',
  summary: 'Separate payment capability from spending authority. The agent may only propose a payment; a human-held signer or an exact-scope, single-use approval record (network, payer, payee, asset, amount, endpoint, invoice, expiry, approver identity) must exist before settlement. Sentinel reconciles every settlement against an approval record and raises a High finding when none exists.',
  steps: [
    'Independent signing (Guardian): signing key held by a signer the agent cannot reach (hardware/mobile wallet via QR or deep link, or a separate operator service).',
    'Exact-scope approval (Authority): single-use approval bound to network, payer, payee, asset, amount, endpoint, invoice and expiry, recorded with approver identity.',
    'Bounded mandates: optional owner-issued spending mandates enforced outside the agent and revocable at any time.',
    'Independent observation (Sentinel): reconcile every settlement against an approval record (this collector already flags settlements that have none).',
  ],
  reference: X402_DOC,
};

export const STATIC_SEEDS = [
  {
    key: 'external:bc-07:historical-fill-misclassification',
    title: 'BC-07: historical fill misclassification (reported from another node, not reproduced on London)',
    category: 'data-integrity', product: 'Titan Ghost / reconciliation', market: 'unknown (as reported)',
    severity: 'high', severityBasis: 'as-reported', verification: 'UNVERIFIED_EXTERNAL', provenance: 'UNAVAILABLE',
    source: 'operator-report', environment: 'other node (not London)', occurrence: 'operator-chat-report',
    observed: 'Reported in operator chat from another node: historical fills were misclassified. No records, transaction hashes, run ids or files for BC-07 exist on the London node.',
    expected: 'Each historical fill classified correctly (e.g. maker/taker, organic/demo, own-account vs third-party) and reproducible from ledger data.',
    actual: 'Unknown on London. Evidence not present on London; the claim cannot be reproduced or refuted here.',
    facets: [
      { facet: 'occurrence', verification: 'UNVERIFIED_EXTERNAL', detail: 'Reported only; evidence not present on London.' },
      { facet: 'reproduction', verification: 'UNVERIFIED_EXTERNAL', detail: 'Not reproduced on this node. Never present it as reproduced here.' },
    ],
    confidence: 'low (single verbal report, no artifacts on this node)',
    impact: 'If true, fill-based metrics (demand proof, maker capture, P&L attribution) on the reporting node could be wrong. London figures are not known to be affected.',
    remediation: { status: 'proposed', summary: 'Obtain the BC-07 evidence bundle (tx hashes, ledger range, classifier version) from the reporting node and re-run classification against validated ledger data before acting.', steps: ['Request artifacts from the reporting node owner.', 'Re-derive classification from tx metadata (AffectedNodes) with a pinned classifier version.', 'Only then upgrade verification.'] },
    evidence: [], evidenceNote: 'Evidence not present on London. Reported in operator chat from another node.',
    educational: { title: 'Why an unverified finding is still registered', lesson: 'A serious report is worth tracking even before it can be proven, but it must never be shown as confirmed or reproduced. The badge says exactly what we know: someone reported it; this node has no evidence.' },
  },
  {
    key: 'limitation:mainnet-aum-near-zero',
    title: 'Near-zero Mainnet AUM limits performance measurement',
    category: 'measurement-limit', product: 'Titan Ghost / performance', market: 'XRPL Mainnet',
    severity: 'info', verification: 'INFORMATIONAL', provenance: 'UNAVAILABLE',
    source: 'operator-directive', environment: 'XRPL Mainnet (not connected for AUM on this node)', occurrence: 'directive-2026-10-24',
    observed: 'Reported limitation: assets under management on Mainnet are near zero, so live performance (returns, capture, drawdown) cannot be measured with statistical meaning.',
    expected: 'Enough live capital and history to measure strategy performance.', actual: 'Not measured on this node; no Mainnet AUM feed exists here.',
    confidence: 'stated limitation', impact: 'Any performance number shown during the demo is Testnet, replay or simulation, never Mainnet track record.',
    remediation: { status: 'proposed', summary: 'Keep performance claims labeled by mode; do not extrapolate Testnet or simulation to Mainnet returns.' },
    evidence: [], evidenceNote: 'Reported limitation; no on-node AUM data.',
  },
  {
    key: 'limitation:lending-vault-unavailable',
    title: 'Lending-vault capability unavailable on the target network',
    category: 'capability-limit', product: 'TGLB (Tier 3 lending vault)', market: '—',
    severity: 'info', verification: 'INFORMATIONAL', provenance: 'UNAVAILABLE',
    source: 'operator-directive', environment: 'target network', occurrence: 'directive-2026-10-24',
    observed: 'Reported limitation: the lending-vault capability that the TGLB Tier 3 underwritten path would rely on is not available on the target network.',
    expected: 'Vault/lending primitives available where Tier 3 would run.', actual: 'Reported unavailable. This node has not tested it.',
    confidence: 'stated limitation', impact: 'Tier 3 lending-vault flows can only be described, not demonstrated live.',
    remediation: { status: 'proposed', summary: 'Present Tier 3 as design only until the capability is available and tested.' },
    evidence: [], evidenceNote: 'Reported limitation; not tested on this node.',
  },
  {
    key: 'code-review:x402:client-asserted-participant-id',
    title: 'x402 data route trusts a client-supplied participant id',
    category: 'access-control', product: 'Titan Merchant / x402 + Access', market: 'n/a',
    severity: 'medium', verification: 'SUSPECTED', provenance: 'UNAVAILABLE',
    source: 'code-review', environment: 'London staging (127.0.0.1 only)', occurrence: 'code-review-2026-10-24',
    observed: 'GET /api/x402/data/:id takes the participant identity from ?participant= or the x-participant-id header with no authentication.',
    expected: 'Free-threshold entitlements apply only to an authenticated participant.',
    actual: 'Any caller can name another registered participant and may receive that participant\'s free access. Not exploited or reproduced; found by reading the code.',
    confidence: 'medium (code path read, not exercised)',
    impact: 'Staging is bound to 127.0.0.1, so exposure is local only. Before any public deployment, a caller could use another participant\'s free allowance instead of paying via x402.',
    remediation: { status: 'proposed, not implemented', summary: 'Bind participant identity to an authenticated session or a signed wallet challenge before the entitlement check. No change made tonight (x402 frozen as built).' },
    evidence: [{ kind: 'code', ref: 'lib/routes/90-x402.mjs:24', detail: 'pid() reads ?participant or x-participant-id' }, { kind: 'code', ref: 'lib/routes/90-x402.mjs:33', detail: 'pid() result passed to svc.premium as participantId' }],
    evidenceNote: 'Code reference only; no runtime evidence.',
  },
];
