// TGAN Sentinel signals. PURE: derives concerns from the current TGAN state. Observes and recommends only.
// Shape is close to lib/findings records (key, title, severity, category, product, verification, provenance) so
// the lead can wire them into the findings registry; TGAN does not write to lib/findings.
import { checkReported } from './performance.mjs';

export const SIGNAL_CODES = {
  UNVERIFIED_ADVISOR_ACTING: { severity: 'high', title: 'Unverified advisor acting' },
  WALLET_ACTION_WITHOUT_OWNER_AUTH: { severity: 'high', title: 'Advisor action on a participant wallet without owner authorization' },
  CONFLICT_UNDISCLOSED: { severity: 'high', title: 'Conflict of interest not disclosed' },
  PERFORMANCE_MISSTATEMENT: { severity: 'high', title: 'Performance misstatement (reported vs recomputed mismatch)' },
  FEE_CONFIGURED_NOT_ENABLED: { severity: 'medium', title: 'Performance fee configured while fee eligibility is not enabled' },
  PROHIBITED_FEE_BASIS: { severity: 'high', title: 'Prohibited fee basis (volume, contributions or RLUSD<->XRP conversion)' },
};

const mk = (code, key, detail, extra = {}) => ({
  key: `tgan:${code}:${key}`, code, ...SIGNAL_CODES[code], detail,
  category: 'advisory-governance', product: 'TGAN', mode: 'SIMULATION', provenance: 'SIMULATION', verification: 'SIMULATED',
  hypothetical: true, recommendation: extra.recommendation || null, ...extra,
});

// ctx: { advisors: Map id->advisorView, assignments:[{projectId, advisorId}], proposals:[{..., evaluation}],
//        reports:[{projectId, advisorId, ...}], perfByProject: {id: perf}, feeConfigs:[{projectId, advisorId, feeBasis}],
//        rejectedFeeAttempts:[{...}], eligibility:{status} }
export function computeSignals(c) {
  const out = [];
  const adv = (id) => c.advisors.get(id);
  const actingBy = new Map(); // advisorId|projectId -> [what]
  const note = (advisorId, projectId, what) => { const k = `${advisorId}|${projectId}`; if (!actingBy.has(k)) actingBy.set(k, []); actingBy.get(k).push(what); };
  for (const p of c.proposals || []) note(p.advisorId, p.projectId, `proposal ${p.id}`);
  for (const r of c.reports || []) note(r.advisorId, r.projectId, `performance report ${r.id}`);
  for (const f of c.feeConfigs || []) if (f.advisorId) note(f.advisorId, f.projectId, `fee configuration ${f.id}`);
  for (const [k, whats] of actingBy) {
    const [advisorId, projectId] = k.split('|');
    const a = adv(advisorId);
    if (a && !a.verified) out.push(mk('UNVERIFIED_ADVISOR_ACTING', k, `${a.firm} (UNVERIFIED) acted on ${projectId}: ${whats.join(', ')}. Its actions are blocked and it must not be presented as a registered adviser.`, { advisorId, projectId, recommendation: 'Record a registration verification reference (operator) or remove the advisor from the project.' }));
  }
  for (const p of c.proposals || []) {
    if ((p.capitalSource === 'T1' || p.capitalSource === 'T2') && p.evaluation?.codes?.includes('NO_OWNER_AUTHORIZATION')) {
      out.push(mk('WALLET_ACTION_WITHOUT_OWNER_AUTH', p.id, `Proposal ${p.id}: ${adv(p.advisorId)?.firm || p.advisorId} proposed ${p.actionType} ${p.asset} on ${p.capitalSource} ${p.ownerId ? `wallet of ${p.ownerId}` : '(no owner named)'} for ${p.projectId} without that owner's authorization. Blocked.`, { advisorId: p.advisorId, projectId: p.projectId, proposalId: p.id, recommendation: 'Only the wallet owner can grant a specific authorization; otherwise withdraw the proposal.' }));
    }
  }
  const assignedAdvisors = new Set([...(c.assignments || []).map((x) => x.advisorId), ...[...actingBy.keys()].map((k) => k.split('|')[0])]);
  for (const id of assignedAdvisors) {
    const a = adv(id);
    for (const coi of a?.conflicts || []) if (!coi.disclosed) out.push(mk('CONFLICT_UNDISCLOSED', `${id}:${coi.id}`, `${a.firm}: "${coi.type}" is recorded but not disclosed to clients, and the advisor is assigned or acting.`, { advisorId: id, recommendation: 'Disclose the conflict in writing before any recommendation is presented.' }));
  }
  for (const r of c.reports || []) {
    const chk = checkReported(r, c.perfByProject?.[r.projectId]);
    if (chk && !chk.matches) out.push(mk('PERFORMANCE_MISSTATEMENT', r.id, `Report ${r.id} by ${adv(r.advisorId)?.firm || r.advisorId} for ${r.projectId} differs from TGAN's recomputation: ${chk.diffs.map((d) => `${d.field} reported ${d.reported} vs recomputed ${d.recomputed}`).join('; ')} (tolerance $${chk.toleranceUsd}).`, { advisorId: r.advisorId, projectId: r.projectId, reportId: r.id, diffs: chk.diffs, recommendation: 'Correct the report to the recomputed figures; label SIMULATION/REPLAY data as such.' }));
  }
  if (c.eligibility?.status !== 'LEGAL_REVIEW_RECORDED') {
    for (const f of c.feeConfigs || []) out.push(mk('FEE_CONFIGURED_NOT_ENABLED', f.id, `Fee configuration ${f.id} (${f.ratePct}% of net gain) exists for ${f.projectId} while fee eligibility is NOT ENABLED (no legal review recorded). Hypothetical only; nothing is billed.`, { projectId: f.projectId, advisorId: f.advisorId || null, recommendation: 'Keep as an illustration only, or record a legal-review reference before presenting it.' }));
  }
  for (const f of c.feeConfigs || []) if (f.prohibited) out.push(mk('PROHIBITED_FEE_BASIS', `cfg:${f.id}`, `Fee configuration ${f.id} uses prohibited basis ${f.prohibited}.`, { projectId: f.projectId }));
  for (const r of c.rejectedFeeAttempts || []) out.push(mk('PROHIBITED_FEE_BASIS', `attempt:${r.id}`, `Rejected attempt ${r.id} at ${r.at} to configure a fee on prohibited basis ${r.prohibited}${r.projectId ? ` for ${r.projectId}` : ''}.`, { projectId: r.projectId || null, recommendation: 'Fees may only be computed on net investment gain above the high-water mark.' }));
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  return out.sort((a, b) => order[a.severity] - order[b.severity] || a.key.localeCompare(b.key));
}
