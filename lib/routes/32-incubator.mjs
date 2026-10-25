// Project Liquidity Incubator API (namespace /api/incubator). Contract: docs/INCUBATOR.md.
//   GET  /api/incubator/projects               list (stable contract consumed by TGAN advisory)
//   GET  /api/incubator/projects/:id           detail (+ performance, recommendations, history)
//   POST /api/incubator/projects               intake (validated; localhost only)
//   POST /api/incubator/projects/:id/stack     capital stack + per-source capital states (localhost; SIMULATION)
//   POST /api/incubator/projects/:id/gates     operator-entered legal / economic inputs (localhost; SIMULATION)
//   POST /api/incubator/projects/:id/decision  Commander decision record (localhost; SIMULATION; nothing executes)
//   GET  /api/incubator/radar | /compare?a=&b= | /sentinel-signals | /meta | /amendments
//   POST /api/incubator/amendments/refresh     read-only Testnet feature/account_info check (localhost)
//   POST /api/incubator/reset                  reseed the fictional demo (localhost)
//   TGLB Bootstrap studio (pure compute, SIMULATION; no state change, no events):
//   GET  /api/incubator/bootstrap/meta | /bootstrap/demo        POST /api/incubator/bootstrap/plan   POST /api/incubator/loans/simulate
//   Lending records (XLS-65/66-style simulation; localhost; emit incubator.loan_*):
//   GET  /api/incubator/loans | /loans/:id     POST /api/incubator/loans | /loans/:id/scenario | /bootstrap/demo/run
// Nothing here signs or submits on any network. The route never touches ctx.ledger except the read-only refresh,
// which goes through an allowlist of read commands.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Incubator, ProjectError } from '../incubator/service.mjs';
import { runAmendmentCheck, nativeLendingStatus, READ_COMMANDS } from '../incubator/amendments.mjs';
import { planBootstrap, demoWalkthrough, TIER_INFO, CATEGORIES, INCUBATION_ASSETS, BOOTSTRAP_TITLE, XDLC_ENDPOINT, DEMO_PROJECT } from '../incubator/bootstrap.mjs';
import { simulateLoan, nativeLendingDecision, SCORECARD, SCENARIOS, PERMITTED_USES, RESTRICTED_USES, STRUCTURES, DEFAULT_TERMS, PRICING, LENDING_LABEL, DISCLOSURE } from '../incubator/lending.mjs';
import { TIER_COMBINATIONS } from '../incubator/model.mjs';
import { LEGAL_ITEMS } from '../incubator/gates.mjs';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const isLocal = (req) => LOCAL.has(req.socket?.remoteAddress) && !req.headers['x-forwarded-for'];

// Read-only spokes data: the live SpokesService when 85-spokes has registered, else the snapshot file.
function spokesSource(ctx) {
  let cache = null, cacheAt = 0;
  return () => {
    if (ctx.spokes?.response) {
      const r = ctx.spokes.response();
      return { spokes: [...r.groups.A.spokes, ...r.groups.B.spokes].filter((s) => !s.placeholder), flows: ctx.spokes.flows?.({ limit: 200 }) || [], xrpUsd: ctx.spokes.snap?.xrpUsd ?? null, attributionHtml: r.snapshot.attributionHtml };
    }
    if (cache && Date.now() - cacheAt < 60_000) return cache;
    try {
      const snap = JSON.parse(fs.readFileSync(process.env.TF_SPOKES_FILE || path.join(DATA, 'spokes-snapshot.json'), 'utf8'));
      cache = { spokes: [...(snap.groups?.A || []), ...(snap.groups?.B || [])], flows: snap.mainnetFlows || [], xrpUsd: snap.xrpUsd ?? null };
    } catch { cache = { spokes: [], flows: [] }; }
    cacheAt = Date.now();
    return cache;
  };
}

