// Reference pool for the XDLC corridor-vs-AMM simulation: the REAL XRPL Mainnet XRP/RLUSD AMM (balances + trading fee),
// read-only via lib/mainnet-observer.mjs (no wallet, read allowlist: amm_info). Labeled MAINNET_OBSERVED.
// Fallback chain (never invented): live read -> last cached read (data/xdlc-amm-reference.json) -> the vendor probe's
// stored XRPL sample (data/vendor-samples.json, also a real Mainnet read) -> a clearly labeled ILLUSTRATIVE pool.
// Offline replay mode (TF_OFFLINE=1): no network; cached reads are served as REPLAY.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MainnetObserver, MAINNET_WSS } from '../mainnet-observer.mjs';
import { RLUSD } from '../vendors/xrpl.mjs';
import { withTimeout, safeMessage } from '../vendors/common.mjs';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
export const REFERENCE_FILE = process.env.TF_XDLC_AMM_FILE || path.join(DATA, 'xdlc-amm-reference.json');
export const VENDOR_SAMPLES_FILE = process.env.TF_VENDOR_SAMPLES_FILE || path.join(DATA, 'vendor-samples.json');
export const ILLUSTRATIVE = Object.freeze({
  mode: 'SIMULATION', label: 'ILLUSTRATIVE', source: 'illustrative pool (no Mainnet read available)',
  pool: { xrp: 2000000, rlusd: 2600000, tradingFee: 200 }, observedAt: null, ledgerIndex: null,
  note: 'Illustrative numbers only: not observed on any ledger.',
});
export const AMM_REQUEST = Object.freeze({ command: 'amm_info', asset: { currency: 'XRP' }, asset2: { currency: RLUSD.currency, issuer: RLUSD.issuer }, ledger_index: 'validated' });

// amm_info result -> reference record (null if the pool is not in the result).
export function parseAmmInfo(result, { now = () => Date.now() } = {}) {
  const a = result?.amm;
  if (!a || a.amount == null || a.amount2?.value == null) return null;
  const xrp = Number(a.amount) / 1e6, rlusd = Number(a.amount2.value), tradingFee = Number(a.trading_fee);
  if (!(xrp > 0 && rlusd > 0 && tradingFee >= 0)) return null;
  return { mode: 'MAINNET_OBSERVED', label: 'MAINNET_OBSERVED', source: `${MAINNET_WSS} amm_info (read-only, lib/mainnet-observer.mjs)`,
    pair: 'XRP/RLUSD', ammAccount: a.account || null, rlusdIssuer: RLUSD.issuer,
    pool: { xrp, rlusd, tradingFee, feeBps: tradingFee / 10 }, lpTokenSupply: a.lp_token?.value ?? null,
    ledgerIndex: result.ledger_index ?? null, ledgerHash: result.ledger_hash ?? null, validated: result.validated ?? null,
    observedAt: new Date(now()).toISOString() };
}

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

export function fromVendorSample(file = VENDOR_SAMPLES_FILE) {
  const s = readJson(file)?.samples?.xrpl;
  const a = s?.result?.ammInfo;
  if (!a?.xrpDrops || !a?.rlusd) return null;
  const tradingFee = Number(a.tradingFee);
  return { mode: 'MAINNET_OBSERVED', label: 'MAINNET_OBSERVED', source: 'stored vendor probe sample (real Mainnet amm_info read, data/vendor-samples.json)',
    pair: 'XRP/RLUSD', ammAccount: a.account || null, rlusdIssuer: RLUSD.issuer,
    pool: { xrp: Number(a.xrpDrops) / 1e6, rlusd: Number(a.rlusd), tradingFee, feeBps: tradingFee / 10 }, lpTokenSupply: a.lpTokenSupply ?? null,
    ledgerIndex: s.result?.validatedLedger?.index ?? null, ledgerHash: null, observedAt: s.capturedAt || null };
}

// Service with an in-memory TTL; a live read at most every ttlMs (concurrent callers share one read).
export function createReferenceService({ observer = () => new MainnetObserver(), file = REFERENCE_FILE, samplesFile = VENDOR_SAMPLES_FILE, offline = false,
  ttlMs = 60_000, timeoutMs = 8_000, now = () => Date.now(), write = true } = {}) {
  let mem = null, memAt = 0, inflight = null, lastError = null, failAt = -Infinity;
  const cached = () => { const c = readJson(file); return c?.pool?.xrp > 0 ? c : null; };
  const decorate = (r, extra) => ({ ...r, ...extra, lastError });
  async function liveRead() {
    const obs = observer();
    try {
      const out = await withTimeout(obs.request(AMM_REQUEST), timeoutMs, 'amm_info');
      const r = parseAmmInfo(out?.result, { now });
      if (!r) throw new Error('amm_info returned no XRP/RLUSD pool');
      if (write) { try { fs.writeFileSync(file, JSON.stringify(r, null, 2) + '\n'); } catch { /* cache is best-effort */ } }
      lastError = null; mem = r; memAt = now();
      return r;
    } finally { try { await obs.disconnect(); } catch { /* ignore */ } }
  }
  async function get({ refresh = false } = {}) {
    if (offline) {
      const c = cached() || fromVendorSample(samplesFile);
      return c ? decorate(c, { mode: 'REPLAY', freshness: 'cached', note: 'Offline replay mode: last recorded Mainnet read, no network.' }) : decorate(ILLUSTRATIVE, { freshness: 'illustrative' });
    }
    if (!refresh && mem && now() - memAt < ttlMs) return decorate(mem, { freshness: 'live' });
    const backoff = !refresh && now() - failAt < ttlMs; // after a failed read, serve the fallback for ttlMs before retrying
    if (!inflight && !backoff) inflight = liveRead().catch((e) => { lastError = safeMessage(e); failAt = now(); return null; }).finally(() => { inflight = null; });
    const r = inflight ? await inflight : null;
    if (r) return decorate(r, { freshness: 'live' });
    if (mem) return decorate(mem, { freshness: 'cached' });
    const c = cached();
    if (c) return decorate(c, { freshness: 'cached', note: 'Live Mainnet read unavailable: last cached read shown with its timestamp.' });
    const v = fromVendorSample(samplesFile);
    if (v) return decorate(v, { freshness: 'cached', note: 'Live Mainnet read unavailable: stored vendor-probe read shown with its timestamp.' });
    return decorate(ILLUSTRATIVE, { freshness: 'illustrative' });
  }
  return { get, peek: () => mem };
}
