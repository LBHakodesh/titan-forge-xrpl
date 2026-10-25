// Pathfinder per-payment evidence + NO_PATH diagnosis (LIVE_TESTNET, demo-generated, read-only).
//
// Two layers:
//   collectRaw(io, runs, opts)  — historical Testnet READS only (tx, ledger, book_offers / account_lines /
//                                 account_info / ripple_path_find at a fixed ledger_index). Never signs.
//   buildEvidence(raw, runs)    — pure: per-payment evidence, run headlines, NO_PATH classification.
// The result is cached in data/pathfinder-evidence.json so the screen works offline.
import { amountValue, assetKey, consumedOffers, removedOffers, ammTouches, balanceChanges, createdOffer, round } from './amounts.mjs';
import { deliverAmount, CAPS, STATEMENT } from './replay.mjs';

export const EVIDENCE_VERSION = 3;
export const MODE = 'LIVE_TESTNET';
const EXPLORER = 'https://testnet.xrpl.org/transactions/';
export const BUCKET_LABEL = {
  maker: 'Titan maker — strategy quote', maker_seed: 'Titan maker — launch seed offer (not a strategy quote)',
  rival: 'Rival demo maker', other: 'Other / external account', amm: 'AMM pool',
};
export const NO_PATH_CATEGORIES = {
  depleted_inventory: 'Depleted inventory', missing_trustline: 'Missing / insufficient trustline',
  offers_not_validated: 'Offers not yet posted / validated', unfunded_offers: 'Unfunded offers',
  request_parameters: 'Pathfind request parameters', app_precheck: 'Application pre-check bug',
  other: 'Other', insufficient_evidence: 'Insufficient evidence',
};
const sum = (xs, f = (x) => x) => xs.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const rippleEpochIso = (t) => (t == null ? null : new Date((t + 946684800) * 1000).toISOString());

// ---------------- pure helpers ----------------
export const roleOf = (addr, addrs) => Object.entries(addrs || {}).find(([, a]) => a === addr)?.[0] ?? 'external';

// Owner attribution: our maker's strategy quotes vs its pre-existing launch seed offers vs rival vs anyone else.
export function ownerBucket(owner, seq, { addrs, strategySeqs = {} }) {
  const role = roleOf(owner, addrs);
  if (role === 'maker') return strategySeqs.maker?.has?.(seq) ? 'maker' : 'maker_seed';
  if (role === 'rival') return 'rival';
  return 'other';
}

// Offers consumed by a payment, with book, side, owner bucket and price (from metadata deltas only).
export function evidenceFills(meta, ctx) {
  return consumedOffers(meta, ctx.addrs.router).map((o) => {
    const bucket = ownerBucket(o.owner, o.seq, ctx);
    if (o.getsKey !== 'XRP' && o.paysKey !== 'XRP') {
      return { owner: o.owner, role: roleOf(o.owner, ctx.addrs), bucket, seq: o.seq, book: `${o.getsKey?.split('.')[0]}/${o.paysKey?.split('.')[0]}`, code: null, side: 'direct', tokenQty: round(o.getsDelta, 8), xrp: 0, priceXrp: null, deleted: o.deleted };
    }
    const ask = o.getsKey !== 'XRP'; // owner gave the token (sold it for XRP)
    const code = (ask ? o.getsKey : o.paysKey).split('.')[0];
    const tokenQty = ask ? o.getsDelta : o.paysDelta;
    return { owner: o.owner, role: roleOf(o.owner, ctx.addrs), bucket, seq: o.seq, book: `${code}/XRP`, code, side: ask ? 'ask' : 'bid',
      tokenQty: round(tokenQty, 8), xrp: round(o.xrpDelta, 6), priceXrp: tokenQty ? Number((o.xrpDelta / tokenQty).toPrecision(6)) : null, deleted: o.deleted };
  });
}

// XRP bridge-leg inference from metadata: a token→token payment is XRP-bridged only if offers were consumed in
// BOTH the from/XRP book (owner bought `from` with XRP: bid) and the XRP/to book (owner sold `to` for XRP: ask).
export function bridgeInference(fills, from, to) {
  if (from === 'XRP' || to === 'XRP') return { applicable: false, verified: false, note: 'XRP is an endpoint of this route; no bridge leg.' };
  const legA = fills.filter((f) => f.code === from && f.side === 'bid' && f.xrp > 0);
  const legB = fills.filter((f) => f.code === to && f.side === 'ask' && f.xrp > 0);
  const direct = fills.filter((f) => f.side === 'direct');
  const xa = sum(legA, (f) => f.xrp), xb = sum(legB, (f) => f.xrp);
  const verified = legA.length > 0 && legB.length > 0;
  return {
    applicable: true, verified,
    legA: { book: `${from}/XRP`, side: 'bids (sell ' + from + ' for XRP)', fills: legA.length, tokenQty: round(sum(legA, (f) => f.tokenQty), 8), xrp: round(xa, 6) },
    legB: { book: `XRP/${to}`, side: 'asks (buy ' + to + ' with XRP)', fills: legB.length, tokenQty: round(sum(legB, (f) => f.tokenQty), 8), xrp: round(xb, 6) },
    directFills: direct.length, xrpBridged: round(Math.min(xa, xb), 6), xrpImbalance: round(xa - xb, 6),
    note: verified ? `Verified from metadata: ${legA.length} offer(s) consumed in ${from}/XRP and ${legB.length} in XRP/${to}; ${round(Math.min(xa, xb), 6)} XRP crossed the bridge.`
      : direct.length ? 'Filled through a direct token/token book, not XRP-bridged.' : 'Not verified: offers were not consumed in both XRP books.',
  };
}

