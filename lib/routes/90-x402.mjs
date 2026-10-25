// x402 Payments & Data routes (TA-LON demo). See lib/x402/service.mjs.
// No production or paid endpoint is ever called. LIVE_TESTNET runs need approval:true and stay within 0.1 XRP / 1 XRP.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { X402Service, DEFAULT_AGENT_POLICY } from '../x402/service.mjs';
import { entitlements } from '../entitlement/index.mjs';
import { LIVE_PARTICIPANTS } from '../entitlement/live.mjs';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

export function register(app, ctx) {
  const { json } = ctx;
  // Live participants (e.g. 'live-maker') are registered lazily by the Access module (95-access) once Testnet is ready.
  // If one is not registered yet, ask the Access route to load it (loopback to this same server, allow-listed ids only),
  // so checkAccess() decides against the real participant record instead of treating it as unknown.
  const LIVE_IDS = new Set(LIVE_PARTICIPANTS.map((p) => p.id));
  const resolveParticipant = async (id) => {
    if (!LIVE_IDS.has(id) || entitlements().participants?.has?.(id)) return;
    await fetch(`http://127.0.0.1:${process.env.PORT || 4131}/api/access/participants/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(8000) }).catch(() => {});
  };
  const svc = new X402Service({ ledger: ctx.ledger, store: ctx.store, bus: ctx.bus, ledgerReady: () => ctx.ledgerReady, runsFile: path.join(DATA, 'x402-runs.json'), resolveParticipant,
    participantMode: (id) => entitlements().participants?.get?.(id)?.mode || null });
  const send = (res, out) => { for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v); json(res, out.status, out.body); };
  const pid = (req, url) => String(url.searchParams.get('participant') || req.headers['x-participant-id'] || 'anonymous').slice(0, 64);
  // Rate-limit key: client IP (first X-Forwarded-For hop if a local proxy fronts us), not the self-declared participant id.
  const key = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'local';

  app.get('/api/x402/status', (req, res) => json(res, 200, svc.status()));
  app.get('/api/x402/catalog', (req, res) => json(res, 200, { resources: svc.catalogView(), note: 'Free samples are never gated. Premium reports go through checkAccess(); only decision x402 leads to a 402 challenge.' }));
  app.get('/api/x402/supported', (req, res) => json(res, 200, { ...svc.sim.supported(), note: 'Local demo facilitator on this node (SIMULATION fixture settlement). Not a public facilitator.' }));
  app.get('/api/x402/sample/:id', async (req, res, { id }, body, url) => send(res, await svc.sample(id, { provenance: 'OBSERVED', clientKey: key(req, url) })));
  app.get('/api/x402/data/:id', async (req, res, { id }, body, url) => {
    const out = await svc.premium(id, { participantId: pid(req, url), paymentHeader: req.headers['payment-signature'] || null, provenance: 'OBSERVED', mode: 'SIMULATION', clientKey: key(req, url) });
    send(res, out);
  });
  app.post('/api/x402/sim/authorize', (req, res, p, body = {}) => send(res, svc.simAuthorize({ resource: String(body.resource || ''), invoiceId: String(body.invoiceId || ''), tamper: null })));
  app.post('/api/x402/sim/purchase', async (req, res, p, body = {}) => json(res, 200, await svc.runFlow({ resource: String(body.resource || 'wake'), mode: 'SIMULATION', participantId: String(body.participantId || 'demo-visitor').slice(0, 64) })));
  app.post('/api/x402/live/purchase', async (req, res, p, body = {}) => {
    const out = await svc.runFlow({ resource: String(body.resource || 'wake'), mode: 'LIVE_TESTNET', approval: body.approval === true, participantId: 'demo-router' });
    json(res, 200, out); // refusals are a normal, labeled outcome (refused:true)
  });
  app.get('/api/x402/participants', (req, res) => json(res, 200, { live: LIVE_PARTICIPANTS.map(({ id, role, label }) => ({ id, role, label, registered: !!entitlements().participants?.has?.(id) })), note: 'Ids come from the Access module (GET /api/access/participants). Anonymous visitors get the optional x402 offer.' }));
  app.get('/api/x402/agent/policy', (req, res) => json(res, 200, { mode: 'SIMULATION', policy: DEFAULT_AGENT_POLICY }));
  app.post('/api/x402/agent/run', async (req, res, p, body = {}) => json(res, 200, await svc.runAgent({ authorized: body.authorized === true, policy: body.policy || {} })));
  app.get('/api/x402/attacks', (req, res) => json(res, 200, { mode: 'SIMULATION', attacks: svc.attacks() }));
  app.post('/api/x402/attacks/:id', async (req, res, { id }) => { const r = await svc.runAttack(id); return r ? json(res, 200, r) : json(res, 404, { error: `Unknown attack ${id}` }); });
  app.get('/api/x402/telemetry', (req, res) => json(res, 200, svc.telemetry.snapshot()));
  app.get('/api/x402/events', (req, res, p, body, url) => {
    const prov = url.searchParams.get('provenance');
    json(res, 200, { events: svc.telemetry.recent(150, ['OBSERVED', 'SIMULATION', 'REPLAY'].includes(prov) ? prov : undefined) });
  });
  app.get('/api/x402/runs', (req, res) => json(res, 200, { runs: svc.listRuns() }));
  app.post('/api/x402/replay/:id', (req, res, { id }) => { const r = svc.replay(id); return r ? json(res, 200, r) : json(res, 404, { error: 'Unknown run' }); });
}
