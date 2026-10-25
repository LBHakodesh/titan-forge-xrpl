// Project Liquidity Incubator: deterministic, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateStack, initialStates, setSourceStates, rebaseStates, checkStates, fundingGaps, ownership, projectOwnedUsd, custodyCheck,
  TIER_COMBINATIONS, SOURCES, CAPITAL_STATES, validateIntake, legalGate, economicGate, decideOutcome, outcomeAllowed,
  simulateInterim, radarFromSpokes, rlusdContext, recommend, MATURITY_PATH, proprietaryNeedUsd, nativeLendingStatus, RECORDED_CHECK,
  runAmendmentCheck, Incubator,
} from '../lib/incubator/index.mjs';
import { guardCheck } from '../lib/guardian.mjs';
import { nextStage } from '../lib/corridor.mjs';

const FIXED = '2026-10-24T10:00:00Z';
const RLUSD = { id: 'mainnet:RLUSD:rM', network: 'mainnet', currency: 'RLUSD', issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De', name: 'RLUSD', eligibility: { eligible: true, checks: [] },
  market: { spreadBps: 5.7, vol24hXrp: 3_900_000, depthXrp: { bids: [{ band: '2%', xrp: 38_000 }], asks: [{ band: '2%', xrp: 66_000 }] }, observedAt: FIXED } };
const THIN = { id: 'mainnet:THN:rX', network: 'mainnet', currency: 'THN', issuer: 'rX', name: 'Thin', eligibility: { eligible: false, checks: [{ id: 'two_sided_liquidity', ok: false, blocking: true }] },
  market: { spreadBps: 9000, vol24hXrp: 2000, depthXrp: { bids: [{ band: '2%', xrp: 3 }], asks: [{ band: '2%', xrp: 2 }] } } };
const BLOCKED = { ...THIN, id: 'mainnet:BAD:rY', currency: 'BAD', eligibility: { eligible: false, checks: [{ id: 'scam_blocklist', ok: false, blocking: true }] } };
const spokesSource = () => ({ spokes: [RLUSD, THIN, BLOCKED], flows: [], xrpUsd: 1.3 });
// Fake ledger: ANY property access throws, so any attempt to sign/submit/connect fails the test.
const fakeLedger = new Proxy({}, { get(_, k) { throw new Error(`ledger.${String(k)} touched: incubator must never use the ledger`); } });
const mk = () => { const events = []; const bus = { publish: (type, mode, p) => events.push({ type, mode, ...p }) };
  return { inc: new Incubator({ bus, spokesSource, now: () => FIXED, ledger: fakeLedger }), events }; };

test('every one of the 7 tier combinations is accepted, zero allowed for unused tiers', () => {
  assert.equal(TIER_COMBINATIONS.length, 7);
  for (const combo of TIER_COMBINATIONS) {
    const tiers = combo.split('+');
    const sources = { T1: 0, T2: 0, T3: 0, PROJECT: 10_000, PROPRIETARY: 0 };
    for (const t of tiers) sources[t] = 300_000 / tiers.length;
    const r = validateStack({ targetUsd: 300_000, sources });
    assert.ok(r.ok, `${combo}: ${r.errors}`);
    assert.equal(r.stack.combination, combo);
    for (const t of ['T1', 'T2', 'T3']) assert.equal(r.stack.sources[t].usd, sources[t]);
    assert.equal(r.stack.sources.PROJECT.usd, 10_000);
  }
});

test('all-zero tiers, negative amounts and mismatched totals are rejected', () => {
  const z = validateStack({ targetUsd: 100, sources: { T1: 0, T2: 0, T3: 0, PROJECT: 100, PROPRIETARY: 100 } });
  assert.equal(z.ok, false); assert.match(z.errors.join(' '), /All three tiers are zero/);
  assert.equal(validateStack({ targetUsd: 100, sources: { T1: -1, T2: 101 } }).ok, false);
  assert.match(validateStack({ targetUsd: 100, sources: { T1: 50 } }).errors.join(' '), /must match/);
  assert.equal(validateStack({ targetUsd: 0, sources: { T1: 0 } }).ok, false);
  assert.match(validateStack({ targetUsd: 100, sources: { T3: 100 }, terms: { T3: { underwriting: 'IN_UNDERWRITING', disbursed: true } } }).errors.join(' '), /disbursed/);
});

test('custody: T1/T2 never counted as project-owned; no transfer without owner authorization; never to project treasury', () => {
  const { stack } = validateStack({ targetUsd: 300, sources: { T1: 100, T2: 100, T3: 100, PROJECT: 7, PROPRIETARY: 5 } });
  assert.equal(projectOwnedUsd(stack), 7);
  const o = ownership(stack);
  assert.equal(o.projectOwnedUsd, 7); assert.equal(o.participantOwnedUsd, 200);
  for (const s of ['T1', 'T2']) {
    const noAuth = custodyCheck({ source: s, to: 'PROGRAM_LIQUIDITY', amountUsd: 10 });
    assert.equal(noAuth.allowed, false); assert.equal(noAuth.executes, false);
    const auth = { owner: 'PARTICIPANT', by: 'participant-1', at: FIXED };
    assert.equal(custodyCheck({ source: s, to: 'PROJECT_TREASURY', amountUsd: 10, ownerAuthorization: auth }).allowed, false, 'even with auth, never to project treasury');
    assert.equal(custodyCheck({ source: s, to: 'PROGRAM_LIQUIDITY', amountUsd: 10, ownerAuthorization: { ...auth, owner: 'PROJECT' } }).allowed, false, 'project cannot authorize participant capital');
    const ok = custodyCheck({ source: s, to: 'PROGRAM_LIQUIDITY', amountUsd: 10, ownerAuthorization: auth });
    assert.equal(ok.allowed, true); assert.equal(ok.executes, false); assert.equal(ok.mode, 'SIMULATION');
  }
  assert.equal(custodyCheck({ source: 'T3', to: 'PROJECT_TREASURY', amountUsd: 10, ownerAuthorization: { owner: 'LENDER', by: 'l', at: FIXED } }).allowed, false);
});

