// QuickNode adapter: managed XRPL RPC/WSS endpoints + Streams (XRPL Mainnet and Testnet, block/ledger data).
// Docs verified 2026-10-25: quicknode.com/docs/xrpl/api-overview (XRPL JSON-RPC, HTTP + WSS, Testnet supported),
// /docs/streams/rest-api (base https://api.quicknode.com/streams/rest/v1, header x-api-key, GET /streams),
// /docs/streams/supported-chains (XRP Ledger Mainnet + Testnet, Block "(Ledger)" dataset).
// Read-only: WSS goes through MainnetObserver (read allowlist, no wallet); HTTP uses the same read-only subset;
// Streams is only listed (GET), never created or modified. Credentials come from process env only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidClassicAddress } from 'xrpl';
import { MainnetObserver } from '../mainnet-observer.mjs';
import { makeAdapter, isSet, redactUrl, withTimeout, safeMessage } from './common.mjs';
import { observationSource, sourceView } from './observation.mjs';

export const CREDENTIAL_ENV = ['QUICKNODE_XRPL_HTTP', 'QUICKNODE_XRPL_WSS', 'QUICKNODE_STREAMS_KEY'];
export const HTTP_READ_METHODS = new Set(['server_info', 'ledger', 'book_offers', 'account_offers', 'amm_info', 'tx', 'account_info']);
export const STREAMS_API = 'https://api.quicknode.com/streams/rest/v1';
const netLabel = (id) => (id === 1 ? 'LIVE_TESTNET' : id === 0 || id == null ? 'MAINNET_OBSERVED' : 'UNAVAILABLE');

// Streams filter template (ready to deploy, NOT deployed). Addresses come from GET /api/status at runtime.
export const STREAM_FILTER_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'quicknode-stream-filter.json');
export const STREAM_ROLES = ['maker', 'router', 'router2', 'router3'];
export const loadStreamFilter = () => JSON.parse(fs.readFileSync(STREAM_FILTER_FILE, 'utf8'));
export function renderStreamFilter(status) {
  const t = loadStreamFilter();
  const accts = status?.accounts || {};
  const watch = STREAM_ROLES.map((role) => ({ role, address: accts[role]?.address })).filter((x) => isValidClassicAddress(String(x.address || '')));
  if (!watch.length) throw Object.assign(new Error('No maker/router addresses in /api/status yet.'), { status: 503 });
  return { status: t.status, deployed: false, network: t.network, dataset: t.dataset, accounts: watch, addressSource: t.addresses.source,
    filterFunction: t.filterFunction.replace(t.addresses.placeholder, JSON.stringify(watch.map((x) => x.address))), destination: t.destination, safety: t.safety, docs: t.docs };
}

export function quicknodeStatus({ env, lastProbe }) {
  const any = CREDENTIAL_ENV.some((k) => isSet(env, k));
  if (!any) return 'CREDENTIALS_REQUIRED';
  if (lastProbe && !lastProbe.ok) return 'ERROR';
  if (lastProbe?.ok && !lastProbe.fallback) return 'CONNECTED_TESTED';
  return 'CONNECTED';
}

