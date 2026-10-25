// QuickNode as the fill-observation source for Titan Ghost (Theater live telemetry) and TG Sentinel (ledger freshness).
// When QUICKNODE_XRPL_WSS is set (a wss:// URL), reads PREFER that endpoint; otherwise, or when it cannot serve the
// network being checked, they fall back to the current public sources. Every result says which source served it
// ("Data via QuickNode" or the public source label).
// Read-only by construction: QuickNode traffic goes through MainnetObserver (no wallet, read-command allowlist).
// The QuickNode URL contains its token, so it never leaves this module: views carry the redacted host only.
import { MainnetObserver } from '../mainnet-observer.mjs';
import { isSet, redactUrl, withTimeout, safeMessage } from './common.mjs';

export const QUICKNODE_LABEL = 'Data via QuickNode';
export const PUBLIC_TESTNET_LABEL = 'Data via public XRPL Testnet node (s.altnet.rippletest.net)';

// Which source to prefer, from env presence only. `url` is internal; use sourceView() for anything shown.
export function observationSource(env = process.env) {
  const u = isSet(env, 'QUICKNODE_XRPL_WSS') ? env.QUICKNODE_XRPL_WSS.trim() : null;
  if (u && /^wss:\/\//i.test(u)) return { provider: 'quicknode', label: QUICKNODE_LABEL, host: redactUrl(u), url: u };
  return { provider: 'public', label: PUBLIC_TESTNET_LABEL, host: null, url: null,
    note: u ? 'QUICKNODE_XRPL_WSS is set but is not a wss:// URL: using the public source.' : 'QUICKNODE_XRPL_WSS not set: using the public source.' };
}
export const sourceView = ({ url, ...rest }) => rest;

// One long-lived read-only observer per QuickNode URL (it reconnects on demand inside request()).
const shared = new Map();
const defaultObserver = (url) => { if (!shared.has(url)) shared.set(url, new MainnetObserver(url)); return shared.get(url); };

// Runs `run(request)` against QuickNode when configured AND it reports the expected network_id; otherwise against
// `fallbackRequest` (the current public source). `request(req)` resolves to the raw `{result}` response.
// Returns { result, source } where source is safe to show (no URL token).
export async function preferQuicknode({ env = process.env, run, fallbackRequest, fallbackLabel = PUBLIC_TESTNET_LABEL, expectNetworkId = 1, makeObserver = defaultObserver, timeoutMs = 8000 }) {
  const src = observationSource(env);
  let skipped = null;
  if (src.provider === 'quicknode') {
    try {
      const obs = makeObserver(src.url);
      const req = (r) => withTimeout(obs.request(r), timeoutMs, `QuickNode ${r.command}`);
      const info = (await req({ command: 'server_info' })).result.info;
      const nid = Number(info.network_id ?? 0);
      if (nid === expectNetworkId) {
        const result = await run(req, info);
        return { result, source: { ...sourceView(src), networkId: nid, readOnly: true } };
      }
      skipped = `QuickNode endpoint reports network_id ${nid}, but this check needs ${expectNetworkId} (${expectNetworkId === 1 ? 'Testnet' : 'Mainnet'}).`;
    } catch (e) { skipped = `QuickNode read failed: ${safeMessage(e)}`; }
  }
  if (typeof fallbackRequest !== 'function') throw new Error(skipped || 'No observation source available.');
  const result = await run((r) => withTimeout(Promise.resolve(fallbackRequest(r)), timeoutMs, r.command));
  return { result, source: { provider: 'public', label: fallbackLabel, host: null, readOnly: true, ...(skipped ? { quicknodeSkipped: skipped } : {}), ...(src.note ? { note: src.note } : {}) } };
}

// Sentinel ledger freshness: server_info for XRPL Testnet (network_id 1).
export async function observeServerInfo({ env = process.env, fallbackRequest, makeObserver, timeoutMs } = {}) {
  const { result, source } = await preferQuicknode({ env, fallbackRequest, makeObserver, timeoutMs, expectNetworkId: 1,
    run: async (req, info) => info || (await req({ command: 'server_info' })).result.info });
  return { info: result, source };
}

// Titan Ghost fill observation: re-read the latest recorded LIVE_TESTNET fill hashes (`tx`, a read) and the validated
// ledger. Never invents values: an unreadable hash is reported as such.
export async function observeFills({ env = process.env, hashes = [], fallbackRequest, makeObserver, timeoutMs, now = () => Date.now() } = {}) {
  const list = [...new Set(hashes.filter((h) => /^[0-9A-F]{64}$/i.test(String(h))))].slice(0, 5);
  const { result, source } = await preferQuicknode({ env, fallbackRequest, makeObserver, timeoutMs, expectNetworkId: 1,
    run: async (req, info) => {
      const si = info || (await req({ command: 'server_info' })).result.info;
      const fills = [];
      for (const hash of list) {
        try {
          const r = (await req({ command: 'tx', transaction: hash })).result;
          fills.push({ hash, validated: r.validated === true, result: r.meta?.TransactionResult ?? null, ledger: r.ledger_index ?? null, type: (r.tx_json ?? r).TransactionType ?? null });
        } catch (e) { fills.push({ hash, validated: false, result: null, ledger: null, error: safeMessage(e) }); }
      }
      return { validatedLedger: si?.validated_ledger?.seq ?? null, ledgerAgeSec: si?.validated_ledger?.age ?? null, fills };
    } });
  return { mode: 'LIVE_TESTNET', organic: false, checkedAt: new Date(now()).toISOString(), source, ...result,
    confirmed: result.fills.filter((f) => f.validated && f.result === 'tesSUCCESS').length,
    note: 'Re-read of the latest recorded demo fills (read-only tx lookups). Demo accounts trading each other, organic:false.' };
}
