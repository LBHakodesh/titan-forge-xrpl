// Titan Sentinel unified findings registry routes. Observes and recommends only.
// GETs are public read-only views. POSTs change registry records only (status, notes, root cause, re-collect from
// read-only sources) and are restricted to direct localhost callers. No route can trigger any ledger, wallet,
// liquidity, offer, permission or service action.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FindingsRegistry, FindingsService, STATUSES, VERIFICATIONS, provenanceClass, classify } from '../findings/index.mjs';
import { Sentinel } from '../sentinel.mjs';
import { entitlements } from '../entitlement/index.mjs';
import { engineStatus } from '../engine/index.mjs';
import { observeServerInfo, observationSource, PUBLIC_TESTNET_LABEL } from '../vendors/observation.mjs';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const REFRESH_MS = 10 * 60_000;
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// Direct loopback caller, JSON content type (forces a CORS preflight for cross-site pages) and no foreign Origin.
export function isLocalRequest(req) {
  const ip = req.socket?.remoteAddress;
  if (!LOCAL.has(ip)) return false;
  if (req.headers['x-forwarded-for'] || req.headers['forwarded']) return false; // a fronting proxy makes every caller look local
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return false;
  const origin = req.headers.origin;
  if (origin) { try { const u = new URL(origin); if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return false; } catch { return false; } }
  return true;
}

