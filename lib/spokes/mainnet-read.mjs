// Spokes: read-only XRPL Mainnet wrapper (MAINNET_OBSERVED).
// Sits ON TOP of lib/mainnet-observer.mjs (contract rule 5b): every Mainnet request still goes through
// MainnetObserver.request(). This wrapper adds, for the spokes data layer:
//   - its own, narrower read-command allowlist (no submit/sign/path_find/subscribe or any other command);
//   - a node allowlist (public Mainnet nodes only);
//   - a hard network check: server_info must report network_id === 0 before any other read is sent;
//   - per-request timeouts, gentle pacing and failover to the next public node on rate limits.
// It holds no wallet and has no submit method. Nothing here can sign or submit.
import { MainnetObserver } from '../mainnet-observer.mjs';

export const SPOKES_READ_COMMANDS = Object.freeze(['account_info', 'account_lines', 'gateway_balances', 'book_offers', 'amm_info', 'ledger', 'tx', 'account_tx', 'server_info']);
// gateway_balances and account_tx are in this wrapper's list but NOT in MainnetObserver's allowlist, so the observer
// still rejects them. The spokes layer does not call them (concentration comes from the ranking provider; flows come from
// ledger scans). Adding them to the observer is a lead decision (see report).
export const MAINNET_NODES = Object.freeze(['wss://s2.ripple.com', 'wss://xrplcluster.com', 'wss://s1.ripple.com']);
const READ = new Set(SPOKES_READ_COMMANDS);
const MAINNET_NETWORK_ID = 0;

export class MainnetReadError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

const withTimeout = (p, ms, what) => {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new MainnetReadError(`${what}: timed out after ${ms} ms`, 'TIMEOUT')), ms); })]).finally(() => clearTimeout(t));
};
const isBusy = (e) => /tooBusy|slowDown|too much load|rate limit/i.test(`${e?.data?.error || ''} ${e?.message || ''}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SpokesMainnetReader {
  // makeTransport(url) -> { request(req), disconnect() }. Default: MainnetObserver (the only Mainnet client in the app).
  constructor({ nodes = MAINNET_NODES, makeTransport = (url) => new MainnetObserver(url), timeoutMs = 10_000, minGapMs = 120 } = {}) {
    for (const n of nodes) if (!MAINNET_NODES.includes(n)) throw new MainnetReadError(`Refusing: ${n} is not an allowlisted public Mainnet node`, 'NODE');
    Object.assign(this, { nodes: [...nodes], makeTransport, timeoutMs, minGapMs });
    this.idx = 0; this.t = null; this.verified = false; this.last = 0; this.stats = { requests: 0, failovers: 0 };
  }
  get node() { return this.nodes[this.idx]; }

  async #connect() {
    if (this.t && this.verified) return;
    this.t = this.makeTransport(this.node);
    this.verified = false;
    const r = await withTimeout(this.t.request({ command: 'server_info' }), this.timeoutMs, 'server_info');
    const id = r?.result?.info?.network_id;
    if (id !== MAINNET_NETWORK_ID) {
      await this.t.disconnect?.().catch(() => {});
      this.t = null;
      throw new MainnetReadError(`Refusing: ${this.node} reports network_id ${id}, not Mainnet (0)`, 'NETWORK');
    }
    this.verified = true;
    this.serverInfo = r.result.info;
  }

  async #failover() {
    await this.t?.disconnect?.().catch(() => {});
    this.t = null; this.verified = false;
    this.idx = (this.idx + 1) % this.nodes.length;
    this.stats.failovers++;
  }

  async request(req) {
    const cmd = req?.command;
    if (!READ.has(cmd)) throw new MainnetReadError(`Refusing: "${cmd}" is not an allowed Mainnet read command for spokes`, 'COMMAND');
    if (req.secret || req.seed || req.tx_blob || req.tx_json) throw new MainnetReadError('Refusing: request carries signing material', 'COMMAND');
    let lastErr;
    for (let attempt = 0; attempt < this.nodes.length; attempt++) {
      try {
        await this.#connect();
        const wait = this.last + this.minGapMs - Date.now();
        if (wait > 0) await sleep(wait);
        this.last = Date.now();
        this.stats.requests++;
        return await withTimeout(this.t.request(req), this.timeoutMs, cmd);
      } catch (e) {
        if (e.code === 'NETWORK') throw e; // never fall back past a network mismatch silently
        lastErr = e;
        if (isBusy(e) || e.code === 'TIMEOUT' || /connect|websocket|socket|ECONN|NotConnected/i.test(e.message)) { await this.#failover(); continue; }
        throw e; // a normal rippled error (e.g. actNotFound) is an answer, not an outage
      }
    }
    throw lastErr;
  }

  async disconnect() { await this.t?.disconnect?.().catch(() => {}); this.t = null; this.verified = false; }
}
