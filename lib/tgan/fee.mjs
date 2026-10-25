// TGAN hypothetical performance-fee calculator. PURE: no I/O, no ledger, no billing, no fee collection.
// Every output is a HYPOTHETICAL illustration for a hackathon demonstration of a possible future compliant model.
//
// Method (cumulative-net-gain high-water mark):
//   investment gain_i = end_i - begin_i - deposits_i + withdrawals_i      (contributions/withdrawals are not gains)
//   net gain_i        = gain_i - expenses_i   (expenseTreatment DEDUCT_FROM_GAIN, default)
//                     = gain_i                (ALREADY_NET: end value already reflects expenses)
//   P_i               = P_{i-1} + net gain_i, with P_0 = -(prior loss carryforward)
//   fee base_i        = max(0, P_i - HWM_{i-1});   HWM_i = max(HWM_{i-1}, P_i);   HWM_0 = 0
//   hypothetical fee  = rate x fee base
// So prior losses must be recovered first and no gain is ever charged twice.
// The fee base is NEVER trading volume, new contributions, deposits, or RLUSD<->XRP conversion amounts.

export const SIM = 'SIMULATION';
export const ALLOWED_FEE_BASES = ['NET_INVESTMENT_GAIN'];
export const PROHIBITED_FEE_BASES = {
  VOLUME: 'Trading volume is not an investment gain; a volume-based fee rewards churn.',
  TRADING_VOLUME: 'Trading volume is not an investment gain; a volume-based fee rewards churn.',
  NEW_CONTRIBUTIONS: 'New contributions (deposits) are the client\'s own money, not a gain.',
  DEPOSITS: 'Deposits are the client\'s own money, not a gain.',
  RLUSD_XRP_CONVERSION: 'Converting RLUSD to XRP (or back) is not a gain; a conversion-based fee is prohibited here.',
  CONVERSION: 'Asset conversion (e.g. RLUSD<->XRP) is not a gain; a conversion-based fee is prohibited here.',
  GROSS_ASSETS_INFLOW: 'Asset inflows are contributions, not gains.',
};
export const EXPENSE_TREATMENTS = ['DEDUCT_FROM_GAIN', 'ALREADY_NET'];
export const MEASUREMENT_PERIODS = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL'];

export const ELIGIBILITY_NOT_ENABLED = 'NOT ENABLED — requires legal review of entity, client, asset class, agreement and applicable federal/state rules';
export const BILLING_NOTE = 'Hypothetical only. TGAN has no billing, invoicing or fee-collection path; nothing is charged, debited or transferred.';

const num = (v, d = 0) => (v == null || v === '' ? d : Number(v));
const r2 = (x) => Math.round(x * 100) / 100;
const $f = (x) => (x < 0 ? '-$' : '$') + Math.abs(r2(x)).toLocaleString('en-US');

// legalReview: operator-recorded { reference, date, reviewer } or null.
export function feeEligibility(legalReview) {
  const ok = !!(legalReview && legalReview.reference && legalReview.date && legalReview.reviewer);
  return ok
    ? { status: 'LEGAL_REVIEW_RECORDED', enabled: false, label: `Legal review recorded by operator (ref ${legalReview.reference}, ${legalReview.date}, reviewer ${legalReview.reviewer}). Still HYPOTHETICAL in this demo: no billing exists.`, legalReview }
    : { status: 'NOT_ENABLED', enabled: false, label: ELIGIBILITY_NOT_ENABLED, legalReview: null };
}

