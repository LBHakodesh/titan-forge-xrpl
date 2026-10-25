// Titan Ghost spoke-to-corridor lifecycle (APPLICATION LOGIC, not XRPL consensus).
// XRP auto-bridging is an existing XRPL feature; XDLC is a proposed amendment and is not live.
// Two independent tracks per token:
//   LIVE_TESTNET — gated on ORGANIC (non-demo) evidence + real maker capital vs reserves.
//   SIMULATION   — gated on scenario-model evidence; every number is labeled SIMULATION.
import fs from 'node:fs';
import path from 'node:path';
import { STAGES, MARKETS, MODES } from '../public/domain.js';
import { guardCheck } from './guardian.mjs';
import { getEngine } from './engine/index.mjs';
import { scoreEvidence, emptyEvidence, gatherLiveEvidence, makeCache, newSimState, simulate, simEvidence, independentShare, SCENARIOS } from './demand.mjs';

export const STAGE_IDS = STAGES.map((s) => s.id);
export const ACTIVE_LADDER = ['spoke', 'growing_spoke', 'corridor', 'mature']; // promotion order

// Entry thresholds (promotion) and hold thresholds (below → demotion recommended). Hysteresis avoids flapping.
export const THRESHOLDS = {
  spoke: { minScore: 0, why: 'Token launched with an initial XRP spoke (two inner rings).' },
  growing_spoke: { minScore: 35, minParticipants: 5, hold: 25, why: 'Score ≥ 35 and ≥ 5 independent participants: demand exists beyond a single counterparty.' },
  corridor: { minScore: 60, minParticipants: 15, minDepthNorm: 0.4, hold: 50, why: 'Score ≥ 60, ≥ 15 independent participants and depth component ≥ 0.4 (~800 XRP funded independent depth): enough flow to justify all six rings.' },
  mature: { minScore: 80, minPersistenceNorm: 0.75, hold: 70, why: 'Score ≥ 80 with persistence ≥ 0.75 (fills most days, sustained volume): independent providers can carry more of the book.' },
  standby: { reentryScore: 20, why: 'Demand faded below hold levels: release redundant proprietary capital and keep a single maintenance ring.' },
};
export const SPOKE_HOLD = 10;

// Not every market needs six rings.
export function ringsActiveFor(stage, score = 0) {
  return { entered: 0, spoke: 2, growing_spoke: score >= 48 ? 4 : 3, corridor: 6, mature: 6, standby: 1 }[stage] ?? 0;
}

// Modeled proprietary Titan Ghost capital per stage (USD, SIMULATION). Independent providers displace it in corridor/mature.
export const STAGE_CAPITAL_USD = { entered: 0, spoke: 10_000, growing_spoke: 60_000, corridor: 300_000, mature: 300_000, standby: 2_000 };
export function proprietaryCapitalUsd(stage, indepShare = 0) {
  const base = STAGE_CAPITAL_USD[stage] ?? 0;
  return Math.round(stage === 'corridor' || stage === 'mature' ? base * (1 - 0.6 * indepShare) : base);
}
export const flowScaleFor = (score) => Math.max(0.02, score / 100);

// Live capital requirement per added ring: two offers' owner reserves + quote notional for the bid side.
export const LIVE_QUOTE_XRP_PER_RING = 10;
export const LIVE_FEE_BUFFER_XRP = 1;
export function liveCapitalRequirement(from, to, reserveIncXrp) {
  const added = Math.max(0, ringsActiveFor(to, 100) - ringsActiveFor(from, 0));
  return +(added * (2 * reserveIncXrp + LIVE_QUOTE_XRP_PER_RING) + LIVE_FEE_BUFFER_XRP).toFixed(6);
}

