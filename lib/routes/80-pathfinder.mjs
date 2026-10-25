// Pathfinder Flow API.
//   MAINNET_OBSERVED: read-only Mainnet pathfinding profile (MainnetObserver only; never signs).
//   LIVE_TESTNET: plan (dry run, read-only) and approved live replay runs of that flow shape on Testnet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MainnetObserver } from '../mainnet-observer.mjs';
import { sampleProfile, profileSummary, flowShape, mergeAggregates, MODE as MAINNET } from '../pathfinder/profile.mjs';
import { PathfinderRunner, PathfinderError, normalizeOptions, CAPS, STATEMENT } from '../pathfinder/replay.mjs';
import { publicStrategies } from '../pathfinder/strategies.mjs';
import { testnetIO } from '../pathfinder/testnet-io.mjs';
import { buildEvidence, collectRaw, EVIDENCE_VERSION } from '../pathfinder/evidence.mjs';
import { continuityDryRun, buildContinuityPlan, OFFLINE_STATE } from '../pathfinder/continuity.mjs';

const DATA = process.env.TF_PATHFINDER_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const PROFILE_FILE = path.join(DATA, 'mainnet-profile.json');
const RUNS_FILE = path.join(DATA, 'pathfinder-runs.json');
const EVIDENCE_FILE = path.join(DATA, 'pathfinder-evidence.json');
const REFRESH_MIN_MS = 2 * 60_000;
const DEFAULT_LEDGERS = 40;

const readJson = (f, fallback) => { try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fallback; } catch (e) { console.error('[pathfinder]', f, e.message); return fallback; } };
const writeJson = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); };

