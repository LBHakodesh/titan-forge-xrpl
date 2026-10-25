// x402 Payments & Data: protocol shapes, entitlement routing, Sentinel fixtures, counting rules, budgets, live path (fake ledger).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, decode, hashes } from 'xrpl';
import { X402Service } from '../lib/x402/service.mjs';
import { HEADERS, b64encode, b64decode, paymentRequirements, paymentRequired, settlementResponse, X402_VERSION } from '../lib/x402/protocol.mjs';
import { verifySignedBlob, invoiceHash, maxLastLedger } from '../lib/x402/xrpl-exact.mjs';
import { LiveTestnetFacilitator, InvoiceBook } from '../lib/x402/facilitator.mjs';
import { Telemetry, validEvidence } from '../lib/x402/telemetry.mjs';
import { RateLimiter, evaluateSpend, normalizePolicy } from '../lib/x402/policy.mjs';

const ROUTER_W = Wallet.generate(), ISSUER = Wallet.generate().address;
const ROUTER = ROUTER_W.address;
const HASH = 'A'.repeat(64);
const store = { launches: [{ id: 'l1', code: 'TST', name: 'Test', status: 'live', stage: 'spoke', fillHash: 'B'.repeat(64), steps: [{ key: 'trust_maker', ledger: 10 }, { key: 'fill', ledger: 16, result: 'tesSUCCESS' }], book: { asks: [{ account: ROUTER, qty: 900, priceXrp: 0.01 }], bids: [{ account: ROUTER, qty: 100, priceXrp: 0.008 }] } }],
  byCode(c) { return this.launches.find((l) => l.code === c); } };
// Fake ledger implementing the x402 helpers of lib/ledger.mjs (exclusive / signOffline / submitSigned). No network.
// submit() exists only to prove the live path never calls it.
function fakeLedger({ result = 'tesSUCCESS', validated = true, deliver = (tx) => tx.Amount, mutate = null, readonlyEnv = false } = {}) {
  const decodeTx = (blob) => decode(blob);
  return { wallets: { router: { address: ROUTER }, issuer: { address: ISSUER } }, calls: [], signed: 0, submittedSigned: [], seq: 7, locked: false,
    client: { getLedgerIndex: async () => 1000 },
    async exclusive(role, fn) { assert.equal(role, 'router'); assert.equal(this.locked, false); this.locked = true; try { return await fn(); } finally { this.locked = false; } },
    async submit(role, tx) { this.calls.push({ role, tx }); throw new Error('ledger.submit must not be used by the x402 live path'); },
    async signOffline(role, tx) {
      if (readonlyEnv) throw new Error('Read-only instance: signing disabled');
      assert.equal(role, 'router'); assert.equal(this.locked, true, 'signOffline must run inside exclusive(router)');
      this.signed++;
      const prepared = { ...tx, Account: ROUTER, Fee: '12', Sequence: this.seq++, ...(mutate || {}) };
      const { tx_blob, hash } = ROUTER_W.sign(prepared);
      return { signedTxBlob: tx_blob, hash };
    },
    async submitSigned(blob) {
      const tx = decodeTx(blob);
      this.submittedSigned.push(tx);
      const hash = hashes.hashSignedTx(blob);
      (this.submittedHashes ??= []).push(hash);
      const out = { hash, result, ledger: 1001, validated, explorer: 'x', meta: { TransactionResult: result, delivered_amount: deliver(tx) } };
      if (result !== 'tesSUCCESS') throw Object.assign(new Error(`Signed transaction failed: ${result}`), { tx: out });
      return out;
    } };
}
const bus = () => ({ events: [], publish(type, mode, p) { if (!['LIVE_TESTNET', 'SIMULATION', 'REPLAY', 'MAINNET_OBSERVED'].includes(mode)) throw new Error('bad mode'); this.events.push({ type, mode, ...p }); } });
const x402Access = () => ({ decision: 'x402', reason: 'test' });
const mk = (o = {}) => new X402Service({ store, sentinel: null, checkAccess: x402Access, env: {}, httpRateLimit: 1000, ...o });

