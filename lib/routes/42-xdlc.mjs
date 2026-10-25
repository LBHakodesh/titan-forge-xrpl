// XDLC application lifecycle + TG Intelligence Opportunity Radar + capital redeployment walk-through (namespace /api/xdlc).
//   GET  /api/xdlc/radar                     ranked candidates with factor contributions + rationale (demo adapter)
//   GET  /api/xdlc/corridors                 corridor summaries (state, funding categories, chain verification)
//   GET  /api/xdlc/corridors/:id             corridor + hash-chained transition log
//   POST /api/xdlc/corridors                 create {marketId, label?, pair?, origin?, radarId?}           (localhost)
//   POST /api/xdlc/corridors/:id/advance     {to, evidence?, funding?, approved?}                          (localhost)
//   GET  /api/xdlc/redeploy/plan             read-only preview (never approved)
//   POST /api/xdlc/redeploy/run              {approved?} scripted deterministic walk-through, SIMULATION    (localhost)
//   GET  /api/xdlc/sentinel-signals          risk signals for the Sentinel findings collector
// XDLC is a PROPOSED XRPL amendment; this lifecycle is Titan Ghost application logic. Nothing here signs or submits on
// any network and the route never touches ctx.ledger. `approved` is only ever taken from an operator request body.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar } from '../xdlc/radar.mjs';
import { XdlcStore, knownHashesFrom, STATES, verifyChain } from '../xdlc/lifecycle.mjs';
import { runRedeploy, planRedeploy, sentinelRisks } from '../xdlc/redeploy.mjs';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const isLocal = (req) => LOCAL.has(req.socket?.remoteAddress) && !req.headers['x-forwarded-for'];
const readJson = (f, fallback = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };

function makeSources(ctx) {
  let snapCache = null, snapAt = 0;
  const spokes = () => {
    if (ctx.spokes?.response) {
      try { const r = ctx.spokes.response(); return { spokes: [...r.groups.A.spokes, ...r.groups.B.spokes].filter((s) => !s.placeholder), xrpUsd: ctx.spokes.snap?.xrpUsd ?? null, attributionHtml: r.snapshot?.attributionHtml || null }; } catch { /* fall back to file */ }
    }
    if (snapCache && Date.now() - snapAt < 60_000) return snapCache;
    const snap = readJson(process.env.TF_SPOKES_FILE || path.join(DATA, 'spokes-snapshot.json'), {});
    snapCache = { spokes: [...(snap.groups?.A || []), ...(snap.groups?.B || [])].filter((s) => s && !s.placeholder), xrpUsd: snap.xrpUsd ?? null, attributionHtml: '<a href="https://xrpl.to" target="_blank" rel="noopener">Data by xrpl.to</a>' };
    snapAt = Date.now();
    return snapCache;
  };
  const profile = () => readJson(path.join(DATA, 'mainnet-profile.json'));
  const evidence = () => readJson(path.join(DATA, 'pathfinder-evidence.json'))?.evidence || null;
  return { spokes, profile, evidence };
}

