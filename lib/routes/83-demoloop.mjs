// Demo loop API (LIVE_TESTNET, demo-generated, operator-approved capped sessions). See lib/demoloop.mjs and
// docs/SPEC_EXCEPTION_DEMO_LOOP.md. Start signs Testnet transactions: only the operator presses it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DemoLoop, LoopError, normalizeLoopConfig, LOOP_CAPS, STATEMENT } from '../demoloop.mjs';
import { flowShape } from '../pathfinder/profile.mjs';
import { catchBoard, CREATURES } from '../../public/creatures.js';
import { QUOTE } from '../ledger.mjs';

const FILE = process.env.TF_LOOP_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'demo-loop.json');
const readJson = (f) => { try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; } catch (e) { console.error('[loop]', e.message); return {}; } };

export function register(app, ctx) {
  const { json, bus, store } = ctx;
  let loop = null;
  // ctx.launches / ctx.pathfinder are registered by 10-launch and 80-pathfinder; build lazily so load order can't bite.
  const get = () => {
    if (loop) return loop;
    if (!ctx.launches || !ctx.pathfinder) throw new LoopError('Launch or Pathfinder plugin not loaded.', 503);
    loop = new DemoLoop({
      launch: (spec, extra) => ctx.launches.start(spec, extra),
      pathfinder: ctx.pathfinder,
      isTaken: (code) => !!store.byCode(code),
      capital: ctx.capital || null,
      corridor: ctx.corridor ? {
        simulate: (c, scenario, periods) => ctx.corridor.simulate(c, scenario, periods),
        promote: (c, o) => ctx.corridor.promote(c, o),
        demote: (c, o) => ctx.corridor.demote(c, o),
        stage: (c) => ctx.corridor.token(c)?.tracks?.SIMULATION?.stage ?? null,
      } : null,
      bus,
      persist: { load: () => readJson(FILE), save: (v) => { try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(v)); fs.renameSync(FILE + '.tmp', FILE); } catch (e) { console.error('[loop] save failed:', e.message); } } },
    });
    return loop;
  };
  const fail = (res, e) => json(res, e instanceof LoopError ? e.status : 500, { error: e.message, errors: e.errors });

  // Real Mainnet rate from the observed sample, for the side-by-side panel (MAINNET_OBSERVED, never mixed in).
  const mainnet = () => {
    const p = ctx.pathfinder?.profile?.();
    if (!p?.window?.seconds) return null;
    const t = p.totals, sec = p.window.seconds;
    return { mode: 'MAINNET_OBSERVED', window: p.window, sampledAt: p.sampledAt,
      perMinute: { payments: round(t.payments / sec * 60, 1), pathfound: round(t.pathfound / sec * 60, 1), endUser: round((t.endUser || 0) / sec * 60, 1) },
      totals: { payments: t.payments, pathfound: t.pathfound, partial: t.partial, endUser: t.endUser || 0, pathfoundShareOfPayments: t.pathfoundShareOfPayments },
      shape: flowShape(p).source,
      note: 'Observed third-party Mainnet activity (read-only sample). Not Titan Forge activity and never added to Testnet figures.' };
  };

  // Every validated demo fill on Testnet, sized in XRP: launch fills (QUOTE.fillQty × ask) + successful Pathfinder payments.
  const fills = () => {
    const out = [];
    for (const l of store.launches) if (l.status === 'live' && l.fillHash) out.push({ kind: 'direct', code: l.code, xrp: QUOTE.fillQty * Number(QUOTE.ask), at: l.completedAt || l.createdAt, hash: l.fillHash, loop: !!l.loop });
    for (const r of ctx.pathfinder?.runs?.() || []) for (const p of r.payments || []) if (p.status === 'success' && p.hash) out.push({ kind: 'pathfound', code: p.to === 'XRP' ? p.from : p.to, from: p.from, to: p.to, xrp: p.sizeXrp, at: p.at, hash: p.hash, loop: !!r.loop, bridged: !!p.attribution?.bridged, maker: (p.attribution?.capturedBy?.maker || 0) >= Math.max(p.attribution?.capturedBy?.rival || 0, p.attribution?.capturedBy?.other || 0) });
    return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  };
  app.get('/api/loop/catches', (req, res, params, body, url) => {
    const since = url?.searchParams?.get('session');
    const s = since && loop?.get(since);
    const list = fills().filter((f) => !s || Date.parse(f.at) >= Date.parse(s.startedAt));
    json(res, 200, { mode: 'LIVE_TESTNET', organic: false, scope: s ? `session ${s.id.slice(0, 8)}` : 'all demo fills', unit: 'XRP per fill',
      note: 'Each validated Testnet fill between our own demo accounts, classed by size. Demo sizes are 0.05–2 XRP, so only the small creatures appear.',
      ...catchBoard(list), recent: list.slice(-12).reverse(), ladder: CREATURES.length });
  });

  app.get('/api/loop/status', (req, res) => {
    try { json(res, 200, { ...get().status(), ledgerReady: ctx.ledgerReady, readonlyInstance: process.env.TF_READONLY === '1', anchors: ctx.pathfinder.liveTokens(), mainnet: mainnet() }); }
    catch (e) { json(res, 200, { mode: 'LIVE_TESTNET', organic: false, statement: STATEMENT, caps: LOOP_CAPS, running: false, session: null, history: [], error: e.message, mainnet: null }); }
  });

  app.post('/api/loop/start', (req, res, params, body) => {
    if (!ctx.ledgerReady) return json(res, 503, { error: ctx.ledgerError ? `Testnet unavailable: ${ctx.ledgerError}` : 'Testnet not ready' });
    try {
      const l = get();
      const cfg = normalizeLoopConfig(body, ctx.pathfinder.liveTokens());
      const s = l.start(cfg, { approved: body?.approved });
      json(res, 202, { id: s.id, status: s.status, config: s.config, deadline: s.deadline, mode: 'LIVE_TESTNET', organic: false });
    } catch (e) { fail(res, e); }
  });

  // Stop never signs anything new; the in-flight step finishes and the Pathfinder run cancels its quotes.
  app.post('/api/loop/stop', (req, res) => {
    try { const s = get().stop(); json(res, 200, s ? { id: s.id, status: s.status } : { status: 'idle' }); }
    catch (e) { fail(res, e); }
  });

  app.get('/api/loop/sessions/:id', (req, res, { id }) => {
    try { const s = get().get(id); return s ? json(res, 200, s) : json(res, 404, { error: 'Unknown session' }); }
    catch (e) { fail(res, e); }
  });
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