test('protocol v2 shapes and header names', () => {
  assert.deepEqual(HEADERS, { required: 'PAYMENT-REQUIRED', signature: 'PAYMENT-SIGNATURE', response: 'PAYMENT-RESPONSE' });
  const req = paymentRequirements({ amountDrops: 50000, payTo: ISSUER, invoiceId: 'i1' });
  assert.deepEqual(Object.keys(req).sort(), ['amount', 'asset', 'extra', 'maxTimeoutSeconds', 'network', 'payTo', 'scheme']);
  assert.equal(req.scheme, 'exact'); assert.equal(req.network, 'xrpl:1'); assert.equal(req.asset, 'XRP'); assert.equal(req.amount, '50000');
  assert.equal(req.extra.areFeesSponsored, false); assert.equal(req.extra.assetTransferMethod, 'sequence');
  const pr = paymentRequired({ url: '/x', description: 'd', accepts: [req] });
  assert.equal(pr.x402Version, 2); assert.ok(pr.resource.url); assert.equal(pr.accepts.length, 1);
  assert.deepEqual(b64decode(b64encode(pr)), pr);
  assert.equal(b64decode('not base64!!'), null);
  const ok = settlementResponse({ success: true, transaction: HASH, network: 'xrpl:1', payer: ROUTER });
  assert.equal(ok.errorReason, undefined);
  const bad = settlementResponse({ success: false, errorReason: 'duplicate_settlement', network: 'xrpl:1' });
  assert.equal(bad.success, false); assert.equal(bad.transaction, '');
});

test('402 challenge carries base64 PaymentRequired; full header round trip settles (SIMULATION)', async () => {
  const b = bus(); const svc = mk({ bus: b });
  const r1 = await svc.premium('wake', {});
  assert.equal(r1.status, 402);
  const pr = b64decode(r1.headers['PAYMENT-REQUIRED']);
  assert.equal(pr.x402Version, X402_VERSION); assert.equal(pr.accepts[0].network, 'xrpl:1');
  assert.equal(r1.body.data, undefined);
  const inv = pr.accepts[0].extra.invoiceId;
  const auth = svc.simAuthorize({ resource: 'wake', invoiceId: inv });
  assert.equal(auth.status, 200); assert.equal(auth.body.header, 'PAYMENT-SIGNATURE');
  const r2 = await svc.premium('wake', { paymentHeader: auth.body.value });
  assert.equal(r2.status, 200); assert.equal(r2.body.paid, true); assert.ok(r2.body.data);
  const sr = b64decode(r2.headers['PAYMENT-RESPONSE']);
  assert.equal(sr.success, true); assert.match(sr.transaction, /^[0-9A-F]{64}$/); assert.equal(sr.network, 'xrpl:1');
  assert.equal(r2.evidence.kind, 'SIMULATED_FIXTURE');
  const types = b.events.map((e) => e.type);
  for (const t of ['x402.request', 'x402.challenge', 'x402.settled']) assert.ok(types.includes(t), t);
  assert.ok(b.events.every((e) => e.mode === 'SIMULATION'));
  // invoice consumed: same header cannot be reused
  const r3 = await svc.premium('wake', { paymentHeader: auth.body.value });
  assert.equal(r3.status, 402); assert.equal(r3.body.data, undefined);
  assert.ok(b.events.some((e) => e.type === 'x402.rejected'));
});