export function nextStage(stage) {
  if (stage === 'entered') return 'spoke';
  if (stage === 'standby') return 'spoke';
  const i = ACTIVE_LADDER.indexOf(stage);
  return i >= 0 && i < ACTIVE_LADDER.length - 1 ? ACTIVE_LADDER[i + 1] : null;
}
export function demoteTargets(stage) {
  if (stage === 'standby' || stage === 'entered') return [];
  const i = ACTIVE_LADDER.indexOf(stage);
  const down = i > 0 ? [ACTIVE_LADDER[i - 1]] : [];
  return [...down, 'standby'];
}

const norm = (score, id) => score.components.find((c) => c.id === id)?.norm ?? 0;

// Pure: does `score` meet the threshold for entering `to` from `from`?
export function thresholdCheck(from, to, score, { launchLive = true } = {}) {
  const reasons = [];
  const e = score.evidence;
  if (to === 'spoke' && from === 'entered') { if (!launchLive) reasons.push('Launch has not completed on Testnet yet.'); }
  else if (to === 'spoke' && from === 'standby') { if (score.total < THRESHOLDS.standby.reentryScore) reasons.push(`Re-entry needs score ≥ ${THRESHOLDS.standby.reentryScore} (have ${score.total}).`); }
  else {
    const t = THRESHOLDS[to];
    if (!t) return { met: false, reasons: [`No promotion path to ${to}.`] };
    if (score.total < t.minScore) reasons.push(`Score ${score.total} < ${t.minScore}.`);
    if (t.minParticipants && e.participants < t.minParticipants) reasons.push(`Independent participants ${e.participants} < ${t.minParticipants}.`);
    if (t.minDepthNorm && norm(score, 'depth') < t.minDepthNorm) reasons.push(`Depth component ${norm(score, 'depth')} < ${t.minDepthNorm}.`);
    if (t.minPersistenceNorm && norm(score, 'persistence') < t.minPersistenceNorm) reasons.push(`Persistence component ${norm(score, 'persistence')} < ${t.minPersistenceNorm}.`);
  }
  return { met: reasons.length === 0, reasons };
}

// Pure: full promotion decision. Approval is ALWAYS required (also in SIMULATION), not only where Guardian enforces it.
export function evaluatePromotion({ mode, from, to, score, approved, capital, launchLive = true }) {
  const reasons = [];
  const expected = nextStage(from);
  if (!expected || to !== expected) reasons.push(`Invalid transition ${from} → ${to}${expected ? ` (next is ${expected})` : ''}.`);
  const th = thresholdCheck(from, to, score, { launchLive });
  reasons.push(...th.reasons);
  if (approved !== true) reasons.push('Explicit operator approval required.');
  if (capital && !capital.sufficient) reasons.push(capital.mode === MODES.LIVE
    ? `Insufficient funded maker capital: spendable ${capital.spendableXrp} XRP < required ${capital.requiredXrp} XRP.`
    : `Insufficient modeled capital pool.`);
  const guardian = mode === MODES.LIVE
    ? guardCheck({ mode, txType: 'OfferCreate', role: 'maker', amountXrp: LIVE_QUOTE_XRP_PER_RING, requiresApproval: true, approved })
    : guardCheck({ mode, amountUsd: Math.max(1, proprietaryCapitalUsd(to)), requiresApproval: true, approved });
  if (!guardian.allowed) reasons.push(...guardian.reasons.map((r) => `Guardian: ${r}`));
  return { allowed: reasons.length === 0, reasons: [...new Set(reasons)], thresholdsMet: th.met, guardian };
}

