// TGAN tests: deterministic, no network, no ledger. Every advisor, approval and fee is HYPOTHETICAL.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calculateFee, validateFeeConfig, feeEligibility, WORKED_EXAMPLE, ELIGIBILITY_NOT_ENABLED, PROHIBITED_FEE_BASES,
  computePerformance, checkReported, periodsFromIncubatorInterim, evaluateAction, defaultGovernance, gatesAfterAdvisorApproval, gateOverrideAttempt, findOwnerAuthorization,
  advisorView, SEED_ADVISORS, verificationView, computeSignals, buildRevenue, normalizeProject, FIXTURE_PROJECTS, ProjectSource, TganService, isLocalRequest,
} from '../lib/tgan/index.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = '2026-10-24T12:00:00.000Z';
const bus = () => { const events = []; return { events, publish: (type, mode, payload) => events.push({ type, mode, ...payload }) }; };
const svc = (extra = {}) => new TganService({ now: () => NOW, projects: new ProjectSource(), ...extra });
const aurora = () => normalizeProject(FIXTURE_PROJECTS[0], 'FIXTURE');
const verified = (id) => advisorView(SEED_ADVISORS.find((a) => a.id === id), { reference: 'IAPD-DEMO-1', source: 'SEC IAPD', checkedAt: '2026-10-20', reviewer: 'demo-operator' });
const P = (begin, end, extra = {}) => ({ beginValue: begin, endValue: end, deposits: 0, withdrawals: 0, expenses: 0, ...extra });

test('worked example: $100,000 -> $112,000 with $2,000 costs at 10% = $1,000 hypothetical fee; HWM 110,000', () => {
  const r = calculateFee({ ratePct: 10, periods: [WORKED_EXAMPLE.periods[0]] });
  assert.equal(r.ok, true);
  assert.equal(r.periods[0].netGainUsd, 10_000);
  assert.equal(r.totalHypotheticalFeeUsd, 1_000);
  assert.equal(r.periods[0].netEndValue, 110_000);
  assert.equal(r.hypothetical, true);
  assert.equal(r.billing.enabled, false);
  assert.equal(r.billing.collectedUsd, 0);
  const all = calculateFee(WORKED_EXAMPLE);
  assert.deepEqual(all.periods.map((p) => p.hypotheticalFeeUsd), [1_000, 0, 300]);
  assert.deepEqual(all.periods.map((p) => p.hwmValueUsd), [100_000, 110_000, 110_000]);
});

test('HWM: losses then gains across multiple periods; no fee until the loss is recovered, never charged twice', () => {
  const r = calculateFee({ ratePct: 20, periods: [P(100_000, 90_000), P(90_000, 95_000), P(95_000, 104_000), P(104_000, 101_000), P(101_000, 106_000)] });
  assert.deepEqual(r.periods.map((p) => p.cumulativeNetUsd), [-10_000, -5_000, 4_000, 1_000, 6_000]);
  assert.deepEqual(r.periods.map((p) => p.feeBaseUsd), [0, 0, 4_000, 0, 2_000]);
  assert.deepEqual(r.periods.map((p) => p.hypotheticalFeeUsd), [0, 0, 800, 0, 400]);
  assert.equal(r.totalHypotheticalFeeUsd, 1_200);
  assert.equal(r.endingHighWaterMarkUsd, 6_000);
  assert.equal(r.periods[1].unrecoveredLossUsd, 5_000);
});

test('prior-loss carryforward and initial HWM must be recovered first', () => {
  const a = calculateFee({ ratePct: 10, priorLossCarryforward: 8_000, periods: [P(100_000, 112_000)] });
  assert.equal(a.periods[0].feeBaseUsd, 4_000);
  assert.equal(a.totalHypotheticalFeeUsd, 400);
  const b = calculateFee({ ratePct: 10, initialHighWaterMark: 105_000, periods: [P(100_000, 112_000)] });
  assert.equal(b.totalHypotheticalFeeUsd, 700);
});