export function createQuicknodeAdapter({ env = process.env, samples = null, now = () => Date.now(), fetchFn = (...a) => globalThis.fetch(...a), observer = (url) => new MainnetObserver(url), offline = false, timeoutMs = 10_000 } = {}) {
  const httpRpc = async (url, method, params = {}) => {
    if (!HTTP_READ_METHODS.has(method)) throw new Error(`QuickNode adapter: ${method} is not an allowed read method`);
    const r = await withTimeout(fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, params: [params] }) }), timeoutMs, `QuickNode ${method}`);
    if (!r.ok) throw new Error(`QuickNode HTTP ${r.status}`);
    const j = await r.json();
    if (j?.result?.status === 'error') throw new Error(`QuickNode ${method}: ${j.result.error}`);
    return j.result;
  };
  return makeAdapter({
    id: 'quicknode', name: 'QuickNode (XRPL RPC + Streams)', env, samples, now,
    docs: ['https://www.quicknode.com/docs/xrpl/api-overview', 'https://www.quicknode.com/docs/streams', 'https://www.quicknode.com/docs/streams/rest-api', 'https://www.quicknode.com/docs/streams/supported-chains'],
    capability: 'Dedicated XRPL JSON-RPC/WSS endpoint (Mainnet or Testnet) as a higher-rate replacement for public nodes in the read-only observer; Streams for XRPL ledger (block) data to a webhook. Read methods only.',
    credentialEnv: CREDENTIAL_ENV,
    computeStatus: quicknodeStatus,
    extra: () => ({ endpoints: { http: isSet(env, 'QUICKNODE_XRPL_HTTP') ? redactUrl(env.QUICKNODE_XRPL_HTTP) : null, wss: isSet(env, 'QUICKNODE_XRPL_WSS') ? redactUrl(env.QUICKNODE_XRPL_WSS) : null, streams: isSet(env, 'QUICKNODE_STREAMS_KEY') ? STREAMS_API : null },
      fallback: 'Without credentials the app keeps using public XRPL nodes through lib/mainnet-observer.mjs.',
      observation: { preferred: sourceView(observationSource(env)), usedBy: ['Titan Ghost Theater: fill observation (GET /api/theater/observe)', 'TG Sentinel: ledger freshness (server_info)'],
        rule: 'Preferred only when QUICKNODE_XRPL_WSS is set and the endpoint reports network_id 1 (Testnet); otherwise the public source is used and shown.' },
      streamFilter: { file: 'lib/vendors/quicknode-stream-filter.json', deployed: false, endpoint: 'GET /api/vendors/quicknode/stream-filter' } }),
    runProbe: async () => {
      if (offline) return { ok: false, error: 'Offline replay mode: no network.', countAsError: false };
      const http = isSet(env, 'QUICKNODE_XRPL_HTTP') ? env.QUICKNODE_XRPL_HTTP.trim() : null;
      const wss = isSet(env, 'QUICKNODE_XRPL_WSS') ? env.QUICKNODE_XRPL_WSS.trim() : null;
      const key = isSet(env, 'QUICKNODE_STREAMS_KEY') ? env.QUICKNODE_STREAMS_KEY.trim() : null;
      if (!http && !wss && !key) {
        // Public fallback: prove the read path works, but this is NOT a QuickNode test (status stays CREDENTIALS_REQUIRED).
        const obs = observer();
        try {
          const si = (await withTimeout(obs.request({ command: 'server_info' }), timeoutMs, 'public server_info')).result.info;
          return { ok: true, fallback: true, countsAsVendorTest: false, mode: 'MAINNET_OBSERVED', note: 'No QuickNode credentials set: probed the public fallback node instead. This is not a QuickNode result.', result: { publicFallback: { validatedLedger: si.validated_ledger?.seq ?? null, buildVersion: si.build_version ?? null } } };
        } finally { try { await obs.disconnect(); } catch { /* ignore */ } }
      }
      const checks = {}; const result = {};
      if (wss) {
        if (!/^wss:\/\//i.test(wss)) checks.wss = { ok: false, error: 'QUICKNODE_XRPL_WSS must start with wss://' };
        else {
          const obs = observer(wss);
          try {
            const si = (await withTimeout(obs.request({ command: 'server_info' }), timeoutMs, 'QuickNode WSS server_info')).result.info;
            result.wss = { host: redactUrl(wss), networkId: si.network_id ?? 0, mode: netLabel(si.network_id ?? 0), validatedLedger: si.validated_ledger?.seq ?? null, buildVersion: si.build_version ?? null };
            checks.wss = { ok: true };
          } catch (e) { checks.wss = { ok: false, error: safeMessage(e) }; } finally { try { await obs.disconnect(); } catch { /* ignore */ } }
        }
      }
      if (http) {
        if (!/^https:\/\//i.test(http)) checks.http = { ok: false, error: 'QUICKNODE_XRPL_HTTP must start with https://' };
        else {
          try {
            const si = (await httpRpc(http, 'server_info')).info;
            result.http = { host: redactUrl(http), networkId: si.network_id ?? 0, mode: netLabel(si.network_id ?? 0), validatedLedger: si.validated_ledger?.seq ?? null, buildVersion: si.build_version ?? null };
            checks.http = { ok: true };
          } catch (e) { checks.http = { ok: false, error: safeMessage(e) }; }
        }
      }
      if (key) {
        try {
          const r = await withTimeout(fetchFn(`${STREAMS_API}/streams`, { method: 'GET', headers: { 'x-api-key': key, accept: 'application/json' } }), timeoutMs, 'Streams list');
          if (!r.ok) throw new Error(`Streams API HTTP ${r.status}`);
          const j = await r.json();
          const list = Array.isArray(j) ? j : j.data || j.streams || [];
          result.streams = { count: list.length, xrplStreams: list.filter((s) => /xrp/i.test(String(s.network || s.chain || ''))).map((s) => ({ name: s.name ?? null, network: s.network ?? null, dataset: s.dataset ?? null, status: s.status ?? null })).slice(0, 10) };
          checks.streams = { ok: true };
        } catch (e) { checks.streams = { ok: false, error: safeMessage(e) }; }
      }
      const ok = Object.values(checks).length > 0 && Object.values(checks).every((c) => c.ok);
      const mode = result.wss?.mode || result.http?.mode || 'MAINNET_OBSERVED';
      if (!ok) return { ok: false, error: Object.entries(checks).filter(([, c]) => !c.ok).map(([k, c]) => `${k}: ${c.error}`).join('; '), checks, result };
      return { ok: true, mode, checks, result, sample: { mode, source: 'QuickNode endpoints from env (host only shown)', probe: Object.keys(checks).join(', '), result } };
    },
  });
}

export default createQuicknodeAdapter();