// Pure: what the operator could do next on a track.
export function allowedTransitions(stage, score, { launchLive = true, peak = 100 } = {}) {
  const out = [];
  const nxt = nextStage(stage);
  if (nxt) { const th = thresholdCheck(stage, nxt, score, { launchLive }); out.push({ to: nxt, kind: 'promote', requiresApproval: true, thresholdsMet: th.met, reasons: th.reasons, why: THRESHOLDS[nxt]?.why }); }
  for (const to of demoteTargets(stage)) out.push({ to, kind: 'demote', requiresApproval: false, thresholdsMet: true, reasons: [], why: to === 'standby' ? THRESHOLDS.standby.why : 'Step back one stage (reversible).' });
  // A fresh spoke that never had demand is not 'faded'; spoke→standby is only recommended after a peak ≥ re-entry level.
  const hold = stage === 'spoke' ? (peak >= THRESHOLDS.standby.reentryScore ? SPOKE_HOLD : null) : THRESHOLDS[stage]?.hold;
  const demoteRecommended = hold != null && score.total < hold ? { to: stage === 'spoke' ? 'standby' : demoteTargets(stage)[0], reason: `Score ${score.total} below hold level ${hold} for ${stage}.` } : null;
  return { transitions: out, demoteRecommended };
}

export function ringAllocation(stage, score, indepShare, engine = getEngine()) {
  const ringsActive = ringsActiveFor(stage, score);
  const capitalUsd = proprietaryCapitalUsd(stage, indepShare);
  const flowScale = flowScaleFor(score);
  if (!ringsActive || !capitalUsd) return { mode: MODES.SIM, ringsActive, capitalUsd, flowScale, rings: [], deployedUsd: 0, idleUsd: capitalUsd, engine: engine.info() };
  const a = engine.allocate(capitalUsd, { flowScale, ringsActive });
  return { mode: MODES.SIM, ringsActive, capitalUsd, flowScale, deployedUsd: a.deployedUsd, idleUsd: a.idleUsd, dailyEarnUsd: a.dailyEarnUsd,
    rings: a.rings.map((r) => ({ id: r.id, allocUsd: Math.round(r.allocUsd), utilization: +r.utilization.toFixed(3) })), engine: engine.info() };
}

const CATEGORY_MARKET = { currency: 'currencies', securities: 'securities', real_estate: 'real_estate', precious_metals: 'precious_metals' };

// ---------- Stateful service ----------
export class Corridor {
  constructor({ store, bus, ledger = null, file, seedFile = null, isLedgerReady = () => false, engine = getEngine() }) {
    Object.assign(this, { store, bus, ledger, file, isLedgerReady, engine });
    this.cache = makeCache(20_000);
    this.sentinel = {}; // code -> {critical, high, medium, low} from sentinel.finding events (optional input)
    this.state = { version: 1, tokens: {} };
    const src = file && fs.existsSync(file) ? file : seedFile && fs.existsSync(seedFile) ? seedFile : null;
    try { if (src) this.state = JSON.parse(fs.readFileSync(src, 'utf8')); } catch { /* start fresh */ }
    this.state.tokens ||= {};
    for (const l of store.launches) this.ensure(l);
    this.save();
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.state, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
  }

  ensure(launch) {
    if (!launch || launch.status === 'failed' || !launch.code) return null;
    let t = this.state.tokens[launch.code];
    if (!t) {
      t = this.state.tokens[launch.code] = { code: launch.code, name: launch.name, category: launch.category, launchId: launch.id, createdAt: new Date().toISOString(),
        tracks: { [MODES.LIVE]: { stage: 'entered', history: [] } }, sim: null, lastLive: null };
    }
    if (launch.status === 'live' && t.tracks[MODES.LIVE].stage === 'entered') this.#move(t, MODES.LIVE, 'spoke', 'Launch completed on Testnet (launch.done).', 0);
    return t;
  }

  onEvent(ev) {
    if (ev.type === 'launch.created' || ev.type === 'launch.done') {
      const l = this.store.launches.find((x) => x.id === ev.launchId) || { id: ev.launchId, code: ev.code, name: ev.name, status: ev.type === 'launch.done' ? 'live' : 'queued' };
      if (ev.type === 'launch.done') l.status = 'live';
      this.ensure(l); this.save();
    } else if (ev.type === 'sentinel.finding' && ev.code) {
      const s = (this.sentinel[ev.code] ||= { critical: 0, high: 0, medium: 0, low: 0 });
      const sev = String(ev.severity || 'low').toLowerCase();
      if (sev in s) s[sev]++;
    }
  }

