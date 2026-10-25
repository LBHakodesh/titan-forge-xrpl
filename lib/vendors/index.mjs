// Vendor registry + TG Merchant agentic-finance flow + Sentinel signals.
// Nothing in lib/vendors executes a payment, signs, submits, or charges a card.
import { SampleStore, safeMessage } from './common.mjs';
import { createXrplAdapter } from './xrpl.mjs';
import { createQuicknodeAdapter } from './quicknode.mjs';
import { createLedgerAdapter, buildReviewTx, buildCommitmentTx, isNonExecutableReview } from './ledger.mjs';
import { createT54Adapter, localChallenge, recordedReceipt } from './t54.mjs';
import { createAgentcoreAdapter, loadManifest, otelSpanFor } from './agentcore.mjs';
import { createMastercardAdapter, demoIntent, evaluateIntent, auditRecord, DEMO_MANDATE } from './mastercard.mjs';

export const VENDOR_IDS = ['xrpl', 'quicknode', 'ledger', 't54', 'agentcore', 'mastercard'];

// Where each vendor acts in the Titan Ghost liquidity loop (single source for the UI strip and the matrix doc).
// inLoop:false = documented elsewhere, deliberately not part of the liquidity flow.
export const LIQUIDITY_LOOP = Object.freeze([
  { vendor: 'xrpl', step: 'make / route', inLoop: true, where: 'Titan Ghost maker offers and Pathfinder routing on XRPL Testnet; Mainnet read-only observation', tabs: ['theater', 'pathfinder'] },
  { vendor: 'quicknode', step: 'observe fills', inLoop: true, where: 'Theater fill observation and Sentinel ledger freshness prefer QuickNode when QUICKNODE_XRPL_WSS is set; Streams filter template for maker/router accounts (not deployed)', tabs: ['theater', 'sentinel'] },
  { vendor: 'ledger', step: 'self-custody funding', inLoop: true, where: 'TGLB Bootstrap Tier 1 / Tier 2: commit from your own wallet (unsigned, expired Testnet OfferCreate reviewed on device)', tabs: ['incubator'] },
  { vendor: 't54', step: 'paid data', inLoop: true, where: 'TG Merchant: drop-in x402 facilitator option next to TG Merchant\'s own (discovery via /supported only)', tabs: ['merchant'] },
  { vendor: 'agentcore', step: 'agent tools / observability', inLoop: true, where: 'TG Intelligence / Sentinel read-only tools (radar, coverage, corridor, theater state) for an AgentCore Gateway; OTEL span mapping', tabs: ['sentinel', 'xdlc-app'] },
  { vendor: 'mastercard', step: 'agentic commerce (docs only)', inLoop: false, where: 'TG Merchant only: payment-intent concept, DOCUMENTATION_ONLY. Not part of the liquidity flow', tabs: ['merchant'] },
]);
export const liquidityLoop = (vendors) => {
  const status = Object.fromEntries(vendors.list().map((v) => [v.id, { status: v.status, name: v.name }]));
  return LIQUIDITY_LOOP.map((x) => ({ ...x, tabs: [...x.tabs], name: status[x.vendor]?.name, status: status[x.vendor]?.status }));
};

export function createVendors(deps = {}) {
  const { env = process.env, samplesFile = null, now = () => Date.now() } = deps;
  const samples = deps.samples || new SampleStore(samplesFile);
  const common = { env, samples, now, offline: !!deps.offline };
  const adapters = {
    xrpl: createXrplAdapter({ ...common, observer: deps.observer, ledger: deps.ledger, ledgerReady: deps.ledgerReady || (() => false), store: deps.store, x402RunsFile: deps.x402RunsFile }),
    quicknode: createQuicknodeAdapter({ ...common, fetchFn: deps.fetchFn, observer: deps.observerAt }),
    ledger: createLedgerAdapter({ ...common, fetchFn: deps.fetchFn }),
    t54: createT54Adapter({ ...common, fetchFn: deps.fetchFn, x402RunsFile: deps.x402RunsFile }),
    agentcore: createAgentcoreAdapter({ env, samples, now, routeExists: deps.routeExists }),
    mastercard: createMastercardAdapter({ env, samples, now }),
  };
  return { adapters, samples, list: () => VENDOR_IDS.map((id) => adapters[id].view()), get: (id) => adapters[id] || null };
}

