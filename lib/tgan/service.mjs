// TGAN service: operator records + demo scenario, persisted to data/tgan.json (in memory on TF_READONLY instances).
// Nothing here holds a ledger handle, signs, submits, bills or moves funds. All records are SIMULATION / HYPOTHETICAL.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SEED_ADVISORS, advisorView, validateVerification } from './advisors.mjs';
import { defaultGovernance, evaluateAction, gatesAfterAdvisorApproval, ACTIONS, SOURCES, LEGAL_GATE_RULE } from './governance.mjs';
import { computePerformance, checkReported, periodsFromIncubatorInterim } from './performance.mjs';
import { calculateFee, validateFeeConfig, feeEligibility, WORKED_EXAMPLE } from './fee.mjs';
import { computeSignals } from './signals.mjs';
import { buildRevenue } from './revenue.mjs';
import { ProjectSource } from './projects.mjs';

export const NOTICE = 'HACKATHON DEMONSTRATION of a possible future compliant advisory model. Every advisor, approval and fee is HYPOTHETICAL and fictional. Neither GYW1313 nor any advisor shown is represented as a registered investment adviser. Nothing is billed, collected or executed.';
export const REVIEW_DECISIONS = ['RECOMMENDED', 'APPROVED_HYPOTHETICAL', 'REJECTED', 'WITHDRAWN'];
const SEED_AT = '2026-10-24T09:00:00.000Z';

export function seedState() {
  return {
    version: 1, seededAt: SEED_AT,
    verifications: {}, legalReview: null, clientCriteria: [],
    assignments: [
      { projectId: 'demo-aurora', advisorId: 'adv-demo-a', at: SEED_AT, seed: true },
      { projectId: 'demo-aurora', advisorId: 'adv-demo-b', at: SEED_AT, seed: true },
      { projectId: 'demo-beacon', advisorId: 'adv-demo-a', at: SEED_AT, seed: true },
      { projectId: 'demo-beacon', advisorId: 'adv-demo-c', at: SEED_AT, seed: true },
    ],
    authorizations: [
      { id: 'auth-seed-1', projectId: 'demo-aurora', advisorId: 'adv-demo-a', ownerId: 'demo-owner-t1-01', tier: 'T1', actions: ['RECOMMEND'], reference: 'DEMO-OWNER-AUTH-001', grantedAt: SEED_AT, seed: true, hypothetical: true },
    ],
    proposals: [
      { id: 'prop-seed-1', projectId: 'demo-aurora', advisorId: 'adv-demo-a', actionType: 'RECOMMEND', asset: 'XRP', capitalSource: 'T1', ownerId: 'demo-owner-t1-01', amountUsd: 10_000, rationale: 'Deepen XRP side of the incubation book with the owner-authorized T1 wallet.', at: SEED_AT, review: { status: 'PENDING' }, seed: true },
      { id: 'prop-seed-2', projectId: 'demo-aurora', advisorId: 'adv-demo-a', actionType: 'REBALANCE', asset: 'RLUSD', capitalSource: 'T2', ownerId: 'demo-owner-t2-07', amountUsd: 15_000, rationale: 'Shift committed T2 liquidity toward RLUSD.', at: SEED_AT, review: { status: 'PENDING' }, seed: true },
      { id: 'prop-seed-3', projectId: 'demo-aurora', advisorId: 'adv-demo-a', actionType: 'DEPLOY', asset: 'XRP', capitalSource: 'T3', use: 'XRP_RLUSD_INCUBATION_LIQUIDITY', amountUsd: 20_000, rationale: 'Use Tier 3 vault funds for incubation liquidity (permitted use).', at: SEED_AT, review: { status: 'PENDING' }, seed: true },
      { id: 'prop-seed-4', projectId: 'demo-aurora', advisorId: 'adv-demo-b', actionType: 'RECOMMEND', asset: 'RLUSD', capitalSource: 'PROJECT', amountUsd: 5_000, rationale: 'Hold project treasury in RLUSD during incubation.', at: SEED_AT, review: { status: 'PENDING' }, seed: true },
      { id: 'prop-seed-5', projectId: 'demo-beacon', advisorId: 'adv-demo-c', actionType: 'RECOMMEND', asset: 'XRP', capitalSource: 'PROJECT', amountUsd: 25_000, rationale: 'Post-graduation XRP reserve for the corridor.', at: SEED_AT, review: { status: 'PENDING' }, seed: true },
    ],
    reports: [
      { id: 'rep-seed-1', projectId: 'demo-aurora', advisorId: 'adv-demo-b', reportedNetPnlUsd: 12_000, reportedReturnPct: 12, at: SEED_AT, seed: true, note: 'Demo scenario: an advisor report that overstates results.' },
    ],
    feeConfigs: [
      { id: 'fee-seed-1', projectId: 'demo-beacon', advisorId: 'adv-demo-a', ratePct: 10, measurementPeriod: 'QUARTERLY', feeBasis: 'NET_INVESTMENT_GAIN', expenseTreatment: 'DEDUCT_FROM_GAIN', priorLossCarryforward: 0, at: SEED_AT, seed: true },
    ],
    rejectedFeeAttempts: [],
  };
}

