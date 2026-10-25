// TGLB Tier 3 lending: XLS-65/66-style simulation. Deterministic, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accrueInterest, repaymentSchedule, validateLoanApplication, underwrite, simulateScenario, validateVault, lossWaterfall, simulateLoan,
  nativeLendingDecision, useOfProceedsCheck, concentrationCheck, LENDING_LABEL, DEFAULT_DPD, SCORECARD, PRICING,
} from '../lib/incubator/lending.mjs';
import { RECORDED_CHECK } from '../lib/incubator/amendments.mjs';

const APP = { borrower: 'Test Co', principalUsd: 120_000, termMonths: 12, requestedAprBps: 900, collateralUsd: 150_000, monthlyRevenueUsd: 60_000, monthlyOpexUsd: 35_000,
  existingDebtUsd: 20_000, runwayMonths: 24, operatingHistoryMonths: 36, legalStatus: 'PASS', permittedUses: ['MARKET_MAKING_INVENTORY'] };
const VAULT = { lenders: [{ id: 'a', usd: 150_000 }, { id: 'b', usd: 100_000 }, { id: 'c', usd: 50_000 }], firstLossUsd: 15_000, reserveUsd: 5_000 };

test('simple interest: I = P × APR × days / 360, no compounding', () => {
  assert.equal(accrueInterest(100_000, 1200, 30), 1000);
  assert.equal(accrueInterest(100_000, 1200, 360), 12_000);
  assert.equal(accrueInterest(100_000, 1200, 720), 24_000); // linear, not compounded
  assert.equal(accrueInterest(0, 1200, 30), 0);
  assert.throws(() => accrueInterest(-1, 100, 1));
});

test('amortizing schedule: straight-line principal, interest on opening balance, balance reaches 0', () => {
  const s = repaymentSchedule({ principalUsd: 120_000, aprBps: 1200, termMonths: 12, structure: 'AMORTIZING' });
  assert.equal(s.rows.length, 12);
  assert.equal(s.rows[0].interestUsd, 1200); // 120k × 1%
  assert.equal(s.rows[0].principalUsd, 10_000);
  assert.equal(s.rows[11].interestUsd, 100); // 10k × 1%
  assert.equal(s.rows[11].closingUsd, 0);
  assert.equal(Math.round(s.rows.reduce((a, r) => a + r.principalUsd, 0)), 120_000);
  assert.equal(s.totalInterestUsd, 7800); // 1% × (120+110+…+10)k = 1% × 780k
  assert.equal(s.totalPaidUsd, 127_800);
  assert.equal(s.label, LENDING_LABEL);
});

test('interest-only bullet: flat interest, principal in the last month', () => {
  const s = repaymentSchedule({ principalUsd: 50_000, aprBps: 600, termMonths: 6, structure: 'INTEREST_ONLY_BULLET' });
  assert.ok(s.rows.slice(0, 5).every((r) => r.principalUsd === 0 && r.interestUsd === 250));
  assert.equal(s.rows[5].principalUsd, 50_000);
  assert.equal(s.totalInterestUsd, 1500);
});

test('underwriting scorecard is transparent: factor points sum to the score; knockouts decline', () => {
  const app = validateLoanApplication(APP);
  assert.ok(app.ok, app.errors.join(' '));
  const u = underwrite(app.value);
  assert.equal(u.factors.length, SCORECARD.length);
  assert.equal(u.factors.reduce((s, f) => s + f.points, 0), u.score);
  assert.equal(SCORECARD.reduce((s, f) => s + f.max, 0), 100);
  assert.equal(u.decision, 'APPROVED');
  assert.equal(u.aprBps, PRICING.baseBps + (100 - u.score) * PRICING.premiumPerPointBps);
  const bad = underwrite(validateLoanApplication({ ...APP, legalStatus: 'FAIL' }).value);
  assert.equal(bad.decision, 'DECLINED'); assert.ok(bad.knockouts.some((k) => /Legal/.test(k)));
  const opex = underwrite(validateLoanApplication({ ...APP, permittedUses: ['PROJECT_OPEX'] }).value);
  assert.equal(opex.decision, 'DECLINED'); assert.ok(opex.knockouts.some((k) => /Restricted use/.test(k)));
  const thin = underwrite(validateLoanApplication({ ...APP, monthlyRevenueUsd: 36_000 }).value);
  assert.equal(thin.decision, 'DECLINED'); assert.ok(thin.knockouts.some((k) => /DSCR/.test(k)));
});

test('conditional approval reduces principal and adds pricing', () => {
  const u = underwrite(validateLoanApplication({ ...APP, collateralUsd: 0, operatingHistoryMonths: 6, legalStatus: 'OPEN', runwayMonths: 8 }).value);
  assert.equal(u.decision, 'APPROVED_WITH_CONDITIONS');
  assert.equal(u.approvedPrincipalUsd, APP.principalUsd * PRICING.conditionalPrincipalPct);
  assert.equal(u.aprBps, PRICING.baseBps + (100 - u.score) * PRICING.premiumPerPointBps + PRICING.conditionalExtraBps);
});

test('late payment: late fee and penalty interest by the documented formula; still repaid', () => {
  const s = repaymentSchedule({ principalUsd: 120_000, aprBps: 1200, termMonths: 12 });
  const r = simulateScenario(s, 'LATE', { missFromPeriod: 3, lateDays: 18, lateFeeBps: 200, penaltyBps: 600 });
  const due = s.rows[2].paymentUsd;
  const cured = r.events.find((e) => e.kind === 'CURED_LATE');
  assert.equal(cured.lateFeeUsd, Math.round(due * 0.02 * 100) / 100);
  assert.equal(cured.penaltyInterestUsd, Math.round(due * 0.18 * 18 / 360 * 100) / 100);
  assert.equal(r.status, 'REPAID_WITH_LATE_PAYMENT');
  assert.equal(r.defaulted, false);
  assert.equal(r.paidPrincipalUsd, 120_000);
});

