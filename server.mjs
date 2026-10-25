// Titan Forge staging server. Plugin layout:
//   lib/routes/*.mjs  export register(app, ctx)    -> API routes
//   public/modules/*.js export default { id, title, mount(el, api) } -> UI tabs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client, Wallet } from 'xrpl';
import { Ledger } from './lib/ledger.mjs';
import { Store, Bus } from './lib/store.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4131);
// Offline replay mode (TF_OFFLINE=1, `./start.sh --offline`): no network at all, recorded data served as REPLAY,
// signing structurally impossible. Implies TF_READONLY=1 so every module's existing read-only guard also applies.
export const OFFLINE = process.env.TF_OFFLINE === '1';
if (OFFLINE) process.env.TF_READONLY = '1';
const PUBLIC_MIRROR = process.env.TF_PUBLIC_MIRROR === '1';
if (PUBLIC_MIRROR) process.env.TF_READONLY = '1';
const HOST = '127.0.0.1';
const DATA = path.join(ROOT, 'data');
const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.wav': 'audio/wav', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

// Minimal router: app.get/post(path, handler(req, res, params, body))
function createApp() {
  const routes = [];
  const add = (method) => (pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, handler });
  };
  return {
    get: add('GET'), post: add('POST'), routes,
    match(method, url) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = url.match(r.re);
        if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
      }
      return null;
    },
  };
}

export const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 64 * 1024) throw new Error('Body too large'); chunks.push(c); }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}


// ---------------------------------------------------------------------------------------------
// Offline replay mode helpers (exported for test/stability.test.mjs).
export const OFFLINE_MSG = 'Offline replay mode (TF_OFFLINE=1): no network, live XRPL access and signing are disabled; recorded data is shown as REPLAY.';
export class OfflineError extends Error {
  constructor(what) { super(`${OFFLINE_MSG}${what ? ` Refused: ${what}.` : ''}`); this.code = 'TF_OFFLINE'; this.status = 503; }
}

// Process-wide kill switch: every xrpl Client (Testnet ledger, Mainnet observer, spokes, pathfinder) refuses to
// connect or request, no Wallet can sign, and fetch() only reaches this loopback server.
export function installOfflineGuards({ Client: C = Client, Wallet: W = Wallet, scope = globalThis } = {}) {
  const refuse = (what) => async function () { throw new OfflineError(what); };
  for (const m of ['connect', 'request', 'requestAll', 'submit', 'submitAndWait', 'autofill', 'fundWallet', 'simulate', 'getLedgerIndex', 'getXrpBalance', 'getBalances', 'getOrderbook']) {
    if (typeof C.prototype[m] === 'function') C.prototype[m] = refuse(`XRPL ${m}`);
  }
  C.prototype.isConnected = () => false;
  W.prototype.sign = function () { throw new OfflineError('transaction signing'); };
  const realFetch = scope.fetch?.bind(scope);
  scope.fetch = (input, init) => {
    let host = '';
    try { host = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).hostname; } catch {}
    if (realFetch && (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]')) return realFetch(input, init);
    return Promise.reject(new OfflineError(`network fetch to ${host || 'unknown host'}`));
  };
}

// The ledger keeps public addresses only (no key material in the wallet objects) and every network/signing method throws.
export function lockLedgerOffline(ledger) {
  for (const m of ['connect', 'assertTestnet', 'bootstrap', 'status', 'book', 'launch', 'submit', 'exclusive', 'signOffline', 'submitSigned', 'xrpBalance', 'tokenBalance']) {
    ledger[m] = async () => { throw new OfflineError(`ledger.${m}`); };
  }
  ledger.disconnect = async () => {};
  ledger.wallets = {};
  try {
    const raw = JSON.parse(fs.readFileSync(ledger.walletFile, 'utf8'));
    // Derive addresses locally (pure crypto, no network); only the address leaves this function.
    for (const [role, seed] of Object.entries(raw.roles || {})) { const a = Wallet.fromSeed(seed).classicAddress; ledger.wallets[role] = { address: a, classicAddress: a }; }
  } catch { /* no wallets file: replay still works, addresses just aren't shown */ }
  return ledger;
}

// Relabel recorded live data as REPLAY in every JSON response (mode fields only; values are untouched).
export function relabelReplay(v) {
  if (Array.isArray(v)) return v.map(relabelReplay);
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = (k === 'mode' && x === 'LIVE_TESTNET') ? 'REPLAY' : relabelReplay(x);
  return out;
}

