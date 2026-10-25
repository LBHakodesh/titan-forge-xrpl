// TGAN portfolio governance. PURE evaluation of proposed advisor actions; nothing executes.
// Capital-source boundaries (TIERS from public/domain.js):
//   T1 / T2  participant-owned self-custodial TGLW wallets. An advisor has NO control unless that specific owner
//            granted that specific advisor a specific authorization (project, tier, action), unrevoked and unexpired.
//   T3       underwritten lending vault: only the loan agreement's permitted uses.
//   PROJECT  the project's own treasury: only within a signed advisory agreement.
//   PROPRIETARY  Titan Ghost proprietary capital: never under advisor control (conflict boundary).
// XRP/RLUSD incubation strategy is kept separate from the project's own (unlaunched) token.
// Advisor approval NEVER satisfies a securities-offering or market-eligibility (legal) gate.
import { guardCheck } from '../guardian.mjs';
import { TIERS, MODES } from '../../public/domain.js';

export const SOURCES = ['T1', 'T2', 'T3', 'PROJECT', 'PROPRIETARY'];
export const ACTIONS = ['RECOMMEND', 'REBALANCE', 'DEPLOY', 'WITHDRAW_TO_OWNER'];
export const INCUBATION_ASSETS = ['XRP', 'RLUSD'];
export const T3_DEFAULT_USES = ['XRP_RLUSD_INCUBATION_LIQUIDITY'];
export const LEGAL_GATE_RULE = 'Advisor approval alone never satisfies a securities-offering or market-eligibility gate. TGAN cannot change the incubator\'s legal gate.';

const tierLabel = (id) => TIERS.find((t) => t.id === id)?.label || id;

export function defaultGovernance(project) {
  const incubating = project.program === 'XRP_RLUSD_INTERIM';
  return {
    projectId: project.id, mode: 'SIMULATION', hypothetical: true,
    objectives: incubating
      ? ['Bootstrap XRP/RLUSD liquidity for the project during incubation', 'Preserve participant capital; no leverage', 'Produce auditable SIMULATION/REPLAY performance before any graduation review']
      : ['Report XRP/RLUSD incubation results that preceded graduation', 'Monitor capital efficiency across tiers'],
    riskTolerance: incubating ? 'LOW' : 'MODERATE',
    authorizedAssets: INCUBATION_ASSETS,
    excludedAssets: project.token ? [{ asset: project.token, reason: 'Project token is unlaunched / handled by the incubator corridor; XRP/RLUSD incubation strategy is kept separate from it.' }] : [],
    capitalSources: {
      T1: { label: tierLabel('T1'), usd: project.capitalStack.sources.T1, ownership: 'participant-owned TGLW wallets', advisorControl: 'NONE unless the specific owner grants a specific authorization' },
      T2: { label: tierLabel('T2'), usd: project.capitalStack.sources.T2, ownership: 'participant-owned TGLW wallets (term-committed)', advisorControl: 'NONE unless the specific owner grants a specific authorization' },
      T3: { label: tierLabel('T3'), usd: project.capitalStack.sources.T3, ownership: 'underwritten lending vault', advisorControl: 'Only the loan agreement\'s permitted uses', loanAgreement: { reference: `DEMO-LOAN-${project.id}`, permittedUses: T3_DEFAULT_USES, hypothetical: true } },
      PROJECT: { label: 'Project treasury', usd: project.capitalStack.sources.PROJECT, ownership: 'project', advisorControl: 'Within a signed advisory agreement only' },
      PROPRIETARY: { label: 'Titan Ghost proprietary', usd: project.capitalStack.sources.PROPRIETARY, ownership: 'Titan Ghost', advisorControl: 'NONE (conflict-of-interest boundary)' },
    },
    legalGateRule: LEGAL_GATE_RULE,
  };
}

// Does `auths` contain a live, specific owner authorization for this action?
export function findOwnerAuthorization(auths = [], { projectId, advisorId, ownerId, tier, action }, now = new Date().toISOString()) {
  if (!ownerId) return null;
  return auths.find((a) => a.projectId === projectId && a.advisorId === advisorId && a.ownerId === ownerId && a.tier === tier
    && Array.isArray(a.actions) && a.actions.includes(action) && !a.revokedAt && (!a.expiresAt || a.expiresAt > now)) || null;
}

