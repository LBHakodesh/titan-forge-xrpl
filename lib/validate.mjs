// Input validation for visitor-launched demo tokens.
export const CATEGORIES = ['community', 'currency', 'securities', 'real_estate', 'precious_metals'];

// Codes that impersonate real currencies, commodities or major assets.
const RESERVED_CODES = new Set([
  'XRP', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CHF', 'CAD', 'AUD', 'NZD', 'HKD', 'SGD', 'INR', 'MXN', 'BRL', 'KRW',
  'BTC', 'ETH', 'SOL', 'ADA', 'BNB', 'DOT', 'LTC', 'XLM', 'XAU', 'XAG', 'XPT', 'XPD', 'GLD', 'SLV',
]);

// Brand names and backing claims that would mislead.
const BLOCKED_TERMS = [
  'ripple', 'xrpl foundation', 'coinbase', 'binance', 'kraken', 'tether', 'circle', 'usdc', 'usdt', 'rlusd',
  'blackrock', 'vanguard', 'jpmorgan', 'goldman', 'visa', 'mastercard', 'paypal', 'apple', 'google', 'amazon',
  'microsoft', 'tesla', 'federal reserve', 'treasury', 'sec ', 'bank of', 'official', 'backed', 'guaranteed',
  'redeemable', 'insured', 'stablecoin',
];

export function validateLaunch(input) {
  const errors = [];
  const name = String(input?.name ?? '').trim();
  const code = String(input?.code ?? '').trim().toUpperCase();
  const supply = Number(input?.supply);
  const category = String(input?.category ?? '');
  const description = String(input?.description ?? '').trim();
  const alias = String(input?.alias ?? '').trim();

  if (name.length < 2 || name.length > 40) errors.push('Name must be 2–40 characters.');
  if (!/^[\p{L}\p{N} .,'&!-]+$/u.test(name)) errors.push('Name has unsupported characters.');
  if (!/^[A-Z0-9]{3}$/.test(code)) errors.push('Ticker must be exactly 3 letters or digits.');
  if (RESERVED_CODES.has(code)) errors.push(`Ticker ${code} is reserved for a real-world asset.`);
  if (!Number.isInteger(supply) || supply < 1000 || supply > 1_000_000_000) errors.push('Supply must be a whole number from 1,000 to 1,000,000,000.');
  if (!CATEGORIES.includes(category)) errors.push('Choose a project category.');
  if (description.length > 280) errors.push('Description must be 280 characters or fewer.');
  if (alias.length > 24 || (alias && !/^[\p{L}\p{N} _.-]+$/u.test(alias))) errors.push('Alias must be up to 24 plain characters.');
  if (input?.consent !== true) errors.push('Testnet participation consent is required.');

  const haystack = ` ${name} ${description} ${alias} `.toLowerCase();
  const hit = BLOCKED_TERMS.find((t) => haystack.includes(t));
  if (hit) errors.push(`"${hit.trim()}" isn't allowed: no brand names or real-asset backing claims.`);

  return errors.length ? { ok: false, errors } : { ok: true, value: { name, code, supply, category, description, alias } };
}