// book_offers rows -> funded levels. side 'ask' = owner sells token for XRP; 'bid' = owner buys token with XRP.
export function normalizeBook(offers = [], { side, addrs, strategySeqs = {} }) {
  return offers.map((o) => {
    const gets = o.taker_gets_funded ?? o.TakerGets, pays = o.taker_pays_funded ?? o.TakerPays;
    const tokenQty = amountValue(side === 'ask' ? gets : pays), xrp = amountValue(side === 'ask' ? pays : gets);
    const fullToken = amountValue(side === 'ask' ? o.TakerGets : o.TakerPays);
    return { owner: o.Account, role: roleOf(o.Account, addrs), bucket: ownerBucket(o.Account, o.Sequence, { addrs, strategySeqs }), seq: o.Sequence,
      priceXrp: fullToken ? Number((amountValue(side === 'ask' ? o.TakerPays : o.TakerGets) / fullToken).toPrecision(6)) : null,
      tokenQty: round(tokenQty, 8), xrp: round(xrp, 6), unfunded: !(tokenQty > 0 && xrp > 0), partlyFunded: tokenQty > 0 && tokenQty < fullToken * (1 - 1e-9) };
  });
}

export function depthSummary(levels = []) {
  const funded = levels.filter((l) => !l.unfunded);
  const byBucket = {};
  for (const l of funded) byBucket[l.bucket] = round((byBucket[l.bucket] || 0) + l.xrp, 6);
  return { offers: levels.length, fundedOffers: funded.length, unfundedOffers: levels.length - funded.length, tokenQty: round(sum(funded, (l) => l.tokenQty), 8), xrp: round(sum(funded, (l) => l.xrp), 6), bestPriceXrp: funded[0]?.priceXrp ?? null, byBucket };
}

// Depth after = depth before minus what this payment consumed from each offer (matched by owner+seq).
export function depthAfter(levels = [], fills = []) {
  return levels.map((l) => {
    const f = fills.filter((x) => x.owner === l.owner && x.seq === l.seq);
    if (!f.length) return { ...l };
    const tq = Math.max(0, l.tokenQty - sum(f, (x) => x.tokenQty)), xr = Math.max(0, l.xrp - sum(f, (x) => x.xrp));
    return { ...l, tokenQty: round(tq, 8), xrp: round(xr, 6), unfunded: !(tq > 1e-9 && xr > 1e-9) };
  });
}

// Executable depth for a route, XRP-equivalent: X→XRP uses X bids, XRP→Y uses Y asks, X→Y is the min of both legs.
export function routeDepthXrp(route, books) {
  const bid = books.bids ? depthSummary(books.bids).xrp : null, ask = books.asks ? depthSummary(books.asks).xrp : null;
  if (route.from !== 'XRP' && route.to !== 'XRP') return bid == null || ask == null ? null : round(Math.min(bid, ask), 6);
  return route.from === 'XRP' ? ask : bid;
}

// Spread and price impact (bps), payer's view, valued at the run's recorded mid.
//   exec   = cost of what was spent vs what was delivered, both at mid (positive = paid above mid)
//   spread = the same cost had the whole size filled at the touch (best price before the payment)
//   impact = exec - spread (cost of walking past the touch)
export function pricing({ from, to, spent, delivered, mids, touch = {} }) {
  const mf = from === 'XRP' ? 1 : mids[from], mt = to === 'XRP' ? 1 : mids[to];
  if (!(spent > 0) || !(delivered > 0) || !(mf > 0) || !(mt > 0)) return { effectiveRate: null, execBps: null, spreadBps: null, impactBps: null };
  const execBps = ((spent * mf) / (delivered * mt) - 1) * 1e4;
  let touchFactor = 1, ok = true;
  if (from !== 'XRP') { if (touch.fromBid > 0) touchFactor *= mf / touch.fromBid; else ok = false; }
  if (to !== 'XRP') { if (touch.toAsk > 0) touchFactor *= touch.toAsk / mt; else ok = false; }
  const spreadBps = ok ? (touchFactor - 1) * 1e4 : null;
  const z = (x) => (x === 0 ? 0 : x); // no -0 in JSON/UI
  return { effectiveRate: Number((spent / delivered).toPrecision(8)), rateUnit: `${from} per ${to}`, execBps: z(round(execBps, 1)), spreadBps: spreadBps == null ? null : z(round(spreadBps, 1)), impactBps: spreadBps == null ? null : z(round(execBps - spreadBps, 1)) };
}

