// Titan Ghost Intelligence for the incubator: explainable, evidence-listed recommendations mapped onto the existing
// application-level corridor lifecycle (STAGES / lib/corridor.mjs). Every proposal gets a Guardian verdict.
// NOTHING EXECUTES: recommendations are proposals; only an explicit Commander decision records a SIMULATION change.
import { STAGES, RINGS } from '../../public/domain.js';
import { guardCheck } from '../guardian.mjs';
import { getEngine } from '../engine/index.mjs';
import { nextStage, demoteTargets, ringsActiveFor, THRESHOLDS } from '../corridor.mjs';
import { SIM, SOURCE_DEFS, fundingGaps } from './model.mjs';

export const REC_KINDS = {
  INTERIM_RLUSD_SUPPORT: 'Interim XRP/RLUSD support',
  ADDITIONAL_FUNDING: 'Seek additional funding',
  CONTINUE_OBSERVATION: 'Continue observation',
  TOKEN_CORRIDOR_ELIGIBILITY_REVIEW: 'Token-corridor eligibility review',
  RING_REINFORCEMENT: 'Ring reinforcement',
  REDUCE_PROPRIETARY: 'Reduce proprietary support',
  REDEPLOY_CAPITAL: 'Redeploy proprietary capital',
  SUSPEND_OR_REJECT: 'Suspend or reject',
};

// Beacon-style maturation path after graduation (SIMULATION). Each step is a valid corridor transition (nextStage).
export const MATURITY_PATH = [
  { week: 0, indepShare: 0.15, stage: 'spoke' },
  { week: 1, indepShare: 0.30, stage: 'growing_spoke' },
  { week: 2, indepShare: 0.45, stage: 'corridor' },
  { week: 3, indepShare: 0.60, stage: 'corridor' },
  { week: 4, indepShare: 0.75, stage: 'mature' },
];
export const PROPRIETARY_FLOOR = 0.2; // keep at least 20% of the initial support until the operator releases it

export function proprietaryNeedUsd(initialUsd, indepShare) {
  return Math.round(initialUsd * Math.max(PROPRIETARY_FLOOR, 1 - indepShare));
}

const stageLabel = (id) => STAGES.find((s) => s.id === id)?.label ?? id;
export function transition(from, to, why) {
  if (!to || to === from) return { from, to: from, kind: 'hold', fromLabel: stageLabel(from), toLabel: stageLabel(from), why };
  const kind = nextStage(from) === to ? 'promote' : demoteTargets(from).includes(to) ? 'demote' : 'invalid';
  return { from, to, kind, fromLabel: stageLabel(from), toLabel: stageLabel(to), why, ringsActive: { from: ringsActiveFor(from, 100), to: ringsActiveFor(to, 100) } };
}

function guardian(amountUsd) {
  const g = guardCheck({ mode: SIM, ...(amountUsd > 0 ? { amountUsd } : {}), requiresApproval: true, approved: false });
  return { ...g, mode: SIM, executes: false, note: g.allowed ? 'Guardian: permissible as a SIMULATION proposal. Requires an explicit Commander decision; nothing executes.' : 'Guardian refused this proposal.' };
}

function rec(kind, { rationale, evidence = [], amountUsd = null, transition: tr = null, target = null, priority = 50 }) {
  return { id: kind.toLowerCase(), kind, title: REC_KINDS[kind], rationale, evidence, amountUsd, corridorTransition: tr, target, priority,
    guardian: guardian(amountUsd), executes: false, requiresOperator: true, mode: SIM, source: 'Titan Ghost Intelligence (rule-based, explainable)' };
}

