// XDLC application lifecycle, Opportunity Radar and redeployment walk-through: deterministic, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  STATES, NEXT, APPROVAL_REQUIRED, FUNDING_KEYS, GENESIS, transition, newCorridor, verifyChain, checkFunding, seedCorridors, XdlcStore, knownHashesFrom, recordHash,
} from '../lib/xdlc/lifecycle.mjs';
import { buildRadar, pickDestination, economics, MODEL } from '../lib/xdlc/radar.mjs';
import { runRedeploy, planRedeploy, DEMO_POOL } from '../lib/xdlc/redeploy.mjs';

const T0 = '2026-10-25T09:00:00.000Z';
const clock = () => { let i = 0; return () => new Date(Date.parse(T0) + (i++) * 1000).toISOString(); };

// Minimal valid request to enter each state (from its predecessor).
const REQ = {
  OPPORTUNITY_EVALUATION: { evidence: { radarId: 'radar:x' } },
  PROJECT_REQUEST: { evidence: { origin: 'RADAR_DISCOVERED', netBenefitUsd: { low: -10, base: 50, high: 100 } } },
  CAPITAL_STRUCTURE: { funding: { requestedUsd: 1000 } },
  APPROVAL_PENDING: { funding: { committedUsd: 800 }, evidence: { sources: { PROPRIETARY: { usd: 800, reallocatable: true } } } },
  BOOTSTRAPPING: { funding: { fundedUsd: 700 }, approved: true, approvedBy: 'test operator' },
  ACTIVE: { funding: { executableUsd: 600 }, evidence: { offersPlaced: 12 } },
  REINFORCED: { evidence: { independentShare: 0.4 } },
  MATURE: { evidence: { independentShare: 0.7, persistence: 0.8 } },
  SUPPORT_REDUCTION: { evidence: { releasableUsd: 300 }, approved: true },
  CAPITAL_AVAILABLE: { evidence: { availableBalanceVerified: true } },
  REDEPLOYMENT_RECOMMENDED: { evidence: { destinationMarketId: 'm2' } },
  APPROVED_REDEPLOYMENT: { approved: true },
  NEW_CORRIDOR_ACTIVE: { evidence: { destinationFundedUsd: 250 } },
};
function walk(upTo = STATES.at(-1), now = clock()) {
  let c = newCorridor({ id: 'c1', marketId: 'm1', createdAt: T0 });
  for (const s of STATES.slice(1, STATES.indexOf(upTo) + 1)) {
    const r = transition(c, { to: s, ...REQ[s] }, { now });
    assert.ok(r.ok, `${c.state} → ${s}: ${r.reasons?.join(' ')}`);
    c = r.corridor;
  }
  return c;
}

test('exactly the 14 required states, in order', () => {
  assert.deepEqual(STATES, ['DISCOVERY', 'OPPORTUNITY_EVALUATION', 'PROJECT_REQUEST', 'CAPITAL_STRUCTURE', 'APPROVAL_PENDING', 'BOOTSTRAPPING', 'ACTIVE', 'REINFORCED', 'MATURE', 'SUPPORT_REDUCTION', 'CAPITAL_AVAILABLE', 'REDEPLOYMENT_RECOMMENDED', 'APPROVED_REDEPLOYMENT', 'NEW_CORRIDOR_ACTIVE']);
});

test('every legal transition succeeds and records the full audit fields', () => {
  const c = walk();
  assert.equal(c.state, 'NEW_CORRIDOR_ACTIVE');
  assert.equal(c.log.length, 13);
  c.log.forEach((r, i) => {
    assert.equal(r.from, STATES[i]); assert.equal(r.to, STATES[i + 1]);
    for (const k of ['evidence', 'at', 'marketId', 'funding', 'authorization', 'risk', 'reconciliation', 'prevHash', 'hash']) assert.ok(k in r, `${k} missing`);
    assert.ok('ledgerRef' in r);
    assert.equal(r.ledgerRef, null); assert.equal(r.mode, 'SIMULATION');
    assert.equal(r.authorization.required, APPROVAL_REQUIRED.includes(r.to));
    assert.equal(typeof r.authorization.guardian.allowed, 'boolean');
  });
  assert.ok(verifyChain(c.log).ok);
  assert.equal(c.log[0].prevHash, GENESIS);
});