export function register(app, ctx) {
  const { json, bus, store, ledger } = ctx;
  let profile = readJson(PROFILE_FILE, null);
  const sampler = { status: 'idle', progress: null, startedAt: null, lastError: null, abort: null, lastStart: 0 };

  const runner = new PathfinderRunner({
    io: testnetIO(ledger), bus,
    persist: { load: () => readJson(RUNS_FILE, {}), save: (v) => { try { writeJson(RUNS_FILE, v); } catch (e) { console.error('[pathfinder] save failed:', e.message); } } },
  });
  // A run interrupted by a restart can't resume; mark it so the UI doesn't show it as running forever.
  for (const r of runner.runs) if (r.status === 'running' || r.status === 'queued') { r.status = 'failed'; r.error = 'Interrupted by server restart (leftover quotes are cancelled at the start of the next run).'; }

  const liveTokens = () => store.launches.filter((l) => l.status === 'live').map((l) => l.code);
  const fail = (res, e) => json(res, e instanceof PathfinderError ? e.status : 500, { error: e.message, errors: e.errors });
  const readonly = () => process.env.TF_READONLY === '1';
  // Used by the demo loop (lib/routes/83-demoloop.mjs): same runner, caps, Guardian checks and budget as POST /run.
  ctx.pathfinder = {
    liveTokens,
    start: (body, { approved, loop }) => runner.start(normalizeOptions(body, liveTokens()), profile, { approved, loop }),
    done: (id) => runner.done.get(id),
    paymentsLastHour: () => runner.paymentsLastHour(),
    profile: () => profile,
    runs: () => runner.runs,
    stop: (id) => runner.stop(id),
  };

  app.get('/api/pathfinder/profile', (req, res) => json(res, 200, {
    mode: MAINNET, profile, sampler: { status: sampler.status, progress: sampler.progress, startedAt: sampler.startedAt, lastError: sampler.lastError },
    nextRefreshAt: sampler.lastStart ? new Date(sampler.lastStart + REFRESH_MIN_MS).toISOString() : null,
    shape: flowShape(profile),
    // Which set the charts show: full-delivery third-party payments, or (if a window has almost none) all pathfound ones.
    display: !profile ? null : profile.endUser.count >= 3
      ? { set: 'endUser', label: 'Full-delivery payments to a third party (partial, circular and dust excluded)', agg: profile.endUser }
      : { set: 'pathfoundAll', label: `All pathfound payments incl. ${profile.totals.partial} partial and ${profile.totals.circular} circular — this window had only ${profile.totals.endUser} full-delivery third-party payments`, agg: profile.pathfoundAll || mergeAggregates([profile.endUser, profile.partial, profile.circular, profile.dust]) },
    note: 'Observed third-party XRPL Mainnet activity, read-only. Never Titan Forge activity, never mixed with Testnet figures.',
  }));

  app.post('/api/pathfinder/profile/refresh', (req, res, params, body) => {
    if (sampler.status === 'sampling') return json(res, 409, { error: 'A Mainnet sample is already in progress.', progress: sampler.progress });
    const wait = sampler.lastStart + REFRESH_MIN_MS - Date.now();
    if (wait > 0) return json(res, 429, { error: `Mainnet sampling is rate-limited to once per 2 minutes; retry in ${Math.ceil(wait / 1000)} s.` });
    const n = Math.max(5, Math.min(100, Number(body?.ledgers) || DEFAULT_LEDGERS));
    const ac = new AbortController();
    Object.assign(sampler, { status: 'sampling', progress: { done: 0, of: n }, startedAt: new Date().toISOString(), lastError: null, abort: ac, lastStart: Date.now() });
    const obs = new MainnetObserver();
    sampleProfile((r) => obs.request(r), { n, rps: 3, signal: ac.signal, onProgress: (p) => { sampler.progress = p; } })
      .then((p) => {
        if (!p.window.ledgers) throw new Error('No Mainnet ledgers could be fetched (rate limited); kept the previous sample.');
        profile = p;
        try { writeJson(PROFILE_FILE, p); } catch (e) { console.error('[pathfinder] profile save failed:', e.message); }
        bus.publish('pathfinder.profile', MAINNET, { summary: profileSummary(p) });
      })
      .catch((e) => { sampler.lastError = e.message; })
      .finally(() => { sampler.status = 'idle'; sampler.abort = null; obs.disconnect().catch(() => {}); });
    json(res, 202, { mode: MAINNET, status: 'sampling', ledgers: n, rps: 3 });
  });

  app.post('/api/pathfinder/profile/cancel', (req, res) => {
    if (sampler.status !== 'sampling') return json(res, 409, { error: 'No sample in progress.' });
    sampler.abort.abort();
    json(res, 200, { status: 'cancelling' });
  });

  app.get('/api/pathfinder/strategies', (req, res) => json(res, 200, { mode: 'LIVE_TESTNET', ...publicStrategies(), caps: CAPS, liveTokens: liveTokens(), statement: STATEMENT }));

  app.post('/api/pathfinder/plan', async (req, res, params, body) => {
    if (!ctx.ledgerReady) return json(res, 503, { error: ctx.ledgerError ? `Testnet unavailable: ${ctx.ledgerError}` : 'Testnet accounts still bootstrapping' });
    try {
      const opts = normalizeOptions(body, liveTokens());
      const plan = await runner.plan(opts, profile);
      json(res, 200, { ...plan, readonlyInstance: readonly(), profileWindow: profile?.window ?? null });
    } catch (e) { fail(res, e); }
  });

  app.post('/api/pathfinder/run', (req, res, params, body) => {
    if (readonly()) return json(res, 403, { error: 'Read-only instance: live runs are disabled (TF_READONLY=1). Use plan for a dry run.' });
    if (!ctx.ledgerReady) return json(res, 503, { error: 'Testnet not ready' });
    try {
      const opts = normalizeOptions(body, liveTokens());
      const run = runner.start(opts, profile, { approved: body?.approved });
      json(res, 202, { id: run.id, status: run.status, mode: 'LIVE_TESTNET', organic: false });
    } catch (e) { fail(res, e); }
  });

  // ---------- evidence (read-only; cached in data/pathfinder-evidence.json so it works offline) ----------
  const ev = { file: readJson(EVIDENCE_FILE, null), built: null, key: null, collecting: null, lastError: null };
  const evidence = () => {
    const raw = ev.file?.raw || { addrs: runner.io.addresses?.() || {}, collectedAt: null };
    const key = `${ev.file?.builtAt}|${runner.runs.length}|${runner.runs.map((r) => r.status).join('')}`;
    if (ev.key !== key) {
      // The cached evidence is reused when it covers exactly the same runs; otherwise rebuild from the cached raw reads.
      ev.built = ev.file?.evidence?.version === EVIDENCE_VERSION && ev.file.runCount === runner.runs.length && runner.runs.every((r) => r.status !== 'running' && r.status !== 'queued') ? ev.file.evidence : buildEvidence(raw, runner.runs);
      ev.key = key;
    }
    return ev.built;
  };
  const stripLevels = (p) => { if (!p.depth && !p.diagnosis) return p; const { depth, diagnosis, ...rest } = p; return { ...rest, ...(depth ? { depth: { ...depth, levelsBefore: undefined, levelsAfter: undefined } } : {}), ...(diagnosis ? { diagnosis: { ...diagnosis, legA: { ...diagnosis.legA, levels: undefined }, legB: { ...diagnosis.legB, levels: undefined }, rpf: { ...diagnosis.rpf, legADetail: undefined, legBDetail: undefined, fullDetail: undefined, fullNextDetail: undefined } } } : {}) }; };
  const evMeta = () => ({ collecting: !!ev.collecting, lastError: ev.lastError, cacheFile: 'data/pathfinder-evidence.json', cachedAt: ev.file?.builtAt || null });
  app.get('/api/pathfinder/evidence', (req, res, params, body, url) => {
    try {
      const e = evidence();
      const full = url?.searchParams?.get('full') === '1';
      json(res, 200, { ...e, ...evMeta(), runs: e.runs.map((r) => ({ ...r, payments: full ? r.payments : r.payments.map(stripLevels) })), detail: full ? 'full' : 'summary (add ?full=1 or use /api/pathfinder/evidence/:runId for book levels and raw pathfind detail)' });
    } catch (e) { json(res, 500, { error: e.message }); }
  });
  app.get('/api/pathfinder/evidence/:runId', (req, res, { runId }) => {
    const e = evidence();
    const r = e.runs.find((x) => x.runId === runId || String(x.run) === runId || (runId.length >= 6 && x.runId.startsWith(runId)));
    return r ? json(res, 200, { mode: e.mode, organic: false, statement: e.statement, separation: e.separation, labels: e.labels, addrs: e.addrs, collectedAt: e.collectedAt, ...evMeta(), run: r }) : json(res, 404, { error: 'Unknown run' });
  });
  app.get('/api/pathfinder/no-path', (req, res) => {
    const e = evidence();
    json(res, 200, { mode: e.mode, organic: false, collectedAt: e.collectedAt, ...e.noPath, doc: 'docs/PATHFINDER_NO_PATH.md',
      payments: e.runs.flatMap((r) => r.payments.filter((p) => p.diagnosis).map((p) => ({ run: r.run, runId: r.runId, strategy: r.options.strategy, ...stripLevels(p) }))) });
  });
  // Re-read the evidence from Testnet history (read-only commands only). One collection at a time.
  app.post('/api/pathfinder/evidence/refresh', (req, res) => {
    if (!ctx.ledgerReady) return json(res, 503, { error: 'Testnet not ready; cached evidence is still served.' });
    if (ev.collecting) return json(res, 409, { error: 'Evidence collection already running.' });
    ev.lastError = null;
    ev.collecting = collectRaw(runner.io, runner.runs, { addrs: runner.io.addresses(), codeVersions: ev.file?.raw?.codeVersions || {}, codeTimeline: ev.file?.raw?.codeTimeline || null })
      .then((raw) => {
        const evidenceOut = buildEvidence(raw, runner.runs);
        ev.file = { version: EVIDENCE_VERSION, builtAt: new Date().toISOString(), runCount: runner.runs.length, raw, evidence: evidenceOut };
        writeJson(EVIDENCE_FILE, ev.file); ev.key = null;
      })
      .catch((e) => { ev.lastError = e.message; })
      .finally(() => { ev.collecting = null; });
    json(res, 202, { status: 'collecting', mode: 'LIVE_TESTNET', note: 'Historical reads only (tx, ledger, book_offers, account_lines, account_info, ripple_path_find at fixed ledger indexes). Nothing is signed.' });
  });

  // ---------- corridor-continuity test plan (design only, never submits) ----------
  app.get('/api/pathfinder/continuity-plan', async (req, res) => {
    try {
      const plan = ctx.ledgerReady ? await continuityDryRun(runner.io, { tokens: ['BBL', 'LDN'] }) : buildContinuityPlan(OFFLINE_STATE);
      json(res, 200, { ...plan, readonlyInstance: readonly(), doc: 'docs/PATHFINDER_NO_PATH.md#corridor-continuity-test-plan' });
    } catch (e) {
      json(res, 200, { ...buildContinuityPlan(OFFLINE_STATE), readError: e.message });
    }
  });

  app.get('/api/pathfinder/runs', (req, res) => json(res, 200, { mode: 'LIVE_TESTNET', organic: false, statement: STATEMENT, active: runner.active, runs: runner.list() }));
  app.get('/api/pathfinder/runs/:id', (req, res, { id }) => {
    const r = runner.get(id);
    return r ? json(res, 200, r) : json(res, 404, { error: 'Unknown run' });
  });
}
