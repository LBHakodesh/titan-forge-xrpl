// TGLB Tier 3 lending: an "XLS-65/66-style simulation" (pure; no network, no ledger, no signing).
//
// XLS-65 (Single Asset Vault) and XLS-66 (Lending Protocol) are XRPL amendment proposals. They are NOT enabled on
// XRPL Testnet (see amendments.mjs, recorded read-only check) and, even if they were, this app is NOT authorized to
// use them. Everything below models the same concepts (a lender vault, a loan, interest, repayment, default, first
// loss) as application-level SIMULATION. `nativeLendingDecision()` makes that rule explicit and testable.
//
// FORMULAS (documented, deterministic, simple interest, no compounding):
//   Interest (day count 30/360):      I = P × (aprBps / 10,000) × days / 360
//   Monthly period (30 days):          I_m = balance_open × aprBps / 10,000 / 12
//   AMORTIZING (straight-line):        principal_m = P / termMonths (last period absorbs rounding)
//   INTEREST_ONLY_BULLET:              principal_m = 0, except the final period repays P
//   Late (per missed payment):         lateFee = overdue × lateFeeBps / 10,000;
//                                      penaltyInterest = overdue × (aprBps + penaltyBps) / 10,000 × daysLate / 360
//   Default trigger:                   daysPastDue ≥ DEFAULT_DPD (90 = three missed monthly payments)
//   Exposure at default (EAD):         outstanding principal + accrued unpaid interest (incl. penalty interest)
//   Loss waterfall:                    collateralRecovery = min(EAD, collateral × (1 − haircut))
//                                      unsecuredRecovery  = (EAD − collateralRecovery) × unsecuredRecoveryRate
//                                      netLoss = max(0, EAD − collateralRecovery − unsecuredRecovery + workoutCost)
//                                      netLoss absorbed by: 1) sponsor first-loss tranche, 2) TGLB reserve,
//                                      3) senior vault lenders pro rata to their deposits.
import { nativeLendingStatus, RECORDED_CHECK } from './amendments.mjs';

export const LENDING_LABEL = 'XLS-65/66-style simulation';
export const LENDING_MODE = 'SIMULATION';
export const DAY_BASIS = 360;
export const DEFAULT_DPD = 90;
export const PERMITTED_USES = ['MARKET_MAKING_INVENTORY', 'CORRIDOR_RESERVE', 'HEDGING_COLLATERAL'];
export const RESTRICTED_USES = ['PROJECT_OPEX', 'TOKEN_BUYBACK', 'TEAM_COMPENSATION', 'TREASURY_TRANSFER', 'OTHER'];
export const ALL_USES = [...PERMITTED_USES, ...RESTRICTED_USES];
export const STRUCTURES = ['AMORTIZING', 'INTEREST_ONLY_BULLET'];
export const SCENARIOS = ['CURRENT', 'LATE', 'DEFAULT', 'RESTRICTED_USE_BREACH'];
export const PRICING = { baseBps: 600, premiumPerPointBps: 10, conditionalExtraBps: 200, conditionalPrincipalPct: 0.75, stressAddBps: 500 };
export const DEFAULT_TERMS = { lateFeeBps: 200, penaltyBps: 400, collateralHaircut: 0.3, unsecuredRecoveryRate: 0.2, workoutCostPct: 0.05 };
export const CONCENTRATION = { lenderShareMax: 0.5, loanToVaultMax: 0.4 };
export const DISCLOSURE = `${LENDING_LABEL}. Tier 3 is formal creditor financing (underwriting, permitted uses, repayment obligations), modeled in application logic. Native XRPL vault/lending primitives (XLS-65 Single Asset Vault, XLS-66 Lending Protocol) are not used: they are not enabled on Testnet and not authorized here. Nothing is lent, signed or moved.`;

