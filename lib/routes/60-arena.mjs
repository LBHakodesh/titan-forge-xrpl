// Titan Arena — Bootstrap Challenge API. Sessions in memory; leaderboard in data/arena.json.
// Game state is SIMULATION. Linking a real launched token reads its recorded LIVE_TESTNET facts
// (and, if the ledger is ready, a fresh read-only book_offers). Nothing here signs or submits.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession, applyAction, publicView, validateAlias, normalizeSeed, ArenaError, META } from '../arena.mjs';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const MAX_SESSIONS = 2000;
const SESSION_TTL_MS = 6 * 3600_000;
const BOARD_MAX = 200;

export function register(app, ctx) {
  const { json, bus, store } = ctx;
  const file = process.env.TF_ARENA_FILE || path.join(DATA, 'arena.json');
  let board = [];
  try { if (fs.existsSync(file)) board = JSON.parse(fs.readFileSync(file, 'utf8')).leaderboard || []; } catch (e) { console.error('[arena] leaderboard unreadable:', e.message); }
  const save = () => {
    try { fs.writeFileSync(file + '.tmp', JSON.stringify({ leaderboard: board }, null, 2)); fs.renameSync(file + '.tmp', file); }
    catch (e) { console.error('[arena] leaderboard save failed:', e.message); }
  };
  const sessions = new Map(); // id -> { state, touched, submitted }
  const prune = () => {
    const now = Date.now();
    for (const [id, s] of sessions) if (now - s.touched > SESSION_TTL_MS) sessions.delete(id);
    while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  };
  const bad = (res, e) => json(res, e instanceof ArenaError ? 400 : 500, { error: e.message });

  function submit(entry) {
    const st = entry.state;
    if (entry.submitted || st.step !== 'debrief' || !st.alias) return false;
    entry.submitted = true;
    board.push({ alias: st.alias, score: st.score.total, max: st.score.max, mode: 'SIMULATION', seed: st.seed,
      linkedToken: st.project?.linked ? { code: st.project.linked.code, mode: 'LIVE_TESTNET' } : null,
      promoted: !!st.promotion?.granted, at: st.completedAt });
    board.sort((a, b) => b.score - a.score || String(a.at).localeCompare(String(b.at)));
    board = board.slice(0, BOARD_MAX);
    save();
    return true;
  }

  app.get('/api/arena/meta', (req, res) => json(res, 200, { mode: 'SIMULATION', ...META }));

  app.get('/api/arena/leaderboard', (req, res) => json(res, 200, {
    mode: 'SIMULATION', note: 'Arena scores are simulated game results, not trading performance or demand.', entries: board.slice(0, 50),
  }));

  app.post('/api/arena/start', (req, res, params, body) => {
    try {
      prune();
      const al = validateAlias(body?.alias);
      if (!al.ok) return json(res, 400, { error: al.errors.join(' ') });
      const seed = normalizeSeed(body?.seed) ?? crypto.randomInt(1, 2 ** 31);
      const id = crypto.randomUUID();
      const state = createSession({ id, seed, alias: al.value, now: new Date().toISOString() });
      sessions.set(id, { state, touched: Date.now(), submitted: false });
      bus.publish('arena.step', 'SIMULATION', { sessionId: id, step: state.step, alias: state.alias || null });
      json(res, 201, publicView(state));
    } catch (e) { bad(res, e); }
  });

  app.post('/api/arena/:id/action', async (req, res, { id }, body) => {
    const entry = sessions.get(id);
    if (!entry) return json(res, 404, { error: 'Unknown or expired Arena session. Start a new one.' });
    const action = body && typeof body === 'object' ? { ...body } : {};
    try {
      let launch = null;
      if (action.type === 'link') {
        launch = store.get(String(action.launchId || ''));
        if (!launch || launch.status !== 'live') return json(res, 400, { error: 'Choose a live Testnet token from the launch list.' });
        action.book = null; action.bookMode = undefined;
        if (ctx.ledgerReady) { // read-only query; fall back to the recorded book (REPLAY) if slow or unavailable
          const fresh = await Promise.race([ctx.ledger.book(launch.code).catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))]);
          if (fresh) { action.book = fresh; action.bookMode = 'LIVE_TESTNET'; }
        }
      } else { delete action.book; delete action.bookMode; }
      const prevStep = entry.state.step;
      entry.state = applyAction(entry.state, action, { launch, now: new Date().toISOString() });
      entry.touched = Date.now();
      const st = entry.state;
      if (st.step !== prevStep) bus.publish('arena.step', 'SIMULATION', { sessionId: id, step: st.step, alias: st.alias || null });
      if (prevStep !== 'debrief' && st.step === 'debrief') {
        bus.publish('arena.completed', 'SIMULATION', { sessionId: id, alias: st.alias || null, score: st.score.total, max: st.score.max,
          linkedToken: st.project?.linked?.code || null, promoted: !!st.promotion?.granted });
      }
      const onBoard = submit(entry);
      json(res, 200, { ...publicView(st), onLeaderboard: entry.submitted, justSubmitted: onBoard });
    } catch (e) { bad(res, e); }
  });

  app.get('/api/arena/:id', (req, res, { id }) => {
    const entry = sessions.get(id);
    if (!entry) return json(res, 404, { error: 'Unknown or expired Arena session.' });
    json(res, 200, { ...publicView(entry.state), onLeaderboard: entry.submitted });
  });
}