test('entitlement routing: only x402 decisions are challenged; subscription/free/essential never get a 402; deny -> 403', async () => {
  for (const decision of ['subscription', 'free', 'essential']) {
    const svc = mk({ checkAccess: () => ({ decision, reason: 't' }) });
    const r = await svc.premium('wake', {});
    assert.equal(r.status, 200, decision); assert.equal(r.body.paid, false); assert.equal(r.headers['PAYMENT-REQUIRED'], undefined);
    const s = svc.telemetry.snapshot().books.OBSERVED;
    assert.equal(s.challenges, 0); assert.equal(s.settlementConfirmations, 0); assert.equal(s.verifiedPaid, 0); assert.equal(s.revenue.length, 0);
  }
  for (const decision of ['deny', 'weird', undefined]) {
    const r = await mk({ checkAccess: () => ({ decision, reason: 'no' }) }).premium('wake', {});
    assert.equal(r.status, 403); assert.equal(r.body.control, 'entitlement'); assert.equal(r.body.data, undefined);
  }
  const thrower = await mk({ checkAccess: () => { throw new Error('down'); } }).premium('wake', {});
  assert.equal(thrower.status, 403);
  const seen = [];
  await mk({ checkAccess: (a) => (seen.push(a), { decision: 'x402' }) }).premium('wake', { participantId: 'live-maker' });
  assert.equal(seen[0].participantId, 'live-maker'); assert.equal(seen[0].resource, 'data.wake_signals'); assert.equal(seen[0].mode, 'SIMULATION');
  // entitlement is asked in the participant's own mode, not the payment mode
  const modes = [];
  await mk({ checkAccess: (a) => (modes.push(a.mode), { decision: 'x402' }), participantMode: (id) => (id === 'live-maker' ? 'LIVE_TESTNET' : null), resolveParticipant: async (id) => modes.push(`resolved:${id}`) }).premium('wake', { participantId: 'live-maker' });
  assert.deepEqual(modes, ['resolved:live-maker', 'LIVE_TESTNET']);
  // default entitlement module: anonymous premium data -> optional x402
  const real = new X402Service({ store, sentinel: null, env: {} });
  assert.equal((await real.premium('wake', { participantId: 'anonymous' })).status, 402);
  // restricted resource is never sold even if entitlement says x402
  const p = await mk().premium('positions', {});
  assert.equal(p.status, 403); assert.equal(p.body.control, 'entitlement');
});

test('free samples are never gated', async () => {
  const svc = mk({ checkAccess: () => ({ decision: 'deny' }) });
  for (const r of svc.catalog) { const s = await svc.sample(r.id); assert.ok([200, 503].includes(s.status)); assert.equal(s.body.tier ?? 'FREE_SAMPLE', 'FREE_SAMPLE'); }
});

test('every Sentinel fixture is rejected by the expected control and never unlocks data', async () => {
  const svc = mk();
  const expect = { invalid_signature: 'verifier', replay: 'verifier', excessive_spend: 'spend-policy', unsupported_network: 'verifier', rate_limit: 'rate-limiter', restricted_access: 'entitlement' };
  for (const a of svc.attacks()) {
    const r = await svc.runAttack(a.id);
    assert.equal(r.rejected, true, a.id); assert.equal(r.dataUnlocked, false, a.id);
    assert.ok(r.caughtBy.includes(expect[a.id]), `${a.id}: ${r.caughtBy}`);
    for (const at of r.attempts.filter((x) => x.label.startsWith('attack'))) { assert.equal(at.delivered, false); assert.ok(at.reason, `${a.id} has reason`); }
  }
  const rp = await svc.runAttack('replay');
  assert.equal(rp.attempts[0].status, 200); assert.equal(rp.attempts[1].reason, 'duplicate_settlement');
  assert.equal(svc.runAttack('nope') instanceof Promise, true);
});

test('payment failures never unlock restricted data (all tamper variants)', async () => {
  const svc = mk();
  for (const tamper of ['signature', 'network', 'mainnet', 'underpay']) {
    const off = (await svc.premium('capital', {})).offered;
    const r = await svc.premium('capital', { payload: svc.payer.authorize(off, { currentLedger: svc.simLedger(), tamper }) });
    assert.equal(r.status, 402, tamper); assert.equal(r.delivered, false); assert.equal(r.body.data, undefined);
    assert.equal(b64decode(r.headers['PAYMENT-RESPONSE']).success, false);
  }
  const garbage = await svc.premium('capital', { paymentHeader: 'Zm9v' });
  assert.ok([400, 402].includes(garbage.status)); assert.equal(garbage.body.data, undefined);
  const s = svc.telemetry.snapshot().books.OBSERVED;
  assert.equal(s.settlementConfirmations, 0); assert.equal(s.verifiedPaid, 0); assert.equal(s.revenue.length, 0);
});