// Vendor failures/errors as Sentinel signals (same shape as /api/incubator/sentinel-signals).
export function sentinelSignals(vendors, now = () => Date.now()) {
  const out = [];
  for (const v of vendors.list()) {
    const sig = (key, severity, title, evidence, remediation) => out.push({ key: `vendors:${v.id}:${key}`, title, severity, category: 'vendor-integration', product: 'TG Merchant', market: v.id,
      verification: 'OBSERVED', provenance: 'OBSERVED', evidence, remediation, observedAt: now() });
    if (v.status === 'ERROR') sig('probe_failed', 'medium', `${v.name}: last read-only probe failed`, [{ label: 'error', value: v.lastProbe?.error || v.telemetry.lastError?.message || 'unknown' }, { label: 'at', value: v.lastProbe?.at || '—' }], 'Check connectivity/credentials; the app falls back to recorded or public data.');
    if (v.telemetry.calls >= 3 && v.telemetry.errors / v.telemetry.calls >= 0.5) sig('error_rate', 'low', `${v.name}: ${v.telemetry.errors}/${v.telemetry.calls} vendor calls failed`, [{ label: 'errors', value: String(v.telemetry.errors) }], 'Investigate vendor availability before the demo.');
    if (v.telemetry.latencyMs?.p95 > 8000) sig('slow', 'info', `${v.name}: p95 latency ${v.telemetry.latencyMs.p95} ms`, [{ label: 'p95', value: `${v.telemetry.latencyMs.p95} ms` }], 'Prefer recorded samples on stage if the venue network is slow.');
  }
  return { mode: 'SIMULATION', signals: out, note: 'Vendor integration health for the Sentinel findings registry. Read-only; nothing here records findings itself.' };
}

