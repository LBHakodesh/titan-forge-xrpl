// RustEngineAdapter: talks to the authentic Titan Ghost Rust Quoter / Strategic Engine (when the Rust team provides it)
// over JSON-lines on stdio (TF_ENGINE_BIN) or HTTP POST (TF_ENGINE_URL). Contract: contracts/README.md.
//
// Every request and response is validated against contracts/schemas. Nothing here computes prices or allocations:
// those come from the external engine, or — on a cache miss — from the fallback (TemporaryDemoAdapter), labeled as such.
//
// Sync/async bridge. v1 callers use allocate()/recommend() synchronously. The adapter answers them from a short-TTL
// cache filled by async StrategyRequests. On a miss it returns the fallback's result tagged
// `source: 'temporary-demo-adapter (Rust cache miss)'` and prefetches in the background, so the next identical call is
// served by the Rust engine. New code should prefer the v2 async methods strategyAsync()/quoteAsync().
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { MODES } from '../../public/domain.js';
import { validate, assertValid } from './validate.mjs';
import { CONTRACT_VERSION, WIRE_VERSION } from './contracts.mjs';

const RESULT_SCHEMA = { info: 'engine-info', quote: 'quote-response', strategy: 'strategy-response', health: null };
const PARAMS_SCHEMA = { quote: 'quote-request', strategy: 'strategy-request' };

export class EngineError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

// ---------- transports: send(rpcRequest, timeoutMs) -> Promise<rpcResponse object> ----------
export class StdioTransport {
  constructor(bin, args = [], { log = () => {}, env = {} } = {}) { this.bin = bin; this.args = args; this.log = log; this.env = env; this.kind = 'stdio'; this.pending = new Map(); this.proc = null; }
  get alive() { return Boolean(this.proc && this.proc.exitCode === null && !this.proc.killed); }
  start() {
    if (this.alive) return;
    const p = spawn(this.bin, this.args, { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, ...this.env, TF_CONTRACT_VERSION: CONTRACT_VERSION } }); // minimal env: nothing from the server leaks
    this.proc = p;
    readline.createInterface({ input: p.stdout }).on('line', (line) => {
      if (!line.trim()) return;
      let msg; try { msg = JSON.parse(line); } catch { this.log(`engine stdout (not JSON, ignored): ${line.slice(0, 200)}`); return; }
      const w = this.pending.get(msg?.id);
      if (!w) { this.log(`engine response for unknown id ${String(msg?.id).slice(0, 64)}`); return; }
      this.pending.delete(msg.id); clearTimeout(w.timer); w.resolve(msg);
    });
    p.stderr.on('data', (d) => this.log(`engine stderr: ${String(d).slice(0, 500).trim()}`));
    const fail = (why) => { for (const [, w] of this.pending) { clearTimeout(w.timer); w.reject(new EngineError('NOT_READY', why, { retryable: true })); } this.pending.clear(); };
    p.on('error', (e) => fail(`engine process error: ${e.message}`));
    p.on('exit', (code, sig) => fail(`engine process exited (${sig || code})`));
    p.stdin.on('error', () => {});
  }
  send(req, timeoutMs) {
    this.start();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(req.id); reject(new EngineError('TIMEOUT', `engine did not answer ${req.method} within ${timeoutMs} ms`, { retryable: true })); }, timeoutMs);
      this.pending.set(req.id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify(req) + '\n');
    });
  }
  close() { if (this.proc) { this.proc.stdin.end(); this.proc.kill(); this.proc = null; } }
}

export class HttpTransport {
  constructor(url, { allowRemote = false } = {}) {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`TF_ENGINE_URL must be http(s): ${url}`);
    if (!allowRemote && !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('TF_ENGINE_URL must be loopback (set TF_ENGINE_ALLOW_REMOTE=1 to override)');
    this.url = u.toString(); this.kind = 'http';
  }
  async send(req, timeoutMs) {
    let r;
    try { r = await fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw new EngineError(e.name === 'TimeoutError' ? 'TIMEOUT' : 'NOT_READY', `engine HTTP ${req.method}: ${e.message}`, { retryable: true }); }
    const text = await r.text();
    try { return JSON.parse(text); } catch { throw new EngineError('INTERNAL', `engine HTTP ${r.status}: non-JSON body`); }
  }
  close() {}
}

// ---------- adapter ----------
export class RustEngineAdapter {
  constructor(transport, { fallback, timeoutMs = 2000, cacheTtlMs = 15_000, maxInflight = 4, log = () => {} } = {}) {
    if (!fallback) throw new Error('RustEngineAdapter needs a fallback adapter');
    Object.assign(this, { transport, fallback, timeoutMs, cacheTtlMs, maxInflight, log });
    this.remote = null; this.seq = 0; this.cache = new Map(); this.inflight = new Map(); this.stats = { hits: 0, misses: 0, errors: 0, lastError: null };
  }