test('deposits and withdrawals are excluded from gains', () => {
  const dep = calculateFee({ ratePct: 10, periods: [P(100_000, 150_000, { deposits: 40_000 })] });
  assert.equal(dep.periods[0].investmentGainUsd, 10_000);
  assert.equal(dep.totalHypotheticalFeeUsd, 1_000);
  const onlyDeposit = calculateFee({ ratePct: 10, periods: [P(100_000, 160_000, { deposits: 60_000 })] });
  assert.equal(onlyDeposit.totalHypotheticalFeeUsd, 0, 'a pure contribution never creates a fee');
  const wd = calculateFee({ ratePct: 10, periods: [P(100_000, 75_000, { withdrawals: 30_000 })] });
  assert.equal(wd.periods[0].investmentGainUsd, 5_000);
  assert.equal(wd.totalHypotheticalFeeUsd, 500);
  // Expense treatment: ALREADY_NET does not deduct again.
  assert.equal(calculateFee({ ratePct: 10, expenseTreatment: 'ALREADY_NET', periods: [P(100_000, 110_000, { expenses: 2_000 })] }).totalHypotheticalFeeUsd, 1_000);
});

test('prohibited fee bases are rejected (volume, contributions, RLUSD<->XRP conversion)', () => {
  for (const basis of ['VOLUME', 'TRADING_VOLUME', 'NEW_CONTRIBUTIONS', 'DEPOSITS', 'RLUSD_XRP_CONVERSION', 'CONVERSION']) {
    const r = calculateFee({ ratePct: 10, feeBasis: basis, periods: [P(100_000, 110_000)] });
    assert.equal(r.ok, false, basis);
    assert.equal(r.prohibited, basis);
    assert.ok(PROHIBITED_FEE_BASES[basis]);
  }
  assert.equal(calculateFee({ ratePct: 10, feeBasis: 'WHATEVER', periods: [P(1, 2)] }).ok, false);
  assert.equal(validateFeeConfig({ ratePct: 10, includeVolume: true }).ok, false);
  assert.equal(validateFeeConfig({ ratePct: 10, includeConversions: true }).ok, false);
  assert.equal(validateFeeConfig({ ratePct: 10 }).ok, true);
});

test('eligibility gating: NOT ENABLED unless an operator records a legal-review reference; never billable', () => {
  const r = calculateFee(WORKED_EXAMPLE);
  assert.equal(r.eligibility.status, 'NOT_ENABLED');
  assert.equal(r.eligibility.label, ELIGIBILITY_NOT_ENABLED);
  assert.match(r.eligibility.label, /^NOT ENABLED — requires legal review of entity, client, asset class, agreement and applicable federal\/state rules$/);
  assert.equal(feeEligibility({ reference: 'X' }).status, 'NOT_ENABLED', 'partial record is not enough');
  const ok = feeEligibility({ reference: 'LR-1', date: '2026-10-24', reviewer: 'counsel (demo)' });
  assert.equal(ok.status, 'LEGAL_REVIEW_RECORDED');
  assert.equal(ok.enabled, false, 'still no billing even with a review recorded');
  const s = svc();
  assert.equal(s.recordLegalReview({ reference: 'LR-1' }).status, 400);
  assert.equal(s.recordLegalReview({ reference: 'LR-1', date: '2026-10-24', reviewer: 'demo' }).eligibility.status, 'LEGAL_REVIEW_RECORDED');
  // Client criteria are operator-entered with no defaults.
  assert.deepEqual(svc().state.clientCriteria, []);
  assert.match(s.setClientCriteria([{ label: 'Example criterion', value: 'set by operator' }]).criteria[0].note, /Verify with counsel; values change/);
});

