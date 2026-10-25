// Mainnet pathfinding flow profile — MAINNET_OBSERVED, read-only.
// Samples recent validated Mainnet ledgers through MainnetObserver (no wallet, read allowlist) and classifies
// how the XRPL payment engine routed cross-currency Payments. These are third-party Mainnet statistics:
// they are never our activity and are never mixed with Testnet figures.
import {
  TF_PARTIAL_PAYMENT, TF_INNER_BATCH, isXrp, amountValue, assetKey, assetLabel, shortAddr,
  consumedOffers, removedOffers, rippleTime, ammTouches, balanceChanges, pathHasXrpStep, bookKey, hhi, round,
} from './amounts.mjs';

export const MODE = 'MAINNET_OBSERVED';
export const DUST_XRP = 0.001;
export const ROUTES = ['xrp_to_token', 'token_to_xrp', 'token_to_token', 'xrp_to_xrp'];
export const ROUTE_LABEL = {
  xrp_to_token: 'XRP → token', token_to_xrp: 'token → XRP', token_to_token: 'token → token', xrp_to_xrp: 'XRP → XRP (circular)',
};
// Log-scale size buckets in XRP-equivalent: [lo, hi)
export const SIZE_EDGES = [0, 0.001, 0.01, 0.1, 1, 10, 100, 1_000, 10_000, 100_000, Infinity];
export const sizeLabel = (i) => {
  const f = (x) => (x >= 1000 ? `${x / 1000}k` : String(x));
  const lo = SIZE_EDGES[i], hi = SIZE_EDGES[i + 1];
  return lo === 0 ? `<${f(hi)}` : hi === Infinity ? `≥${f(lo)}` : `${f(lo)}–${f(hi)}`;
};
export const sizeBucket = (x) => { for (let i = 0; i < SIZE_EDGES.length - 1; i++) if (x < SIZE_EDGES[i + 1]) return i; return SIZE_EDGES.length - 2; };

// Classify one Payment (ledger tx entry with tx_json/meta, or a flat tx with metaData). Returns null for non-Payments.
export function classifyPayment(entry, closeTime = rippleTime(entry.close_time_iso)) {
  const tx = entry.tx_json ?? entry.tx ?? entry;
  const meta = entry.meta ?? entry.metaData;
  if (tx.TransactionType !== 'Payment') return null;
  const result = meta?.TransactionResult ?? null;
  const flags = Number(tx.Flags || 0);
  const amount = tx.DeliverMax ?? tx.Amount;
  const delivered = meta && meta.delivered_amount && meta.delivered_amount !== 'unavailable' ? meta.delivered_amount : amount;
  const src = tx.SendMax ?? amount;
  const srcKey = assetKey(src), dstKey = assetKey(delivered);
  const paths = Array.isArray(tx.Paths) ? tx.Paths : [];
  const crossCurrency = srcKey !== dstKey;
  const pathfound = crossCurrency || paths.length > 0;
  const partial = (flags & TF_PARTIAL_PAYMENT) !== 0;
  const circular = tx.Account === tx.Destination;
  const base = { hash: entry.hash ?? tx.hash, result, success: result === 'tesSUCCESS', partial, circular, innerBatch: (flags & TF_INNER_BATCH) !== 0, pathfound, crossCurrency, srcKey, dstKey };
  if (!pathfound) return { ...base, route: isXrp(delivered) ? 'xrp_direct' : 'issued_direct', xrpEquiv: isXrp(delivered) ? amountValue(delivered) : null };

  const route = srcKey === 'XRP' ? (dstKey === 'XRP' ? 'xrp_to_xrp' : 'xrp_to_token') : dstKey === 'XRP' ? 'token_to_xrp' : 'token_to_token';
  const offers = base.success ? consumedOffers(meta, tx.Account) : [];
  const removed = base.success ? removedOffers(meta, tx.Account, closeTime) : [];
  const amms = base.success ? ammTouches(meta) : [];
  const legs = new Set();
  for (const o of offers) legs.add(bookKey(o.getsKey, o.paysKey));
  for (const a of amms) if (a.assets.length >= 2) legs.add(bookKey(a.assets[0], a.assets[1])); else if (a.assets.length === 1) legs.add(bookKey(a.assets[0], a.assets[0] === 'XRP' ? `?amm:${a.account}` : 'XRP'));
  const legHasXrp = [...legs].some((k) => k.split('|').includes('XRP'));
  const xrpLegs = [...legs].filter((k) => k.split('|').includes('XRP'));
  // XRP-bridged: neither end is XRP, yet the route stepped through XRP (path step or X/XRP + XRP/Y legs consumed).
  const bridged = srcKey !== 'XRP' && dstKey !== 'XRP' && (pathHasXrpStep(paths) || xrpLegs.length >= 2 || (legHasXrp && route === 'token_to_token'));
  const liquidity = offers.length && amms.length ? 'book+amm' : offers.length ? 'book' : amms.length ? 'amm' : 'none';

  // XRP-equivalent size: the XRP end if there is one, else the XRP moved on the busiest XRP leg.
  let xrpEquiv = null;
  if (dstKey === 'XRP') xrpEquiv = amountValue(delivered);
  else if (srcKey === 'XRP' && base.success) {
    const ch = balanceChanges(meta).get(tx.Account)?.get('XRP');
    const fee = Number(tx.Fee || 0) / 1e6;
    if (ch != null && !circular) xrpEquiv = Math.max(0, -ch - fee);
    if (!xrpEquiv) xrpEquiv = offers.reduce((s, o) => s + o.xrpDelta, 0) + amms.reduce((s, a) => s + a.xrpDelta, 0) || null;
  } else if (base.success) {
    const perLeg = new Map();
    for (const o of offers) if (o.xrpDelta) perLeg.set(bookKey(o.getsKey, o.paysKey), (perLeg.get(bookKey(o.getsKey, o.paysKey)) || 0) + o.xrpDelta);
    for (const a of amms) if (a.xrpDelta) perLeg.set(`amm:${a.account}`, (perLeg.get(`amm:${a.account}`) || 0) + a.xrpDelta);
    xrpEquiv = perLeg.size ? Math.max(...perLeg.values()) : null;
  }
  const makers = offers.map((o) => ({ owner: o.owner, xrp: o.xrpDelta })).concat(amms.filter((a) => a.account).map((a) => ({ owner: a.account, xrp: a.xrpDelta, amm: true })));
  return {
    ...base, route, bridged, hops: legs.size, multiHop: legs.size >= 2, liquidity, amm: amms.length > 0,
    pathCount: paths.length, maxPathLen: paths.reduce((m, p) => Math.max(m, p.length), 0),
    xrpEquiv, offersConsumed: offers.length, makers,
    removals: { removed_unfunded: removed.filter((r) => r.reason === 'removed_unfunded').length, expired: removed.filter((r) => r.reason === 'expired').length },
  };
}