test('every illegal transition is rejected with a reason', () => {
  let count = 0;
  for (const from of STATES) {
    for (const to of STATES) {
      if (NEXT[from] === to) continue;
      const c = { ...newCorridor({ id: 'c', marketId: 'm', createdAt: T0 }), state: from };
      const r = transition(c, { to, ...REQ[to], approved: true }, { now: () => T0 });
      assert.equal(r.ok, false, `${from} → ${to} should be illegal`);
      assert.match(r.reasons.join(' '), /Illegal transition/);
      count++;
    }
  }
  assert.equal(count, 14 * 14 - 13);
  assert.equal(transition(newCorridor({ id: 'c', marketId: 'm', createdAt: T0 }), { to: 'NOPE' }).ok, false);
});

test('guards reject missing evidence; thin-but-unprofitable cannot become a project request', () => {
  const c = walk('OPPORTUNITY_EVALUATION');
  const r = transition(c, { to: 'PROJECT_REQUEST', evidence: { origin: 'RADAR_DISCOVERED', netBenefitUsd: { low: -900, base: -200, high: 50 } } }, { now: () => T0 });
  assert.equal(r.ok, false); assert.match(r.reasons.join(' '), /not automatically profitable/);
  const r2 = transition(walk('CAPITAL_STRUCTURE'), { to: 'APPROVAL_PENDING', funding: { committedUsd: 1 }, evidence: { sources: { T1: { usd: 5, reallocatable: true } } } }, { now: () => T0 });
  assert.equal(r2.ok, false); assert.match(r2.reasons.join(' '), /T1 capital can never be marked reallocatable/);
});

test('no self-approval: approval states need approved === true from the request', () => {
  for (const to of APPROVAL_REQUIRED) {
    const from = STATES[STATES.indexOf(to) - 1];
    const c = walk(from);
    for (const approved of [undefined, false, 'true', 1]) {
      const r = transition(c, { to, ...REQ[to], approved }, { now: () => T0 });
      assert.equal(r.ok, false, `${to} with approved=${approved}`);
      assert.match(r.reasons.join(' '), /never self-approves/);
    }
  }
  // the redeploy walk-through never approves unless told to by the operator flag
  const radar = buildRadar(fixtureArgs());
  const plan = planRedeploy({ radar, spokes: SPOKES, xrpUsd: 1.3 });
  assert.equal(plan.approved, false);
  assert.equal(runRedeploy({ radar, spokes: SPOKES, xrpUsd: 1.3 }).approved, false);
  assert.equal(runRedeploy({ radar, spokes: SPOKES, xrpUsd: 1.3, approved: 'yes' }).approved, false);
});

test('determinism: same inputs and clock produce identical hashes; tampering breaks the chain', () => {
  const a = walk(STATES.at(-1), clock()), b = walk(STATES.at(-1), clock());
  assert.deepEqual(a.log.map((r) => r.hash), b.log.map((r) => r.hash));
  const s1 = seedCorridors(), s2 = seedCorridors();
  assert.equal(s1.a.log.at(-1).hash, s2.a.log.at(-1).hash);
  const tampered = structuredClone(a.log); tampered[3].funding.fundedUsd = 999_999;
  assert.equal(verifyChain(tampered).ok, false);
  assert.equal(recordHash(a.log[0]), a.log[0].hash);
});