test('custody violation via the service is refused, recorded and raised as a Sentinel signal', () => {
  const { inc } = mk();
  const r = inc.decide('demo-aurora', { type: 'TRANSFER_REQUEST', source: 'T1', to: 'PROJECT_TREASURY', amountUsd: 1000, actor: 'tester' });
  assert.equal(r.decision.result.ok, false); assert.equal(r.decision.executes, false);
  assert.equal(r.project.capitalStates.T1.EXECUTABLE, 80_000, 'nothing moved');
  assert.ok(inc.sentinelSignals().signals.some((s) => s.key.includes(':custody:') && s.severity === 'high'));
});

test('capital states: ordered, monotone along the pipeline, separated per source', () => {
  const { stack } = validateStack({ targetUsd: 300, sources: { T1: 100, T2: 200, PROJECT: 50 } });
  let st = initialStates(stack);
  assert.deepEqual(Object.keys(st.T1), CAPITAL_STATES);
  const bad = setSourceStates(st, stack, 'T1', { MATCHED: 50, COMMITTED: 60 });
  assert.equal(bad.ok, false); assert.match(bad.errors[0], /COMMITTED .* cannot exceed MATCHED/);
  assert.equal(setSourceStates(st, stack, 'T1', { MATCHED: 150 }).ok, false, 'MATCHED cannot exceed REQUESTED');
  const before = JSON.stringify(st.T2);
  const r = setSourceStates(st, stack, 'T1', { MATCHED: 90, COMMITTED: 80, FUNDED: 70, EXECUTABLE: 60 });
  assert.ok(r.ok); st = r.states;
  assert.equal(JSON.stringify(st.T2), before, 'other sources untouched');
  assert.deepEqual(Object.values(st.T1), [100, 90, 80, 70, 60]);
  assert.deepEqual(checkStates(st, stack), []);
  // Rebase to a smaller request clips later states down and never raises them.
  const smaller = validateStack({ targetUsd: 250, sources: { T1: 50, T2: 200, PROJECT: 50 } }).stack;
  const rb = rebaseStates(st, smaller);
  assert.deepEqual(Object.values(rb.T1), [50, 50, 50, 50, 50]);
  const bigger = validateStack({ targetUsd: 500, sources: { T1: 300, T2: 200, PROJECT: 50 } }).stack;
  assert.deepEqual(Object.values(rebaseStates(st, bigger).T1), [300, 90, 80, 70, 60]);
});

test('unavailable funding renders honestly: T2 short match and T3 declined', () => {
  const { stack } = validateStack({ targetUsd: 300, sources: { T1: 100, T2: 100, T3: 100 }, terms: { T3: { underwriting: 'DECLINED' } } });
  let st = initialStates(stack);
  st = setSourceStates(st, stack, 'T2', { MATCHED: 40 }).states;
  assert.equal(setSourceStates(st, stack, 'T3', { MATCHED: 10 }).ok, false, 'declined T3 cannot be matched');
  const gaps = fundingGaps(st, stack);
  assert.ok(gaps.some((g) => g.source === 'T2' && g.kind === 'MATCH_SHORTFALL' && g.shortfallUsd === 60));
  assert.ok(gaps.some((g) => g.source === 'T3' && g.kind === 'DECLINED' && g.shortfallUsd === 100));
  const { stack: s2 } = validateStack({ targetUsd: 100, sources: { T3: 100 }, terms: { T3: { underwriting: 'IN_UNDERWRITING' } } });
  assert.equal(setSourceStates(initialStates(s2), s2, 'T3', { MATCHED: 100, COMMITTED: 100 }).ok, false, 'no commitment before approval');
  const { inc } = mk();
  const d = inc.detail('demo-aurora');
  assert.ok(d.fundingGaps.some((g) => g.source === 'T3' && g.kind === 'DECLINED'));
  assert.equal(d.capitalStates.T3.EXECUTABLE, 0);
});

const passLegal = () => legalGate({ status: 'COUNSEL_OPINION_RECEIVED', reviewer: 'r', date: '2026-10-01' },
  Object.fromEntries(['token_offering_analysis', 'permitted_market_participants', 'issuer_trading_requirements', 'approval_documentation'].map((k) => [k, { status: 'PASS', docRef: 'D', reviewer: 'r', date: '2026-10-01' }])));
const econ = (status) => ({ status, items: [{ id: 'operating_sustainability', status: 'PASS' }] });