// OfferCreate that crossed resting liquidity (and whether it auto-bridged through XRP).
export function classifyOfferCreate(entry) {
  const tx = entry.tx_json ?? entry.tx ?? entry;
  const meta = entry.meta ?? entry.metaData;
  if (tx.TransactionType !== 'OfferCreate' || meta?.TransactionResult !== 'tesSUCCESS') return null;
  const offers = consumedOffers(meta, tx.Account);
  const amms = ammTouches(meta);
  const crossed = offers.length > 0 || amms.length > 0;
  const g = assetKey(tx.TakerGets), p = assetKey(tx.TakerPays);
  const xrpLegs = new Set(offers.filter((o) => o.xrpDelta).map((o) => bookKey(o.getsKey, o.paysKey)));
  return { crossed, bridged: crossed && g !== 'XRP' && p !== 'XRP' && xrpLegs.size >= 2, amm: amms.length > 0 };
}

const share = (n, d) => (d ? round(n / d, 4) : 0);
const mix = (items, key, keys) => {
  const c = Object.fromEntries((keys || []).map((k) => [k, 0]));
  for (const it of items) c[it[key]] = (c[it[key]] || 0) + 1;
  return c;
};

// Aggregate a set of classified pathfound payments into chartable stats.
export function aggregate(items, { topN = 10 } = {}) {
  const n = items.length;
  const routeMix = mix(items, 'route', ROUTES);
  const hopMix = { single_book: 0, multi_hop: 0, no_book: 0 };
  for (const it of items) hopMix[it.hops === 0 ? 'no_book' : it.multiHop ? 'multi_hop' : 'single_book']++;
  const liquidityMix = mix(items, 'liquidity', ['book', 'amm', 'book+amm', 'none']);
  const tt = items.filter((i) => i.route === 'token_to_token');
  const sizeHist = SIZE_EDGES.slice(0, -1).map((_, i) => ({ bucket: sizeLabel(i), lo: SIZE_EDGES[i], hi: SIZE_EDGES[i + 1] === Infinity ? null : SIZE_EDGES[i + 1], count: 0 }));
  let unsized = 0;
  const sizes = [];
  for (const it of items) { if (it.xrpEquiv > 0) { sizeHist[sizeBucket(it.xrpEquiv)].count++; sizes.push(it.xrpEquiv); } else unsized++; }
  sizes.sort((a, b) => a - b);
  const q = (p) => (sizes.length ? round(sizes[Math.min(sizes.length - 1, Math.floor(p * sizes.length))], 6) : null);

  const pairs = new Map();
  for (const it of items) { const k = `${it.srcKey}>${it.dstKey}`; pairs.set(k, (pairs.get(k) || 0) + 1); }
  const topPairs = [...pairs].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([k, count]) => {
    const [s, d] = k.split('>');
    return { pair: `${assetLabel(s)} → ${assetLabel(d)}`, count, share: share(count, n) };
  });

  // Maker capture concentration: whose resting liquidity (offers or AMM pools) the routed payments consumed.
  const cap = new Map();
  for (const it of items) for (const m of it.makers || []) {
    const e = cap.get(m.owner) || { owner: m.owner, amm: !!m.amm, xrp: 0, fills: 0 };
    e.xrp += m.xrp || 0; e.fills++; cap.set(m.owner, e);
  }
  const capList = [...cap.values()].sort((a, b) => b.xrp - a.xrp || b.fills - a.fills);
  const capXrp = capList.reduce((s, e) => s + e.xrp, 0);
  const capFills = capList.reduce((s, e) => s + e.fills, 0);
  const topShare = (k) => share(capList.slice(0, k).reduce((s, e) => s + e.xrp, 0), capXrp);
  const ammXrp = capList.filter((e) => e.amm).reduce((s, e) => s + e.xrp, 0);

  const removals = { removed_unfunded: 0, expired: 0 };
  for (const it of items) { removals.removed_unfunded += it.removals?.removed_unfunded || 0; removals.expired += it.removals?.expired || 0; }
  return {
    count: n,
    removals, // unfunded/expired offers the engine deleted while crossing: NOT fills, NOT captured flow
    routeMix,
    xrpBridged: { count: items.filter((i) => i.bridged).length, shareOfAll: share(items.filter((i) => i.bridged).length, n), shareOfTokenToToken: share(tt.filter((i) => i.bridged).length, tt.length) },
    hopMix, liquidityMix,
    ammInvolved: { count: items.filter((i) => i.amm).length, share: share(items.filter((i) => i.amm).length, n) },
    paths: { withPaths: items.filter((i) => i.pathCount > 0).length, avgPathCount: round(items.reduce((s, i) => s + (i.pathCount || 0), 0) / (n || 1), 2), maxPathLen: items.reduce((m, i) => Math.max(m, i.maxPathLen || 0), 0) },
    sizeHist, unsized, sizeXrp: { p10: q(0.1), median: q(0.5), p90: q(0.9), total: round(sizes.reduce((s, x) => s + x, 0), 2) },
    topPairs,
    makerCapture: {
      providers: capList.length, fills: capFills, xrp: round(capXrp, 6), hhi: hhi(capList.map((e) => e.xrp)),
      top1Share: topShare(1), top5Share: topShare(5), top10Share: topShare(10), ammShareXrp: share(ammXrp, capXrp),
      top: capList.slice(0, topN).map((e) => ({ account: shortAddr(e.owner), amm: e.amm, xrp: round(e.xrp, 6), fills: e.fills, share: share(e.xrp, capXrp) })),
    },
  };
}

