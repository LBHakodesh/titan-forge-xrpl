// x402 Payments & Data service (TA-LON demo). Orchestrates:
//   REQUEST -> 402 -> REQUIREMENTS -> AUTHORIZATION -> VERIFICATION -> SETTLEMENT -> DELIVERY
// Access: checkAccess() (lib/entitlement) decides; only decision 'x402' leads to a payment challenge.
// Basic liquidity participation is never behind x402 — this is an optional data service.
// x402 here is payment/entitlement only, never trading authority (master spec §U); production entitlement authority
// lives on the COMMAND/C2 node, which this node does not reach.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Wallet } from 'xrpl';
import * as entitlement from '../entitlement/index.mjs';
const defaultCheckAccess = entitlement.checkAccess;
// Only decision 'x402' may lead to a 402 (no double charging). Fallback mirrors the entitlement module's definition.
const requiresPayment = typeof entitlement.requiresPayment === 'function' ? entitlement.requiresPayment : (a) => a?.decision === 'x402';
import { Sentinel } from '../sentinel.mjs';
import { HEADERS, b64encode, b64decode, paymentRequirements, paymentRequired, settlementResponse, shortAddr, shortHash, REASONS, APPROVED_NETWORKS } from './protocol.mjs';
import { InvoiceBook, ReplayCache, SimFacilitator, SimPayer, LiveTestnetFacilitator, simLedgerClock, LIVE_LIMITS } from './facilitator.mjs';
import { Telemetry } from './telemetry.mjs';
import { RateLimiter, DEFAULT_AGENT_POLICY, normalizePolicy, evaluateSpend } from './policy.mjs';
import { catalogFor, THIN_MARKET_SCENARIO } from './catalog.mjs';

export const STEPS = ['REQUEST', '402', 'REQUIREMENTS', 'AUTHORIZATION', 'VERIFICATION', 'SETTLEMENT', 'DELIVERY'];
const SERVE = new Set(['essential', 'free', 'subscription']);

export const DISCOVERY = {
  checkedAt: '2026-10-23',
  existingOnThisNode: 'None. No x402 code existed on TA-LON before this module (repository grep).',
  integrations: [
    { name: 'Titan Merchant x402', status: 'not connected', note: 'Runs on another node (Tokyo). Not reachable from TA-LON; no endpoint configured, no calls made.' },
    { name: 'TGLW x402', status: 'not connected', note: 'Runs on another node. Not reachable from TA-LON; no endpoint configured, no calls made.' },
    { name: 'COMMAND/C2 x402 entitlement authority', status: 'not connected', note: 'Production entitlement authority belongs to C2 (master spec §U). London only shows, simulates and runs a budgeted Testnet demo.' },
    { name: 'External facilitators (e.g. T54 XRPL testnet facilitator)', status: 'not used', note: 'This node acts as its own local facilitator for the demo. No external or paid facilitator is called.' },
  ],
  spec: [
    { what: 'x402 v2 core (PaymentRequired / PaymentRequirements / PaymentPayload / VerifyResponse / SettlementResponse)', url: 'https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md' },
    { what: 'x402 v2 HTTP transport (PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE, base64 JSON)', url: 'https://github.com/coinbase/x402/blob/main/specs/transports-v2/http.md' },
    { what: 'XRPL exact scheme (xrpl:0/1/2, drops, signedTxBlob, sequence | ticketSequence, InvoiceID binding, validated tesSUCCESS)', url: 'https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_xrpl.md' },
    { what: 'Scheme index listing XRPL among exact networks', url: 'https://docs.x402.org/schemes/exact' },
    { what: 'XRPL.org agentic payments guide (T54 testnet facilitator exists, best-effort, dev only)', url: 'https://xrpl.org/docs/agents/agentic-payments-x402' },
  ],
};

