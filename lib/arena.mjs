// Titan Arena — Bootstrap Challenge. Pure game engine: seeded RNG + state reducer + scoring.
// Everything here is SIMULATION (Titan Ghost application logic running on illustrative demo
// parameters). The only LIVE_TESTNET facts are those of a real launched token the player links,
// which the route resolves from the launch store and passes in; this module never touches the network.
// Scoring rewards informed decisions, verifiable participation and responsible risk management.
// It never takes the simulated price into account.
import { MARKETS, RINGS, PROFILES, TIERS, MODES, priceImpactBps } from '../public/domain.js';
import { getEngine } from './engine/index.mjs';
import { guardCheck } from './guardian.mjs';
import { validateLaunch } from './validate.mjs';

export class ArenaError extends Error {}
const fail = (msg) => { throw new ArenaError(msg); };

export const STEPS = [
  { id: 'project', label: 'Name your project' },
  { id: 'market', label: 'Pick a market' },
  { id: 'spoke', label: 'Open the XRP spoke' },
  { id: 'recruit', label: 'Recruit liquidity' },
  { id: 'observe', label: 'Watch trading' },
  { id: 'assess', label: 'Spot the risks' },
  { id: 'promote', label: 'Corridor decision' },
  { id: 'compare', label: 'Compare markets' },
  { id: 'quiz', label: 'Who validates what?' },
  { id: 'debrief', label: 'Debrief' },
];
export const ROUNDS = 5;
export const REF_TRADE_USD = 2_000; // typical order (randomized 0.5x–1.5x per round)
export const SHOCK_USD = 150_000; // block trade in the shock round
export const CAPITAL_OPTIONS = [1_000, 10_000, 100_000, 1_000_000];
export const MAX_LPS = 5;
export const MAX_CUSTOM = 2;
export const SPREADS = {
  tight: { ringsActive: 2, label: 'Tight', bps: '5–15 bps', tradeoff: 'Catches the most small trades, but all depth sits in two inner rings: a big order can blow through it.' },
  balanced: { ringsActive: 3, label: 'Balanced', bps: '5–40 bps', tradeoff: 'Good flow capture plus a core earning band. A sensible default for a new spoke.' },
  wide: { ringsActive: 4, label: 'Wide', bps: '5–100 bps', tradeoff: 'Absorbs larger tickets and shocks, but outer rings fill rarely, so capital earns less per dollar.' },
};
export const RISKS = [
  { id: 'concentration', label: 'Concentration', hint: 'One participant provides more than half the capital.' },
  { id: 'unfunded', label: 'Unfunded offers', hint: 'Depth shown in the book that is not backed by balances.' },
  { id: 'wash', label: 'Wash activity', hint: 'Self-trading that inflates volume without real demand.' },
  { id: 'issuer_controls', label: 'Issuer controls', hint: 'The issuer can freeze, claw back or gate holders.' },
  { id: 'idle_capital', label: 'Idle capital', hint: 'Money committed but not earning (marginal yield below hurdle).' },
  { id: 'thin_depth', label: 'Thin depth', hint: 'Typical trades move the price a lot or block trades cannot fill.' },
];
export const EFFICIENCY = {
  add: 'Add more capital',
  hold: 'Hold steady',
  rebalance: 'Rebalance: trim or redeploy idle capital',
};
export const CATEGORIES = { xrpl: 'XRPL validates on-ledger', titan: 'Titan Ghost application logic', xdlc: 'XDLC proposal (not live)' };
const QUIZ_POOL = [
  { id: 'q_offer', cat: 'xrpl', text: 'A signed OfferCreate transaction included in a validated ledger', why: 'Consensus validates signatures, sequence and fees, then applies the transaction.' },
  { id: 'q_trust', cat: 'xrpl', text: 'A trustline balance between a holder and the token issuer', why: 'RippleState entries in the ledger hold issued-token balances.' },
  { id: 'q_book', cat: 'xrpl', text: 'Offers resting in the XRPL order book', why: 'Offer objects live in the ledger; anyone can query book_offers.' },
  { id: 'q_fill', cat: 'xrpl', text: 'A fill (offer crossing) recorded in transaction metadata', why: 'The ledger records exactly which offers were consumed and balances changed.' },
  { id: 'q_reserve', cat: 'xrpl', text: 'The XRP reserve an account must hold for each trustline or offer', why: 'Reserves are enforced by the protocol for every owned ledger object.' },
  { id: 'q_bridge', cat: 'xrpl', text: 'XRP auto-bridging between two issued tokens', why: 'The payment engine routes through XRP books automatically: an existing XRPL feature.' },
  { id: 'q_stage', cat: 'titan', text: "A token's corridor stage (spoke, reinforced spoke, corridor)", why: 'Corridor lifecycle is Titan Ghost application logic. The ledger has no idea what a corridor is.' },
  { id: 'q_score', cat: 'titan', text: 'Your Arena score and Demand Proof-style evidence scores', why: 'Scores are computed off-ledger by the application from data and rules.' },
  { id: 'q_capital', cat: 'titan', text: 'The simulated LP capital in this game', why: 'Simulated capital never touches the ledger. It is labeled SIMULATION.' },
  { id: 'q_recs', cat: 'titan', text: 'Capital reallocation recommendations', why: 'Recommendations are application intelligence (today a temporary demo adapter).' },
  { id: 'q_rings', cat: 'titan', text: 'The six-ring allocation of capital', why: 'Ring allocation is a strategy decision made by the application, not a ledger rule.' },
  { id: 'q_xdlc', cat: 'xdlc', text: 'Native dynamic liquidity corridors enforced by the protocol', why: 'XDLC is a proposed XRPL amendment. It is not live on XRPL today.' },
  { id: 'q_xdlc2', cat: 'xdlc', text: 'A corridor stage recognized by validators as a ledger object', why: 'Only the XDLC proposal describes this. Today validators know nothing of corridor stages.' },
];

