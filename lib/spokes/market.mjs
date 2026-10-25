// Spokes: order-book, AMM and issuer-account math. Pure helpers (no network).
// Prices are XRP per 1 token. "Funded" uses rippled's taker_gets_funded / taker_pays_funded when the owner can't cover the
// full offer. Asks = offers selling the token for XRP; bids = offers buying the token with XRP.

export const BANDS = [0.005, 0.01, 0.02, 0.05];
export const bandLabel = (b) => `${+(b * 100).toFixed(2)}%`;
const DROPS = 1_000_000;

const RIPPLE_EPOCH = 946_684_800;
// Expired offers stay in the ledger until something crosses them; book_offers still lists them. Skip them.
export const expired = (o, nowSec = Date.now() / 1000) => o.Expiration != null && Number(o.Expiration) + RIPPLE_EPOCH <= nowSec;

const val = (a) => (a == null ? 0 : typeof a === 'string' ? Number(a) / DROPS : Number(a.value ?? 0));

// book_offers result (taker_gets=token, taker_pays=XRP) -> asks
export function parseAsks(offers = [], nowSec = Date.now() / 1000) {
  const out = [];
  for (const o of offers) {
    if (expired(o, nowSec)) continue;
    const tok = val(o.taker_gets_funded ?? o.TakerGets);
    const xrp = val(o.taker_pays_funded ?? o.TakerPays);
    const fullTok = val(o.TakerGets), fullXrp = val(o.TakerPays);
    if (!(fullTok > 0) || !(fullXrp > 0)) continue;
    const price = fullXrp / fullTok;
    if (!(tok > 0)) continue; // unfunded
    out.push({ account: o.Account, price, token: tok, xrp: xrp > 0 ? xrp : tok * price });
  }
  return out.sort((a, b) => a.price - b.price);
}

// book_offers result (taker_gets=XRP, taker_pays=token) -> bids
export function parseBids(offers = [], nowSec = Date.now() / 1000) {
  const out = [];
  for (const o of offers) {
    if (expired(o, nowSec)) continue;
    const xrp = val(o.taker_gets_funded ?? o.TakerGets);
    const tok = val(o.taker_pays_funded ?? o.TakerPays);
    const fullXrp = val(o.TakerGets), fullTok = val(o.TakerPays);
    if (!(fullTok > 0) || !(fullXrp > 0)) continue;
    const price = fullXrp / fullTok;
    if (!(xrp > 0)) continue;
    out.push({ account: o.Account, price, token: tok > 0 ? tok : xrp / price, xrp });
  }
  return out.sort((a, b) => b.price - a.price);
}

// Constant-product AMM: XRP that moves the pool price by band b. asks: XRP paid in to push price up by b;
// bids: XRP taken out to push price down by b. Trading fee ignored (approximation, documented).
export function ammDepth(poolXrp, b) {
  if (!(poolXrp > 0)) return { ask: 0, bid: 0 };
  return { ask: poolXrp * (Math.sqrt(1 + b) - 1), bid: poolXrp * (1 - Math.sqrt(1 - b)) };
}

// Top of book, spread and funded depth by price band.
// Reference price: CLOB mid when two-sided; otherwise the best price of the side that exists; otherwise the AMM price.
// Crossed offers cannot coexist with crossable liquidity on XRPL; when we see them they are uncrossable (frozen or
// unauthorized trustlines, stale state). Drop the smaller (by XRP) crossed set until the book is consistent.
export function uncross(asks, bids) {
  let a = asks, b = bids, dropped = 0;
  for (let i = 0; i < 5 && a.length && b.length && b[0].price > a[0].price; i++) {
    const ca = a.filter((o) => o.price < b[0].price), cb = b.filter((o) => o.price > a[0].price);
    const xa = ca.reduce((s, o) => s + o.xrp, 0), xb = cb.reduce((s, o) => s + o.xrp, 0);
    if (xb <= xa) { b = b.filter((o) => !cb.includes(o)); dropped += cb.length; } else { a = a.filter((o) => !ca.includes(o)); dropped += ca.length; }
  }
  return { asks: a, bids: b, dropped };
}

