// Competition demo seed: two clearly FICTIONAL projects with fixed ids. Deterministic (fixed timestamps, no randomness).
//   demo-aurora  stays in XRP/RLUSD incubation (legal review IN_REVIEW; Tier 2 under-matched; Tier 3 declined).
//   demo-beacon  passes the modeled gates and can graduate to a project-token corridor (Testnet demo token BCN, not issued).
export const DEMO_IDS = ['demo-aurora', 'demo-beacon'];
export const PROPRIETARY_BUDGET_USD = 150_000;
export const SEED_AT = '2026-10-20T09:00:00Z';
const REVIEWER = 'Demo reviewer (fictional counsel)';

export const DEMO_INTAKES = {
  'demo-aurora': {
    id: 'demo-aurora', name: 'Aurora Grid Co-op (fictional)', source: 'PROJECT_REQUESTED', fictional: true,
    description: 'FICTIONAL demo project. A community solar co-operative that wants to tokenize metered energy credits for members. Business model still being validated with two pilot sites.',
    token: { network: 'testnet', currency: 'AUR', issuer: 'NOT_YET_ISSUED' },
    regulatoryReview: { status: 'IN_REVIEW', reviewer: REVIEWER, date: '2026-10-21', notes: 'Token classification under review (fictional).' },
    requestedUsd: 400_000, targetOperatingPeriod: { months: 12 }, runwayMonths: 18,
    sustainabilityMeasures: 'Member subscription fees cover operations; no token revenue assumed (fictional).',
    mmEconomics: { targetSpreadBps: 60, minDepthUsd: 15_000, maxInventorySkewPct: 30 },
    desiredMarkets: ['AUR/XRP', 'AUR/RLUSD'],
  },
  'demo-beacon': {
    id: 'demo-beacon', name: 'Beacon Freight Ledger (fictional)', source: 'PROJECT_REQUESTED', fictional: true,
    description: 'FICTIONAL demo project. Freight-invoice settlement network for small carriers; settlement credits would be represented by a Testnet demo token BCN.',
    token: { network: 'testnet', currency: 'BCN', issuer: 'NOT_YET_ISSUED' },
    regulatoryReview: { status: 'COUNSEL_OPINION_RECEIVED', reviewer: REVIEWER, date: '2026-10-18', notes: 'Fictional counsel opinion for the demo.' },
    requestedUsd: 650_000, targetOperatingPeriod: { months: 12 }, runwayMonths: 24,
    sustainabilityMeasures: 'Carrier SaaS revenue covers operating costs; token corridor fees are not required for solvency (fictional).',
    mmEconomics: { targetSpreadBps: 50, minDepthUsd: 25_000, maxInventorySkewPct: 25 },
    desiredMarkets: ['BCN/XRP', 'BCN/RLUSD'],
  },
};

export const DEMO_STACKS = {
  'demo-aurora': {
    targetUsd: 300_000, sources: { T1: 120_000, T2: 120_000, T3: 60_000, PROJECT: 50_000, PROPRIETARY: 50_000 },
    terms: { T2: { termDays: 180, earlyExit: { noticeDays: 30, penaltyBps: 75 } }, T3: { underwriting: 'DECLINED', aprBps: 1100, termMonths: 12, creditRisk: 'ELEVATED', partner: 'Authorized lending partner (fictional, demo)', note: 'Declined: insufficient operating history (fictional).' } },
    states: { T1: { MATCHED: 95_000, COMMITTED: 95_000, FUNDED: 80_000, EXECUTABLE: 80_000 }, T2: { MATCHED: 70_000, COMMITTED: 70_000, FUNDED: 70_000, EXECUTABLE: 60_000 },
      PROJECT: { MATCHED: 50_000, COMMITTED: 50_000, FUNDED: 50_000, EXECUTABLE: 50_000 } },
  },
  'demo-beacon': {
    targetUsd: 500_000, sources: { T1: 150_000, T2: 250_000, T3: 100_000, PROJECT: 120_000, PROPRIETARY: 150_000 },
    terms: { T2: { termDays: 180, earlyExit: { noticeDays: 30, penaltyBps: 75 } }, T3: { underwriting: 'APPROVED', disbursed: true, loanAgreementRef: 'DEMO-BCN-LOAN-01 (fictional)', aprBps: 900, termMonths: 12, creditRisk: 'MODERATE', partner: 'Authorized lending partner (fictional, demo)' } },
    states: { T1: { MATCHED: 150_000, COMMITTED: 150_000, FUNDED: 150_000, EXECUTABLE: 150_000 }, T2: { MATCHED: 250_000, COMMITTED: 250_000, FUNDED: 250_000, EXECUTABLE: 250_000 },
      T3: { MATCHED: 100_000, COMMITTED: 100_000, FUNDED: 100_000, EXECUTABLE: 100_000 }, PROJECT: { MATCHED: 120_000, COMMITTED: 120_000, FUNDED: 120_000, EXECUTABLE: 120_000 } },
  },
};

const doc = (status, ref, date) => ({ status, docRef: ref, reviewer: REVIEWER, date });
export const DEMO_GATES = {
  'demo-aurora': {
    legalItems: { token_offering_analysis: { status: 'OPEN', note: 'Counsel analysis in progress (fictional).' }, permitted_market_participants: { status: 'OPEN' },
      issuer_trading_requirements: doc('PASS', 'DEMO-AUR-L3 (fictional)', '2026-10-21'), approval_documentation: { status: 'OPEN' } },
    demand: { verifiedEvidence: [{ ref: 'DEMO-AUR-D1 (fictional)', description: 'Pilot-site member waitlist (fictional)' }], independentParticipants: 9 },
    interimDays: 30,
  },
  'demo-beacon': {
    legalItems: { token_offering_analysis: doc('PASS', 'DEMO-BCN-L1 (fictional)', '2026-10-18'), permitted_market_participants: doc('PASS', 'DEMO-BCN-L2 (fictional)', '2026-10-18'),
      issuer_trading_requirements: doc('PASS', 'DEMO-BCN-L3 (fictional)', '2026-10-18'), approval_documentation: doc('PASS', 'DEMO-BCN-L4 (fictional)', '2026-10-18') },
    demand: { verifiedEvidence: [{ ref: 'DEMO-BCN-D1 (fictional)', description: 'Signed carrier LOIs (fictional)' }, { ref: 'DEMO-BCN-D2 (fictional)', description: 'Invoice volume audit (fictional)' }, { ref: 'DEMO-BCN-D3 (fictional)', description: 'Pilot settlement logs (fictional)' }], independentParticipants: 22 },
    interimDays: 45,
  },
};
