// Engine adapter seam. Today: TemporaryDemoAdapter (illustrative). Later: authentic Rust Quoter / Strategic Engine.
// Stable interface — callers depend only on these method signatures (all SYNCHRONOUS, unchanged):
//   engine.info() -> { id, label, authentic: boolean, ... }
//   engine.allocate(capitalUsd, { flowScale, ringsActive, hurdleBps }) -> allocateRings() result shape (allocation.schema.json)
//   engine.recommend(markets: [{ marketId, capitalUsd, flowScale, ringsActive }]) -> [{ source, action, fromMarket?, toMarket?, amountUsd?, rationale, mode }]
// Optional v2 (async, contract-shaped; present on both adapters):
//   engine.strategyAsync(StrategyRequest) -> Promise<StrategyResponse>; engine.quoteAsync(QuoteRequest) -> Promise<QuoteResponse>
//
// Selection (env, evaluated once at import):
//   TF_ENGINE_BIN=/path/to/engine [TF_ENGINE_ARGS="--flag x"]  -> JSON-lines over stdio
//   TF_ENGINE_URL=http://127.0.0.1:PORT/rpc                    -> HTTP POST (loopback only unless TF_ENGINE_ALLOW_REMOTE=1)
// The Rust adapter becomes active only after a schema-valid `info` handshake with a matching contract major version, and is
// health-checked every TF_ENGINE_HEALTH_MS (default 15000). Until then, or whenever unhealthy, getEngine() returns the
// TemporaryDemoAdapter and its info().note says why.
import { TemporaryDemoAdapter } from './demo-adapter.mjs';
import { RustEngineAdapter, StdioTransport, HttpTransport } from './rust-adapter.mjs';

export { TemporaryDemoAdapter };

const status = { configured: 'none', state: 'demo', reason: 'No Rust engine configured (TF_ENGINE_BIN / TF_ENGINE_URL unset).', since: new Date().toISOString() };
const demo = new TemporaryDemoAdapter({ statusNote: () => (status.configured === 'none' ? null : `Rust engine (${status.configured}) ${status.state}: ${status.reason} Using temporary demo adapter.`) });
let engine = demo;
let rust = null;
let overridden = false;

export function getEngine() { return engine; }
export function setEngine(e) { engine = e; overridden = true; }
export function engineStatus() { return { ...status, active: engine.info().id, rust: rust ? rust.info() : null }; }
export function getDemoAdapter() { return demo; }

const set = (state, reason) => Object.assign(status, { state, reason, since: new Date().toISOString() });

async function check() {
  try {
    if (!rust.remote) await rust.connect(); else await rust.health();
    if (status.state !== 'active') set('active', `handshake ok (${rust.remote.id} contract ${rust.remote.contractVersion}).`);
    if (!overridden) engine = rust;
  } catch (e) {
    rust.remote = null; // force a fresh handshake next time
    set('unhealthy', `${e.code || 'ERR'}: ${e.message}.`);
    if (!overridden) engine = demo;
  }
}

export async function initEngine(env = process.env, { log = (m) => console.log('[engine]', m) } = {}) {
  if (rust) return engineStatus();
  let transport;
  try {
    if (env.TF_ENGINE_BIN) { transport = new StdioTransport(env.TF_ENGINE_BIN, (env.TF_ENGINE_ARGS || '').split(' ').filter(Boolean), { log }); status.configured = 'stdio'; }
    else if (env.TF_ENGINE_URL) { transport = new HttpTransport(env.TF_ENGINE_URL, { allowRemote: env.TF_ENGINE_ALLOW_REMOTE === '1' }); status.configured = 'http'; }
    else return engineStatus();
  } catch (e) { status.configured = 'invalid'; set('unhealthy', e.message); return engineStatus(); }
  rust = new RustEngineAdapter(transport, { fallback: demo, timeoutMs: Number(env.TF_ENGINE_TIMEOUT_MS || 2000), log });
  set('connecting', 'handshake in progress.');
  await check();
  const t = setInterval(check, Number(env.TF_ENGINE_HEALTH_MS || 15000)); t.unref?.();
  rust.stopHealth = () => clearInterval(t);
  log(`${status.state}: ${status.reason}`);
  return engineStatus();
}

// For tests: tear down the Rust adapter and return to the demo adapter.
export function resetEngine() {
  if (rust) { rust.stopHealth?.(); rust.close(); }
  rust = null; engine = demo; overridden = false;
  Object.assign(status, { configured: 'none', state: 'demo', reason: 'No Rust engine configured (TF_ENGINE_BIN / TF_ENGINE_URL unset).' });
}

if (process.env.TF_ENGINE_BIN || process.env.TF_ENGINE_URL) initEngine().catch((e) => console.error('[engine]', e.message));
