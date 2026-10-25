// HISTORICAL_MAINNET: Titan Ghost's OWN historical Mainnet activity, read-only.
// Source of truth: public r-addresses the Commander supplies in env TG_MAINNET_ACCOUNTS (comma-separated).
// All network access goes through lib/mainnet-observer.mjs (no wallet, read-command allowlist). No new network URL here.
// Commands used: account_info, account_lines (allowlisted today) and account_tx, account_offers (attempted; if the
// observer allowlist refuses them, the panel says so: it never fills the gap with invented hashes or P&L).
// Cached to data/mainnet-history.json. Without addresses -> status 'awaiting'.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidClassicAddress, getBalanceChanges } from 'xrpl';

export const HIST = 'HISTORICAL_MAINNET';
export const AWAITING_MSG = 'Awaiting Titan Ghost Mainnet account address (public) from Commander';
export const HISTORY_FILE = process.env.TF_MAINNET_HISTORY_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'mainnet-history.json');
export const RLUSD_HEX = '524C555344000000000000000000000000000000';
const TX_LIMIT = 200;

// Parse env -> { accounts: valid public r-addresses, rejected: [{value, reason}] }. Never accepts secrets.
export function parseAccounts(env = process.env) {
  const raw = String(env.TG_MAINNET_ACCOUNTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const accounts = [], rejected = [];
  for (const v of raw) {
    if (/^s[1-9A-HJ-NP-Za-km-z]{20,}$/.test(v)) { rejected.push({ value: '[secret-shaped value withheld]', reason: 'looks like a secret seed: only public r-addresses are accepted' }); continue; }
    if (!isValidClassicAddress(v)) { rejected.push({ value: v.slice(0, 40), reason: 'not a valid classic r-address' }); continue; }
    if (!accounts.includes(v)) accounts.push(v);
  }
  return { accounts, rejected };
}

export function awaiting(rejected = []) {
  return { mode: HIST, status: 'awaiting', message: AWAITING_MSG, accounts: [], rejected, fills: [], inventory: [],
    pnl: { status: 'not_attributable', reason: 'No Titan Ghost Mainnet account configured.' },
    howTo: 'Set TG_MAINNET_ACCOUNTS=rAddr1,rAddr2 (public addresses only) and restart; the Theater then reads them via the read-only Mainnet observer.' };
}

const currencyName = (c) => (c === RLUSD_HEX ? 'RLUSD' : c && c.length === 40 ? Buffer.from(c, 'hex').toString('utf8').replace(/\0+$/, '') || c : c);
const fromRippleTime = (t) => (Number.isFinite(t) ? new Date((t + 946684800) * 1000).toISOString() : null);

// Pure: turn one account_tx entry into a fill-like record for `account`, or null if it did not change balances.
export function txToFill(entry, account) {
  const tx = entry.tx_json || entry.tx || {};
  const meta = entry.meta || entry.metaData;
  const hash = entry.hash || tx.hash;
  if (!meta || typeof meta !== 'object' || meta.TransactionResult !== 'tesSUCCESS' || !hash) return null;
  const mine = getBalanceChanges(meta).find((b) => b.account === account);
  if (!mine) return null;
  const deltas = {};
  let feeXrp = 0;
  if (tx.Account === account && tx.Fee) feeXrp = Number(tx.Fee) / 1e6;
  for (const b of mine.balances) {
    const name = b.currency === 'XRP' ? 'XRP' : currencyName(b.currency);
    deltas[name] = (deltas[name] || 0) + Number(b.value);
  }
  if (deltas.XRP != null) deltas.XRP += feeXrp; // fee is not a trade flow
  const traded = Object.entries(deltas).filter(([, v]) => Math.abs(v) > 1e-9);
  if (traded.length < 2) return null; // only fee / one-sided transfer: not a fill
  return { mode: HIST, hash, ledger: entry.ledger_index ?? tx.ledger_index ?? null, at: entry.close_time_iso || fromRippleTime(tx.date), txType: tx.TransactionType, account, deltas: Object.fromEntries(traded), feeXrp, explorer: `https://livenet.xrpl.org/transactions/${hash}` };
}

// P&L is reported only when it is computable from real data. Net balance deltas across mixed assets need a mark price
// we do not have from these reads, so unless every fill is single-asset-pair XRP/RLUSD with both legs present, it is
// "not attributable". When it is, we report realized flows per asset, not a USD profit figure.
export function attribute(fills) {
  if (!fills.length) return { status: 'not_attributable', reason: 'No historical fills read yet.' };
  const flows = {};
  for (const f of fills) for (const [k, v] of Object.entries(f.deltas)) flows[k] = (flows[k] || 0) + v;
  const fees = fills.reduce((s, f) => s + f.feeXrp, 0);
  return { status: 'flows_only', mode: HIST, netFlowsByAsset: flows, feesXrp: fees, fills: fills.length,
    reason: 'USD P&L not attributable: no recorded mark price for these fills. Net asset flows and fees are shown as read from the ledger.' };
}

export function readCache(file = HISTORY_FILE) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch { return null; }
}
function writeCache(v, file) { try { fs.writeFileSync(file + '.tmp', JSON.stringify(v, null, 1)); fs.renameSync(file + '.tmp', file); } catch (e) { console.error('[theater] history cache write failed:', e.message); } }

