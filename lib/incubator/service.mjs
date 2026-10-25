// Project Liquidity Incubator service: state, derived views, operator actions and bus events.
// Holds NO ledger handle and never signs, submits or moves funds. Every mutation is a SIMULATION record made by an
// explicit operator action (route POSTs are localhost-only). State persists to a JSON file.
import fs from 'node:fs';
import path from 'node:path';
import { STAGES } from '../../public/domain.js';
import { getEngine } from '../engine/index.mjs';
import { ringAllocation, nextStage } from '../corridor.mjs';
import {
  SIM, SOURCES, CAPITAL_STATES, OUTCOMES, DISCLAIMER, SOURCE_DEFS, TIER_COMBINATIONS,
  validateStack, initialStates, setSourceStates, rebaseStates, checkStates, fundingGaps, stateTotals, ownership, custodyCheck,
} from './model.mjs';
import { validateIntake, validateRegulatoryReview } from './intake.mjs';
import { legalGate, economicGate, decideOutcome, outcomeAllowed, PERMISSIONED_DEX_NOTE } from './gates.mjs';
import { rlusdContext, radarFromSpokes, simulateInterim, replayIllustration, INTERIM_DISCLAIMER } from './program.mjs';
import { recommend, supportRecommendation, MATURITY_PATH, proprietaryNeedUsd } from './intelligence.mjs';
import { RECORDED_CHECK, nativeLendingStatus } from './amendments.mjs';
import { DEMO_IDS, DEMO_INTAKES, DEMO_STACKS, DEMO_GATES, PROPRIETARY_BUDGET_USD, SEED_AT } from './demo.mjs';
import { simulateLoan, LENDING_LABEL, SCENARIOS } from './lending.mjs';
import { DEMO_PROJECT, demoWalkthrough } from './bootstrap.mjs';

export const DECISION_TYPES = ['SELECT_SUPPORT', 'BOOTSTRAP', 'RECORD_OUTCOME', 'ADVANCE_MATURITY', 'REDEPLOY', 'APPLY_RECOMMENDATION', 'TRANSFER_REQUEST'];
export const NARRATIVES = [
  { id: 'titan_ghost', product: 'Titan Ghost', track: '"Why Not"', text: 'Authorized market-making infrastructure: the six rings, Guardian verdicts and the corridor lifecycle that every project here moves through.' },
  { id: 'tglb', product: 'TGLB (Titan Ghost Liquidity Bootstrap)', track: 'Lending', text: 'Capital stack designer coordinating TGLW tiers with a separate Tier 3 creditor-financing path (SIMULATION; native XRPL lending UNAVAILABLE on Testnet).' },
  { id: 'xdlc', product: 'XDLC', track: 'Protocol Innovation', text: 'A proposed open protocol framework for spoke-to-corridor lifecycles. Not live on XRPL: the lifecycle here is application logic.' },
  { id: 'merchant', product: 'Titan Ghost Merchant', track: 'Agentic Finance', text: 'Agentic data purchases over x402 live in the x402 tab (frozen as built; per-payment Commander approval).', link: { tab: 'x402' } },
];

const r2 = (x) => Math.round(x * 100) / 100;
const clone = (x) => JSON.parse(JSON.stringify(x));

export class ProjectError extends Error { constructor(status, message, extra = {}) { super(message); Object.assign(this, { status, extra }); } }

export class Incubator {
  // spokesSource: () => ({ spokes:[], flows:[], xrpUsd, attributionHtml }) — read-only lib/spokes data.
  // ledger is accepted only so callers can prove it is never touched.
  constructor({ file = null, seedFile = null, bus = null, spokesSource = () => ({ spokes: [], flows: [] }), now = () => new Date().toISOString(), ledger = null } = {}) {
    Object.assign(this, { file, bus, spokesSource, now });
    this._ledger = ledger; // never used
    const src = file && fs.existsSync(file) ? file : seedFile && fs.existsSync(seedFile) ? seedFile : null;
    let st = null;
    try { if (src) st = JSON.parse(fs.readFileSync(src, 'utf8')); } catch { st = null; }
    this.state = st && st.version === 1 ? st : Incubator.seedState();
    this.amendmentCheck = this.state.amendmentCheck || RECORDED_CHECK;
    this.state.loans ||= {};
    this.save();
  }