export class X402Service {
  constructor({ ledger = null, store, bus = null, ledgerReady = () => false, checkAccess = defaultCheckAccess, env = process.env, now = () => Date.now(), sentinel = undefined, runsFile = null, httpRateLimit = 30, resolveParticipant = null, participantMode = null } = {}) {
    Object.assign(this, { ledger, store, bus, ledgerReady, checkAccess, env, now, resolveParticipant, participantMode });
    this.catalog = catalogFor(env);
    this.invoices = new InvoiceBook({ now });
    this.simLedger = simLedgerClock(now);
    this.sim = new SimFacilitator({ invoices: this.invoices, replay: new ReplayCache(), currentLedger: this.simLedger });
    this.live = new LiveTestnetFacilitator({ ledger, isReady: ledgerReady, invoices: this.invoices, replay: new ReplayCache(), now, env });
    this.payer = new SimPayer();
    this.simPayTo = Wallet.generate().address; // fixture payee when demo wallets are not loaded
    this.telemetry = new Telemetry({ now });
    this.httpLimiter = new RateLimiter({ limit: httpRateLimit, now });
    this.sampleLimiter = new RateLimiter({ limit: 120, now });
    // Separate Sentinel instance for data products, with a silent bus so findings are not re-published.
    this.sentinel = sentinel !== undefined ? sentinel : (ledger ? new Sentinel({ ledger, store, bus: { publish() {} } }) : null);
    this.runsFile = runsFile; this.runs = [];
    if (runsFile && fs.existsSync(runsFile)) { try { this.runs = JSON.parse(fs.readFileSync(runsFile, 'utf8')).slice(-30); } catch { this.runs = []; } }
    this.busTimes = [];
  }

  dataCtx() { return { store: this.store, ledger: this.ledger, ledgerReady: this.ledgerReady, sentinel: this.sentinel }; }
  resource(id) { return this.catalog.find((r) => r.id === id) || null; }
  payTo(mode = 'SIMULATION') { return this.ledger?.wallets?.issuer?.address || (mode === 'LIVE_TESTNET' ? null : this.simPayTo); }
  offered(r, invoiceId, mode) { return paymentRequirements({ network: 'xrpl:1', amountDrops: r.priceDrops, payTo: this.payTo(mode), maxTimeoutSeconds: 60, invoiceId }); }

  publish(type, mode, payload) {
    if (!this.bus) return;
    const t = this.now();
    this.busTimes = this.busTimes.filter((x) => t - x < 10_000);
    if (this.busTimes.length >= 20) return; // protect the shared SSE backlog
    this.busTimes.push(t);
    try { this.bus.publish(type, mode, payload); } catch { /* bus refuses bad modes */ }
  }

  record(e) { return this.telemetry.record(e); }

  status() {
    return {
      node: 'TA-LON (London)', role: 'Shows, visualizes and simulates x402; may run a tightly budgeted XRPL Testnet demonstration. Not an entitlement authority.',
      doctrine: 'x402 is payment/entitlement, not trading authority (master spec §U). Basic liquidity participation is never behind x402.',
      discovery: DISCOVERY, version: 2, headers: HEADERS, networks: APPROVED_NETWORKS,
      modes: {
        SIMULATION: { available: true, note: 'Default. Local fixture verifier/settler, no ledger.' },
        LIVE_TESTNET: { available: this.env.TF_READONLY !== '1' && this.ledgerReady() && !!this.live.payerAddress(), readonly: this.env.TF_READONLY === '1', ledgerReady: this.ledgerReady(),
          payer: shortAddr(this.live.payerAddress()), payTo: shortAddr(this.live.payTo()), budget: this.live.budget(), limits: LIVE_LIMITS,
          note: 'This node acts as its own facilitator. Payer = demo router role, payTo = demo issuer. Spec-form payload: the router signs an XRPL Payment offline (ledger.signOffline under the router lock); this node verifies the signedTxBlob exactly as in SIMULATION and submits it (ledger.submitSigned). Requires approval:true per run.' },
        REPLAY: { available: true, runs: this.runs.length },
      },
      entitlement: { function: 'checkAccess({participantId, resource, mode}) + requiresPayment()', resources: Object.fromEntries(this.catalog.map((r) => [r.id, r.entitlementResource])) },
    };
  }

  catalogView() {
    return this.catalog.map((r) => ({ id: r.id, title: r.title, restricted: !!r.restricted, priceDrops: r.priceDrops, priceXrp: r.priceDrops / 1e6, network: 'xrpl:1', asset: 'XRP',
      sample: `/api/x402/sample/${r.id}`, premium: r.restricted ? null : `/api/x402/data/${r.id}`, needsLedger: !!r.needsLedger }));
  }