test('legal gate overrides profitability (decideOutcome, outcomeAllowed and the service)', () => {
  for (const rs of ['NOT_STARTED', 'IN_REVIEW']) {
    const legal = legalGate({ status: rs, reviewer: 'r', date: '2026-10-01' }, {});
    assert.equal(legal.status, 'OPEN');
    const d = decideOutcome(legal, econ('PASS'));
    assert.equal(d.outcome, 'REMAIN_IN_INCUBATION'); assert.equal(d.legalOverride, true);
    assert.equal(outcomeAllowed('GRADUATE_TO_TOKEN_CORRIDOR', legal, econ('PASS')).allowed, false);
  }
  const fail = legalGate({ status: 'NOT_ELIGIBLE', reviewer: 'r', date: '2026-10-01' }, {});
  assert.equal(decideOutcome(fail, econ('PASS')).outcome, 'DECLINE');
  assert.equal(outcomeAllowed('RESTRICTED_MARKET_PATHWAY', fail, econ('PASS')).allowed, false);
  // PASS claimed without a document reference is held OPEN.
  const nodoc = legalGate({ status: 'COUNSEL_OPINION_RECEIVED', reviewer: 'r', date: '2026-10-01' }, { token_offering_analysis: { status: 'PASS' } });
  assert.equal(nodoc.items[0].status, 'OPEN'); assert.equal(nodoc.status, 'OPEN');
  assert.equal(decideOutcome(passLegal(), econ('PASS')).outcome, 'GRADUATE_TO_TOKEN_CORRIDOR');
  const restricted = legalGate({ status: 'RESTRICTED_PATHWAY', reviewer: 'r', date: '2026-10-01' }, passLegal().items.reduce((a, i) => ({ ...a, [i.id]: i }), {}));
  assert.equal(decideOutcome(restricted, econ('PASS')).outcome, 'RESTRICTED_MARKET_PATHWAY');

  // Service: a hugely profitable Aurora still cannot graduate while legal review is IN_REVIEW.
  const { inc } = mk();
  inc.setGates('demo-aurora', { actor: 'op', runwayMonths: 60, demand: { verifiedEvidence: [{ ref: 'a', description: 'x' }, { ref: 'b', description: 'y' }], independentParticipants: 99 } });
  const r = inc.decide('demo-aurora', { type: 'RECORD_OUTCOME', outcome: 'GRADUATE_TO_TOKEN_CORRIDOR', actor: 'Commander', override: true });
  assert.equal(r.decision.result.ok, false);
  assert.match(r.decision.result.reasons.join(' '), /Profitability never overrides the legal gate/);
  assert.equal(r.project.program, 'XRP_RLUSD_INTERIM'); assert.notEqual(r.project.outcome, 'GRADUATE_TO_TOKEN_CORRIDOR');
});

test('recorded graduation is revoked if the legal gate later regresses', () => {
  const { inc } = mk();
  inc.decide('demo-beacon', { type: 'RECORD_OUTCOME', outcome: 'GRADUATE_TO_TOKEN_CORRIDOR', actor: 'Commander' });
  const d = inc.setGates('demo-beacon', { actor: 'op', regulatoryReview: { status: 'NOT_ELIGIBLE', reviewer: 'r', date: '2026-10-22' } });
  assert.equal(d.outcome, 'DECLINE'); assert.equal(d.gateDetail.outcome.revoked, true);
});

test('demo seed: Aurora stays in XRP/RLUSD incubation, Beacon passes both gates; recommendation picks Beacon', () => {
  const { inc } = mk();
  const list = inc.list().projects;
  assert.deepEqual(list.map((p) => p.id), ['demo-aurora', 'demo-beacon']);
  for (const p of list) {
    assert.ok(['RADAR_DISCOVERED', 'PROJECT_REQUESTED'].includes(p.source));
    assert.deepEqual(Object.keys(p.capitalStack.sources), SOURCES);
    for (const s of SOURCES) assert.deepEqual(Object.keys(p.capitalStates[s]), CAPITAL_STATES);
    assert.equal(p.mode, 'SIMULATION'); assert.ok(p.fictional);
  }
  const [a, b] = list;
  assert.equal(a.program, 'XRP_RLUSD_INTERIM'); assert.equal(a.outcome, 'REMAIN_IN_INCUBATION'); assert.equal(a.gates.legal.status, 'OPEN');
  assert.equal(b.gates.legal.status, 'PASS'); assert.equal(b.gates.economic.status, 'PASS'); assert.equal(b.outcome, 'GRADUATE_TO_TOKEN_CORRIDOR'); assert.equal(b.outcomeStatus, 'GATE_COMPUTED');
  const c = inc.compare('demo-aurora', 'demo-beacon');
  assert.equal(c.support.recommended, 'demo-beacon');
  const det = inc.detail('demo-aurora');
  assert.match(det.performance.interim.disclaimer, /does not create a market or a price/);
  assert.equal(det.performance.interim.rlusdContext.mode, 'MAINNET_OBSERVED');
  // Deterministic.
  assert.deepEqual(mk().inc.detail('demo-beacon').performance.interim.totals, inc.detail('demo-beacon').performance.interim.totals);
});

