// Titan Ghost Engine Theater API (read-only; nothing here signs, submits or pays).
//   GET /api/theater/state              real telemetry (LIVE_TESTNET / MAINNET_OBSERVED) + model metadata (SIMULATION)
//   GET /api/theater/history[?refresh=1] HISTORICAL_MAINNET (Titan Ghost's own Mainnet accounts, read-only; refresh: localhost)
//   GET /api/theater/scenario/:id[?seed=N] seeded SIMULATION scenario (DOLPHIN|SHARK|WHALE|KRAKEN), never has tx hashes
//   GET /api/theater/capture[?file=name] authentic TUI capture replay (data/tui-captures/), or status 'none'
//   GET /api/theater/observe            fill observation: re-reads the latest recorded fills (tx, read-only), preferring
//                                       QuickNode (QUICKNODE_XRPL_WSS) when it serves Testnet, else the public Testnet node
// Event: theater.scenario (SIMULATION) {scenario, seed, fills, ringsSwept, volumeUsd, hypothetical:true}.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RINGS, MARKETS } from '../../public/domain.js';
import { CREATURES } from '../../public/creatures.js';
import { getEngine } from '../engine/index.mjs';
import { generateScenario, scenarioCatalog, MODEL_BOOK_USD, MODEL_XRP_USD } from '../theater/scenarios.mjs';
import { loadCapture, listCaptures, NONE_MSG } from '../theater/capture.mjs';
import { loadHistory, refreshHistory, parseAccounts, readCache, HISTORY_FILE } from '../theater/mainnet-history.mjs';
import { liveTelemetry, mainnetSummary } from '../theater/telemetry.mjs';
import { observationSource, sourceView, observeFills } from '../vendors/observation.mjs';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const STALE_MS = 15 * 60_000, MIN_GAP_MS = 60_000;
export const RECREATION_LABEL = 'Browser recreation of the Titan Ghost TUI layout — authentic TUI capture pending from NY-Node';
export const LABELS = {
  LIVE_TESTNET: 'Validated XRPL Testnet activity between Titan Forge demo accounts (organic:false).',
  MAINNET_OBSERVED: 'Read-only sample of third-party XRPL Mainnet activity. Not Titan Ghost activity.',
  HISTORICAL_MAINNET: "Titan Ghost's own historical Mainnet activity, read-only from public addresses the Commander supplies.",
  SIMULATION: 'Hypothetical: modeled ring depth and fills. No transaction exists; no hash.',
  REPLAY: 'Recorded data replayed (offline mode or authentic TUI capture).',
};

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