test('funding categories are never merged', () => {
  const c = walk('ACTIVE');
  const f = c.log.at(-1).funding;
  for (const k of FUNDING_KEYS) assert.ok(Number.isFinite(f[k]));
  assert.deepEqual([f.requestedUsd, f.committedUsd, f.fundedUsd, f.executableUsd], [1000, 800, 700, 600]);
  assert.ok(!('totalUsd' in f) && !('total' in f));
  assert.match(checkFunding({ ...f, mode: undefined, note: undefined, totalUsd: 5 }).join(' '), /never merged/);
  const bad = transition(walk('CAPITAL_STRUCTURE'), { to: 'APPROVAL_PENDING', funding: { committedUsd: 5000 }, evidence: { sources: {} } }, { now: () => T0 });
  assert.match(bad.reasons.join(' '), /committedUsd cannot exceed requestedUsd/);
  const merged = transition(walk('CAPITAL_STRUCTURE'), { to: 'APPROVAL_PENDING', funding: { committedUsd: 10, totalUsd: 10 }, evidence: { sources: {} } }, { now: () => T0 });
  assert.equal(merged.ok, false);
  assert.deepEqual(c.log.at(-1).reconciliation.changed, ['executableUsd']);
});

test('ledger references: only recorded Testnet hashes are cited, otherwise null + SIMULATION', () => {
  const H = 'A'.repeat(64);
  const known = knownHashesFrom({ launches: [{ code: 'BBL', steps: [{ key: 'fill', hash: H, result: 'tesSUCCESS', ledger: 5, explorer: 'x' }] }] });
  const c = walk('BOOTSTRAPPING');
  const ok = transition(c, { to: 'ACTIVE', funding: { executableUsd: 600 }, evidence: { ledgerHash: H } }, { now: () => T0, knownHashes: known });
  assert.ok(ok.ok); assert.equal(ok.record.ledgerRef.hash, H); assert.equal(ok.record.mode, 'LIVE_TESTNET');
  const fake = transition(c, { to: 'ACTIVE', funding: { executableUsd: 600 }, evidence: { ledgerHash: 'B'.repeat(64) } }, { now: () => T0, knownHashes: known });
  assert.equal(fake.ok, false); assert.match(fake.reasons.join(' '), /not in recorded Testnet evidence/);
});

test('XdlcStore persists, seeds, rejects with reasons and emits xdlc.transition without a `type` key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdlc-'));
  const file = path.join(dir, 'xdlc.json');
  const events = []; const bus = { publish: (t, mode, p) => events.push({ t, mode, p }) };
  const s = new XdlcStore({ file, now: () => T0, bus });
  assert.ok(fs.existsSync(file));
  assert.deepEqual(s.list().corridors.map((c) => [c.id, c.state]), [['xrp-rlusd', 'MATURE'], ['tst-bbl', 'APPROVAL_PENDING']]);
  assert.throws(() => s.advance('tst-bbl', { to: 'BOOTSTRAPPING', funding: { fundedUsd: 500 } }), (e) => e.status === 409 && /never self-approves/.test(e.message));
  const ok = s.advance('tst-bbl', { to: 'BOOTSTRAPPING', funding: { fundedUsd: 500 }, approved: true });
  assert.equal(ok.corridor.state, 'BOOTSTRAPPING');
  assert.equal(events.length, 1); assert.equal(events[0].t, 'xdlc.transition'); assert.ok(!('type' in events[0].p));
  const s2 = new XdlcStore({ file });
  assert.equal(s2.get('tst-bbl').state, 'BOOTSTRAPPING'); assert.ok(s2.get('tst-bbl').chain.ok);
  const created = s2.create({ marketId: 'mainnet:FUZZY', origin: 'RADAR_DISCOVERED' });
  assert.equal(created.state, 'DISCOVERY');
  assert.throws(() => s2.create({ marketId: 'x', origin: 'BOGUS' }), (e) => e.status === 400);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Radar ----------