// Actions that need the live ledger or a public network. Matched before any route handler runs.
const LIVE_ONLY = [
  ['POST', /^\/api\/launch$/, 'token launch (signs Testnet transactions)'],
  ['POST', /^\/api\/pathfinder\/run$/, 'Pathfinder live run (signs Testnet transactions)'],
  ['POST', /^\/api\/loop\/start$/, 'demo loop session (signs Testnet transactions)'],
  ['POST', /^\/api\/pathfinder\/profile\/refresh$/, 'Mainnet profile refresh (network)'],
  ['POST', /^\/api\/incubator\/amendments\/refresh$/, 'Testnet amendment check (network)'],
  ['POST', /^\/api\/x402\/live\//, 'x402 LIVE_TESTNET purchase (signs a Testnet payment)'],
  ['POST', /^\/api\/spokes\/refresh$/, 'spokes refresh (network)'],
  ['POST', /^\/api\/corridor\/[^/]+\/(promote|demote)$/, 'LIVE_TESTNET corridor stage change', (body) => body?.mode === 'LIVE_TESTNET'],
  ['GET', /^\/api\/book\/[^/]+$/, 'live order book read (network)'],
];
export function offlineRefusal(method, pathname, body) {
  for (const [m, re, what, when] of LIVE_ONLY) {
    if (m === method && re.test(pathname) && (!when || when(body))) return { error: new OfflineError(what).message, offline: true, mode: 'REPLAY', refused: what };
  }
  return null;
}

// Deterministic replay snapshot built only from recorded files (stable order, recorded timestamps, no clock or randomness).
export function replayStatus(store, ledger) {
  const launches = [...store.launches].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));
  const live = launches.filter((l) => l.status === 'live');
  const steps = live.flatMap((l) => l.steps || []);
  const ledgers = steps.map((x) => Number(x.ledger)).filter(Number.isFinite);
  return {
    mode: 'REPLAY', offline: true, network: 'XRPL Testnet (offline replay of recorded data)', networkId: 1,
    validatedLedger: ledgers.length ? Math.max(...ledgers) : null,
    accounts: Object.fromEntries(Object.entries(ledger.wallets || {}).map(([r, w]) => [r, { address: w.address, recorded: true }])),
    launches: { live: live.length, failed: launches.filter((l) => l.status === 'failed').length },
    validatedTxCount: steps.filter((x) => x.hash).length,
    note: OFFLINE_MSG,
  };
}

export function seedReplayEvents(bus, store) {
  const launches = [...store.launches].filter((l) => l.status === 'live')
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));
  for (const l of launches) {
    bus.publish('launch.created', 'REPLAY', { at: l.createdAt, launchId: l.id, code: l.code, name: l.name, category: l.category });
    bus.publish('launch.done', 'REPLAY', { at: l.completedAt || l.createdAt, launchId: l.id, code: l.code, name: l.name, fillHash: l.fillHash, book: l.book, issuer: l.issuer });
  }
}

