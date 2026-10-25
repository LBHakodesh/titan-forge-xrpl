// Corridor-continuity test plan (DESIGN ONLY). Computes the plan and its exact XRP budget from Testnet reads.
// Nothing here signs or submits: the dry run never touches io.submit, and every plan is { planned:true, approved:false }.
// Running it later needs a separate, explicit Commander approval and a runner change (not built).
import { RINGS } from '../../public/domain.js';
import { guardCheck as defaultGuard } from '../guardian.mjs';
import { amountValue, round } from './amounts.mjs';
import { CAPS } from './replay.mjs';

const ring = (id) => RINGS.find((r) => r.id === id).spreadBps;
export const LEVELS = [
  { level: 'L1', ring: 'VELOCITY', bps: ring('VELOCITY') },
  { level: 'L2', ring: 'BRIDGE', bps: ring('BRIDGE') },
  { level: 'L3', ring: 'EARN', bps: ring('EARN') },
];
export const RIVAL_BPS = ring('MONEY');
export const LEVEL_XRP = 1; // XRP notional per Titan level (small on purpose; sizes sweep several levels)

// Phase definitions. side 'ask' = sells the token for XRP; 'bid' = buys the token with XRP.
export function phases([A, B] = ['BBL', 'LDN']) {
  const ladder = (code, side, n = 3, xrp = LEVEL_XRP) => LEVELS.slice(0, n).map((l) => ({ role: 'maker', code, side, level: l.level, ring: l.ring, bps: l.bps, xrp }));
  return [
    { id: 'A', title: `Level sweep: XRP→${A}`, goal: `Progressively larger XRP→${A} payments walk Titan's ${A} ask ladder (L1 VELOCITY ±${LEVELS[0].bps} bps, L2 BRIDGE ±${LEVELS[1].bps}, L3 EARN ±${LEVELS[2].bps}, ${LEVEL_XRP} XRP each) into the static rival at ±${RIVAL_BPS} bps. Shows when VELOCITY depth is insufficient and where flow spills.`,
      quotes: [...ladder(A, 'ask'), { role: 'rival', code: A, side: 'ask', level: 'R', ring: 'MONEY', bps: RIVAL_BPS, xrp: 3 }],
      payments: [0.25, 0.5, 0.75, 1, 1.5].map((x) => ({ from: 'XRP', to: A, sizeXrp: x })), replenish: false },
    { id: 'B', title: `Titan vs rival pricing: XRP→${B}`, goal: `The rival quotes inside Titan's VELOCITY level (+4 bps, 0.5 XRP). Measures how much flow Titan loses at the touch and wins back once the rival's size is exhausted.`,
      quotes: [...ladder(B, 'ask'), { role: 'rival', code: B, side: 'ask', level: 'R', ring: 'inside', bps: 4, xrp: 0.5 }],
      payments: [0.25, 0.5, 1, 1.5].map((x) => ({ from: 'XRP', to: B, sizeXrp: x })), replenish: false },
    { id: 'C', title: `Bridged corridor: ${A}→XRP→${B}`, goal: `Token→token payments via the verified XRP-bridge path. Titan quotes two levels on both legs (${A} bids, ${B} asks); sizes grow until both legs spill to the rival.`,
      quotes: [...ladder(A, 'bid', 2), ...ladder(B, 'ask', 2), { role: 'rival', code: A, side: 'bid', level: 'R', ring: 'MONEY', bps: RIVAL_BPS, xrp: 3 }, { role: 'rival', code: B, side: 'ask', level: 'R', ring: 'MONEY', bps: RIVAL_BPS, xrp: 3 }],
      payments: [0.5, 1, 1.5, 2].map((x) => ({ from: A, to: B, sizeXrp: x })), replenish: false },
    { id: 'D', title: `Replenishment latency: XRP→${A}`, goal: `Titan keeps one VELOCITY ask (0.5 XRP) and re-posts it after every fill. Measures fill-ledger → replacement-validated latency (ledgers and seconds) and whether the next payment, ${CAPS.paceMs / 1000} s later, hits the replenished quote or the rival.`,
      quotes: [{ role: 'maker', code: A, side: 'ask', level: 'L1', ring: 'VELOCITY', bps: LEVELS[0].bps, xrp: 0.5 }, { role: 'rival', code: A, side: 'ask', level: 'R', ring: 'MONEY', bps: RIVAL_BPS, xrp: 3 }],
      payments: Array.from({ length: 6 }, () => ({ from: 'XRP', to: A, sizeXrp: 0.4 })), replenish: true },
  ];
}