// Build the profile from fetched ledgers (pure; ledgers = [{ ledger_index, close_time_iso, transactions:[...] }]).
export function buildProfile(ledgers, { sampledAt = new Date().toISOString(), errors = 0 } = {}) {
  const pays = [];
  let txs = 0, innerBatch = 0;
  const oc = { total: 0, crossed: 0, bridged: 0, amm: 0 };
  const failedPathfound = { count: 0 };
  for (const L of ledgers) for (const e of L.transactions || []) {
    txs++;
    const tx = e.tx_json ?? e;
    if (Number(tx.Flags || 0) & TF_INNER_BATCH) innerBatch++;
    const c = classifyPayment(e, rippleTime(e.close_time_iso ?? L.close_time_iso));
    if (c) { if (c.pathfound && !c.success) failedPathfound.count++; pays.push(c); continue; }
    const o = classifyOfferCreate(e);
    if (o) { oc.total++; if (o.crossed) oc.crossed++; if (o.bridged) oc.bridged++; if (o.amm) oc.amm++; }
  }
  const ok = pays.filter((p) => p.success);
  const pf = ok.filter((p) => p.pathfound);
  const isDust = (p) => p.xrpEquiv != null && p.xrpEquiv < DUST_XRP;
  const endUser = pf.filter((p) => !p.partial && !p.circular && !isDust(p));
  const dust = pf.filter((p) => !p.partial && !p.circular && isDust(p));
  const partial = pf.filter((p) => p.partial);
  const circular = pf.filter((p) => p.circular && !p.partial);
  const idx = ledgers.map((l) => Number(l.ledger_index)).filter(Number.isFinite);
  const times = ledgers.map((l) => l.close_time_iso).filter(Boolean).sort();
  return {
    mode: MODE,
    note: 'Observed third-party XRPL Mainnet activity (read-only sample). Not Titan Forge activity and not demand for any demo token.',
    sampledAt,
    window: {
      fromLedger: idx.length ? Math.min(...idx) : null, toLedger: idx.length ? Math.max(...idx) : null, ledgers: ledgers.length, errors,
      fromTime: times[0] ?? null, toTime: times.at(-1) ?? null,
      seconds: times.length > 1 ? Math.round((Date.parse(times.at(-1)) - Date.parse(times[0])) / 1000) : null,
    },
    totals: {
      txs, payments: pays.length, paymentsSuccess: ok.length, pathfound: pf.length, failedPathfound: failedPathfound.count,
      directXrp: ok.filter((p) => p.route === 'xrp_direct').length, directIssued: ok.filter((p) => p.route === 'issued_direct').length,
      endUser: endUser.length, partial: partial.length, circular: circular.length, dust: dust.length, innerBatch,
      pathfoundShareOfPayments: share(pf.length, ok.length),
    },
    endUser: aggregate(endUser),
    pathfoundAll: aggregate(pf),
    partial: { ...aggregate(partial, { topN: 5 }), note: 'tfPartialPayment lets the sender deliver less than Amount. It is a known fake-volume / spoofed-deposit vector, so these are reported separately and never replayed.' },
    circular: { ...aggregate(circular, { topN: 5 }), note: 'Sender = destination: typically arbitrage loops or self-conversions, not payments to a third party. Reported separately.' },
    dust: { ...aggregate(dust, { topN: 5 }), note: `Pathfound payments worth under ${DUST_XRP} XRP (micro-swaps / dust spam into thin pools). Reported separately so they do not distort the size profile.` },
    offerCreate: oc,
  };
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error('cancelled'));
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('cancelled')); }, { once: true });
});

