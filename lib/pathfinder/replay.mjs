// Testnet pathfinding replay + maker strategy competition (LIVE_TESTNET, demo-generated).
//
// The demo `router` account sends genuine pathfound cross-currency Payments (Paths + SendMax, never partial)
// whose route mix and size distribution are drawn from the observed Mainnet profile, scaled down to tiny
// Testnet sizes. Our `maker` and a `rival` demo maker quote the token/XRP books; the XRPL payment engine
// alone decides whose offers fill. All flow is demo-generated (organic:false).
//
// Ledger access is injected (`io`) so the run logic is unit-testable with a fake ledger:
//   io.addresses() -> { issuer, maker, taker, rival, router }
//   io.request(req) -> Promise<{ result }>   (read-only Testnet commands)
//   io.submit(role, tx) -> Promise<{ hash, result, ledger, explorer, meta }>  (Ledger.submit; throws on failure)
import { guardCheck as defaultGuard } from '../guardian.mjs';
import { STRATEGIES, RIVAL_STRATEGIES, buildQuotes } from './strategies.mjs';
import { flowShape } from './profile.mjs';
import {
  amountValue, assetKey, consumedOffers, removedOffers, balanceChanges, createdOffer, rng, round, tokenStr, dropsStr,
} from './amounts.mjs';

export const MODE = 'LIVE_TESTNET';
export const CAPS = {
  defaultK: 8, maxK: 120, perHour: 600, paceMs: 4000, maxTokens: 2, // perHour raised 120 -> 600 by the operator 2026-10-25
  minPaymentXrp: 0.05, maxPaymentXrp: 2, targetMedianXrp: 0.4,
  slippageBps: 150, maxVsMidBps: 1500, defaultMidXrp: 0.009, feeSafety: 3, fallbackFeeXrp: 0.000012,
  minQuoteXrp: 1, maxQuoteXrp: 15, // operator quote-size override (our maker only), XRP notional per quote
  maxRouters: 3, // parallel payer accounts (router, router2, router3); each still sends at most one payment per paceMs
};
export const ROUTER_ROLES = ['router', 'router2', 'router3'];
export const STATEMENT = 'All payments are demo-generated: our own router account replays the shape of observed Mainnet pathfinding flow (organic:false). '
  + 'Nothing here is organic demand. What is real is that the XRPL Testnet payment engine chose which offers filled each payment.';
const EXPLORER = 'https://testnet.xrpl.org/transactions/';

export class PathfinderError extends Error { constructor(msg, status = 400, extra = {}) { super(msg); this.status = status; Object.assign(this, extra); } }

// ---------- options ----------
export function normalizeOptions(body = {}, liveTokens = []) {
  const errors = [];
  const strategy = body.strategy ?? 'tight';
  const rivalStrategy = body.rivalStrategy ?? 'static_wide';
  if (!STRATEGIES[strategy]) errors.push(`Unknown strategy ${strategy}.`);
  if (!RIVAL_STRATEGIES[rivalStrategy]) errors.push(`Unknown rival strategy ${rivalStrategy}.`);
  const k = body.k == null ? CAPS.defaultK : Number(body.k);
  if (!Number.isInteger(k) || k < 1 || k > CAPS.maxK) errors.push(`k must be an integer 1–${CAPS.maxK}.`);
  let tokens = Array.isArray(body.tokens) && body.tokens.length ? body.tokens.map((t) => String(t).toUpperCase()) : liveTokens.slice(0, CAPS.maxTokens);
  tokens = [...new Set(tokens)];
  for (const t of tokens) if (!liveTokens.includes(t)) errors.push(`Token ${t} is not a live launched token.`);
  if (!tokens.length) errors.push('No live token to replay against; launch one first.');
  if (tokens.length > CAPS.maxTokens) errors.push(`At most ${CAPS.maxTokens} tokens per run.`);
  const seed = body.seed == null ? Math.floor(Math.random() * 2 ** 31) : Number(body.seed);
  if (!Number.isInteger(seed) || seed < 0) errors.push('seed must be a non-negative integer.');
  const keepQuotes = body.keepQuotes === true;
  const routers = body.routers == null ? 1 : Number(body.routers);
  if (!Number.isInteger(routers) || routers < 1 || routers > CAPS.maxRouters) errors.push(`routers must be 1–${CAPS.maxRouters}.`);
  // Optional: re-post our consumed quotes after each fill (keeps depth on long runs).
  const replenish = body.replenish == null ? null : body.replenish === true;
  // Optional quote size for our maker (XRP notional per quote); null = the strategy's default size.
  const quoteXrp = body.quoteXrp == null || body.quoteXrp === '' ? null : Number(body.quoteXrp);
  if (quoteXrp != null && !(quoteXrp >= CAPS.minQuoteXrp && quoteXrp <= CAPS.maxQuoteXrp)) errors.push(`quoteXrp must be ${CAPS.minQuoteXrp}–${CAPS.maxQuoteXrp} XRP per quote.`);
  // Optional operator-selected route mix (demonstration override, labeled; default = Mainnet profile shape).
  let routeMix = null;
  if (body.routeMix != null) {
    const keys = ['xrp_to_token', 'token_to_xrp', 'token_to_token'];
    const m = body.routeMix;
    if (typeof m !== 'object' || Object.keys(m).some((key) => !keys.includes(key)) || keys.some((key) => m[key] != null && !(Number(m[key]) >= 0))) errors.push('routeMix keys: xrp_to_token, token_to_xrp, token_to_token (non-negative weights).');
    else routeMix = Object.fromEntries(keys.map((key) => [key, Number(m[key] || 0)]));
    if (routeMix && !Object.values(routeMix).some((w) => w > 0)) errors.push('routeMix needs at least one positive weight.');
    if (routeMix?.token_to_token > 0 && tokens.length < 2) errors.push('token_to_token routes need two live tokens.');
  }
  if (errors.length) throw new PathfinderError(errors.join(' '), 400, { errors });
  return { strategy, rivalStrategy, k, tokens, seed, keepQuotes, routeMix, quoteXrp, routers, replenish };
}