  static seedState() {
    const state = { version: 1, seq: 0, projects: {}, proprietary: { budgetUsd: PROPRIETARY_BUDGET_USD, allocations: {} }, decisions: [], custodyAttempts: [], amendmentCheck: RECORDED_CHECK, loans: {} };
    for (const id of DEMO_IDS) {
      const intake = validateIntake(DEMO_INTAKES[id], { now: Date.parse(SEED_AT) + 30 * 86_400_000 });
      if (!intake.ok) throw new Error(`demo seed ${id} invalid: ${intake.errors.join(' ')}`);
      const s = DEMO_STACKS[id];
      const { ok, errors, stack } = validateStack({ targetUsd: s.targetUsd, sources: s.sources, terms: s.terms });
      if (!ok) throw new Error(`demo stack ${id} invalid: ${errors.join(' ')}`);
      let states = initialStates(stack);
      for (const [src, patch] of Object.entries(s.states)) { const r = setSourceStates(states, stack, src, patch); if (!r.ok) throw new Error(r.errors.join(' ')); states = r.states; }
      const g = DEMO_GATES[id];
      state.projects[id] = {
        ...intake.value, source: DEMO_INTAKES[id].source, fictional: true, mode: SIM, createdAt: SEED_AT,
        stack, capitalStates: states, legalItems: g.legalItems, demand: g.demand, interimDays: g.interimDays,
        stage: 'entered', program: 'XRP_RLUSD_INTERIM', recordedOutcome: null, maturityWeek: null, proprietaryInitialUsd: 0,
        history: [{ at: SEED_AT, type: 'created', note: 'Seeded fictional demo project.' }],
      };
    }
    return state;
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.state, null, 1));
    fs.renameSync(this.file + '.tmp', this.file);
  }

  reset() { this.state = Incubator.seedState(); this.state.amendmentCheck = this.amendmentCheck; this.save(); this.#emit('incubator.decision', { projectId: null, decisionType: 'RESET', actor: 'operator', note: 'Demo state reseeded.' }); return { ok: true }; }

  #emit(type, payload) { try { this.bus?.publish(type, SIM, payload); } catch { /* bus optional */ } }
  #hist(p, type, note, extra = {}) { p.history.push({ at: this.now(), type, note, ...extra }); if (p.history.length > 200) p.history.shift(); }
  #project(id) { const p = this.state.projects[id]; if (!p) throw new ProjectError(404, `Unknown project ${id}.`); return p; }

  spokes() { try { return this.spokesSource() || { spokes: [], flows: [] }; } catch { return { spokes: [], flows: [] }; } }

  // ---------- Proprietary book ----------
  allocated(id) { return this.state.proprietary.allocations[id] || 0; }
  availableUsd() { return r2(this.state.proprietary.budgetUsd - Object.values(this.state.proprietary.allocations).reduce((s, v) => s + v, 0)); }
  #setAllocation(p, usd) {
    usd = Math.max(0, r2(usd));
    if (usd > 0) this.state.proprietary.allocations[p.id] = usd; else delete this.state.proprietary.allocations[p.id];
    const st = p.capitalStates.PROPRIETARY;
    const cap = Math.min(usd, st.REQUESTED);
    const live = st.EXECUTABLE > 0;
    p.capitalStates = { ...p.capitalStates, PROPRIETARY: { REQUESTED: st.REQUESTED, MATCHED: cap, COMMITTED: cap, FUNDED: live ? cap : 0, EXECUTABLE: live ? cap : 0 } };
  }

  // ---------- Derived view ----------
  view(p, ctx = this.spokes()) {
    const engine = getEngine();
    const rlusd = rlusdContext(ctx.spokes, { xrpUsd: ctx.xrpUsd ?? null });
    const perf = simulateInterim({ states: p.capitalStates, stack: p.stack, days: p.interimDays ?? 30, seed: 1313 + [...p.id].reduce((s, c) => s + c.charCodeAt(0), 0), rlusd, xrpUsd: ctx.xrpUsd ?? null });
    const legal = legalGate(p.regulatoryReview, p.legalItems);
    const economic = economicGate({ project: p, states: p.capitalStates, perf, engine });
    const outcome = decideOutcome(legal, economic);
    let effective = outcome.outcome, revoked = false;
    if (p.recordedOutcome) {
      const ok = outcomeAllowed(p.recordedOutcome.outcome, legal, economic);
      if (ok.allowed) effective = p.recordedOutcome.outcome; else revoked = true;
    }
    const indepShare = p.maturityWeek != null ? MATURITY_PATH[p.maturityWeek].indepShare : 0;
    const allocatedUsd = this.allocated(p.id);
    const needUsd = p.program === 'PROJECT_TOKEN_CORRIDOR' ? Math.min(allocatedUsd, proprietaryNeedUsd(p.proprietaryInitialUsd || allocatedUsd, indepShare)) : allocatedUsd;
    return { project: p, legal, economic, outcome: { ...outcome, computed: outcome.outcome, effective, recorded: p.recordedOutcome, revoked }, perf, rlusd, indepShare,
      proprietary: { allocatedUsd, needUsd, freedUsd: r2(allocatedUsd - needUsd), initialUsd: p.proprietaryInitialUsd || 0 }, engine: engine.info() };
  }

  #nextOpportunity(excludeId, ctx) {
    const others = Object.values(this.state.projects).filter((q) => q.id !== excludeId && q.program !== 'NONE');
    const cand = others.map((q) => ({ q, unmet: q.capitalStates.PROPRIETARY.REQUESTED - this.allocated(q.id), legal: legalGate(q.regulatoryReview, q.legalItems).status }))
      .filter((x) => x.legal !== 'FAIL' && x.unmet > 0).sort((a, b) => b.unmet - a.unmet)[0];
    if (cand) return { id: cand.q.id, name: cand.q.name, why: `unmet proprietary ask $${Math.round(cand.unmet).toLocaleString('en-US')}; legal ${cand.legal}`, provenance: SIM };
    const r = radarFromSpokes(ctx.spokes).find((x) => x.candidate);
    return r ? { id: r.id, name: `${r.name} (radar)`, why: 'thin-liquidity radar candidate (observation only; needs intake)', provenance: r.mode } : null;
  }

  steps(v) {
    const p = v.project;
    const execAny = SOURCES.some((s) => p.capitalStates[s].EXECUTABLE > 0);
    const graduated = p.program === 'PROJECT_TOKEN_CORRIDOR';
    const redeployed = this.state.decisions.some((d) => d.type === 'REDEPLOY' && d.projectId === p.id && d.result?.ok);
    const S = (id, label, status, note) => ({ id, label, status, note });
    return [
      S('request', 'Request', 'done', `${p.source === 'RADAR_DISCOVERED' ? 'Radar-discovered' : 'Project-requested'} · intake recorded`),
      S('capital_mix', 'Capital mix', 'done', `${p.stack.combination} + project + proprietary lines`),
      S('bootstrap', 'Bootstrap', execAny ? 'done' : 'current', execAny ? `Interim XRP/RLUSD program executable (SIMULATION)` : 'No executable capital yet'),
      S('fills', graduated ? 'Replayed fills' : 'Simulated fills', v.perf.totals.positionUsd > 0 ? 'done' : 'pending', graduated ? 'Project-token fills are REPLAY illustrations from funded Testnet spokes' : 'XRP/RLUSD interim fills (SIMULATION)'),
      S('maturation', 'Maturation', graduated ? (p.stage === 'mature' ? 'done' : 'current') : (v.legal.status === 'OPEN' ? 'blocked' : 'pending'), graduated ? `Stage ${p.stage} · independent ${(v.indepShare * 100).toFixed(0)}%` : `Token corridor closed: legal ${v.legal.status}, economic ${v.economic.status}`),
      S('redeployment', 'Redeployment', redeployed ? 'done' : v.proprietary.freedUsd > 0 ? 'current' : 'pending', redeployed ? 'Freed proprietary support redeployed' : v.proprietary.freedUsd > 0 ? `$${v.proprietary.freedUsd.toLocaleString('en-US')} can be redeployed` : 'Nothing freed yet'),
    ];
  }

  summary(p, ctx = this.spokes()) {
    const v = this.view(p, ctx);
    const token = p.token ? { network: p.token.network, currency: p.token.currency, issuer: p.token.issuer } : null;
    return {
      id: p.id, name: p.name, source: p.source, token, stage: p.stage, program: p.program,
      capitalStack: { targetUsd: p.stack.targetUsd, combination: p.stack.combination, sources: clone(p.stack.sources) },
      capitalStates: clone(p.capitalStates),
      gates: { legal: { status: v.legal.status, items: v.legal.items }, economic: { status: v.economic.status, items: v.economic.items } },
      outcome: v.outcome.effective, outcomeStatus: p.recordedOutcome && !v.outcome.revoked ? 'COMMANDER_RECORDED' : 'GATE_COMPUTED', mode: p.mode || SIM, fictional: !!p.fictional,
    };
  }

  list() { const ctx = this.spokes(); return { mode: SIM, disclaimer: DISCLAIMER, projects: Object.values(this.state.projects).map((p) => this.summary(p, ctx)) }; }

  detail(id) {
    const p = this.#project(id);
    const ctx = this.spokes();
    const v = this.view(p, ctx);
    const recs = recommend({ ...v, nextOpportunity: this.#nextOpportunity(p.id, ctx) });
    const graduated = p.program === 'PROJECT_TOKEN_CORRIDOR';
    const rings = graduated ? ringAllocation(p.stage, Math.round(30 + 60 * v.indepShare), v.indepShare) : null;
    return {
      ...this.summary(p, ctx),
      description: p.description, regulatoryReview: p.regulatoryReview, requestedUsd: p.requestedUsd, targetOperatingPeriod: p.targetOperatingPeriod, runwayMonths: p.runwayMonths,
      sustainabilityMeasures: p.sustainabilityMeasures, mmEconomics: p.mmEconomics, desiredMarkets: p.desiredMarkets, demand: p.demand, radarId: p.radarId || null,
      tokenIssued: !!p.token?.issued,
      sourcesInfo: SOURCE_DEFS, terms: p.stack.terms, ownership: ownership(p.stack), fundingGaps: fundingGaps(p.capitalStates, p.stack), stateTotals: stateTotals(p.capitalStates),
      gateDetail: { legal: v.legal, economic: v.economic, outcome: v.outcome, permissionedDexNote: PERMISSIONED_DEX_NOTE },
      performance: { interim: v.perf, replay: graduated ? replayIllustration(ctx.spokes, ctx.flows || [], { forProject: p.name }) : [], corridorRings: rings,
        maturity: graduated ? { week: p.maturityWeek, path: MATURITY_PATH, indepShare: v.indepShare } : null },
      proprietary: { ...v.proprietary, budgetUsd: this.state.proprietary.budgetUsd, availableUsd: this.availableUsd() },
      recommendations: recs, steps: this.steps(v),
      history: p.history.slice(-50), decisions: this.state.decisions.filter((d) => d.projectId === p.id).slice(-30),
      engine: v.engine, tier3: { nativeLending: nativeLendingStatus(this.amendmentCheck), amendmentCheck: this.amendmentCheck },
      stages: STAGES, disclaimer: DISCLAIMER, interimDisclaimer: INTERIM_DISCLAIMER, narratives: NARRATIVES,
    };
  }

  // ---------- Operator actions (SIMULATION records only) ----------
  create(body = {}) {
    if (body.mode && body.mode !== SIM) throw new ProjectError(400, 'Projects are created in SIMULATION mode only.');
    const intake = validateIntake(body, { existingIds: Object.keys(this.state.projects) });
    if (!intake.ok) throw new ProjectError(400, 'Intake invalid.', { errors: intake.errors });
    const source = body.radarId ? 'RADAR_DISCOVERED' : 'PROJECT_REQUESTED';
    if (source === 'RADAR_DISCOVERED' && !radarFromSpokes(this.spokes().spokes).some((r) => r.id === body.radarId)) throw new ProjectError(400, 'Intake invalid.', { errors: [`Unknown radar id ${body.radarId}.`] });
    // Default stack: the requested amount entirely as Tier 1 (operator adjusts in the designer). Nothing matched yet.
    const { stack } = validateStack({ targetUsd: intake.value.requestedUsd, sources: { T1: intake.value.requestedUsd } });
    const p = { ...intake.value, source, fictional: false, mode: SIM, createdAt: this.now(), stack, capitalStates: initialStates(stack),
      legalItems: {}, demand: { verifiedEvidence: [], independentParticipants: 0 }, interimDays: 0, stage: 'entered', program: 'NONE', recordedOutcome: null, maturityWeek: null, proprietaryInitialUsd: 0, history: [] };
    this.#hist(p, 'created', `Intake recorded (${source}).`, { actor: String(body.actor || 'operator').slice(0, 80) });
    this.state.projects[p.id] = p; this.save();
    this.#emit('incubator.project_created', { projectId: p.id, name: p.name, source, requestedUsd: p.requestedUsd, regulatoryStatus: p.regulatoryReview.status });
    return this.detail(p.id);
  }

  setStack(id, body = {}) {
    const p = this.#project(id);
    if (p.mode !== SIM || (body.mode && body.mode !== SIM)) throw new ProjectError(409, 'Stack changes are SIMULATION-only.');
    const { ok, errors, stack } = validateStack({ targetUsd: body.targetUsd ?? p.stack.targetUsd, sources: body.sources ?? p.stack.sources, terms: body.terms ?? p.stack.terms });
    if (!ok) throw new ProjectError(400, 'Capital stack invalid.', { errors });
    let states = rebaseStates(p.capitalStates, stack);
    const errs = [];
    for (const [src, patch] of Object.entries(body.capitalStates || {})) {
      const r = setSourceStates(states, stack, src, patch);
      if (!r.ok) errs.push(...r.errors); else states = r.states;
    }
    errs.push(...checkStates(states, stack));
    if (errs.length) throw new ProjectError(400, 'Capital states invalid.', { errors: [...new Set(errs)] });
    // Proprietary MATCHED+ only through the proprietary book (Commander decisions), never directly.
    const alloc = this.allocated(p.id);
    if (states.PROPRIETARY.MATCHED > alloc + 0.5) throw new ProjectError(400, 'Capital states invalid.', { errors: ['PROPRIETARY beyond REQUESTED moves only through a Commander SELECT_SUPPORT / REDEPLOY decision.'] });
    const before = this.view(p).outcome.effective;
    p.stack = stack; p.capitalStates = states;
    if (alloc > stack.sources.PROPRIETARY.usd) this.#setAllocation(p, stack.sources.PROPRIETARY.usd);
    if (p.program === 'NONE' && SOURCES.some((s) => states[s].EXECUTABLE > 0)) { p.program = 'XRP_RLUSD_INTERIM'; p.interimDays = p.interimDays || 0; }
    this.#hist(p, 'stack_changed', `Stack ${stack.combination}: target $${stack.targetUsd.toLocaleString('en-US')}.`, { actor: String(body.actor || 'operator').slice(0, 80) });
    this.save();
    this.#emit('incubator.stack_changed', { projectId: id, combination: stack.combination, targetUsd: stack.targetUsd, sources: stack.sources, capitalStates: states });
    this.#gateEvents(p, before);
    return this.detail(id);
  }

  setGates(id, body = {}) {
    const p = this.#project(id);
    if (p.mode !== SIM || (body.mode && body.mode !== SIM)) throw new ProjectError(409, 'Gate edits are SIMULATION-only.');
    const errors = [];
    const actor = String(body.actor || '').trim().slice(0, 80);
    if (!actor) errors.push('actor is required: legal and gate inputs are operator-entered.');
    let rr = null;
    if (body.regulatoryReview) { const r = validateRegulatoryReview(body.regulatoryReview); errors.push(...r.errors); rr = r.value; }
    if (body.runwayMonths != null && !(Number(body.runwayMonths) >= 0 && Number(body.runwayMonths) <= 240)) errors.push('runwayMonths must be 0–240.');
    if (body.demand?.independentParticipants != null && !(Number.isInteger(Number(body.demand.independentParticipants)) && Number(body.demand.independentParticipants) >= 0)) errors.push('demand.independentParticipants must be an integer ≥ 0.');
    if (errors.length) throw new ProjectError(400, 'Gate input invalid.', { errors });
    const before = this.view(p);
    if (rr) p.regulatoryReview = rr;
    if (body.legalItems) p.legalItems = { ...p.legalItems, ...body.legalItems };
    if (body.runwayMonths != null) p.runwayMonths = Number(body.runwayMonths);
    if (body.demand) p.demand = { verifiedEvidence: Array.isArray(body.demand.verifiedEvidence) ? body.demand.verifiedEvidence.slice(0, 20).map((e) => ({ ref: String(e.ref || '').slice(0, 80), description: String(e.description || '').slice(0, 200) })).filter((e) => e.ref) : p.demand.verifiedEvidence,
      independentParticipants: body.demand.independentParticipants != null ? Number(body.demand.independentParticipants) : p.demand.independentParticipants };
    this.#hist(p, 'gates_updated', 'Operator updated gate inputs.', { actor });
    this.save();
    this.#gateEvents(p, before.outcome.effective, before);
    return this.detail(id);
  }

  #gateEvents(p, beforeOutcome, beforeView = null) {
    const v = this.view(p);
    const b = beforeView || null;
    for (const gate of ['legal', 'economic']) {
      const from = b ? b[gate].status : null, to = v[gate].status;
      if (b && from !== to) this.#emit('incubator.gate_changed', { projectId: p.id, gate, from, to, outcome: v.outcome.effective });
    }
    if (beforeOutcome !== v.outcome.effective) this.#emit('incubator.gate_changed', { projectId: p.id, gate: 'outcome', from: beforeOutcome, to: v.outcome.effective, outcome: v.outcome.effective, revoked: v.outcome.revoked });
  }

  decide(id, body = {}) {
    const p = this.#project(id);
    if (p.mode !== SIM || (body.mode && body.mode !== SIM)) throw new ProjectError(409, 'Decisions are recorded in SIMULATION only; nothing executes.');
    const type = body.type;
    if (!DECISION_TYPES.includes(type)) throw new ProjectError(400, `type must be one of ${DECISION_TYPES.join(', ')}.`);
    const actor = String(body.actor || '').trim().slice(0, 80);
    if (!actor) throw new ProjectError(400, 'actor is required (who is making this SIMULATION decision).');
    const ctx = this.spokes();
    const v = this.view(p, ctx);
    let result;
    switch (type) {
      case 'SELECT_SUPPORT': {
        const ask = p.capitalStates.PROPRIETARY.REQUESTED, cur = this.allocated(p.id);
        const add = Math.min(Math.max(0, ask - cur), this.availableUsd());
        const support = supportRecommendation(Object.values(this.state.projects).filter((q) => q.program !== 'NONE' || q.id === p.id).map((q) => this.view(q, ctx)), this.availableUsd() + cur);
        if (ask <= 0) result = { ok: false, reasons: ['This project requested no proprietary capital.'] };
        else if (add <= 0) result = { ok: false, reasons: [cur >= ask ? 'Already fully supported.' : 'No proprietary capital available: the budget is fully allocated.'] };
        else {
          this.#setAllocation(p, cur + add);
          if (!p.proprietaryInitialUsd) p.proprietaryInitialUsd = cur + add;
          result = { ok: true, allocatedUsd: cur + add, addedUsd: add, shortfallUsd: r2(ask - cur - add), followedRecommendation: support.recommended === p.id, recommendation: { recommended: support.recommended, rationale: support.rationale } };
        }
        break;
      }
      case 'BOOTSTRAP': {
        const st = p.capitalStates.PROPRIETARY;
        if (st.COMMITTED <= 0) { result = { ok: false, reasons: ['No committed proprietary capital to bootstrap. Select support first.'] }; break; }
        p.capitalStates = { ...p.capitalStates, PROPRIETARY: { ...st, FUNDED: st.COMMITTED, EXECUTABLE: st.COMMITTED } };
        if (p.program === 'NONE') p.program = 'XRP_RLUSD_INTERIM';
        result = { ok: true, executableUsd: st.COMMITTED, note: 'Proprietary support marked FUNDED and EXECUTABLE in SIMULATION. No funds moved.' };
        break;
      }
      case 'RECORD_OUTCOME': {
        const outcome = body.outcome;
        if (!OUTCOMES.includes(outcome)) throw new ProjectError(400, `outcome must be one of ${OUTCOMES.join(', ')}.`);
        const chk = outcomeAllowed(outcome, v.legal, v.economic);
        if (!chk.allowed) { result = { ok: false, reasons: chk.reasons, legalOverrideRefused: v.legal.status !== 'PASS' }; break; }
        p.recordedOutcome = { outcome, actor, at: this.now() };
        if (outcome === 'GRADUATE_TO_TOKEN_CORRIDOR' || outcome === 'RESTRICTED_MARKET_PATHWAY') {
          p.program = 'PROJECT_TOKEN_CORRIDOR'; p.stage = nextStage(p.stage) === 'spoke' ? 'spoke' : p.stage; p.maturityWeek = 0;
          if (!p.proprietaryInitialUsd) p.proprietaryInitialUsd = this.allocated(p.id);
        } else if (outcome === 'DECLINE') { p.program = 'NONE'; this.#setAllocation(p, 0); }
        else p.program = SOURCES.some((s) => p.capitalStates[s].EXECUTABLE > 0) ? 'XRP_RLUSD_INTERIM' : 'NONE';
        result = { ok: true, outcome, program: p.program, stage: p.stage };
        break;
      }
      case 'ADVANCE_MATURITY': {
        if (p.program !== 'PROJECT_TOKEN_CORRIDOR') { result = { ok: false, reasons: ['Only a graduated project-token corridor matures. This project is not in a token corridor.'] }; break; }
        if (p.maturityWeek >= MATURITY_PATH.length - 1) { result = { ok: false, reasons: ['Already at the end of the modeled maturation path.'] }; break; }
        const from = p.stage; const step = MATURITY_PATH[p.maturityWeek + 1];
        if (step.stage !== from && nextStage(from) !== step.stage) { result = { ok: false, reasons: [`Invalid corridor transition ${from} → ${step.stage}.`] }; break; }
        p.maturityWeek += 1; p.stage = step.stage;
        result = { ok: true, week: p.maturityWeek, from, to: p.stage, indepShare: step.indepShare, proprietaryNeedUsd: proprietaryNeedUsd(p.proprietaryInitialUsd || this.allocated(p.id), step.indepShare) };
        break;
      }
      case 'REDEPLOY': {
        const target = body.toProjectId ? this.state.projects[body.toProjectId] : null;
        if (body.toProjectId && !target) throw new ProjectError(400, `Unknown target project ${body.toProjectId}.`);
        if (target && target.id === p.id) throw new ProjectError(400, 'Cannot redeploy to the same project.');
        const freed = v.proprietary.freedUsd;
        if (freed <= 0) { result = { ok: false, reasons: ['No proprietary support is freed yet: independent providers have not displaced it.'] }; break; }
        // The project's proprietary request shrinks to the modeled need, so the release is not shown as a funding gap.
        p.stack = { ...p.stack, sources: { ...p.stack.sources, PROPRIETARY: { usd: v.proprietary.needUsd } } };
        p.capitalStates = { ...p.capitalStates, PROPRIETARY: { ...p.capitalStates.PROPRIETARY, REQUESTED: v.proprietary.needUsd } };
        this.#setAllocation(p, v.proprietary.needUsd);
        let moved = 0;
        if (target) {
          if (legalGate(target.regulatoryReview, target.legalItems).status === 'FAIL') { result = { ok: true, releasedUsd: freed, movedUsd: 0, reasons: ['Target legal gate FAIL: freed capital returned to the pool.'] }; break; }
          const cur = this.allocated(target.id);
          moved = Math.min(Math.max(0, target.capitalStates.PROPRIETARY.REQUESTED - cur), this.availableUsd());
          if (moved > 0) { this.#setAllocation(target, cur + moved); if (!target.proprietaryInitialUsd) target.proprietaryInitialUsd = cur + moved; this.#hist(target, 'redeploy_in', `Received $${moved.toLocaleString('en-US')} proprietary support from ${p.name} (MATCHED/COMMITTED; bootstrap separately).`, { actor }); }
        }
        result = { ok: true, releasedUsd: freed, movedUsd: moved, toProjectId: target?.id ?? null, poolUsd: this.availableUsd(), note: 'SIMULATION: proprietary support reduced as the corridor matured and moved to the next opportunity. No funds moved.' };
        break;
      }
      case 'APPLY_RECOMMENDATION': {
        const recs = recommend({ ...v, nextOpportunity: this.#nextOpportunity(p.id, ctx) });
        const r = recs.find((x) => x.id === body.recommendationId);
        if (!r) { result = { ok: false, reasons: [`Recommendation ${body.recommendationId} is not currently proposed.`] }; break; }
        result = { ok: r.guardian.allowed, acknowledged: r.kind, guardian: r.guardian, corridorTransition: r.corridorTransition, note: 'Acknowledged as a SIMULATION record. Use the specific decision (outcome, maturity, redeploy) to change state; nothing executes.' };
        break;
      }
      case 'TRANSFER_REQUEST': {
        const chk = custodyCheck({ source: body.source, to: body.to, amountUsd: Number(body.amountUsd), ownerAuthorization: body.ownerAuthorization });
        if (!chk.allowed) this.state.custodyAttempts.push({ at: this.now(), projectId: p.id, actor, source: body.source, to: body.to, amountUsd: Number(body.amountUsd) || 0, violations: chk.violations });
        result = { ok: chk.allowed, ...chk };
        break;
      }
    }
    const dec = { id: `dec-${++this.state.seq}`, projectId: p.id, type, actor, at: this.now(), mode: SIM, executes: false,
      payload: Object.fromEntries(Object.entries(body).filter(([k]) => !['actor', 'type', 'mode'].includes(k))), result };
    this.state.decisions.push(dec);
    if (this.state.decisions.length > 500) this.state.decisions.shift();
    this.#hist(p, 'decision', `${type} by ${actor}: ${result.ok ? 'recorded' : 'refused'}.`, { actor, decisionId: dec.id });
    this.save();
    this.#emit('incubator.decision', { projectId: p.id, decisionId: dec.id, decisionType: type, actor, ok: !!result.ok, outcome: result.outcome ?? null, executes: false });
    if (type === 'RECORD_OUTCOME' && result.ok) this.#emit('incubator.gate_changed', { projectId: p.id, gate: 'outcome', from: v.outcome.effective, to: result.outcome, outcome: result.outcome, recordedBy: actor });
    return { decision: dec, project: this.detail(p.id) };
  }

  // ---------- Read-only aggregates ----------
  radar() {
    const ctx = this.spokes();
    const items = radarFromSpokes(ctx.spokes);
    const linked = Object.values(this.state.projects).filter((p) => p.radarId).map((p) => p.radarId);
    return { mode: 'MAINNET_OBSERVED', items: items.map((x) => ({ ...x, inIntake: linked.includes(x.id) })), rlusdContext: rlusdContext(ctx.spokes, { xrpUsd: ctx.xrpUsd ?? null }),
      attributionHtml: ctx.attributionHtml || '<a href="https://xrpl.to" target="_blank" rel="noopener">Data by xrpl.to</a>', note: 'Thin-liquidity radar over the 26-spoke data (read-only). Discovery is not endorsement; a radar item enters the same intake, gates and lifecycle as a requested project.' };
  }

  compare(a, b) {
    const ctx = this.spokes();
    const pa = this.#project(a), pb = this.#project(b);
    const va = this.view(pa, ctx), vb = this.view(pb, ctx);
    const row = (v) => {
      const p = v.project;
      return { id: p.id, name: p.name, source: p.source, stage: p.stage, program: p.program, outcome: v.outcome.effective, computedOutcome: v.outcome.computed,
        legal: v.legal.status, economic: v.economic.status, regulatoryStatus: p.regulatoryReview.status, combination: p.stack.combination, targetUsd: p.stack.targetUsd,
        executableUsd: Object.fromEntries(SOURCES.map((s) => [s, p.capitalStates[s].EXECUTABLE])), requestedUsd: Object.fromEntries(SOURCES.map((s) => [s, p.capitalStates[s].REQUESTED])),
        netMmReturnUsd: v.perf.totals.netMmReturnUsd, unrecoveredCostsUsd: v.perf.totals.unrecoveredCostsUsd, inventoryAppreciationUsd: v.perf.totals.inventoryAppreciationUsd,
        proprietaryAskUsd: p.capitalStates.PROPRIETARY.REQUESTED, proprietaryAllocatedUsd: v.proprietary.allocatedUsd, fundingGaps: fundingGaps(p.capitalStates, p.stack).length };
    };
    const support = supportRecommendation([va, vb], this.availableUsd() + this.allocated(a) + this.allocated(b));
    return { mode: SIM, a: row(va), b: row(vb), support, proprietary: { budgetUsd: this.state.proprietary.budgetUsd, availableUsd: this.availableUsd(), allocations: { ...this.state.proprietary.allocations } }, disclaimer: DISCLAIMER };
  }

  // Concerns for the Sentinel findings registry (the lead wires these into lib/findings).
  sentinelSignals() {
    const ctx = this.spokes();
    const out = [];
    const sig = (p, key, severity, title, product, evidence, remediation) => out.push({ key: `incubator:${p.id}:${key}`, title, severity, category: 'incubator', product, market: p.id,
      verification: 'SIMULATED', provenance: 'SIMULATION', evidence, remediation, observedAt: this.now() });
    for (const p of Object.values(this.state.projects)) {
      const v = this.view(p, ctx);
      for (const g of fundingGaps(p.capitalStates, p.stack)) {
        if (g.kind === 'NOT_YET_EXECUTABLE') continue;
        sig(p, `unfunded:${g.source}`, g.kind === 'DECLINED' ? 'medium' : 'low', `${p.name}: ${SOURCE_DEFS[g.source].label} ${g.kind === 'DECLINED' ? 'declined' : 'under-matched'}`, SOURCE_DEFS[g.source].product,
          [{ label: g.kind, value: g.text }], 'Do not present requested capital as committed; seek additional funding or resize the stack.');
      }
      if (v.legal.status !== 'PASS') sig(p, 'legal_gate', v.legal.status === 'FAIL' ? 'high' : 'info', `${p.name}: legal gate ${v.legal.status}`, 'TGLB',
        v.legal.reasons.map((r) => ({ label: 'legal', value: r })), 'Keep the token corridor closed until reviewer input documents every legal item.');
      const exec = SOURCES.map((s) => ({ s, usd: p.capitalStates[s].EXECUTABLE })); const tot = exec.reduce((a, x) => a + x.usd, 0);
      const top = exec.sort((x, y) => y.usd - x.usd)[0];
      if (tot > 0 && top.usd / tot > 0.5) sig(p, `concentration:${top.s}`, 'medium', `${p.name}: ${top.s} supplies ${(top.usd / tot * 100).toFixed(0)}% of executable capital`, SOURCE_DEFS[top.s].product,
        [{ label: 'share', value: `${(top.usd / tot * 100).toFixed(1)}%` }], 'Diversify sources before graduation.');
      if (p.stack.sources.T3.usd > 0) {
        const t3 = p.stack.terms.T3 || {};
        sig(p, 't3_credit_risk', t3.underwriting === 'DECLINED' || t3.creditRisk === 'ELEVATED' ? 'medium' : 'low', `${p.name}: Tier 3 credit risk (${t3.creditRisk || 'UNRATED'}, underwriting ${t3.underwriting})`, 'TGLB',
          [{ label: 'T3 requested', value: `$${p.stack.sources.T3.usd.toLocaleString('en-US')}` }, { label: 'Native lending', value: nativeLendingStatus(this.amendmentCheck).status }], 'Track creditor exposure separately from TGLW liquidity; SIMULATION only.');
      }
      for (const a of this.state.custodyAttempts.filter((x) => x.projectId === p.id).slice(-5)) {
        sig(p, `custody:${a.at}`, 'high', `${p.name}: custody-boundary violation attempted (${a.source} → ${a.to})`, SOURCE_DEFS[a.source]?.product || 'TGLW',
          a.violations.map((x) => ({ label: 'refused', value: x })), 'Refused at the custody boundary; nothing moved. Review who attempted it.');
      }
    }
    for (const l of Object.values(this.state.loans || {})) {
      const market = l.projectId || l.id;
      for (const x of l.result?.signals || []) out.push({ key: `incubator:${market}:${x.kind}:${l.id}`, title: x.title, severity: x.severity, category: 'incubator', product: 'TGLB', market,
        verification: 'SIMULATED', provenance: 'SIMULATION', evidence: [...x.evidence, { label: 'model', value: LENDING_LABEL }], remediation: x.remediation, observedAt: l.updatedAt || this.now() });
    }
    return { mode: SIM, signals: out, note: 'SIMULATION concerns for the Sentinel findings registry. Read-only; nothing here records findings itself.' };
  }

  // ---------- Tier 3 lending (XLS-65/66-style simulation; records only, nothing lent or moved) ----------
  #loanView(l) { return { ...l.result, id: l.id, projectId: l.projectId, actor: l.actor, createdAt: l.createdAt, updatedAt: l.updatedAt, scenarioName: l.scenario, mode: SIM, label: LENDING_LABEL }; }
  loans() { return { mode: SIM, label: LENDING_LABEL, loans: Object.values(this.state.loans).map((l) => this.#loanView(l)) }; }
  loan(id) { const l = this.state.loans[id]; if (!l) throw new ProjectError(404, `Unknown loan ${id}.`); return this.#loanView(l); }

  loanApply(body = {}) {
    if (body.mode && body.mode !== SIM) throw new ProjectError(409, 'Loans are SIMULATION-only.');
    const actor = String(body.actor || '').trim().slice(0, 80);
    if (!actor) throw new ProjectError(400, 'actor is required (who records this SIMULATION application).');
    if (body.projectId && !this.state.projects[body.projectId]) throw new ProjectError(400, `Unknown project ${body.projectId}.`);
    const input = { application: body.application || {}, vault: body.vault || {}, terms: body.terms || {} };
    const result = simulateLoan({ ...input, scenario: 'CURRENT', amendmentCheck: this.amendmentCheck });
    if (!result.ok) throw new ProjectError(400, 'Loan application invalid.', { errors: result.errors });
    const id = body.id && /^loan-[a-z0-9-]{2,40}$/.test(body.id) ? body.id : `loan-${++this.state.seq}`;
    const at = this.now();
    this.state.loans[id] = { id, projectId: body.projectId || null, actor, createdAt: at, updatedAt: at, input, scenario: 'CURRENT', result };
    this.save();
    const uw = result.underwriting;
    this.#emit('incubator.loan_applied', { loanId: id, projectId: body.projectId || null, borrower: result.application.borrower, principalUsd: result.application.principalUsd, actor, label: LENDING_LABEL });
    this.#emit('incubator.loan_underwritten', { loanId: id, decision: uw.decision, score: uw.score, grade: uw.grade, aprBps: uw.aprBps, approvedPrincipalUsd: uw.approvedPrincipalUsd, knockouts: uw.knockouts, label: LENDING_LABEL });
    return this.loan(id);
  }

  loanScenario(id, body = {}) {
    if (body.mode && body.mode !== SIM) throw new ProjectError(409, 'Loans are SIMULATION-only.');
    const l = this.state.loans[id]; if (!l) throw new ProjectError(404, `Unknown loan ${id}.`);
    const scenario = body.scenario;
    if (!SCENARIOS.includes(scenario)) throw new ProjectError(400, `scenario must be one of ${SCENARIOS.join(', ')}.`);
    const terms = { ...l.input.terms, ...(body.terms || {}) };
    const result = simulateLoan({ ...l.input, terms, scenario, scenarioOpts: body.scenarioOpts || {}, amendmentCheck: this.amendmentCheck });
    if (!result.ok) throw new ProjectError(400, 'Scenario invalid.', { errors: result.errors });
    Object.assign(l, { scenario, result, updatedAt: this.now() });
    this.save();
    const sc = result.scenario;
    this.#emit('incubator.loan_scenario', { loanId: id, scenario, status: sc?.status || 'DECLINED', label: LENDING_LABEL });
    if (sc?.defaulted) this.#emit('incubator.loan_defaulted', { loanId: id, eadUsd: sc.ead.totalUsd, netLossUsd: result.waterfall.netLossUsd, firstLossAbsorbedUsd: result.waterfall.firstLossAbsorbedUsd,
      reserveAbsorbedUsd: result.waterfall.reserveAbsorbedUsd, lenderLossUsd: result.waterfall.lenderLossUsd, label: LENDING_LABEL });
    if (sc?.status === 'REPAID' || sc?.status === 'REPAID_WITH_LATE_PAYMENT') this.#emit('incubator.loan_repaid', { loanId: id, status: sc.status, paidInterestUsd: sc.paidInterestUsd, feesUsd: sc.feesUsd, penaltyInterestUsd: sc.penaltyInterestUsd, label: LENDING_LABEL });
    if (result.useOfProceeds && !result.useOfProceeds.ok) this.#emit('incubator.loan_breach', { loanId: id, breaches: result.useOfProceeds.breaches.map((b) => ({ use: b.use, usd: b.usd })), label: LENDING_LABEL });
    return this.loan(id);
  }

  // Deterministic pitch run: records the demo Tier 3 loan (fixed id), plays the default stress case and returns the walkthrough.
  bootstrapDemoRun(body = {}) {
    const actor = String(body.actor || 'Commander').trim().slice(0, 80) || 'Commander';
    const t3 = DEMO_PROJECT.tiers.T3;
    delete this.state.loans['loan-demo-dhc'];
    this.loanApply({ id: 'loan-demo-dhc', actor, application: { borrower: DEMO_PROJECT.name, principalUsd: t3.usd, legalStatus: 'OPEN', ...t3.application }, vault: t3.vault });
    this.loanScenario('loan-demo-dhc', { scenario: 'DEFAULT', scenarioOpts: { missFromPeriod: 3 }, terms: { collateralHaircut: 0.6 } });
    this.#emit('incubator.decision', { projectId: null, decisionId: null, decisionType: 'BOOTSTRAP_DEMO', actor, ok: true, outcome: null, executes: false });
    return { ...demoWalkthrough(), loan: this.loan('loan-demo-dhc') };
  }

  setAmendmentCheck(check) { this.amendmentCheck = check; this.state.amendmentCheck = check; this.save(); return check; }
  meta() { return { sources: SOURCE_DEFS, capitalStates: CAPITAL_STATES, tierCombinations: TIER_COMBINATIONS, outcomes: OUTCOMES, decisionTypes: DECISION_TYPES, stages: STAGES, narratives: NARRATIVES, disclaimer: DISCLAIMER, interimDisclaimer: INTERIM_DISCLAIMER, engine: getEngine().info(), proprietary: { budgetUsd: this.state.proprietary.budgetUsd, availableUsd: this.availableUsd(), allocations: { ...this.state.proprietary.allocations } }, tier3: { nativeLending: nativeLendingStatus(this.amendmentCheck), amendmentCheck: this.amendmentCheck } }; }
}