// Validate a fee configuration. Returns { ok, errors[], prohibited? }.
export function validateFeeConfig(cfg = {}) {
  const errors = [];
  const basis = String(cfg.feeBasis ?? 'NET_INVESTMENT_GAIN').toUpperCase();
  let prohibited = null;
  if (PROHIBITED_FEE_BASES[basis]) { prohibited = basis; errors.push(`Prohibited fee basis ${basis}: ${PROHIBITED_FEE_BASES[basis]}`); }
  else if (!ALLOWED_FEE_BASES.includes(basis)) errors.push(`Unknown fee basis ${basis}. Allowed: ${ALLOWED_FEE_BASES.join(', ')}.`);
  for (const k of ['includeVolume', 'includeDeposits', 'includeContributions', 'includeConversions']) {
    if (cfg[k] === true) { prohibited = prohibited || k; errors.push(`${k}=true is prohibited: fees are never based on volume, contributions or RLUSD<->XRP conversion.`); }
  }
  const rate = num(cfg.ratePct, NaN);
  if (!(rate >= 0 && rate <= 50)) errors.push('ratePct must be between 0 and 50 (illustrative).');
  const et = String(cfg.expenseTreatment ?? 'DEDUCT_FROM_GAIN').toUpperCase();
  if (!EXPENSE_TREATMENTS.includes(et)) errors.push(`expenseTreatment must be one of ${EXPENSE_TREATMENTS.join(', ')}.`);
  const mp = String(cfg.measurementPeriod ?? 'QUARTERLY').toUpperCase();
  if (!MEASUREMENT_PERIODS.includes(mp)) errors.push(`measurementPeriod must be one of ${MEASUREMENT_PERIODS.join(', ')}.`);
  for (const k of ['priorLossCarryforward', 'initialHighWaterMark']) if (cfg[k] != null && cfg[k] !== '' && !(Number(cfg[k]) >= 0)) errors.push(`${k} must be a non-negative number.`);
  return { ok: errors.length === 0, errors, prohibited, normalized: { feeBasis: basis, ratePct: rate, expenseTreatment: et, measurementPeriod: mp } };
}

