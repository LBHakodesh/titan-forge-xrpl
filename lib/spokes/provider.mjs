// Spokes: ranking discovery from the documented XRPL.to public API (no website scraping).
//   GET https://api.xrpl.to/v1/tokens?limit=<n>&sort=vol24hxrp   (docs: https://api.xrpl.to/v1/docs)
// Terms (usagePolicy, read 2026-10-24): any surface showing this data must show a visible, clickable credit
// "Data by xrpl.to" linking to https://xrpl.to; storing and re-serving the data from our own API/public dashboard needs
// written permission (hello@xrpl.to). Anonymous limits: 30 req/min, /tokens 5/min, 333/day per IP; honour Retry-After.
// We call /tokens once per refresh (default every 30 min) and keep only the fields below.
import { currencyFields, ledgerCurrency, spokeId } from './identity.mjs';

export const PROVIDER = 'xrpl.to';
export const PROVIDER_BASE = 'https://api.xrpl.to/v1';
export const ATTRIBUTION = 'Rankings: XRPL.to';
export const ATTRIBUTION_URL = 'https://xrpl.to';
export const ATTRIBUTION_HTML = '<a href="https://xrpl.to" target="_blank" rel="noopener">Data by xrpl.to</a>';
const UA = 'titan-forge-hackathon/1.0 (read-only rankings; attribution shown)';

export class ProviderError extends Error { constructor(msg, { status, retryAfterSec } = {}) { super(msg); this.status = status; this.retryAfterSec = retryAfterSec; } }

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// Parse a /tokens response into ranked, minimal asset records. Pure.
export function parseRanking(body, { fetchedAt = new Date().toISOString(), offset = 0 } = {}) {
  if (!body || body.success !== true || !Array.isArray(body.tokens)) throw new ProviderError('Unexpected ranking response shape');
  const out = [];
  body.tokens.forEach((t, i) => {
    if (!t || !t.issuer || !t.currency || t.issuer === 'XRPL') return;
    let code;
    try { code = ledgerCurrency(t.currency); } catch { return; }
    const cf = currencyFields(code);
    const exch = num(t.exch), usd = num(t.usd);
    out.push({
      id: spokeId('mainnet', code, t.issuer),
      rank: offset + i + 1,
      network: 'mainnet',
      currency: cf.currency, currencyHex: cf.currencyHex, ledgerCurrency: code,
      issuer: t.issuer,
      name: String(t.name ?? cf.currency),
      issuerName: t.user ?? null,
      tokenType: t.tokenType ?? 'trustline',
      vol24hXrp: num(t.vol24hxrp),
      vol24hTx: num(t.vol24htx),
      uniqueTraders24h: num(t.uniqueTraders24h),
      vol24hAmmXrp: num(t.vol24hxrpAMM ?? t.vol24hAMM),
      vol24hOrderbookXrp: num(t.vol24hOrderbook),
      tvlXrp: num(t.tvl),
      liquidityRatio: num(t.liquidityRatio),
      lowLiquidity: t.lowLiquidity ?? null,
      holders: num(t.holders),
      priceXrp: exch,
      xrpUsd: exch && usd ? usd / exch : null,
      listedAt: num(t.dateon) ? new Date(num(t.dateon)).toISOString() : null,
      verified: t.verified === true || Number(t.verified) >= 1,
      kyc: t.kyc === true,
      highConcentrationRisk: t.highConcentrationRisk ?? null,
      ammAccount: t.AMM ?? null,
      origin: t.origin ?? null,
      providerUpdatedAt: t.lastUpdated ?? null,
      rankedAt: fetchedAt,
    });
  });
  return { fetchedAt, total: num(body.total), sortBy: body.sortBy ?? 'vol24hxrp', attribution: body.attribution ?? null, assets: out };
}

async function getJson(url, timeoutMs, fetchImpl) {
  let res;
  try { res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) { throw new ProviderError(`xrpl.to unreachable: ${e.message}`); }
  if (res.status === 429) throw new ProviderError('xrpl.to rate limit (429)', { status: 429, retryAfterSec: Number(res.headers.get('retry-after')) || 60 });
  if (!res.ok) throw new ProviderError(`xrpl.to HTTP ${res.status}`, { status: res.status });
  return res.json();
}

export async function fetchRanking({ limit = 100, timeoutMs = 15_000, fetchImpl = fetch } = {}) {
  const n = Math.max(1, Math.min(100, limit));
  const body = await getJson(`${PROVIDER_BASE}/tokens?limit=${n}&sort=vol24hxrp&order=desc&skip_metrics=true`, timeoutMs, fetchImpl);
  return parseRanking(body);
}

// xrpl.to scam blocklist (documented GET /scams/addresses). Optional: failure -> null (check reported as "not checked").
export async function fetchScamAddresses({ timeoutMs = 10_000, fetchImpl = fetch } = {}) {
  try {
    const body = await getJson(`${PROVIDER_BASE}/scams/addresses`, timeoutMs, fetchImpl);
    const list = Array.isArray(body?.addresses) ? body.addresses : [];
    return new Set(list.map((a) => (typeof a === 'string' ? a : a?.address)).filter(Boolean));
  } catch { return null; }
}