test('advisor cannot act on T1/T2 wallets without that owner\'s specific authorization', () => {
  const project = aurora(), governance = defaultGovernance(project), advisor = verified('adv-demo-a');
  const base = { advisorId: 'adv-demo-a', actionType: 'REBALANCE', asset: 'XRP', capitalSource: 'T1', ownerId: 'owner-1', amountUsd: 1_000 };
  const auth = { id: 'a1', projectId: project.id, advisorId: 'adv-demo-a', ownerId: 'owner-1', tier: 'T1', actions: ['REBALANCE'], reference: 'R' };
  const no = evaluateAction({ project, governance, advisor, assigned: true, authorizations: [], action: base, now: NOW });
  assert.equal(no.allowed, false);
  assert.ok(no.codes.includes('NO_OWNER_AUTHORIZATION'));
  assert.equal(evaluateAction({ project, governance, advisor, assigned: true, authorizations: [auth], action: base, now: NOW }).allowed, true);
  // Specific: other owner, other tier, other action, other advisor, revoked or expired -> no.
  for (const variant of [{ ownerId: 'owner-2' }, { tier: 'T2' }, { actions: ['RECOMMEND'] }, { advisorId: 'adv-demo-c' }, { revokedAt: NOW }, { expiresAt: '2026-01-01T00:00:00Z' }]) {
    const r = evaluateAction({ project, governance, advisor, assigned: true, authorizations: [{ ...auth, ...variant }], action: base, now: NOW });
    assert.equal(r.allowed, false, JSON.stringify(variant));
  }
  assert.equal(findOwnerAuthorization([auth], { ...base, projectId: project.id, tier: 'T1', action: 'REBALANCE', ownerId: undefined }), null);
  // T2 with no owner named
  assert.ok(evaluateAction({ project, governance, advisor, assigned: true, authorizations: [auth], action: { ...base, capitalSource: 'T2', ownerId: undefined }, now: NOW }).codes.includes('NO_OWNER_AUTHORIZATION'));
  // T3 follows the loan agreement; proprietary is never under advisor control; project token kept separate.
  assert.ok(evaluateAction({ project, governance, advisor, assigned: true, action: { ...base, capitalSource: 'T3', use: 'GENERAL' } }).codes.includes('T3_USE_NOT_PERMITTED'));
  assert.equal(evaluateAction({ project, governance, advisor, assigned: true, action: { ...base, capitalSource: 'T3', use: 'XRP_RLUSD_INCUBATION_LIQUIDITY' } }).allowed, true);
  assert.ok(evaluateAction({ project, governance, advisor, assigned: true, action: { ...base, capitalSource: 'PROPRIETARY' } }).codes.includes('PROPRIETARY_NO_CONTROL'));
  assert.ok(evaluateAction({ project, governance, advisor, assigned: true, action: { ...base, capitalSource: 'PROJECT', asset: project.token } }).codes.includes('PROJECT_TOKEN_SEPARATE'));
});

test('Guardian guardCheck verdict is attached to every proposed action', () => {
  const project = aurora(), governance = defaultGovernance(project), advisor = verified('adv-demo-a');
  const ok = evaluateAction({ project, governance, advisor, assigned: true, action: { advisorId: 'adv-demo-a', actionType: 'RECOMMEND', asset: 'RLUSD', capitalSource: 'PROJECT', amountUsd: 5_000 } });
  assert.deepEqual(ok.guardian, { allowed: true, reasons: [] });
  assert.equal(ok.executes, false);
  const bad = evaluateAction({ project, governance, advisor, assigned: true, action: { advisorId: 'adv-demo-a', actionType: 'RECOMMEND', asset: 'RLUSD', capitalSource: 'PROJECT', amountUsd: -5 } });
  assert.equal(bad.guardian.allowed, false);
  assert.equal(bad.allowed, false);
});