  async sample(id, { provenance = 'OBSERVED', clientKey = 'local' } = {}) {
    const t0 = this.now();
    const r = this.resource(id);
    if (!r) return { status: 404, body: { error: `Unknown resource ${id}` } };
    const rl = this.sampleLimiter.check(clientKey);
    if (!rl.ok) { this.record({ provenance, kind: 'rejected', control: 'rate-limiter', endpoint: `sample/${id}`, status: 429, reason: 'rate_limited' }); return { status: 429, body: { error: 'Rate limited', retryAfterSec: rl.retryAfterSec } }; }
    try {
      const data = await r.sample(this.dataCtx());
      this.record({ provenance, kind: 'free', endpoint: `sample/${id}`, status: 200, latencyMs: this.now() - t0, note: 'free sample' });
      return { status: 200, body: { resource: id, tier: 'FREE_SAMPLE', title: r.title, premium: r.restricted ? null : `/api/x402/data/${id}`, priceXrp: r.priceDrops / 1e6, data } };
    } catch (e) {
      this.record({ provenance, kind: 'error', endpoint: `sample/${id}`, status: 503, latencyMs: this.now() - t0, reason: 'unavailable' });
      return { status: 503, body: { error: `Sample unavailable: ${e.message}` } };
    }
  }

  // Core premium handler. Returns { status, headers, body, trace, delivered }.
  async premium(id, { participantId = 'anonymous', paymentHeader = null, payload = null, provenance = 'OBSERVED', mode = 'SIMULATION', clientKey = 'local', approval = false, accessFn = null, limiter = null, liveInvoiceId = null } = {}) {
    const t0 = this.now();
    const endpoint = `data/${id}`;
    const trace = [];
    const step = (s, ok, detail) => trace.push({ step: s, ok, at: new Date(this.now()).toISOString(), detail });
    const busMode = mode;
    const done = (status, body, headers = {}, extra = {}) => ({ status, body, headers, trace, delivered: false, ...extra, latencyMs: this.now() - t0 });
    const reject = (status, reason, control, kind = 'rejected', body = {}, headers = {}) => {
      if (kind !== 'rejected') this.record({ provenance, mode, kind, endpoint, reason, control });
      this.record({ provenance, mode, kind: 'rejected', endpoint, status, latencyMs: this.now() - t0, reason, control, network: 'xrpl:1', asset: 'XRP' });
      this.publish('x402.rejected', busMode, { resource: id, provenance, status, reason, control });
      return done(status, { error: REASONS[reason] || reason, reason, control, dataUnlocked: false, ...body }, headers);
    };

    this.record({ provenance, mode, kind: 'request', endpoint });
    this.publish('x402.request', busMode, { resource: id, provenance, paid: !!(paymentHeader || payload) });
    step('REQUEST', true, { resource: id, participantId, hasPayment: !!(paymentHeader || payload) });
    const r = this.resource(id);
    if (!r) return reject(404, 'unknown_resource', 'catalog');
    const rl = (limiter || this.httpLimiter).check(clientKey);
    if (!rl.ok) return reject(429, 'rate_limited', 'rate-limiter', 'rejected', { retryAfterSec: rl.retryAfterSec });
    if (r.restricted) return reject(403, 'restricted_resource', 'entitlement', 'denied', { detail: 'Participant-private data is never sold via x402.' });

    if (this.resolveParticipant) { try { await this.resolveParticipant(participantId); } catch { /* entitlement decides with what it has */ } }
    // Entitlement is evaluated in the participant's own mode (live records are never mixed into simulation);
    // the payment mode (SIMULATION / LIVE_TESTNET) is separate.
    let accessMode = mode;
    try { accessMode = this.participantMode?.(participantId) || mode; } catch { accessMode = mode; }
    let access;
    try { access = await (accessFn || this.checkAccess)({ participantId, resource: r.entitlementResource || `x402.data.${id}`, mode: accessMode }); }
    catch (e) { access = { decision: 'deny', reason: `Entitlement check failed: ${e.message}` }; }
    const decision = access?.decision;
    trace[0].detail.entitlement = { decision: decision || 'unknown', reason: access?.reason || null };
    const pay = requiresPayment(access);
    if (!pay && !SERVE.has(decision)) return reject(403, 'entitlement_denied', 'entitlement', 'denied', { entitlement: { decision: decision || 'unknown', reason: access?.reason || 'Unknown decision (fail closed).' } });
    if (r.needsLedger && !this.ledgerReady()) return reject(503, 'data_unavailable', 'availability', 'rejected', { detail: 'Not challenging for payment: data source unavailable.' });

    if (SERVE.has(decision)) {
      const data = await r.premium(this.dataCtx());
      this.record({ provenance, mode, kind: 'free', endpoint, status: 200, latencyMs: this.now() - t0, note: `entitlement ${decision}` });
      step('DELIVERY', true, { via: `entitlement:${decision}`, paid: false });
      return done(200, { resource: id, tier: 'PREMIUM', access: decision, paid: false, data }, {}, { delivered: true });
    }

    // Only here: requiresPayment(access) === true (decision 'x402').
    if (!paymentHeader && !payload && !liveInvoiceId) {
      const invoiceId = this.invoices.issue({ resource: id, amountDrops: r.priceDrops, ttlMs: 120_000 });
      const offered = this.offered(r, invoiceId, mode);
      if (!offered.payTo) return reject(503, 'payee_unavailable', 'availability');
      const pr = paymentRequired({ url: `/api/x402/data/${id}`, description: r.title, accepts: [offered] });
      this.record({ provenance, mode, kind: 'challenge', endpoint, status: 402, latencyMs: this.now() - t0, network: offered.network, asset: offered.asset });
      this.publish('x402.challenge', busMode, { resource: id, provenance, network: offered.network, asset: offered.asset, amountDrops: offered.amount });
      step('402', true, { status: 402, header: HEADERS.required });
      step('REQUIREMENTS', true, { scheme: offered.scheme, network: offered.network, asset: offered.asset, amount: offered.amount, payTo: shortAddr(offered.payTo), maxTimeoutSeconds: offered.maxTimeoutSeconds, invoiceId });
      return done(402, { x402: 'payment required', paymentRequired: pr, entitlement: { decision, reason: access.reason || null } }, { [HEADERS.required]: b64encode(pr) }, { offered });
    }

    const live = mode === 'LIVE_TESTNET';
    if (live && !liveInvoiceId) return reject(400, 'invalid_payload', 'verifier', 'rejected', { detail: 'LIVE_TESTNET payments on this node are signed by the demo router role inside this server only.' });
    const pp = live ? null : (payload || b64decode(paymentHeader));
    if (!live && !pp) { this.record({ provenance, mode, kind: 'verify_failed', endpoint, reason: 'invalid_payload' }); return reject(400, 'invalid_payload', 'verifier'); }
    const invoiceId = live ? liveInvoiceId : pp.accepted?.extra?.invoiceId;
    const inv = invoiceId ? this.invoices.get(invoiceId) : null;
    if (!inv || inv.resource !== id) { this.record({ provenance, mode, kind: 'verify_failed', endpoint, reason: 'invalid_exact_xrpl_payload_invoice' }); return reject(402, 'invalid_exact_xrpl_payload_invoice', 'verifier'); }
    const offered = this.offered(r, invoiceId, mode);
    if (String(inv.amountDrops) !== offered.amount) { this.record({ provenance, mode, kind: 'verify_failed', endpoint, reason: 'invalid_payment_requirements' }); return reject(402, 'invalid_payment_requirements', 'verifier'); }
    const CHECKS = 'envelope, decode, type, destination, network binding, amount, safety, LastLedgerSequence, sequence, InvoiceID, signature, replay';
    const verifyFailed = (v) => {
      this.record({ provenance, mode, kind: 'verify_failed', endpoint, reason: v.invalidReason, payer: v.payer });
      const sr = settlementResponse({ success: false, errorReason: v.invalidReason, network: offered.network });
      return reject(402, v.invalidReason, 'verifier', 'rejected', {}, { [HEADERS.response]: b64encode(sr) });
    };

    let v, s, data;
    if (live) {
      // Build the data BEFORE paying (never charge for data we cannot deliver); release only after validated settlement.
      try { data = await r.premium(this.dataCtx()); } catch (e) { return reject(503, 'data_unavailable', 'availability', 'rejected', { detail: e.message }); }
      s = await this.live.purchase(offered, { approval, resource: { url: `/api/x402/data/${id}`, description: r.title } });
      step('AUTHORIZATION', !!s.payload, { payer: shortAddr(this.live.payerAddress()), role: 'router', form: 'signedTxBlob (ledger.signOffline)', signedPayload: '[redacted]', ...(s.error ? { error: s.error } : {}), ...(s.refused ? { refused: s.refused.reasons } : {}) });
      v = s.verify || { isValid: false, invalidReason: 'unexpected_verify_error' };
      if (!s.refused && s.payload) {
        step('VERIFICATION', v.isValid, v.isValid ? { isValid: true, payer: shortAddr(v.payer), checks: CHECKS } : { isValid: false, invalidReason: v.invalidReason });
        if (!v.isValid) return verifyFailed(v);
      }
    } else {
      step('AUTHORIZATION', true, { payer: 'signed blob (redacted)', form: 'signedTxBlob', signedPayload: '[redacted]' });
      v = this.sim.verify(pp, offered);
      step('VERIFICATION', v.isValid, v.isValid ? { isValid: true, payer: shortAddr(v.payer), checks: CHECKS } : { isValid: false, invalidReason: v.invalidReason });
      if (!v.isValid) return verifyFailed(v);
      try { data = await r.premium(this.dataCtx()); } catch (e) { return reject(503, 'data_unavailable', 'availability', 'rejected', { detail: e.message }); }
      s = this.sim.settle(pp, offered);
    }
    if (!s.settlement.success || !s.evidence) {
      const control = s.refused ? 'guardian' : s.settlement.errorReason === 'duplicate_settlement' ? 'verifier' : 'settlement';
      this.record({ provenance, mode, kind: 'settle_failed', endpoint, reason: s.settlement.errorReason, network: offered.network, asset: offered.asset });
      step('SETTLEMENT', false, { success: false, errorReason: s.settlement.errorReason, refused: s.refused?.reasons || null, txHash: shortHash(s.txHash) });
      return reject(402, s.settlement.errorReason, control, 'rejected', { refused: s.refused?.reasons || undefined }, { [HEADERS.response]: b64encode(s.settlement) });
    }
    const ev = s.evidence;
    this.record({ provenance, mode, kind: 'settled', endpoint, network: ev.network, asset: ev.asset, evidence: ev, payer: v.payer });
    this.publish('x402.settled', busMode, { resource: id, provenance, network: ev.network, asset: ev.asset, amountDrops: ev.amountDrops, evidenceKind: ev.kind, transaction: ev.transaction, explorer: ev.explorer });
    step('SETTLEMENT', true, { success: true, evidenceKind: ev.kind, transaction: ev.transaction, explorer: ev.explorer, ledger: ev.ledger ?? null, validated: ev.validated });
    this.record({ provenance, mode, kind: 'delivered_paid', endpoint, status: 200, latencyMs: this.now() - t0, network: ev.network, asset: ev.asset, evidence: ev });
    step('DELIVERY', true, { status: 200, header: HEADERS.response, paid: true });
    return done(200, { resource: id, tier: 'PREMIUM', access: 'x402', paid: true, paymentMode: ev.mode, settlement: { ...s.settlement, payer: shortAddr(s.settlement.payer) }, evidence: { kind: ev.kind, transaction: ev.transaction, explorer: ev.explorer, ledger: ev.ledger ?? null }, data },
      { [HEADERS.response]: b64encode(s.settlement) }, { delivered: true, evidence: ev });
  }

