// TGAN revenue reporting: three SEPARATE streams. Nothing is billed or collected by any of them in this demo.
//  1. Infrastructure subscriptions — TGLW core use is free up to the Access module's common threshold (read from the
//     Access module's public policy, never duplicated here); optional capacity plans above it are demo settings.
//  2. Optional paid data (x402) — link only; TGAN does not call or modify x402.
//  3. Potential regulated advisory compensation — HYPOTHETICAL and gated by fee eligibility (NOT ENABLED by default).

export function buildRevenue({ accessPolicy = null, accessError = null, hypotheticalFees = [], eligibility }) {
  const hypo = hypotheticalFees.reduce((s, f) => s + (f.totalHypotheticalFeeUsd || 0), 0);
  return {
    mode: 'SIMULATION', hypothetical: true,
    note: 'Three separate streams, never netted together. No billing provider is connected; collected revenue is $0 in every stream.',
    streams: [
      {
        id: 'infrastructure', title: 'Infrastructure subscriptions', mode: 'SIMULATION', collectedUsd: 0,
        source: 'Access & Free Threshold module (GET /api/access/policy)',
        thresholdUsd: accessPolicy?.thresholdUsd ?? null, thresholdLabel: accessPolicy?.thresholdLabel ?? null, rule: accessPolicy?.rule ?? null,
        plans: (accessPolicy?.plans || []).map((p) => ({ id: p.id, label: p.label ?? p.name ?? p.id, monthlyUsdDemo: p.monthlyUsdDemo ?? null, capacityUsd: p.capacityUsd ?? null, demo: true })),
        error: accessError,
        status: 'Demo plans only: free TGLW core use up to the common threshold for every participant category; no billing.',
        link: { tab: 'access', api: '/api/access/policy' },
      },
      {
        id: 'data', title: 'Optional paid data (x402)', mode: 'SIMULATION', collectedUsd: 0,
        status: 'Optional, per-request data purchases are handled by the x402 module (frozen as built). TGAN links only.',
        link: { tab: 'x402', api: '/api/x402/catalog' },
      },
      {
        id: 'advisory', title: 'Potential regulated advisory compensation', mode: 'SIMULATION', hypothetical: true, collectedUsd: 0,
        hypotheticalUsd: Math.round(hypo * 100) / 100, eligibility,
        status: `HYPOTHETICAL. ${eligibility?.label}`,
        basis: 'Performance fees on net investment gain above a high-water mark only (never volume, contributions or RLUSD<->XRP conversion).',
        link: { tab: 'tgan', api: '/api/tgan/fee-calculator' },
      },
    ],
  };
}
