// TGAN performance reporting. PURE. Inputs come from the incubator's SIMULATION/REPLAY performance where available,
// otherwise from the labeled TGAN fixture. Nothing here reads or writes a ledger.
//
// Time-weighted return (TWR): chain-linked per-period returns, each period by Modified Dietz with flows assumed
//   mid-period. Removes the effect of the timing/size of deposits and withdrawals: measures the strategy.
// Money-weighted return (MWR): IRR over the whole horizon (per-period rate), flows mid-period. Reflects the
//   participant's actual dollar experience, so it moves with deposit/withdrawal timing.
import { calculateFee } from './fee.mjs';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 10_000) / 10_000;

export function normalizePeriods(periods = []) {
  return (Array.isArray(periods) ? periods : []).map((p, i) => ({
    label: p.label || p.period || `Period ${i + 1}`,
    beginValue: n(p.beginValue ?? p.beginningValue ?? p.begin), endValue: n(p.endValue ?? p.endingValue ?? p.end),
    deposits: n(p.deposits), withdrawals: n(p.withdrawals), expenses: n(p.expenses ?? p.costs),
    realizedPnl: p.realizedPnl ?? p.realizedPnlUsd ?? null, unrealizedPnl: p.unrealizedPnl ?? p.unrealizedPnlUsd ?? null,
    deployedUsd: p.deployedUsd ?? null,
  }));
}