// Pure book walk (prediction only): consume levels best-first for `xrp` notional. Returns fills and remaining levels.
export function walkLevels(levels, xrp) {
  const sorted = levels.map((l) => ({ ...l })).sort((a, b) => a.bps - b.bps);
  let left = xrp;
  const fills = [];
  for (const l of sorted) {
    if (left <= 1e-12) break;
    const take = Math.min(l.remaining, left);
    if (take > 0) { fills.push({ role: l.role, level: l.level, xrp: round(take, 6) }); l.remaining = round(l.remaining - take, 9); left -= take; }
  }
  return { fills, unfilledXrp: round(Math.max(0, left), 6), levels: sorted };
}

// Predicted sequence for one book (SIMULATION; not evidence). For a bridged phase each leg is walked separately.
export function predictPhase(ph) {
  const books = {};
  for (const q of ph.quotes) (books[`${q.code}:${q.side}`] ||= []).push({ role: q.role, level: q.level, bps: q.bps, remaining: q.xrp, initial: q.xrp });
  const rows = [];
  let velocityInsufficientAt = null;
  ph.payments.forEach((p, i) => {
    const legs = p.from === 'XRP' ? [`${p.to}:ask`] : p.to === 'XRP' ? [`${p.from}:bid`] : [`${p.from}:bid`, `${p.to}:ask`];
    const legFills = {};
    for (const k of legs) {
      const before = books[k] || [];
      const l1 = before.find((l) => l.role === 'maker' && l.level === 'L1');
      if (velocityInsufficientAt == null && l1 && l1.remaining < p.sizeXrp - 1e-12) velocityInsufficientAt = i;
      const w = walkLevels(before, p.sizeXrp);
      books[k] = w.levels;
      legFills[k] = w;
      if (ph.replenish) for (const l of books[k]) if (l.role === 'maker') l.remaining = l.initial; // replenished before the next payment (assumed; that is what D measures)
    }
    const titan = Object.values(legFills).reduce((s, w) => s + w.fills.filter((f) => f.role === 'maker').reduce((a, f) => a + f.xrp, 0), 0);
    const total = Object.values(legFills).reduce((s, w) => s + w.fills.reduce((a, f) => a + f.xrp, 0), 0);
    rows.push({ i, ...p, levelsTouched: Object.values(legFills).flatMap((w) => w.fills.map((f) => `${f.role === 'maker' ? 'Titan ' + f.level : 'rival'}`)), titanShare: total ? round(titan / total, 4) : 0,
      unfilledXrp: round(Object.values(legFills).reduce((s, w) => s + w.unfilledXrp, 0), 6),
      titanDepthLeftXrp: round(Math.min(...legs.map((k) => (books[k] || []).filter((l) => l.role === 'maker').reduce((s, l) => s + l.remaining, 0))), 6) });
  });
  return { rows, velocityInsufficientAt, label: 'SIMULATION: predicted book walk assuming no other liquidity; the live test measures the real outcome.' };
}

