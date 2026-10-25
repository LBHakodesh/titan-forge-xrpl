// Spokes: eligibility screening. Each check is { id, ok, detail, blocking }.
// eligible = every blocking check ok. Ineligible assets may be displayed (flagged) but are never funding candidates.
// Thresholds are illustrative screening parameters for the hackathon demo, not investment criteria.
import { normTicker } from './identity.mjs';
import { depthAt } from './market.mjs';

export const RULES = {
  establishedMinAgeDays: 365,          // Group A: listed at least this long
  minTrades24h: 50,
  minTraders24h: 20,
  maxTradesPerTrader: 100,             // above this, activity looks bot/wash-dominated
  maxTransferFeePct: 2,
  minDepthXrp: { A: 1_000, B: 100 },  // effective funded depth (CLOB + AMM) each side within the 2% band
  depthBand: '2%',
};

// Tickers that impersonate a stablecoin, fiat, XRP itself or a brand when used by a non-canonical issuer.
export const SENSITIVE_EXACT = new Set(['XRP', 'USD', 'USDC', 'USDT', 'RLUSD', 'EUR', 'EURC', 'GBP', 'JPY', 'CNY', 'BTC', 'ETH', 'DAI', 'PYUSD', 'SOL', 'RIPPLE']);
export const SENSITIVE_CONTAINS = ['XRP', 'RLUSD', 'USDC', 'USDT', 'RIPPLE', 'TETHER', 'CIRCLE'];
// Canonical issuers known to this app (publicly documented). Provider `verified` tokens are also accepted.
export const CANONICAL = {
  RLUSD: ['rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De'],  // Ripple
  USDC: ['rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE'],   // Circle
  USD: ['rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq', 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B'], // GateHub, Bitstamp
  EUR: ['rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq'],
  BTC: ['rchGBxcD1A1C2tdxF6papQYZ8kjRKMYcL', 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B'],
};
const XRP_LIKE = new Set(['XRP']);

export const check = (id, ok, detail, blocking = true) => ({ id, ok: !!ok, detail, blocking });
export const isEligible = (checks) => checks.every((c) => !c.blocking || c.ok);
export const ageDays = (iso, now = Date.now()) => (iso ? Math.floor((now - Date.parse(iso)) / 86_400_000) : null);

export function nameIntegrity(a) {
  const t = normTicker(a.name || a.currency);
  const t2 = normTicker(a.currency);
  const hits = new Set();
  for (const x of [t, t2]) {
    if (SENSITIVE_EXACT.has(x)) hits.add(x);
    for (const s of SENSITIVE_CONTAINS) if (x.includes(s) && x !== s) hits.add(s);
  }
  if (!hits.size) return check('name_integrity', true, 'Ticker does not resemble a stablecoin, fiat, XRP or brand ticker.');
  const canonical = [...hits].some((h) => (CANONICAL[h] || []).includes(a.issuer));
  if ([...hits].some((h) => XRP_LIKE.has(h)) && t === 'XRP') return check('name_integrity', false, 'Issued token named "XRP": XRP is native and never issued.');
  if (canonical) return check('name_integrity', true, `Sensitive ticker (${[...hits].join(', ')}) from its canonical issuer.`);
  if (a.verified || a.kyc) return check('name_integrity', true, `Sensitive ticker (${[...hits].join(', ')}); issuer is provider-verified${a.kyc ? '/KYC' : ''}, not in our canonical list.`);
  return check('name_integrity', false, `Ticker resembles ${[...hits].join(', ')} but issuer ${a.issuer} is not a canonical or provider-verified issuer (possible impersonation).`);
}

// Cheap checks from ranking data only (no ledger reads).
export function providerChecks(a, { scamSet = null, collisions = null, now = Date.now() } = {}) {
  const out = [];
  out.push(check('token_type', a.tokenType === 'trustline', a.tokenType === 'trustline' ? 'Trustline token (tradable on XRP order books).' : `Token type ${a.tokenType}: not modeled as a spoke.`));
  out.push(nameIntegrity(a));
  const tr = a.vol24hTx ?? 0, tt = a.uniqueTraders24h ?? 0;
  out.push(check('market_activity', tr >= RULES.minTrades24h && tt >= RULES.minTraders24h, `${tr} trades / ${tt} unique traders in 24h (min ${RULES.minTrades24h} / ${RULES.minTraders24h}).`));
  const ratio = tt ? tr / tt : null;
  out.push(check('activity_quality', ratio == null || ratio <= RULES.maxTradesPerTrader, ratio == null ? 'No trader count reported.' : `${ratio.toFixed(1)} trades per trader (max ${RULES.maxTradesPerTrader}; higher suggests bot/wash-dominated volume).`));
  const age = ageDays(a.listedAt, now);
  out.push(check('market_age', age != null, age == null ? 'Listing date unknown.' : `Listed ${age} days ago (${age >= RULES.establishedMinAgeDays ? 'established' : 'emerging'}).`, false));
  if (scamSet) out.push(check('scam_blocklist', !scamSet.has(a.issuer), scamSet.has(a.issuer) ? 'Issuer is on the xrpl.to scam blocklist.' : 'Issuer not on the xrpl.to scam blocklist.'));
  else out.push(check('scam_blocklist', true, 'Scam blocklist unavailable this refresh: not checked.', false));
  out.push(check('concentration', a.highConcentrationRisk !== true, a.highConcentrationRisk === true ? 'Provider flags high holder concentration (provider metric; flags most XRPL tokens, so informational).' : 'No high-concentration flag from provider.', false));
  const col = collisions?.get(normTicker(a.name || a.currency));
  if (col) {
    const others = col.filter((c) => c.id !== a.id);
    out.push(check('ticker_collision', false, `Ticker shared with ${others.length} other issuer(s): ${others.map((o) => `${o.issuer}${o.rank ? ` (#${o.rank})` : ''}`).join(', ')}. Identity uses (currency, issuer).`, false));
  }
  return out;
}

// Checks needing Mainnet reads: issuer profile + funded two-sided depth.
export function ledgerChecks(issuer, summary, group) {
  const out = [];
  if (!issuer || !issuer.exists) {
    out.push(check('issuer_exists', false, 'Issuer account not found on Mainnet (validated).'));
    return out;
  }
  out.push(check('issuer_exists', true, 'Issuer account exists on Mainnet (validated ledger).'));
  out.push(check('no_global_freeze', !issuer.globalFreeze, issuer.globalFreeze ? 'Issuer has GlobalFreeze set.' : 'No GlobalFreeze.'));
  out.push(check('no_require_auth', !issuer.requireAuth, issuer.requireAuth ? 'Issuer requires authorized trustlines (RequireAuth).' : 'No RequireAuth.'));
  out.push(check('default_ripple', issuer.defaultRipple, issuer.defaultRipple ? 'DefaultRipple set (holders can trade with each other).' : 'DefaultRipple not set: holder-to-holder rippling/DEX settlement may fail.'));
  out.push(check('transfer_fee', issuer.transferFeePct <= RULES.maxTransferFeePct, `Transfer fee ${issuer.transferFeePct}% (max ${RULES.maxTransferFeePct}%).`));
  out.push(check('clawback', !issuer.clawback, issuer.clawback ? 'Issuer can claw back balances (AllowTrustLineClawback).' : 'No clawback flag.', false));
  out.push(check('blackholed', issuer.blackholed, issuer.blackholed ? 'Issuer is blackholed (master disabled, no usable regular key or signer list): supply fixed, cannot freeze.' : `Issuer not blackholed (master ${issuer.disableMaster ? 'disabled' : 'enabled'}${issuer.regularKey ? ', regular key set' : ''}${issuer.signerLists ? ', signer list' : ''}).`, false));
  const min = RULES.minDepthXrp[group] ?? RULES.minDepthXrp.B;
  const b = depthAt(summary, 'bids', RULES.depthBand), a = depthAt(summary, 'asks', RULES.depthBand);
  out.push(check('two_sided_liquidity', b >= min && a >= min, `Funded depth within ${RULES.depthBand}: bids ${Math.round(b).toLocaleString('en-US')} XRP, asks ${Math.round(a).toLocaleString('en-US')} XRP (CLOB + AMM; min ${min.toLocaleString('en-US')} each side).`));
  return out;
}