  // SIMULATION authorization helper for HTTP clients: the ephemeral sim payer signs a fixture blob for an open challenge.
  simAuthorize({ resource, invoiceId, tamper = null }) {
    const r = this.resource(resource);
    const inv = invoiceId && this.invoices.get(invoiceId);
    if (!r || r.restricted) return { status: 404, body: { error: 'Unknown or restricted resource' } };
    if (!inv || inv.resource !== resource) return { status: 400, body: { error: 'Unknown invoiceId for this resource. Request the premium URL first to get a 402 challenge.' } };
    const pp = this.payer.authorize(this.offered(r, invoiceId, 'SIMULATION'), { currentLedger: this.simLedger(), tamper });
    return { status: 200, body: { mode: 'SIMULATION', header: HEADERS.signature, value: b64encode(pp), note: 'Fixture signed by an ephemeral, never-funded in-memory key. Never submitted to any network.' } };
  }

  // Full step-by-step flow run (for the visualizer). mode SIMULATION (default) or LIVE_TESTNET.
  async runFlow({ resource = 'wake', mode = 'SIMULATION', approval = false, participantId = 'demo-visitor', tamper = null, provenance } = {}) {
    const prov = provenance || (mode === 'LIVE_TESTNET' ? 'OBSERVED' : 'SIMULATION');
    const t0 = this.now();
    if (mode === 'LIVE_TESTNET') {
      const r = this.resource(resource);
      const pre = this.live.preflight({ amountDrops: r?.priceDrops ?? 0, approval });
      this.record({ provenance: prov, mode, kind: 'guardian', allowed: pre.guardian.allowed, endpoint: `data/${resource}` });
      if (!r || r.restricted || !pre.allowed) {
        this.record({ provenance: prov, mode, kind: 'rejected', control: pre.guardian.allowed ? 'live-preflight' : 'guardian', endpoint: `data/${resource}`, reason: 'live_refused' });
        return { mode, resource, ok: false, refused: true, reasons: r && !r.restricted ? pre.reasons : ['Unknown or restricted resource.'], guardian: pre.guardian, steps: [{ step: 'REQUEST', ok: false, detail: { refused: pre.reasons } }] };
      }
    }
    const first = await this.premium(resource, { participantId, provenance: prov, mode, clientKey: `flow:${prov}` });
    if (first.status !== 402) return this.saveRun({ mode, resource, ok: first.status === 200, status: first.status, steps: first.trace, result: first.body });
    const offered = first.offered;
    const second = mode === 'LIVE_TESTNET'
      ? await this.premium(resource, { participantId, liveInvoiceId: offered.extra.invoiceId, provenance: prov, mode, clientKey: `flow:${prov}`, approval })
      : await this.premium(resource, { participantId, payload: this.payer.authorize(offered, { currentLedger: this.simLedger(), tamper }), provenance: prov, mode, clientKey: `flow:${prov}` });
    const steps = [...first.trace, ...second.trace.filter((s) => s.step !== 'REQUEST')];
    return this.saveRun({ mode, resource, ok: second.status === 200, status: second.status, latencyMs: this.now() - t0, steps,
      challenge: first.body.paymentRequired, result: second.status === 200 ? { paid: true, evidence: second.body.evidence, settlement: second.body.settlement, data: second.body.data } : second.body });
  }