const depth = (b, a, ammShare = 0) => ({ bids: [{ band: '2%', xrp: b, clobXrp: b * (1 - ammShare), ammXrp: b * ammShare }], asks: [{ band: '2%', xrp: a, clobXrp: a * (1 - ammShare), ammXrp: a * ammShare }] });
const ok = { eligible: true, checks: [] };
const SPOKES = [
  { id: 'mainnet:RLUSD:r1', network: 'mainnet', currency: 'RLUSD', issuer: 'r1', name: 'RLUSD', status: 'MAINNET_OBSERVED', eligibility: { eligible: true, checks: [{ id: 'clawback', ok: false, blocking: false, detail: 'clawback' }] }, market: { spreadBps: 6.7, vol24hXrp: 3_300_000, depthXrp: depth(75_000, 77_000, 0.2), makers: { asks: 52, bids: 36 }, amm: { xrp: 1_800_000 } } },
  { id: 'mainnet:GOOD:r2', network: 'mainnet', currency: 'GOOD', issuer: 'r2', name: 'Good', status: 'MAINNET_OBSERVED', eligibility: ok, market: { spreadBps: 70, vol24hXrp: 330_000, depthXrp: depth(4_600, 4_600, 0.8), makers: { asks: 8, bids: 7 } } },
  { id: 'mainnet:THIN:r3', network: 'mainnet', currency: 'THIN', issuer: 'r3', name: 'Thin', status: 'MAINNET_OBSERVED', eligibility: ok, market: { spreadBps: 8_000, vol24hXrp: 4_000, depthXrp: depth(90, 90, 1), makers: { asks: 0, bids: 0 } } },
  { id: 'mainnet:SCAM:r4', network: 'mainnet', currency: 'SCAM', issuer: 'r4', name: 'Scam', status: 'MAINNET_OBSERVED', eligibility: { eligible: false, checks: [{ id: 'scam_blocklist', ok: false, blocking: true }] }, market: { spreadBps: 300, vol24hXrp: 500_000, depthXrp: depth(100, 100) } },
];
const fixtureArgs = () => ({ spokes: SPOKES, xrpUsd: 1.3, profile: { pathfoundAll: { makerCapture: { hhi: 4222 } }, sampledAt: T0 }, pathfinderEvidence: null });

test('radar: explainable ranking with factor contributions, rationale and engine label', () => {
  const r = buildRadar(fixtureArgs());
  assert.match(r.engine.label, /demo|adapter/i);
  assert.match(r.adapter, /Not proprietary TG Intelligence/);
  assert.equal(r.model.name, MODEL.name);
  for (const c of r.ranking) {
    assert.ok(c.contributions.length >= 13 && c.rationale.length >= 2);
    assert.ok(['RADAR_DISCOVERED', 'PROJECT_REQUESTED'].includes(c.origin));
    const sum = Math.round(c.contributions.reduce((s, f) => s + f.contribution, 0) * 100) / 100;
    assert.ok(Math.abs(sum - c.score) < 0.05);
    for (const f of c.contributions) assert.ok(['MAINNET_OBSERVED', 'LIVE_TESTNET', 'SIMULATION'].includes(f.provenance));
  }
  assert.ok(r.ranking.some((c) => c.origin === 'PROJECT_REQUESTED' && c.candidate === false));
  assert.deepEqual(buildRadar(fixtureArgs()).ranking.map((c) => [c.id, c.score]), r.ranking.map((c) => [c.id, c.score]));
});