test('advisor approval cannot satisfy the incubator legal gate', async () => {
  const project = aurora();
  assert.equal(project.gates.legal, 'PENDING');
  const g = gatesAfterAdvisorApproval(project, { status: 'APPROVED_HYPOTHETICAL' });
  assert.equal(g.legal, 'PENDING'); assert.equal(g.changed, false);
  assert.equal(gateOverrideAttempt({ decision: 'APPROVED_HYPOTHETICAL', satisfiesLegalGate: true }), true);
  assert.equal(gateOverrideAttempt({ decision: 'APPROVED_HYPOTHETICAL', gate: 'legal' }), true);
  assert.equal(gateOverrideAttempt({ decision: 'APPROVED_HYPOTHETICAL' }), false);
  // End to end through the service: verify A, approve the authorized T1 proposal, legal gate unchanged.
  const b = bus(); const s = svc({ bus: b });
  s.recordVerification('adv-demo-a', { reference: 'IAPD-DEMO', source: 'SEC IAPD', checkedAt: '2026-10-20', reviewer: 'demo' });
  const r = await s.review('demo-aurora', 'prop-seed-1', { decision: 'APPROVED_HYPOTHETICAL' });
  assert.equal(r.status, 200);
  assert.equal(r.gates.legal, 'PENDING');
  assert.equal(r.proposal.review.satisfiesLegalGate, false);
  assert.equal((await s.portfolio('demo-aurora')).project.gates.legal, 'PENDING');
  const ev = b.events.find((e) => e.type === 'tgan.recommendation');
  assert.equal(ev.mode, 'SIMULATION'); assert.equal(ev.hypothetical, true);
  // A blocked proposal cannot be approved.
  assert.equal((await s.review('demo-aurora', 'prop-seed-2', { decision: 'APPROVED_HYPOTHETICAL' })).status, 409);
});

test('unverified advisor acting raises a Sentinel signal; verification clears it', async () => {
  const s = svc();
  let sig = (await s.signals()).signals;
  assert.ok(sig.some((x) => x.code === 'UNVERIFIED_ADVISOR_ACTING' && x.advisorId === 'adv-demo-a'));
  assert.ok(sig.every((x) => x.mode === 'SIMULATION' && x.product === 'TGAN'));
  assert.equal(verificationView(undefined).status, 'UNVERIFIED');
  assert.equal(s.recordVerification('adv-demo-a', { reference: 'x' }).status, 400, 'incomplete verification refused');
  s.recordVerification('adv-demo-a', { reference: 'IAPD-DEMO', source: 'SEC IAPD', checkedAt: '2026-10-20', reviewer: 'demo' });
  sig = (await s.signals()).signals;
  assert.ok(!sig.some((x) => x.code === 'UNVERIFIED_ADVISOR_ACTING' && x.advisorId === 'adv-demo-a'));
});

test('seed scenario raises every signal type except prohibited basis, which appears on a rejected attempt', async () => {
  const b = bus(); const s = svc({ bus: b });
  const codes = new Set((await s.signals()).signals.map((x) => x.code));
  for (const c of ['UNVERIFIED_ADVISOR_ACTING', 'WALLET_ACTION_WITHOUT_OWNER_AUTH', 'CONFLICT_UNDISCLOSED', 'PERFORMANCE_MISSTATEMENT', 'FEE_CONFIGURED_NOT_ENABLED']) assert.ok(codes.has(c), c);
  assert.ok(!codes.has('PROHIBITED_FEE_BASIS'));
  assert.equal((await s.setFeeConfig('demo-aurora', { ratePct: 10, feeBasis: 'VOLUME' })).status, 400);
  assert.equal(s.calculate({ ratePct: 5, feeBasis: 'RLUSD_XRP_CONVERSION', periods: [P(1, 2)] }).ok, false);
  const after = (await s.signals()).signals.filter((x) => x.code === 'PROHIBITED_FEE_BASIS');
  assert.equal(after.length, 2);
  // Legal review recorded -> fee-config signal goes away.
  s.recordLegalReview({ reference: 'LR', date: '2026-10-24', reviewer: 'demo' });
  assert.ok(!(await s.signals()).signals.some((x) => x.code === 'FEE_CONFIGURED_NOT_ENABLED'));
  // fee_calculated event is SIMULATION and never billed
  s.calculate(WORKED_EXAMPLE);
  const ev = b.events.find((e) => e.type === 'tgan.fee_calculated');
  assert.equal(ev.mode, 'SIMULATION'); assert.equal(ev.billed, false); assert.equal(ev.totalHypotheticalFeeUsd, 1_300);
});