function irr(flows) {
  // flows: [{ t (in periods), cf (investor perspective: contributions negative, receipts positive) }]
  const npv = (r) => flows.reduce((s, f) => s + f.cf / Math.pow(1 + r, f.t), 0);
  let lo = -0.99, hi = 10, flo = npv(lo), fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-9) return mid;
    if (fm * flo < 0) { hi = mid; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

// computePerformance({ periods, priorLossCarryforward, targetUsd, mode, source }) -> report
export function computePerformance({ periods: raw = [], priorLossCarryforward = 0, targetUsd = null, mode = 'SIMULATION', source = 'FIXTURE' } = {}) {
  const periods = normalizePeriods(raw);
  if (!periods.length) return { mode, source, available: false, note: 'No performance periods available for this project.' };
  const first = periods[0], last = periods.at(-1);
  const sum = (k) => periods.reduce((s, p) => s + n(p[k]), 0);
  const deposits = sum('deposits'), withdrawals = sum('withdrawals'), expenses = sum('expenses');
  // Gross of expenses, summed per period (each period begins at the prior period's value net of its expenses).
  const totalPnl = periods.reduce((s, p) => s + p.endValue - p.beginValue - p.deposits + p.withdrawals, 0);
  const realizedKnown = periods.every((p) => p.realizedPnl != null);
  const realized = realizedKnown ? sum('realizedPnl') : null;
  // Unrealized at the end is a point-in-time figure (mark-to-model of open positions), not a sum across periods.
  const unrealized = last.unrealizedPnl != null ? n(last.unrealizedPnl) : (realized != null ? totalPnl - realized : null);
  const netPnl = totalPnl - expenses;

  let twr = 1;
  const rows = periods.map((p, i) => {
    const flow = p.deposits - p.withdrawals;
    const denom = p.beginValue + 0.5 * flow;
    const gain = p.endValue - p.beginValue - flow - p.expenses;
    const ret = denom > 0 ? gain / denom : 0;
    twr *= 1 + ret;
    return { ...p, netFlowUsd: flow, netGainUsd: r2(gain), periodReturnPct: r4(ret * 100) };
  });
  const flows = [{ t: 0, cf: -first.beginValue }];
  periods.forEach((p, i) => {
    if (p.deposits) flows.push({ t: i + 0.5, cf: -p.deposits });
    if (p.withdrawals) flows.push({ t: i + 0.5, cf: p.withdrawals });
  });
  // Earlier periods' expenses are already reflected in the next period's (net) beginning value; only the last
  // period's expenses still need deducting from its gross ending value.
  flows.push({ t: periods.length, cf: last.endValue - last.expenses });
  const mwrPer = irr(flows);
  const mwrCum = mwrPer == null ? null : Math.pow(1 + mwrPer, periods.length) - 1;

  // HWM / prior losses: reuse the fee engine at a 0% rate so the two never disagree.
  const hwm = calculateFee({ ratePct: 0, priorLossCarryforward, periods }, {});
  const avgCapital = periods.reduce((s, p) => s + p.beginValue + 0.5 * (p.deposits - p.withdrawals), 0) / periods.length;
  const deployedKnown = periods.some((p) => p.deployedUsd != null);
  const avgDeployed = deployedKnown ? periods.reduce((s, p) => s + n(p.deployedUsd), 0) / periods.length : null;

  return {
    mode, source, available: true,
    label: `${mode} performance (${source}) — illustrative, not actual client results`,
    beginningValueUsd: first.beginValue, endingValueUsd: last.endValue, endingValueNetUsd: r2(last.endValue - last.expenses), depositsUsd: deposits, withdrawalsUsd: withdrawals,
    realizedPnlUsd: realized == null ? null : r2(realized), unrealizedPnlUsd: unrealized == null ? null : r2(unrealized),
    expensesUsd: expenses, grossPnlUsd: r2(totalPnl), netPnlUsd: r2(netPnl),
    priorLossCarryforwardUsd: n(priorLossCarryforward),
    highWaterMark: hwm.ok ? { endingHighWaterMarkUsd: hwm.endingHighWaterMarkUsd, endingCumulativeNetUsd: hwm.endingCumulativeNetUsd, unrecoveredLossUsd: r2(Math.max(0, hwm.endingHighWaterMarkUsd - hwm.endingCumulativeNetUsd)), hwmValueUsd: hwm.periods.at(-1).hwmValueUsd } : null,
    capitalEfficiency: {
      netPnlOnAverageCapitalPct: avgCapital > 0 ? r4((netPnl / avgCapital) * 100) : null,
      averageCapitalUsd: r2(avgCapital),
      averageDeployedUsd: avgDeployed == null ? null : r2(avgDeployed),
      deployedShareOfTargetPct: avgDeployed != null && targetUsd > 0 ? r4((avgDeployed / targetUsd) * 100) : null,
      note: 'Net P&L divided by average invested capital (beginning value plus half of net flows per period).',
    },
    returns: {
      timeWeightedPct: r4((twr - 1) * 100),
      moneyWeightedPct: mwrCum == null ? null : r4(mwrCum * 100),
      note: 'Time-weighted (chain-linked Modified Dietz) measures the strategy independent of deposit/withdrawal timing; money-weighted (IRR) reflects the participant\'s dollar experience and moves with flow timing. Both net of expenses.',
    },
    periods: rows,
  };
}

// Reported vs recomputed check (performance misstatement). Tolerance: $1 or 0.5% of beginning value.
export function checkReported(report, perf) {
  if (!report || !perf?.available) return null;
  const tol = Math.max(1, 0.005 * perf.beginningValueUsd);
  const diffs = [];
  if (report.reportedNetPnlUsd != null && Math.abs(n(report.reportedNetPnlUsd) - perf.netPnlUsd) > tol) diffs.push({ field: 'netPnlUsd', reported: n(report.reportedNetPnlUsd), recomputed: perf.netPnlUsd });
  if (report.reportedEndingValueUsd != null && Math.abs(n(report.reportedEndingValueUsd) - perf.endingValueUsd) > tol) diffs.push({ field: 'endingValueUsd', reported: n(report.reportedEndingValueUsd), recomputed: perf.endingValueUsd });
  if (report.reportedReturnPct != null && Math.abs(n(report.reportedReturnPct) - perf.returns.timeWeightedPct) > 0.5) diffs.push({ field: 'timeWeightedPct', reported: n(report.reportedReturnPct), recomputed: perf.returns.timeWeightedPct });
  return { matches: diffs.length === 0, diffs, toleranceUsd: r2(tol) };
}

// Adapter for the Project Incubator's performance shape:
//   performance.interim = { mode, days, daily:[{day, pnlUsd (realized spread P&L, gross of costs), xrpUsd}],
//                           totals:{ positionUsd, realizedUsd, unrealizedUsd, inventoryAppreciationUsd, costsUsd, netMmReturnUsd } }
// Builds `periodCount` equal-length measurement periods. Costs are spread pro rata by days. The incubator's rule is kept:
// inventory appreciation and unrealized marks are NOT market-making gain, so they are reported separately and are not
// in the measured (fee-relevant) gain. The incubator models no deposits/withdrawals during the interim program.
export function periodsFromIncubatorInterim(interim, periodCount = 3) {
  const daily = Array.isArray(interim?.daily) ? interim.daily : [];
  const t = interim?.totals || {};
  if (!daily.length || !(Number(t.positionUsd) > 0)) return null;
  const k = Math.max(1, Math.min(periodCount, daily.length));
  const size = Math.ceil(daily.length / k);
  const costs = n(t.costsUsd);
  let value = n(t.positionUsd);
  const periods = [];
  let costLeft = costs;
  for (let i = 0; i < daily.length; i += size) {
    const chunk = daily.slice(i, i + size);
    const realized = chunk.reduce((s, d) => s + n(d.pnlUsd), 0);
    const last = i + size >= daily.length;
    const exp = last ? r2(costLeft) : r2(costs * chunk.length / daily.length); // remainder on the last period: totals match exactly
    costLeft -= exp;
    const begin = r2(value), end = r2(value + realized);
    periods.push({ label: `Days ${chunk[0].day}–${chunk.at(-1).day}`, beginValue: begin, endValue: end, deposits: 0, withdrawals: 0, expenses: exp, realizedPnl: r2(realized), unrealizedPnl: 0, deployedUsd: n(t.positionUsd) });
    value = end - exp;
  }
  return {
    periods,
    separate: { unrealizedMarksUsd: n(t.unrealizedUsd), inventoryAppreciationUsd: n(t.inventoryAppreciationUsd), incubatorNetMmReturnUsd: t.netMmReturnUsd ?? null, t3InterestUsd: t.t3InterestUsd ?? null },
    note: `Built from the incubator's ${daily.length}-day ${interim.mode || 'SIMULATION'} interim XRP/RLUSD program: ${periods.length} measurement periods, realized spread P&L less pro-rata costs. Inventory appreciation and unrealized marks are reported separately and not counted as gain (incubator rule).`,
  };
}