// ---------- flow sampling ----------
function pick(r, weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const tot = entries.reduce((s, [, w]) => s + w, 0);
  let u = r() * tot;
  for (const [k, w] of entries) { if ((u -= w) <= 0) return k; }
  return entries.at(-1)?.[0];
}

// Draw k payments (route + XRP-equivalent size) from the Mainnet flow shape, scaled to Testnet caps.
export function samplePayments(shape, { k, tokens, seed, routeMix = null }) {
  const r = rng(seed);
  const notes = [];
  const weights = { ...(routeMix || shape.routeMix) };
  if (routeMix) notes.push(`Route mix overridden by the operator for this demonstration (${JSON.stringify(routeMix)}); sizes still follow the Mainnet profile. This is not the observed Mainnet route mix.`);
  if (tokens.length < 2 && weights.token_to_token > 0) {
    notes.push(`Mainnet shows ${weights.token_to_token} token→token payments in the sample; replaying them on Testnet needs a second launched token (only ${tokens[0]} is live), so they are redistributed across XRP↔token routes.`);
    weights.token_to_token = 0;
  }
  if (!(weights.xrp_to_token + weights.token_to_xrp + (weights.token_to_token || 0))) { weights.xrp_to_token = 1; weights.token_to_xrp = 1; }
  const hist = shape.sizeHist.length ? shape.sizeHist : [{ lo: 1, hi: 10, count: 1 }];
  const histW = Object.fromEntries(hist.map((b, i) => [i, b.count]));
  const scale = CAPS.targetMedianXrp / (shape.medianXrp || 1);
  const out = [];
  for (let i = 0; i < k; i++) {
    const route = pick(r, weights);
    const b = hist[Number(pick(r, histW))];
    const lo = Math.max(b.lo || 0, 1e-6), hi = b.hi ?? lo * 10;
    const mainnetXrp = Math.exp(Math.log(lo) + r() * (Math.log(hi) - Math.log(lo)));
    const sizeXrp = round(Math.min(CAPS.maxPaymentXrp, Math.max(CAPS.minPaymentXrp, mainnetXrp * scale)), 6);
    let from, to;
    if (route === 'xrp_to_token') { from = 'XRP'; to = tokens[Math.floor(r() * tokens.length)]; }
    else if (route === 'token_to_xrp') { from = tokens[Math.floor(r() * tokens.length)]; to = 'XRP'; }
    else { const flip = r() < 0.5; from = flip ? tokens[1] : tokens[0]; to = flip ? tokens[0] : tokens[1]; }
    out.push({ i, route, from, to, sizeXrp, mainnetXrp: round(mainnetXrp, 6) });
  }
  notes.push(`Sizes: Mainnet XRP-equivalent sizes × ${scale.toPrecision(3)} (Mainnet median ${shape.medianXrp} XRP → ${CAPS.targetMedianXrp} XRP), clamped to ${CAPS.minPaymentXrp}–${CAPS.maxPaymentXrp} XRP per payment.`);
  return { payments: out, notes, scale };
}

// ---------- ledger state ----------
export async function readState(io, tokens) {
  const addrs = io.addresses();
  const info = (await io.request({ command: 'server_info' })).result.info;
  const vl = info.validated_ledger || {};
  const reserveBase = Number(vl.reserve_base_xrp ?? 1), reserveInc = Number(vl.reserve_inc_xrp ?? 0.2);
  const feeXrp = Math.max(CAPS.fallbackFeeXrp, Number(vl.base_fee_xrp ?? 0.00001) * Number(info.load_factor ?? 1));
  const accounts = {};
  for (const role of ['issuer', 'maker', 'taker', 'rival', ...ROUTER_ROLES]) {
    const address = addrs[role];
    if (!address && ROUTER_ROLES.includes(role) && role !== 'router') continue; // extra routers are optional
    if (!address) { accounts[role] = { address: null, missing: true, xrp: 0, ownerCount: 0, lines: {} }; continue; }
    let xrp = 0, ownerCount = 0, missing = false;
    try {
      const a = (await io.request({ command: 'account_info', account: address, ledger_index: 'validated' })).result.account_data;
      xrp = Number(a.Balance) / 1e6; ownerCount = a.OwnerCount;
    } catch { missing = true; }
    const lines = {};
    if (!missing && role !== 'issuer') {
      try {
        const l = (await io.request({ command: 'account_lines', account: address, peer: addrs.issuer, ledger_index: 'validated' })).result.lines;
        for (const t of tokens) { const x = l.find((y) => y.currency === t); if (x) lines[t] = { balance: Number(x.balance), limit: Number(x.limit) }; }
      } catch { /* no lines */ }
    }
    accounts[role] = { address, xrp, ownerCount, missing, lines, spendable: Math.max(0, xrp - reserveBase - ownerCount * reserveInc) };
  }
  const books = {}, mids = {};
  const roleOf = (a) => Object.entries(addrs).find(([, x]) => x === a)?.[0] ?? 'external';
  for (const code of tokens) {
    const tok = { currency: code, issuer: addrs.issuer };
    const [asks, bids] = await Promise.all([
      io.request({ command: 'book_offers', taker_gets: tok, taker_pays: { currency: 'XRP' }, ledger_index: 'validated', limit: 20 }),
      io.request({ command: 'book_offers', taker_gets: { currency: 'XRP' }, taker_pays: tok, ledger_index: 'validated', limit: 20 }),
    ]);
    const side = (offers, isAsk) => offers.map((o) => {
      const g = o.taker_gets_funded ?? o.TakerGets, p = o.taker_pays_funded ?? o.TakerPays;
      const qty = amountValue(isAsk ? g : p), x = amountValue(isAsk ? p : g);
      return { account: o.Account, role: roleOf(o.Account), seq: o.Sequence, qty: round(qty, 6), priceXrp: qty ? Number((x / qty).toPrecision(6)) : null, xrp: round(x, 6) };
    }).filter((o) => o.qty > 0);
    const a = side(asks.result.offers || [], true), b = side(bids.result.offers || [], false);
    books[code] = { asks: a, bids: b };
    const bestAsk = a[0]?.priceXrp, bestBid = b[0]?.priceXrp;
    mids[code] = bestAsk && bestBid ? Number(((bestAsk + bestBid) / 2).toPrecision(6)) : bestAsk || bestBid || CAPS.defaultMidXrp;
  }
  return { addrs, reserveBase, reserveInc, feeXrp, accounts, books, mids, validatedLedger: vl.seq ?? null };
}