  async call(method, params = {}) {
    if (PARAMS_SCHEMA[method]) assertValid(PARAMS_SCHEMA[method], params, `${method} request`);
    const req = { v: WIRE_VERSION, id: `tf-${process.pid}-${++this.seq}`, method, params, deadlineMs: this.timeoutMs };
    assertValid('rpc-request', req, 'rpc request');
    const res = await this.transport.send(req, this.timeoutMs);
    const env = validate('rpc-response', res);
    if (!env.valid) throw new EngineError('INTERNAL', `engine sent an invalid rpc envelope: ${env.errors.map((e) => `${e.path || '/'} ${e.message}`).join('; ')}`);
    if (res.id !== req.id) throw new EngineError('INTERNAL', `engine answered id ${res.id} for ${req.id}`);
    if (!res.ok) throw new EngineError(res.error.code, `engine ${method}: ${res.error.message}`, { retryable: Boolean(res.error.retryable) });
    if (RESULT_SCHEMA[method]) {
      const v = validate(RESULT_SCHEMA[method], res.result);
      if (!v.valid) throw new EngineError('INTERNAL', `engine ${method} result failed ${RESULT_SCHEMA[method]} schema: ${v.errors.map((e) => `${e.path || '/'} ${e.message}`).join('; ')}`, { errors: v.errors });
    }
    return res.result;
  }

  // Handshake: info must be schema-valid and share our contract major version.
  async connect() {
    const info = await this.call('info');
    if (info.contractVersion.split('.')[0] !== CONTRACT_VERSION.split('.')[0]) throw new EngineError('UNSUPPORTED_VERSION', `engine contract ${info.contractVersion} vs Titan Forge ${CONTRACT_VERSION}`);
    this.remote = info;
    return info;
  }
  async health() { return this.call('health'); }

  info() {
    const r = this.remote || {};
    return { id: `rust:${r.id || 'unknown'}`, label: r.label || 'Rust engine (handshake pending)', authentic: Boolean(r.authentic), contractVersion: r.contractVersion, engineVersion: r.version,
      transport: this.transport.kind, methods: r.methods || [], cache: { ...this.stats, entries: this.cache.size } };
  }

  // ---- v2 async (preferred for new code) ----
  async quoteAsync(req) {
    const out = await this.call('quote', req);
    if (out.mode !== req.mode) throw new EngineError('MODE_VIOLATION', `quote mode ${out.mode} != request mode ${req.mode}`);
    if (out.side !== req.side || out.ring !== req.ring) throw new EngineError('INTERNAL', 'quote side/ring does not match request');
    return out;
  }
  async strategyAsync(req) {
    const out = await this.call('strategy', req);
    if (out.mode === MODES.LIVE) throw new EngineError('MODE_VIOLATION', 'strategy output is hypothetical and may not be LIVE_TESTNET');
    const asked = new Set(req.markets.map((m) => m.marketId));
    for (const a of out.allocations) if (!asked.has(a.marketId)) throw new EngineError('INTERNAL', `allocation for unrequested market ${a.marketId}`);
    return out;
  }

  // ---- v1 sync bridge ----
  static allocReq(capitalUsd, opts = {}) {
    const m = { marketId: opts.marketId || 'currencies', capitalUsd };
    if (opts.flowScale !== undefined) m.flowScale = opts.flowScale;
    if (opts.ringsActive !== undefined) m.ringsActive = opts.ringsActive;
    const req = { markets: [m], mode: MODES.SIM };
    if (opts.hurdleBps !== undefined) req.hurdleBps = opts.hurdleBps;
    return req;
  }
  static recReq(markets) {
    return { markets: markets.map((m) => { const o = { marketId: m.marketId, capitalUsd: m.capitalUsd }; for (const k of ['flowScale', 'ringsActive', 'stage']) if (m[k] !== undefined) o[k] = m[k]; return o; }), mode: MODES.SIM };
  }
  cached(key) {
    const c = this.cache.get(key);
    if (c && Date.now() - c.at < this.cacheTtlMs) { this.stats.hits++; return c.value; }
    this.stats.misses++; return undefined;
  }
  prefetch(key, req) {
    if (this.inflight.has(key)) return this.inflight.get(key);
    if (this.inflight.size >= this.maxInflight) return Promise.resolve(null);
    const p = this.strategyAsync(req)
      .then((out) => { this.cache.set(key, { at: Date.now(), value: out }); if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value); return out; })
      .catch((e) => { this.stats.errors++; this.stats.lastError = `${e.code || 'ERR'}: ${e.message}`; this.log(this.stats.lastError); return null; })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
  // Await these to warm the cache (e.g. at startup or before rendering a page).
  prefetchAllocate(capitalUsd, opts) { const req = RustEngineAdapter.allocReq(capitalUsd, opts); return this.prefetch('A' + JSON.stringify(req), req); }
  prefetchRecommend(markets) { const req = RustEngineAdapter.recReq(markets); return this.prefetch('R' + JSON.stringify(req), req); }

  allocate(capitalUsd, opts) {
    const req = RustEngineAdapter.allocReq(capitalUsd, opts);
    const key = 'A' + JSON.stringify(req);
    const hit = this.cached(key);
    if (hit) return { ...hit.allocations[0].allocation, source: hit.allocations[0].allocation.source || hit.source };
    this.prefetch(key, req);
    return { ...this.fallback.allocate(capitalUsd, opts), source: 'temporary-demo-adapter (Rust cache miss)' };
  }
  recommend(markets) {
    const req = RustEngineAdapter.recReq(markets);
    const key = 'R' + JSON.stringify(req);
    const hit = this.cached(key);
    if (hit) return hit.recommendations;
    this.prefetch(key, req);
    return this.fallback.recommend(markets).map((r) => ({ ...r, source: `${r.source} (Rust cache miss)` }));
  }

  close() { this.transport.close(); }
}