  launchOf(code) { return this.store.byCode(code); }
  token(code) { return this.state.tokens[code] || null; }

  // LIVE evidence (read-only). If Testnet is unavailable, the last snapshot is returned labeled REPLAY.
  async live(code) {
    const t = this.token(code); const l = this.launchOf(code);
    if (!t || !l || l.status !== 'live') return { mode: MODES.LIVE, organic: emptyEvidence(), demo: emptyEvidence(), note: 'Launch not live yet: no ledger evidence.', unavailable: true };
    if (!this.isLedgerReady() || !this.ledger) {
      return t.lastLive ? { ...t.lastLive, mode: MODES.REPLAY, note: `Testnet unavailable — replaying snapshot from ${t.lastLive.at}. ${t.lastLive.note}` }
        : { mode: MODES.REPLAY, organic: emptyEvidence(), demo: emptyEvidence(), note: 'Testnet unavailable and no snapshot recorded.', unavailable: true };
    }
    try {
      const ev = await gatherLiveEvidence(this.ledger, l, { cache: this.cache, sentinel: this.sentinel[code] || null });
      const prev = t.lastLive;
      t.lastLive = ev; this.save();
      const sc = this.scores(code, ev);
      if (!prev || scoreEvidence(prev.organic).total !== sc.live.organic.total || scoreEvidence(prev.demo).total !== sc.live.demo.total) {
        this.bus.publish('corridor.score', MODES.LIVE, { code, live: { organic: sc.live.organic.total, demo: sc.live.demo.total }, sim: sc.sim ? sc.sim.total : null });
      }
      return ev;
    } catch (e) {
      return t.lastLive ? { ...t.lastLive, mode: MODES.REPLAY, note: `Live read failed (${e.message}); replaying snapshot from ${t.lastLive.at}.` }
        : { mode: MODES.LIVE, organic: emptyEvidence(), demo: emptyEvidence(), note: `Live read failed: ${e.message}`, unavailable: true };
    }
  }

  scores(code, live) {
    const t = this.token(code);
    const lm = live?.mode === MODES.REPLAY ? MODES.REPLAY : MODES.LIVE;
    return {
      live: { mode: lm, organic: scoreEvidence(live?.organic || emptyEvidence(), lm), demo: scoreEvidence(live?.demo || emptyEvidence(), lm) },
      sim: t?.sim ? scoreEvidence(simEvidence(t.sim), MODES.SIM) : null,
    };
  }

  indepShare(code, mode, live) {
    const t = this.token(code);
    if (mode === MODES.SIM) return t?.sim ? independentShare(t.sim.proprietaryDepthXrp, t.sim.independentDepthXrp) : 0;
    return independentShare(live?.demo?.depthXrp || 0, live?.organic?.depthXrp || 0);
  }

  trackView(code, mode, score, live) {
    const t = this.token(code); const tr = t.tracks[mode];
    if (!tr) return null;
    const share = this.indepShare(code, mode, live);
    const launchLive = this.launchOf(code)?.status === 'live';
    const traj = mode === MODES.SIM ? (t.sim?.trajectory || []).map((p) => p.score) : [];
    const peak = Math.max(score.total, ...traj, ...tr.history.map((h) => h.score || 0));
    return {
      mode, stage: tr.stage, score: score.total, peak, history: tr.history.slice(-20),
      ...allowedTransitions(tr.stage, score, { launchLive, peak }),
      allocation: ringAllocation(tr.stage, score.total, share, this.engine),
      ownership: { proprietaryLabel: 'Titan Ghost proprietary anchoring', proprietaryShare: +(1 - share).toFixed(3), independentShare: +share.toFixed(3),
        proprietaryCapitalUsd: proprietaryCapitalUsd(tr.stage, share), capitalMode: MODES.SIM },
      released: tr.released || null, recommendations: tr.recommendations || [],
    };
  }