// view: { project, legal, economic, outcome, perf, rlusd, proprietary:{allocatedUsd, needUsd, freedUsd}, nextOpportunity }
export function recommend(view) {
  const { project: p, legal, economic, perf, rlusd } = view;
  const out = [];
  const stage = p.stage;
  const gaps = fundingGaps(p.capitalStates, p.stack);
  const sustain = economic.items.find((i) => i.id === 'operating_sustainability');

  if (legal.status === 'FAIL' || (economic.status === 'FAIL' && sustain?.status === 'FAIL')) {
    out.push(rec('SUSPEND_OR_REJECT', {
      rationale: legal.status === 'FAIL' ? 'The legal gate failed (operator-entered). No token corridor and no further proprietary support; release capital.' : 'Operating sustainability fails the economic gate.',
      evidence: [...legal.reasons.map((r) => ({ label: 'Legal', value: r, provenance: 'OPERATOR_INPUT' })), { label: 'Operating sustainability', value: sustain?.value, provenance: 'OPERATOR_INPUT' }],
      transition: transition(stage, demoteTargets(stage).includes('standby') ? 'standby' : stage, THRESHOLDS.standby.why), priority: 100 }));
    return out;
  }

  if (p.program !== 'PROJECT_TOKEN_CORRIDOR') {
    out.push(rec('INTERIM_RLUSD_SUPPORT', {
      rationale: 'The project\'s own-token market is not yet legally eligible or economically justified. Support a provisional XRP/RLUSD market-making program instead. This creates no market or price for the project\'s token.',
      evidence: [
        { label: 'Legal gate', value: legal.status, provenance: 'OPERATOR_INPUT' },
        { label: 'Economic gate', value: economic.status, provenance: SIM },
        rlusd?.mode === 'MAINNET_OBSERVED' ? { label: 'XRP/RLUSD spread (Mainnet)', value: `${rlusd.spreadBps} bps; ±2% depth ${Math.round(rlusd.depth2pctXrp.total).toLocaleString('en-US')} XRP`, provenance: 'MAINNET_OBSERVED' } : { label: 'XRP/RLUSD context', value: 'unavailable', provenance: 'UNAVAILABLE' },
        perf ? { label: 'Interim net MM return', value: `$${Math.round(perf.totals.netMmReturnUsd).toLocaleString('en-US')} over ${perf.days} days`, provenance: SIM } : null,
      ].filter(Boolean),
      transition: transition(stage, stage, 'Token corridor stays closed; the XRP/RLUSD interim program runs outside the token lifecycle.'), priority: 70 }));
  }

  if (gaps.length) {
    const short = gaps.reduce((s, g) => s + (g.kind === 'NOT_YET_EXECUTABLE' ? 0 : g.shortfallUsd), 0);
    out.push(rec('ADDITIONAL_FUNDING', {
      rationale: 'Requested capital is not fully matched. Shortfalls are shown honestly: requested targets are not commitments.',
      evidence: gaps.map((g) => ({ label: SOURCE_DEFS[g.source].label, value: g.text, provenance: SIM })), amountUsd: short > 0 ? Math.round(short) : null,
      transition: transition(stage, stage, 'Funding gaps do not move the corridor stage.'), priority: 60 }));
  }

  if (legal.status === 'OPEN') {
    out.push(rec('CONTINUE_OBSERVATION', {
      rationale: 'Legal review is still open. Keep observing interim performance and demand evidence; re-evaluate when the reviewer updates the record.',
      evidence: legal.reasons.map((r) => ({ label: 'Legal', value: r, provenance: 'OPERATOR_INPUT' })),
      transition: transition(stage, stage, 'Hold: legal gate OPEN.'), priority: 55 }));
  }

  if ((legal.status === 'PASS' || legal.status === 'RESTRICTED') && economic.status === 'PASS' && p.program !== 'PROJECT_TOKEN_CORRIDOR') {
    out.push(rec('TOKEN_CORRIDOR_ELIGIBILITY_REVIEW', {
      rationale: legal.status === 'PASS' ? 'Both graduation gates pass. Recommend a Commander eligibility review to graduate to a project-token corridor (Testnet demo token).' : 'Legal gate documents a restricted pathway and economics pass: review a restricted-market pathway.',
      evidence: [...legal.items.map((i) => ({ label: i.label, value: `${i.status} · ${i.docRef || 'no doc'} · ${i.reviewer || ''} ${i.date || ''}`.trim(), provenance: 'OPERATOR_INPUT' })),
        ...economic.items.map((i) => ({ label: i.label, value: `${i.status} · ${i.value}`, provenance: i.provenance }))],
      transition: transition(stage, stage === 'entered' ? 'spoke' : stage, THRESHOLDS.spoke.why), priority: 90 }));
  }

  if (p.program === 'PROJECT_TOKEN_CORRIDOR') {
    const nxt = nextStage(stage);
    if (nxt && ['spoke', 'growing_spoke', 'corridor'].includes(stage)) {
      const rings = ringsActiveFor(nxt, 100);
      out.push(rec('RING_REINFORCEMENT', {
        rationale: `Independent share is ${(view.indepShare * 100).toFixed(0)}%. Reinforce from ${ringsActiveFor(stage, 100)} to ${rings} rings as demand broadens.`,
        evidence: [{ label: 'Independent share', value: `${(view.indepShare * 100).toFixed(0)}%`, provenance: SIM }, { label: 'Next stage rule', value: THRESHOLDS[nxt]?.why || '', provenance: 'APPLICATION_LOGIC' },
          { label: 'Rings', value: RINGS.slice(0, rings).map((r) => r.id).join(', '), provenance: SIM }],
        transition: transition(stage, nxt, THRESHOLDS[nxt]?.why), priority: 65 }));
    }
    const pr = view.proprietary;
    if (pr && pr.allocatedUsd > pr.needUsd) {
      out.push(rec('REDUCE_PROPRIETARY', {
        rationale: `Independent providers now carry ${(view.indepShare * 100).toFixed(0)}% of the corridor. Proprietary support can fall from $${pr.allocatedUsd.toLocaleString('en-US')} to $${pr.needUsd.toLocaleString('en-US')}.`,
        evidence: [{ label: 'Proprietary allocated', value: `$${pr.allocatedUsd.toLocaleString('en-US')}`, provenance: SIM }, { label: 'Modeled need', value: `$${pr.needUsd.toLocaleString('en-US')} (= initial × max(${PROPRIETARY_FLOOR}, 1 − independent share))`, provenance: SIM }],
        amountUsd: pr.allocatedUsd - pr.needUsd,
        transition: transition(stage, stage === 'corridor' && view.indepShare >= 0.6 ? 'mature' : stage, THRESHOLDS.mature.why), priority: 75 }));
      if (view.nextOpportunity) {
        out.push(rec('REDEPLOY_CAPITAL', {
          rationale: `Move the freed $${(pr.allocatedUsd - pr.needUsd).toLocaleString('en-US')} of proprietary support to the next opportunity: ${view.nextOpportunity.name}.`,
          evidence: [{ label: 'Next opportunity', value: `${view.nextOpportunity.name} (${view.nextOpportunity.why})`, provenance: view.nextOpportunity.provenance || SIM }],
          amountUsd: pr.allocatedUsd - pr.needUsd, target: view.nextOpportunity.id,
          transition: transition(stage, stage, 'Redeployment changes the capital mix, not this corridor\'s stage.'), priority: 74 }));
      }
    }
  }
  return out.sort((a, b) => b.priority - a.priority);
}