export function bookSummary(rawAsks, rawBids, amm = null, bands = BANDS) {
  const { asks, bids, dropped } = uncross(rawAsks, rawBids);
  const ask = asks.length ? asks[0].price : null;
  const bid = bids.length ? bids[0].price : null;
  const mid = ask != null && bid != null ? (ask + bid) / 2 : null;
  const ref = mid ?? ask ?? bid ?? (amm?.present ? amm.priceXrp : null);
  const crossed = ask != null && bid != null && bid > ask;
  const spreadBps = mid && !crossed ? ((ask - bid) / mid) * 10_000 : null;
  const sum = (arr, ok) => arr.reduce((s, o) => (ok(o.price) ? s + o.xrp : s), 0);
  const mk = (side) => bands.map((b) => {
    if (ref == null) return { band: bandLabel(b), xrp: 0, clobXrp: 0, ammXrp: 0 };
    const clob = side === 'asks' ? sum(asks, (p) => p <= ref * (1 + b)) : sum(bids, (p) => p >= ref * (1 - b));
    const a = amm?.present ? ammDepth(amm.xrp, b)[side === 'asks' ? 'ask' : 'bid'] : 0;
    return { band: bandLabel(b), xrp: round(clob + a, 6), clobXrp: round(clob, 6), ammXrp: round(a, 6) };
  });
  return {
    bid, ask, mid, refPrice: ref, refBasis: mid != null ? 'clob_mid' : ask != null ? 'best_ask' : bid != null ? 'best_bid' : ref != null ? 'amm' : null,
    spreadBps: spreadBps == null ? null : round(spreadBps, 2), crossed, uncrossableDropped: dropped,
    depthXrp: { bids: mk('bids'), asks: mk('asks') },
    offers: { asks: asks.length, bids: bids.length },
    makers: { asks: [...new Set(asks.map((o) => o.account))].length, bids: [...new Set(bids.map((o) => o.account))].length },
  };
}

export const depthAt = (summary, side, label) => summary?.depthXrp?.[side]?.find((d) => d.band === label)?.xrp ?? 0;

// amm_info result -> { present, xrp, token, priceXrp, account, tradingFeeBps }
export function parseAmm(result) {
  const amm = result?.amm;
  if (!amm) return { present: false, xrp: 0, token: 0 };
  const a1 = amm.amount, a2 = amm.amount2;
  const x = typeof a1 === 'string' ? val(a1) : typeof a2 === 'string' ? val(a2) : null;
  const t = typeof a1 === 'string' ? val(a2) : typeof a2 === 'string' ? val(a1) : null;
  if (x == null) return { present: false, xrp: 0, token: 0 };
  return { present: true, xrp: round(x, 6), token: round(t, 6), priceXrp: t > 0 ? x / t : null, account: amm.account ?? null, tradingFeeBps: amm.trading_fee != null ? amm.trading_fee / 10 : null };
}

// Issuer account flags (AccountRoot).
export const LSF = { DefaultRipple: 0x00800000, RequireAuth: 0x00040000, GlobalFreeze: 0x00400000, NoFreeze: 0x00200000, DisableMaster: 0x00100000, AllowTrustLineClawback: 0x80000000 };
export const BLACKHOLE_KEYS = new Set(['rrrrrrrrrrrrrrrrrrrrrhoLvTp', 'rrrrrrrrrrrrrrrrrrrrBZbvji', 'rrrrrrrrrrrrrrrrrrrn5RM1rHd']);

export function issuerProfile(accountInfoResult) {
  const ad = accountInfoResult?.account_data;
  if (!ad) return { exists: false };
  const f = Number(ad.Flags || 0);
  const has = (k) => (f & LSF[k]) >>> 0 !== 0;
  const signerLists = accountInfoResult.signer_lists ?? ad.signer_lists ?? [];
  const transferRate = ad.TransferRate ? Number(ad.TransferRate) : 1_000_000_000;
  const disableMaster = has('DisableMaster');
  const regularKey = ad.RegularKey ?? null;
  const blackholed = disableMaster && (!regularKey || BLACKHOLE_KEYS.has(regularKey)) && signerLists.length === 0;
  return {
    exists: true,
    defaultRipple: has('DefaultRipple'), requireAuth: has('RequireAuth'), globalFreeze: has('GlobalFreeze'), noFreeze: has('NoFreeze'),
    clawback: has('AllowTrustLineClawback'), disableMaster, regularKey, signerLists: signerLists.length,
    blackholed, transferFeePct: round((transferRate - 1_000_000_000) / 10_000_000, 6), domain: ad.Domain ? Buffer.from(ad.Domain, 'hex').toString('utf8') : null,
    sequence: ad.Sequence ?? null,
  };
}

export function round(x, d = 6) { if (x == null || !Number.isFinite(x)) return x ?? null; const m = 10 ** d; return Math.round(x * m) / m; }
