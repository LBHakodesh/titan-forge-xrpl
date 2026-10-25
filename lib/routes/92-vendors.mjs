// Vendor integrations (Workstream F). Verifiable connection status, read-only probes, TG Merchant flow.
//   GET  /api/vendors                    every vendor: status, evidence, credentials (set/unset only), sample, telemetry
//   GET  /api/vendors/sentinel-signals   vendor failures/errors for the Sentinel findings registry
//   GET  /api/vendors/:id                one vendor
//   POST /api/vendors/:id/probe          safe read-only probe (localhost only, rate-limited); event vendors.probe
//   POST /api/vendors/ledger/review      unsigned, non-executable Testnet Payment for on-device review {account, publicKey}
//   POST /api/vendors/ledger/commitment  TGLW self-custody illustration (TGLB Tier 1/2): unsigned, expired Testnet OfferCreate
//                                        from the participant's own account {account, publicKey, tier, amountXrp?, termDays?}
//   GET  /api/vendors/quicknode/stream-filter  Streams filter template rendered with maker/router addresses from /api/status (not deployed)
//   GET  /api/merchant/flow              TG Merchant — Agentic Finance (x402 + Mastercard intent + Guardian + AgentCore); never pays
// Nothing here signs, submits, pays or charges. No secrets are ever returned.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVendors, sentinelSignals, merchantFlow, buildReviewTx, buildCommitmentTx, liquidityLoop, VENDOR_IDS } from '../vendors/index.mjs';
import { renderStreamFilter } from '../vendors/quicknode.mjs';
import { QUOTE } from '../ledger.mjs';
import { safeMessage } from '../vendors/common.mjs';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const isLocal = (req) => LOCAL.has(req.socket?.remoteAddress) && !req.headers['x-forwarded-for'];
const BUS_MODES = new Set(['LIVE_TESTNET', 'SIMULATION', 'REPLAY', 'MAINNET_OBSERVED', 'UNAVAILABLE']);