// ---------- Seeded RNG (FNV-1a hash + mulberry32) ----------
export function hashSeed(s) {
  let h = 2166136261 >>> 0;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function rng(seed, ...salt) {
  let a = hashSeed([seed, ...salt].join('|'));
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, r) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export function normalizeSeed(seed) {
  if (seed == null || seed === '') return null;
  if (typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 32) return seed;
  if (typeof seed === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(seed)) return /^\d{1,9}$/.test(seed) ? Number(seed) : seed;
  fail('Seed must be a whole number or up to 32 letters, digits, - or _.');
}

export function validateAlias(alias) {
  const a = String(alias ?? '').trim();
  if (!a) return { ok: true, value: '' };
  const v = validateLaunch({ name: 'Arena', code: 'ARN', supply: 1000, category: 'community', consent: true, alias: a });
  if (v.ok) return { ok: true, value: v.value.alias };
  return { ok: false, errors: v.errors };
}

// ---------- Scenario ----------
const PITCHES = {
  adv_retail: 'Experienced trader: will quote from their own wallet.',
  pro_mm: 'Professional market maker: runs disciplined two-sided quotes.',
  family_office: 'Family office: patient capital, wants steady yield.',
  institutional: 'Institution: very large ticket, wants to be the anchor LP.',
};
function buildScenario(seed) {
  const r = rng(seed, 'scenario');
  const issuer = { requireAuth: r() < 0.25, freeze: r() < 0.35, clawback: r() < 0.4 };
  const genuinePool = ['adv_retail', 'pro_mm', 'pro_mm', 'family_office', 'institutional'];
  const picks = shuffle(genuinePool, r).slice(0, 3);
  if (!picks.includes('pro_mm')) picks[0] = 'pro_mm'; // a balanced path is always possible
  const tierIds = TIERS.map((t) => t.id);
  const genuine = picks.map((profileId) => {
    const p = PROFILES.find((x) => x.id === profileId);
    return { kind: 'genuine', profileId, tier: tierIds[Math.floor(r() * tierIds.length)], capitalUsd: p.capitalUsd, verifiable: true, pitch: PITCHES[profileId] };
  });
  const pledge = { kind: 'pledge', profileId: 'pro_mm', tier: 'T1', capitalUsd: 0, claimedUsd: 500_000, verifiable: false,
    pitch: 'Instant $500k of depth! Offers go up today; the funding arrives "later".' };
  const wash = { kind: 'wash', profileId: 'adv_retail', tier: 'T1', capitalUsd: 0, verifiable: false,
    pitch: 'Volume Booster: we trade back and forth between our own two accounts so your token shows 10x volume.' };
  const offers = shuffle([...genuine, pledge, wash], r).map((o, i) => ({ id: `o${i + 1}`, ...o }));
  const shockRound = 1 + Math.floor(r() * 3); // 0-based round index 1..3
  const xr = shuffle(QUIZ_POOL.filter((q) => q.cat === 'xrpl'), r).slice(0, 3);
  const ti = shuffle(QUIZ_POOL.filter((q) => q.cat === 'titan'), r).slice(0, 2);
  const xd = shuffle(QUIZ_POOL.filter((q) => q.cat === 'xdlc'), r).slice(0, 1);
  const quiz = shuffle([...xr, ...ti, ...xd], r).map((q) => q.id);
  return { issuer, offers, shockRound, quiz };
}

export function createSession({ id = 'local', seed = 1, alias = '', now = null } = {}) {
  const s = normalizeSeed(seed);
  if (s == null) fail('Seed required.');
  const al = validateAlias(alias);
  if (!al.ok) fail(al.errors.join(' '));
  return {
    v: 1, id, seed: s, alias: al.value, mode: MODES.SIM, step: 'project', createdAt: now, completedAt: null,
    engineLabel: getEngine().info().label,
    scenario: buildScenario(s),
    project: null, marketId: null, spoke: null, lps: [], excluded: [], rounds: [],
    assessment: null, gate: null, promotion: null, comparison: null, quiz: null, score: null, debrief: null,
    guardian: [], history: [],
  };
}

// ---------- Simulation ----------
function lpCapital(lps, excluded = []) { return lps.filter((l) => l.kind === 'genuine' && !excluded.includes(l.id)).reduce((s, l) => s + l.capitalUsd, 0); }

// One simulated trading round (a "day"). cfg: { spokeUsd, ringsActive, lps, excluded, shockRound, mid }
export function simulateRound(cfg, i, seed, engine = getEngine(), salt = 'round') {
  const r = rng(seed, salt, i);
  const flowScale = 0.6 + 0.8 * r();
  const shock = i === cfg.shockRound;
  const active = cfg.lps.filter((l) => !(cfg.excluded || []).includes(l.id));
  const withdrawn = shock ? active.filter((l) => l.kind === 'genuine' && l.tier === 'T1' && r() < 0.6).map((l) => l.id) : [];
  const genuine = active.filter((l) => l.kind === 'genuine' && !withdrawn.includes(l.id));
  const capitalUsd = cfg.spokeUsd + genuine.reduce((s, l) => s + l.capitalUsd, 0);
  const pledgedUsd = active.filter((l) => l.kind === 'pledge').reduce((s, l) => s + l.claimedUsd, 0);
  const washOn = active.some((l) => l.kind === 'wash');
  const opts = { flowScale, ringsActive: cfg.ringsActive };
  const alloc = engine.allocate(capitalUsd, opts);
  const shown = pledgedUsd > 0 ? engine.allocate(capitalUsd + pledgedUsd, opts) : alloc;
  const tradeUsd = shock ? SHOCK_USD : Math.round(REF_TRADE_USD * (0.5 + r()));
  const imp = priceImpactBps(tradeUsd, alloc.rings);
  const exhausted = !Number.isFinite(imp);
  const fillRatio = exhausted ? Math.min(1, alloc.deployedUsd / tradeUsd) : 1;
  const trades = Math.round((4 + r() * 6) * flowScale);
  const fills = alloc.deployedUsd >= REF_TRADE_USD ? trades : 0;
  const volumeUsd = Math.round(fills * REF_TRADE_USD * (0.5 + r()) + (shock ? tradeUsd * fillRatio : 0));
  const washFills = washOn ? fills * 10 + 5 : 0;
  const washVolumeUsd = washOn ? Math.max(volumeUsd, REF_TRADE_USD) * 10 : 0;
  const midXrp = cfg.mid * (1 + (r() - 0.5) * 0.03 + (washOn ? 0.01 : 0)); // shown, never scored
  const activeRings = alloc.rings;
  return {
    round: i + 1, mode: MODES.SIM, flowScale: +flowScale.toFixed(3), shock, tradeUsd, impactBps: exhausted ? null : imp, exhausted, fillRatio: +fillRatio.toFixed(3),
    fills, volumeUsd, washFills, washVolumeUsd, displayedVolumeUsd: volumeUsd + washVolumeUsd, phantomDepthUsd: pledgedUsd, withdrawnLps: withdrawn,
    capitalUsd, deployedUsd: Math.round(alloc.deployedUsd), idleUsd: Math.round(alloc.idleUsd), dailyEarnUsd: +alloc.dailyEarnUsd.toFixed(2),
    marginalBps: +Math.max(0, ...activeRings.map((x) => x.marginalBps)).toFixed(3),
    rings: RINGS.map((spec) => {
      const a = activeRings.find((x) => x.id === spec.id); const sh = shown.rings.find((x) => x.id === spec.id);
      return { id: spec.id, active: !!a, allocUsd: a ? Math.round(a.allocUsd) : 0, shownUsd: sh ? Math.round(sh.allocUsd) : 0, utilization: a ? +a.utilization.toFixed(3) : 0 };
    }),
    midXrp: +midXrp.toFixed(6),
  };
}

function median(xs) { if (!xs.length) return null; const a = xs.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }

// Metrics over a set of rounds and a participant list. Price (midXrp) is deliberately absent.
export function metrics({ rounds, spokeUsd, lps, excluded = [], issuer }) {
  const normal = rounds.filter((r) => !r.shock);
  const shockR = rounds.find((r) => r.shock);
  const caps = [spokeUsd, ...lps.filter((l) => l.kind === 'genuine').map((l) => l.capitalUsd)];
  const total = caps.reduce((s, x) => s + x, 0);
  const maxShare = total ? Math.max(...caps) / total : 1;
  const idlePct = rounds.length ? rounds.reduce((s, r) => s + (r.capitalUsd ? r.idleUsd / r.capitalUsd : 0), 0) / rounds.length : 0;
  return {
    mode: MODES.SIM,
    totalCapitalUsd: total,
    verifiableLps: lps.filter((l) => l.kind === 'genuine' && l.verifiable).length,
    tiers: [...new Set(lps.filter((l) => l.kind === 'genuine').map((l) => l.tier))],
    maxShare: +maxShare.toFixed(3),
    medianImpactBps: median(normal.map((r) => (r.exhausted ? 10_000 : r.impactBps))),
    shockFillRatio: shockR ? shockR.fillRatio : null,
    fills: rounds.reduce((s, r) => s + r.fills, 0),
    volumeUsd: rounds.reduce((s, r) => s + r.volumeUsd, 0),
    washFills: rounds.reduce((s, r) => s + r.washFills, 0),
    pledgedUsd: lps.filter((l) => l.kind === 'pledge').reduce((s, l) => s + l.claimedUsd, 0),
    unfundedActive: lps.some((l) => l.kind === 'pledge' && !excluded.includes(l.id)),
    washActive: lps.some((l) => l.kind === 'wash' && !excluded.includes(l.id)),
    idlePct: +idlePct.toFixed(3),
    avgDailyEarnUsd: rounds.length ? +(rounds.reduce((s, r) => s + r.dailyEarnUsd, 0) / rounds.length).toFixed(2) : 0,
    lastMarginalBps: rounds.length ? rounds[rounds.length - 1].marginalBps : null,
    issuerControls: !!issuer && Object.values(issuer).some(Boolean),
  };
}

// Ground truth for the risk step, derived only from the session's facts.
export function riskTruth(state) {
  const m = metrics(sessionInputs(state));
  return {
    concentration: m.maxShare > 0.5,
    unfunded: m.pledgedUsd > 0,
    wash: state.lps.some((l) => l.kind === 'wash'),
    issuer_controls: issuerOf(state).present,
    idle_capital: m.idlePct > 0.15,
    thin_depth: (m.medianImpactBps ?? 10_000) > 40 || (m.shockFillRatio ?? 0) < 0.5,
  };
}
export function efficiencyTruth(state) {
  const t = riskTruth(state);
  return t.idle_capital ? 'rebalance' : t.thin_depth ? 'add' : 'hold';
}

function issuerOf(state) {
  if (state.project?.linked) return { present: true, flags: ['single-party demo issuer'], note: 'Linked token: the issuer is a Titan Forge demo account. One party controls issuance, so disclose it.' };
  const f = state.scenario.issuer;
  const flags = [f.requireAuth && 'RequireAuth (issuer must approve trustlines)', f.freeze && 'Freeze not disabled (issuer can freeze trustlines)', f.clawback && 'Clawback enabled (issuer can claw back tokens)'].filter(Boolean);
  return { present: flags.length > 0, flags, note: flags.length ? 'The issuer account keeps control settings.' : 'NoFreeze set, no clawback, open trustlines.' };
}
function sessionInputs(state) { return { rounds: state.rounds, spokeUsd: state.spoke?.capitalUsd || 0, lps: state.lps, excluded: state.excluded, issuer: state.project?.linked ? { demoIssuer: true } : state.scenario.issuer }; }

// Demand Proof-like promotion gate (simulated evidence). Returns checks and what's missing.
export function evaluateGate(state) {
  const m = metrics(sessionInputs(state));
  const disclosed = !issuerOf(state).present || (state.assessment?.flags || []).includes('issuer_controls');
  const checks = [
    { id: 'lps', label: 'At least 2 independent, verifiable LPs besides you', ok: m.verifiableLps >= 2, detail: `${m.verifiableLps} verifiable LPs` },
    { id: 'concentration', label: 'No participant above 50% of capital', ok: m.maxShare <= 0.5, detail: `largest share ${(m.maxShare * 100).toFixed(0)}%` },
    { id: 'unfunded', label: 'No unfunded pledged depth counted', ok: !m.unfundedActive, detail: m.unfundedActive ? `$${m.pledgedUsd.toLocaleString('en-US')} pledged depth still counted` : 'none counted' },
    { id: 'wash', label: 'No wash volume counted', ok: !m.washActive, detail: m.washActive ? `${m.washFills} wash fills still counted` : 'none counted' },
    { id: 'impact', label: 'Typical trade impact at most 40 bps', ok: (m.medianImpactBps ?? 10_000) <= 40, detail: m.medianImpactBps >= 10_000 ? 'typical trades could not fill' : `median ${m.medianImpactBps} bps` },
    { id: 'shock', label: 'Block trade at least 50% filled', ok: (m.shockFillRatio ?? 0) >= 0.5, detail: `${Math.round((m.shockFillRatio ?? 0) * 100)}% of $${SHOCK_USD.toLocaleString('en-US')}` },
    { id: 'fills', label: 'At least 15 independent simulated fills', ok: m.fills >= 15, detail: `${m.fills} fills (wash excluded)` },
    { id: 'issuer', label: 'Issuer controls disclosed when present', ok: disclosed, detail: issuerOf(state).present ? (disclosed ? 'disclosed' : 'not disclosed') : 'none present' },
  ];
  return { mode: MODES.SIM, eligible: checks.every((c) => c.ok), checks, missing: checks.filter((c) => !c.ok).map((c) => c.label),
    note: 'Simulated evidence. A real Demand Proof needs on-ledger fills from independent accounts, and demo-account activity never counts as organic demand.' };
}

// Reference markets, same seed, fixed configurations.
export const REFERENCES = {
  reinforced: { label: 'Well-reinforced corridor', spokeUsd: 250_000, ringsActive: 6, issuer: {},
    lps: [['pro_mm', 'T1'], ['pro_mm', 'T2'], ['family_office', 'T2'], ['adv_retail', 'T1'], ['family_office', 'T3']] },
  underfunded: { label: 'Underfunded / unstable market', spokeUsd: 1_000, ringsActive: 2, issuer: { clawback: true },
    lps: [['pledge'], ['wash']] },
};
function refLps(def) {
  return def.lps.map(([p, tier], i) => (p === 'pledge' ? { id: `r${i}`, kind: 'pledge', claimedUsd: 500_000, capitalUsd: 0, verifiable: false }
    : p === 'wash' ? { id: `r${i}`, kind: 'wash', capitalUsd: 0, verifiable: false }
      : { id: `r${i}`, kind: 'genuine', profileId: p, tier, capitalUsd: PROFILES.find((x) => x.id === p).capitalUsd, verifiable: true }));
}
export function runReference(key, seed, shockRound, mid, engine = getEngine()) {
  const def = REFERENCES[key];
  const lps = refLps(def);
  const cfg = { spokeUsd: def.spokeUsd, ringsActive: def.ringsActive, lps, excluded: [], shockRound, mid };
  const rounds = Array.from({ length: ROUNDS }, (_, i) => simulateRound(cfg, i, seed, engine, `ref-${key}`));
  return { key, label: def.label, mode: MODES.SIM, ringsActive: def.ringsActive, metrics: metrics({ rounds, spokeUsd: def.spokeUsd, lps, issuer: def.issuer }), lastRings: rounds[rounds.length - 1].rings };
}

// ---------- Scoring (no price input, ever) ----------
export function computeScore(state) {
  const truth = riskTruth(state);
  const m = metrics(sessionInputs(state));
  const cats = [];
  const item = (label, pts, max, why) => ({ label, pts, max, why });

  // Informed decisions (35)
  const sp = state.spoke?.preview || {};
  const inf = [
    item('Spoke sized efficiently', sp.idlePct <= 0.25 ? 5 : 0, 5, sp.idlePct <= 0.25 ? 'Little of your own capital sat idle.' : 'Much of your spoke capital would sit idle at those rings.'),
    item('Spoke absorbs a typical trade', sp.typicalImpactBps != null && sp.typicalImpactBps <= 40 ? 5 : 0, 5, sp.typicalImpactBps != null && sp.typicalImpactBps <= 40 ? `A $${REF_TRADE_USD.toLocaleString('en-US')} order moves price ${sp.typicalImpactBps} bps.` : 'Your spoke alone could not fill a typical order tightly.'),
    item('Efficiency call', state.assessment?.efficiency === efficiencyTruth(state) ? 10 : 0, 10, `Best call here: "${EFFICIENCY[efficiencyTruth(state)]}". You chose "${EFFICIENCY[state.assessment?.efficiency] || '-'}".`),
  ];
  const g = state.gate || { eligible: false };
  const req = !!state.promotion?.requested;
  const promoPts = g.eligible ? (req ? 10 : 5) : (req ? 0 : 10);
  inf.push(item('Promotion decision', promoPts, 10, g.eligible ? (req ? 'Evidence was complete and you requested promotion.' : 'Evidence was complete; requesting would have been justified.') : (req ? 'You requested promotion while evidence was missing.' : 'You held back until the evidence is there.')));
  inf.push(item('Compared against reference markets', state.comparison?.reviewed ? 5 : 0, 5, 'Benchmarking before you celebrate.'));
  cats.push({ id: 'informed', label: 'Informed decisions', items: inf });

  // Verifiable participation (25)
  const linked = !!state.project?.linked;
  cats.push({ id: 'verifiable', label: 'Verifiable participation', items: [
    item('Verifiable LPs', Math.min(15, m.verifiableLps * 5), 15, `${m.verifiableLps} LPs quoting from their own accounts (checkable on-ledger).`),
    item('Tier diversity', m.tiers.length >= 2 ? 5 : 0, 5, m.tiers.length >= 2 ? `Tiers ${m.tiers.join(', ')}: funding arrangements differ independent of size.` : 'Only one funding tier, so all LPs react to stress the same way.'),
    item('Real Testnet token linked', linked ? 5 : 0, 5, linked ? 'Your token, trustlines and fill are verifiable on XRPL Testnet.' : 'Optional: launch a real Testnet token and link it.'),
  ] });

  // Responsible risk management (30)
  const flags = state.assessment?.flags || [];
  const ident = RISKS.map((rk) => {
    const present = truth[rk.id], said = flags.includes(rk.id);
    return item(`${rk.label}: ${present ? 'present' : 'absent'}`, present === said ? 3 : 0, 3, present === said ? (present ? 'Correctly flagged.' : 'Correctly not flagged.') : (present ? 'Missed this risk.' : 'Flagged a risk that was not there.'));
  });
  const trap = (kind, label) => {
    const took = state.lps.some((l) => l.kind === kind);
    const excl = took && state.lps.filter((l) => l.kind === kind).every((l) => state.excluded.includes(l.id));
    return item(label, !took ? 6 : excl ? 3 : 0, 6, !took ? 'Declined it.' : excl ? 'Accepted it, then excluded it from the evidence.' : 'Accepted it and kept counting it.');
  };
  cats.push({ id: 'risk', label: 'Responsible risk management', items: [...ident, trap('wash', 'Avoided wash volume'), trap('pledge', 'Avoided unfunded pledged depth')] });

  // Understanding (10)
  const qa = state.quiz?.results || [];
  const correct = qa.filter((q) => q.correct).length;
  cats.push({ id: 'understanding', label: 'What XRPL validates', items: [item('Quiz', qa.length ? Math.round((10 * correct) / qa.length) : 0, 10, `${correct} of ${qa.length} correct.`)] });

  for (const c of cats) { c.pts = c.items.reduce((s, x) => s + x.pts, 0); c.max = c.items.reduce((s, x) => s + x.max, 0); }
  const total = cats.reduce((s, c) => s + c.pts, 0);
  const max = cats.reduce((s, c) => s + c.max, 0);
  return { mode: MODES.SIM, total, max, categories: cats,
    notScored: [{ label: 'Price appreciation', pts: 0, why: 'Never scored. A rising simulated price says nothing about market quality, and chasing it rewards speculation.' },
      { label: 'Displayed volume', pts: 0, why: 'Not scored. Volume is easy to fake; independent fills and depth are what count.' }] };
}

function buildDebrief(state) {
  const m = metrics(sessionInputs(state));
  const t = riskTruth(state);
  const out = [];
  if (t.wash) out.push('Wash volume made your market look busy. Explorers showed the volume, but none of it was demand. Real Demand Proof ignores it.');
  if (t.unfunded) out.push('The pledged depth was unfunded. On XRPL an offer without balance behind it stays visible but is skipped or removed when crossed, so the depth vanished when it was needed.');
  if (t.concentration) out.push(`One participant held ${(m.maxShare * 100).toFixed(0)}% of capital. If they leave, the market goes with them.`);
  if (t.idle_capital) out.push(`About ${(m.idlePct * 100).toFixed(0)}% of capital sat idle: marginal yield fell below the hurdle. More money is not always better.`);
  if (t.thin_depth) out.push('Depth was thin: typical or block trades moved the price a lot or could not fill.');
  if (state.lps.some((l) => l.kind === 'genuine' && l.tier === 'T1') && state.rounds.some((r) => r.withdrawnLps.length)) out.push('Tier 1 (uncommitted) liquidity left during the shock. Committed tiers (T2/T3) are what hold depth under stress.');
  if (state.promotion?.requested && !state.gate?.eligible) out.push('Corridor promotion was refused: the gate checks evidence, not ambition.');
  if (state.promotion?.granted) out.push('Promotion granted (simulated). Corridor stage is Titan Ghost application logic; XRPL itself only sees offers, trustlines and fills.');
  if (state.project?.linked) out.push(`Your ${state.project.linked.code} token is real on XRPL Testnet. Its launch fill came from a demo counterparty, so it proves the mechanics, not organic demand.`);
  if (!out.length) out.push('Clean run: verifiable LPs, honest depth and evidence-based decisions.');
  out.push('Your score never included price. Good markets are built on depth, verifiable participants and honest evidence.');
  return out;
}

// ---------- Reducer ----------
const clone = (x) => structuredClone(x);
function need(state, step) { if (state.step !== step) fail(`Action not allowed now: current step is "${state.step}", expected "${step}".`); }
function next(state) { const i = STEPS.findIndex((x) => x.id === state.step); state.step = STEPS[Math.min(i + 1, STEPS.length - 1)].id; }
function guard(state, label, p) {
  const v = guardCheck({ mode: MODES.SIM, ...p });
  state.guardian.push({ label, ...v, mode: MODES.SIM });
  if (!v.allowed) fail(`Guardian blocked: ${v.reasons.join(' ')}`);
}

// applyAction(state, action, { engine, launch, now }) -> new state. `launch` is a resolved live launch record (link only).
export function applyAction(prev, action, { engine = getEngine(), launch = null, now = null } = {}) {
  if (!action || typeof action.type !== 'string') fail('Action type required.');
  const state = clone(prev);
  const t = action.type;
  if (state.step === 'debrief' && t !== 'alias') fail('Game finished. Start a new session to play again.');

  switch (t) {
    case 'name': {
      need(state, 'project');
      const v = validateLaunch({ name: action.name, code: action.code, supply: 1_000_000, category: action.category, consent: true });
      if (!v.ok) fail(v.errors.join(' '));
      state.project = { mode: MODES.SIM, name: v.value.name, code: v.value.code, category: v.value.category, linked: null };
      break;
    }
    case 'link': {
      need(state, 'project');
      if (!launch || launch.status !== 'live') fail('Choose a live Testnet token from the launch list.');
      const txs = (launch.steps || []).filter((s) => s.hash).map((s) => ({ key: s.key, label: s.label, hash: s.hash, result: s.result, ledger: s.ledger, explorer: s.explorer }));
      state.project = { mode: MODES.SIM, name: launch.name, code: launch.code, category: launch.category,
        linked: { mode: MODES.LIVE, launchId: launch.id, code: launch.code, name: launch.name, issuer: launch.issuer, fillHash: launch.fillHash, organic: false,
          txs, book: action.book || launch.book || null, bookMode: action.bookMode || MODES.REPLAY } };
      break;
    }
    case 'market': {
      need(state, 'market');
      if (!MARKETS.some((m) => m.id === action.marketId)) fail('Unknown market.');
      state.marketId = action.marketId;
      break;
    }
    case 'spoke': {
      need(state, 'spoke');
      const cap = Number(action.capitalUsd);
      if (!CAPITAL_OPTIONS.includes(cap)) fail(`Starting capital must be one of ${CAPITAL_OPTIONS.join(', ')} USD.`);
      const sp = SPREADS[action.spread];
      if (!sp) fail('Spread must be tight, balanced or wide.');
      guard(state, 'Open simulated XRP spoke', { amountUsd: cap, marketId: state.marketId });
      const a = engine.allocate(cap, { ringsActive: sp.ringsActive });
      const imp = priceImpactBps(REF_TRADE_USD, a.rings);
      state.spoke = { mode: MODES.SIM, capitalUsd: cap, spread: action.spread, ringsActive: sp.ringsActive,
        preview: { deployedUsd: Math.round(a.deployedUsd), idleUsd: Math.round(a.idleUsd), idlePct: +(a.idleUsd / cap).toFixed(3), dailyEarnUsd: +a.dailyEarnUsd.toFixed(2), typicalImpactBps: Number.isFinite(imp) ? imp : null } };
      break;
    }
    case 'recruit': {
      need(state, 'recruit');
      const accept = Array.isArray(action.accept) ? action.accept : [];
      const custom = Array.isArray(action.custom) ? action.custom : [];
      if (new Set(accept).size !== accept.length) fail('Duplicate offer.');
      if (custom.length > MAX_CUSTOM) fail(`At most ${MAX_CUSTOM} simulated LPs.`);
      if (accept.length + custom.length > MAX_LPS) fail(`At most ${MAX_LPS} LPs in total.`);
      const lps = accept.map((id) => { const o = state.scenario.offers.find((x) => x.id === id); if (!o) fail(`Unknown offer ${id}.`); return { ...o, source: 'offer' }; });
      custom.forEach((c, i) => {
        const p = PROFILES.find((x) => x.id === c?.profileId); if (!p) fail('Unknown participant profile.');
        if (!TIERS.some((x) => x.id === c.tier)) fail('Tier must be T1, T2 or T3.');
        lps.push({ id: `c${i + 1}`, kind: 'genuine', source: 'custom', profileId: p.id, tier: c.tier, capitalUsd: p.capitalUsd, verifiable: true, pitch: 'Simulated LP you recruited.' });
      });
      const add = lpCapital(lps);
      if (add > 0) guard(state, 'Add simulated LP capital', { amountUsd: add, marketId: state.marketId });
      state.lps = lps;
      break;
    }
    case 'round': case 'rounds': {
      need(state, 'observe');
      const mid = MARKETS.find((m) => m.id === state.marketId).refPriceXrp;
      const cfg = { spokeUsd: state.spoke.capitalUsd, ringsActive: state.spoke.ringsActive, lps: state.lps, excluded: [], shockRound: state.scenario.shockRound };
      const n = t === 'round' ? 1 : ROUNDS - state.rounds.length;
      for (let k = 0; k < n; k++) {
        const i = state.rounds.length;
        const last = state.rounds[i - 1];
        state.rounds.push(simulateRound({ ...cfg, mid: last ? last.midXrp : mid }, i, state.seed, engine));
      }
      if (state.rounds.length < ROUNDS) { state.history.push({ type: t }); return state; }
      break;
    }
    case 'assess': {
      need(state, 'assess');
      const flags = Array.isArray(action.flags) ? action.flags : [];
      if (flags.some((f) => !RISKS.some((r) => r.id === f)) || new Set(flags).size !== flags.length) fail('Unknown or duplicate risk flag.');
      if (!EFFICIENCY[action.efficiency]) fail('Choose an efficiency decision: add, hold or rebalance.');
      state.assessment = { flags, efficiency: action.efficiency, truth: riskTruth(state), efficiencyTruth: efficiencyTruth(state) };
      // Flagging unfunded / wash excludes them from the evidence (responsible mitigation).
      state.excluded = state.lps.filter((l) => (l.kind === 'pledge' && flags.includes('unfunded')) || (l.kind === 'wash' && flags.includes('wash'))).map((l) => l.id);
      state.gate = evaluateGate(state);
      break;
    }
    case 'promote': {
      need(state, 'promote');
      if (typeof action.request !== 'boolean') fail('request must be true or false.');
      if (action.request) guard(state, 'Request simulated corridor promotion', { marketId: state.marketId });
      const granted = action.request && state.gate.eligible;
      const stage = granted ? 'corridor' : state.lps.some((l) => l.kind === 'genuine') ? 'growing_spoke' : 'spoke';
      state.promotion = { mode: MODES.SIM, requested: action.request, granted, stage, missing: state.gate.missing,
        note: 'Corridor stage is Titan Ghost application logic, not an XRPL ledger state. XDLC is a proposal, not live.' };
      const mid = MARKETS.find((m) => m.id === state.marketId).refPriceXrp;
      state.comparison = { mode: MODES.SIM, reviewed: false, engineLabel: engine.info().label,
        you: { label: 'Your market', metrics: metrics(sessionInputs(state)), lastRings: state.rounds[state.rounds.length - 1].rings, ringsActive: state.spoke.ringsActive },
        reinforced: runReference('reinforced', state.seed, state.scenario.shockRound, mid, engine),
        underfunded: runReference('underfunded', state.seed, state.scenario.shockRound, mid, engine) };
      break;
    }
    case 'compared': {
      need(state, 'compare');
      state.comparison.reviewed = true;
      break;
    }
    case 'quiz': {
      need(state, 'quiz');
      const ans = action.answers && typeof action.answers === 'object' ? action.answers : {};
      const results = state.scenario.quiz.map((qid) => {
        const q = QUIZ_POOL.find((x) => x.id === qid);
        const a = ans[qid];
        if (!CATEGORIES[a]) fail('Answer every question with xrpl, titan or xdlc.');
        return { id: qid, text: q.text, answer: a, correctCat: q.cat, correct: a === q.cat, why: q.why };
      });
      state.quiz = { results };
      if (action.alias != null) { const al = validateAlias(action.alias); if (!al.ok) fail(al.errors.join(' ')); state.alias = al.value; }
      next(state);
      state.score = computeScore(state);
      state.debrief = buildDebrief(state);
      state.completedAt = now;
      state.history.push({ type: t });
      return state;
    }
    case 'alias': {
      need(state, 'debrief');
      const al = validateAlias(action.alias);
      if (!al.ok) fail(al.errors.join(' '));
      if (!al.value) fail('Enter an alias.');
      state.alias = al.value;
      state.history.push({ type: t });
      return state;
    }
    default: fail(`Unknown action "${t}".`);
  }
  state.history.push({ type: t });
  next(state);
  return state;
}

// What the client sees: quiz answers hidden until answered; helpful derived data per step.
export function publicView(state) {
  const v = clone(state);
  v.steps = STEPS;
  v.stepIndex = STEPS.findIndex((x) => x.id === state.step);
  v.quizItems = state.scenario.quiz.map((qid) => { const q = QUIZ_POOL.find((x) => x.id === qid); return { id: q.id, text: q.text }; });
  v.issuerInfo = state.project ? issuerOf(state) : null;
  if (state.rounds.length) v.metrics = metrics(sessionInputs(state));
  delete v.scenario.quiz;
  return v;
}

export const META = { steps: STEPS, rounds: ROUNDS, capitalOptions: CAPITAL_OPTIONS, spreads: SPREADS, risks: RISKS, efficiency: EFFICIENCY, categories: CATEGORIES,
  refTradeUsd: REF_TRADE_USD, shockUsd: SHOCK_USD, maxLps: MAX_LPS, maxCustom: MAX_CUSTOM, references: { reinforced: REFERENCES.reinforced.label, underfunded: REFERENCES.underfunded.label } };