// ---------- plan (pure given state) ----------
const tokenAmt = (code, issuer, qty) => ({ currency: code, issuer, value: tokenStr(qty) });

export function offerTx(q, issuer) {
  return q.side === 'ask'
    ? { TransactionType: 'OfferCreate', TakerGets: tokenAmt(q.code, issuer, q.tokenQty), TakerPays: dropsStr(q.xrp) }
    : { TransactionType: 'OfferCreate', TakerGets: dropsStr(q.xrp), TakerPays: tokenAmt(q.code, issuer, q.tokenQty) };
}

// Our strategy with the operator's quote size applied (rival keeps its own size).
export const ourStrategy = (opts) => ({
  ...STRATEGIES[opts.strategy],
  ...(opts.quoteXrp != null ? { notionalXrp: opts.quoteXrp } : {}),
  ...(opts.replenish != null ? { replenish: opts.replenish } : {}),
});
export const routerRoles = (opts) => ROUTER_ROLES.slice(0, opts.routers || 1);

export function buildPlan(state, opts, shape, { paymentsLastHour = 0 } = {}) {
  const { rivalStrategy, k, tokens, seed, routeMix } = opts;
  const ours = ourStrategy(opts), theirs = RIVAL_STRATEGIES[rivalStrategy];
  const { mids, accounts, addrs } = state;
  const quotes = [...buildQuotes('maker', ours, tokens, mids), ...buildQuotes('rival', theirs, tokens, mids)];
  const flow = samplePayments(shape, { k, tokens, seed, routeMix });
  const payers = routerRoles(opts);
  flow.payments.forEach((p, i) => { p.router = payers[i % payers.length]; });
  const notes = [...flow.notes];
  if (payers.length > 1) notes.push(`${payers.length} router accounts pay in parallel (${payers.join(', ')}), round-robin; each sends at most one payment per ${CAPS.paceMs / 1000} s.`);
  if (opts.quoteXrp != null) notes.push(`Quote size set by the operator: ${opts.quoteXrp} XRP per quote for our maker (strategy default ${STRATEGIES[opts.strategy].notionalXrp} XRP). The rival keeps its default size.`);
  if (tokens.length < 2) notes.push('token→token XRP-bridged routes need a second launched token; this run covers XRP↔token routes only.');

  // Setup: trustlines + inventory (idempotent: only what is missing).
  const setup = [];
  const needLine = (role, code) => !accounts[role]?.lines?.[code];
  const tokenNeeds = { rival: {}, ...Object.fromEntries(payers.map((r) => [r, {}])) };
  for (const q of quotes) if (q.role === 'rival' && q.side === 'ask') tokenNeeds.rival[q.code] = (tokenNeeds.rival[q.code] || 0) + q.tokenQty;
  for (const p of flow.payments) if (p.from !== 'XRP') tokenNeeds[p.router][p.from] = (tokenNeeds[p.router][p.from] || 0) + (p.sizeXrp / mids[p.from]) * (1 + CAPS.maxVsMidBps / 1e4);
  const lineLimit = '1000000000';
  for (const code of tokens) {
    for (const role of ['rival', ...payers]) if (needLine(role, code)) setup.push({ step: 'trustline', role, code, tx: { TransactionType: 'TrustSet', LimitAmount: { currency: code, issuer: addrs.issuer, value: lineLimit } }, amountXrp: 0, newObjects: 1 });
    const takerReceives = flow.payments.some((p) => p.to === code);
    if (takerReceives && needLine('taker', code)) setup.push({ step: 'trustline', role: 'taker', code, tx: { TransactionType: 'TrustSet', LimitAmount: { currency: code, issuer: addrs.issuer, value: lineLimit } }, amountXrp: 0, newObjects: 1 });
    for (const role of ['rival', ...payers]) {
      const need = tokenNeeds[role][code] || 0;
      const have = accounts[role]?.lines?.[code]?.balance || 0;
      if (need > have) {
        const qty = Math.ceil((need * 1.5 - have) / 10) * 10;
        setup.push({ step: 'inventory', role: 'issuer', to: role, code, tx: { TransactionType: 'Payment', Destination: addrs[role], Amount: tokenAmt(code, addrs.issuer, qty) }, amountXrp: round(qty * mids[code], 6), newObjects: 0 });
      }
    }
  }
  const makerAsk = {};
  for (const q of quotes) if (q.role === 'maker' && q.side === 'ask') makerAsk[q.code] = (makerAsk[q.code] || 0) + q.tokenQty;

  // Budget: reserves for new objects + fees + committed XRP must fit each role's spendable XRP.
  const fee = state.feeXrp * CAPS.feeSafety;
  const roleQuotes = (r) => quotes.filter((q) => q.role === r);
  const replenishTxs = (s) => (s.replenish ? 2 * k : 0);
  const need = {
    maker: { txs: roleQuotes('maker').length * 2 + replenishTxs(ours), newObjects: roleQuotes('maker').length, commitXrp: roleQuotes('maker').filter((q) => q.side === 'bid').reduce((s, q) => s + q.xrp, 0) },
    rival: { txs: roleQuotes('rival').length * 2 + replenishTxs(theirs), newObjects: roleQuotes('rival').length, commitXrp: roleQuotes('rival').filter((q) => q.side === 'bid').reduce((s, q) => s + q.xrp, 0) },
    ...Object.fromEntries(payers.map((r) => { const mine = flow.payments.filter((p) => p.router === r); return [r, { txs: mine.length, newObjects: 0, commitXrp: mine.filter((p) => p.from === 'XRP').reduce((s, p) => s + p.sizeXrp * (1 + CAPS.maxVsMidBps / 1e4), 0) }]; })),
    taker: { txs: 0, newObjects: 0, commitXrp: 0 },
    issuer: { txs: 0, newObjects: 0, commitXrp: 0 },
  };
  for (const s of setup) { need[s.role].txs++; need[s.role].newObjects += s.newObjects; }
  const budget = { reserveBase: state.reserveBase, reserveInc: state.reserveInc, feePerTxXrp: round(state.feeXrp, 6), roles: {}, ok: true, reasons: [] };
  for (const [role, n] of Object.entries(need)) {
    const a = accounts[role] || { missing: true, xrp: 0, ownerCount: 0, spendable: 0, address: null };
    const required = n.newObjects * state.reserveInc + n.txs * fee + n.commitXrp;
    const ok = !a.missing && required <= a.spendable + 1e-9;
    budget.roles[role] = { address: a.address, xrp: round(a.xrp, 6), ownerCount: a.ownerCount, spendableXrp: round(a.spendable, 6), requiredXrp: round(required, 6), newObjects: n.newObjects, txs: n.txs, commitXrp: round(n.commitXrp, 6), ok };
    if (!ok && (n.txs || required > 0)) { budget.ok = false; budget.reasons.push(a.missing ? `${role} account not found on Testnet.` : `${role} needs ${round(required, 4)} XRP spendable but has ${round(a.spendable, 4)}.`); }
  }
  for (const [code, qty] of Object.entries(makerAsk)) {
    const have = accounts.maker?.lines?.[code]?.balance || 0;
    if (have < qty) { budget.ok = false; budget.reasons.push(`maker holds ${have} ${code}, asks need ${round(qty, 4)}.`); }
  }
  if (paymentsLastHour + k > CAPS.perHour) { budget.ok = false; budget.reasons.push(`Hourly cap: ${paymentsLastHour} payments in the last hour, +${k} would exceed ${CAPS.perHour}.`); }
  for (const p of flow.payments) {
    const dest = p.to === 'XRP' ? null : p.to;
    if (dest && !accounts.taker.lines[dest] && !setup.some((s) => s.role === 'taker' && s.code === dest)) { budget.ok = false; budget.reasons.push(`taker cannot receive ${dest}.`); }
  }

  // Guardian verdicts for every proposed transaction.
  const g = (txType, role, amountXrp) => ({ mode: MODE, txType, role, amountXrp: round(amountXrp, 6), requiresApproval: true });
  const proposals = [
    ...setup.map((s) => ({ what: s.step === 'trustline' ? `${s.role} TrustSet ${s.code}` : `issuer issues ${s.tx.Amount.value} ${s.code} to ${s.to}`, ...g(s.tx.TransactionType, s.role, s.amountXrp) })),
    ...quotes.map((q) => ({ what: `${q.role} ${q.side} ${q.tokenQty} ${q.code} @ ${q.priceXrp} XRP`, ...g('OfferCreate', q.role, q.xrp) })),
    ...flow.payments.map((p) => ({ what: `${p.router} pays ${p.route} ${p.sizeXrp} XRP-eq`, ...g('Payment', p.router, p.sizeXrp * (1 + CAPS.maxVsMidBps / 1e4)) })),
    ...quotes.map((q) => ({ what: `${q.role} cancels ${q.side} ${q.code}`, ...g('OfferCancel', q.role, 0) })),
  ];

  return {
    mode: MODE, organic: false, statement: STATEMENT,
    options: opts, shape: { source: shape.source, routeMix: shape.routeMix, medianXrp: shape.medianXrp },
    strategy: { id: opts.strategy, ...ours }, rivalStrategy: { id: rivalStrategy, ...theirs },
    mids, books: state.books, quotes, payments: flow.payments, setup: setup.map(({ tx, ...s }) => ({ ...s, txType: tx.TransactionType })),
    budget, proposals, notes, validatedLedger: state.validatedLedger,
    caps: { maxK: CAPS.maxK, maxRouters: CAPS.maxRouters, perHour: CAPS.perHour, paceMs: CAPS.paceMs, maxPaymentXrp: CAPS.maxPaymentXrp, slippageBps: CAPS.slippageBps },
    _setupTx: setup,
  };
}

