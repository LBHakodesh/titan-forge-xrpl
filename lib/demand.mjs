// Demand Proof Score (0–100): explainable, weighted, and split by evidence class.
//   organic  — LIVE_TESTNET evidence from accounts we do NOT control (independent demand)
//   demo     — LIVE_TESTNET evidence from our own demo accounts (issuer/maker/taker). Never adoption evidence.
//   sim      — SIMULATION evidence from a scenario model. Never shown as live.
// Nominal market cap and issuer-created volume are never inputs.
import { MODES } from '../public/domain.js';

// Weights sum to 100. `quality` components only count once independent participants exist (activity gate),
// so a token nobody trades cannot earn points for e.g. "no Sentinel findings".
export const COMPONENTS = [
  { id: 'validatedTx', label: 'Validated transactions', weight: 10, quality: false,
    explain: 'Validated ledger transactions touching the token (log scale, saturates at 200).' },
  { id: 'participants', label: 'Independent participating accounts', weight: 20, quality: false,
    explain: 'Distinct accounts holding, quoting or trading the token (saturates at 25).' },
  { id: 'depth', label: 'Verified funded order-book depth', weight: 15, quality: false,
    explain: 'Funded XRP value resting on both sides of the book (sqrt scale, saturates at 5,000 XRP).' },
  { id: 'persistence', label: 'Volume and fill persistence', weight: 15, quality: false,
    explain: 'Half: days with fills in the last 7. Half: 7-day fill volume (saturates at 1,000 XRP).' },
  { id: 'spreadImpact', label: 'Spread and price impact', weight: 10, quality: true,
    explain: 'Half: best bid/ask spread (full at ≤50 bps, zero at ≥2,000 bps). Half: impact of a 100 XRP buy (full ≤25 bps, zero ≥1,000 bps or unfillable).' },
  { id: 'efficiency', label: 'Capital efficiency', weight: 10, quality: true,
    explain: '7-day fill volume ÷ resting depth (turnover; full at 1×).' },
  { id: 'cost', label: 'Reserve and fee cost', weight: 5, quality: true,
    explain: '1 − (reserves locked + fees) ÷ 7-day volume. Zero with no volume.' },
  { id: 'risk', label: 'Issuer and counterparty risk', weight: 10, quality: true,
    explain: '(1 − max(top-holder share, top-counterparty share)) × (1 − issuer flag penalty: clawback, freeze, no DefaultRipple).' },
  { id: 'sentinel', label: 'Sentinel findings', weight: 5, quality: true,
    explain: '1 − (critical×1 + high×0.4 + medium×0.15 + low×0.05). If Sentinel input is absent, this weight is redistributed.' },
];
export const QUALITY_GATE_PARTICIPANTS = 5;
export const REF_TRADE_XRP = 100;

const clamp01 = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const lin = (x, lo, hi) => clamp01((hi - x) / (hi - lo)); // 1 at <=lo, 0 at >=hi

export function emptyEvidence() {
  return { validatedTx: 0, participants: 0, depthXrp: 0, fillDays: 0, volumeXrp: 0, spreadBps: null, impactBps: null,
    costXrp: 0, topHolderShare: 1, topCounterpartyShare: 1, issuerPenalty: 0, sentinel: null };
}

export function normalize(e) {
  const s = e.sentinel;
  return {
    validatedTx: clamp01(Math.log1p(Math.max(0, e.validatedTx)) / Math.log1p(200)),
    participants: clamp01(e.participants / 25),
    depth: clamp01(Math.sqrt(Math.max(0, e.depthXrp) / 5000)),
    persistence: 0.5 * clamp01(e.fillDays / 7) + 0.5 * clamp01(e.volumeXrp / 1000),
    spreadImpact: 0.5 * (e.spreadBps == null ? 0 : lin(e.spreadBps, 50, 2000)) + 0.5 * (e.impactBps == null ? 0 : lin(e.impactBps, 25, 1000)),
    efficiency: e.depthXrp > 0 ? clamp01(e.volumeXrp / e.depthXrp) : 0,
    cost: e.volumeXrp > 0 ? clamp01(1 - e.costXrp / e.volumeXrp) : 0,
    risk: clamp01(1 - Math.max(e.topHolderShare ?? 1, e.topCounterpartyShare ?? 1)) * clamp01(1 - (e.issuerPenalty || 0)),
    sentinel: s ? clamp01(1 - ((s.critical || 0) + 0.4 * (s.high || 0) + 0.15 * (s.medium || 0) + 0.05 * (s.low || 0))) : null,
  };
}

