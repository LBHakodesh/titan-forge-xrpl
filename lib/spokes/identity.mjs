// Spokes: asset identity. An asset is ALWAYS (network, currency, issuer) — never the ticker alone.
// `currency` in an id is the on-ledger code: a 3-char ISO-style code or the 40-hex non-standard code.
// Pure helpers, no network.

export const NETWORKS = ['mainnet', 'testnet'];
export const HUB = { currency: 'XRP' };

const HEX40 = /^[0-9A-F]{40}$/i;

// Ledger-form currency code (what rippled uses): 3-char stays, 40-hex upper-cased.
export function ledgerCurrency(c) {
  if (typeof c !== 'string' || !c) throw new Error('currency required');
  if (c === 'XRP') return 'XRP';
  if (HEX40.test(c)) return c.toUpperCase();
  if (/^[A-Za-z0-9?!@#$%^&*<>(){}[\]|]{3}$/.test(c)) return c;
  // A longer ASCII ticker: encode to 40-hex the way XRPL tools do (UTF-8, right-padded with zeros).
  const b = Buffer.from(c, 'utf8');
  if (b.length > 20) throw new Error(`currency "${c}" longer than 20 bytes`);
  return Buffer.concat([b, Buffer.alloc(20 - b.length)]).toString('hex').toUpperCase();
}

// Human ticker for display. Non-standard codes decode as UTF-8 when printable; LP tokens are tagged.
export function displayTicker(code) {
  if (!code) return '?';
  if (!HEX40.test(code)) return code;
  if (code.startsWith('03')) return `LP:${code.slice(2, 10)}`;
  const raw = Buffer.from(code, 'hex');
  let end = raw.length; while (end > 0 && raw[end - 1] === 0) end--;
  const s = raw.subarray(0, end).toString('utf8');
  if (s && !s.includes('�') && !/[\x00-\x1F\x7F]/.test(s)) return s;
  return code.slice(0, 8);
}

// { currency (display), currencyHex (40-hex or null) } from any input form.
export function currencyFields(c) {
  const code = ledgerCurrency(c);
  return HEX40.test(code) ? { currency: displayTicker(code), currencyHex: code } : { currency: code, currencyHex: null };
}

export function spokeId(network, currency, issuer) {
  if (!NETWORKS.includes(network)) throw new Error(`bad network ${network}`);
  if (!issuer || !/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(issuer)) throw new Error(`bad issuer ${issuer}`);
  return `${network}:${ledgerCurrency(currency)}:${issuer}`;
}

export function parseSpokeId(id) {
  const m = /^(mainnet|testnet):([^:]+):(r[1-9A-HJ-NP-Za-km-z]{24,34})$/.exec(String(id));
  if (!m) return null;
  return { network: m[1], currency: m[2], issuer: m[3] };
}

// Key used to match ledger amounts: 'XRP' or '<ledgerCode>.<issuer>' (network implied by the caller).
export function assetKey(a) {
  if (a == null) return null;
  if (typeof a === 'string') return 'XRP';
  if (a.currency === 'XRP' && !a.issuer) return 'XRP';
  if (a.mpt_issuance_id) return `MPT:${a.mpt_issuance_id}`;
  return `${ledgerCurrency(a.currency)}.${a.issuer}`;
}

// Normalized ticker for collision / impersonation comparison: case-folded, alphanumerics only.
export const normTicker = (t) => String(t || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Ticker collisions: same normalized ticker, different (currency, issuer). Returns Map(normTicker -> [{id, rank}]).
export function tickerCollisions(assets) {
  const by = new Map();
  for (const a of assets) {
    const k = normTicker(a.name || a.currency);
    if (!k) continue;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push({ id: a.id, issuer: a.issuer, rank: a.rank ?? null });
  }
  for (const [k, v] of by) if (v.length < 2) by.delete(k);
  return by;
}

export const explorerUrl = (network, hash) => network === 'mainnet'
  ? `https://livenet.xrpl.org/transactions/${hash}`
  : `https://testnet.xrpl.org/transactions/${hash}`;