test('maturity and redeployment: Beacon graduates, proprietary support falls and moves to Aurora', () => {
  const { inc, events } = mk();
  const A = { actor: 'Commander' };
  assert.equal(inc.decide('demo-beacon', { type: 'ADVANCE_MATURITY', ...A }).decision.result.ok, false, 'no maturation before graduation');
  const sel = inc.decide('demo-beacon', { type: 'SELECT_SUPPORT', ...A });
  assert.equal(sel.decision.result.addedUsd, 150_000); assert.equal(sel.decision.result.followedRecommendation, true);
  assert.equal(sel.decision.actor, 'Commander'); assert.equal(sel.decision.at, FIXED); assert.equal(sel.decision.mode, 'SIMULATION');
  const p0 = sel.project.capitalStates.PROPRIETARY;
  assert.equal(p0.COMMITTED, 150_000); assert.equal(p0.FUNDED, 0, 'committed is not funded');
  // Budget exhausted: Aurora cannot be supported now; shown honestly.
  assert.equal(inc.decide('demo-aurora', { type: 'SELECT_SUPPORT', ...A }).decision.result.ok, false);
  inc.decide('demo-beacon', { type: 'BOOTSTRAP', ...A });
  const g = inc.decide('demo-beacon', { type: 'RECORD_OUTCOME', outcome: 'GRADUATE_TO_TOKEN_CORRIDOR', ...A });
  assert.equal(g.project.program, 'PROJECT_TOKEN_CORRIDOR'); assert.equal(g.project.stage, 'spoke'); assert.equal(g.project.outcomeStatus, 'COMMANDER_RECORDED');
  let prev = 'spoke';
  for (let w = 1; w < MATURITY_PATH.length; w++) {
    const r = inc.decide('demo-beacon', { type: 'ADVANCE_MATURITY', ...A });
    assert.ok(r.decision.result.ok);
    const to = r.project.stage;
    assert.ok(to === prev || nextStage(prev) === to, `valid lifecycle transition ${prev} → ${to}`);
    prev = to;
  }
  assert.equal(prev, 'mature');
  const before = inc.detail('demo-beacon');
  assert.equal(before.proprietary.needUsd, proprietaryNeedUsd(150_000, 0.75));
  assert.ok(before.recommendations.some((r) => r.kind === 'REDUCE_PROPRIETARY'));
  const redeploy = before.recommendations.find((r) => r.kind === 'REDEPLOY_CAPITAL');
  assert.equal(redeploy.target, 'demo-aurora');
  const rd = inc.decide('demo-beacon', { type: 'REDEPLOY', toProjectId: 'demo-aurora', ...A });
  assert.equal(rd.decision.result.releasedUsd, 112_500); assert.equal(rd.decision.result.movedUsd, 50_000);
  assert.equal(rd.project.capitalStates.PROPRIETARY.EXECUTABLE, 37_500);
  const au = inc.detail('demo-aurora').capitalStates.PROPRIETARY;
  assert.equal(au.COMMITTED, 50_000); assert.equal(au.EXECUTABLE, 0, 'redeployed support still needs its own bootstrap');
  assert.equal(inc.availableUsd(), 62_500);
  assert.ok(events.every((e) => e.mode === 'SIMULATION'));
  for (const t of ['incubator.decision', 'incubator.gate_changed']) assert.ok(events.some((e) => e.type === t), t);
});

test('Guardian verdict on every recommendation; nothing executes', () => {
  const { inc } = mk();
  for (const id of ['demo-aurora', 'demo-beacon']) {
    const d = inc.detail(id);
    assert.ok(d.recommendations.length > 0);
    for (const r of d.recommendations) {
      assert.equal(typeof r.guardian.allowed, 'boolean'); assert.ok(Array.isArray(r.guardian.reasons));
      assert.equal(r.executes, false); assert.equal(r.guardian.executes, false); assert.ok(r.evidence.length > 0); assert.equal(r.mode, 'SIMULATION');
    }
  }
  // A failing legal gate yields suspend/reject only.
  inc.setGates('demo-aurora', { actor: 'op', regulatoryReview: { status: 'NOT_ELIGIBLE', reviewer: 'r', date: '2026-10-22' } });
  assert.deepEqual(inc.detail('demo-aurora').recommendations.map((r) => r.kind), ['SUSPEND_OR_REJECT']);
  // Guardian itself refuses REPLAY transactions and out-of-range simulations.
  assert.equal(guardCheck({ mode: 'REPLAY', txType: 'Payment' }).allowed, false);
  assert.equal(guardCheck({ mode: 'SIMULATION', amountUsd: -1 }).allowed, false);
});