test('verifier rules: destination, LastLedgerSequence window, partial payment, InvoiceID, memos', () => {
  const w = Wallet.generate();
  const offered = paymentRequirements({ amountDrops: 20000, payTo: ISSUER, invoiceId: 'inv-1' });
  const base = { TransactionType: 'Payment', Account: w.address, Destination: ISSUER, Amount: '20000', Fee: '12', Sequence: 3, LastLedgerSequence: 106, InvoiceID: invoiceHash('inv-1') };
  const pp = (tx) => ({ x402Version: 2, accepted: offered, payload: { signedTxBlob: w.sign(tx).tx_blob } });
  const ctx = { currentLedger: 100, invoiceOpen: () => true };
  assert.equal(verifySignedBlob(pp(base), offered, ctx).isValid, true);
  const cases = {
    invalid_exact_xrpl_payload_recipient_mismatch: { Destination: ROUTER },
    invalid_exact_xrpl_payload_last_ledger_sequence: { LastLedgerSequence: maxLastLedger(100, 60) + 1 },
    invalid_exact_xrpl_payload_unsafe_field: { Flags: 0x00020000 },
    invalid_exact_xrpl_payload_invoice: { InvoiceID: invoiceHash('other') },
    invalid_exact_xrpl_payload_amount_mismatch: { Amount: '20001' },
    invalid_exact_xrpl_payload_network_id: { NetworkID: 1 },
  };
  for (const [reason, patch] of Object.entries(cases)) assert.equal(verifySignedBlob(pp({ ...base, ...patch }), offered, ctx).invalidReason, reason, reason);
  assert.equal(verifySignedBlob(pp({ ...base, Memos: [{ Memo: { MemoData: 'AA' } }] }), offered, ctx).invalidReason, 'invalid_exact_xrpl_payload_unsafe_field');
  assert.equal(verifySignedBlob(pp(base), offered, { ...ctx, invoiceOpen: () => false }).invalidReason, 'invalid_exact_xrpl_payload_invoice');
  assert.equal(verifySignedBlob({ ...pp(base), x402Version: 1 }, offered, ctx).invalidReason, 'invalid_x402_version');
});

test('counting rules: 402 is never a payment; nothing is settled or earned without settlement evidence', () => {
  const t = new Telemetry();
  t.record({ provenance: 'OBSERVED', kind: 'challenge', status: 402, endpoint: 'data/wake' });
  let s = t.snapshot().books.OBSERVED;
  assert.equal(s.challenges, 1); assert.equal(s.verifiedPaid, 0); assert.equal(s.settlementConfirmations, 0);
  t.record({ provenance: 'OBSERVED', kind: 'settled', endpoint: 'data/wake', evidence: null });
  t.record({ provenance: 'OBSERVED', kind: 'delivered_paid', status: 200, endpoint: 'data/wake' });
  t.record({ provenance: 'OBSERVED', kind: 'settled', evidence: { kind: 'LIVE_TESTNET_VALIDATED', transaction: HASH, amountDrops: '1000', validated: false, result: 'tesSUCCESS', deliveredDrops: '1000', network: 'xrpl:1', asset: 'XRP' } });
  s = t.snapshot().books.OBSERVED;
  assert.equal(s.settlementConfirmations, 0); assert.equal(s.verifiedPaid, 0); assert.equal(s.revenue.length, 0); assert.equal(s.rejectedEvidence, 3);
  const good = { kind: 'LIVE_TESTNET_VALIDATED', transaction: HASH, amountDrops: '1000', validated: true, result: 'tesSUCCESS', deliveredDrops: '1000', network: 'xrpl:1', asset: 'XRP' };
  assert.equal(validEvidence(good), true);
  t.record({ provenance: 'OBSERVED', kind: 'settled', evidence: good });
  s = t.snapshot().books.OBSERVED;
  assert.equal(s.settlementConfirmations, 1); assert.deepEqual(s.revenue.map((r) => [r.network, r.asset, r.evidenceKind, r.drops]), [['xrpl:1', 'XRP', 'LIVE_TESTNET_VALIDATED', 1000]]);
  assert.equal(t.snapshot().books.SIMULATION.revenue.length, 0); // books stay separate
  assert.throws(() => t.record({ provenance: 'LIVE', kind: 'request' }));
});