export function register(app, ctx) {
  const { json, bus } = ctx;
  const src = makeSources(ctx);
  const launches = () => ctx.store?.launches || readJson(path.join(DATA, 'launches.json'), []);
  const knownHashes = knownHashesFrom({ launches: launches(), pathfinderEvidence: src.evidence() });
  const bbl = launches().find((l) => l.code === 'BBL' && l.fillHash);
  const mainFile = path.join(DATA, 'xdlc.json');
  // Read-only / private instances never write data/xdlc.json: they seed from it and keep changes in memory.
  const file = process.env.TF_XDLC_FILE || (process.env.TF_READONLY === '1' ? null : mainFile);
  const store = new XdlcStore({ file, seedFile: file === mainFile ? null : mainFile, bus, knownHashes, bblFillHash: bbl?.fillHash || null });
  ctx.xdlc = store;

  const radar = () => { const s = src.spokes(); return { ...buildRadar({ spokes: s.spokes, xrpUsd: s.xrpUsd, profile: src.profile(), pathfinderEvidence: src.evidence() }), attributionHtml: s.attributionHtml }; };
  let lastRadarTop = null;

  const guard = (fn, { local = false } = {}) => async (req, res, params, body, url) => {
    if (local && !isLocal(req)) return json(res, 403, { error: 'XDLC changes are restricted to localhost (operator console).' });
    try { return json(res, 200, await fn(params, body || {}, url, req)); }
    catch (e) { return json(res, e.status || 500, { error: e.message, ...(e.reasons ? { reasons: e.reasons } : {}), ...(e.guardian ? { guardian: e.guardian } : {}) }); }
  };

  app.get('/api/xdlc/radar', guard(() => {
    const r = radar();
    const top = r.ranking[0]?.id || null;
    if (top !== lastRadarTop) { lastRadarTop = top; bus?.publish('xdlc.radar', 'SIMULATION', { top, candidates: r.ranking.length, positive: r.ranking.filter((c) => c.netPositive).length, model: r.model.name, engineLabel: r.engine.label }); }
    return r;
  }));
  app.get('/api/xdlc/corridors', guard(() => store.list()));
  app.get('/api/xdlc/corridors/:id', guard(({ id }) => { const c = store.get(id); if (!c) throw Object.assign(new Error('Unknown corridor'), { status: 404 }); return c; }));
  app.post('/api/xdlc/corridors', guard((p, body) => store.create(body), { local: true }));
  app.post('/api/xdlc/corridors/:id/advance', guard(({ id }, body) => store.advance(id, body), { local: true }));

  const redeployArgs = () => { const s = src.spokes(); return { radar: buildRadar({ spokes: s.spokes, xrpUsd: s.xrpUsd, profile: src.profile(), pathfinderEvidence: src.evidence() }), spokes: s.spokes, xrpUsd: s.xrpUsd }; };
  app.get('/api/xdlc/redeploy/plan', guard(() => planRedeploy(redeployArgs())));
  app.post('/api/xdlc/redeploy/run', guard((p, body) => {
    // approved is true ONLY when the operator's request says so explicitly; the server never sets it.
    const out = runRedeploy({ ...redeployArgs(), approved: body.approved === true, approvedBy: body.approved === true ? 'operator console' : null });
    for (const s of out.steps) bus?.publish('xdlc.redeploy_step', 'SIMULATION', { runId: out.runId, index: s.index, total: out.steps.length, step: s.id, title: s.title, status: s.status, approved: out.approved });
    return out;
  }, { local: true }));

  app.get('/api/xdlc/sentinel-signals', guard(() => {
    const now = new Date().toISOString();
    const signals = [];
    const plan = planRedeploy(redeployArgs());
    const risks = plan.steps.find((s) => s.id === 'sentinel_risks')?.risks || sentinelRisks({});
    for (const r of risks) signals.push({ ...r, remediation: 'Review before any operator approval; SIMULATION only.', observedAt: now });
    for (const c of Object.values(store.state.corridors)) {
      const v = verifyChain(c.log);
      if (!v.ok) signals.push({ id: `chain:${c.id}`, key: `xdlc:chain:${c.id}`, severity: 'high', market: c.marketId, title: `XDLC transition log for ${c.id} fails hash-chain verification`, evidence: [{ label: 'verify', value: v.reason }], provenance: 'SIMULATION', verification: 'SIMULATED', category: 'xdlc', product: 'TG', remediation: 'Investigate tampering of data/xdlc.json.', observedAt: now });
      if (['APPROVAL_PENDING', 'MATURE'].includes(c.state)) signals.push({ id: `pending:${c.id}`, key: `xdlc:pending:${c.id}`, severity: 'info', market: c.marketId, title: `${c.label}: next step ${STATES[STATES.indexOf(c.state) + 1]} needs explicit operator approval`, evidence: [{ label: 'state', value: c.state }], provenance: 'SIMULATION', verification: 'SIMULATED', category: 'xdlc', product: 'TG', remediation: 'Operator decision required; the server never self-approves.', observedAt: now });
    }
    return { mode: 'SIMULATION', signals, note: 'SIMULATION concerns from the XDLC application lifecycle and radar. Read-only; nothing here records findings itself.' };
  }));
}