// ---------- pathfinding (Testnet read) ----------
// The state as one payer sees it: `addrs.router` points at that payer's account (pathfind / attribute read it).
export const payerState = (state, role = 'router') => (role === 'router' || !state.addrs[role] ? state : { ...state, addrs: { ...state.addrs, router: state.addrs[role] } });
export function deliverAmount(p, mids, issuer) {
  return p.to === 'XRP' ? dropsStr(p.sizeXrp) : tokenAmt(p.to, issuer, p.sizeXrp / mids[p.to]);
}
const srcCurrency = (from, issuer) => (from === 'XRP' ? { currency: 'XRP' } : { currency: from, issuer });
const valueXrp = (amount, mids) => (assetKey(amount) === 'XRP' ? amountValue(amount) : amountValue(amount) * (mids[amount.currency] || 0));

async function bridgeFallback(io, p, addrs, destination_amount) {
  const pf = async (dest, from) => {
    const r = await io.request({ command: 'ripple_path_find', source_account: addrs.router, destination_account: addrs.taker, destination_amount: dest, source_currencies: [srcCurrency(from, addrs.issuer)] });
    return (r.result.alternatives || []).find((a) => assetKey(a.source_amount) === (from === 'XRP' ? 'XRP' : `${from}.${addrs.issuer}`));
  };
  try {
    const leg2 = await pf(destination_amount, 'XRP'); // XRP needed to buy the destination token
    if (!leg2) return null;
    const leg1 = await pf(leg2.source_amount, p.from); // source token needed to raise that XRP
    if (!leg1) return null;
    const paths = [[{ currency: 'XRP' }, { currency: p.to, issuer: addrs.issuer }]];
    const sendMax = { ...leg1.source_amount, value: String(+(amountValue(leg1.source_amount) * (1 + CAPS.slippageBps / 1e4)).toPrecision(15)) };
    const sim = await io.request({ command: 'simulate', tx_json: { TransactionType: 'Payment', Account: addrs.router, Destination: addrs.taker, Amount: destination_amount, SendMax: sendMax, Paths: paths } });
    if (sim.result.engine_result !== 'tesSUCCESS') return null;
    return { source_amount: leg1.source_amount, paths_computed: paths };
  } catch { return null; }
}