  saveRun(run) {
    const rec = { id: `run-${crypto.randomUUID().slice(0, 8)}`, at: new Date(this.now()).toISOString(), ...run };
    const stored = { ...rec, result: rec.result?.data ? { ...rec.result, data: undefined, dataSummary: Object.keys(rec.result.data) } : rec.result };
    this.runs.push(stored); if (this.runs.length > 30) this.runs.shift();
    if (this.runsFile && this.env.TF_READONLY !== '1') { try { fs.writeFileSync(this.runsFile + '.tmp', JSON.stringify(this.runs, null, 2)); fs.renameSync(this.runsFile + '.tmp', this.runsFile); } catch { /* best effort */ } }
    return rec;
  }

  listRuns() { return this.runs.map((r) => ({ id: r.id, at: r.at, mode: r.mode, kind: r.kind || 'flow', resource: r.resource, ok: r.ok, status: r.status, evidence: r.result?.evidence || null })).reverse(); }

  // REPLAY: re-show a recorded run. Never counted as a new payment or settlement.
  replay(id) {
    const run = this.runs.find((r) => r.id === id);
    if (!run) return null;
    this.record({ provenance: 'REPLAY', mode: 'REPLAY', kind: 'request', endpoint: `replay/${run.resource || run.kind}`, status: 200, latencyMs: 0, note: `replay of ${run.mode} ${run.id}` });
    this.publish('x402.request', 'REPLAY', { resource: run.resource, provenance: 'REPLAY', replayOf: run.id, originalMode: run.mode });
    return { mode: 'REPLAY', originalMode: run.mode, replayOf: run.id, recordedAt: run.at, steps: run.steps, result: run.result, note: 'Replay of a recorded run. Not a new payment; not counted as settlement or revenue.' };
  }