  summary(code) {
    const t = this.token(code);
    const sc = this.scores(code, t.lastLive);
    return { code, name: t.name, category: t.category, liveStage: t.tracks[MODES.LIVE].stage, simStage: t.tracks[MODES.SIM]?.stage || null,
      organic: sc.live.organic.total, demo: sc.live.demo.total, sim: sc.sim?.total ?? null, liveAsOf: t.lastLive?.at || null };
  }

  async view(code) {
    const t = this.token(code); if (!t) return null;
    const live = await this.live(code);
    const sc = this.scores(code, live);
    return {
      code, name: t.name, category: t.category, engine: this.engine.info(), stages: STAGES, thresholds: THRESHOLDS, scenarios: SCENARIOS,
      evidence: { live: { mode: live.mode, at: live.at, note: live.note, organic: live.organic, demo: live.demo, stepStatus: live.stepStatus || [], demoAccounts: live.demoAccounts || [], ledger: live.ledger || null },
        sim: t.sim ? { mode: MODES.SIM, evidence: simEvidence(t.sim), period: t.sim.period, lastScenario: t.sim.lastScenario, trajectory: t.sim.trajectory } : null },
      scores: sc,
      tracks: { live: this.trackView(code, MODES.LIVE, sc.live.organic, live), sim: t.tracks[MODES.SIM] ? this.trackView(code, MODES.SIM, sc.sim || scoreEvidence(emptyEvidence(), MODES.SIM), live) : null },
      labels: {
        autoBridging: 'XRP auto-bridging: an existing XRPL protocol feature — offers in TOKEN/XRP books can be combined automatically for cross-currency paths.',
        lifecycle: 'Titan Ghost corridor lifecycle: OUR application logic deciding how many rings and how much capital a market gets. XRPL consensus does not build corridors.',
        xdlc: 'XDLC: a PROPOSED XRPL amendment. Not live on any network; nothing here depends on it.',
      },
    };
  }