export async function pathfind(io, p, { addrs, mids }) {
  const destination_amount = deliverAmount(p, mids, addrs.issuer);
  const req = { command: 'ripple_path_find', source_account: addrs.router, destination_account: addrs.taker, destination_amount, source_currencies: [srcCurrency(p.from, addrs.issuer)] };
  let alts;
  try { alts = (await io.request(req)).result.alternatives || []; }
  catch (e) { return { ok: false, reason: `ripple_path_find error: ${e.data?.error || e.message}`, destination_amount }; }
  const wantKey = p.from === 'XRP' ? 'XRP' : `${p.from}.${addrs.issuer}`;
  let alt = alts.find((a) => assetKey(a.source_amount) === wantKey);
  let method = 'ripple_path_find';
  // Public Testnet servers' ripple_path_find often omits two-book routes (token -> XRP -> token) even when the
  // payment engine can execute them. Fall back to the canonical XRP auto-bridge path, quoted leg by leg and
  // checked with a read-only `simulate` before anything is sent.
  if (!alt && p.from !== 'XRP' && p.to !== 'XRP') {
    alt = await bridgeFallback(io, p, addrs, destination_amount);
    if (alt) method = 'xrp_bridge_fallback';
  }
  // Empty alternatives are rippled's pathfinder answer, not proof of missing liquidity (see docs/PATHFINDER_NO_PATH.md).
  if (!alt) {
    const bridged = p.from !== 'XRP' && p.to !== 'XRP';
    return { ok: false, method, alternatives: alts.length, destination_amount,
      reason: bridged ? 'No path: ripple_path_find returned no route for this source currency and the XRP-bridge fallback (leg quotes + simulate) did not verify one.'
        : 'No path: ripple_path_find returned no route for this source currency at the current ledger.' };
  }
  const costXrp = valueXrp(alt.source_amount, mids);
  const vsMidBps = round((costXrp / p.sizeXrp - 1) * 1e4, 1);
  const paths = alt.paths_computed || [];
  return {
    ok: vsMidBps <= CAPS.maxVsMidBps, reason: vsMidBps > CAPS.maxVsMidBps ? `Best path costs ${vsMidBps} bps over mid (cap ${CAPS.maxVsMidBps}).` : null,
    method, alternatives: alts.length, ...(method === 'xrp_bridge_fallback' ? { methodNote: 'ripple_path_find returned no token→token route; explicit XRP-bridged path quoted per leg and verified with simulate (tesSUCCESS) before sending.' } : {}),
    destination_amount, source_amount: alt.source_amount, paths, pathCount: paths.length, viaXrp: paths.some((x) => x.some((s) => s.currency === 'XRP')),
    costXrp: round(costXrp, 6), vsMidBps,
  };
}

export function paymentTx(p, pf, addrs) {
  const s = CAPS.slippageBps / 1e4;
  const src = pf.source_amount;
  const SendMax = assetKey(src) === 'XRP' ? dropsStr(amountValue(src) * (1 + s)) : { currency: src.currency, issuer: src.issuer, value: tokenStr(amountValue(src) * (1 + s)) };
  const tx = { TransactionType: 'Payment', Destination: addrs.taker, Amount: pf.destination_amount, SendMax };
  if (pf.paths?.length) tx.Paths = pf.paths.map((path) => path.map(({ account, currency, issuer }) => Object.fromEntries(Object.entries({ account, currency, issuer }).filter(([, v]) => v != null))));
  return tx; // no tfPartialPayment: either the full Amount is delivered within SendMax or it fails
}

// ---------- attribution (pure) ----------
export function attribute(meta, { addrs, mids, strategySeqs = {}, from, to }) {
  const roleOf = (a) => Object.entries(addrs).find(([, x]) => x === a)?.[0] ?? 'external';
  const offers = consumedOffers(meta, addrs.router);
  const fills = offers.map((o) => {
    const ask = o.getsKey !== 'XRP'; // owner gave the token -> owner's ask was lifted
    const tokKey = ask ? o.getsKey : o.paysKey;
    const code = tokKey?.split('.')[0];
    const tokenQty = ask ? o.getsDelta : o.paysDelta;
    const xrp = o.xrpDelta;
    const mid = mids[code] || 0;
    const role = roleOf(o.owner);
    const strategy = !!strategySeqs[role]?.has?.(o.seq);
    const bucket = role === 'maker' && strategy ? 'maker' : role === 'rival' ? 'rival' : 'other';
    return { owner: o.owner, role, bucket, strategy, seq: o.seq, code, side: ask ? 'ask' : 'bid', tokenQty: round(tokenQty, 8), xrp: round(xrp, 6),
      priceXrp: tokenQty ? Number((xrp / tokenQty).toPrecision(6)) : null, edgeXrp: round(ask ? xrp - tokenQty * mid : tokenQty * mid - xrp, 6), deleted: o.deleted };
  });
  const capturedBy = { maker: 0, rival: 0, other: 0 };
  for (const f of fills) capturedBy[f.bucket] += f.xrp;
  const total = capturedBy.maker + capturedBy.rival + capturedBy.other;
  const shares = Object.fromEntries(Object.entries(capturedBy).map(([k, v]) => [k, total ? round(v / total, 4) : 0]));
  const xrpBooks = new Set(fills.filter((f) => f.xrp > 0).map((f) => f.code));
  const bridged = from !== 'XRP' && to !== 'XRP' && xrpBooks.has(from) && xrpBooks.has(to);
  // Execution vs mid: what the payer gave up (mid-valued) vs what was delivered (mid-valued).
  const delivered = meta?.delivered_amount;
  let spentXrp = null;
  if (from === 'XRP') spentXrp = fills.filter((f) => f.side === 'ask').reduce((s, f) => s + f.xrp, 0);
  else {
    const d = balanceChanges(meta).get(addrs.router)?.get(`${from}.${addrs.issuer}`);
    if (d != null) spentXrp = -d * (mids[from] || 0);
  }
  const deliveredXrp = delivered ? valueXrp(delivered, mids) : null;
  const execBpsVsMid = spentXrp != null && deliveredXrp ? round((spentXrp / deliveredXrp - 1) * 1e4, 1) : null;
  const removals = removedOffers(meta, addrs.router).map((r) => ({ ...r, role: roleOf(r.owner) }));
  const winner = total ? Object.entries(capturedBy).sort((a, b) => b[1] - a[1])[0][0] : 'none';
  return { fills, removals, capturedBy: Object.fromEntries(Object.entries(capturedBy).map(([k, v]) => [k, round(v, 6)])), shares, totalXrp: round(total, 6), bridged, spentXrp: spentXrp == null ? null : round(spentXrp, 6), deliveredXrp: deliveredXrp == null ? null : round(deliveredXrp, 6), execBpsVsMid, winner };
}