  // ---------- Agentic data purchasing demo (SIMULATION, deterministic) ----------
  async runAgent({ authorized = false, policy: p = {} } = {}) {
    const policy = normalizePolicy(p);
    const prov = 'SIMULATION', mode = 'SIMULATION';
    this.record({ provenance: prov, mode, kind: 'agent_run', endpoint: 'agent' });
    const limiter = new RateLimiter({ limit: policy.maxRequestsPerMin, now: this.now });
    const log = [];
    const thin = THIN_MARKET_SCENARIO.find((m) => m.marketId === 'real_estate');
    const freeWake = await this.sample('wake', { provenance: prov, clientKey: 'agent' });
    const freeCap = await this.sample('capital', { provenance: prov, clientKey: 'agent' });
    const baseline = { action: 'hold', marketId: thin.marketId, amountUsd: thin.capitalUsd,
      rationale: `Free samples only: ${freeWake.body?.data?.recommendationsAvailable ?? '?'} recommendation(s) exist, details hidden; real_estate deployed share ${freeCap.body?.data?.markets?.find((m) => m.marketId === 'real_estate')?.deployedShare ?? '?'}. Without detail the agent holds.` };
    log.push({ step: 'observe', detail: 'Read free Wake and capital samples for the thin real_estate market (no spend).' });
    let spent = 0;
    const bought = [];
    let wakeData = null, capData = null;
    for (const resource of ['wake', 'capital', 'fills']) {
      const r = this.resource(resource);
      if (!r) continue;
      const req = this.offered(r, 'preview', mode);
      const rate = limiter.check('agent');
      const verdict = evaluateSpend({ policy, resource, requirements: req, authorized, spentDrops: spent, rate, mode });
      this.record({ provenance: prov, mode, kind: 'guardian', allowed: verdict.guardian.allowed, endpoint: `data/${resource}` });
      if (!verdict.allowed) {
        this.record({ provenance: prov, mode, kind: 'agent_blocked', endpoint: `data/${resource}`, control: verdict.blockedBy });
        this.record({ provenance: prov, mode, kind: 'rejected', endpoint: `data/${resource}`, control: verdict.blockedBy, reason: verdict.reasons[0] });
        log.push({ step: 'policy', resource, allowed: false, blockedBy: verdict.blockedBy, checks: verdict.checks });
        if (!authorized) break; // nothing else can be bought without authorization
        continue;
      }
      log.push({ step: 'policy', resource, allowed: true, checks: verdict.checks });
      const flow = await this.runFlow({ resource, mode, provenance: prov, participantId: 'demo-agent' });
      if (flow.ok && flow.result?.evidence) {
        spent += r.priceDrops;
        this.record({ provenance: prov, mode, kind: 'agent_purchase', endpoint: `data/${resource}`, evidence: { ...flow.result.evidence, simulated: true, amountDrops: String(r.priceDrops) } });
        bought.push({ resource, title: r.title, priceXrp: r.priceDrops / 1e6, evidenceKind: flow.result.evidence.kind, transaction: flow.result.evidence.transaction, runId: flow.id });
        if (resource === 'wake') wakeData = flow.result.data; if (resource === 'capital') capData = flow.result.data;
        log.push({ step: 'purchase', resource, ok: true, runId: flow.id });
      } else log.push({ step: 'purchase', resource, ok: false, status: flow.status });
    }
    let updated = { ...baseline, changed: false };
    const rec = wakeData?.scenarios?.thinMarket?.recommendations?.find((x) => x.fromMarket === 'real_estate');
    if (rec) {
      const cap = capData?.markets?.find((m) => m.marketId === 'real_estate');
      updated = { action: rec.action, fromMarket: rec.fromMarket, toMarket: rec.toMarket, amountUsd: rec.amountUsd, changed: true,
        rationale: `${rec.rationale}${cap ? ` Capital analytics: real_estate modeled yield ${cap.yieldBpsOnDeployed} bps/day on deployed, productive capacity $${(cap.productiveCapacityUsd ?? 0).toLocaleString('en-US')}.` : ''}`, source: wakeData.engine.label };
    }
    const out = { kind: 'agent', mode, authorized, policy, baseline, updated, bought, spentXrp: spent / 1e6, budgetXrp: policy.sessionBudgetDrops / 1e6, log,
      disclaimer: 'Buying data does not guarantee a better allocation. The recommendation comes from the temporary demo adapter (not the Titan Ghost engines) and is SIMULATION only; no capital moves.' };
    this.saveRun({ kind: 'agent', mode, resource: 'agent', ok: true, status: 200, steps: log.map((l) => ({ step: l.step, ok: l.allowed ?? l.ok ?? true, detail: l })), result: { bought, baseline, updated } });
    return out;
  }