export function register(app, ctx) {
  const { json, bus } = ctx;
  const mainFile = path.join(DATA, 'incubator.json');
  // Read-only / private instances seed from data/incubator.json and write data/incubator.readonly-<PORT>.json.
  const file = process.env.TF_INCUBATOR_FILE || (process.env.TF_READONLY === '1' ? path.join(DATA, `incubator.readonly-${process.env.PORT || 'x'}.json`) : mainFile);
  const inc = new Incubator({ file, seedFile: file !== mainFile ? mainFile : null, bus, spokesSource: spokesSource(ctx) });
  ctx.incubator = inc;

  const guard = (fn, { local = false } = {}) => async (req, res, params, body, url) => {
    if (local && !isLocal(req)) return json(res, 403, { error: 'Incubator changes are restricted to localhost (operator console).' });
    try { return json(res, 200, await fn(params, body || {}, url, req)); }
    catch (e) {
      if (e instanceof ProjectError) return json(res, e.status, { error: e.message, ...e.extra });
      return json(res, 500, { error: e.message });
    }
  };

  app.get('/api/incubator/projects', guard(() => inc.list()));
  app.get('/api/incubator/projects/:id', guard(({ id }) => inc.detail(id)));
  app.post('/api/incubator/projects', guard((p, body) => inc.create(body), { local: true }));
  app.post('/api/incubator/projects/:id/stack', guard(({ id }, body) => inc.setStack(id, body), { local: true }));
  app.post('/api/incubator/projects/:id/gates', guard(({ id }, body) => inc.setGates(id, body), { local: true }));
  app.post('/api/incubator/projects/:id/decision', guard(({ id }, body) => inc.decide(id, body), { local: true }));
  app.get('/api/incubator/radar', guard(() => inc.radar()));
  app.get('/api/incubator/compare', guard((p, b, url) => inc.compare(url.searchParams.get('a') || 'demo-aurora', url.searchParams.get('b') || 'demo-beacon')));
  app.get('/api/incubator/sentinel-signals', guard(() => inc.sentinelSignals()));
  app.get('/api/incubator/meta', guard(() => inc.meta()));
  app.get('/api/incubator/amendments', guard(() => ({ check: inc.amendmentCheck, nativeLending: nativeLendingStatus(inc.amendmentCheck) })));
  app.post('/api/incubator/reset', guard(() => inc.reset(), { local: true }));

  // ---------- TGLB Bootstrap studio ----------
  const limitBody = (b) => { if (JSON.stringify(b || {}).length > 20_000) throw new ProjectError(413, 'Request body too large.'); return b || {}; };
  app.get('/api/incubator/bootstrap/meta', guard(() => ({ title: BOOTSTRAP_TITLE, mode: 'SIMULATION', tiers: TIER_INFO, tierCombinations: TIER_COMBINATIONS, categories: CATEGORIES, incubationAssets: INCUBATION_ASSETS,
    legalItems: LEGAL_ITEMS, lending: { label: LENDING_LABEL, disclosure: DISCLOSURE, scorecard: SCORECARD, scenarios: SCENARIOS, permittedUses: PERMITTED_USES, restrictedUses: RESTRICTED_USES, structures: STRUCTURES, defaultTerms: DEFAULT_TERMS, pricing: PRICING,
      native: nativeLendingDecision(inc.amendmentCheck, { authorized: false }) }, xdlcEndpoint: XDLC_ENDPOINT, demoProject: DEMO_PROJECT })));
  app.get('/api/incubator/bootstrap/demo', guard(() => demoWalkthrough()));
  app.post('/api/incubator/bootstrap/plan', guard((p, body) => { const r = planBootstrap(limitBody(body)); if (!r.ok) throw new ProjectError(400, 'Bootstrap plan invalid.', { errors: r.errors }); return r; }));
  app.post('/api/incubator/loans/simulate', guard((p, body) => { const r = simulateLoan({ ...limitBody(body), amendmentCheck: inc.amendmentCheck }); if (!r.ok) throw new ProjectError(400, 'Loan simulation invalid.', { errors: r.errors }); return r; }));
  app.post('/api/incubator/bootstrap/demo/run', guard((p, body) => inc.bootstrapDemoRun(body), { local: true }));
  app.get('/api/incubator/loans', guard(() => inc.loans()));
  app.get('/api/incubator/loans/:id', guard(({ id }) => inc.loan(id)));
  app.post('/api/incubator/loans', guard((p, body) => inc.loanApply(limitBody(body)), { local: true }));
  app.post('/api/incubator/loans/:id/scenario', guard(({ id }, body) => inc.loanScenario(id, limitBody(body)), { local: true }));

  app.post('/api/incubator/amendments/refresh', guard(async () => {
    const client = ctx.ledger?.client;
    if (ctx.offline || !client) throw new ProjectError(503, 'Testnet client unavailable (offline or not bootstrapped). Showing the recorded check.', { check: inc.amendmentCheck });
    const request = async (req) => {
      if (!READ_COMMANDS.has(req.command)) throw new Error(`incubator: ${req.command} not allowed`);
      if (!client.isConnected()) await ctx.ledger.connect();
      return client.request(req);
    };
    try { const check = await runAmendmentCheck(request); inc.setAmendmentCheck(check); return { check, nativeLending: nativeLendingStatus(check) }; }
    catch (e) { throw new ProjectError(503, `Read-only check failed: ${e.message}. Showing the recorded check.`, { check: inc.amendmentCheck }); }
  }, { local: true }));
}