test('performance: TWR vs MWR, P&L split, HWM, reported-vs-recomputed', () => {
  const perf = computePerformance({ periods: FIXTURE_PROJECTS[0].performance.periods, targetUsd: 250_000 });
  assert.equal(perf.grossPnlUsd, 8_000);
  assert.equal(perf.expensesUsd, 1_800);
  assert.equal(perf.netPnlUsd, 6_200);
  assert.equal(perf.realizedPnlUsd + perf.unrealizedPnlUsd, perf.grossPnlUsd);
  assert.ok(perf.returns.timeWeightedPct !== perf.returns.moneyWeightedPct);
  assert.match(perf.returns.note, /Time-weighted/);
  // No flows -> TWR equals MWR.
  const flat = computePerformance({ periods: [P(100, 110), P(110, 121)] });
  assert.ok(Math.abs(flat.returns.timeWeightedPct - 21) < 1e-6);
  assert.ok(Math.abs(flat.returns.moneyWeightedPct - 21) < 1e-3);
  assert.equal(checkReported({ reportedNetPnlUsd: 6_200 }, perf).matches, true);
  assert.equal(checkReported({ reportedNetPnlUsd: 12_000 }, perf).matches, false);
});

test('signals compute purely from inputs (unit)', () => {
  const advisors = new Map(SEED_ADVISORS.map((a) => [a.id, advisorView(a)]));
  const sig = computeSignals({ advisors, assignments: [], proposals: [], reports: [], feeConfigs: [], rejectedFeeAttempts: [], eligibility: { status: 'NOT_ENABLED' } });
  assert.equal(sig.length, 0);
});

test('revenue keeps three separate streams; collected is $0 everywhere; threshold read from Access policy', () => {
  const r = buildRevenue({ accessPolicy: { thresholdUsd: 77_000, thresholdLabel: 'example', plans: [] }, hypotheticalFees: [{ totalHypotheticalFeeUsd: 1_300 }], eligibility: feeEligibility(null) });
  assert.deepEqual(r.streams.map((s) => s.id), ['infrastructure', 'data', 'advisory']);
  assert.ok(r.streams.every((s) => s.collectedUsd === 0));
  assert.equal(r.streams[0].thresholdUsd, 77_000);
  assert.equal(r.streams[2].hypotheticalUsd, 1_300);
  assert.equal(r.streams[2].eligibility.status, 'NOT_ENABLED');
});

test('project source: FIXTURE until the incubator answers, then INCUBATOR automatically', async () => {
  let exists = false;
  const src = new ProjectSource({ ttlMs: 0, routeExists: () => exists, fetchJson: async (p) => ({ projects: [{ ...FIXTURE_PROJECTS[1], source: 'incubator' }] }) });
  const a = await src.list();
  assert.equal(a.origin, 'FIXTURE'); assert.equal(a.projects.length, 2);
  exists = true;
  const b = await src.list();
  assert.equal(b.origin, 'INCUBATOR'); assert.deepEqual(b.projects.map((p) => p.id), ['demo-beacon']);
  const broken = new ProjectSource({ ttlMs: 0, routeExists: () => true, fetchJson: async () => { throw new Error('HTTP 500'); } });
  assert.equal((await broken.list()).origin, 'FIXTURE');
  // Gate shape normalization (object / boolean / string)
  assert.equal(normalizeProject({ id: 'x', gates: { legal: { status: 'passed' }, economic: false } }).gates.legal, 'PASSED');
  assert.equal(normalizeProject({ id: 'x', gates: { legal: { status: 'passed' }, economic: false } }).gates.economic, 'NOT_MET');
});