export function register(app, ctx) {
  const { json, bus } = ctx;
  const x402RunsFile = path.join(DATA, 'x402-runs.json');
  const baseUrl = `http://127.0.0.1:${process.env.PORT || 4131}`;
  const routeExists = (p) => !!app.match('GET', p.replace(/:(\w+)/g, 'XYZ'));
  const vendors = createVendors({ env: process.env, samplesFile: process.env.TF_VENDOR_SAMPLES_FILE || path.join(DATA, 'vendor-samples.json'), offline: !!ctx.offline,
    ledger: ctx.ledger, ledgerReady: () => ctx.ledgerReady, store: ctx.store, x402RunsFile, routeExists });
  ctx.vendors = vendors;

  // Rate limits: one probe per vendor per 15 s, at most 12 probes per minute overall; review builds 10/min.
  const lastProbe = new Map(); let window = [];
  const limited = (id) => {
    const t = Date.now(); window = window.filter((x) => t - x < 60_000);
    if (window.length >= 12) return 60 - Math.floor((t - window[0]) / 1000);
    if (t - (lastProbe.get(id) || 0) < 15_000) return Math.ceil((15_000 - (t - lastProbe.get(id))) / 1000);
    window.push(t); lastProbe.set(id, t); return 0;
  };
  let reviews = [];
  let flowCache = null;

  app.get('/api/vendors', (req, res) => json(res, 200, {
    vendors: vendors.list(), ids: VENDOR_IDS, loop: liquidityLoop(vendors),
    statuses: ['CONNECTED_TESTED', 'CONNECTED', 'CREDENTIALS_REQUIRED', 'SANDBOX_ONLY', 'DOCUMENTATION_ONLY', 'ERROR'],
    note: 'Integrations, not a sponsor list. Status is computed from env (presence only) and real read-only probes; samples are captured from real probes only. No payment is ever executed here.',
  }));

  app.get('/api/vendors/sentinel-signals', (req, res) => json(res, 200, sentinelSignals(vendors)));

  app.get('/api/vendors/:id', (req, res, { id }) => {
    const v = vendors.get(id);
    return v ? json(res, 200, v.view()) : json(res, 404, { error: `Unknown vendor ${id}`, ids: VENDOR_IDS });
  });

  app.post('/api/vendors/ledger/review', async (req, res, p, body = {}) => {
    const t = Date.now(); reviews = reviews.filter((x) => t - x < 60_000);
    if (reviews.length >= 10) return json(res, 429, { error: 'Too many review builds; wait a minute.' });
    reviews.push(t);
    try {
      const out = await buildReviewTx({ account: body.account, publicKey: body.publicKey, destination: ctx.ledger?.wallets?.issuer?.address, ledger: ctx.offline ? null : ctx.ledger, ledgerReady: () => ctx.ledgerReady });
      json(res, 200, out);
    } catch (e) { json(res, e.status || 500, { error: safeMessage(e) }); }
  });

  // TGLW self-custody commitment illustration. Shares the review rate limit. Never signed, never submitted.
  app.post('/api/vendors/ledger/commitment', async (req, res, p, body = {}) => {
    const t = Date.now(); reviews = reviews.filter((x) => t - x < 60_000);
    if (reviews.length >= 10) return json(res, 429, { error: 'Too many review builds; wait a minute.' });
    reviews.push(t);
    try {
      const live = (ctx.store?.launches || []).filter((l) => l.status === 'live').map((l) => l.code);
      const code = live.includes('BBL') ? 'BBL' : live[0];
      const issuer = ctx.ledger?.wallets?.issuer?.address;
      const out = await buildCommitmentTx({ account: body.account, publicKey: body.publicKey, tier: body.tier, amountXrp: body.amountXrp, termDays: body.termDays,
        token: code && issuer ? { currency: code, issuer } : null, priceXrp: Number(QUOTE.bid), ledger: ctx.offline ? null : ctx.ledger, ledgerReady: () => ctx.ledgerReady });
      json(res, 200, out);
    } catch (e) { json(res, e.status || 500, { error: safeMessage(e) }); }
  });

  // QuickNode Streams filter, rendered with the public maker/router addresses read from GET /api/status. Not deployed.
  app.get('/api/vendors/quicknode/stream-filter', async (req, res) => {
    try {
      const r = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return json(res, 503, { error: `GET /api/status -> HTTP ${r.status}`, deployed: false });
      json(res, 200, renderStreamFilter(await r.json()));
    } catch (e) { json(res, e.status || 503, { error: safeMessage(e), deployed: false }); }
  });

  app.post('/api/vendors/:id/probe', async (req, res, { id }) => {
    const v = vendors.get(id);
    if (!v) return json(res, 404, { error: `Unknown vendor ${id}`, ids: VENDOR_IDS });
    if (!isLocal(req)) return json(res, 403, { error: 'Probes are restricted to direct localhost callers.' });
    const wait = limited(id);
    if (wait) return json(res, 429, { error: `Rate limited; retry in ${wait} s.`, retryAfterSec: wait });
    const out = await v.probe();
    const mode = out.ok ? (BUS_MODES.has(out.mode) ? out.mode : 'SIMULATION') : 'UNAVAILABLE';
    try { bus.publish('vendors.probe', mode, { vendor: id, status: out.status, ok: !!out.ok, latencyMs: out.latencyMs, sampleStored: !!out.sampleStored }); } catch { /* bus refuses bad modes */ }
    json(res, 200, out);
  });

  app.get('/api/merchant/flow', async (req, res) => {
    if (flowCache && Date.now() - flowCache.t < 20_000) return json(res, 200, { ...flowCache.body, cached: true });
    const body = await merchantFlow({ vendors, baseUrl: ctx.offline ? null : baseUrl, x402RunsFile });
    flowCache = { t: Date.now(), body };
    json(res, 200, body);
  });
}