test('no ledger submit: full demo flow never touches the (throwing) fake ledger; decisions are SIMULATION-only', () => {
  const { inc } = mk();
  const A = { actor: 'Commander' };
  for (const [id, b] of [['demo-beacon', { type: 'SELECT_SUPPORT' }], ['demo-beacon', { type: 'BOOTSTRAP' }], ['demo-beacon', { type: 'RECORD_OUTCOME', outcome: 'GRADUATE_TO_TOKEN_CORRIDOR' }],
    ['demo-beacon', { type: 'ADVANCE_MATURITY' }], ['demo-beacon', { type: 'REDEPLOY', toProjectId: 'demo-aurora' }], ['demo-aurora', { type: 'APPLY_RECOMMENDATION', recommendationId: 'interim_rlusd_support' }]]) {
    assert.doesNotThrow(() => inc.decide(id, { ...b, ...A }));
  }
  assert.doesNotThrow(() => { inc.radar(); inc.compare('demo-aurora', 'demo-beacon'); inc.sentinelSignals(); inc.list(); });
  assert.throws(() => inc.decide('demo-aurora', { type: 'SELECT_SUPPORT', actor: 'x', mode: 'LIVE_TESTNET' }), /SIMULATION/);
  assert.throws(() => inc.decide('demo-aurora', { type: 'SELECT_SUPPORT' }), /actor/);
  assert.throws(() => inc.setStack('demo-aurora', { mode: 'LIVE_TESTNET' }), /SIMULATION/);
  assert.throws(() => inc.setStack('demo-aurora', { capitalStates: { PROPRIETARY: { MATCHED: 50_000 } } }), /Capital states invalid/);
});

test('intake validation and RADAR_DISCOVERED intake share the same lifecycle', () => {
  const good = { id: 'acme-1', name: 'Acme', description: 'A business description that is long enough.', token: { network: 'testnet', currency: 'ACM', issuer: 'NOT_YET_ISSUED' },
    regulatoryReview: { status: 'IN_REVIEW', reviewer: 'Jane', date: '2026-10-01' }, requestedUsd: 1000, targetOperatingPeriod: { months: 6 }, sustainabilityMeasures: 'Revenue from fees.', desiredMarkets: 'ACM/XRP' };
  const v = validateIntake(good, { now: Date.parse(FIXED) });
  assert.ok(v.ok, v.errors.join(' '));
  assert.equal(v.value.regulatoryReview.source, 'OPERATOR_INPUT'); assert.equal(v.value.token.issuer, null); assert.equal(v.value.token.issued, false);
  const bad = (patch, re) => assert.match(validateIntake({ ...good, ...patch }, { now: Date.parse(FIXED) }).errors.join(' '), re);
  bad({ id: 'A B' }, /id must/);
  bad({ regulatoryReview: { status: 'APPROVED_BY_AI' } }, /status must be one of/);
  bad({ regulatoryReview: { status: 'IN_REVIEW' } }, /reviewer is required/);
  bad({ regulatoryReview: { status: 'IN_REVIEW', reviewer: 'x', date: '2030-01-01' } }, /future/);
  bad({ token: { network: 'testnet', currency: 'XRP' } }, /currency/);
  bad({ token: { network: 'testnet', currency: 'ACM', issuer: 'nope' } }, /issuer/);
  bad({ requestedUsd: 0 }, /requestedUsd/);
  bad({ desiredMarkets: [] }, /desiredMarkets/);
  assert.match(validateIntake(good, { existingIds: ['acme-1'] }).errors.join(' '), /already exists/);

  const { inc, events } = mk();
  const radar = inc.radar().items;
  assert.ok(radar.some((r) => r.spokeId === THIN.id && r.candidate));
  assert.ok(radar.some((r) => r.spokeId === BLOCKED.id && !r.candidate), 'screened-out spokes are never candidates');
  assert.ok(!radar.some((r) => r.currency === 'RLUSD'));
  const created = inc.create({ ...good, id: 'radar-thn', radarId: `radar:${THIN.id}` });
  assert.equal(created.source, 'RADAR_DISCOVERED'); assert.equal(created.program, 'NONE');
  assert.equal(created.capitalStates.T1.REQUESTED, 1000); assert.equal(created.capitalStates.T1.MATCHED, 0);
  assert.ok(events.some((e) => e.type === 'incubator.project_created' && e.mode === 'SIMULATION'));
  assert.throws(() => inc.create({ ...good, id: 'radar-x', radarId: 'radar:nope' }), /Intake invalid/);
  const st = inc.setStack('radar-thn', { targetUsd: 1000, sources: { T1: 400, T2: 600 }, capitalStates: { T1: { MATCHED: 400, COMMITTED: 400, FUNDED: 400, EXECUTABLE: 400 } } });
  assert.equal(st.program, 'XRP_RLUSD_INTERIM');
  assert.ok(events.some((e) => e.type === 'incubator.stack_changed'));
});