// calculateFee({ ratePct, measurementPeriod, feeBasis, expenseTreatment, priorLossCarryforward, initialHighWaterMark,
//                periods:[{ label, beginValue, endValue, deposits, withdrawals, expenses }] }, { legalReview })
export function calculateFee(input = {}, { legalReview = null } = {}) {
  const v = validateFeeConfig(input);
  const periodsIn = Array.isArray(input.periods) ? input.periods.slice(0, 40) : [];
  const errors = [...v.errors];
  if (!periodsIn.length) errors.push('At least one measurement period is required.');
  periodsIn.forEach((p, i) => {
    for (const k of ['beginValue', 'endValue']) if (!(Number(p?.[k]) >= 0)) errors.push(`periods[${i}].${k} must be a non-negative number.`);
    for (const k of ['deposits', 'withdrawals', 'expenses']) if (p?.[k] != null && p[k] !== '' && !(Number(p[k]) >= 0)) errors.push(`periods[${i}].${k} must be a non-negative number.`);
  });
  if (errors.length) return { ok: false, mode: SIM, hypothetical: true, errors, prohibited: v.prohibited, eligibility: feeEligibility(legalReview) };

  const { ratePct, expenseTreatment, measurementPeriod, feeBasis } = v.normalized;
  const rate = ratePct / 100;
  const begin0 = num(periodsIn[0].beginValue);
  const priorLoss = num(input.priorLossCarryforward);
  const hwmGap = input.initialHighWaterMark != null && input.initialHighWaterMark !== '' ? Math.max(0, num(input.initialHighWaterMark) - begin0) : 0;
  const warnings = [];
  if (priorLoss > 0 && hwmGap > 0) warnings.push('Both priorLossCarryforward and initialHighWaterMark were given; the larger deficit is used (they describe the same unrecovered loss).');
  const deficit0 = Math.max(priorLoss, hwmGap);

  let P = -deficit0, hwm = 0, total = 0, prevNetEnd = null;
  const periods = periodsIn.map((p, i) => {
    const begin = num(p.beginValue), end = num(p.endValue), dep = num(p.deposits), wd = num(p.withdrawals), exp = num(p.expenses);
    if (prevNetEnd != null && Math.abs(prevNetEnd - begin) > 0.01) warnings.push(`Period ${i + 1} begins at ${begin} but the previous period ended at ${r2(prevNetEnd)} (net of expenses); check continuity.`);
    const investmentGain = end - begin - dep + wd;
    const netGain = expenseTreatment === 'DEDUCT_FROM_GAIN' ? investmentGain - exp : investmentGain;
    const netEnd = expenseTreatment === 'DEDUCT_FROM_GAIN' ? end - exp : end;
    prevNetEnd = netEnd;
    const hwmBefore = hwm;
    P += netGain;
    const feeBase = Math.max(0, P - hwmBefore);
    hwm = Math.max(hwmBefore, P);
    const fee = rate * feeBase;
    total += fee;
    // Account value the net value had to exceed this period before any fee applied (flow-adjusted HWM, in USD).
    const hwmValue = netEnd - P + hwmBefore;
    return {
      label: p.label || `Period ${i + 1}`, beginValue: begin, endValue: end, deposits: dep, withdrawals: wd, expenses: exp,
      investmentGainUsd: r2(investmentGain), netGainUsd: r2(netGain), netEndValue: r2(netEnd),
      cumulativeNetUsd: r2(P), highWaterMarkBeforeUsd: r2(hwmBefore), highWaterMarkAfterUsd: r2(hwm), hwmValueUsd: r2(hwmValue),
      unrecoveredLossUsd: r2(Math.max(0, hwmBefore - P)), feeBaseUsd: r2(feeBase), hypotheticalFeeUsd: r2(fee),
      explanation: feeBase > 0
        ? `Net gain ${$f(netGain)} lifts the cumulative net result to ${$f(P)}, above the prior high-water mark ${$f(hwmBefore)} by ${$f(feeBase)}; ${ratePct}% of that = ${$f(fee)} (hypothetical).`
        : `Cumulative net result ${$f(P)} is not above the high-water mark ${$f(hwmBefore)}; no hypothetical fee. ${P < hwmBefore ? `${$f(hwmBefore - P)} must be recovered first.` : ''}`.trim(),
    };
  });

  return {
    ok: true, mode: SIM, hypothetical: true, label: 'HYPOTHETICAL performance-fee illustration — not a fee schedule, invoice or offer',
    config: { ratePct, measurementPeriod, feeBasis, expenseTreatment, priorLossCarryforward: priorLoss, initialHighWaterMark: input.initialHighWaterMark ?? null, startingDeficitUsd: r2(deficit0) },
    periods, totalHypotheticalFeeUsd: r2(total), endingHighWaterMarkUsd: r2(hwm), endingCumulativeNetUsd: r2(P),
    excludedFromGains: ['deposits / new contributions', 'withdrawals', 'trading volume', 'RLUSD<->XRP conversion amounts'],
    warnings, eligibility: feeEligibility(legalReview), billing: { enabled: false, collectedUsd: 0, note: BILLING_NOTE },
    method: 'Cumulative net-gain high-water mark: gains net of expenses, deposits/withdrawals excluded, prior losses recovered before any fee.',
  };
}

// The worked example shown in the UI and docs.
export const WORKED_EXAMPLE = {
  ratePct: 10, measurementPeriod: 'ANNUAL', feeBasis: 'NET_INVESTMENT_GAIN', expenseTreatment: 'DEDUCT_FROM_GAIN', priorLossCarryforward: 0,
  periods: [
    { label: 'Year 1', beginValue: 100_000, endValue: 112_000, deposits: 0, withdrawals: 0, expenses: 2_000 },
    { label: 'Year 2 (falls)', beginValue: 110_000, endValue: 105_000, deposits: 0, withdrawals: 0, expenses: 0 },
    { label: 'Year 3 (recovers)', beginValue: 105_000, endValue: 113_000, deposits: 0, withdrawals: 0, expenses: 0 },
  ],
  explanation: '$100,000 grows to $112,000 with $2,000 of costs: net gain $10,000; 10% = $1,000 hypothetical fee, and the high-water mark becomes a $110,000 net value. If the account then falls to $105,000, no fee applies until it is back above $110,000; in Year 3 only the $3,000 above $110,000 counts ($300).',
};