test('default at 90 DPD: EAD = outstanding principal + accrued interest + penalty', () => {
  const s = repaymentSchedule({ principalUsd: 120_000, aprBps: 1200, termMonths: 12 });
  const r = simulateScenario(s, 'DEFAULT', { missFromPeriod: 4, penaltyBps: 0 });
  assert.equal(r.defaulted, true);
  assert.equal(r.paidPrincipalUsd, 30_000);
  assert.equal(r.ead.outstandingPrincipalUsd, 90_000);
  assert.equal(r.defaultDay, 120 + DEFAULT_DPD);
  assert.equal(r.ead.accruedInterestUsd, accrueInterest(90_000, 1200, 210 - 90));
  assert.equal(r.ead.totalUsd, 90_000 + r.ead.accruedInterestUsd);
});

test('loss waterfall: recoveries, then first loss, then reserve, then senior lenders pro rata', () => {
  const v = validateVault(VAULT).vault;
  const w = lossWaterfall({ eadUsd: 100_000, collateralUsd: 50_000, vault: v, terms: { collateralHaircut: 0.4, unsecuredRecoveryRate: 0.1, workoutCostPct: 0.05 } });
  assert.equal(w.collateralRecoveryUsd, 30_000);
  assert.equal(w.unsecuredRecoveryUsd, 7000);
  assert.equal(w.workoutCostUsd, 5000);
  assert.equal(w.netLossUsd, 68_000);
  assert.equal(w.firstLossAbsorbedUsd, 15_000);
  assert.equal(w.reserveAbsorbedUsd, 5000);
  assert.equal(w.lenderLossUsd, 48_000);
  assert.deepEqual(w.perLender.map((l) => l.lossUsd), [24_000, 16_000, 8000]);
  assert.equal(w.firstLossAbsorbedUsd + w.reserveAbsorbedUsd + w.lenderLossUsd, w.netLossUsd);
  // Fully collateralized: first loss covers workout cost, lenders lose nothing.
  const safe = lossWaterfall({ eadUsd: 100_000, collateralUsd: 500_000, vault: v });
  assert.equal(safe.lenderLossUsd, 0);
});

test('native XLS-65/66 primitives are never used here: not enabled and not authorized', () => {
  const d = nativeLendingDecision(RECORDED_CHECK);
  assert.equal(d.useNative, false); assert.equal(d.mode, 'SIMULATION');
  const enabled = { ...RECORDED_CHECK, features: { ...RECORDED_CHECK.features, SingleAssetVault: { enabled: true }, LendingProtocol: { enabled: true } } };
  assert.equal(nativeLendingDecision(enabled).useNative, false); // enabled but not authorized
  assert.equal(nativeLendingDecision(enabled, { authorized: true }).useNative, true); // only both together
  assert.equal(simulateLoan({ application: APP, vault: VAULT }).native.useNative, false);
});

test('sentinel lending risks: default, restricted-use breach, concentration', () => {
  const def = simulateLoan({ application: { ...APP, collateralUsd: 0 }, vault: VAULT, scenario: 'DEFAULT', scenarioOpts: { missFromPeriod: 2 } });
  assert.ok(def.signals.some((s) => s.kind === 'loan_default' && s.severity === 'high'));
  assert.ok(def.waterfall.lenderLossUsd > 0);
  const br = simulateLoan({ application: APP, vault: VAULT, scenario: 'RESTRICTED_USE_BREACH' });
  assert.ok(br.signals.some((s) => s.kind === 'loan_restricted_use'));
  assert.equal(br.useOfProceeds.ok, false);
  assert.ok(br.capital.executableUsd === 0, 'breached proceeds are not executable liquidity');
  const conc = simulateLoan({ application: APP, vault: { lenders: [{ id: 'whale', usd: 250_000 }, { id: 'b', usd: 50_000 }] } });
  assert.ok(conc.signals.some((s) => s.kind.startsWith('loan_concentration:lender')));
  assert.equal(useOfProceedsCheck([{ use: 'TOKEN_BUYBACK', usd: 1 }]).ok, false);
  assert.equal(concentrationCheck(validateVault(VAULT).vault, 200_000).ok, false); // loan uses 67% of vault
});

test('loan capital categories stay separate: requested vs committed vs funded vs executable', () => {
  const r = simulateLoan({ application: { ...APP, collateralUsd: 0, operatingHistoryMonths: 6, legalStatus: 'OPEN', runwayMonths: 8 }, vault: VAULT });
  assert.equal(r.capital.requestedUsd, 120_000);
  assert.equal(r.capital.committedUsd, 90_000);
  assert.ok(r.capital.fundedUsd <= r.capital.committedUsd && r.capital.executableUsd <= r.capital.fundedUsd);
  const declined = simulateLoan({ application: { ...APP, legalStatus: 'FAIL' }, vault: VAULT });
  assert.deepEqual([declined.capital.committedUsd, declined.capital.fundedUsd, declined.capital.executableUsd], [0, 0, 0]);
  assert.equal(declined.schedule, null);
});

test('invalid applications are rejected with reasons', () => {
  const r = simulateLoan({ application: { borrower: '', principalUsd: -5, permittedUses: ['NOPE'] } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 3);
});