export function register(app, ctx) {
  const { json, bus } = ctx;
  const readonly = process.env.TF_READONLY === '1';
  // Read-only instances share data/ with the main server: they load findings.json but keep changes in memory.
  const file = process.env.TF_FINDINGS_FILE || path.join(DATA, 'findings.json');
  const registry = new FindingsRegistry({ file, persist: !readonly || !!process.env.TF_FINDINGS_FILE, bus, log: (m) => console.error('[findings]', m) });
  // Sentinel token scans are reads; give it a silent bus so it does not re-publish sentinel.finding events.
  const sentinel = new Sentinel({ ...ctx, bus: { publish() {} }, get ledgerReady() { return ctx.ledgerReady; } });
  const port = process.env.PORT || 4131;
  let lastLedgerSource = observationSource().provider === 'quicknode' ? null : { provider: 'public', label: PUBLIC_TESTNET_LABEL };
  const svc = new FindingsService({
    registry, bus, log: (m) => console.error('[findings]', m),
    env: {
      dataDir: DATA,
      ledgerReady: () => ctx.ledgerReady,
      launches: () => ctx.store.launches,
      sentinel,
      entitlements,
      engineStatus,
      routeExists: (p) => !!app.match('GET', p),
      fetchJson: async (p) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(`${p} -> HTTP ${r.status}`); return r.json(); },
      // TG Sentinel universal collectors. Reads only: server_info, account_info (via Sentinel's 30 s read cache), same-origin GETs.
      offline: !!ctx.offline,
      ledgerError: () => ctx.ledgerError,
      pathfinderRuns: () => ctx.pathfinder?.runs?.() ?? null,
      // Prefers QuickNode (QUICKNODE_XRPL_WSS, read-only observer) when it serves Testnet; else the public Testnet client.
      serverInfo: (() => { let memo = null; return async () => {
        if (memo && Date.now() - memo.at < 20_000) return memo.p;
        const p = observeServerInfo({ fallbackRequest: (r) => ctx.ledger.client.request(r), timeoutMs: 8000 }).then((o) => { lastLedgerSource = o.source; return o.info; });
        memo = { at: Date.now(), p }; p.catch(() => { memo = null; }); return p;
      }; })(),
      serverInfoSource: () => lastLedgerSource,
      accounts: async () => {
        const out = {};
        for (const [role, addr] of Object.entries(sentinel.roles())) {
          try { const r = await sentinel.req({ command: 'account_info', account: addr, signer_lists: true, ledger_index: 'validated' }); out[role] = { address: addr, xrp: Number(r.account_data.Balance) / 1e6, ownerCount: r.account_data.OwnerCount }; }
          catch (e) { out[role] = /actNotFound|Account not found/i.test(String(e?.data?.error || e?.message)) ? { address: addr, unfunded: true } : null; }
        }
        if (!Object.values(out).some(Boolean)) throw new Error('No account balance could be read.');
        return out;
      },
      probe: async (p) => { const t0 = Date.now(); try { const r = await fetch(`http://127.0.0.1:${port}${p}`, { signal: AbortSignal.timeout(5000) }); await r.arrayBuffer(); return { path: p, status: r.status, ms: Date.now() - t0 }; } catch (e) { return { path: p, status: null, ms: Date.now() - t0, error: e.name === 'TimeoutError' ? 'timeout after 5000 ms' : e.message }; } },
    },
  });
  ctx.findings = svc; // other modules may read (never required)

  const kick = () => svc.collect().catch((e) => console.error('[findings] collect failed', e.message));
  setTimeout(kick, 1500).unref?.();
  setTimeout(kick, 30_000).unref?.(); // second pass once Testnet and late routes are up
  setInterval(kick, REFRESH_MS).unref?.();

  const pick = (url) => Object.fromEntries(['severity', 'category', 'product', 'market', 'status', 'verification', 'provenance', 'q'].map((k) => [k, url.searchParams.get(k) || '']).filter(([, v]) => v));
  const view = (f, full = false) => full ? f : (({ history, notes, occurrences, ...rest }) => ({ ...rest, provenanceClass: provenanceClass(f), subsystem: classify(f).id, historyLength: history.length, notesCount: notes.length, lastChange: history.at(-1) ? { action: history.at(-1).action, at: history.at(-1).at, hash: history.at(-1).hash } : null }))(f);
  const local = (req, res) => { if (isLocalRequest(req)) return true; json(res, 403, { error: 'Registry changes are restricted to direct localhost callers (Content-Type: application/json, no proxy, local origin).' }); return false; };
  const actor = (body) => `operator:${String(body?.actor || 'localhost').replace(/[^\w.@:-]/g, '').slice(0, 40) || 'localhost'}`;

  app.get('/api/findings', (req, res, p, b, url) => {
    const q = pick(url); const list = registry.list(q);
    json(res, 200, { filters: q, count: list.length, findings: list.map((f) => view(f)), head: registry.head, note: 'Observes and recommends only. Every finding carries verification and provenance.' });
  });
  app.get('/api/findings/summary', (req, res, p, b, url) => { const q = pick(url); json(res, 200, { filters: q, ...svc.summary(Object.keys(q).length ? q : null), head: registry.head }); });
  app.get('/api/findings/sources', (req, res) => json(res, 200, svc.sources()));
  app.get('/api/findings/verify', (req, res) => json(res, 200, registry.verify()));
  app.get('/api/findings/report', (req, res, p, b, url) => {
    const md = svc.report();
    if (url.searchParams.get('format') === 'json') return json(res, 200, { markdown: md });
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(md);
  });
  app.post('/api/findings/collect', async (req, res) => { if (!local(req, res)) return; json(res, 200, { statuses: await svc.collect(), note: 'Re-read sources only; nothing outside the registry changed.' }); });
  app.get('/api/findings/:id', (req, res, { id }) => { const f = registry.get(id); return f ? json(res, 200, f) : json(res, 404, { error: `Unknown finding ${id}` }); });

  app.post('/api/findings/:id/status', (req, res, { id }, body = {}) => {
    if (!local(req, res)) return;
    if (!registry.get(id)) return json(res, 404, { error: `Unknown finding ${id}` });
    const patch = {};
    if (body.status !== undefined) { if (!STATUSES.includes(body.status)) return json(res, 400, { error: `status must be one of ${STATUSES.join(', ')}` }); patch.status = body.status; }
    for (const k of ['owner', 'severity', 'verification']) if (body[k] !== undefined) patch[k] = String(body[k]);
    try { const r = registry.update(id, patch, { actor: actor(body), note: String(body.note || '') }); json(res, 200, { changed: r.changed, finding: r.finding }); }
    catch (e) { json(res, 400, { error: e.message }); }
  });
  app.post('/api/findings/:id/notes', (req, res, { id }, body = {}) => {
    if (!local(req, res)) return;
    try { json(res, 200, { finding: registry.addNote(id, body.note, { actor: actor(body) }) }); } catch (e) { json(res, /Unknown/.test(e.message) ? 404 : 400, { error: e.message }); }
  });
  // Root-cause hook (e.g. the Pathfinder NO_PATH diagnosis). Evidence may be attached; nothing is deleted.
  app.post('/api/findings/:id/root-cause', (req, res, { id }, body = {}) => {
    if (!local(req, res)) return;
    const verification = body.verification || 'SUSPECTED';
    if (!VERIFICATIONS.includes(verification)) return json(res, 400, { error: `verification must be one of ${VERIFICATIONS.join(', ')}` });
    try { json(res, 200, registry.setRootCause(id, { summary: String(body.summary || ''), verification, evidence: Array.isArray(body.evidence) ? body.evidence.slice(0, 20) : [], actor: actor(body) })); }
    catch (e) { json(res, /Unknown/.test(e.message) ? 404 : 400, { error: e.message }); }
  });
}