// Public Mainnet servers meter expensive commands (xrplcluster: "units quota ... retry in ~Nms").
export function retryAfterMs(e) {
  const code = e?.data?.error;
  if (code !== 'tooBusy' && code !== 'slowDown') return null;
  const m = /retry in ~?(\d+)\s*ms/i.exec(e.data?.error_message || e.message || '');
  return m ? Number(m[1]) : 10_000;
}

// Sample the last `n` validated ledgers through a read-only request function (MainnetObserver.request).
// Rate limited to `rps` requests/second, backs off when the server asks, cancellable via AbortSignal.
// If `maxMs` elapses, the profile is built from the ledgers fetched so far (window.truncated = true).
export async function sampleProfile(request, { n = 40, rps = 3, signal, onProgress = () => {}, wait = sleep, maxMs = 15 * 60_000, maxBackoffMs = 120_000, now = Date.now } = {}) {
  n = Math.max(1, Math.min(200, Math.floor(n)));
  const gap = Math.ceil(1000 / rps);
  const t0 = now();
  const head = await request({ command: 'ledger', ledger_index: 'validated' });
  const top = Number(head.result.ledger_index ?? head.result.ledger?.ledger_index);
  const ledgers = [];
  let errors = 0, backoffs = 0, truncated = false;
  for (let i = 0; i < n; i++) {
    if (signal?.aborted) throw new Error('cancelled');
    if (now() - t0 > maxMs) { truncated = true; break; }
    await wait(gap, signal);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await request({ command: 'ledger', ledger_index: top - i, transactions: true, expand: true });
        const L = r.result.ledger;
        // Keep only what classification needs.
        ledgers.push({ ledger_index: Number(L.ledger_index), close_time_iso: L.close_time_iso, transactions: L.transactions });
        break;
      } catch (e) {
        if (signal?.aborted) throw new Error('cancelled');
        const ra = retryAfterMs(e);
        if (ra == null || attempt === 4) { errors++; break; }
        backoffs++;
        const ms = Math.min(maxBackoffMs, ra + 500);
        onProgress({ done: i, of: n, ledger: top - i, waitingMs: ms, reason: 'Mainnet server rate limit; backing off' });
        await wait(ms, signal);
      }
    }
    onProgress({ done: i + 1, of: n, ledger: top - i, fetched: ledgers.length });
  }
  const p = buildProfile(ledgers, { errors });
  Object.assign(p.window, { requested: n, truncated, backoffs, elapsedSec: Math.round((now() - t0) / 1000) });
  return p;
}