// Budget + guardian verdicts (pure, given a state).
export function buildContinuityPlan(state, { tokens = ['BBL', 'LDN'], guard = defaultGuard } = {}) {
  const fee = state.feeXrp, reserveInc = state.reserveInc;
  const mids = state.mids;
  const ph = phases(tokens).map((p) => {
    const quotes = p.quotes.map((q) => {
      const mid = mids[q.code];
      const price = Number((mid * (q.side === 'ask' ? 1 + q.bps / 1e4 : 1 - q.bps / 1e4)).toPrecision(8));
      return { ...q, priceXrp: price, tokenQty: Number((q.xrp / price).toPrecision(8)) };
    });
    const replenishTxs = p.replenish ? p.payments.length : 0;
    const txs = { maker: 0, rival: 0, router: p.payments.length, issuer: 0 };
    for (const q of quotes) txs[q.role] += 2; // OfferCreate + worst-case OfferCancel
    txs.maker += replenishTxs;
    const peak = { maker: quotes.filter((q) => q.role === 'maker').length, rival: quotes.filter((q) => q.role === 'rival').length };
    const routerXrp = p.payments.filter((x) => x.from === 'XRP').reduce((s, x) => s + x.sizeXrp, 0);
    const routerToken = {};
    for (const x of p.payments.filter((y) => y.from !== 'XRP')) routerToken[x.from] = (routerToken[x.from] || 0) + (x.sizeXrp / mids[x.from]) * (1 + CAPS.slippageBps / 1e4) * (1 + 2 * RIVAL_BPS / 1e4);
    return { ...p, quotes, txs, peak, routerXrpSendMax: round(routerXrp * (1 + CAPS.slippageBps / 1e4), 6), routerTokenSendMax: Object.fromEntries(Object.entries(routerToken).map(([k, v]) => [k, round(v, 4)])), prediction: predictPhase(p) };
  });
  // Inventory setup (issuer Payments) if a role is short of tokens it must deliver.
  const setup = [];
  const needTok = { maker: {}, rival: {}, router: {} };
  for (const p of ph) {
    for (const q of p.quotes.filter((x) => x.side === 'ask')) needTok[q.role][q.code] = Math.max(needTok[q.role][q.code] || 0, p.quotes.filter((x) => x.role === q.role && x.code === q.code && x.side === 'ask').reduce((s, x) => s + x.tokenQty, 0) * (p.replenish && q.role === 'maker' ? p.payments.length : 1));
    for (const [code, v] of Object.entries(p.routerTokenSendMax)) needTok.router[code] = (needTok.router[code] || 0) + v;
  }
  for (const [role, m] of Object.entries(needTok)) for (const [code, need] of Object.entries(m)) {
    const have = state.accounts?.[role]?.lines?.[code]?.balance ?? 0;
    if (need > have) setup.push({ role: 'issuer', to: role, code, qty: Math.ceil((need * 1.2 - have) / 10) * 10, have: round(have, 4), need: round(need, 4) });
  }
  const txs = { maker: 0, rival: 0, router: 0, issuer: setup.length };
  for (const p of ph) for (const [k, v] of Object.entries(p.txs)) txs[k] += v;
  const totalTxs = Object.values(txs).reduce((s, v) => s + v, 0);
  const peakMaker = Math.max(...ph.map((p) => p.peak.maker)), peakRival = Math.max(...ph.map((p) => p.peak.rival));
  const bidsCommitted = (role) => Math.max(...ph.map((p) => p.quotes.filter((q) => q.role === role && q.side === 'bid').reduce((s, q) => s + q.xrp, 0)));
  const payments = ph.reduce((s, p) => s + p.payments.length, 0);
  const routerXrp = round(ph.reduce((s, p) => s + p.routerXrpSendMax, 0), 6);
  const maxTxXrp = Math.max(...ph.flatMap((p) => [...p.quotes.map((q) => q.xrp), ...p.payments.map((x) => x.sizeXrp * (1 + CAPS.slippageBps / 1e4))]));
  const budget = {
    feePerTxXrp: fee, txs: { ...txs, total: totalTxs }, payments,
    feesXrp: round(totalTxs * fee, 6), feesXrpWithSafety: round(totalTxs * fee * CAPS.feeSafety, 6),
    reservesLockedPeakXrp: { maker: round(peakMaker * reserveInc, 6), rival: round(peakRival * reserveInc, 6), total: round((peakMaker + peakRival) * reserveInc, 6), note: `${reserveInc} XRP owner reserve per resting offer; locked while quotes rest, released on fill/cancel. No new trustlines are needed.` },
    xrpCommittedInBidsPeak: { maker: round(bidsCommitted('maker'), 6), rival: round(bidsCommitted('rival'), 6) },
    routerXrpSendMaxTotal: routerXrp,
    routerTokenSendMax: ph.reduce((m, p) => { for (const [k, v] of Object.entries(p.routerTokenSendMax)) m[k] = round((m[k] || 0) + v, 4); return m; }, {}),
    inventorySetup: setup,
    netXrpCostToDemoAccounts: round(totalTxs * fee, 6),
    netNote: 'All counterparties are our demo accounts, so XRP paid by the router moves to the maker/rival (not lost). The only XRP actually consumed is transaction fees; reserves are temporarily locked.',
    maxSingleTxXrp: round(maxTxXrp, 6),
    hourlyCapCheck: { payments, cap: CAPS.perHour, ok: payments <= CAPS.perHour },
    upperBoundXrp: round(totalTxs * fee * CAPS.feeSafety + (peakMaker + peakRival) * reserveInc + routerXrp + bidsCommitted('maker') + bidsCommitted('rival'), 6),
    upperBoundNote: 'Upper bound of XRP that must be available across the demo accounts at once: fees ×3 safety + peak reserves + router XRP SendMax + peak XRP resting in bids.',
  };
  const proposals = [
    ...setup.map((s) => ({ what: `issuer issues ${s.qty} ${s.code} to ${s.to}`, txType: 'Payment', role: 'issuer', amountXrp: round(s.qty * (mids[s.code] || 0), 6) })),
    ...ph.flatMap((p) => [
      ...p.quotes.map((q) => ({ what: `[${p.id}] ${q.role} ${q.side} ${q.code} ${q.level} @ ${q.priceXrp}`, txType: 'OfferCreate', role: q.role, amountXrp: q.xrp })),
      ...p.payments.map((x, i) => ({ what: `[${p.id}] router pays ${x.from}→${x.to} #${i + 1} ${x.sizeXrp} XRP-eq`, txType: 'Payment', role: 'router', amountXrp: round(x.sizeXrp * (1 + CAPS.slippageBps / 1e4), 6) })),
    ]),
  ].map((pr) => {
    const now = guard({ mode: 'LIVE_TESTNET', ...pr, requiresApproval: true, approved: false });
    const ifApproved = guard({ mode: 'LIVE_TESTNET', ...pr, requiresApproval: true, approved: true });
    return { ...pr, allowedNow: now.allowed, allowedIfApproved: ifApproved.allowed, reasons: ifApproved.reasons };
  });
  const measurements = [
    'Per payment: tx hash, delivered_amount, offers consumed by owner and level (metadata), XRP bridge legs verified in both books.',
    'Per payment: executable depth before (book_offers at ledger−1) and after; first payment where Titan L1 (VELOCITY) depth < payment size.',
    'Per payment: exec vs mid, spread at touch and price impact (bps); Titan vs rival share.',
    'Phase D: replenish latency = (ledger, close time) of the replacement OfferCreate − (ledger, close time) of the fill; and whether the next payment consumed the replenished quote.',
    'Pathfinding method per payment (ripple_path_find vs xrp_bridge_fallback) and rippled alternatives count, persisted in the run record.',
  ];
  return {
    planned: true, approved: false, submitted: 0, mode: 'LIVE_TESTNET', organic: false, dryRun: true,
    statement: 'Design only. Nothing has been or will be submitted by this endpoint. Execution needs a separate explicit Commander approval.',
    stateSource: state.source, validatedLedger: state.validatedLedger ?? null, mids, tokens, levels: LEVELS, rivalBps: RIVAL_BPS, levelXrp: LEVEL_XRP,
    phases: ph, budget, proposals, guardian: { allowedNow: proposals.filter((p) => p.allowedNow).length, allowedIfApproved: proposals.filter((p) => p.allowedIfApproved).length, total: proposals.length },
    measurements,
  };
}

