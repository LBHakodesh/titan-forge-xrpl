// TGAN advisor profiles. Every advisor here is FICTIONAL (demo firm, demo representative). Nothing in TGAN claims
// that GYW1313, Titan Ghost or any advisor is a registered investment adviser or broker-dealer.
// Registration status is UNVERIFIED unless an operator records a verification reference (e.g. an SEC IAPD / CRD
// lookup with date and reviewer). Even then TGAN only shows that an operator recorded it; it does not verify.

export const FICTIONAL_NOTE = 'Fictional demo advisor for a hackathon demonstration. Not a real firm or person; no advisory relationship exists.';
export const UNVERIFIED_LABEL = 'UNVERIFIED — no registration verification recorded. Must not be presented as a registered adviser.';

export const SEED_ADVISORS = [
  {
    id: 'adv-demo-a', firm: 'Demo Advisory Firm A', representative: 'Demo Representative A-1',
    jurisdictions: ['Demo Jurisdiction 1 (fictional)'],
    serviceScope: ['XRP/RLUSD incubation strategy recommendations', 'Portfolio governance review', 'Performance reporting review'],
    agreement: { reference: 'DEMO-AGR-A-001', date: '2026-10-01', feeBasisType: 'PERFORMANCE_NET_GAIN (hypothetical)', signed: true },
    conflicts: [{ id: 'coi-a-1', type: 'Relationship to Titan Ghost market making', description: 'Demo firm A is modeled as receiving market data from Titan Ghost market-making infrastructure.', disclosed: true, disclosedAt: '2026-10-01' }],
  },
  {
    id: 'adv-demo-b', firm: 'Demo Advisory Firm B', representative: 'Demo Representative B-1',
    jurisdictions: ['Demo Jurisdiction 2 (fictional)'],
    serviceScope: ['XRP/RLUSD incubation strategy recommendations'],
    agreement: { reference: 'DEMO-AGR-B-001', date: '2026-10-10', feeBasisType: 'FLAT_RETAINER (hypothetical)', signed: false },
    conflicts: [],
  },
  {
    id: 'adv-demo-c', firm: 'Demo Advisory Firm C', representative: 'Demo Representative C-1',
    jurisdictions: ['Demo Jurisdiction 1 (fictional)', 'Demo Jurisdiction 3 (fictional)'],
    serviceScope: ['XRP/RLUSD incubation strategy recommendations', 'XDLC opportunity evaluation (proposed amendment; not live)'],
    agreement: { reference: 'DEMO-AGR-C-001', date: '2026-10-05', feeBasisType: 'PERFORMANCE_NET_GAIN (hypothetical)', signed: true },
    conflicts: [{ id: 'coi-c-1', type: 'Relationship to Titan Ghost market making', description: 'Demo firm C is modeled as an affiliate of a Titan Ghost liquidity provider.', disclosed: false }],
  },
];

// verification: operator record or undefined.
export function verificationView(v) {
  if (v && v.reference && v.source && v.checkedAt && v.reviewer) {
    return { status: 'VERIFIED', ...v, label: `VERIFIED (operator-recorded): ${v.source} reference ${v.reference}, checked ${v.checkedAt} by ${v.reviewer}. TGAN does not itself verify registration.` };
  }
  return { status: 'UNVERIFIED', label: UNVERIFIED_LABEL };
}

export function validateVerification(b = {}) {
  const errors = [];
  for (const k of ['reference', 'source', 'checkedAt', 'reviewer']) if (typeof b[k] !== 'string' || !b[k].trim()) errors.push(`${k} is required (e.g. source "SEC IAPD" or "CRD lookup", reference, checkedAt date, reviewer).`);
  if (b.checkedAt && !/^\d{4}-\d{2}-\d{2}/.test(b.checkedAt)) errors.push('checkedAt must be a date (YYYY-MM-DD).');
  const clip = (s) => String(s).trim().slice(0, 120);
  return { ok: !errors.length, errors, value: errors.length ? null : { reference: clip(b.reference), source: clip(b.source), checkedAt: clip(b.checkedAt), reviewer: clip(b.reviewer), note: b.note ? clip(b.note) : undefined } };
}

export function advisorView(a, verification) {
  const ver = verificationView(verification);
  return {
    ...a, fictional: true, fictionalNote: FICTIONAL_NOTE, hypothetical: true, mode: 'SIMULATION',
    verification: ver, verified: ver.status === 'VERIFIED',
    undisclosedConflicts: a.conflicts.filter((c) => !c.disclosed).length,
    agreement: { ...a.agreement, label: `${a.agreement.signed ? 'Signed' : 'NOT signed'} (hypothetical demo agreement record)` },
  };
}