// Default flow shape used for planning when no Mainnet sample exists yet (clearly labeled as such).
export const DEFAULT_SHAPE = {
  source: 'default (no Mainnet sample yet)',
  routeMix: { xrp_to_token: 5, token_to_xrp: 4, token_to_token: 1 },
  sizeHist: [{ lo: 1, hi: 10, count: 3 }, { lo: 10, hi: 100, count: 4 }, { lo: 100, hi: 1000, count: 2 }, { lo: 1000, hi: 10000, count: 1 }],
  medianXrp: 30,
};

// Combine additive parts of aggregates (used for profiles saved before pathfoundAll existed).
export function mergeAggregates(list) {
  const sum = (key) => { const o = {}; for (const a of list) for (const [k, v] of Object.entries(a[key] || {})) o[k] = (o[k] || 0) + v; return o; };
  const count = list.reduce((s, a) => s + a.count, 0);
  const sizeHist = list[0].sizeHist.map((b, i) => ({ ...b, count: list.reduce((s, a) => s + (a.sizeHist[i]?.count || 0), 0) }));
  const tt = list.reduce((s, a) => s + (a.routeMix.token_to_token || 0), 0);
  const br = list.reduce((s, a) => s + (a.xrpBridged.count || 0), 0);
  const amm = list.reduce((s, a) => s + (a.ammInvolved.count || 0), 0);
  return { count, merged: true, removals: sum('removals'), routeMix: sum('routeMix'), hopMix: sum('hopMix'), liquidityMix: sum('liquidityMix'), sizeHist,
    xrpBridged: { count: br, shareOfAll: count ? round(br / count, 4) : 0, shareOfTokenToToken: tt ? round(br / tt, 4) : 0 },
    ammInvolved: { count: amm, share: count ? round(amm / count, 4) : 0 } };
}

// Median from a histogram (geometric midpoint of the median bucket).
function histMedian(hist) {
  const tot = hist.reduce((s, b) => s + b.count, 0);
  let c = 0;
  for (const b of hist) { c += b.count; if (c >= tot / 2 && b.count) { const lo = Math.max(b.lo || 0, 1e-4), hi = b.hi ?? lo * 10; return Math.sqrt(lo * hi); } }
  return null;
}

// Flow shape (route weights + XRP-equivalent size histogram) for the replay.
// Prefers full-delivery third-party payments; if the window has (almost) none, falls back to all pathfound
// payments incl. partial/circular (their route and size profile only — the replay never uses tfPartialPayment).
export function flowShape(profile) {
  if (!profile?.endUser) return DEFAULT_SHAPE;
  const win = `ledgers ${profile.window.fromLedger}–${profile.window.toLedger}`;
  let agg = profile.endUser, source = `Mainnet full-delivery third-party pathfound payments, ${win}`;
  if (agg.count < 3) {
    agg = profile.pathfoundAll || mergeAggregates([profile.endUser, profile.partial, profile.circular, profile.dust].filter(Boolean));
    source = `Mainnet ALL pathfound payments incl. partial/circular (${win} had only ${profile.endUser.count} full-delivery third-party ones). Route and size profile only: the replay sends full-delivery payments, never partial.`;
  }
  const rm = { xrp_to_token: agg.routeMix.xrp_to_token || 0, token_to_xrp: agg.routeMix.token_to_xrp || 0, token_to_token: agg.routeMix.token_to_token || 0 };
  if (agg.count < 3 || !(rm.xrp_to_token + rm.token_to_xrp + rm.token_to_token)) return DEFAULT_SHAPE;
  const sizeHist = agg.sizeHist.filter((b) => b.count > 0).map((b) => ({ lo: b.lo, hi: b.hi, count: b.count }));
  return {
    source, fallback: agg !== profile.endUser,
    routeMix: rm,
    sizeHist,
    medianXrp: agg.sizeXrp?.median || histMedian(sizeHist) || DEFAULT_SHAPE.medianXrp,
    bridgedShareOfTokenToToken: agg.xrpBridged.shareOfTokenToToken,
  };
}

// Compact summary for the bus event.
export const profileSummary = (p) => ({
  window: p.window, pathfound: p.totals.pathfound, endUser: p.totals.endUser, partial: p.totals.partial, circular: p.totals.circular,
  dust: p.totals.dust, routeMix: p.endUser.routeMix, xrpBridgedShare: p.endUser.xrpBridged.shareOfAll, ammShare: p.endUser.ammInvolved.share, top5MakerShare: p.endUser.makerCapture.top5Share,
});