// Score one evidence set. Returns total plus a per-component breakdown that sums to the total.
export function scoreEvidence(e, mode = MODES.LIVE) {
  const n = normalize(e);
  const sentinelAbsent = n.sentinel == null;
  const totalWeight = COMPONENTS.reduce((s, c) => s + (c.id === 'sentinel' && sentinelAbsent ? 0 : c.weight), 0);
  const gate = clamp01(e.participants / QUALITY_GATE_PARTICIPANTS);
  const components = COMPONENTS.map((c) => {
    const absent = c.id === 'sentinel' && sentinelAbsent;
    const weight = absent ? 0 : (c.weight * 100) / totalWeight; // redistribute when Sentinel absent
    const norm = absent ? null : n[c.id];
    const gated = c.quality ? gate : 1;
    const points = absent ? 0 : weight * norm * gated;
    return { id: c.id, label: c.label, weight: +weight.toFixed(2), norm: norm == null ? null : +norm.toFixed(3), gate: c.quality ? +gate.toFixed(2) : null,
      points: +points.toFixed(2), explain: absent ? 'Sentinel input absent — weight redistributed to the other components.' : c.explain };
  });
  const total = Math.round(components.reduce((s, c) => s + c.points, 0) * 10) / 10;
  return { mode, total, gate: +gate.toFixed(2), sentinelPresent: !sentinelAbsent, components, evidence: e };
}

// ---------- LIVE evidence (read-only XRPL calls) ----------
const RIPPLE_EPOCH = 946684800;
const ISSUER_FLAGS = { lsfDefaultRipple: 0x00800000, lsfGlobalFreeze: 0x00400000, lsfAllowTrustLineClawback: 0x80000000 };

export function issuerPenalty(flags = 0) {
  let p = 0;
  if (flags & ISSUER_FLAGS.lsfGlobalFreeze) p = 1;
  if (flags & ISSUER_FLAGS.lsfAllowTrustLineClawback) p = Math.max(p, 0.5);
  if (!(flags & ISSUER_FLAGS.lsfDefaultRipple)) p = Math.max(p, 0.3);
  return p;
}

const drops = (v) => (typeof v === 'string' ? Number(v) / 1e6 : null);

// Pure: classify issuer account_tx entries for one currency into demo/organic tx, fills, volume and days.
export function classifyTxs(entries, code, demoSet, nowMs = Date.now()) {
  const cls = () => ({ txs: 0, accounts: new Set(), fills: 0, volumeXrp: 0, feesXrp: 0, days: new Set(), counterparties: new Map() });
  const out = { demo: cls(), organic: cls() };
  const weekAgo = nowMs - 7 * 86400_000;
  for (const it of entries) {
    const tx = it.tx_json || it.tx || {};
    const meta = it.meta || {};
    if (it.validated === false || typeof meta !== 'object') continue;
    if (!JSON.stringify([tx, meta]).includes(`"currency":"${code}"`)) continue;
    const c = demoSet.has(tx.Account) ? out.demo : out.organic;
    c.txs++; c.accounts.add(tx.Account); c.feesXrp += drops(tx.Fee) || 0;
    const t = it.close_time_iso ? Date.parse(it.close_time_iso) : tx.date != null ? (tx.date + RIPPLE_EPOCH) * 1000 : nowMs;
    let vol = 0; let filled = false;
    for (const n of meta.AffectedNodes || []) {
      const node = n.ModifiedNode || n.DeletedNode;
      if (!node || node.LedgerEntryType !== 'Offer') continue;
      const prev = node.PreviousFields, fin = node.FinalFields || {};
      if (!prev || fin.Account === tx.Account) continue;
      for (const f of ['TakerGets', 'TakerPays']) {
        const a = drops(prev[f]), b = drops(fin[f]);
        if (a != null) vol += a - (b ?? 0);
      }
      filled = true;
      c.counterparties.set(fin.Account, (c.counterparties.get(fin.Account) || 0) + 1);
    }
    if (filled && t >= weekAgo) { c.fills++; c.volumeXrp += vol; c.days.add(new Date(t).toISOString().slice(0, 10)); }
  }
  return out;
}