// Read-only state for the plan (mids from the current books, fee/reserve from server_info, balances). Never submits.
export async function continuityDryRun(io, { tokens = ['BBL', 'LDN'], addrs } = {}) {
  const a = addrs || io.addresses();
  const info = (await io.request({ command: 'server_info' })).result.info;
  const vl = info.validated_ledger || {};
  const feeXrp = Math.max(CAPS.fallbackFeeXrp, Number(vl.base_fee_xrp ?? 0.00001) * Number(info.load_factor ?? 1));
  const mids = {};
  for (const code of tokens) {
    const tok = { currency: code, issuer: a.issuer };
    const best = async (gets, pays, ask) => {
      const o = (await io.request({ command: 'book_offers', taker_gets: gets, taker_pays: pays, ledger_index: 'validated', limit: 1 })).result.offers?.[0];
      if (!o) return null;
      const t = amountValue(ask ? o.TakerGets : o.TakerPays), x = amountValue(ask ? o.TakerPays : o.TakerGets);
      return t ? x / t : null;
    };
    const ask = await best(tok, { currency: 'XRP' }, true), bid = await best({ currency: 'XRP' }, tok, false);
    mids[code] = ask && bid ? Number(((ask + bid) / 2).toPrecision(6)) : ask || bid || CAPS.defaultMidXrp;
  }
  const accounts = {};
  for (const role of ['maker', 'rival', 'router']) {
    if (!a[role]) continue;
    const l = (await io.request({ command: 'account_lines', account: a[role], peer: a.issuer, ledger_index: 'validated' })).result.lines || [];
    accounts[role] = { lines: Object.fromEntries(l.map((x) => [x.currency, { balance: Number(x.balance) }])) };
  }
  return buildContinuityPlan({ source: 'Testnet read (validated ledger)', validatedLedger: vl.seq, feeXrp, reserveInc: Number(vl.reserve_inc_xrp ?? 0.2), mids, accounts }, { tokens });
}

export const OFFLINE_STATE = { source: 'offline defaults (Testnet unavailable): mid 0.009 XRP, fee 0.000012 XRP, reserve 0.2 XRP', feeXrp: CAPS.fallbackFeeXrp, reserveInc: 0.2, mids: { BBL: CAPS.defaultMidXrp, LDN: CAPS.defaultMidXrp }, accounts: {} };