test('interim program, RLUSD context, Tier 3 native lending and read-only amendment check', async () => {
  const ctx = rlusdContext([RLUSD]);
  assert.equal(ctx.mode, 'MAINNET_OBSERVED'); assert.equal(ctx.depth2pctXrp.total, 104_000);
  assert.equal(rlusdContext([]).mode, 'UNAVAILABLE');
  const { stack } = validateStack({ targetUsd: 100_000, sources: { T1: 100_000 } });
  const st = setSourceStates(initialStates(stack), stack, 'T1', { MATCHED: 100_000, COMMITTED: 100_000, FUNDED: 100_000, EXECUTABLE: 100_000 }).states;
  const p = simulateInterim({ states: st, stack, days: 30, rlusd: ctx, xrpUsd: 1.3 });
  assert.equal(p.mode, 'SIMULATION');
  assert.equal(p.totals.netMmReturnUsd, Math.round((p.totals.realizedUsd - p.totals.costsUsd) * 100) / 100, 'inventory appreciation is not MM profit');
  assert.equal(p.perSource.T2.positionUsd, 0);
  assert.equal(nativeLendingStatus(RECORDED_CHECK).status, 'UNAVAILABLE');
  assert.equal(nativeLendingStatus({ features: { SingleAssetVault: { enabled: true }, LendingProtocol: { enabled: true } } }).status, 'ENABLED_ON_TESTNET_NOT_USED');
  const sent = [];
  const request = async (req) => { sent.push(req.command);
    if (req.command === 'server_info') return { result: { info: { network_id: 1, validated_ledger: { seq: 5 }, build_version: 'x' } } };
    if (req.command === 'feature') return { result: { features: { h: { name: 'SingleAssetVault', enabled: false, supported: true } } } };
    if (req.command === 'account_info') return { result: { account_data: { Domain: '68747470733A2F2F726970706C652E636F6D2F' } } };
    return { result: { obligations: {} } }; };
  const c = await runAmendmentCheck(request, { now: () => FIXED });
  assert.equal(c.features.SingleAssetVault.enabled, false); assert.equal(c.rlusd.domain, 'https://ripple.com/');
  assert.ok(sent.every((x) => ['server_info', 'feature', 'account_info', 'gateway_balances'].includes(x)));
  await assert.rejects(runAmendmentCheck(async () => ({ result: { info: { network_id: 0 } } })), /not XRPL Testnet/);
});

test('sentinel signals cover unfunded tiers, open legal gate, concentration and T3 credit risk', () => {
  const { inc } = mk();
  inc.setStack('demo-beacon', { capitalStates: { T1: { MATCHED: 150_000, COMMITTED: 150_000, FUNDED: 150_000, EXECUTABLE: 10_000 }, T3: { MATCHED: 100_000, COMMITTED: 100_000, FUNDED: 100_000, EXECUTABLE: 0 }, PROJECT: { EXECUTABLE: 0 } } });
  const keys = inc.sentinelSignals().signals.map((s) => s.key);
  for (const k of ['demo-aurora:unfunded:T2', 'demo-aurora:unfunded:T3', 'demo-aurora:legal_gate', 'demo-aurora:t3_credit_risk', 'demo-beacon:concentration:T2']) assert.ok(keys.some((x) => x.endsWith(k)), k);
  assert.ok(inc.sentinelSignals().signals.every((s) => s.provenance === 'SIMULATION' && s.verification === 'SIMULATED'));
});

test('recommend() maps onto valid corridor lifecycle transitions', () => {
  const { inc } = mk();
  for (const id of ['demo-aurora', 'demo-beacon']) for (const r of inc.detail(id).recommendations) assert.notEqual(r.corridorTransition?.kind, 'invalid', `${id} ${r.kind}`);
  assert.equal(typeof recommend, 'function');
  assert.equal(radarFromSpokes([{ placeholder: true }]).length, 0);
});

// ===================== TGLB Bootstrap studio + lending integration =====================
import { planBootstrap, demoWalkthrough, tierCapital, categoryTotals, projectFunds, bootstrapEconomicGate, DEMO_PROJECT, CATEGORIES as BOOT_CATS } from '../lib/incubator/bootstrap.mjs';

const BASE_PLAN = { name: 'Combo Test Co', incubationAsset: 'RLUSD', targetUsd: 300_000, projectOwnUsd: 25_000,
  economics: { runwayMonths: 18, operatingMonths: 12, independentParticipants: 20, verifiedEvidence: 2, targetSpreadBps: 50 },
  tierDefaults: { commitRate: 0.8, fundRate: 0.9, execRate: 0.9 } };
const planFor = (combo, extra = {}) => {
  const tiers = {};
  for (const t of combo.split('+')) tiers[t] = { enabled: true, ...BASE_PLAN.tierDefaults, ...(t === 'T3' ? { application: { monthlyRevenueUsd: 80_000, monthlyOpexUsd: 30_000, collateralUsd: 200_000, runwayMonths: 24, operatingHistoryMonths: 36 } } : {}) };
  return planBootstrap({ ...BASE_PLAN, tiers, ...extra });
};

test('bootstrap: all 7 non-empty tier subsets plan; empty selection rejected', () => {
  for (const combo of TIER_COMBINATIONS) {
    const p = planFor(combo);
    assert.ok(p.ok, `${combo}: ${(p.errors || []).join(' ')}`);
    assert.equal(p.combination, combo);
    assert.deepEqual(p.tiers, combo.split('+'));
    for (const t of ['T1', 'T2', 'T3']) if (!combo.includes(t)) assert.deepEqual(Object.values(p.capital[t]), [0, 0, 0, 0], `${combo}: unused ${t} stays zero`);
    assert.equal(p.allocation.T1.usd + p.allocation.T2.usd + p.allocation.T3.usd, 300_000);
  }
  const none = planBootstrap({ ...BASE_PLAN, tiers: {} });
  assert.equal(none.ok, false); assert.ok(none.errors.some((e) => /at least one tier/.test(e)));
  const off = planBootstrap({ ...BASE_PLAN, tiers: { T1: { enabled: false }, T2: { enabled: false } } });
  assert.equal(off.ok, false);
});