// Load lib/routes/*.mjs in name order. A plugin whose import or register() throws is skipped and logged;
// the rest of the demo keeps serving. Returns { loaded, skipped } for /api/health and tests.
export async function loadRoutes(routeDir, app, ctx, log = console) {
  const loaded = [], skipped = [];
  for (const f of fs.readdirSync(routeDir).filter((f) => f.endsWith('.mjs')).sort()) {
    try {
      const mod = await import(pathToFileURL(path.join(routeDir, f)));
      if (typeof mod.register !== 'function') throw new Error('no register(app, ctx) export');
      await mod.register(app, ctx);
      loaded.push(f); log.log('[routes]', f);
    } catch (e) {
      skipped.push({ file: f, error: e.message }); log.error('[routes] SKIPPED', f, '-', e.message);
    }
  }
  return { loaded, skipped };
}
// ---------------------------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  const ledger = new Ledger(DATA);
  const store = new Store(DATA);
  const bus = new Bus();
  const ctx = { ledger, store, bus, json, ledgerReady: false, ledgerError: null, offline: OFFLINE };

  if (OFFLINE) {
    installOfflineGuards();
    lockLedgerOffline(ledger);
    ctx.ledgerError = OFFLINE_MSG;
    ctx.json = (res, code, body) => json(res, code, relabelReplay(body));
    const publish = bus.publish.bind(bus);
    bus.publish = (type, mode, payload) => publish(type, mode === 'LIVE_TESTNET' ? 'REPLAY' : mode, payload);
    seedReplayEvents(bus, store);
    console.log('[offline] TF_OFFLINE=1: ledger bootstrap skipped, network and signing disabled, serving recorded data as REPLAY');
  } else {
    // If Testnet is unreachable at startup (venue Wi-Fi), keep serving and retry in the background instead of
    // staying "not ready" until someone restarts the server. TF_BOOTSTRAP_RETRY_MS=0 disables the retry.
    const retryMs = Number(process.env.TF_BOOTSTRAP_RETRY_MS ?? 30000);
    const attempt = (n = 1) => ledger.bootstrap((m) => console.log('[bootstrap]', m))
      .then(() => { ctx.ledgerReady = true; ctx.ledgerError = null; console.log('[bootstrap] ledger ready'); })
      .catch((e) => {
        ctx.ledgerError = e.message; console.error(`[bootstrap] failed (attempt ${n}):`, e.message);
        if (retryMs > 0) setTimeout(() => attempt(n + 1), Math.min(retryMs * n, 5 * 60_000)).unref();
      });
    attempt();
  }
  let routeReport = { loaded: [], skipped: [] };

  const app = createApp();

  app.get('/api/health', (req, res) => json(res, 200, { ok: true, ledgerReady: ctx.ledgerReady, ledgerError: ctx.ledgerError,
    ...(OFFLINE ? { offline: true, mode: 'REPLAY' } : {}), routes: routeReport.loaded.length, skippedRoutes: routeReport.skipped }));
  if (OFFLINE) app.get('/api/status', (req, res) => json(res, 200, replayStatus(store, ledger)));
  app.get('/api/modules', (req, res) => {
    const dir = path.join(PUBLIC, 'modules');
    json(res, 200, fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort().map((f) => `/modules/${f}`));
  });
  // Server-sent events: every bus event, plus a backlog on connect.
  app.get('/api/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    for (const ev of bus.recent.slice(-100)) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    const on = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    bus.on('event', on);
    req.on('close', () => { bus.off('event', on); clearInterval(ping); });
  });

  routeReport = await loadRoutes(path.join(ROOT, 'lib', 'routes'), app, ctx);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    // Public read-only mirror (TF_PUBLIC_MIRROR=1, always with TF_READONLY=1): a reverse proxy makes every visitor look
    // like localhost, so localhost-only guards cannot be trusted here. Refuse every non-GET and every refresh trigger.
    if (PUBLIC_MIRROR && ((req.method !== 'GET' && req.method !== 'HEAD') || url.searchParams.has('refresh'))) {
      return json(res, 403, { error: 'Public read-only mirror: changes are disabled.', mode: 'READ_ONLY_MIRROR' });
    }
    try {
      if (url.pathname.startsWith('/api/')) {
        const m = app.match(req.method, url.pathname);
        if (!m) return json(res, 404, { error: 'Not found' });
        const body = req.method === 'POST' ? await readBody(req) : undefined;
        if (OFFLINE) { const refusal = offlineRefusal(req.method, url.pathname, body); if (refusal) return json(res, 503, refusal); }
        return await m.handler(req, res, m.params, body, url);
      }
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = path.normalize(path.join(PUBLIC, rel));
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
      // Media (audio/images) is cacheable and supports byte ranges so the browser can seek narration; pages/scripts stay no-store.
      const ext = path.extname(file), size = fs.statSync(file).size;
      const media = ['.wav', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.mp3', '.ogg'].includes(ext);
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': media ? 'public, max-age=3600' : 'no-store', 'Accept-Ranges': 'bytes' };
      const range = media && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range && (range[1] || range[2])) {
        let a = range[1] ? Number(range[1]) : size - Number(range[2]), b = range[1] && range[2] ? Number(range[2]) : size - 1;
        a = Math.max(0, a); b = Math.min(size - 1, b);
        if (a > b) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1 });
        return fs.createReadStream(file, { start: a, end: b }).pipe(res);
      }
      res.writeHead(200, { ...headers, 'Content-Length': size });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) json(res, e instanceof SyntaxError ? 400 : e.code === 'TF_OFFLINE' ? 503 : 500, { error: e.message, ...(e.code === 'TF_OFFLINE' ? { offline: true, mode: 'REPLAY' } : {}) });
    }
  });

  server.listen(PORT, HOST, () => console.log(`Titan Forge on http://${HOST}:${PORT}${OFFLINE ? ' (OFFLINE REPLAY)' : ''}`));
  const stop = () => { server.close(); ledger.disconnect().finally(() => process.exit(0)); setTimeout(() => process.exit(0), 3000); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}

// Run only when started as a program (node server.mjs), so tests can import the helpers above.
const isMain = () => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) main();