const id = (p) => `${p}-${crypto.randomBytes(4).toString('hex')}`;
const clip = (s, n = 200) => String(s ?? '').slice(0, n);

export class TganService {
  constructor({ file = null, persist = false, bus = null, projects = new ProjectSource(), now = () => new Date().toISOString(), log = () => {} } = {}) {
    Object.assign(this, { file, persist, bus, projects, now, log });
    this.state = seedState();
    if (file) {
      try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); if (s?.version === 1) this.state = { ...seedState(), ...s }; }
      catch (e) { if (e.code !== 'ENOENT') log(`could not read ${file}: ${e.message}; using seed state`); }
    }
  }
  save() {
    if (!this.persist || !this.file) return;
    try { const tmp = `${this.file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2)); fs.renameSync(tmp, this.file); }
    catch (e) { this.log(`save failed: ${e.message}`); }
  }
  publish(type, payload) { try { this.bus?.publish(type, 'SIMULATION', { ...payload, hypothetical: true }); } catch {} }
  reset() { this.state = seedState(); this.save(); return { ok: true }; }

  // ---------- advisors ----------
  advisorMap() { return new Map(SEED_ADVISORS.map((a) => [a.id, advisorView(a, this.state.verifications[a.id])])); }
  advisors() { return [...this.advisorMap().values()].map((a) => ({ ...a, assignments: this.state.assignments.filter((x) => x.advisorId === a.id).map((x) => x.projectId) })); }
  advisor(aid) { return this.advisors().find((a) => a.id === aid) || null; }
  recordVerification(aid, body) {
    if (!SEED_ADVISORS.some((a) => a.id === aid)) return { status: 404, error: `Unknown advisor ${aid}` };
    if (body?.clear === true) { delete this.state.verifications[aid]; this.save(); return { status: 200, advisor: this.advisor(aid) }; }
    const v = validateVerification(body);
    if (!v.ok) return { status: 400, errors: v.errors };
    this.state.verifications[aid] = { ...v.value, recordedAt: this.now(), recordedBy: 'operator:localhost' };
    this.save();
    return { status: 200, advisor: this.advisor(aid) };
  }

  // ---------- legal review / criteria ----------
  eligibility() { return feeEligibility(this.state.legalReview); }
  recordLegalReview(b = {}) {
    if (b.clear === true) { this.state.legalReview = null; this.save(); return { status: 200, eligibility: this.eligibility() }; }
    const errors = ['reference', 'date', 'reviewer'].filter((k) => typeof b[k] !== 'string' || !b[k].trim()).map((k) => `${k} is required.`);
    if (errors.length) return { status: 400, errors };
    this.state.legalReview = { reference: clip(b.reference, 120), date: clip(b.date, 40), reviewer: clip(b.reviewer, 120), scope: clip(b.scope || 'entity, client, asset class, agreement, federal/state rules', 300), recordedAt: this.now() };
    this.save();
    return { status: 200, eligibility: this.eligibility() };
  }
  setClientCriteria(list) {
    if (!Array.isArray(list)) return { status: 400, errors: ['criteria must be an array of { label, value }.'] };
    this.state.clientCriteria = list.slice(0, 12).filter((c) => c && String(c.label || '').trim()).map((c) => ({ label: clip(c.label, 120), value: clip(c.value, 120), source: clip(c.source, 200), note: 'Operator-entered. Verify with counsel; values change.' }));
    this.save();
    return { status: 200, criteria: this.state.clientCriteria };
  }

  // ---------- projects / portfolios ----------
  async projectList() { return this.projects.list(); }
  async loadProject(pid) { return this.projects.get(pid); }
  assigned(pid, aid) { return this.state.assignments.some((x) => x.projectId === pid && x.advisorId === aid); }

  evaluate(project, governance, advisors, p) {
    return evaluateAction({ project, governance, advisor: advisors.get(p.advisorId), assigned: this.assigned(project.id, p.advisorId), authorizations: this.state.authorizations, action: p, now: this.now() });
  }

  async portfolio(pid) {
    const got = await this.loadProject(pid);
    if (!got) return null;
    const { project } = got;
    const governance = defaultGovernance(project);
    const advisors = this.advisorMap();
    const proposals = this.state.proposals.filter((p) => p.projectId === pid).map((p) => ({ ...p, advisor: advisors.get(p.advisorId)?.firm || p.advisorId, evaluation: this.evaluate(project, governance, advisors, p) }));
    return {
      mode: 'SIMULATION', hypothetical: true, notice: NOTICE, projectSource: { origin: got.origin, label: got.label },
      project, governance,
      advisors: this.state.assignments.filter((x) => x.projectId === pid).map((x) => advisors.get(x.advisorId)).filter(Boolean),
      authorizations: this.state.authorizations.filter((a) => a.projectId === pid),
      proposals,
      gates: gatesAfterAdvisorApproval(project),
      feeConfigs: this.state.feeConfigs.filter((f) => f.projectId === pid),
    };
  }

  async assign(pid, b = {}) {
    const got = await this.loadProject(pid);
    if (!got) return { status: 404, error: `Unknown project ${pid}` };
    const a = this.advisorMap().get(b.advisorId);
    if (!a) return { status: 400, errors: [`Unknown advisor ${b.advisorId}`] };
    if (b.unassign === true) {
      this.state.assignments = this.state.assignments.filter((x) => !(x.projectId === pid && x.advisorId === a.id));
    } else if (!this.assigned(pid, a.id)) this.state.assignments.push({ projectId: pid, advisorId: a.id, at: this.now() });
    this.save();
    this.publish('tgan.advisor_assigned', { projectId: pid, advisorId: a.id, firm: a.firm, verification: a.verification.status, assigned: b.unassign !== true, projectSource: got.origin });
    return { status: 200, assignments: this.state.assignments.filter((x) => x.projectId === pid), advisor: a };
  }

  addAuthorization(pid, b = {}) {
    const errors = [];
    if (!['T1', 'T2'].includes(b.tier)) errors.push('tier must be T1 or T2 (participant-owned TGLW wallets).');
    if (typeof b.ownerId !== 'string' || !b.ownerId.trim()) errors.push('ownerId (the specific wallet owner granting it) is required.');
    if (!SEED_ADVISORS.some((a) => a.id === b.advisorId)) errors.push('advisorId must be a known advisor.');
    const actions = Array.isArray(b.actions) ? b.actions.filter((x) => ACTIONS.includes(x)) : [];
    if (!actions.length) errors.push(`actions must list specific actions (${ACTIONS.join(', ')}).`);
    if (typeof b.reference !== 'string' || !b.reference.trim()) errors.push('reference (the owner\'s signed authorization record) is required.');
    if (errors.length) return { status: 400, errors };
    const rec = { id: id('auth'), projectId: pid, advisorId: b.advisorId, ownerId: clip(b.ownerId, 80), tier: b.tier, actions, reference: clip(b.reference, 120), grantedAt: this.now(), expiresAt: b.expiresAt ? clip(b.expiresAt, 40) : null, hypothetical: true };
    this.state.authorizations.push(rec); this.save();
    return { status: 200, authorization: rec };
  }
  revokeAuthorization(pid, authId) {
    const a = this.state.authorizations.find((x) => x.id === authId && x.projectId === pid);
    if (!a) return { status: 404, error: `Unknown authorization ${authId}` };
    a.revokedAt = this.now(); this.save();
    return { status: 200, authorization: a };
  }

  async propose(pid, b = {}) {
    const got = await this.loadProject(pid);
    if (!got) return { status: 404, error: `Unknown project ${pid}` };
    const p = {
      id: id('prop'), projectId: pid, advisorId: String(b.advisorId || ''), actionType: String(b.actionType || 'RECOMMEND'), asset: String(b.asset || ''),
      capitalSource: String(b.capitalSource || ''), ownerId: b.ownerId ? clip(b.ownerId, 80) : undefined, use: b.use ? clip(b.use, 80) : undefined,
      amountUsd: Number(b.amountUsd), rationale: clip(b.rationale, 400), at: this.now(), review: { status: 'PENDING' },
    };
    if (!SOURCES.includes(p.capitalSource)) return { status: 400, errors: [`capitalSource must be one of ${SOURCES.join(', ')}.`] };
    const governance = defaultGovernance(got.project);
    const evaluation = this.evaluate(got.project, governance, this.advisorMap(), p);
    // Attempts are recorded even when blocked so Sentinel can see them.
    this.state.proposals.push(p); this.save();
    this.publish('tgan.recommendation', { projectId: pid, proposalId: p.id, advisorId: p.advisorId, actionType: p.actionType, asset: p.asset, capitalSource: p.capitalSource, amountUsd: p.amountUsd, status: 'PENDING', allowed: evaluation.allowed, codes: evaluation.codes, guardian: evaluation.guardian.allowed });
    return { status: 200, proposal: { ...p, evaluation } };
  }

  async review(pid, propId, b = {}) {
    const got = await this.loadProject(pid);
    if (!got) return { status: 404, error: `Unknown project ${pid}` };
    const p = this.state.proposals.find((x) => x.id === propId && x.projectId === pid);
    if (!p) return { status: 404, error: `Unknown proposal ${propId}` };
    if (!REVIEW_DECISIONS.includes(b.decision)) return { status: 400, errors: [`decision must be one of ${REVIEW_DECISIONS.join(', ')}.`] };
    const evaluation = this.evaluate(got.project, defaultGovernance(got.project), this.advisorMap(), p);
    if ((b.decision === 'RECOMMENDED' || b.decision === 'APPROVED_HYPOTHETICAL') && !evaluation.allowed) {
      return { status: 409, errors: ['Proposal is blocked; it cannot be recommended or approved.', ...evaluation.reasons], evaluation };
    }
    p.review = { status: b.decision, at: this.now(), by: 'operator:localhost', note: clip(b.note, 300), hypothetical: true, satisfiesLegalGate: false };
    this.save();
    const gates = gatesAfterAdvisorApproval(got.project, p.review);
    this.publish('tgan.recommendation', { projectId: pid, proposalId: p.id, advisorId: p.advisorId, actionType: p.actionType, asset: p.asset, capitalSource: p.capitalSource, amountUsd: p.amountUsd, status: b.decision, allowed: evaluation.allowed, codes: evaluation.codes, guardian: evaluation.guardian.allowed, legalGate: gates.legal });
    return { status: 200, proposal: { ...p, evaluation }, gates };
  }

  // ---------- performance ----------
  async performance(pid) {
    const got = await this.loadProject(pid);
    if (!got) return null;
    const perfIn = got.project.performance || {};
    let periods = [], mode = 'SIMULATION', src = got.origin, note, separate = null, priorLoss = 0;
    if (Array.isArray(perfIn.periods) && perfIn.periods.length) {
      periods = perfIn.periods; mode = perfIn.mode === 'REPLAY' ? 'REPLAY' : 'SIMULATION'; priorLoss = perfIn.priorLossCarryforward || 0;
      note = got.origin === 'INCUBATOR' ? 'From the Project Incubator\'s performance periods.' : 'TGAN FIXTURE performance (the Project Incubator API did not respond).';
    } else if (perfIn.interim) {
      const a = periodsFromIncubatorInterim(perfIn.interim);
      if (a) { periods = a.periods; separate = a.separate; note = a.note; mode = perfIn.interim.mode === 'REPLAY' ? 'REPLAY' : 'SIMULATION'; }
    }
    if (!periods.length) note = 'No SIMULATION/REPLAY performance available from the incubator for this project yet.';
    const perf = computePerformance({ periods, priorLossCarryforward: priorLoss, targetUsd: got.project.capitalStack.targetUsd, mode, source: src });
    const advisors = this.advisorMap();
    const reports = this.state.reports.filter((r) => r.projectId === pid).map((r) => ({ ...r, advisor: advisors.get(r.advisorId)?.firm || r.advisorId, check: checkReported(r, perf) }));
    // Incubator rule: unrealized marks are reported (separately), never folded into the measured gain.
    if (separate && perf.available) { perf.unrealizedPnlUsd = separate.unrealizedMarksUsd; perf.unrealizedNote = 'Incubator unrealized marks, reported separately; not included in net P&L.'; }
    return { ...perf, projectId: pid, projectSource: { origin: got.origin, label: got.label }, note, separate, reports };
  }
  async addReport(pid, b = {}) {
    const got = await this.loadProject(pid);
    if (!got) return { status: 404, error: `Unknown project ${pid}` };
    if (!SEED_ADVISORS.some((a) => a.id === b.advisorId)) return { status: 400, errors: ['advisorId must be a known advisor.'] };
    const nums = ['reportedNetPnlUsd', 'reportedEndingValueUsd', 'reportedReturnPct'].filter((k) => b[k] != null && Number.isFinite(Number(b[k])));
    if (!nums.length) return { status: 400, errors: ['Provide at least one of reportedNetPnlUsd, reportedEndingValueUsd, reportedReturnPct.'] };
    const r = { id: id('rep'), projectId: pid, advisorId: b.advisorId, at: this.now(), ...Object.fromEntries(nums.map((k) => [k, Number(b[k])])) };
    this.state.reports.push(r); this.save();
    const perf = await this.performance(pid);
    return { status: 200, report: perf.reports.find((x) => x.id === r.id) };
  }

  // ---------- fees ----------
  calculate(input, { projectId = null, publish = true } = {}) {
    const out = calculateFee(input, { legalReview: this.state.legalReview });
    if (!out.ok && out.prohibited) {
      this.state.rejectedFeeAttempts.push({ id: id('rej'), at: this.now(), prohibited: out.prohibited, projectId }); this.state.rejectedFeeAttempts = this.state.rejectedFeeAttempts.slice(-50); this.save();
    }
    if (out.ok && publish) this.publish('tgan.fee_calculated', { projectId, ratePct: out.config.ratePct, measurementPeriod: out.config.measurementPeriod, periods: out.periods.length, totalHypotheticalFeeUsd: out.totalHypotheticalFeeUsd, endingHighWaterMarkUsd: out.endingHighWaterMarkUsd, eligibility: out.eligibility.status, billed: false });
    return out;
  }
  async setFeeConfig(pid, b = {}) {
    const got = await this.loadProject(pid);
    if (!got) return { status: 404, error: `Unknown project ${pid}` };
    const v = validateFeeConfig(b);
    if (!v.ok) {
      if (v.prohibited) { this.state.rejectedFeeAttempts.push({ id: id('rej'), at: this.now(), prohibited: v.prohibited, projectId: pid }); this.save(); }
      return { status: 400, errors: v.errors };
    }
    const cfg = { id: id('fee'), projectId: pid, advisorId: b.advisorId && SEED_ADVISORS.some((a) => a.id === b.advisorId) ? b.advisorId : null, ...v.normalized, priorLossCarryforward: Number(b.priorLossCarryforward) || 0, at: this.now(), hypothetical: true };
    this.state.feeConfigs = this.state.feeConfigs.filter((f) => f.projectId !== pid).concat(cfg); this.save();
    return { status: 200, feeConfig: cfg, eligibility: this.eligibility() };
  }
  async projectFee(pid) {
    const cfg = this.state.feeConfigs.find((f) => f.projectId === pid);
    const perf = await this.performance(pid);
    if (!cfg || !perf?.available) return null;
    return this.calculate({ ...cfg, periods: perf.periods }, { projectId: pid, publish: false });
  }

  // ---------- revenue / signals ----------
  async revenue({ accessPolicy, accessError } = {}) {
    const fees = [];
    for (const f of this.state.feeConfigs) { const r = await this.projectFee(f.projectId); if (r?.ok) fees.push({ projectId: f.projectId, ...r }); }
    const rev = buildRevenue({ accessPolicy, accessError, hypotheticalFees: fees, eligibility: this.eligibility() });
    rev.streams[2].byProject = fees.map((f) => ({ projectId: f.projectId, ratePct: f.config.ratePct, hypotheticalFeeUsd: f.totalHypotheticalFeeUsd }));
    return rev;
  }
  async signals() {
    const advisors = this.advisorMap();
    const list = await this.projectList();
    const byId = new Map(list.projects.map((p) => [p.id, p]));
    const proposals = this.state.proposals.map((p) => {
      const project = byId.get(p.projectId);
      return { ...p, evaluation: project ? this.evaluate(project, defaultGovernance(project), advisors, p) : null };
    });
    const perfByProject = {};
    for (const pid of new Set(this.state.reports.map((r) => r.projectId))) if (byId.has(pid)) perfByProject[pid] = await this.performance(pid);
    const signals = computeSignals({ advisors, assignments: this.state.assignments, proposals, reports: this.state.reports, perfByProject, feeConfigs: this.state.feeConfigs, rejectedFeeAttempts: this.state.rejectedFeeAttempts, eligibility: this.eligibility() });
    return { mode: 'SIMULATION', product: 'TGAN', projectSource: list.origin, count: signals.length, signals, note: 'TGAN concerns for the Sentinel findings registry (the lead wires these into lib/findings). Observes and recommends only.' };
  }

  workedExample() { return { example: WORKED_EXAMPLE, result: calculateFee(WORKED_EXAMPLE, { legalReview: this.state.legalReview }) }; }
  overview() { return { legalGateRule: LEGAL_GATE_RULE }; }
}
