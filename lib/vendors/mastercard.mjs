// Mastercard Agent Pay / Agent Pay for Machines (AP4M) — DOCUMENTATION_ONLY.
// What is public (checked 2026-10-25; mastercard.com press pages return HTTP 403 to automated fetches, so facts come from
// the June 2026 launch release as indexed + coverage of the 20 Oct 2026 early-access announcement):
//   - AP4M: high-volume, low-value agent/machine payments; credentialing, permissioning, transacting, settling;
//     programmatic spending limits; settlement across cards, accounts and stablecoins.
//   - Early access opened 2026-10-20 (buyer + seller APIs, toolkit, sandbox); still a pilot, not commercially available.
//   - x402-based: merchant replies HTTP 402, agent returns a signed payment voucher; pilot settlement shown on Base / via BVNK.
//   - developer.mastercard.com/mastercard-agent-pay: Sandbox/MTF/Production base URLs; the linked OpenAPI is still a placeholder.
//   - Verifiable Intent (SD-JWT L1->L2->L3) is referenced by t54's XRPL facilitator docs as Mastercard-aligned.
// Nothing here calls Mastercard. No card is charged. No XRPL settlement is implied: Mastercard has not announced XRPL settlement.
import { guardCheck } from '../guardian.mjs';
import { makeAdapter, isSet } from './common.mjs';

export const CREDENTIAL_ENV = ['MASTERCARD_CONSUMER_KEY', 'MASTERCARD_SIGNING_KEY_PATH', 'MASTERCARD_SIGNING_KEY_ALIAS', 'MASTERCARD_SIGNING_KEY_PASSWORD', 'MASTERCARD_ENV'];
export const DEMO_MANDATE = Object.freeze({ id: 'mandate-demo-1', owner: 'Commander (demo)', agent: 'tf-research-agent', perTxMaxUsd: 1, dailyMaxUsd: 5, allowedCategories: ['market-data', 'risk-report'], expires: '2026-10-25T23:59:59Z', revocable: true });

// Spending-policy check: mandate rules evaluated outside the agent, then Guardian (SIMULATION).
export function evaluateIntent(intent, { mandate = DEMO_MANDATE, spentTodayUsd = 0, now = () => Date.now() } = {}) {
  const reasons = [];
  const amt = Number(intent.amountUsd);
  if (!(amt > 0)) reasons.push('Amount must be positive.');
  if (amt > mandate.perTxMaxUsd) reasons.push(`Above per-transaction mandate limit ($${mandate.perTxMaxUsd}).`);
  if (spentTodayUsd + amt > mandate.dailyMaxUsd) reasons.push(`Would exceed daily mandate ($${mandate.dailyMaxUsd}).`);
  if (!mandate.allowedCategories.includes(intent.category)) reasons.push(`Category ${intent.category} not in mandate.`);
  if (intent.agent !== mandate.agent) reasons.push('Agent is not the delegated agent in the mandate.');
  if (now() > Date.parse(mandate.expires)) reasons.push('Mandate expired.');
  const guardian = guardCheck({ mode: 'SIMULATION', amountUsd: amt });
  const allowed = reasons.length === 0 && guardian.allowed;
  return {
    mode: 'SIMULATION', policyAllowed: allowed, mandateReasons: reasons, guardian,
    authorization: { concept: 'Owner-bound authorization (AP4M permissioning / Verifiable Intent L2 delegation).', status: allowed ? 'WOULD_REQUEST_OWNER_APPROVAL' : 'DECLINED_BY_POLICY', ownerApproved: false, executed: false },
  };
}

export function demoIntent(overrides = {}) {
  return { id: 'intent-demo-1', agent: 'tf-research-agent', merchant: 'TG Merchant (Titan Forge data, TA-LON)', resource: 'wake', category: 'market-data', amountUsd: 0.02,
    rail: 'Concept: AP4M voucher over x402 (Mastercard settles on its own rails; no XRPL settlement implied)', ...overrides };
}

export function auditRecord(intent, verdict, at) {
  return { mode: 'SIMULATION', at, intentId: intent.id, agent: intent.agent, merchant: intent.merchant, amountUsd: intent.amountUsd, category: intent.category,
    policyAllowed: verdict.policyAllowed, reasons: [...verdict.mandateReasons, ...verdict.guardian.reasons], ownerApproved: false, executed: false, charged: false,
    label: 'DOCUMENTATION_ONLY demo — no Mastercard API was called, no card or account was charged.' };
}

export function createMastercardAdapter({ env = process.env, samples = null, now = () => Date.now() } = {}) {
  return makeAdapter({
    id: 'mastercard', name: 'Mastercard Agent Pay (AP4M)', env, samples, now,
    docs: ['https://www.mastercard.com/global/en/news-and-trends/press/2026/october/Mastercard-Agent-Pay-for-Machines-in-action.html', 'https://www.mastercard.com/us/en/news-and-trends/press/2026/june/mastercard-launches-agent-pay-for-machines.html', 'https://developer.mastercard.com/mastercard-agent-pay/documentation/api-reference/', 'https://xrpl-x402.t54.ai/docs/verifiable-intent'],
    capability: 'Agent payment intent -> owner mandate / spending policy (Titan Guardian) -> authorization concept -> audit record. Card-network agent payments are complementary to x402 data payments; Mastercard has not announced XRPL settlement and none is implied.',
    credentialEnv: CREDENTIAL_ENV,
    computeStatus: () => 'DOCUMENTATION_ONLY',
    extra: () => ({ credentialsDetected: CREDENTIAL_ENV.slice(0, 2).every((k) => isSet(env, k)), mandate: DEMO_MANDATE,
      publicFacts: ['AP4M launched June 2026; early access with buyer/seller APIs, toolkit and sandbox opened 2026-10-20; still a pilot.', 'x402-based voucher flow; pilot settlement via Base / BVNK (cards, accounts, stablecoins).', 'Developer API reference lists Sandbox/MTF/Production hosts; published OpenAPI is still a placeholder.'],
      note: 'Even with MASTERCARD_* set, this node makes no call until the Commander has early-access approval and a real API spec.' }),
    runProbe: async () => {
      const intent = demoIntent();
      const verdict = evaluateIntent(intent, { now });
      return { ok: true, mode: 'SIMULATION', countsAsVendorTest: false, note: 'Local policy demo. No Mastercard call.', result: { intent, verdict, audit: auditRecord(intent, verdict, new Date(now()).toISOString()) } };
    },
  });
}

export default createMastercardAdapter();