// Current view: awaiting if no addresses; otherwise the cache for exactly these addresses (or 'not_fetched').
export function loadHistory({ env = process.env, file = HISTORY_FILE } = {}) {
  const { accounts, rejected } = parseAccounts(env);
  if (!accounts.length) return awaiting(rejected);
  const c = readCache(file);
  if (c && JSON.stringify(c.accounts) === JSON.stringify(accounts)) return { ...c, rejected, cached: true };
  return { mode: HIST, status: 'not_fetched', accounts, rejected, fills: [], inventory: [], pnl: { status: 'not_attributable', reason: 'Not fetched yet.' },
    message: 'Titan Ghost Mainnet addresses configured; read-only history not fetched yet.' };
}

// Read-only fetch via the Mainnet observer. `makeObserver` is injectable for tests. Never signs; never submits.
export async function refreshHistory({ env = process.env, file = HISTORY_FILE, makeObserver, offline = false } = {}) {
  const { accounts, rejected } = parseAccounts(env);
  if (!accounts.length) return awaiting(rejected);
  if (offline) return { ...loadHistory({ env, file }), note: 'Offline replay mode: Mainnet not contacted.' };
  if (!makeObserver) { const { MainnetObserver } = await import('../mainnet-observer.mjs'); makeObserver = () => new MainnetObserver(); }
  const obs = makeObserver();
  const out = { mode: HIST, status: 'loaded', fetchedAt: new Date().toISOString(), accounts, source: 'lib/mainnet-observer.mjs (read-only allowlist)', fills: [], inventory: [], offers: [], blocked: [], errors: [] };
  const tryReq = async (req) => {
    try { return { ok: true, r: await obs.request(req) }; }
    catch (e) {
      if (/not an allowed read command/.test(e.message)) out.blocked.push({ command: req.command, reason: e.message, fix: `Lead decision: add '${req.command}' to READ_COMMANDS in lib/mainnet-observer.mjs (read-only command).` });
      else out.errors.push({ command: req.command, account: req.account, error: e.message });
      return { ok: false };
    }
  };
  try {
    for (const account of accounts) {
      const inv = { mode: HIST, account, xrp: null, lines: [] };
      const ai = await tryReq({ command: 'account_info', account, ledger_index: 'validated' });
      if (ai.ok) inv.xrp = Number(ai.r.result.account_data.Balance) / 1e6;
      const al = await tryReq({ command: 'account_lines', account, ledger_index: 'validated' });
      if (al.ok) inv.lines = (al.r.result.lines || []).map((l) => ({ currency: currencyName(l.currency), issuer: l.account, balance: Number(l.balance) }));
      out.inventory.push(inv);
      const ao = await tryReq({ command: 'account_offers', account, ledger_index: 'validated' });
      if (ao.ok) for (const o of ao.r.result.offers || []) out.offers.push({ mode: HIST, account, seq: o.seq, takerGets: o.taker_gets, takerPays: o.taker_pays, quality: o.quality });
      const at = await tryReq({ command: 'account_tx', account, ledger_index_min: -1, ledger_index_max: -1, limit: TX_LIMIT, forward: false });
      if (at.ok) for (const e of at.r.result.transactions || []) { const f = txToFill(e, account); if (f) out.fills.push(f); }
    }
  } finally { await obs.disconnect?.().catch?.(() => {}); }
  // De-duplicate across commands (same command blocked for each account).
  out.blocked = [...new Map(out.blocked.map((b) => [b.command, b])).values()];
  out.pnl = attribute(out.fills);
  if (out.blocked.length && !out.fills.length) out.message = `Historical fills unavailable: ${out.blocked.map((b) => b.command).join(', ')} not in the Mainnet observer allowlist. Inventory (account_info / account_lines) is real.`;
  writeCache(out, file);
  return { ...out, rejected };
}