// Pure: book side summaries by class. `book` is Ledger.book() output.
export function bookStats(book, demoSet, refXrp = REF_TRADE_XRP) {
  const pick = (list, isDemo) => list.filter((o) => demoSet.has(o.account) === isDemo);
  const stats = (isDemo) => {
    const asks = pick(book.asks || [], isDemo).sort((a, b) => a.priceXrp - b.priceXrp);
    const bids = pick(book.bids || [], isDemo).sort((a, b) => b.priceXrp - a.priceXrp);
    const depthXrp = [...asks, ...bids].reduce((s, o) => s + o.qty * o.priceXrp, 0);
    const spreadBps = asks.length && bids.length ? ((asks[0].priceXrp - bids[0].priceXrp) / ((asks[0].priceXrp + bids[0].priceXrp) / 2)) * 10_000 : null;
    let remaining = refXrp, cost = 0, qty = 0;
    for (const o of asks) { const take = Math.min(remaining, o.qty * o.priceXrp); cost += take; qty += take / o.priceXrp; remaining -= take; if (remaining <= 1e-9) break; }
    const impactBps = asks.length && remaining <= 1e-9 ? ((cost / qty - asks[0].priceXrp) / asks[0].priceXrp) * 10_000 : null;
    return { depthXrp, spreadBps, impactBps, offers: asks.length + bids.length, accounts: new Set([...asks, ...bids].map((o) => o.account)) };
  };
  return { demo: stats(true), organic: stats(false) };
}

// Pure: holders from issuer account_lines (balance negative from issuer's side = holder owns tokens).
export function holderStats(lines, code, demoSet) {
  const mk = () => ({ accounts: new Set(), total: 0, top: 0 });
  const out = { demo: mk(), organic: mk() };
  for (const l of lines) {
    if (l.currency !== code) continue;
    const bal = -Number(l.balance);
    if (!(bal > 0)) continue;
    const c = demoSet.has(l.account) ? out.demo : out.organic;
    c.accounts.add(l.account); c.total += bal; c.top = Math.max(c.top, bal);
  }
  return out;
}

export function assembleEvidence({ txs, book, holders, validatedSteps = 0, reserveIncXrp = 0.2, issuerFlags = 0, sentinel = null, isDemo }) {
  const accounts = new Set([...txs.accounts, ...book.accounts, ...holders.accounts]);
  const cpTotal = [...txs.counterparties.values()].reduce((s, x) => s + x, 0);
  const cpTop = Math.max(0, ...txs.counterparties.values());
  return {
    validatedTx: isDemo ? Math.max(txs.txs, validatedSteps) : txs.txs, // recorded launch steps are all demo-signed
    participants: accounts.size,
    depthXrp: +book.depthXrp.toFixed(6),
    fillDays: txs.days.size,
    volumeXrp: +txs.volumeXrp.toFixed(6),
    spreadBps: book.spreadBps == null ? null : +book.spreadBps.toFixed(1),
    impactBps: book.impactBps == null ? null : +book.impactBps.toFixed(1),
    // Reserves we can observe: one owner reserve per resting offer and per holder trustline, plus fees.
    costXrp: +(reserveIncXrp * (book.offers + holders.accounts.size) + txs.feesXrp).toFixed(6),
    topHolderShare: holders.total > 0 ? +(holders.top / holders.total).toFixed(3) : 1,
    topCounterpartyShare: cpTotal > 0 ? +(cpTop / cpTotal).toFixed(3) : 1,
    issuerPenalty: issuerPenalty(issuerFlags),
    sentinel,
  };
}

// Small TTL cache for read-only ledger requests shared across tokens.
export function makeCache(ttlMs = 20_000) {
  const m = new Map();
  return async (key, fn, ttl = ttlMs) => {
    const hit = m.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.v;
    const v = await fn();
    m.set(key, { at: Date.now(), v });
    return v;
  };
}