// ---------- scorecard (pure) ----------
export function scorecard(run) {
  const pays = run.payments || [];
  const ok = pays.filter((p) => p.status === 'success');
  const cap = { maker: { xrp: 0, fills: 0 }, rival: { xrp: 0, fills: 0 }, other: { xrp: 0, fills: 0 } };
  const realized = { maker: 0, rival: 0 };
  const won = { maker: 0, rival: 0, other: 0, none: 0 };
  let execNum = 0, execDen = 0, worst = null;
  const removals = { removed_unfunded: 0, expired: 0 };
  for (const p of ok) {
    for (const r of p.attribution.removals || []) removals[r.reason]++;
    for (const f of p.attribution.fills) {
      cap[f.bucket].xrp += f.xrp; cap[f.bucket].fills++;
      if (f.bucket === 'maker' || f.bucket === 'rival') realized[f.bucket] += f.edgeXrp;
    }
    won[p.attribution.winner] = (won[p.attribution.winner] || 0) + 1;
    if (p.attribution.execBpsVsMid != null && p.attribution.deliveredXrp) {
      execNum += p.attribution.execBpsVsMid * p.attribution.deliveredXrp; execDen += p.attribution.deliveredXrp;
      worst = worst == null ? p.attribution.execBpsVsMid : Math.max(worst, p.attribution.execBpsVsMid);
    }
  }
  const tot = cap.maker.xrp + cap.rival.xrp + cap.other.xrp;
  const capture = Object.fromEntries(Object.entries(cap).map(([k, v]) => [k, { xrp: round(v.xrp, 6), fills: v.fills, share: tot ? round(v.xrp / tot, 4) : 0 }]));
  const costs = {};
  for (const role of ['maker', 'rival', 'router', 'issuer', 'taker']) {
    const txs = (run.actions || []).filter((a) => a.role === role && a.hash).length + (role === 'router' ? pays.filter((p) => p.hash).length : 0);
    costs[role] = { txs, feesXrpEst: round(txs * (run.feeXrp || CAPS.fallbackFeeXrp), 6) };
  }
  for (const role of ['maker', 'rival']) {
    costs[role].peakOffers = run.peakOffers?.[role] || 0;
    costs[role].reserveLockedXrp = round((run.peakOffers?.[role] || 0) * (run.reserveInc ?? 0.2), 6);
    costs[role].note = 'Owner reserve is locked while offers rest and released when they are cancelled or filled.';
  }
  return {
    mode: MODE, organic: false, statement: STATEMENT,
    strategy: run.options.strategy, rivalStrategy: run.options.rivalStrategy, tokens: run.options.tokens,
    payments: { planned: pays.length, sent: pays.filter((p) => p.hash).length, succeeded: ok.length, skipped: pays.filter((p) => p.status === 'skipped').length, failed: pays.filter((p) => p.status === 'failed').length, bridged: ok.filter((p) => p.attribution.bridged).length },
    capture, paymentsWon: won,
    execution: { avgBpsVsMid: execDen ? round(execNum / execDen, 1) : null, worstBpsVsMid: worst, note: 'Payer cost vs mid (positive = paid above mid). Mid = book mid before the run.' },
    realizedSpreadXrp: { maker: round(realized.maker, 6), rival: round(realized.rival, 6) },
    costs,
    netXrpEst: { maker: round(realized.maker - costs.maker.feesXrpEst, 6), rival: round(realized.rival - costs.rival.feesXrpEst, 6) },
    replenished: run.replenished || 0,
    offerRemovals: { ...removals, note: 'Offers the payment engine deleted as unfunded or expired while crossing. Not fills, not captured flow.' },
  };
}

