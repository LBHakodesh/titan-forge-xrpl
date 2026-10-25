// Pathfinder: pure helpers for XRPL amounts and transaction metadata. No network, no signing.
// Shared by the Mainnet profile (MAINNET_OBSERVED) and the Testnet replay attribution (LIVE_TESTNET).

export const TF_PARTIAL_PAYMENT = 0x00020000;
export const TF_INNER_BATCH = 0x40000000;
export const DROPS = 1_000_000;

export const isXrp = (a) => typeof a === 'string' || (a && typeof a === 'object' && a.currency === 'XRP' && !a.issuer);
export const isMpt = (a) => a && typeof a === 'object' && a.mpt_issuance_id != null;

// Numeric value: XRP amounts (drops strings) -> XRP; issued/MPT -> value.
export function amountValue(a) {
  if (a == null) return 0;
  if (typeof a === 'string') return Number(a) / DROPS;
  if (a.currency === 'XRP' && !a.issuer) return Number(a.value ?? 0);
  return Number(a.value ?? 0);
}

// Stable identity of an asset: 'XRP' | 'CUR.rIssuer' | 'MPT:id'.
export function assetKey(a) {
  if (a == null) return null;
  if (isXrp(a)) return 'XRP';
  if (isMpt(a)) return `MPT:${a.mpt_issuance_id}`;
  return `${a.currency}.${a.issuer}`;
}

// 40-hex currency codes decode to ASCII when printable; otherwise a short hex tag.
export function currencyCode(c) {
  if (!c) return '?';
  if (c === 'XRP' || c.length <= 3) return c;
  if (/^[0-9A-F]{40}$/i.test(c)) {
    if (c.startsWith('03')) return `LP:${c.slice(2, 8)}`; // AMM LP token
    const bytes = Buffer.from(c, 'hex').filter((b) => b !== 0);
    const s = String.fromCharCode(...bytes);
    if (s.length && /^[\x20-\x7E]+$/.test(s)) return s;
    return c.slice(0, 8);
  }
  return c;
}

export const shortAddr = (a) => (a ? `${a.slice(0, 5)}…${a.slice(-4)}` : '?');

// Human label for an asset key: 'XRP' | 'USD.rhub8…Tq7' (code + short issuer).
export function assetLabel(key) {
  if (!key) return '?';
  if (key === 'XRP') return 'XRP';
  if (key.startsWith('MPT:')) return `MPT ${key.slice(4, 12)}`;
  const [cur, iss] = key.split('.');
  return `${currencyCode(cur)}.${shortAddr(iss)}`;
}

export const nodeOf = (n) => n.CreatedNode || n.ModifiedNode || n.DeletedNode;
export const kindOf = (n) => (n.CreatedNode ? 'created' : n.ModifiedNode ? 'modified' : 'deleted');

// Offers consumed by a transaction (others' offers whose TakerGets/TakerPays shrank).
// Rule: a fill counts only where PreviousFields.TakerGets/TakerPays minus the final value is > 0, for ModifiedNode
// (partial fill) and DeletedNode (full fill) alike. Deleted offers without such a delta are removals (removedOffers).
// Returns [{ owner, seq, gets, pays, getsKey, paysKey, getsDelta, paysDelta, deleted, xrpDelta }]
// gets/pays are from the OFFER OWNER's point of view: the owner gave `getsDelta` (TakerGets) and received `paysDelta` (TakerPays).
export function consumedOffers(meta, txAccount) {
  const out = [];
  for (const n of meta?.AffectedNodes || []) {
    const node = n.ModifiedNode || n.DeletedNode;
    if (!node || node.LedgerEntryType !== 'Offer') continue;
    const ff = node.FinalFields || {}, pf = node.PreviousFields || {};
    if (!pf.TakerGets && !pf.TakerPays) continue; // deleted for other reasons (cancel/expired/unfunded) or untouched
    if (txAccount && ff.Account === txAccount) continue; // own offer
    const getsDelta = amountValue(pf.TakerGets ?? ff.TakerGets) - amountValue(ff.TakerGets);
    const paysDelta = amountValue(pf.TakerPays ?? ff.TakerPays) - amountValue(ff.TakerPays);
    if (!(getsDelta > 0) && !(paysDelta > 0)) continue;
    const getsKey = assetKey(ff.TakerGets), paysKey = assetKey(ff.TakerPays);
    const xrpDelta = getsKey === 'XRP' ? getsDelta : paysKey === 'XRP' ? paysDelta : 0;
    out.push({ owner: ff.Account, seq: ff.Sequence, getsKey, paysKey, getsDelta, paysDelta, deleted: !!n.DeletedNode, xrpDelta });
  }
  return out;
}

// Offers the engine DELETED without consuming them (no positive TakerGets/TakerPays delta): found unfunded or expired
// while crossing. These are never fills and never captured flow. Deletions of the transaction sender's own offers
// (OfferCancel / OfferSequence replacement) are excluded. closeTime: ledger close in Ripple epoch seconds (optional).
// Returns [{ owner, seq, reason: 'expired' | 'removed_unfunded' }]
export function removedOffers(meta, txAccount, closeTime) {
  const out = [];
  for (const n of meta?.AffectedNodes || []) {
    const node = n.DeletedNode;
    if (!node || node.LedgerEntryType !== 'Offer') continue;
    const ff = node.FinalFields || {}, pf = node.PreviousFields || {};
    if (txAccount && ff.Account === txAccount) continue;
    const getsDelta = pf.TakerGets != null ? amountValue(pf.TakerGets) - amountValue(ff.TakerGets) : 0;
    const paysDelta = pf.TakerPays != null ? amountValue(pf.TakerPays) - amountValue(ff.TakerPays) : 0;
    if (getsDelta > 0 || paysDelta > 0) continue; // a genuine (full) fill — handled by consumedOffers
    const expired = ff.Expiration != null && (closeTime == null || closeTime >= ff.Expiration);
    out.push({ owner: ff.Account, seq: ff.Sequence, reason: expired ? 'expired' : 'removed_unfunded' });
  }
  return out;
}
export const rippleTime = (iso) => (iso ? Math.floor(Date.parse(iso) / 1000) - 946684800 : null);