const r2 = (x) => Math.round(x * 100) / 100;
const num = (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

// Native primitives are used ONLY if verified enabled AND explicitly authorized. Neither holds here.
export function nativeLendingDecision(check = RECORDED_CHECK, { authorized = false } = {}) {
  const st = nativeLendingStatus(check);
  const enabled = st.status !== 'UNAVAILABLE';
  const useNative = enabled && authorized === true;
  return { useNative, enabled, authorized: authorized === true, status: st.status, mode: useNative ? 'NATIVE' : LENDING_MODE, label: LENDING_LABEL,
    reason: useNative ? 'Enabled and authorized.' : !enabled ? 'Single Asset Vault / Lending Protocol not enabled on XRPL Testnet: simulated.' : 'Enabled on Testnet but not authorized for this app: simulated.' };
}

// ---------- Interest ----------
export function accrueInterest(principalUsd, aprBps, days) {
  if (!(principalUsd >= 0 && aprBps >= 0 && days >= 0)) throw new Error('accrueInterest: non-negative inputs required');
  return r2(principalUsd * (aprBps / 10_000) * days / DAY_BASIS);
}

// ---------- Repayment schedule ----------
export function repaymentSchedule({ principalUsd, aprBps, termMonths, structure = 'AMORTIZING' }) {
  if (!(principalUsd > 0) || !(aprBps >= 0) || !(Number.isInteger(termMonths) && termMonths >= 1)) throw new Error('repaymentSchedule: invalid inputs');
  if (!STRUCTURES.includes(structure)) throw new Error(`structure must be one of ${STRUCTURES.join(', ')}`);
  const rows = [];
  let bal = principalUsd;
  const straight = r2(principalUsd / termMonths);
  for (let m = 1; m <= termMonths; m++) {
    const interest = accrueInterest(bal, aprBps, 30);
    let principal = structure === 'AMORTIZING' ? (m === termMonths ? r2(bal) : straight) : (m === termMonths ? r2(bal) : 0);
    const payment = r2(principal + interest);
    const closing = r2(bal - principal);
    rows.push({ period: m, day: m * 30, openingUsd: r2(bal), interestUsd: interest, principalUsd: principal, paymentUsd: payment, closingUsd: closing });
    bal = closing;
  }
  const totalInterestUsd = r2(rows.reduce((s, r) => s + r.interestUsd, 0));
  return { structure, principalUsd: r2(principalUsd), aprBps, termMonths, dayBasis: `30/${DAY_BASIS}`, rows, totalInterestUsd, totalPaidUsd: r2(principalUsd + totalInterestUsd), mode: LENDING_MODE, label: LENDING_LABEL,
    formula: 'I_m = opening balance × APR / 12 (simple interest, 30/360, no compounding).' };
}

// ---------- Application ----------
export function validateLoanApplication(b = {}) {
  const errors = [];
  const v = {
    borrower: String(b.borrower || '').trim().slice(0, 80),
    principalUsd: num(b.principalUsd), termMonths: num(b.termMonths ?? 12), structure: b.structure || 'AMORTIZING',
    requestedAprBps: num(b.requestedAprBps ?? 900),
    permittedUses: Array.isArray(b.permittedUses) && b.permittedUses.length ? b.permittedUses.map(String) : ['MARKET_MAKING_INVENTORY'],
    collateralUsd: num(b.collateralUsd ?? 0), monthlyRevenueUsd: num(b.monthlyRevenueUsd ?? 0), monthlyOpexUsd: num(b.monthlyOpexUsd ?? 0),
    existingDebtUsd: num(b.existingDebtUsd ?? 0), runwayMonths: num(b.runwayMonths ?? 0), operatingHistoryMonths: num(b.operatingHistoryMonths ?? 0),
    legalStatus: ['PASS', 'RESTRICTED', 'OPEN', 'FAIL'].includes(b.legalStatus) ? b.legalStatus : 'OPEN',
  };
  if (v.borrower.length < 2) errors.push('borrower (project name) is required.');
  if (!(fin(v.principalUsd) && v.principalUsd > 0 && v.principalUsd <= 100_000_000)) errors.push('principalUsd must be > 0 and ≤ 100,000,000.');
  if (!(Number.isInteger(v.termMonths) && v.termMonths >= 1 && v.termMonths <= 120)) errors.push('termMonths must be an integer 1–120.');
  if (!STRUCTURES.includes(v.structure)) errors.push(`structure must be one of ${STRUCTURES.join(', ')}.`);
  if (!(fin(v.requestedAprBps) && v.requestedAprBps >= 0 && v.requestedAprBps <= 10_000)) errors.push('requestedAprBps must be 0–10,000.');
  for (const k of ['collateralUsd', 'monthlyRevenueUsd', 'monthlyOpexUsd', 'existingDebtUsd', 'runwayMonths', 'operatingHistoryMonths']) if (!(fin(v[k]) && v[k] >= 0)) errors.push(`${k} must be a number ≥ 0.`);
  const unknown = v.permittedUses.filter((u) => !ALL_USES.includes(u));
  if (unknown.length) errors.push(`Unknown use(s): ${unknown.join(', ')}.`);
  return { ok: errors.length === 0, errors, value: v };
}

// ---------- Underwriting: transparent scorecard (max 100) ----------
const band = (x, steps) => { for (const [min, pts] of steps) if (x >= min) return pts; return 0; };
export const SCORECARD = [
  { id: 'dscr', label: 'Debt service coverage (stress rate)', max: 25, rule: '≥1.50 → 25 · ≥1.25 → 18 · ≥1.00 → 8 · else 0 (knockout < 1.00)' },
  { id: 'collateral', label: 'Collateral coverage', max: 20, rule: '≥1.5× → 20 · ≥1.0× → 14 · ≥0.5× → 6 · else 0' },
  { id: 'runway', label: 'Runway vs loan term', max: 15, rule: 'runway ≥ term → 15 · ≥ term/2 → 8 · else 0' },
  { id: 'legal', label: 'Legal readiness (operator input)', max: 15, rule: 'PASS 15 · RESTRICTED 8 · OPEN 4 · FAIL 0 (knockout)' },
  { id: 'history', label: 'Operating history', max: 10, rule: '≥24 mo → 10 · ≥12 → 6 · ≥6 → 3 · else 0' },
  { id: 'use', label: 'Use of proceeds', max: 10, rule: 'only permitted liquidity uses → 10 · any restricted use → 0 (knockout)' },
  { id: 'leverage', label: 'Existing leverage (debt / annual revenue)', max: 5, rule: '≤0.25 → 5 · ≤0.50 → 3 · else 0' },
];

export function underwrite(app) {
  const a = app;
  const stressApr = a.requestedAprBps + PRICING.stressAddBps;
  const firstPayment = repaymentSchedule({ principalUsd: a.principalUsd, aprBps: stressApr, termMonths: a.termMonths, structure: a.structure }).rows[0].paymentUsd;
  const noi = a.monthlyRevenueUsd - a.monthlyOpexUsd;
  const dscr = firstPayment > 0 ? r2(noi / firstPayment) : 0;
  const coll = a.principalUsd > 0 ? a.collateralUsd / a.principalUsd : 0;
  const lev = a.monthlyRevenueUsd > 0 ? a.existingDebtUsd / (a.monthlyRevenueUsd * 12) : (a.existingDebtUsd > 0 ? Infinity : 0);
  const restricted = a.permittedUses.filter((u) => !PERMITTED_USES.includes(u));
  const pts = {
    dscr: band(dscr, [[1.5, 25], [1.25, 18], [1.0, 8]]),
    collateral: band(coll, [[1.5, 20], [1.0, 14], [0.5, 6]]),
    runway: a.runwayMonths >= a.termMonths ? 15 : a.runwayMonths >= a.termMonths / 2 ? 8 : 0,
    legal: { PASS: 15, RESTRICTED: 8, OPEN: 4, FAIL: 0 }[a.legalStatus],
    history: band(a.operatingHistoryMonths, [[24, 10], [12, 6], [6, 3]]),
    use: restricted.length ? 0 : 10,
    leverage: lev <= 0.25 ? 5 : lev <= 0.5 ? 3 : 0,
  };
  const value = { dscr: `${dscr.toFixed(2)}× (NOI $${Math.round(noi).toLocaleString('en-US')} / payment $${Math.round(firstPayment).toLocaleString('en-US')} at ${stressApr} bps)`,
    collateral: `${coll.toFixed(2)}×`, runway: `${a.runwayMonths} mo vs ${a.termMonths} mo term`, legal: a.legalStatus, history: `${a.operatingHistoryMonths} mo`,
    use: a.permittedUses.join(', '), leverage: Number.isFinite(lev) ? `${lev.toFixed(2)}×` : 'debt with no revenue' };
  const factors = SCORECARD.map((f) => ({ ...f, points: pts[f.id], value: value[f.id] }));
  const score = factors.reduce((s, f) => s + f.points, 0);
  const knockouts = [];
  if (a.legalStatus === 'FAIL') knockouts.push('Legal readiness FAIL (operator input).');
  if (dscr < 1) knockouts.push(`DSCR ${dscr.toFixed(2)} < 1.00 at the stress rate.`);
  if (restricted.length) knockouts.push(`Restricted use of proceeds requested: ${restricted.join(', ')}.`);
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
  let decision = knockouts.length ? 'DECLINED' : score >= 70 ? 'APPROVED' : score >= 55 ? 'APPROVED_WITH_CONDITIONS' : 'DECLINED';
  const conditional = decision === 'APPROVED_WITH_CONDITIONS';
  const aprBps = decision === 'DECLINED' ? null : PRICING.baseBps + (100 - score) * PRICING.premiumPerPointBps + (conditional ? PRICING.conditionalExtraBps : 0);
  const approvedPrincipalUsd = decision === 'DECLINED' ? 0 : r2(a.principalUsd * (conditional ? PRICING.conditionalPrincipalPct : 1));
  const conditions = conditional ? [`Principal reduced to ${PRICING.conditionalPrincipalPct * 100}% of the request.`, `+${PRICING.conditionalExtraBps} bps conditional pricing.`, 'Monthly reporting of use of proceeds to the lending partner.'] : [];
  return { decision, score, maxScore: 100, grade, factors, knockouts, conditions, aprBps, approvedPrincipalUsd, stressAprBps: stressApr, dscr,
    pricingRule: `APR = ${PRICING.baseBps} bps + (100 − score) × ${PRICING.premiumPerPointBps} bps${conditional ? ` + ${PRICING.conditionalExtraBps} bps (conditional)` : ''}`,
    thresholds: 'score ≥ 70 APPROVED · 55–69 APPROVED_WITH_CONDITIONS · < 55 DECLINED · any knockout DECLINED', mode: LENDING_MODE, label: LENDING_LABEL };
}

// ---------- Scenarios: current / late / default ----------
// opts: { missFromPeriod, missedCount (LATE), lateDays (LATE), lateFeeBps, penaltyBps }
export function simulateScenario(schedule, scenario = 'CURRENT', opts = {}) {
  if (!SCENARIOS.includes(scenario)) throw new Error(`scenario must be one of ${SCENARIOS.join(', ')}`);
  const t = { ...DEFAULT_TERMS, ...opts };
  const apr = schedule.aprBps;
  const from = Math.min(Math.max(1, opts.missFromPeriod ?? Math.ceil(schedule.termMonths / 2)), schedule.termMonths);
  const events = [];
  let paidPrincipal = 0, paidInterest = 0, fees = 0, penalty = 0;
  if (scenario === 'CURRENT' || scenario === 'RESTRICTED_USE_BREACH') {
    for (const r of schedule.rows) { paidPrincipal += r.principalUsd; paidInterest += r.interestUsd; events.push({ period: r.period, day: r.day, kind: 'PAID', amountUsd: r.paymentUsd }); }
    return { scenario, status: 'REPAID', events, paidPrincipalUsd: r2(paidPrincipal), paidInterestUsd: r2(paidInterest), feesUsd: 0, penaltyInterestUsd: 0, defaulted: false, ead: null,
      lenderIncomeUsd: r2(paidInterest), mode: LENDING_MODE, label: LENDING_LABEL };
  }
  if (scenario === 'LATE') {
    const lateDays = Math.min(opts.lateDays ?? 20, DEFAULT_DPD - 1);
    for (const r of schedule.rows) {
      if (r.period === from) {
        const fee = r2(r.paymentUsd * t.lateFeeBps / 10_000);
        const pen = r2(r.paymentUsd * (apr + t.penaltyBps) / 10_000 * lateDays / DAY_BASIS);
        fees += fee; penalty += pen;
        events.push({ period: r.period, day: r.day, kind: 'MISSED', amountUsd: r.paymentUsd, daysPastDue: 0 });
        events.push({ period: r.period, day: r.day + lateDays, kind: 'CURED_LATE', amountUsd: r2(r.paymentUsd + fee + pen), lateFeeUsd: fee, penaltyInterestUsd: pen, daysPastDue: lateDays });
      } else events.push({ period: r.period, day: r.day, kind: 'PAID', amountUsd: r.paymentUsd });
      paidPrincipal += r.principalUsd; paidInterest += r.interestUsd;
    }
    return { scenario, status: 'REPAID_WITH_LATE_PAYMENT', lateDays, events, paidPrincipalUsd: r2(paidPrincipal), paidInterestUsd: r2(paidInterest), feesUsd: r2(fees), penaltyInterestUsd: r2(penalty),
      defaulted: false, ead: null, lenderIncomeUsd: r2(paidInterest + fees + penalty), mode: LENDING_MODE, label: LENDING_LABEL,
      formula: `lateFee = overdue × ${t.lateFeeBps} bps; penalty = overdue × (${apr} + ${t.penaltyBps}) bps × ${lateDays}/360` };
  }
  // DEFAULT: payments stop at `from`; default declared at daysPastDue ≥ 90.
  const missed = schedule.rows.filter((r) => r.period >= from);
  for (const r of schedule.rows) if (r.period < from) { paidPrincipal += r.principalUsd; paidInterest += r.interestUsd; events.push({ period: r.period, day: r.day, kind: 'PAID', amountUsd: r.paymentUsd }); }
  const dueDay = schedule.rows[from - 1].day;
  const defaultDay = dueDay + DEFAULT_DPD;
  let accrued = 0;
  for (const r of missed) {
    if (r.day > defaultDay) break;
    events.push({ period: r.period, day: r.day, kind: 'MISSED', amountUsd: r.paymentUsd, daysPastDue: r.day - dueDay });
  }
  const outstanding = r2(schedule.principalUsd - paidPrincipal);
  // Contract interest accrues on the outstanding principal from the last paid period to the default day; penalty on overdue instalments.
  const lastPaidDay = from > 1 ? schedule.rows[from - 2].day : 0;
  accrued = accrueInterest(outstanding, apr, defaultDay - lastPaidDay);
  const overdueInstalments = missed.filter((r) => r.day <= defaultDay);
  for (const r of overdueInstalments) penalty += r2(r.paymentUsd * t.penaltyBps / 10_000 * (defaultDay - r.day) / DAY_BASIS);
  penalty = r2(penalty);
  const ead = r2(outstanding + accrued + penalty);
  events.push({ period: null, day: defaultDay, kind: 'DEFAULT', amountUsd: ead, daysPastDue: DEFAULT_DPD });
  return { scenario, status: 'DEFAULTED', events, paidPrincipalUsd: r2(paidPrincipal), paidInterestUsd: r2(paidInterest), feesUsd: 0, penaltyInterestUsd: penalty, defaulted: true,
    defaultDay, missFromPeriod: from, ead: { outstandingPrincipalUsd: outstanding, accruedInterestUsd: accrued, penaltyInterestUsd: penalty, totalUsd: ead },
    lenderIncomeUsd: r2(paidInterest), mode: LENDING_MODE, label: LENDING_LABEL,
    formula: `default at ${DEFAULT_DPD} days past due; EAD = outstanding principal + interest accrued (${apr} bps, 30/360) + penalty interest` };
}

// ---------- Vault (lender side) + loss waterfall ----------
export function validateVault(v = {}) {
  const lenders = (Array.isArray(v.lenders) && v.lenders.length ? v.lenders : [{ id: 'lender-a', usd: 100_000 }]).map((l, i) => ({ id: String(l.id || `lender-${i + 1}`).slice(0, 40), usd: Number(l.usd) || 0 }));
  const errors = [];
  if (lenders.some((l) => !(l.usd >= 0))) errors.push('Each lender deposit must be ≥ 0.');
  const firstLossUsd = Number(v.firstLossUsd ?? 0), reserveUsd = Number(v.reserveUsd ?? 0);
  if (!(firstLossUsd >= 0) || !(reserveUsd >= 0)) errors.push('firstLossUsd and reserveUsd must be ≥ 0.');
  const depositsUsd = r2(lenders.reduce((s, l) => s + l.usd, 0));
  if (!(depositsUsd > 0)) errors.push('Vault needs deposits > 0.');
  return { ok: errors.length === 0, errors, vault: { lenders, depositsUsd, firstLossUsd, reserveUsd, firstLossProvider: v.firstLossProvider || 'Project sponsor (subordinated)', mode: LENDING_MODE, label: LENDING_LABEL } };
}

export function lossWaterfall({ eadUsd, collateralUsd = 0, vault, terms = {} }) {
  const t = { ...DEFAULT_TERMS, ...terms };
  const collateralRecoveryUsd = r2(Math.min(eadUsd, collateralUsd * (1 - t.collateralHaircut)));
  const unsecuredRecoveryUsd = r2((eadUsd - collateralRecoveryUsd) * t.unsecuredRecoveryRate);
  const workoutCostUsd = r2(eadUsd * t.workoutCostPct);
  const netLossUsd = r2(Math.max(0, eadUsd - collateralRecoveryUsd - unsecuredRecoveryUsd + workoutCostUsd));
  let rem = netLossUsd;
  const firstLossAbsorbedUsd = r2(Math.min(rem, vault.firstLossUsd)); rem = r2(rem - firstLossAbsorbedUsd);
  const reserveAbsorbedUsd = r2(Math.min(rem, vault.reserveUsd)); rem = r2(rem - reserveAbsorbedUsd);
  const lenderLossUsd = r2(Math.min(rem, vault.depositsUsd));
  const perLender = vault.lenders.map((l) => ({ id: l.id, depositUsd: l.usd, lossUsd: r2(lenderLossUsd * (l.usd / vault.depositsUsd)), lossPct: r2((lenderLossUsd / vault.depositsUsd) * 100) }));
  const steps = [
    { step: 'Exposure at default', usd: r2(eadUsd) },
    { step: `Collateral recovery (haircut ${t.collateralHaircut * 100}%)`, usd: -collateralRecoveryUsd },
    { step: `Unsecured recovery (${t.unsecuredRecoveryRate * 100}% of remainder)`, usd: -unsecuredRecoveryUsd },
    { step: `Workout cost (${t.workoutCostPct * 100}% of EAD)`, usd: workoutCostUsd },
    { step: 'Net loss', usd: netLossUsd },
    { step: `1. First-loss tranche (${vault.firstLossProvider})`, usd: -firstLossAbsorbedUsd },
    { step: '2. TGLB reserve', usd: -reserveAbsorbedUsd },
    { step: '3. Senior vault lenders (pro rata)', usd: -lenderLossUsd },
  ];
  return { eadUsd: r2(eadUsd), collateralRecoveryUsd, unsecuredRecoveryUsd, workoutCostUsd, netLossUsd, lgdPct: eadUsd > 0 ? r2((netLossUsd / eadUsd) * 100) : 0,
    firstLossAbsorbedUsd, reserveAbsorbedUsd, lenderLossUsd, perLender, steps, assumptions: t, mode: LENDING_MODE, label: LENDING_LABEL };
}

// Expected loss for the lender view (illustrative): PD by grade × LGD from the default waterfall.
export const PD_BY_GRADE = { A: 0.02, B: 0.05, C: 0.1, D: 0.25 };

// ---------- Use-of-proceeds and concentration checks ----------
export function useOfProceedsCheck(draws = [], permittedUses = ['MARKET_MAKING_INVENTORY']) {
  const breaches = draws.filter((d) => !permittedUses.includes(d.use) || !PERMITTED_USES.includes(d.use));
  return { ok: breaches.length === 0, breaches: breaches.map((d) => ({ ...d, reason: `${d.use} is not a permitted use for Tier 3 proceeds.` })), permittedUses };
}

export function concentrationCheck(vault, principalUsd) {
  const findings = [];
  for (const l of vault.lenders) { const s = vault.depositsUsd ? l.usd / vault.depositsUsd : 0; if (s > CONCENTRATION.lenderShareMax) findings.push({ kind: 'LENDER', id: l.id, share: r2(s * 100), text: `${l.id} supplies ${(s * 100).toFixed(0)}% of vault deposits (> ${CONCENTRATION.lenderShareMax * 100}%).` }); }
  const ltv = vault.depositsUsd ? principalUsd / vault.depositsUsd : Infinity;
  if (ltv > CONCENTRATION.loanToVaultMax) findings.push({ kind: 'LOAN', share: r2(ltv * 100), text: `One loan uses ${(ltv * 100).toFixed(0)}% of vault deposits (> ${CONCENTRATION.loanToVaultMax * 100}%).` });
  return { ok: findings.length === 0, findings };
}

// ---------- One-call simulation (pure) ----------
// input: { application, vault, scenario, scenarioOpts, draws, terms }
export function simulateLoan(input = {}) {
  const app = validateLoanApplication(input.application || {});
  if (!app.ok) return { ok: false, errors: app.errors };
  const vv = validateVault(input.vault || {});
  if (!vv.ok) return { ok: false, errors: vv.errors };
  const uw = underwrite(app.value);
  const native = nativeLendingDecision(input.amendmentCheck || RECORDED_CHECK, { authorized: false });
  const base = { ok: true, application: app.value, underwriting: uw, vault: vv.vault, native, mode: LENDING_MODE, label: LENDING_LABEL, disclosure: DISCLOSURE };
  if (uw.decision === 'DECLINED') return { ...base, schedule: null, scenario: null, waterfall: null, signals: [], capital: { requestedUsd: app.value.principalUsd, committedUsd: 0, fundedUsd: 0, executableUsd: 0 } };
  const principal = Math.min(uw.approvedPrincipalUsd, vv.vault.depositsUsd);
  const schedule = repaymentSchedule({ principalUsd: principal, aprBps: uw.aprBps, termMonths: app.value.termMonths, structure: app.value.structure });
  const scenario = input.scenario || 'CURRENT';
  const sc = simulateScenario(schedule, scenario, { ...(input.terms || {}), ...(input.scenarioOpts || {}) });
  const waterfall = sc.defaulted ? lossWaterfall({ eadUsd: sc.ead.totalUsd, collateralUsd: app.value.collateralUsd, vault: vv.vault, terms: input.terms }) : null;
  const defaultCase = waterfall || lossWaterfall({ eadUsd: simulateScenario(schedule, 'DEFAULT', input.terms || {}).ead.totalUsd, collateralUsd: app.value.collateralUsd, vault: vv.vault, terms: input.terms });
  const pd = PD_BY_GRADE[uw.grade];
  const draws = scenario === 'RESTRICTED_USE_BREACH'
    ? [{ use: 'MARKET_MAKING_INVENTORY', usd: r2(principal * 0.8) }, { use: 'PROJECT_OPEX', usd: r2(principal * 0.2) }]
    : (input.draws || [{ use: app.value.permittedUses[0], usd: principal }]);
  const useCheck = useOfProceedsCheck(draws, app.value.permittedUses.filter((u) => PERMITTED_USES.includes(u)));
  const conc = concentrationCheck(vv.vault, principal);
  const signals = lendingSignals({ borrower: app.value.borrower, scenario: sc, waterfall, useCheck, conc });
  const executable = r2(draws.filter((d) => d.use === 'MARKET_MAKING_INVENTORY' && useCheck.ok).reduce((s, d) => s + d.usd, 0));
  return { ...base, schedule, scenario: sc, waterfall, useOfProceeds: { draws, ...useCheck }, concentration: conc, signals,
    lenderRisk: { pdPct: pd * 100, lgdPct: defaultCase.lgdPct, expectedLossUsd: r2(pd * defaultCase.lenderLossUsd), firstLossUsd: vv.vault.firstLossUsd, reserveUsd: vv.vault.reserveUsd,
      defaultCaseLenderLossUsd: defaultCase.lenderLossUsd, note: 'Expected loss to senior lenders = PD(grade) × lender loss in the default case (illustrative PD table).' },
    capital: { requestedUsd: app.value.principalUsd, committedUsd: principal, fundedUsd: principal, executableUsd: executable,
      note: 'Requested = application; committed = approved principal; funded = disbursed (simulated); executable = proceeds deployed to permitted market-making inventory.' } };
}

// Sentinel-style lending risks (same item shape as Incubator.sentinelSignals; caller adds key/market/observedAt).
export function lendingSignals({ borrower, scenario, waterfall, useCheck, conc }) {
  const out = [];
  if (scenario?.defaulted) out.push({ kind: 'loan_default', severity: waterfall?.lenderLossUsd > 0 ? 'high' : 'medium', title: `${borrower}: Tier 3 loan default (${LENDING_LABEL})`,
    evidence: [{ label: 'EAD', value: `$${Math.round(scenario.ead.totalUsd).toLocaleString('en-US')}` }, { label: 'Senior lender loss', value: `$${Math.round(waterfall?.lenderLossUsd || 0).toLocaleString('en-US')}` }, { label: 'First loss absorbed', value: `$${Math.round(waterfall?.firstLossAbsorbedUsd || 0).toLocaleString('en-US')}` }],
    remediation: 'Freeze further Tier 3 draws; start recovery; keep TGLW (Tier 1/2) positions separate: they are not loan collateral.' });
  if (useCheck && !useCheck.ok) out.push({ kind: 'loan_restricted_use', severity: 'high', title: `${borrower}: restricted-use breach of Tier 3 proceeds`,
    evidence: useCheck.breaches.map((b) => ({ label: b.use, value: `$${Math.round(b.usd).toLocaleString('en-US')}: ${b.reason}` })), remediation: 'Stop disbursement; require cure or accelerate under the loan agreement.' });
  for (const f of conc?.findings || []) out.push({ kind: `loan_concentration:${f.kind.toLowerCase()}${f.id ? ':' + f.id : ''}`, severity: 'medium', title: `${borrower}: lending concentration (${f.kind === 'LOAN' ? 'single loan' : 'single lender'})`,
    evidence: [{ label: 'share', value: `${f.share}%` }, { label: 'detail', value: f.text }], remediation: 'Diversify vault lenders or reduce single-loan exposure.' });
  return out;
}