// TG Merchant — Agentic Finance: one flow tying x402 + Mastercard intent + Guardian + AgentCore. Never pays.
export async function merchantFlow({ vendors, baseUrl = null, fetchFn, x402RunsFile = null, now = () => Date.now() }) {
  let challenge = null;
  if (baseUrl) { try { challenge = await localChallenge({ baseUrl, fetchFn }); } catch (e) { challenge = { mode: 'UNAVAILABLE', error: safeMessage(e) }; } }
  const accept = challenge?.body?.accepts?.[0] || challenge?.paymentRequiredHeader?.accepts?.[0] || null;
  const xrpUsd = Number(process.env.TF_ACCESS_XRP_USD) || 0.5;
  const amountUsd = accept ? Math.round((Number(accept.amount) / 1e6) * xrpUsd * 10_000) / 10_000 : 0.025;
  const intent = demoIntent({ amountUsd, resource: 'wake', rail: accept ? `x402 exact on ${accept.network} (Testnet XRP, ${accept.amount} drops) via TG Merchant local facilitator` : 'x402 (challenge unavailable)' });
  const verdict = evaluateIntent(intent, { now });
  const at = new Date(now()).toISOString();
  const tools = loadManifest().tools.map((t) => t.name);
  // Facilitator options: TG Merchant's own local facilitator (GET /api/x402/supported on this node) next to t54's
  // public /supported (from its last real read-only probe or verified sample). No /verify or /settle is ever called.
  let own = null;
  if (baseUrl) {
    try { const r = await (fetchFn || globalThis.fetch)(`${baseUrl}/api/x402/supported`, { method: 'GET', headers: { accept: 'application/json' } }); own = r.ok ? await r.json() : { error: `HTTP ${r.status}` }; }
    catch (e) { own = { error: safeMessage(e) }; }
  }
  const t54 = vendors.get('t54');
  const t54View = t54?.view?.() || {};
  const t54Res = t54View.sample?.result ? { result: t54View.sample.result, at: t54View.sample.capturedAt, from: t54View.lastProbe?.ok ? 'live read-only probe in this server process' : 'verified sample from an earlier real read-only probe' } : null;
  const kinds = (k) => (Array.isArray(k) ? k.map((x) => ({ x402Version: x.x402Version, scheme: x.scheme, network: x.network })) : []);
  const facilitators = {
    calls: 'GET /supported only. No /verify, no /settle, no payment.',
    tgMerchant: { name: 'TG Merchant local facilitator (ours)', role: 'in use (settlement only with per-payment owner approval)', mode: own && !own.error ? 'SIMULATION' : 'UNAVAILABLE', endpoint: 'GET /api/x402/supported', kinds: kinds(own?.kinds), extensions: own?.extensions || [], note: own?.note || own?.error || null },
    t54: { name: 't54 XRPL x402 facilitator (Testnet)', role: 'drop-in option (not in the settlement path)', mode: t54Res ? 'LIVE_TESTNET' : 'UNAVAILABLE', vendorStatus: t54View.status || null, endpoint: 'GET https://xrpl-facilitator-testnet.t54.ai/supported',
      kinds: kinds(t54Res?.result?.kinds), extensions: t54Res?.result?.extensions || [], compatible: t54Res?.result?.compatibleWithTgMerchant || null, at: t54Res?.at || null, from: t54Res?.from || 'not probed yet (POST /api/vendors/t54/probe, localhost)' },
  };
  const status = Object.fromEntries(vendors.list().map((v) => [v.id, v.status]));
  return {
    title: 'TG Merchant — Agentic Finance', at, paymentExecuted: false, facilitators,
    banner: 'No payment executes in this flow. Live x402 payments need the Commander\'s explicit per-payment approval, given outside the agent.',
    steps: [
      { n: 1, id: 'discover', title: 'Agent discovers Titan Forge tools', vendor: 'agentcore', vendorStatus: status.agentcore, mode: 'DOCUMENTATION_ONLY', detail: { tools, note: 'MCP tool manifest for AgentCore Gateway (read-only tools only). Not deployed.' } },
      { n: 2, id: 'challenge', title: 'Agent requests paid data → real HTTP 402 challenge', vendor: 't54', vendorStatus: status.t54, mode: challenge?.mode || 'UNAVAILABLE', detail: challenge || { note: 'Challenge not fetched (no loopback base URL).' } },
      { n: 3, id: 'intent', title: 'Agent forms a payment intent', vendor: 'mastercard', vendorStatus: status.mastercard, mode: 'DOCUMENTATION_ONLY', detail: { intent, conceptNote: 'AP4M / Verifiable Intent concept: L1 issuer credential, L2 owner delegation (mandate), L3 agent action bound to invoiceId.' } },
      { n: 4, id: 'policy', title: 'Spending policy: owner mandate + Titan Guardian', vendor: 'guardian', mode: 'SIMULATION', detail: { mandate: DEMO_MANDATE, verdict } },
      { n: 5, id: 'approval', title: 'Owner approval gate (outside the agent)', vendor: 'ledger', vendorStatus: status.ledger, mode: 'SANDBOX_ONLY', detail: { required: true, given: false, how: 'Owner signs on a Ledger device (WebHID) or approves per payment; the agent can only propose. A caller-supplied approval:true is not proof of human approval.' } },
      { n: 6, id: 'settlement', title: 'Settlement (not executed) — last recorded receipt', vendor: 'xrpl', vendorStatus: status.xrpl, mode: 'REPLAY', detail: x402RunsFile ? recordedReceipt(x402RunsFile) : null },
      { n: 7, id: 'audit', title: 'Audit record + Sentinel reconciliation', vendor: 'agentcore', mode: 'SIMULATION', detail: { audit: auditRecord(intent, verdict, at), otelSpan: otelSpanFor({ type: 'merchant.intent_evaluated', mode: 'SIMULATION', at, resource: 'wake', status: verdict.policyAllowed ? 'allowed' : 'declined' }), sentinelRule: 'Any settlement without a matching owner-approval record becomes a High finding.' } },
    ],
  };
}

export { buildReviewTx, buildCommitmentTx, isNonExecutableReview };