  // ---------- Sentinel attack lab (SIMULATION, local) ----------
  attacks() {
    return [
      { id: 'invalid_signature', title: 'Invalid payment signature', expect: 'verifier' },
      { id: 'replay', title: 'Replay / duplicate payment', expect: 'verifier (replay cache)' },
      { id: 'excessive_spend', title: 'Excessive spend', expect: 'spend policy + Guardian' },
      { id: 'unsupported_network', title: 'Unsupported network (Base / XRPL Mainnet)', expect: 'verifier' },
      { id: 'rate_limit', title: 'Rate-limit violation', expect: 'rate limiter' },
      { id: 'restricted_access', title: 'Unauthorized restricted-data access', expect: 'entitlement' },
    ];
  }

  async runAttack(id) {
    const prov = 'SIMULATION', mode = 'SIMULATION';
    const res = { id, mode, provenance: prov, attempts: [], dataUnlocked: false };
    const attempt = (label, r) => { const a = { label, status: r.status, reason: r.body?.reason || null, control: r.body?.control || null, delivered: !!r.delivered }; res.attempts.push(a); if (r.delivered && label.startsWith('attack')) res.dataUnlocked = true; return a; };
    const challenge = async (resource = 'wake') => (await this.premium(resource, { provenance: prov, mode, clientKey: `attack:${id}` })).offered;
    switch (id) {
      case 'invalid_signature': {
        const off = await challenge();
        attempt('attack: tampered TxnSignature', await this.premium('wake', { provenance: prov, mode, clientKey: `attack:${id}`, payload: this.payer.authorize(off, { currentLedger: this.simLedger(), tamper: 'signature' }) }));
        break;
      }
      case 'replay': {
        const off = await challenge();
        const pp = this.payer.authorize(off, { currentLedger: this.simLedger() });
        attempt('legitimate first payment', await this.premium('wake', { provenance: prov, mode, clientKey: `attack:${id}`, payload: pp }));
        attempt('attack: same signed payment again', await this.premium('wake', { provenance: prov, mode, clientKey: `attack:${id}`, payload: pp }));
        break;
      }
      case 'excessive_spend': {
        const r = this.resource('wake');
        const v = evaluateSpend({ policy: normalizePolicy({ maxPriceDrops: 10_000, sessionBudgetDrops: 20_000 }), resource: 'wake', requirements: this.offered(r, 'preview', mode), authorized: true, spentDrops: 0, mode });
        this.record({ provenance: prov, mode, kind: 'rejected', endpoint: 'data/wake', control: v.blockedBy, reason: 'excessive_spend' });
        res.attempts.push({ label: 'attack: agent asked to pay 0.05 XRP with a 0.01 XRP cap', status: 'blocked', control: v.blockedBy, reason: v.reasons.join(' | '), delivered: false });
        const pre = this.live.preflight({ amountDrops: 25_000_000, approval: true });
        this.record({ provenance: prov, mode, kind: 'guardian', allowed: pre.guardian.allowed, endpoint: 'live-preflight' });
        this.record({ provenance: prov, mode, kind: 'rejected', endpoint: 'live-preflight', control: 'guardian', reason: 'excessive_spend' });
        res.attempts.push({ label: 'attack: live payment of 25 XRP (preflight only, nothing submitted)', status: 'blocked', control: 'guardian + live limits', reason: pre.reasons.join(' | '), delivered: false });
        break;
      }
      case 'unsupported_network': {
        for (const t of ['network', 'mainnet']) {
          const off = await challenge();
          attempt(`attack: accepted.network ${t === 'network' ? 'eip155:8453 (Base)' : 'xrpl:0 (Mainnet)'}`, await this.premium('wake', { provenance: prov, mode, clientKey: `attack:${id}`, payload: this.payer.authorize(off, { currentLedger: this.simLedger(), tamper: t }) }));
        }
        break;
      }
      case 'rate_limit': {
        const limiter = new RateLimiter({ limit: 3, now: this.now });
        for (let i = 0; i < 5; i++) attempt(`${i < 3 ? 'within limit' : 'attack'}: burst request ${i + 1}/5 (limit 3/min)`, await this.premium('wake', { provenance: prov, mode, clientKey: 'attack:burst', limiter }));
        break;
      }
      case 'restricted_access': {
        attempt('attack: buy participant-private positions', await this.premium('positions', { provenance: prov, mode, clientKey: `attack:${id}`, participantId: 'intruder' }));
        attempt('attack: participant denied by entitlement', await this.premium('sentinel', { provenance: prov, mode, clientKey: `attack:${id}`, participantId: 'suspended-demo', accessFn: () => ({ decision: 'deny', reason: 'Fixture: participant suspended by policy.' }) }));
        break;
      }
      default: return null;
    }
    const blocked = res.attempts.filter((a) => a.label.startsWith('attack'));
    res.rejected = blocked.every((a) => !a.delivered && a.status !== 200);
    res.caughtBy = [...new Set(blocked.map((a) => a.control).filter(Boolean))];
    if (!res.rejected) res.dataUnlocked = true;
    return res;
  }
}

export { DEFAULT_AGENT_POLICY, b64decode, b64encode, HEADERS };
