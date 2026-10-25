// Shared helpers for vendor adapters (Workstream F). Read-only by construction:
// nothing here signs, submits, pays or charges. Secrets never leave this module: outputs only ever say
// whether a credential is *set*, never its value, and endpoint URLs are reduced to scheme + host.
import fs from 'node:fs';
import path from 'node:path';

export const STATUSES = Object.freeze(['CONNECTED_TESTED', 'CONNECTED', 'CREDENTIALS_REQUIRED', 'SANDBOX_ONLY', 'DOCUMENTATION_ONLY', 'ERROR']);
export const STATUS_TEXT = Object.freeze({
  CONNECTED_TESTED: 'Connected and tested: a read-only probe succeeded in this server process.',
  CONNECTED: 'Connected: configured / previously verified (stored sample from a real probe), not re-probed in this process.',
  CREDENTIALS_REQUIRED: 'Credentials required: the adapter is built but the needed environment variables are not set.',
  SANDBOX_ONLY: 'Sandbox only: works against a test environment or the visitor\'s browser/device; nothing production-facing.',
  DOCUMENTATION_ONLY: 'Documentation only: capability verified in public docs; no API call is made from this node.',
  ERROR: 'Error: the last read-only probe failed (see telemetry).',
});

// Per-adapter call telemetry (calls, errors, latency).
export class VendorTelemetry {
  constructor(now = () => Date.now()) { this.now = now; this.calls = 0; this.errors = 0; this.latencies = []; this.lastError = null; this.lastCallAt = null; this.lastOkAt = null; }
  async time(label, fn) {
    const t0 = this.now(); this.calls++; this.lastCallAt = new Date(t0).toISOString();
    try { const r = await fn(); this.latencies.push(this.now() - t0); if (this.latencies.length > 50) this.latencies.shift(); this.lastOkAt = new Date(this.now()).toISOString(); return r; }
    catch (e) { this.errors++; this.latencies.push(this.now() - t0); if (this.latencies.length > 50) this.latencies.shift(); this.lastError = { label, message: safeMessage(e), at: new Date(this.now()).toISOString() }; throw e; }
  }
  snapshot() {
    const l = this.latencies; const sorted = [...l].sort((a, b) => a - b);
    return { calls: this.calls, errors: this.errors, lastCallAt: this.lastCallAt, lastOkAt: this.lastOkAt, lastError: this.lastError,
      latencyMs: l.length ? { last: l[l.length - 1], avg: Math.round(l.reduce((a, b) => a + b, 0) / l.length), p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] } : null };
  }
}

// Error text without URLs paths / query strings (QuickNode tokens live in the URL path).
export function safeMessage(e) {
  return String(e?.message || e || 'error').replace(/(https?|wss?):\/\/([^/\s'"]+)[^\s'"]*/g, '$1://$2/…').slice(0, 300);
}

// scheme://host only (drops path, query, credentials).
export function redactUrl(u) {
  try { const x = new URL(u); return `${x.protocol}//${x.hostname}${x.port ? `:${x.port}` : ''}/…`; } catch { return null; }
}

export const isSet = (env, k) => typeof env[k] === 'string' && env[k].trim() !== '';
export const credentialView = (env, keys) => keys.map((k) => ({ name: k, set: isSet(env, k) }));

export function withTimeout(p, ms, what = 'request') {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms); })]).finally(() => clearTimeout(t));
}

// Stored samples: only written by a successful real probe (vendor id -> sample). File is evidence, not config.
export class SampleStore {
  constructor(file) { this.file = file; this.data = {}; this.load(); }
  load() { try { if (this.file && fs.existsSync(this.file)) this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')).samples || {}; } catch { this.data = {}; } }
  get(id) { return this.data[id] || null; }
  set(id, sample) {
    if (!sample || sample.verified !== true || !sample.capturedAt || !sample.source) throw new Error('Refusing to store an unverified sample');
    this.data[id] = sample;
    if (!this.file) return sample;
    const body = { note: 'Captured automatically from real read-only vendor probes (POST /api/vendors/:id/probe). Never hand-edited or fabricated. No secrets.', samples: this.data };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(body, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
    return sample;
  }
}

// Builds the adapter object every vendor module exports. `computeStatus(state)` returns a STATUS.
export function makeAdapter({ id, name, docs, capability, credentialEnv, env, samples, now = () => Date.now(), computeStatus, runProbe, extra = {} }) {
  const telemetry = new VendorTelemetry(now);
  const state = { lastProbe: null };
  const adapter = {
    id, name, docs, capability, credentialEnv,
    credentials() { return credentialView(env, credentialEnv); },
    status() { const s = computeStatus({ ...state, env, sample: samples?.get(id) || null }); if (!STATUSES.includes(s)) throw new Error(`bad status ${s}`); return s; },
    get sample() { return samples?.get(id) || null; },
    get telemetry() { return telemetry.snapshot(); },
    get lastProbe() { return state.lastProbe; },
    async probe() {
      const t0 = now();
      let out;
      try { out = await telemetry.time('probe', () => runProbe({ telemetry })); }
      catch (e) { out = { ok: false, error: safeMessage(e) }; }
      out = { vendor: id, at: new Date(t0).toISOString(), latencyMs: now() - t0, readOnly: true, paymentExecuted: false, ...out };
      if (out.ok && out.sample && samples) { try { samples.set(id, { vendor: id, verified: true, capturedAt: out.at, latencyMs: out.latencyMs, ...out.sample }); } catch { /* not a verifiable sample */ } }
      if (out.ok === false && out.countAsError === false) { /* e.g. offline replay: not a vendor failure, keep the previous state */ }
      else if (out.ok === false) state.lastProbe = { ok: false, at: out.at, error: out.error || 'probe failed', fallback: !!out.fallback };
      else state.lastProbe = { ok: !!out.ok, at: out.at, fallback: !!out.fallback, countsAsVendorTest: out.countsAsVendorTest !== false };
      const { sample, countAsError, ...rest } = out;
      return { ...rest, sampleStored: !!(out.ok && sample), status: adapter.status() };
    },
    view() {
      const st = adapter.status();
      return { id, name, capability, docs, status: st, statusText: STATUS_TEXT[st], credentials: adapter.credentials(), lastProbe: state.lastProbe, sample: adapter.sample, telemetry: adapter.telemetry, ...(typeof extra === 'function' ? extra() : extra) };
    },
  };
  return adapter;
}

// Standard status for "public, keyless, probe-able" vendors.
export function probedStatus({ lastProbe, sample }, idle = 'DOCUMENTATION_ONLY') {
  if (lastProbe?.ok && lastProbe.countsAsVendorTest !== false) return 'CONNECTED_TESTED';
  if (lastProbe && !lastProbe.ok) return 'ERROR';
  if (sample?.verified) return 'CONNECTED';
  return idle;
}