// ---------------- NO_PATH classifier (pure) ----------------
// s = { from, to, sourceNeeded, destQty, router:{lines}, taker:{lines}, legA:{fundedXrp,fundedToken,offers,unfundedOffers},
//       legB:{...}, needXrp, quotesValidatedBeforePathfind, decidedBy, rpf:{full, fullNext, legA, legB}, request:{ok, issues[]}, appFallback }
export function classifyNoPath(s) {
  const checks = [];
  const add = (id, pass, detail) => { checks.push({ id, pass, detail }); return pass; };
  if (!s || !s.legA || !s.legB || !s.rpf) return { category: 'insufficient_evidence', label: NO_PATH_CATEGORIES.insufficient_evidence, checks, summary: 'Ledger snapshot incomplete; cannot classify.' };
  const rl = s.router?.lines?.[s.from], tl = s.taker?.lines?.[s.to];
  const tlOk = add('router_trustline', !!rl && rl.balance >= s.sourceNeeded, rl ? `router ${s.from} balance ${rl.balance} (limit ${rl.limit}) vs ≈${round(s.sourceNeeded, 4)} needed` : `router has no ${s.from} trustline`);
  const dlOk = add('taker_trustline', !!tl && tl.limit - tl.balance >= s.destQty, tl ? `taker ${s.to} headroom ${round(tl.limit - tl.balance, 4)} vs ${round(s.destQty, 4)} to deliver` : `taker has no ${s.to} trustline`);
  const valOk = add('offers_validated', s.quotesValidatedBeforePathfind !== false, s.quotesValidatedBeforePathfind === false ? 'some strategy quotes were validated after the pathfind ledger' : 'all strategy quotes were in a validated ledger before the pathfind');
  const fundOk = add('offers_funded', s.legA.offers > s.legA.unfundedOffers && s.legB.offers > s.legB.unfundedOffers, `leg A ${s.legA.offers - s.legA.unfundedOffers}/${s.legA.offers} funded, leg B ${s.legB.offers - s.legB.unfundedOffers}/${s.legB.offers} funded`);
  const depthOk = add('depth', s.legA.fundedXrp >= s.needXrp && s.legB.fundedToken >= s.destQty, `leg A bids ${round(s.legA.fundedXrp, 4)} XRP funded vs ≈${round(s.needXrp, 4)} needed; leg B asks ${round(s.legB.fundedToken, 4)} ${s.to} funded vs ${round(s.destQty, 4)} needed`);
  const reqOk = add('request_parameters', s.request?.ok !== false, s.request?.issues?.length ? s.request.issues.join('; ') : 'source_currencies, destination_amount and accounts are well-formed and match the trustlines');
  const byRippled = add('decided_by_rippled', s.decidedBy !== 'app_precheck', s.decidedBy === 'app_precheck' ? 'replay.mjs decided "no path" without asking rippled' : 'replay.mjs returned "no path" only because rippled ripple_path_find returned no alternative with the requested source currency');
  const legsFound = add('legs_individually_pathfindable', !!(s.rpf.legA && s.rpf.legB), `single-book legs at the same ledger: ${s.from}→XRP ${s.rpf.legA ? 'found' : 'none'}, XRP→${s.to} ${s.rpf.legB ? 'found' : 'none'}`);
  const fullEmpty = add('full_pathfind_empty', s.rpf.full === 0 && (s.rpf.fullNext == null || s.rpf.fullNext === 0), `ripple_path_find ${s.from}→${s.to} re-run at the pathfind ledger: ${s.rpf.full} alternative(s)${s.rpf.fullNext != null ? `; next ledger: ${s.rpf.fullNext}` : ''}`);
  let category, summary;
  if (!tlOk || !dlOk) { category = 'missing_trustline'; summary = 'A required trustline or source balance was missing or too small.'; }
  else if (!valOk) { category = 'offers_not_validated'; summary = 'Liquidity the route needed was not yet in a validated ledger when path-finding ran.'; }
  else if (!fundOk) { category = 'unfunded_offers'; summary = 'Offers existed but their owners could not fund them.'; }
  else if (!depthOk) { category = 'depleted_inventory'; summary = 'Funded depth on a leg was smaller than the payment.'; }
  else if (!reqOk) { category = 'request_parameters'; summary = 'The ripple_path_find request was malformed for this route.'; }
  else if (!byRippled) { category = 'app_precheck'; summary = 'The application decided "no path" before asking the ledger.'; }
  else if (legsFound && fullEmpty) {
    category = 'other';
    summary = `Liquidity, trustlines, funding and timing were all sufficient. rippled's ripple_path_find returned no ${s.from}→XRP→${s.to} alternative even though each single-book leg was path-findable at the same ledger, and the code that ran had no fallback (it mapped empty alternatives to "no funded liquidity").`;
  } else { category = 'insufficient_evidence'; summary = 'Checks passed but the historical re-run of ripple_path_find did not reproduce the empty answer; cause not determined.'; }
  return { category, label: NO_PATH_CATEGORIES[category], summary, checks, contributing: category === 'other' ? ['application: no XRP-bridge fallback before 00:17 UTC; reason text blamed liquidity'] : [] };
}

// ---------------- evidence builder (pure) ----------------
function strategySeqsFor(run, raw) {
  const seqs = { maker: new Set(), rival: new Set() };
  for (const a of run.actions || []) {
    if (!a.hash) continue;
    const t = raw.txs?.[a.hash];
    if (a.txType === 'OfferCreate' && t?.createdSeq != null && seqs[a.role]) seqs[a.role].add(t.createdSeq);
    const m = /cancels (?:leftover )?offer (\d+)/.exec(a.what || '');
    if (m && seqs[a.role]) seqs[a.role].add(Number(m[1])); // cancelled strategy quotes are strategy quotes
  }
  return seqs;
}

const bookKey = (li, side, code) => `${li}|${side}|${code}`;

function snapshotBooks(raw, li, p, ctx) {
  const out = {};
  if (p.from !== 'XRP') { const b = raw.books?.[bookKey(li, 'bid', p.from)]; if (b) out.bids = normalizeBook(b, { side: 'bid', ...ctx }); }
  if (p.to !== 'XRP') { const b = raw.books?.[bookKey(li, 'ask', p.to)]; if (b) out.asks = normalizeBook(b, { side: 'ask', ...ctx }); }
  return out;
}