// Gather LIVE_TESTNET evidence for one launch. Read-only: account_lines, account_tx, account_info, book_offers, tx, server_info.
export async function gatherLiveEvidence(ledger, launch, { cache, sentinel = null } = {}) {
  const c = cache || makeCache();
  const client = ledger.client;
  const demoAccounts = Object.values(ledger.wallets || {}).map((w) => w.address);
  const demoSet = new Set(demoAccounts);
  const issuer = launch.issuer || ledger.wallets.issuer.address;
  const code = launch.code;

  const [lines, txEntries, issuerInfo, book, serverInfo] = await Promise.all([
    c(`lines:${issuer}`, async () => {
      const all = []; let marker;
      for (let i = 0; i < 10; i++) {
        const r = await client.request({ command: 'account_lines', account: issuer, ledger_index: 'validated', limit: 400, marker });
        all.push(...r.result.lines); marker = r.result.marker; if (!marker) break;
      }
      return all;
    }),
    c(`atx:${issuer}`, async () => (await client.request({ command: 'account_tx', account: issuer, limit: 200, ledger_index_min: -1, ledger_index_max: -1 })).result.transactions),
    c(`ainfo:${issuer}`, async () => (await client.request({ command: 'account_info', account: issuer, ledger_index: 'validated' })).result.account_data),
    c(`book:${code}`, () => ledger.book(code)),
    c('server_info', async () => (await client.request({ command: 'server_info' })).result.info, 60_000),
  ]);

  // Validated status of the recorded launch step hashes (immutable once validated: cache for an hour).
  const steps = (launch.steps || []).filter((s) => s.hash);
  const stepStatus = await Promise.all(steps.map((s) => c(`tx:${s.hash}`, async () => {
    try { const r = await client.request({ command: 'tx', transaction: s.hash }); return { key: s.key, hash: s.hash, validated: !!r.result.validated, result: r.result.meta?.TransactionResult, account: (r.result.tx_json || r.result).Account }; }
    catch (e) { return { key: s.key, hash: s.hash, validated: false, error: e.data?.error || e.message }; }
  }, 3600_000)));
  const validatedSteps = stepStatus.filter((s) => s.validated && s.result === 'tesSUCCESS').length;

  const txs = classifyTxs(txEntries, code, demoSet);
  const bs = bookStats(book, demoSet);
  const hs = holderStats(lines, code, demoSet);
  const reserveIncXrp = serverInfo.validated_ledger?.reserve_inc_xrp ?? 0.2;
  const base = { reserveIncXrp, issuerFlags: issuerInfo.Flags, sentinel };
  const demo = assembleEvidence({ txs: txs.demo, book: bs.demo, holders: hs.demo, validatedSteps, isDemo: true, ...base });
  const organic = assembleEvidence({ txs: txs.organic, book: bs.organic, holders: hs.organic, isDemo: false, ...base });
  return {
    mode: MODES.LIVE, at: new Date().toISOString(), code, issuer,
    demoAccounts, organic, demo, stepStatus,
    ledger: { validatedLedger: serverInfo.validated_ledger?.seq, reserveBaseXrp: serverInfo.validated_ledger?.reserve_base_xrp, reserveIncXrp },
    shares: { proprietaryDepthXrp: demo.depthXrp, independentDepthXrp: organic.depthXrp },
    note: organic.participants === 0
      ? 'No independent (non-demo) account has held, quoted or traded this token yet: organic demand is 0. All activity so far was generated by our own demo accounts.'
      : `${organic.participants} independent account(s) observed on the validated ledger.`,
  };
}

// ---------- SIMULATION scenarios ----------
export const SCENARIOS = {
  growth: { label: 'Growth', explain: 'Simulated independent participants arrive and fills persist day after day; independent depth builds, spreads tighten.' },
  fade: { label: 'Fade', explain: 'Simulated demand disappears: participants leave, fills stop, independent providers pull depth, spreads widen.' },
  shock: { label: 'Shock', explain: 'Simulated risk event: Sentinel critical finding, concentrated holder, depth withdrawn, spreads blow out.' },
};