// Competition: which project should limited proprietary capital support? Explainable score.
export function supportRecommendation(views, availableUsd) {
  const rows = views.map((v) => {
    const ev = [];
    let score = 0;
    const L = { PASS: 3, RESTRICTED: 1, OPEN: 0, FAIL: -10 }[v.legal.status] ?? 0; score += L; ev.push(`Legal gate ${v.legal.status} (${L >= 0 ? '+' : ''}${L})`);
    const E = { PASS: 2, OPEN: 0, FAIL: -2 }[v.economic.status] ?? 0; score += E; ev.push(`Economic gate ${v.economic.status} (${E >= 0 ? '+' : ''}${E})`);
    const ask = v.project.capitalStates.PROPRIETARY.REQUESTED;
    const fits = ask <= availableUsd; if (fits) { score += 1; ev.push(`Proprietary ask $${ask.toLocaleString('en-US')} fits the available $${Math.round(availableUsd).toLocaleString('en-US')} (+1)`); } else ev.push(`Proprietary ask $${ask.toLocaleString('en-US')} exceeds the available $${Math.round(availableUsd).toLocaleString('en-US')} (+0)`);
    if (v.outcome.outcome === 'GRADUATE_TO_TOKEN_CORRIDOR') { score += 1; ev.push('Graduating corridor: proprietary support is displaced by independent providers and can be redeployed (+1)'); }
    return { projectId: v.project.id, name: v.project.name, score, evidence: ev, proprietaryAskUsd: ask };
  }).sort((a, b) => b.score - a.score);
  const pick = rows[0] || null;
  return { mode: SIM, availableUsd: Math.round(availableUsd), ranked: rows, recommended: pick?.projectId ?? null,
    rationale: pick ? `Support ${pick.name}: highest readiness score (${pick.score}). ${pick.evidence.join('; ')}. The other project keeps its TGLW and project-owned capital and becomes the redeployment target as proprietary support is released.` : 'No candidates.',
    note: 'Recommendation only. The Commander may select either project; the selection is recorded as a SIMULATION decision with actor and timestamp.' };
}

export function engineLabel() { return getEngine().info().label; }