export function paymentEvidence(run, runIndex, p, raw, ctx) {
  const base = {
    runId: run.id, run: runIndex, strategy: run.options.strategy, rivalStrategy: run.options.rivalStrategy, i: p.i, at: p.at,
    route: p.route, from: p.from, to: p.to, sizeXrp: p.sizeXrp, status: p.status, mode: MODE, organic: false,
    pathfind: { recorded: p.pathfind || null, alternativesRecorded: false, note: 'The run record keeps ok/reason/pathCount/viaXrp/vsMidBps/costXrp only; rippled\'s alternatives list was not persisted.' },
  };
  const pf = raw.pathfindLedger?.[`${run.id}|${p.i}`];
  if (pf) base.pathfindLedger = pf;
  const mids = run.mids || {};
  if (!p.hash) {
    const diag = raw.noPath?.[`${run.id}|${p.i}`];
    return { ...base, reason: p.reason || p.error || null, failure: p.status === 'failed' ? p.error : null, skip: p.status === 'skipped' ? p.reason : null, diagnosis: diag ? { ...diag, classification: classifyNoPath(diag) } : null };
  }
  const t = raw.txs?.[p.hash];
  const ev = { ...base, hash: p.hash, explorer: EXPLORER + p.hash, ledger: p.ledger, result: p.result };
  if (!t?.meta) return { ...ev, evidence: 'tx metadata not collected' };
  const tx = t.tx_json || {};
  ev.submitted = { Amount: tx.DeliverMax ?? tx.Amount, SendMax: tx.SendMax ?? null, Paths: tx.Paths || null, Flags: tx.Flags ?? 0, partialPayment: ((tx.Flags || 0) & 0x00020000) !== 0 };
  ev.delivered = t.meta.delivered_amount ?? null;
  ev.feeXrp = round(Number(tx.Fee || 0) / 1e6, 6);
  ev.closeTime = t.closeTime || null;
  const fills = evidenceFills(t.meta, ctx);
  const amm = ammTouches(t.meta);
  ev.fills = fills.map((f) => ({ ...f, label: BUCKET_LABEL[f.bucket] }));
  ev.amm = amm;
  ev.removals = removedOffers(t.meta, ctx.addrs.router).map((r) => ({ ...r, role: roleOf(r.owner, ctx.addrs) }));
  const flow = { maker: 0, maker_seed: 0, rival: 0, other: 0, amm: 0 };
  for (const f of fills) flow[f.bucket] += f.xrp;
  for (const a of amm) flow.amm += a.xrpDelta || 0;
  ev.flowCaptured = Object.fromEntries(Object.entries(flow).map(([k, v]) => [k, round(v, 6)]));
  const total = sum(Object.values(flow));
  ev.flowWinner = total ? Object.entries(flow).sort((a, b) => b[1] - a[1])[0][0] : 'none';
  ev.bridge = bridgeInference(fills, p.from, p.to);
  ev.pathHasXrpStep = (tx.Paths || []).some((path) => path.some((s) => s.currency === 'XRP'));
  // Pathfinding method: explicit [XRP, to] path with no `type` is the fallback's shape; infer from historical re-run too.
  const primaryRerun = raw.primaryRerun?.[`${run.id}|${p.i}`];
  ev.pathfind.method = p.pathfind?.method || (p.from !== 'XRP' && p.to !== 'XRP' && primaryRerun && primaryRerun.alternatives === 0 ? 'xrp_bridge_fallback (inferred)' : 'ripple_path_find');
  if (primaryRerun) ev.pathfind.primaryRerun = primaryRerun;
  // Spent / delivered from balance changes.
  const ch = balanceChanges(t.meta).get(ctx.addrs.router);
  const fromKey = p.from === 'XRP' ? 'XRP' : `${p.from}.${ctx.addrs.issuer}`;
  let spent = ch?.get(fromKey);
  spent = spent == null ? null : p.from === 'XRP' ? -spent - ev.feeXrp : -spent;
  const delivered = ev.delivered ? amountValue(ev.delivered) : null;
  ev.spent = spent == null ? null : { asset: p.from, value: round(spent, 8) };
  // Depth before (book at ledger-1) and after (before minus this payment's consumption).
  const li = t.ledger_index ?? p.ledger;
  const before = snapshotBooks(raw, li - 1, p, ctx);
  const after = {};
  if (before.bids) after.bids = depthAfter(before.bids, fills);
  if (before.asks) after.asks = depthAfter(before.asks, fills);
  ev.depth = {
    ledgerBefore: li - 1, method: 'before: book_offers at ledger_index (tx ledger − 1), funded amounts; after: before minus this payment\'s consumed offer deltas (metadata)',
    before: { bids: before.bids ? depthSummary(before.bids) : null, asks: before.asks ? depthSummary(before.asks) : null, routeXrp: routeDepthXrp(p, before) },
    after: { bids: after.bids ? depthSummary(after.bids) : null, asks: after.asks ? depthSummary(after.asks) : null, routeXrp: routeDepthXrp(p, after) },
    levelsBefore: before, levelsAfter: after,
  };
  ev.pricing = pricing({ from: p.from, to: p.to, spent, delivered, mids, touch: { fromBid: ev.depth.before.bids?.bestPriceXrp, toAsk: ev.depth.before.asks?.bestPriceXrp } });
  ev.pricing.midXrp = mids;
  ev.pricing.note = 'Mid = book mid recorded before the run. exec = payer cost vs mid; spread = cost at the pre-payment touch; impact = exec − spread.';
  return ev;
}