// evaluateAction({ project, governance, advisor (advisorView), assigned, authorizations, action }) -> verdict
// action: { advisorId, actionType, asset, capitalSource, ownerId?, use?, amountUsd }
export function evaluateAction({ project, governance, advisor, assigned, authorizations = [], action = {}, now }) {
  const reasons = [];
  const codes = new Set();
  const block = (code, msg) => { codes.add(code); reasons.push(msg); };
  const a = action;
  if (!advisor) block('UNKNOWN_ADVISOR', `Unknown advisor ${a.advisorId}.`);
  else {
    if (!advisor.verified) block('ADVISOR_UNVERIFIED', `${advisor.firm} has no recorded registration verification; it may not act (UNVERIFIED).`);
    if (!advisor.agreement?.signed) block('AGREEMENT_UNSIGNED', `${advisor.firm}'s advisory agreement record is not signed.`);
    if (!assigned) block('NOT_ASSIGNED', `${advisor.firm} is not assigned to ${project.id}.`);
  }
  if (!ACTIONS.includes(a.actionType)) block('BAD_ACTION', `actionType must be one of ${ACTIONS.join(', ')}.`);
  if (project.token && a.asset === project.token) block('PROJECT_TOKEN_SEPARATE', `${a.asset} is the project's own token; XRP/RLUSD incubation strategy proposals are kept separate from it.`);
  else if (!governance.authorizedAssets.includes(a.asset)) block('ASSET_NOT_AUTHORIZED', `Asset ${a.asset} is not authorized (allowed: ${governance.authorizedAssets.join(', ')}).`);
  const src = governance.capitalSources[a.capitalSource];
  if (!src) block('BAD_SOURCE', `capitalSource must be one of ${SOURCES.join(', ')}.`);
  let authorization = null;
  if (a.capitalSource === 'T1' || a.capitalSource === 'T2') {
    authorization = findOwnerAuthorization(authorizations, { projectId: project.id, advisorId: a.advisorId, ownerId: a.ownerId, tier: a.capitalSource, action: a.actionType }, now);
    if (!authorization) block('NO_OWNER_AUTHORIZATION', `${a.capitalSource} wallets are participant-owned TGLW: no authorization from ${a.ownerId ? `owner ${a.ownerId}` : 'a named owner'} for ${a.advisorId} to ${a.actionType} on ${project.id}.`);
  }
  if (a.capitalSource === 'T3' && !src.loanAgreement.permittedUses.includes(a.use)) block('T3_USE_NOT_PERMITTED', `Tier 3 funds may only be used for ${src.loanAgreement.permittedUses.join(', ')} under loan agreement ${src.loanAgreement.reference}; requested use: ${a.use || '(none)'}.`);
  if (a.capitalSource === 'PROPRIETARY') block('PROPRIETARY_NO_CONTROL', 'Titan Ghost proprietary capital is never under advisor control.');
  const amountUsd = Number(a.amountUsd);
  if (src && Number.isFinite(amountUsd) && amountUsd > src.usd) block('EXCEEDS_SOURCE', `Amount ${amountUsd} exceeds the ${a.capitalSource} allocation ${src.usd}.`);
  const guardian = guardCheck({ mode: MODES.SIM, amountUsd: Number.isFinite(amountUsd) ? amountUsd : -1, requiresApproval: true, approved: false });
  return {
    mode: 'SIMULATION', allowed: reasons.length === 0 && guardian.allowed, reasons, codes: [...codes], guardian,
    authorization: authorization ? { id: authorization.id, ownerId: authorization.ownerId, tier: authorization.tier, actions: authorization.actions, reference: authorization.reference } : null,
    executes: false, satisfiesLegalGate: false,
    note: 'Even an allowed proposal is only a SIMULATION recommendation: nothing is signed, submitted or moved.',
  };
}

// Advisor approval and the incubator's gates: the gates come back unchanged, always.
export function gatesAfterAdvisorApproval(project, _approval) {
  return { legal: project.gates.legal, economic: project.gates.economic, changed: false, rule: LEGAL_GATE_RULE };
}

// Requests that try to use an advisor approval to satisfy a gate are refused.
export function gateOverrideAttempt(body = {}) {
  const keys = ['gate', 'gates', 'legalGate', 'satisfiesGate', 'satisfiesLegalGate', 'marketEligibility', 'offeringApproval'];
  return keys.some((k) => body[k] !== undefined && body[k] !== false && body[k] !== null);
}