// AMM pools touched: AccountRoots carrying AMMID, plus their pool trustline/XRP changes.
// Returns [{ account, assets:[keys], xrpDelta }]
export function ammTouches(meta) {
  const nodes = meta?.AffectedNodes || [];
  const amms = new Map();
  for (const n of nodes) {
    const node = nodeOf(n);
    if (!node) continue;
    if (node.LedgerEntryType === 'AccountRoot' && (node.FinalFields?.AMMID || node.NewFields?.AMMID)) {
      const ff = node.FinalFields || node.NewFields;
      const pf = node.PreviousFields || {};
      const xrpDelta = pf.Balance != null ? Math.abs(Number(ff.Balance) - Number(pf.Balance)) / DROPS : 0;
      amms.set(ff.Account, { account: ff.Account, assets: new Set(xrpDelta > 0 ? ['XRP'] : []), xrpDelta });
    }
  }
  if (!amms.size) {
    // An AMM ledger entry change with no AccountRoot change still means AMM involvement.
    const ammEntry = nodes.some((n) => nodeOf(n)?.LedgerEntryType === 'AMM');
    return ammEntry ? [{ account: null, assets: [], xrpDelta: 0 }] : [];
  }
  for (const n of nodes) {
    const node = nodeOf(n);
    if (node?.LedgerEntryType !== 'RippleState') continue;
    const ff = node.FinalFields || node.NewFields || {}, pf = node.PreviousFields || {};
    if (pf.Balance == null) continue;
    const lo = ff.LowLimit?.issuer, hi = ff.HighLimit?.issuer;
    const cur = ff.Balance?.currency;
    for (const [amm, other] of [[lo, hi], [hi, lo]]) {
      const a = amms.get(amm);
      if (a && cur && !cur.startsWith('03')) a.assets.add(`${cur}.${other}`);
    }
  }
  return [...amms.values()].map((a) => ({ ...a, assets: [...a.assets] }));
}

// Per-account balance changes from metadata. Returns Map<account, Map<assetKey, delta>>.
// RippleState balances are from the low account's view; currency is keyed by counterparty (issuer side).
export function balanceChanges(meta) {
  const out = new Map();
  const add = (acct, key, d) => {
    if (!acct || !d) return;
    if (!out.has(acct)) out.set(acct, new Map());
    const m = out.get(acct);
    m.set(key, (m.get(key) || 0) + d);
  };
  for (const n of meta?.AffectedNodes || []) {
    const node = nodeOf(n);
    if (!node) continue;
    const ff = node.FinalFields || node.NewFields || {};
    const pf = node.PreviousFields || {};
    if (node.LedgerEntryType === 'AccountRoot') {
      const fin = Number(ff.Balance ?? 0);
      const prev = n.CreatedNode ? 0 : pf.Balance != null ? Number(pf.Balance) : fin;
      add(ff.Account, 'XRP', (fin - prev) / DROPS);
    } else if (node.LedgerEntryType === 'RippleState') {
      const fin = Number(ff.Balance?.value ?? 0);
      const prev = n.CreatedNode ? 0 : pf.Balance != null ? Number(pf.Balance.value) : fin;
      const d = fin - prev;
      const lo = ff.LowLimit?.issuer, hi = ff.HighLimit?.issuer, cur = ff.Balance?.currency;
      add(lo, `${cur}.${hi}`, d);
      add(hi, `${cur}.${lo}`, -d);
    }
  }
  return out;
}

// Offer created by a transaction (for tracking our own quotes).
export function createdOffer(meta, account) {
  for (const n of meta?.AffectedNodes || []) {
    const c = n.CreatedNode;
    if (c?.LedgerEntryType === 'Offer' && (!account || c.NewFields?.Account === account)) return { seq: c.NewFields.Sequence, takerGets: c.NewFields.TakerGets, takerPays: c.NewFields.TakerPays };
  }
  return null;
}

export const pathHasXrpStep = (paths) => (paths || []).some((p) => (p || []).some((s) => s.currency === 'XRP' || s.currency === '0000000000000000000000000000000000000000'));

export const bookKey = (a, b) => [a, b].sort().join('|');

// Seeded PRNG so plans are reproducible.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hhi = (vals) => {
  const tot = vals.reduce((s, v) => s + v, 0);
  return tot > 0 ? Math.round(vals.reduce((s, v) => s + (v / tot * 100) ** 2, 0)) : 0;
};

export const round = (x, d = 6) => (Number.isFinite(x) ? Number(x.toFixed(d)) : x);
// Issued-currency value string: <=15 significant digits, no exponent.
export const tokenStr = (x) => {
  const s = Number(x.toPrecision(10));
  const f = s.toFixed(Math.max(0, Math.min(15, 10 - Math.floor(Math.log10(Math.abs(s) || 1)) - 1)));
  return f.includes('.') ? f.replace(/0+$/, '').replace(/\.$/, '') : f;
};
export const dropsStr = (xrp) => String(Math.max(1, Math.round(xrp * DROPS)));