test('localhost guard for state-changing POSTs', () => {
  const req = (ip, h = {}) => ({ socket: { remoteAddress: ip }, headers: { 'content-type': 'application/json', ...h } });
  assert.equal(isLocalRequest(req('127.0.0.1')), true);
  assert.equal(isLocalRequest(req('10.0.0.5')), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { 'x-forwarded-for': '1.2.3.4' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { 'content-type': 'text/plain' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { origin: 'https://evil.example' })), false);
});

test('no ledger submit, network or billing path anywhere in TGAN', () => {
  const files = [...fs.readdirSync(path.join(ROOT, 'lib/tgan')).map((f) => path.join(ROOT, 'lib/tgan', f)), path.join(ROOT, 'lib/routes/34-tgan.mjs'), path.join(ROOT, 'public/modules/34-tgan.js')];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'); // code, not comments
    for (const bad of [/\.submit\s*\(/, /submitAndWait/, /from ['"]xrpl['"]/, /ledger\.mjs/, /\/api\/launch\b/, /\/api\/pathfinder\/run/, /x402\/live/, /Wallet\.fromSeed/, /stripe|invoice\(|charge\(/i]) {
      assert.ok(!bad.test(src), `${path.basename(f)} matches ${bad}`);
    }
  }
  // The service never touches a ledger: a poisoned ledger proves it.
  const s = svc();
  s.ledger = new Proxy({}, { get() { throw new Error('ledger touched'); } });
  assert.doesNotThrow(() => s.calculate(WORKED_EXAMPLE));
});

test('incubator interim performance adapter: realized less costs equals the incubator net MM return; marks kept separate', () => {
  const daily = Array.from({ length: 30 }, (_, i) => ({ day: i + 1, pnlUsd: 10 + (i % 3), xrpUsd: 1.3 }));
  const realized = daily.reduce((s, d) => s + d.pnlUsd, 0);
  const interim = { mode: 'SIMULATION', daily, totals: { positionUsd: 100_000, realizedUsd: realized, costsUsd: 120, unrealizedUsd: -50, inventoryAppreciationUsd: 900, netMmReturnUsd: realized - 120 } };
  const a = periodsFromIncubatorInterim(interim);
  assert.equal(a.periods.length, 3);
  assert.deepEqual(a.periods.map((p) => p.label), ['Days 1–10', 'Days 11–20', 'Days 21–30']);
  const perf = computePerformance({ periods: a.periods });
  assert.ok(Math.abs(perf.netPnlUsd - (realized - 120)) < 0.01);
  assert.equal(perf.depositsUsd, 0);
  assert.equal(a.separate.inventoryAppreciationUsd, 900);
  assert.equal(periodsFromIncubatorInterim({ daily: [] }), null);
  // Incubator token objects normalize to the currency code, so the project-token separation still applies.
  const p = normalizeProject({ id: 'x', token: { network: 'testnet', currency: 'AUR', issuer: null }, program: 'XRP_RLUSD_INTERIM', capitalStack: { targetUsd: 1, sources: { T1: { usd: 5 } } }, capitalStates: { T1: { EXECUTABLE: 3 }, T2: { EXECUTABLE: 4 } } });
  assert.equal(p.token, 'AUR'); assert.equal(p.capitalStack.sources.T1, 5); assert.equal(p.executableUsd, 7);
  const gov = defaultGovernance(p);
  assert.ok(evaluateAction({ project: p, governance: gov, advisor: verified('adv-demo-a'), assigned: true, action: { advisorId: 'adv-demo-a', actionType: 'RECOMMEND', asset: 'AUR', capitalSource: 'PROJECT', amountUsd: 1 } }).codes.includes('PROJECT_TOKEN_SEPARATE'));
});