test('bootstrap: capital categories are separate per tier, monotone, and never merged into one figure', () => {
  for (const combo of TIER_COMBINATIONS) {
    const p = planFor(combo);
    for (const t of ['T1', 'T2', 'T3']) {
      const c = p.capital[t];
      assert.deepEqual(Object.keys(c), BOOT_CATS);
      assert.ok(c.REQUESTED >= c.COMMITTED && c.COMMITTED >= c.FUNDED && c.FUNDED >= c.EXECUTABLE && c.EXECUTABLE >= 0, `${combo}/${t} monotone`);
    }
    for (const k of BOOT_CATS) assert.equal(p.categoryTotals[k], Math.round(['T1', 'T2', 'T3'].reduce((s, t) => s + p.capital[t][k], 0) * 100) / 100);
    assert.equal(Object.keys(p.categoryTotals).length, 4, 'no merged "total capital" key');
    assert.ok(!('totalUsd' in p.categoryTotals) && !('capitalUsd' in p));
  }
  // Partial commitments keep requested ≠ committed ≠ funded ≠ executable.
  const c = tierCapital(100_000, { commitRate: 0.5, fundRate: 0.8, execRate: 0.5 });
  assert.deepEqual(c, { REQUESTED: 100_000, COMMITTED: 50_000, FUNDED: 40_000, EXECUTABLE: 20_000 });
  assert.deepEqual(tierCapital(100_000, { committedUsd: 200_000, fundRate: 1, execRate: 1 }).COMMITTED, 100_000, 'explicit values clip to the previous category');
  assert.deepEqual(categoryTotals({ T1: c, T2: c, T3: tierCapital(0) }), { REQUESTED: 200_000, COMMITTED: 100_000, FUNDED: 80_000, EXECUTABLE: 40_000 });
});

test('bootstrap: Tier 1 / Tier 2 TGLW capital is never counted as project funds', () => {
  for (const combo of TIER_COMBINATIONS) {
    const p = planFor(combo);
    assert.equal(p.projectFunds.projectOwnedUsd, 25_000, `${combo}: project-owned is only the project's own line`);
    assert.equal(p.projectFunds.tglwCountedAsProjectFundsUsd, 0);
    assert.equal(p.tierInfo.T1.projectFunds, false); assert.equal(p.tierInfo.T2.projectFunds, false);
    assert.equal(p.projectFunds.borrowedIsLiability, true);
  }
  const huge = projectFunds({ T1: { FUNDED: 1e6 }, T2: { FUNDED: 2e6 }, T3: { FUNDED: 0 } }, 0);
  assert.equal(huge.projectOwnedUsd, 0);
  assert.equal(huge.tglwCountedAsProjectFundsUsd, 0);
});

test('bootstrap: legal and economic readiness gates are independent', () => {
  const fullLegal = { regulatoryReview: { status: 'COUNSEL_OPINION_RECEIVED', reviewer: 'R', date: '2026-10-20' },
    items: Object.fromEntries(['token_offering_analysis', 'permitted_market_participants', 'issuer_trading_requirements', 'approval_documentation'].map((id) => [id, { status: 'PASS', docRef: 'DOC', reviewer: 'R', date: '2026-10-20' }])) };
  const tokenized = { token: { currency: 'TST', issuer: 'NOT_YET_ISSUED' } };
  const a = planFor('T1+T2', { ...tokenized, legal: {} });
  const b = planFor('T1+T2', { ...tokenized, legal: fullLegal });
  assert.equal(a.readiness.legal.status, 'OPEN'); assert.equal(b.readiness.legal.status, 'PASS');
  assert.deepEqual(a.readiness.economic, b.readiness.economic, 'legal inputs never change the economic gate');
  assert.equal(a.readiness.economic.status, 'PASS');
  assert.equal(a.readiness.outcome.outcome, 'REMAIN_IN_INCUBATION', 'economics pass but legal OPEN: profitability never overrides legal');
  assert.equal(a.selectedCorridor.pair, 'XRP/RLUSD');
  assert.equal(b.readiness.outcome.outcome, 'GRADUATE_TO_TOKEN_CORRIDOR');
  assert.equal(b.selectedCorridor.pair, 'TST/XRP');
  const poorEcon = { ...BASE_PLAN.economics, runwayMonths: 0, independentParticipants: 0 };
  const c = planFor('T1+T2', { ...tokenized, legal: fullLegal, economics: poorEcon });
  const d = planFor('T1+T2', { ...tokenized, legal: {}, economics: poorEcon });
  assert.deepEqual(c.readiness.legal, b.readiness.legal, 'economic inputs never change the legal gate');
  assert.equal(c.readiness.economic.status, 'FAIL');
  assert.deepEqual(c.readiness.economic, d.readiness.economic);
  assert.ok(!c.corridors.find((x) => x.kind === 'PROJECT_TOKEN').eligible);
  // Without a token the project uses the interim XRP/RLUSD incubation corridor only.
  const noTok = planFor('T1', { legal: fullLegal });
  assert.equal(noTok.tokenIdentified, false);
  assert.deepEqual(noTok.corridors.map((x) => x.pair), ['XRP/RLUSD']);
  // Legal FAIL: no corridor at all.
  const fail = planFor('T1', { legal: { regulatoryReview: { status: 'NOT_ELIGIBLE', reviewer: 'R', date: '2026-10-20' } } });
  assert.equal(fail.readiness.outcome.outcome, 'DECLINE'); assert.equal(fail.selectedCorridor, null); assert.equal(fail.handoff, null);
  assert.equal(bootstrapEconomicGate({ targetUsd: 0, capital: { T1: tierCapital(0), T2: tierCapital(0), T3: tierCapital(0) } }).status, 'FAIL');
});