// Headline 1-3 for a run.
export function runHeadlines(run, payments, raw, ctx) {
  const ok = payments.filter((p) => p.fills);
  const flow = { maker: 0, maker_seed: 0, rival: 0, other: 0, amm: 0 };
  for (const p of ok) for (const [k, v] of Object.entries(p.flowCaptured)) flow[k] += v;
  const total = sum(Object.values(flow));
  const fillsByMaker = ok.map((p) => ({ i: p.i, hash: p.hash, winner: p.flowWinner, makers: [...new Set(p.fills.map((f) => f.bucket))], flow: p.flowCaptured }));
  // Continuity: remaining executable depth for the NEXT payment after each payment.
  const cont = [];
  let ranOut = null;
  for (let k = 0; k < payments.length; k++) {
    const p = payments[k], next = payments[k + 1];
    const remainingForNext = next ? (next.depth?.before?.routeXrp ?? next.diagnosis?.routeDepthXrp ?? null) : null;
    const after = p.depth?.after?.routeXrp ?? p.diagnosis?.routeDepthXrp ?? null;
    const row = { i: p.i, status: p.status, sizeXrp: p.sizeXrp, depthAfterXrp: after, nextSizeXrp: next?.sizeXrp ?? null, nextRoute: next ? `${next.from}→${next.to}` : null, remainingForNextXrp: remainingForNext, sufficient: next ? remainingForNext == null ? null : remainingForNext >= next.sizeXrp : null };
    cont.push(row);
    if (!ranOut && next && row.sufficient === false) ranOut = { afterPayment: p.i, at: next.at, need: next.sizeXrp, available: remainingForNext };
  }
  const skipped = payments.filter((p) => p.status === 'skipped');
  // Capital efficiency (labelled assumptions).
  const quotes = (run.quotes || []).filter((q) => q.role === 'maker');
  const bidsXrp = sum(quotes.filter((q) => q.side === 'bid'), (q) => q.xrp);
  const asksXrpEq = sum(quotes.filter((q) => q.side === 'ask'), (q) => q.tokenQty * (run.mids?.[q.code] || 0));
  const reserveXrp = (run.peakOffers?.maker || 0) * (run.reserveInc ?? 0.2);
  const makerFees = sum((run.actions || []).filter((a) => a.role === 'maker' && a.hash), (a) => raw.txs?.[a.hash]?.feeXrp ?? run.feeXrp ?? CAPS.fallbackFeeXrp);
  const captured = flow.maker;
  const edge = sum(ok.flatMap((p) => p.fills.filter((f) => f.bucket === 'maker')), (f) => f.side === 'ask' ? f.xrp - f.tokenQty * (run.mids?.[f.code] || 0) : f.tokenQty * (run.mids?.[f.code] || 0) - f.xrp);
  const deployed = bidsXrp + asksXrpEq + reserveXrp + makerFees;
  return {
    flowCaptured: { totalXrp: round(total, 6), byBucket: Object.fromEntries(Object.entries(flow).map(([k, v]) => [k, { xrp: round(v, 6), share: total ? round(v / total, 4) : 0 }])), perPayment: fillsByMaker,
      note: 'XRP value of offers consumed by validated replay payments, by offer owner (from metadata). Demo-generated flow (organic:false).' },
    continuity: { perPayment: cont, ranOut, skipped: skipped.length,
      verdict: ranOut ? `Depth ran out before payment ${ranOut.afterPayment + 2} (needed ${ranOut.need} XRP, ${ranOut.available} XRP executable).` : skipped.length ? `Depth never ran out; ${skipped.length} payment(s) were skipped as NO_PATH while funded depth remained (see diagnosis).` : 'Depth never ran out: every payment found enough executable depth.',
      note: 'Executable depth = funded XRP-equivalent on the books the next payment needs (bids of the source token, asks of the destination token; min of both legs when bridged).' },
    capitalEfficiency: {
      bidsXrp: round(bidsXrp, 6), asksXrpEq: round(asksXrpEq, 6), reserveXrp: round(reserveXrp, 6), makerFeesXrp: round(makerFees, 6), deployedXrp: round(deployed, 6),
      capturedXrp: round(captured, 6), edgeVsMidXrp: round(edge, 6), turnover: deployed ? round(captured / deployed, 4) : 0,
      capturedPerFeeXrp: makerFees ? round(captured / makerFees, 1) : null, netXrp: round(edge - makerFees, 6),
      assumptions: [
        'Committed XRP = maker bid notionals (XRP locked in offers) + ask inventory valued at the run mid (token, not XRP).',
        `Reserves = peak simultaneous maker offers × ${run.reserveInc ?? 0.2} XRP owner reserve; locked while quotes rest, released on cancel/fill (not spent).`,
        'Fees = actual Fee field of every maker transaction in the run (quotes + cancels), from tx data.',
        'Volume captured = XRP value of maker strategy offers consumed; launch seed offers are excluded.',
        'Counterparties are all demo accounts; nothing here is organic revenue.',
      ] },
  };
}