test('radar: a thin but unprofitable market ranks below a profitable one; ineligible ranks last', () => {
  const r = buildRadar(fixtureArgs());
  const pos = (cur) => r.ranking.findIndex((c) => c.currency === cur);
  const thin = r.ranking[pos('THIN')], good = r.ranking[pos('GOOD')];
  assert.ok(thin.contributions.find((f) => f.id === 'thin_liquidity').norm > good.contributions.find((f) => f.id === 'thin_liquidity').norm, 'THIN is thinner');
  assert.ok(thin.economics.netBenefitUsd.base < 0, 'thin market loses money after costs');
  assert.ok(good.economics.netBenefitUsd.base > 0, 'good market is positive');
  assert.ok(pos('GOOD') < pos('THIN'));
  assert.ok(pos('THIN') < pos('SCAM'));
  assert.equal(r.ranking[pos('SCAM')].candidate, false);
  assert.equal(pickDestination(r).candidate.currency, 'GOOD');
  const e = economics(thin.metrics, { xrpUsd: 1.3, availableCapitalUsd: 150_000 });
  assert.ok(e.netBenefitUsd.low <= e.netBenefitUsd.base && e.netBenefitUsd.base <= e.netBenefitUsd.high);
});

// ---------- Redeploy ----------
test('redeploy: excludes Tier 1/2/3 capital, stops without approval, moves only proprietary capital with approval', () => {
  const radar = buildRadar(fixtureArgs());
  const blocked = runRedeploy({ radar, spokes: SPOKES, xrpUsd: 1.3 });
  assert.equal(blocked.blocked, 'AWAITING_OPERATOR_APPROVAL');
  assert.equal(blocked.allocation.moved, false);
  assert.deepEqual(blocked.allocation.after, blocked.allocation.before);
  assert.ok(!blocked.steps.some((s) => s.id === 'destination_funding'));
  assert.equal(blocked.steps.find((s) => s.id === 'guardian_approval').status, 'awaiting_approval');
  assert.equal(blocked.lifecycle[0].ok, false);

  const run = runRedeploy({ radar, spokes: SPOKES, xrpUsd: 1.3, approved: true });
  assert.equal(run.mode, 'SIMULATION'); assert.equal(run.allocation.moved, true);
  const ids = run.steps.map((s) => s.id);
  for (const id of ['opportunity_identification', 'current_proprietary_deployment', 'external_funded_liquidity', 'maturity_resilience', 'economic_value_existing_support', 'comparative_attractiveness', 'estimated_releasable_capital', 'guardian_approval', 'sentinel_risks', 'candidate_offer_cancellation', 'available_balance_verification', 'asset_conversion', 'destination_funding', 'new_offers', 'subsequent_fills', 'before_after_allocation']) assert.ok(ids.includes(id), id);
  for (const t of ['T1', 'T2', 'T3']) {
    const b = run.allocation.before.find((x) => x.bucket === t), a = run.allocation.after.find((x) => x.bucket === t);
    assert.equal(a.usd, b.usd); assert.equal(a.reallocatable, false);
  }
  const propBefore = run.allocation.before.filter((x) => x.bucket === 'proprietary').reduce((s, x) => s + x.usd, 0);
  const after = run.allocation.after.filter((x) => x.bucket === 'proprietary' || x.bucket === 'conversion_cost').reduce((s, x) => s + x.usd, 0);
  assert.ok(Math.abs(propBefore - after) <= 2, 'proprietary capital conserved (moved + conversion cost)');
  assert.equal(propBefore, DEMO_POOL.proprietaryUsd);
  const rel = run.steps.find((s) => s.id === 'estimated_releasable_capital');
  assert.ok(rel.releaseUsd <= DEMO_POOL.proprietaryUsd);
  const fills = run.steps.find((s) => s.id === 'subsequent_fills');
  assert.ok(fills.netUsd.low <= fills.netUsd.high);
  assert.match(run.steps.find((s) => s.id === 'available_balance_verification').summary, /NOT profit/);
  assert.ok(run.lifecycle.every((l) => l.ok)); assert.equal(run.lifecycle.at(-1).to, 'NEW_CORRIDOR_ACTIVE');
  // deterministic
  assert.equal(runRedeploy({ radar, spokes: SPOKES, xrpUsd: 1.3, approved: true }).runId, run.runId);
  assert.deepEqual(runRedeploy({ radar, spokes: SPOKES, xrpUsd: 1.3, approved: true }).lifecycle, run.lifecycle);
});