test('revenue in a service comes only from settled evidence; replay never adds settlements', async () => {
  const svc = mk();
  await svc.premium('wake', {}); await svc.premium('wake', {});
  const run = await svc.runFlow({ resource: 'fills' });
  assert.equal(run.ok, true);
  const sim = svc.telemetry.snapshot().books.SIMULATION;
  assert.equal(sim.settlementConfirmations, 1);
  assert.deepEqual(sim.revenue.map((r) => [r.evidenceKind, r.drops]), [['SIMULATED_FIXTURE', svc.resource('fills').priceDrops]]);
  assert.equal(svc.telemetry.snapshot().books.OBSERVED.revenue.length, 0);
  const rep = svc.replay(run.id);
  assert.equal(rep.mode, 'REPLAY');
  const r = svc.telemetry.snapshot().books.REPLAY;
  assert.equal(r.settlementConfirmations, 0); assert.equal(r.revenue.length, 0);
});

test('spend policy, session budget and rate limits', () => {
  const policy = normalizePolicy({});
  const req = paymentRequirements({ amountDrops: 50_000, payTo: ISSUER });
  assert.equal(evaluateSpend({ policy, resource: 'wake', requirements: req, authorized: false }).blockedBy, 'spend-policy');
  assert.equal(evaluateSpend({ policy, resource: 'wake', requirements: req, authorized: true }).allowed, true);
  assert.equal(evaluateSpend({ policy, resource: 'sentinel', requirements: req, authorized: true }).allowed, false);
  assert.equal(evaluateSpend({ policy, resource: 'wake', requirements: req, authorized: true, spentDrops: 120_000 }).allowed, false);
  assert.equal(evaluateSpend({ policy, resource: 'wake', requirements: { ...req, network: 'xrpl:0' }, authorized: true }).allowed, false);
  assert.equal(normalizePolicy({ requireAuthorization: false, approvedNetworks: ['xrpl:0', 'eip155:8453'], maxPriceDrops: 9e9 }).requireAuthorization, true);
  assert.deepEqual(normalizePolicy({ approvedNetworks: ['xrpl:0'] }).approvedNetworks, []);
  assert.equal(normalizePolicy({ maxPriceDrops: 9e9 }).maxPriceDrops, 100_000);
  let t = 0; const rl = new RateLimiter({ limit: 2, windowMs: 1000, now: () => t });
  assert.equal(rl.check('a').ok, true); assert.equal(rl.check('a').ok, true); assert.equal(rl.check('a').ok, false);
  t = 1500; assert.equal(rl.check('a').ok, true);
});

test('agent demo: deterministic, policy-enforced, no unattended spending', async () => {
  const svc = mk();
  const no = await svc.runAgent({ authorized: false });
  assert.equal(no.bought.length, 0); assert.equal(no.spentXrp, 0); assert.equal(no.updated.changed, false);
  const yes = await svc.runAgent({ authorized: true });
  assert.deepEqual(yes.bought.map((b) => b.resource), ['wake', 'capital']);
  assert.ok(yes.spentXrp <= yes.budgetXrp);
  assert.equal(yes.baseline.action, 'hold'); assert.equal(yes.updated.changed, true); assert.equal(yes.updated.fromMarket, 'real_estate');
  assert.match(yes.disclaimer, /does not guarantee a better allocation/);
  assert.equal(yes.log.find((l) => l.resource === 'fills').blockedBy, 'spend-policy');
  const again = await mk().runAgent({ authorized: true });
  assert.deepEqual(again.updated, yes.updated);
});