export function register(app, ctx) {
  const { json, bus, store } = ctx;
  let refreshing = null, lastRefresh = 0;

  const startRefresh = () => {
    if (refreshing || ctx.offline || Date.now() - lastRefresh < MIN_GAP_MS) return refreshing;
    lastRefresh = Date.now();
    refreshing = refreshHistory({ offline: ctx.offline }).catch((e) => ({ status: 'error', error: e.message })).finally(() => { refreshing = null; });
    return refreshing;
  };
  // Background refresh when addresses are configured and the cache is missing or stale. Never in offline mode.
  const maybeAuto = () => {
    if (ctx.offline || !parseAccounts().accounts.length) return;
    const c = readCache(HISTORY_FILE);
    if (!c?.fetchedAt || Date.now() - Date.parse(c.fetchedAt) > STALE_MS) startRefresh();
  };

  const strategic = () => {
    // Shadow-only: the engine's recommendations over the four demo markets at an equal modeled capital split. Never executed.
    const eng = getEngine();
    const markets = MARKETS.map((m, i) => ({ marketId: m.id, capitalUsd: MODEL_BOOK_USD / MARKETS.length, flowScale: [1, 0.6, 0.3, 0.8][i], ringsActive: [6, 4, 3, 5][i] }));
    let recs = [];
    try { recs = eng.recommend(markets); } catch (e) { recs = [{ action: 'error', rationale: e.message }]; }
    return { mode: 'SIMULATION', shadowOnly: true, executed: false, source: eng.info().label, inputs: markets, recommendations: recs,
      note: 'Shadow-only: observations are computed and displayed, never acted on. Inputs are modeled, not market data.' };
  };
  const efficiency = () => {
    const eng = getEngine();
    const a = eng.allocate(MODEL_BOOK_USD, {});
    return { mode: 'SIMULATION', source: eng.info().label, capitalUsd: MODEL_BOOK_USD, deployedUsd: a.deployedUsd, idleUsd: a.idleUsd, dailyEarnUsd: a.dailyEarnUsd, yieldBpsOnDeployed: a.yieldBpsOnDeployed,
      rings: a.rings.map((r) => ({ id: r.id, allocUsd: r.allocUsd, utilization: r.utilization, marginalBps: r.marginalBps })) };
  };

  app.get('/api/theater/state', (req, res) => {
    maybeAuto();
    const eng = getEngine().info();
    const cap = listCaptures();
    const hist = loadHistory();
    let live;
    try { live = liveTelemetry(ctx.pathfinder?.runs?.() || readJson(path.join(DATA, 'pathfinder-runs.json'))?.runs || []); } catch (e) { live = { mode: 'LIVE_TESTNET', error: e.message }; }
    json(res, 200, {
      title: 'Titan Ghost Engine Theater', recreation: RECREATION_LABEL, labels: LABELS, offline: !!ctx.offline,
      engine: { id: eng.id, label: eng.label, authentic: !!eng.authentic, note: eng.note || null },
      rings: RINGS.map((r) => ({ ...r, paramsNote: 'illustrative demo parameters, not authentic Titan Ghost values' })),
      creatures: CREATURES.map((c) => ({ id: c.id, emoji: c.emoji, min: c.min, max: c.max === Infinity ? null : c.max, zone: c.zone })),
      scenarios: scenarioCatalog(), model: { xrpUsd: MODEL_XRP_USD, bookUsd: MODEL_BOOK_USD, mode: 'SIMULATION' },
      liveTokens: (store?.launches || []).filter((l) => l.status === 'live').map((l) => l.code),
      live, observation: { ...sourceView(observationSource()), endpoint: 'GET /api/theater/observe' }, mainnet: mainnetSummary(readJson(path.join(DATA, 'mainnet-profile.json'))),
      strategic: strategic(), efficiency: efficiency(),
      capture: cap.length ? { status: 'available', files: cap } : { status: 'none', message: NONE_MSG },
      history: { status: hist.status, message: hist.message || null, accounts: hist.accounts, fills: hist.fills?.length || 0, refreshing: !!refreshing },
    });
  });

  app.get('/api/theater/history', async (req, res, params, body, url) => {
    if (url?.searchParams?.get('refresh') === '1') {
      if (!LOCAL.has(req.socket?.remoteAddress) || req.headers['x-forwarded-for']) return json(res, 403, { error: 'History refresh is restricted to localhost.' });
      if (ctx.offline) return json(res, 503, { ...loadHistory(), offline: true, error: 'Offline replay mode: Mainnet not contacted.' });
      const p = startRefresh();
      if (p) { const r = await p; return json(res, 200, { ...r, refreshing: false }); }
      return json(res, 200, { ...loadHistory(), note: `Refresh rate-limited (one per ${MIN_GAP_MS / 1000}s).` });
    }
    maybeAuto();
    json(res, 200, { ...loadHistory(), refreshing: !!refreshing });
  });

  app.get('/api/theater/scenario/:id', (req, res, { id }, body, url) => {
    const seed = Number.parseInt(url?.searchParams?.get('seed') || '1', 10);
    try {
      const eng = getEngine();
      const s = generateScenario(id, { seed: Number.isFinite(seed) ? seed : 1, allocate: (c, o) => eng.allocate(c, o), engineLabel: eng.info().label });
      bus?.publish?.('theater.scenario', 'SIMULATION', { scenario: s.scenario, seed: s.seed, fills: s.totals.fills, ringsSwept: s.totals.ringsSwept, volumeUsd: s.totals.volumeUsd, hypothetical: true });
      json(res, 200, s);
    } catch (e) { json(res, e.status || 500, { error: e.message }); }
  });

  // Fill observation (read-only). Cached 30 s so the page cannot hammer either endpoint.
  let observed = null;
  app.get('/api/theater/observe', async (req, res) => {
    if (ctx.offline) return json(res, 200, { mode: 'REPLAY', status: 'offline', source: sourceView(observationSource()), fills: [], note: 'Offline replay mode: no network reads.' });
    if (observed && Date.now() - observed.t < 30_000) return json(res, 200, { ...observed.body, cached: true });
    let live;
    try { live = liveTelemetry(ctx.pathfinder?.runs?.() || readJson(path.join(DATA, 'pathfinder-runs.json'))?.runs || []); } catch { live = { fills: [] }; }
    const hashes = (live.fills || []).map((f) => f.hash);
    try {
      const body = await observeFills({ hashes, fallbackRequest: ctx.ledgerReady ? (r) => ctx.ledger.client.request(r) : null });
      observed = { t: Date.now(), body };
      json(res, 200, body);
    } catch (e) { json(res, 200, { mode: 'UNAVAILABLE', status: 'unavailable', source: sourceView(observationSource()), fills: [], error: e.message }); }
  });

  app.get('/api/theater/capture', (req, res, params, body, url) => json(res, 200, loadCapture(url?.searchParams?.get('file') || undefined)));
}