test('bootstrap: Tier 3 uses the lending simulation; deploy is SIMULATION with Guardian; XDLC handoff payload', () => {
  const p = planFor('T1+T3');
  assert.equal(p.loan.label, 'XLS-65/66-style simulation');
  assert.equal(p.loan.native.useNative, false);
  assert.equal(p.capital.T3.REQUESTED, p.loan.capital.requestedUsd);
  assert.equal(p.capital.T3.COMMITTED, p.loan.capital.committedUsd);
  assert.equal(p.deploy.executes, false); assert.equal(p.deploy.mode, 'SIMULATION');
  assert.equal(p.deploy.guardian.allowed, true);
  assert.equal(p.deploy.deployUsd, p.categoryTotals.EXECUTABLE);
  assert.equal(p.handoff.endpoint, '/api/xdlc/corridors');
  assert.equal(p.handoff.body.origin, 'PROJECT_REQUESTED');
  assert.equal(p.handoff.body.mode, 'SIMULATION'); assert.equal(p.handoff.body.organic, false);
  assert.ok(!('type' in p.handoff.body));
});

test('bootstrap demo walkthrough is deterministic and tells the pitch story', () => {
  const a = demoWalkthrough(), b = demoWalkthrough();
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.ok(a.steps.every((s) => s.plan.ok));
  const byId = Object.fromEntries(a.steps.map((s) => [s.id, s.plan]));
  assert.equal(byId.name.combination, 'T1+T2+T3');
  assert.equal(byId.readiness.readiness.outcome.outcome, 'REMAIN_IN_INCUBATION');
  assert.equal(byId.deploy.selectedCorridor.pair, 'XRP/RLUSD');
  assert.equal(byId.late.loan.scenario.status, 'REPAID_WITH_LATE_PAYMENT');
  assert.equal(byId.default.loan.scenario.status, 'DEFAULTED');
  const w = byId.default.loan.waterfall;
  assert.ok(w.firstLossAbsorbedUsd > 0 && w.reserveAbsorbedUsd > 0 && w.lenderLossUsd > 0, 'stress case reaches senior lenders after first loss and reserve');
  assert.equal(byId.graduate.readiness.outcome.outcome, 'GRADUATE_TO_TOKEN_CORRIDOR');
  assert.equal(byId.graduate.selectedCorridor.pair, 'DHC/XRP');
  assert.match(DEMO_PROJECT.name, /fictional/);
});

test('service: loans record incubator.loan_* events (no `type` key) and lending risks reach sentinel-signals', () => {
  const { inc, events } = mk();
  const before = inc.sentinelSignals();
  assert.ok(Array.isArray(before.signals));
  const out = inc.bootstrapDemoRun({ actor: 'tester' });
  assert.equal(out.loan.id, 'loan-demo-dhc');
  assert.equal(out.loan.scenario.status, 'DEFAULTED');
  const kinds = events.map((e) => e.type);
  for (const k of ['incubator.loan_applied', 'incubator.loan_underwritten', 'incubator.loan_scenario', 'incubator.loan_defaulted']) assert.ok(kinds.includes(k), k);
  assert.ok(events.filter((e) => e.type.startsWith('incubator.loan_')).every((e) => e.mode === 'SIMULATION'));
  const sig = inc.sentinelSignals().signals.filter((s) => s.key.includes(':loan_'));
  assert.ok(sig.some((s) => s.key.includes('loan_default')));
  for (const s of sig) for (const k of ['key', 'title', 'severity', 'category', 'product', 'market', 'verification', 'provenance', 'evidence', 'remediation', 'observedAt']) assert.ok(k in s, `signal has ${k}`);
  // breach + concentration through the record path
  const l = inc.loanApply({ actor: 't', application: { borrower: 'Conc Co', principalUsd: 100_000, monthlyRevenueUsd: 60_000, monthlyOpexUsd: 20_000, collateralUsd: 150_000, runwayMonths: 24, operatingHistoryMonths: 36, legalStatus: 'PASS' },
    vault: { lenders: [{ id: 'whale', usd: 400_000 }, { id: 'b', usd: 50_000 }] } });
  inc.loanScenario(l.id, { scenario: 'RESTRICTED_USE_BREACH' });
  assert.ok(events.some((e) => e.type === 'incubator.loan_breach'));
  const keys = inc.sentinelSignals().signals.map((s) => s.key);
  assert.ok(keys.some((k) => k.includes('loan_restricted_use')));
  assert.ok(keys.some((k) => k.includes('loan_concentration')));
  assert.throws(() => inc.loanScenario(l.id, { scenario: 'NOPE' }), /scenario must be/);
  assert.throws(() => inc.loanApply({ application: {} }), /actor is required/);
  assert.throws(() => inc.loanApply({ actor: 'x', mode: 'LIVE_TESTNET', application: {} }), /SIMULATION-only/);
  assert.equal(inc.loans().loans.length, 2);
  inc.reset();
  assert.equal(inc.loans().loans.length, 0);
});
