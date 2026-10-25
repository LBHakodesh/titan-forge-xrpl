// t54 / XRPL x402 adapter + TG Merchant x402 showcase.
// Docs verified 2026-10-25:
//   docs.t54.ai/docs/xrpl/overview — "Public facilitator for x402 payments over XRPL using presigned XRPL Payment transactions" (xrpl-x402.t54.ai)
//   xrpl-x402.t54.ai/docs/quickstart — hosted testnet XRPL_FACILITATOR_URL=https://xrpl-facilitator-testnet.t54.ai (xrpl:1),
//     hosted mainnet https://xrpl-facilitator-mainnet.t54.ai (xrpl:0); packages x402-xrpl (pip / npm)
//   xrpl-x402.t54.ai/docs/xrpl-scheme — exact scheme, CAIP-2 xrpl:0/1/2, PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE
//   xrpl-x402.t54.ai/docs/verifiable-intent — optional Mastercard-aligned Verifiable Intent (SD-JWT L1->L2->L3)
//   github.com/t54-labs/x402-xrpl returned 404 on 2026-10-25 (moved or private); org repos include x402-secure, monid-x402-xrpl.
// This adapter only ever calls GET /supported on the TESTNET facilitator (public, read-only discovery).
// It never calls /verify or /settle, never contacts the Mainnet facilitator, and never sends a payment.
// TG Merchant x402 (lib/x402, frozen) uses its own local facilitator; t54 is not in its settlement path.
import fs from 'node:fs';
import { makeAdapter, probedStatus, withTimeout } from './common.mjs';

export const T54_TESTNET_SUPPORTED = 'https://xrpl-facilitator-testnet.t54.ai/supported';
export const T54_MAINNET_FACILITATOR_DOC_ONLY = 'https://xrpl-facilitator-mainnet.t54.ai';

const b64json = (s) => { try { return JSON.parse(Buffer.from(String(s), 'base64').toString('utf8')); } catch { return null; } };

// GET a paid TG Merchant route WITHOUT any payment header -> the real 402 challenge. Never sends PAYMENT-SIGNATURE.
export async function localChallenge({ baseUrl, fetchFn = (...a) => globalThis.fetch(...a), resource = 'wake', timeoutMs = 10_000 }) {
  const url = `${baseUrl}/api/x402/data/${encodeURIComponent(resource)}`;
  const r = await withTimeout(fetchFn(url, { method: 'GET', headers: { accept: 'application/json' } }), timeoutMs, 'x402 challenge');
  const body = await r.json().catch(() => ({}));
  const header = r.headers?.get?.('payment-required') || null;
  return { mode: 'SIMULATION', request: `GET /api/x402/data/${resource} (no PAYMENT-SIGNATURE header)`, httpStatus: r.status, paymentRequiredHeader: header ? b64json(header) : null,
    body: r.status === 402 ? { x402: body.x402, entitlement: body.entitlement, accepts: body.paymentRequired?.accepts } : { error: body.error || null, reason: body.reason || null },
    paid: false, note: r.status === 402 ? 'Real 402 challenge from this node. No payment was attempted; the invoice expires unused.' : 'No 402 issued (see reason).' };
}

export function recordedReceipt(x402RunsFile) {
  try {
    const runs = JSON.parse(fs.readFileSync(x402RunsFile, 'utf8'));
    const r = runs.filter((x) => x.mode === 'LIVE_TESTNET' && x.result?.evidence?.transaction).slice(-1)[0];
    if (!r) return null;
    return { mode: 'REPLAY', runId: r.id, at: r.at, resource: r.resource, steps: (r.steps || []).map((s) => ({ step: s.step, ok: s.ok, at: s.at })),
      challenge: r.challenge?.accepts?.[0] ? { scheme: r.challenge.accepts[0].scheme, network: r.challenge.accepts[0].network, amountDrops: r.challenge.accepts[0].amount, asset: r.challenge.accepts[0].asset, invoiceId: r.challenge.accepts[0].extra?.invoiceId } : null,
      settlement: { transaction: r.result.evidence.transaction, explorer: r.result.evidence.explorer, kind: r.result.evidence.kind },
      authorization: 'SETTLED BUT NOT AUTHORIZED: initiated by an AI development session that set approval:true itself; no owner approval was found. See docs/HACKATHON_AGENTIC_PAYMENT_SECURITY.md.' };
  } catch { return null; }
}

export function createT54Adapter({ env = process.env, samples = null, now = () => Date.now(), fetchFn = (...a) => globalThis.fetch(...a), offline = false, x402RunsFile = null, timeoutMs = 10_000 } = {}) {
  return makeAdapter({
    id: 't54', name: 't54 XRPL x402 facilitator', env, samples, now,
    docs: ['https://docs.t54.ai/docs/xrpl/overview', 'https://xrpl-x402.t54.ai/docs/quickstart', 'https://xrpl-x402.t54.ai/docs/xrpl-scheme', 'https://xrpl-x402.t54.ai/docs/verifiable-intent', 'https://github.com/t54-labs/x402-xrpl'],
    capability: 'Hosted x402 facilitator for XRPL (exact scheme: verifies and submits payer-presigned Payment blobs; testnet + mainnet hosts). TG Merchant x402 already speaks the same v2 wire format with its own local facilitator; t54 is a drop-in option, not used for settlement here.',
    credentialEnv: [],
    computeStatus: (s) => probedStatus(s, 'DOCUMENTATION_ONLY'),
    extra: () => ({ probeEndpoint: `GET ${T54_TESTNET_SUPPORTED}`, mainnetFacilitator: { url: T54_MAINNET_FACILITATOR_DOC_ONLY, used: false, note: 'Documentation only. Never contacted by this node.' },
      settlementPath: 'Not used. TG Merchant settles (when the Commander approves a payment) through its own local facilitator on Testnet.', recordedReceipt: x402RunsFile ? recordedReceipt(x402RunsFile) : null }),
    runProbe: async () => {
      if (offline) return { ok: false, error: 'Offline replay mode: no network.', countAsError: false };
      const r = await withTimeout(fetchFn(T54_TESTNET_SUPPORTED, { method: 'GET', headers: { accept: 'application/json' } }), timeoutMs, 't54 /supported');
      if (!r.ok) return { ok: false, error: `t54 /supported HTTP ${r.status}` };
      const j = await r.json();
      const kinds = Array.isArray(j.kinds) ? j.kinds.map((k) => ({ x402Version: k.x402Version, scheme: k.scheme, network: k.network })) : [];
      const exactTestnet = kinds.some((k) => k.scheme === 'exact' && k.network === 'xrpl:1' && k.x402Version === 2);
      const result = { kinds, extensions: Array.isArray(j.extensions) ? j.extensions : [], exactTestnetSupported: exactTestnet, compatibleWithTgMerchant: exactTestnet ? 'Yes: x402 v2, exact, xrpl:1 — same wire format as lib/x402.' : 'No exact/xrpl:1 kind reported.' };
      return { ok: true, mode: 'LIVE_TESTNET', result, sample: { mode: 'LIVE_TESTNET', source: T54_TESTNET_SUPPORTED, probe: 'GET /supported (public discovery, no payment)', result } };
    },
  });
}

export default createT54Adapter();