  #move(t, mode, to, reason, score) {
    const tr = t.tracks[mode]; const from = tr.stage;
    tr.stage = to;
    tr.history.push({ at: new Date().toISOString(), from, to, reason, score });
    if (tr.history.length > 100) tr.history.shift();
    const share = mode === MODES.SIM && t.sim ? independentShare(t.sim.proprietaryDepthXrp, t.sim.independentDepthXrp) : independentShare(t.lastLive?.demo?.depthXrp || 0, t.lastLive?.organic?.depthXrp || 0);
    const alloc = ringAllocation(to, score, share, this.engine);
    this.bus.publish('corridor.stage_changed', mode, { code: t.code, from, to, mode, reason, rings: alloc.rings.map(({ id, allocUsd, utilization }) => ({ id, allocUsd, utilization })) });
    return { from, to, alloc };
  }

  simulate(code, scenario, periods = 7) {
    const t = this.token(code); if (!t) throw Object.assign(new Error('Unknown token'), { status: 404 });
    if (scenario === 'reset') { t.sim = null; delete t.tracks[MODES.SIM]; this.save(); return { reset: true }; }
    if (!SCENARIOS[scenario]) throw Object.assign(new Error(`Unknown scenario ${scenario}`), { status: 400 });
    const p = Math.max(1, Math.min(28, Math.floor(Number(periods) || 7)));
    if (!t.sim) t.sim = newSimState(t.lastLive?.organic || emptyEvidence()); // starts from the live ORGANIC baseline (≈ 0)
    if (!t.tracks[MODES.SIM]) t.tracks[MODES.SIM] = { stage: t.tracks[MODES.LIVE].stage === 'entered' ? 'entered' : t.tracks[MODES.LIVE].stage, history: [] };
    t.sim = simulate(t.sim, scenario, p);
    this.save();
    const sc = this.scores(code, t.lastLive);
    this.bus.publish('corridor.score', MODES.SIM, { code, live: { organic: sc.live.organic.total, demo: sc.live.demo.total }, sim: sc.sim.total, scenario });
    return { scenario, periods: p, sim: sc.sim.total, mode: MODES.SIM };
  }

  async liveCapital(from, to) {
    const maker = this.ledger.wallets.maker.address;
    const [info, acct] = await Promise.all([
      this.cache('server_info', async () => (await this.ledger.client.request({ command: 'server_info' })).result.info, 60_000),
      this.ledger.client.request({ command: 'account_info', account: maker, ledger_index: 'validated' }).then((r) => r.result.account_data),
    ]);
    const base = info.validated_ledger.reserve_base_xrp, inc = info.validated_ledger.reserve_inc_xrp;
    const balanceXrp = Number(acct.Balance) / 1e6;
    const reservedXrp = base + acct.OwnerCount * inc;
    const spendableXrp = +(balanceXrp - reservedXrp).toFixed(6);
    const requiredXrp = liveCapitalRequirement(from, to, inc);
    return { mode: MODES.LIVE, maker, balanceXrp, ownerCount: acct.OwnerCount, reserveBaseXrp: base, reserveIncXrp: inc, reservedXrp: +reservedXrp.toFixed(6), spendableXrp, requiredXrp, sufficient: spendableXrp >= requiredXrp,
      basis: `Per added ring: 2 offers × ${inc} XRP owner reserve + ${LIVE_QUOTE_XRP_PER_RING} XRP bid notional; plus ${LIVE_FEE_BUFFER_XRP} XRP fee buffer.` };
  }

  async promote(code, { approved, mode = MODES.SIM } = {}) {
    const t = this.token(code); if (!t) return { status: 404, body: { error: 'Unknown token' } };
    if (![MODES.LIVE, MODES.SIM].includes(mode)) return { status: 400, body: { error: 'mode must be LIVE_TESTNET or SIMULATION' } };
    const tr = t.tracks[mode];
    if (!tr) return { status: 409, body: { error: 'No SIMULATION track yet: run a scenario first.' } };
    const from = tr.stage, to = nextStage(from);
    if (!to) return { status: 409, body: { allowed: false, reasons: [`No promotion beyond ${from}.`] } };
    const launchLive = this.launchOf(code)?.status === 'live';
    let score, capital = null;
    if (mode === MODES.LIVE) {
      const live = await this.live(code);
      if (live.mode !== MODES.LIVE || live.unavailable) return { status: 503, body: { allowed: false, reasons: ['Live Testnet evidence unavailable; live promotion refused.'], offer: simOffer(code) } };
      score = scoreEvidence(live.organic, MODES.LIVE); // ORGANIC only: demo activity never promotes
      try { capital = await this.liveCapital(from, to); } catch (e) { return { status: 503, body: { allowed: false, reasons: [`Could not read maker capital: ${e.message}`], offer: simOffer(code) } }; }
    } else {
      score = this.scores(code, t.lastLive).sim || scoreEvidence(emptyEvidence(), MODES.SIM);
      capital = { mode: MODES.SIM, poolUsd: 1_000_000, requiredUsd: proprietaryCapitalUsd(to), sufficient: proprietaryCapitalUsd(to) <= 1_000_000 };
    }
    const decision = evaluatePromotion({ mode, from, to, score, approved, capital, launchLive });
    const body = { mode, from, to, score: score.total, scoreBasis: mode === MODES.LIVE ? 'organic (non-demo) LIVE_TESTNET evidence' : 'SIMULATION evidence', capital, ...decision };
    if (!decision.allowed) {
      if (mode === MODES.LIVE) body.offer = simOffer(code);
      return { status: 403, body };
    }
    const reason = mode === MODES.LIVE ? 'Operator-approved LIVE promotion (application state; additional ring offers are not placed by this module).' : 'Operator-approved SIMULATION promotion.';
    const r = this.#move(t, mode, to, reason, score.total);
    delete tr.released; tr.recommendations = [];
    this.save();
    return { status: 200, body: { ...body, rings: r.alloc } };
  }

  demote(code, { mode = MODES.SIM, to } = {}) {
    const t = this.token(code); if (!t) return { status: 404, body: { error: 'Unknown token' } };
    if (![MODES.LIVE, MODES.SIM].includes(mode)) return { status: 400, body: { error: 'mode must be LIVE_TESTNET or SIMULATION' } };
    const tr = t.tracks[mode];
    if (!tr) return { status: 409, body: { error: 'No SIMULATION track yet: run a scenario first.' } };
    const from = tr.stage; const targets = demoteTargets(from);
    const target = to || targets[0];
    if (!targets.includes(target)) return { status: 409, body: { allowed: false, reasons: [targets.length ? `Cannot demote ${from} → ${target}. Allowed: ${targets.join(", ")}.` : `Nothing to demote: ${from} is the lowest active state (promote back to spoke when demand returns).`] } };
    const live = t.lastLive;
    const score = mode === MODES.SIM ? (this.scores(code, live).sim?.total ?? 0) : this.scores(code, live).live.organic.total;
    const share = this.indepShare(code, mode, live);
    const guardian = guardCheck({ mode: MODES.SIM, amountUsd: Math.max(1, proprietaryCapitalUsd(from, share)) }); // capital release is modeled
    const releasedUsd = Math.max(0, proprietaryCapitalUsd(from, share) - proprietaryCapitalUsd(target, share));
    const r = this.#move(t, mode, target, `Operator demotion${target === 'standby' ? ' to standby' : ''} (reversible).`, score);
    tr.released = releasedUsd ? { usd: releasedUsd, mode: MODES.SIM, at: new Date().toISOString() } : null;
    tr.recommendations = releasedUsd ? this.recommend(code, mode, releasedUsd, score, target) : [];
    this.save();
    return { status: 200, body: { mode, from, to: target, score, guardian, releasedUsd, releasedMode: MODES.SIM, recommendations: tr.recommendations, rings: r.alloc } };
  }

  // Released proprietary capital → engine recommendation toward another eligible market (modeled).
  recommend(code, mode, releasedUsd, score, stage) {
    const markets = [{ marketId: code, capitalUsd: releasedUsd, flowScale: flowScaleFor(score), ringsActive: Math.max(1, ringsActiveFor(stage, score)) }];
    for (const [c, o] of Object.entries(this.state.tokens)) {
      if (c === code) continue;
      const tr = o.tracks[mode]; if (!tr || ['standby', 'entered'].includes(tr.stage)) continue;
      const s = mode === MODES.SIM ? (o.sim ? scoreEvidence(simEvidence(o.sim)).total : 0) : scoreEvidence(o.lastLive?.organic || emptyEvidence()).total;
      if (s < THRESHOLDS.growing_spoke.minScore) continue; // eligible = has demonstrated demand
      markets.push({ marketId: c, capitalUsd: 1, flowScale: flowScaleFor(s), ringsActive: ringsActiveFor(tr.stage, s) });
    }
    // Reference markets (modeled) so a lone token still gets a destination.
    const home = CATEGORY_MARKET[this.token(code)?.category];
    for (const m of MARKETS) if (m.id !== home) markets.push({ marketId: m.id, capitalUsd: 1, flowScale: 0.5, ringsActive: 6, reference: true });
    return this.engine.recommend(markets).filter((r) => r.fromMarket === code).map((r) => ({ ...r, mode: MODES.SIM, engineLabel: this.engine.info().label,
      toKind: markets.find((m) => m.marketId === r.toMarket)?.reference ? 'reference market (modeled)' : 'eligible token corridor' }));
  }
}

function simOffer(code) {
  return { mode: MODES.SIM, message: 'Live promotion refused. You can run the same promotion in SIMULATION instead (clearly labeled, no capital moves).',
    endpoint: `/api/corridor/${code}/promote`, body: { approved: true, mode: MODES.SIM }, needsSimTrack: true };
}