test('LIVE_TESTNET with fake ledger: spec-form signedTxBlob, approval, Guardian, validated settlement, delivery only after settlement', async () => {
  const ledger = fakeLedger(); const b = bus();
  const svc = mk({ ledger, ledgerReady: () => true, bus: b });
  const refused = await svc.runFlow({ resource: 'wake', mode: 'LIVE_TESTNET', approval: false });
  assert.equal(refused.refused, true); assert.equal(ledger.signed, 0); assert.equal(ledger.submittedSigned.length, 0);
  const ok = await svc.runFlow({ resource: 'wake', mode: 'LIVE_TESTNET', approval: true });
  assert.equal(ok.ok, true, JSON.stringify(ok.result));
  assert.equal(ledger.calls.length, 0, 'never ledger.submit');
  assert.equal(ledger.signed, 1); assert.equal(ledger.submittedSigned.length, 1);
  const tx = ledger.submittedSigned[0];
  assert.equal(tx.TransactionType, 'Payment'); assert.equal(tx.Account, ROUTER); assert.equal(tx.Destination, ISSUER); assert.equal(tx.Amount, '50000');
  assert.equal(tx.InvoiceID, invoiceHash(ok.challenge.accepts[0].extra.invoiceId));
  assert.ok(tx.LastLedgerSequence <= maxLastLedger(1000, 60));
  assert.equal(ok.steps.find((x) => x.step === 'AUTHORIZATION').detail.form.startsWith('signedTxBlob'), true);
  assert.equal(ok.steps.find((x) => x.step === 'VERIFICATION').ok, true);
  assert.equal(ok.result.evidence.kind, 'LIVE_TESTNET_VALIDATED'); assert.match(ok.result.evidence.explorer, /^https:\/\/testnet\.xrpl\.org\/transactions\//);
  assert.equal(ok.result.evidence.transaction, ledger.submittedHashes[0]);
  const obs = svc.telemetry.snapshot().books.OBSERVED;
  assert.deepEqual(obs.revenue.map((r) => [r.evidenceKind, r.drops]), [['LIVE_TESTNET_VALIDATED', 50000]]);
  assert.ok(b.events.some((e) => e.type === 'x402.settled' && e.mode === 'LIVE_TESTNET'));
  assert.ok(!JSON.stringify(ok).includes('signedTxBlob":"'), 'signed blob never returned');
});

test('LIVE_TESTNET verifier runs on the signed blob: replay, unsafe fields, wrong payee and external payloads are refused before submit', async () => {
  const ledger = fakeLedger();
  const svc = mk({ ledger, ledgerReady: () => true });
  const off = (await svc.premium('capital', { mode: 'LIVE_TESTNET' })).offered;
  const s1 = await svc.live.purchase(off, { approval: true });
  assert.equal(s1.settlement.success, true);
  const dup = await svc.live.settleBlob(s1.payload, off, { approval: true, currentLedger: 1000 });
  assert.equal(dup.settlement.success, false); assert.equal(dup.settlement.errorReason, 'duplicate_settlement');
  assert.equal(ledger.submittedSigned.length, 1);
  for (const [mutate, reason] of [[{ Memos: [{ Memo: { MemoData: 'AA' } }] }, 'invalid_exact_xrpl_payload_unsafe_field'], [{ Flags: 0x00020000 }, 'invalid_exact_xrpl_payload_unsafe_field'], [{ Destination: ROUTER }, 'invalid_exact_xrpl_payload_recipient_mismatch'], [{ Amount: '1' }, 'invalid_exact_xrpl_payload_amount_mismatch'], [{ NetworkID: 1 }, 'invalid_exact_xrpl_payload_network_id']]) {
    const l = fakeLedger({ mutate });
    const s = mk({ ledger: l, ledgerReady: () => true });
    const r = await s.runFlow({ resource: 'wake', mode: 'LIVE_TESTNET', approval: true });
    assert.equal(r.ok, false); assert.equal(r.result.reason, reason, JSON.stringify(mutate)); assert.equal(r.result.data, undefined);
    assert.equal(l.submittedSigned.length, 0, 'nothing submitted after failed verification');
  }
  // an externally supplied payload is never accepted in LIVE mode
  const ext = await svc.premium('wake', { mode: 'LIVE_TESTNET', payload: s1.payload, approval: true });
  assert.equal(ext.status, 400); assert.equal(ext.body.data, undefined);
});

test('LIVE_TESTNET failures never deliver: tec result, not validated, short delivery', async () => {
  for (const l of [fakeLedger({ result: 'tecUNFUNDED_PAYMENT' }), fakeLedger({ validated: false }), fakeLedger({ deliver: () => '1' })]) {
    const svc = mk({ ledger: l, ledgerReady: () => true });
    const r = await svc.runFlow({ resource: 'wake', mode: 'LIVE_TESTNET', approval: true });
    assert.equal(r.ok, false); assert.equal(r.result.data, undefined);
    const s = svc.telemetry.snapshot().books.OBSERVED;
    assert.equal(s.settlementConfirmations, 0); assert.equal(s.revenue.length, 0); assert.equal(s.settlementFailures, 1);
  }
});

test('TF_READONLY instance refuses live settlement; budget caps 0.1 XRP/request and 1 XRP/session', async () => {
  const ledger = fakeLedger({ readonlyEnv: true });
  const ro = mk({ ledger, ledgerReady: () => true, env: { TF_READONLY: '1' } });
  const r = await ro.runFlow({ resource: 'wake', mode: 'LIVE_TESTNET', approval: true });
  assert.equal(r.refused, true); assert.ok(r.reasons.some((x) => /Read-only/.test(x))); assert.equal(ledger.signed, 0); assert.equal(ledger.submittedSigned.length, 0);
  const f = new LiveTestnetFacilitator({ ledger, isReady: () => true, invoices: new InvoiceBook(), env: { TF_READONLY: '1' } });
  const off = paymentRequirements({ amountDrops: 1000, payTo: ISSUER });
  assert.equal((await f.purchase(off, { approval: true })).settlement.success, false); assert.equal(ledger.signed, 0);
  const l2 = fakeLedger();
  const f2 = new LiveTestnetFacilitator({ ledger: l2, isReady: () => true, invoices: new InvoiceBook(), env: {} });
  assert.equal(f2.preflight({ amountDrops: 100_001, approval: true }).allowed, false);
  assert.equal(f2.preflight({ amountDrops: 25_000_000, approval: true }).guardian.allowed, false);
  let ok = 0;
  for (let i = 0; i < 12; i++) { const o = paymentRequirements({ amountDrops: 100_000, payTo: ISSUER }); if ((await f2.purchase(o, { approval: true })).settlement.success) ok++; }
  assert.equal(ok, 10); assert.equal(f2.budget().remainingDrops, 0); assert.equal(l2.signed, 10);
});

test('telemetry and responses never expose signed payloads, seeds or full addresses', async () => {
  const svc = mk({ ledger: fakeLedger(), ledgerReady: () => true });
  await svc.runFlow({ resource: 'wake' }); await svc.runFlow({ resource: 'book', mode: 'LIVE_TESTNET', approval: true });
  for (const a of svc.attacks()) await svc.runAttack(a.id);
  const dump = JSON.stringify([svc.telemetry.recent(500), svc.telemetry.snapshot(), svc.listRuns(), svc.runs, svc.status()]);
  assert.ok(!/signedTxBlob"\s*:\s*"[0-9A-F]/i.test(dump)); assert.ok(!/seed/i.test(dump.replace(/seeds?, keys/g, '')));
  assert.ok(!dump.includes(ROUTER) && !dump.includes(svc.payer.address));
  const book = await svc.runFlow({ resource: 'book' });
  assert.ok(!JSON.stringify(book).includes(ROUTER));
});