// ---------- runner ----------
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class PathfinderRunner {
  constructor({ io, bus = { publish() {} }, guard = defaultGuard, persist = { load: () => ({}), save() {} }, sleep = defaultSleep, now = () => Date.now(), readonly = () => process.env.TF_READONLY === '1', id = () => crypto.randomUUID() }) {
    Object.assign(this, { io, bus, guard, persist, sleep, now, readonly, newId: id });
    const saved = persist.load() || {};
    this.runs = saved.runs || [];
    this.openOffers = saved.openOffers || { maker: [], rival: [] };
    this.queue = Promise.resolve();
    this.pending = 0;
    this.active = null;
    this.done = new Map(); // runId -> Promise (for tests / awaiting)
  }

  save() { this.persist.save({ runs: this.runs.slice(-50), openOffers: this.openOffers }); }

  paymentsLastHour() {
    const t = this.now() - 3600_000;
    let n = 0;
    for (const r of this.runs) for (const p of r.payments || []) if (p.hash && Date.parse(p.at) >= t) n++;
    return n;
  }

  // Dry run: reads Testnet state, samples flow, calls ripple_path_find, checks budget + Guardian. Never submits.
  async plan(opts, profile) {
    const shape = flowShape(profile);
    const state = await readState(this.io, opts.tokens);
    const plan = buildPlan(state, opts, shape, { paymentsLastHour: this.paymentsLastHour() });
    for (const p of plan.payments) p.pathfind = await pathfind(this.io, p, payerState(state, p.router));
    // Verdict as it would be at run time (with operator approval); without approval every one is refused.
    for (const pr of plan.proposals) { const v = this.guard({ ...pr, approved: true }); pr.allowedIfApproved = v.allowed; pr.reasons = v.reasons; }
    for (const p of plan.payments) {
      if (!p.pathfind.ok && p.from !== 'XRP' && !(state.accounts[p.router || 'router']?.lines?.[p.from]?.balance > 0)) p.pathfind.reason = `Router holds no ${p.from} yet, so Testnet cannot compute a path from it. The run's setup step issues router inventory first, then path-finds again.`;
    }
    plan.pathfindNote = 'ripple_path_find ran against the current Testnet ledger, before this plan\'s quotes exist. During a live run it is re-run right before each payment, after our and the rival\'s quotes are posted.';
    plan.dryRun = true;
    delete plan._setupTx;
    return plan;
  }

  // Live run: queued, one at a time. Returns the run record immediately (status queued).
  start(opts, profile, { approved, loop } = {}) {
    if (this.readonly()) throw new PathfinderError('Read-only instance: live runs are disabled (TF_READONLY=1). Use plan for a dry run.', 403);
    if (approved !== true) throw new PathfinderError('Explicit operator approval required (approved:true).', 400);
    if (this.pending >= 2) throw new PathfinderError('A pathfinder run is already running and one is queued; try again shortly.', 429);
    if (this.paymentsLastHour() + opts.k > CAPS.perHour) throw new PathfinderError(`Hourly cap of ${CAPS.perHour} replay payments reached.`, 429);
    const run = { id: this.newId(), mode: MODE, organic: false, statement: STATEMENT, status: 'queued', createdAt: new Date(this.now()).toISOString(), options: opts, approved: true, actions: [], payments: [], notes: [], ...(loop ? { loop } : {}) };
    this.runs.push(run); this.save();
    this.pending++;
    const done = this.queue.then(() => this.#execute(run, profile)).finally(() => { this.pending--; });
    this.queue = done.catch(() => {});
    this.done.set(run.id, done);
    return run;
  }

  #guarded(run, action) {
    const v = this.guard({ mode: MODE, txType: action.tx.TransactionType, role: action.role, amountXrp: round(action.amountXrp || 0, 6), requiresApproval: true, approved: run.approved === true });
    if (!v.allowed) throw new PathfinderError(`Guardian refused ${action.what}: ${v.reasons.join(' ')}`, 403);
    return v;
  }

  async #act(run, action) {
    const rec = { what: action.what, role: action.role, txType: action.tx.TransactionType, at: new Date(this.now()).toISOString() };
    run.actions.push(rec);
    rec.guard = this.#guarded(run, action);
    try {
      const out = await this.io.submit(action.role, action.tx);
      Object.assign(rec, { hash: out.hash, result: out.result, ledger: out.ledger, explorer: out.explorer || EXPLORER + out.hash });
      this.bus.publish('pathfinder.step', MODE, { runId: run.id, what: rec.what, role: rec.role, hash: rec.hash });
      return out;
    } catch (e) {
      Object.assign(rec, { error: e.message, hash: e.tx?.hash, result: e.tx?.result });
      throw e;
    }
  }

  async #execute(run, profile) {
    this.active = run.id;
    run.status = 'running'; run.startedAt = new Date(this.now()).toISOString(); this.save();
    const opts = run.options;
    const strategySeqs = { maker: new Set(), rival: new Set() };
    const live = { maker: new Map(), rival: new Map() }; // seq -> quote
    run.peakOffers = { maker: 0, rival: 0 };
    let state;
    const track = (role, seq, q) => {
      strategySeqs[role].add(seq); live[role].set(seq, q);
      if (!this.openOffers[role].includes(seq)) this.openOffers[role].push(seq);
      run.peakOffers[role] = Math.max(run.peakOffers[role], live[role].size);
    };
    const untrack = (role, seq) => { live[role].delete(seq); this.openOffers[role] = this.openOffers[role].filter((s) => s !== seq); };
    try {
      const shape = flowShape(profile);
      state = await readState(this.io, opts.tokens);
      const plan = buildPlan(state, opts, shape, { paymentsLastHour: this.paymentsLastHour() });
      Object.assign(run, { mids: plan.mids, quotes: plan.quotes, budget: plan.budget, shape: plan.shape, feeXrp: state.feeXrp, reserveInc: state.reserveInc, notes: plan.notes });
      if (!plan.budget.ok) throw new PathfinderError(`Budget check failed: ${plan.budget.reasons.join(' ')}`, 409);
      const { addrs, mids } = state;

      // 1. Setup (idempotent).
      for (const s of plan._setupTx) await this.#act(run, { what: s.step === 'trustline' ? `${s.role} TrustSet ${s.code}` : `issuer issues ${s.tx.Amount.value} ${s.code} to ${s.to}`, role: s.role, tx: s.tx, amountXrp: s.amountXrp });

      // 2. Cancel strategy quotes left over from an interrupted earlier run.
      for (const role of ['maker', 'rival']) for (const seq of [...this.openOffers[role]]) {
        await this.#act(run, { what: `${role} cancels leftover offer ${seq}`, role, tx: { TransactionType: 'OfferCancel', OfferSequence: seq }, amountXrp: 0 });
        untrack(role, seq);
      }
      this.save();

      // 3. Post quotes.
      const place = async (q, replaceSeq) => {
        const tx = offerTx(q, addrs.issuer);
        if (replaceSeq != null) tx.OfferSequence = replaceSeq;
        const out = await this.#act(run, { what: `${q.role} ${replaceSeq != null ? 're-quotes' : 'quotes'} ${q.side} ${q.tokenQty} ${q.code} @ ${q.priceXrp}`, role: q.role, tx, amountXrp: q.xrp });
        if (replaceSeq != null) untrack(q.role, replaceSeq);
        const c = createdOffer(out.meta, addrs[q.role]);
        if (c) track(q.role, c.seq, q);
        this.save();
      };
      for (const q of plan.quotes) await place(q);

      // 4. Replay payments: batches of one payment per router, sent in parallel (each router is its own account,
      //    so their Sequence numbers never race), then consumed quotes are replenished one at a time.
      const ours = ourStrategy(opts), theirs = RIVAL_STRATEGIES[opts.rivalStrategy];
      const maxReplenish = 2 * opts.k;
      const n = routerRoles(opts).length;
      run.replenished = 0;
      let last = 0;
      const sendOne = async (p) => {
        const rec = { ...p, at: new Date(this.now()).toISOString(), status: 'pending' };
        run.payments.push(rec);
        const ps = payerState(state, p.router);
        const pf = await pathfind(this.io, p, ps);
        rec.pathfind = { ok: pf.ok, reason: pf.reason, method: pf.method, alternatives: pf.alternatives, pathCount: pf.pathCount, viaXrp: pf.viaXrp, vsMidBps: pf.vsMidBps, costXrp: pf.costXrp };
        if (!pf.ok) { rec.status = 'skipped'; rec.reason = pf.reason; return rec; }
        const tx = paymentTx(p, pf, ps.addrs);
        const sendMaxXrp = valueXrp(tx.SendMax, mids);
        rec.guard = this.#guarded(run, { what: `${p.router || 'router'} payment ${p.route}`, role: p.router || 'router', tx, amountXrp: sendMaxXrp }); // throws PathfinderError: aborts the run
        try {
          const out = await this.io.submit(p.router || 'router', tx);
          Object.assign(rec, { hash: out.hash, result: out.result, ledger: out.ledger, explorer: out.explorer || EXPLORER + out.hash, status: 'success' });
          rec.attribution = attribute(out.meta, { addrs: ps.addrs, mids, strategySeqs, from: p.from, to: p.to });
        } catch (e) {
          Object.assign(rec, { status: 'failed', error: e.message, hash: e.tx?.hash, result: e.tx?.result });
          return rec;
        }
        this.bus.publish('pathfinder.payment', MODE, { runId: run.id, hash: rec.hash, route: p.route, from: p.from, to: p.to, sizeXrp: p.sizeXrp, router: p.router || 'router', capturedBy: rec.attribution.capturedBy, bridged: rec.attribution.bridged, explorer: rec.explorer, organic: false });
        return rec;
      };
      for (let i = 0; i < plan.payments.length; i += n) {
        if (run.stopRequested) { run.notes.push(`Stopped early by the operator after ${i} of ${plan.payments.length} payments.`); break; }
        const wait = last ? CAPS.paceMs - (this.now() - last) : 0;
        if (wait > 0) await this.sleep(wait);
        last = this.now();
        const recs = await Promise.all(plan.payments.slice(i, i + n).map(sendOne));
        this.save();
        // Replenish: re-post consumed strategy quotes at the original price and size (Ledger.submit serializes per maker).
        for (const rec of recs) {
          if (rec.status !== 'success') continue;
          for (const [role, strat] of [['maker', ours], ['rival', theirs]]) {
            if (!strat.replenish) continue;
            for (const f of rec.attribution.fills.filter((x) => x.role === role && x.strategy)) {
              if (run.replenished >= maxReplenish) break;
              const q = live[role].get(f.seq);
              if (!q) continue;
              if (f.deleted) untrack(role, f.seq);
              await place(q, f.deleted ? undefined : f.seq);
              run.replenished++;
            }
          }
        }
      }
      run.status = 'cleanup'; // becomes 'done' only after quotes are cancelled and the scorecard is saved
    } catch (e) {
      run.status = 'failed'; run.error = e.message;
      this.bus.publish('pathfinder.run_failed', MODE, { runId: run.id, error: e.message });
    } finally {
      // 5. Cleanup: cancel our and the rival's remaining strategy quotes (unless keepQuotes).
      if (!opts.keepQuotes && state) {
        for (const role of ['maker', 'rival']) for (const seq of [...live[role].keys()]) {
          try { await this.#act(run, { what: `${role} cancels offer ${seq}`, role, tx: { TransactionType: 'OfferCancel', OfferSequence: seq }, amountXrp: 0 }); untrack(role, seq); }
          catch (e) { run.notes.push(`Cleanup cancel of ${role} offer ${seq} failed: ${e.message}`); }
        }
      }
      run.finishedAt = new Date(this.now()).toISOString();
      run.scorecard = scorecard(run);
      if (run.status === 'cleanup') run.status = 'done';
      this.active = null;
      this.save();
      if (run.status === 'done') this.bus.publish('pathfinder.run_done', MODE, { runId: run.id, strategy: opts.strategy, rivalStrategy: opts.rivalStrategy, scorecard: run.scorecard, organic: false });
    }
    return run;
  }

  // Ask a live run to stop sending after its current batch (quotes are still cleaned up). Never signs anything.
  stop(id) { const r = this.get(id); if (r && (r.status === 'running' || r.status === 'queued')) { r.stopRequested = true; return true; } return false; }

  list() { return this.runs.map(({ actions, payments, quotes, budget, ...r }) => ({ ...r, paymentCount: payments?.length || 0 })).reverse(); }
  get(id) { return this.runs.find((x) => x.id === id) || null; }
}