export function newSimState(baseline = emptyEvidence()) {
  return { mode: MODES.SIM, period: 0, participants: baseline.participants || 0, validatedTx: baseline.validatedTx || 0,
    independentDepthXrp: baseline.depthXrp || 0, proprietaryDepthXrp: 500, spreadBps: baseline.spreadBps ?? 2500, impactBps: baseline.impactBps ?? 1500,
    topHolderShare: 0.95, issuerPenalty: baseline.issuerPenalty || 0, sentinel: { critical: 0, high: 0, medium: 0, low: 0 }, periods: [], trajectory: [] };
}

// Advance a sim state by `periods` simulated days of `scenario`. Deterministic (no randomness) so demos and tests repeat.
export function simulate(state, scenario, periods = 7) {
  if (!SCENARIOS[scenario]) throw new Error(`Unknown scenario ${scenario}`);
  const s = structuredClone(state);
  for (let i = 0; i < periods; i++) {
    s.period++;
    let fills = 0, vol = 0;
    if (scenario === 'growth') {
      s.participants += 1 + (s.period % 3 === 0 ? 1 : 0);
      fills = s.participants; vol = s.participants * 3;
      s.independentDepthXrp += 20 + s.participants * 4;
      s.spreadBps = Math.max(30, s.spreadBps * 0.88);
      s.impactBps = Math.max(15, s.impactBps * 0.88);
      s.topHolderShare = Math.max(0.08, s.topHolderShare * 0.94);
      if (s.sentinel.critical > 0 && i === periods - 1) s.sentinel.critical--; // remediation over time
      s.sentinel.high = Math.max(0, s.sentinel.high - (i % 3 === 2 ? 1 : 0));
    } else if (scenario === 'fade') {
      s.participants = Math.floor(s.participants * 0.6);
      fills = Math.floor(s.participants * 0.1); vol = fills * 3;
      s.independentDepthXrp *= 0.5;
      s.spreadBps = Math.min(3000, s.spreadBps * 1.6);
      s.impactBps = Math.min(3000, s.impactBps * 1.6);
    } else if (scenario === 'shock') {
      if (i === 0) { s.sentinel.critical += 1; s.sentinel.high += 2; s.topHolderShare = Math.max(0.6, s.topHolderShare); }
      s.participants = Math.floor(s.participants * 0.75);
      fills = Math.floor(s.participants * 0.2); vol = fills * 4;
      s.independentDepthXrp *= 0.3;
      s.spreadBps = 2500; s.impactBps = Math.min(3000, s.impactBps * 2 + 200);
    }
    s.validatedTx += fills * 2 + (scenario === 'growth' ? s.participants : 0);
    s.periods.push({ period: s.period, fills, volumeXrp: vol });
    if (s.periods.length > 28) s.periods.shift();
    s.lastScenario = scenario;
    s.trajectory.push({ period: s.period, scenario, score: scoreEvidence(simEvidence(s), MODES.SIM).total });
    if (s.trajectory.length > 60) s.trajectory.shift();
  }
  return s;
}

export function simEvidence(s) {
  const week = s.periods.slice(-7);
  const volumeXrp = week.reduce((a, p) => a + p.volumeXrp, 0);
  const depthXrp = s.independentDepthXrp; // proprietary Titan Ghost anchor depth is not demand evidence
  return {
    validatedTx: s.validatedTx, participants: s.participants, depthXrp: +depthXrp.toFixed(2),
    fillDays: week.filter((p) => p.fills > 0).length, volumeXrp,
    spreadBps: +s.spreadBps.toFixed(1), impactBps: +s.impactBps.toFixed(1),
    costXrp: +(0.2 * (s.participants + 2) * 0.1 + week.reduce((a, p) => a + p.fills, 0) * 0.000012).toFixed(4),
    topHolderShare: +s.topHolderShare.toFixed(3), topCounterpartyShare: s.participants > 0 ? +Math.max(0.05, 1 / Math.max(1, s.participants / 2)).toFixed(3) : 1,
    issuerPenalty: s.issuerPenalty, sentinel: s.sentinel,
  };
}

export function independentShare(proprietaryXrp, independentXrp) {
  const t = proprietaryXrp + independentXrp;
  return t > 0 ? independentXrp / t : 0;
}