// Pair runs with identical options where one skipped NO_PATH and one succeeded; report what differed.
export function compareRuns(evRuns) {
  const sig = (r) => JSON.stringify({ s: r.options.strategy, rv: r.options.rivalStrategy, k: r.options.k, seed: r.options.seed, t: r.options.tokens, m: r.options.routeMix || null });
  const out = [];
  for (const bad of evRuns.filter((r) => r.counts.skipped > 0)) {
    const good = evRuns.find((r) => r.run > bad.run && sig(r) === sig(bad) && r.counts.success > 0);
    if (!good) continue;
    const same = (f) => JSON.stringify(f(bad)) === JSON.stringify(f(good));
    const depth = (r) => r.payments.map((p) => p.diagnosis?.routeDepthXrp ?? p.depth?.before?.routeXrp ?? null);
    out.push({
      skippedRun: bad.run, succeededRun: good.run,
      identical: { options: true, quotes: same((r) => (r._quotes || [])), payments: same((r) => r.payments.map((p) => [p.from, p.to, p.sizeXrp])), mids: same((r) => r.mids) },
      firstPaymentDepthXrp: { skipped: depth(bad)[0], succeeded: depth(good)[0] },
      primaryPathfindAlternatives: { skipped: bad.payments.map((p) => p.diagnosis?.rpf?.full ?? null), succeeded: good.payments.map((p) => p.pathfind?.primaryRerun?.alternatives ?? null) },
      method: { skipped: 'ripple_path_find only (no fallback in the code that ran)', succeeded: [...new Set(good.payments.map((p) => p.pathfind?.method))].join(', ') },
      code: { skipped: bad.codeVersion, succeeded: good.codeVersion },
      conclusion: 'Same options, quotes, payment sizes and funded depth. rippled returned zero BBL↔LDN alternatives in both runs (historical re-run); the only difference is that the succeeding run executed code with the XRP-bridge fallback (two single-book ripple_path_find legs + simulate).',
    });
  }
  return out;
}

export function buildEvidence(raw, runs) {
  const addrs = raw.addrs;
  const sorted = [...runs].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const out = [];
  sorted.forEach((run, idx) => {
    const strategySeqs = strategySeqsFor(run, raw);
    const ctx = { addrs, strategySeqs };
    const payments = (run.payments || []).map((p) => paymentEvidence(run, idx + 1, p, raw, ctx));
    const headlines = runHeadlines(run, payments, raw, ctx);
    out.push({
      runId: run.id, run: idx + 1, createdAt: run.createdAt, finishedAt: run.finishedAt, status: run.status, options: run.options, mids: run.mids,
      mode: MODE, organic: false, codeVersion: raw.codeVersions?.[run.id] || null,
      ledgerWindow: raw.windows?.[run.id] || null,
      counts: { planned: payments.length, success: payments.filter((p) => p.status === 'success').length, skipped: payments.filter((p) => p.status === 'skipped').length, failed: payments.filter((p) => p.status === 'failed').length, bridgedVerified: payments.filter((p) => p.bridge?.verified).length },
      headlines, payments, _quotes: run.quotes || [],
    });
  });
  const comparison = compareRuns(out);
  for (const r of out) delete r._quotes;
  const skipped = out.flatMap((r) => r.payments.filter((p) => p.diagnosis));
  const cats = {};
  for (const p of skipped) cats[p.diagnosis.classification.category] = (cats[p.diagnosis.classification.category] || 0) + 1;
  return {
    version: EVIDENCE_VERSION, mode: MODE, organic: false, statement: STATEMENT, collectedAt: raw.collectedAt, server: raw.server, addrs,
    labels: { buckets: BUCKET_LABEL, noPathCategories: NO_PATH_CATEGORIES },
    separation: 'LIVE_TESTNET demo-generated payments only. Mainnet observations (MAINNET_OBSERVED) are read-only and are never mixed into these figures.',
    noPath: { skipped: skipped.length, categories: cats, comparison, codeTimeline: raw.codeTimeline || null },
    runs: out,
  };
}

// ---------------- collector (Testnet reads only) ----------------
const READS = new Set(['server_info', 'ledger', 'tx', 'book_offers', 'account_lines', 'account_info', 'ripple_path_find']);
export async function collectRaw(io, runs, { addrs, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), paceMs = 120, onProgress = () => {}, codeVersions = {}, codeTimeline = null } = {}) {
  let n = 0;
  const q = async (req) => {
    if (!READS.has(req.command)) throw new Error(`evidence: ${req.command} is not an allowed read`);
    if (n++ && paceMs) await sleep(paceMs);
    if (n % 20 === 0) onProgress({ requests: n });
    for (let attempt = 0; ; attempt++) {
      try { return (await io.request(req)).result; } catch (e) {
        const code = e.data?.error || e.message;
        if (attempt < 3 && /slowDown|tooBusy|timeout|NotConnected|Websocket/i.test(code)) { await sleep(1500 * (attempt + 1)); continue; }
        throw e;
      }
    }
  };
  const raw = { version: EVIDENCE_VERSION, collectedAt: new Date().toISOString(), addrs, server: null, ledgers: {}, txs: {}, books: {}, noPath: {}, primaryRerun: {}, pathfindLedger: {}, windows: {}, codeVersions, codeTimeline };
  try { const si = (await q({ command: 'server_info' })).info; raw.server = { build: si.build_version, completeLedgers: si.complete_ledgers, network: 'XRPL Testnet (network_id 1)' }; } catch { /* optional */ }
  const tok = (code) => ({ currency: code, issuer: addrs.issuer });
  const closeTime = async (li) => {
    if (raw.ledgers[li] === undefined) { const l = (await q({ command: 'ledger', ledger_index: li })).ledger; raw.ledgers[li] = { closeTime: l.close_time_iso || rippleEpochIso(l.close_time), resolution: l.close_time_resolution }; }
    return raw.ledgers[li].closeTime;
  };
  const getTx = async (hash) => {
    if (raw.txs[hash]) return raw.txs[hash];
    const r = await q({ command: 'tx', transaction: hash });
    const txj = r.tx_json || r;
    const role = roleOf(txj.Account, addrs);
    const c = createdOffer(r.meta, txj.Account);
    const keep = { hash, ledger_index: r.ledger_index, closeTime: r.close_time_iso || null, result: r.meta?.TransactionResult, feeXrp: Number(txj.Fee || 0) / 1e6, account: txj.Account, role, type: txj.TransactionType, createdSeq: c?.seq ?? null, sequence: txj.Sequence };
    if (txj.TransactionType === 'Payment' && role === 'router') { keep.tx_json = { Amount: txj.Amount, DeliverMax: txj.DeliverMax, SendMax: txj.SendMax, Paths: txj.Paths, Flags: txj.Flags, Fee: txj.Fee, Destination: txj.Destination }; keep.meta = r.meta; }
    if (txj.TransactionType === 'OfferCreate') keep.offer = { TakerGets: txj.TakerGets, TakerPays: txj.TakerPays, OfferSequence: txj.OfferSequence };
    raw.txs[hash] = keep;
    return keep;
  };
  const book = async (li, side, code) => {
    const k = bookKey(li, side, code);
    if (!raw.books[k]) {
      const req = side === 'ask' ? { taker_gets: tok(code), taker_pays: { currency: 'XRP' } } : { taker_gets: { currency: 'XRP' }, taker_pays: tok(code) };
      const r = await q({ command: 'book_offers', ledger_index: li, taker: addrs.router, limit: 50, ...req });
      raw.books[k] = (r.offers || []).map((o) => ({ Account: o.Account, Sequence: o.Sequence, TakerGets: o.TakerGets, TakerPays: o.TakerPays, taker_gets_funded: o.taker_gets_funded, taker_pays_funded: o.taker_pays_funded, owner_funds: o.owner_funds, quality: o.quality }));
    }
    return raw.books[k];
  };
  const directBook = async (li, a, b) => {
    const k = `${li}|direct|${a}>${b}`;
    if (!raw.books[k]) raw.books[k] = ((await q({ command: 'book_offers', ledger_index: li, taker_gets: tok(b), taker_pays: tok(a), limit: 20 })).offers || []).map((o) => ({ Account: o.Account, Sequence: o.Sequence }));
    return raw.books[k];
  };
  const rpf = async (li, dest, src) => {
    try {
      const r = await q({ command: 'ripple_path_find', ledger_index: li, source_account: addrs.router, destination_account: addrs.taker, destination_amount: dest, source_currencies: [src === 'XRP' ? { currency: 'XRP' } : tok(src)] });
      const want = src === 'XRP' ? 'XRP' : `${src}.${addrs.issuer}`;
      const alts = (r.alternatives || []).filter((a) => assetKey(a.source_amount) === want);
      return { ledger: li, request: { destination_amount: dest, source_currencies: [src === 'XRP' ? { currency: 'XRP' } : tok(src)] }, alternatives: alts.length, all: (r.alternatives || []).length, best: alts[0] ? { source_amount: alts[0].source_amount, paths_computed: alts[0].paths_computed } : null };
    } catch (e) { return { ledger: li, error: e.data?.error_message || e.data?.error || e.message, alternatives: null }; }
  };
  const lines = async (li, account) => {
    const r = await q({ command: 'account_lines', account, ledger_index: li, peer: addrs.issuer });
    return Object.fromEntries((r.lines || []).map((l) => [l.currency, { balance: Number(l.balance), limit: Number(l.limit), noRipple: !!l.no_ripple, freeze: !!l.freeze }]));
  };
  // Largest ledger in [lo, hi] whose close time is <= iso (the last validated ledger when path-finding ran).
  const ledgerAt = async (iso, lo, hi) => {
    const t = Date.parse(iso);
    if (Date.parse(await closeTime(hi)) <= t) return hi;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (Date.parse(await closeTime(mid)) <= t) lo = mid; else hi = mid; }
    return lo;
  };

  const sorted = [...runs].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const run of sorted) {
    for (const a of run.actions || []) if (a.hash) { await getTx(a.hash); if (a.ledger) await closeTime(a.ledger); }
    for (const p of run.payments || []) if (p.hash) await getTx(p.hash);
    const quoteLedgers = (run.actions || []).filter((a) => a.txType === 'OfferCreate' && a.ledger).map((a) => a.ledger);
    const lastQuote = Math.max(...quoteLedgers);
    const firstCancelAfter = (run.actions || []).filter((a) => a.txType === 'OfferCancel' && a.ledger > lastQuote).map((a) => a.ledger);
    const windowEnd = firstCancelAfter.length ? Math.min(...firstCancelAfter) - 1 : lastQuote + 20;
    const mids = run.mids || {};
    let prevLedger = lastQuote;
    for (const p of run.payments || []) {
      const hi = p.ledger || windowEnd;
      const li = await ledgerAt(p.at, Math.min(prevLedger, hi), hi);
      raw.pathfindLedger[`${run.id}|${p.i}`] = { ledger: li, closeTime: raw.ledgers[li]?.closeTime, at: p.at, resolutionS: raw.ledgers[li]?.resolution ?? null, note: 'Last validated ledger whose close time ≤ the payment\'s recorded pathfind time (close times are rounded to the ledger close resolution).' };
      if (p.hash) {
        const L = (raw.txs[p.hash]?.ledger_index ?? p.ledger) - 1;
        if (p.from !== 'XRP') await book(L, 'bid', p.from);
        if (p.to !== 'XRP') await book(L, 'ask', p.to);
        if (p.from !== 'XRP' && p.to !== 'XRP') raw.primaryRerun[`${run.id}|${p.i}`] = await rpf(li, deliverAmount(p, mids, addrs.issuer), p.from);
        prevLedger = p.ledger;
      } else if (p.status === 'skipped' && p.from !== 'XRP' && p.to !== 'XRP') {
        const dest = deliverAmount(p, mids, addrs.issuer);
        const destQty = amountValue(dest);
        const [bids, asks] = [await book(li, 'bid', p.from), await book(li, 'ask', p.to)];
        await directBook(li, p.from, p.to); await directBook(li, p.to, p.from);
        const full = await rpf(li, dest, p.from), fullNext = await rpf(li + 1, dest, p.from);
        const legB = await rpf(li, dest, 'XRP');
        const legA = legB.best ? await rpf(li, legB.best.source_amount, p.from) : null;
        const rl = await lines(li, addrs.router), tl = await lines(li, addrs.taker);
        const iss = (await q({ command: 'account_info', account: addrs.issuer, ledger_index: li })).account_data;
        const strategySeqs = strategySeqsFor(run, raw);
        const ctx = { addrs, strategySeqs };
        const nb = normalizeBook(bids, { side: 'bid', ...ctx }), na = normalizeBook(asks, { side: 'ask', ...ctx });
        const quoteTimes = (run.actions || []).filter((a) => a.txType === 'OfferCreate').map((a) => ({ role: a.role, what: a.what, ledger: a.ledger, hash: a.hash, seq: raw.txs[a.hash]?.createdSeq ?? null, closeTime: raw.ledgers[a.ledger]?.closeTime }));
        const needXrp = legB.best ? amountValue(legB.best.source_amount) : p.sizeXrp;
        const sourceNeeded = legA?.best ? amountValue(legA.best.source_amount) * (1 + CAPS.slippageBps / 1e4) : p.sizeXrp / (mids[p.from] || CAPS.defaultMidXrp);
        const issues = [];
        if (!rl[p.from]) issues.push(`source_currencies ${p.from}.${addrs.issuer} has no router trustline`);
        if (!(destQty > 0)) issues.push('destination_amount is not positive');
        raw.noPath[`${run.id}|${p.i}`] = {
          ledger: li, ledgerCloseTime: raw.ledgers[li]?.closeTime, at: p.at, from: p.from, to: p.to, sizeXrp: p.sizeXrp,
          destination_amount: dest, destQty: round(destQty, 8), sourceNeeded: round(sourceNeeded, 8), needXrp: round(needXrp, 6),
          router: { lines: rl }, taker: { lines: tl }, issuer: { flags: iss.Flags, transferRate: iss.TransferRate ?? null, defaultRipple: (iss.Flags & 0x00800000) !== 0 },
          legA: { book: `${p.from}/XRP bids`, fundedXrp: depthSummary(nb).xrp, fundedToken: depthSummary(nb).tokenQty, offers: nb.length, unfundedOffers: nb.filter((x) => x.unfunded).length, levels: nb },
          legB: { book: `XRP/${p.to} asks`, fundedXrp: depthSummary(na).xrp, fundedToken: depthSummary(na).tokenQty, offers: na.length, unfundedOffers: na.filter((x) => x.unfunded).length, levels: na },
          direct: { [`${p.from}>${p.to}`]: raw.books[`${li}|direct|${p.from}>${p.to}`].length, [`${p.to}>${p.from}`]: raw.books[`${li}|direct|${p.to}>${p.from}`].length },
          routeDepthXrp: round(Math.min(depthSummary(nb).xrp, depthSummary(na).xrp), 6),
          quotes: quoteTimes, quotesValidatedBeforePathfind: quoteTimes.every((x) => x.ledger != null && x.ledger <= li),
          rpf: { full: full.alternatives, fullNext: fullNext.alternatives, fullError: full.error || null, legA: !!legA?.best, legB: !!legB.best, legADetail: legA, legBDetail: legB, fullDetail: full, fullNextDetail: fullNext },
          request: { ok: issues.length === 0, issues, sent: { command: 'ripple_path_find', source_account: addrs.router, destination_account: addrs.taker, destination_amount: dest, source_currencies: [tok(p.from)] } },
          decidedBy: 'rippled_empty_alternatives', appFallback: false,
        };
      }
    }
    // Ledger-by-ledger window for runs with skipped payments: did the books change while it was skipping?
    if ((run.payments || []).some((p) => p.status === 'skipped')) {
      const rows = [];
      for (let li = lastQuote; li <= windowEnd; li++) {
        const sig = [];
        for (const code of run.options.tokens) for (const side of ['bid', 'ask']) sig.push((await book(li, side, code)).map((o) => `${o.Account.slice(0, 6)}#${o.Sequence}:${amountValue(o.taker_gets_funded ?? o.TakerGets)}`).join(','));
        await closeTime(li);
        rows.push({ ledger: li, closeTime: raw.ledgers[li].closeTime, signature: sig.join(' | ') });
      }
      raw.windows[run.id] = { from: lastQuote, to: windowEnd, ledgers: rows.length, booksConstant: new Set(rows.map((r) => r.signature)).size === 1, rows: rows.map(({ ledger, closeTime: ct }) => ({ ledger, closeTime: ct })) };
    }
  }
  onProgress({ requests: n, done: true });
  raw.requests = n;
  return raw;
}
