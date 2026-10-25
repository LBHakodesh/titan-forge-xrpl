// Sentinel unit tests: fixture ledger responses only, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeAccountFlags, hhi, levenshtein, skeleton, identityCollision, impersonationIssues,
  normalizeOffer, offerHealth, bookConcentration, tradesFromTx, verifyStep, analyze, guardianDemo, EXERCISE, Sentinel,
} from '../lib/sentinel.mjs';

const ROLES = { issuer: 'rISSUER', maker: 'rMAKER', taker: 'rTAKER' };
const tok = (v, code = 'BBL') => ({ currency: code, issuer: ROLES.issuer, value: String(v) });

test('decodes AccountRoot flags including the high clawback bit', () => {
  const f = decodeAccountFlags(0x00800000);
  assert.equal(f.DefaultRipple, true);
  assert.equal(f.NoFreeze, false);
  assert.equal(f.AllowTrustLineClawback, false);
  const g = decodeAccountFlags((0x80000000 | 0x00040000 | 0x00400000 | 0x00200000 | 0x00100000) >>> 0);
  assert.deepEqual([g.AllowTrustLineClawback, g.RequireAuth, g.GlobalFreeze, g.NoFreeze, g.DisableMaster, g.DefaultRipple], [true, true, true, true, true, false]);
});

test('HHI: monopoly, equal split and empty', () => {
  assert.equal(hhi([100]), 10000);
  assert.equal(hhi([25, 25, 25, 25]), 2500);
  assert.equal(hhi([999900, 100]), 9998);
  assert.equal(hhi([]), 0);
});

test('similarity: edit distance, homoglyphs, case', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(skeleton('B8L'), skeleton('BBL'));
  assert.equal(skeleton('BrookIyn Bu11ies'), skeleton('Brooklyn Bullies'));
  assert.equal(skeleton('Сoinbase'), skeleton('coinbase')); // Cyrillic С
  const a = { code: 'BBL', name: 'Brooklyn Bullies' };
  assert.equal(identityCollision(a, { code: 'B8L', name: 'Other' }).severity, 'high');
  assert.equal(identityCollision(a, { code: 'XYZ', name: 'brooklyn bullies' }).severity, 'high');
  assert.equal(identityCollision(a, { code: 'XYZ', name: 'Brooklyn Bulies' }).severity, 'medium');
  assert.equal(identityCollision(a, { code: 'BBX', name: 'Totally Different' }).severity, 'low');
  assert.equal(identityCollision(a, { code: 'QRS', name: 'Moon Garden' }), null);
});

test('impersonation reuses validate.mjs rules, including folded look-alikes', () => {
  assert.deepEqual(impersonationIssues({ code: 'BBL', name: 'Brooklyn Bullies' }), []);
  assert.ok(impersonationIssues({ code: 'USD', name: 'Fine Name' }).some((x) => /reserved/.test(x)));
  assert.ok(impersonationIssues({ code: 'ABC', name: 'R1pple Fans' }).some((x) => /Look-alike/.test(x)));
  assert.ok(impersonationIssues({ code: 'ABC', name: 'Сoinbase Club' }).some((x) => /Look-alike/.test(x))); // Cyrillic С
  assert.deepEqual(impersonationIssues({ code: 'ABC', name: 'Bu11dog Club' }), []);
});

test('unfunded and stale offer detection', () => {
  const funded = normalizeOffer({ Account: 'rMAKER', Sequence: 5, TakerGets: tok(900), TakerPays: '9000000', PreviousTxnLgrSeq: 1000 }, 'ask', 1100);
  const partial = normalizeOffer({ Account: 'rX', Sequence: 6, TakerGets: tok(1000000), taker_gets_funded: tok(120), TakerPays: '10000000000', PreviousTxnLgrSeq: 1 }, 'ask', 100000);
  assert.equal(funded.fundedRatio, 1);
  assert.equal(funded.xrp, 9);
  assert.ok(partial.fundedRatio < 0.001);
  const h = offerHealth([funded, partial]);
  assert.deepEqual(h.unfunded.map((o) => o.seq), [6]);
  assert.deepEqual(h.stale.map((o) => o.seq), [6]); // ~108h old
  const bid = normalizeOffer({ Account: 'rMAKER', TakerGets: '800000', TakerPays: tok(100) }, 'bid', null);
  assert.equal(bid.tokenQty, 100); assert.equal(bid.xrp, 0.8); assert.equal(bid.ageHours, null);
});

test('book concentration and withdrawal exposure', () => {
  const offers = [{ account: 'A', fundedXrp: 6 }, { account: 'B', fundedXrp: 3 }, { account: 'A', fundedXrp: 1 }];
  const c = bookConcentration(offers);
  assert.equal(c.top, 'A');
  assert.equal(c.withdrawalExposure, 0.7);
  assert.equal(c.hhi, 5800);
});

const FILL = {
  hash: 'FILLHASH', validated: true, ledger_index: 21771688,
  tx_json: { TransactionType: 'OfferCreate', Account: 'rTAKER' },
  meta: { TransactionResult: 'tesSUCCESS', AffectedNodes: [
    { ModifiedNode: { LedgerEntryType: 'Offer', FinalFields: { Account: 'rMAKER', TakerGets: tok(900), TakerPays: '9000000' }, PreviousFields: { TakerGets: tok(1000), TakerPays: '10000000' } } },
    { ModifiedNode: { LedgerEntryType: 'RippleState', FinalFields: {} } },
  ] },
};

test('demo-wash detection: both sides controlled vs external taker', () => {
  const ctrl = new Set(Object.values(ROLES));
  const t = tradesFromTx(FILL, 'BBL', ctrl);
  assert.equal(t.controlled, true); assert.equal(t.tokenQty, 100); assert.deepEqual(t.makers, ['rMAKER']);
  const ext = tradesFromTx({ ...FILL, tx_json: { ...FILL.tx_json, Account: 'rSTRANGER' } }, 'BBL', ctrl);
  assert.equal(ext.controlled, false);
  assert.equal(tradesFromTx(FILL, 'XYZ', ctrl), null); // other currency
  assert.equal(tradesFromTx({ ...FILL, meta: { ...FILL.meta, TransactionResult: 'tecKILLED' } }, 'BBL', ctrl), null);
  const created = { ...FILL, meta: { TransactionResult: 'tesSUCCESS', AffectedNodes: [{ CreatedNode: { LedgerEntryType: 'Offer', NewFields: { Account: 'rMAKER' } } }] } };
  assert.equal(tradesFromTx(created, 'BBL', ctrl), null);
});

test('verifyStep requires validated + tesSUCCESS + recorded ledger', () => {
  const step = { key: 'fill', hash: 'FILLHASH', ledger: 21771688, result: 'tesSUCCESS' };
  assert.equal(verifyStep(step, FILL).ok, true);
  assert.equal(verifyStep(step, { ...FILL, validated: false }).ok, false);
  assert.equal(verifyStep(step, { ...FILL, ledger_index: 5 }).ok, false);
  assert.equal(verifyStep(step, null).ok, false);
});

function fixture(over = {}) {
  return {
    launch: { id: 'L1', code: 'BBL', name: 'Brooklyn Bullies', organic: false, steps: [] },
    launches: [{ code: 'BBL', name: 'Brooklyn Bullies', status: 'live' }, { code: 'B8L', name: 'Brooklyn Bulls', status: 'live' }],
    roles: ROLES, validatedLedger: 21771800,
    accounts: {
      issuer: { account_data: { Flags: 0x00800000 }, signer_lists: [], objects: [{ LedgerEntryType: 'RippleState' }, { LedgerEntryType: 'FutureThing' }] },
      maker: { account_data: { Flags: 0, RegularKey: 'rREG' }, signer_lists: [], objects: [{ LedgerEntryType: 'Delegate', Authorize: 'rDEL', Permissions: [{ Permission: { PermissionValue: 'Payment' } }] }] },
      taker: { account_data: { Flags: 0 }, signer_lists: [{ SignerQuorum: 2, SignerEntries: [{}, {}, {}] }], objects: [] },
    },
    issuerLines: [
      { account: 'rMAKER', currency: 'BBL', balance: '-999900', limit: '0', limit_peer: '1000000' },
      { account: 'rTAKER', currency: 'BBL', balance: '-100', limit: '0', limit_peer: '1000000', freeze: true },
      { account: 'rMAKER', currency: 'ZZZ', balance: '-5', limit: '0', limit_peer: '10' },
    ],
    obligations: '1000000',
    asks: [{ Account: 'rMAKER', Sequence: 5, TakerGets: tok(900), TakerPays: '9000000', PreviousTxnLgrSeq: 21771688 }],
    bids: [{ Account: 'rMAKER', Sequence: 6, TakerGets: '800000', taker_gets_funded: '100000', TakerPays: tok(100), PreviousTxnLgrSeq: 21771688 }],
    trades: [tradesFromTx(FILL, 'BBL', new Set(Object.values(ROLES)))],
    verification: [verifyStep({ key: 'fill', hash: 'FILLHASH', ledger: 21771688 }, FILL)],
    ...over,
  };
}

test('analyze produces expected findings from fixtures', () => {
  const r = analyze(fixture());
  const by = Object.fromEntries(r.findings.map((x) => [x.id, x]));
  assert.ok(r.findings.every((x) => x.mode === 'LIVE_TESTNET' && x.evidence && x.whatItProtects && x.limits));
  assert.equal(by['issuer.default_ripple'].severity, 'info');
  assert.equal(by['issuer.freeze'].severity, 'low');
  assert.equal(by['issuer.clawback'].severity, 'info');
  assert.equal(by['keys.maker'].severity, 'medium');
  assert.equal(by['delegate.maker'].severity, 'medium');
  assert.match(by['delegate.issuer'].evidence, /FutureThing/); // unknown types handled gracefully
  assert.match(by['keys.taker'].title, /SignerList/);
  assert.equal(by['trustlines.freeze'].severity, 'high');
  assert.equal(by['supply.concentration'].severity, 'high');
  assert.equal(r.supplyHhi, 9998);
  assert.equal(r.holders.length, 2); // ZZZ line excluded
  assert.equal(by['book.concentration'].severity, 'high');
  assert.equal(by['book.unfunded'].severity, 'medium'); // bid 12.5% funded
  assert.equal(by['activity.demo'].severity, 'medium');
  assert.match(by['activity.demo'].title, /demo-generated/);
  assert.equal(by['identity.collision'].severity, 'high'); // B8L homoglyph
  assert.equal(by['ledger.verification'].severity, 'info');
  assert.equal(r.findings[0].severity, 'high'); // sorted
});

test('analyze flags clawback, empty book and failed verification', () => {
  const d = fixture({ asks: [], bids: [], launches: [], verification: [verifyStep({ key: 'x', hash: 'H' }, null)] });
  d.accounts.issuer.account_data.Flags = (0x80000000 | 0x00800000) >>> 0;
  const by = Object.fromEntries(analyze(d).findings.map((x) => [x.id, x]));
  assert.equal(by['issuer.clawback'].severity, 'high');
  assert.equal(by['book.depth'].severity, 'medium');
  assert.equal(by['ledger.verification'].severity, 'high');
  assert.equal(by['identity.collision'].severity, 'info');
});

test('Sentinel caches, dedupes events and only issues read commands', async () => {
  const d = fixture();
  const responses = {
    account_info: (p) => ({ account_data: d.accounts[Object.keys(ROLES).find((k) => ROLES[k] === p.account)].account_data, signer_lists: [] }),
    account_objects: () => ({ account_objects: [] }),
    account_lines: () => ({ lines: d.issuerLines, ledger_index: 21771800 }),
    gateway_balances: () => ({ obligations: { BBL: '1000000' } }),
    book_offers: (p) => ({ offers: p.taker_gets.currency === 'BBL' ? d.asks : d.bids, ledger_index: 21771800 }),
    account_tx: () => ({ transactions: [{ hash: 'FILLHASH', tx_json: FILL.tx_json, meta: FILL.meta, ledger_index: 21771688, validated: true }] }),
    tx: () => FILL,
  };
  const seen = [];
  const events = [];
  let t = 0;
  const ctx = {
    ledger: { wallets: { issuer: { address: 'rISSUER' }, maker: { address: 'rMAKER' }, taker: { address: 'rTAKER' } }, client: { request: async (p) => { seen.push(p.command); return { result: responses[p.command](p) }; } } },
    store: { launches: [{ ...d.launch, status: 'live', steps: [{ key: 'fill', hash: 'FILLHASH', ledger: 21771688 }] }], byCode(c) { return this.launches.find((l) => l.code === c); } },
    bus: { publish: (type, mode, p) => events.push({ type, mode, ...p }) },
  };
  const s = new Sentinel(ctx, { now: () => t });
  const r1 = await s.report('bbl');
  assert.equal(r1.cached, false);
  assert.equal(r1.trades.length, 1);
  assert.equal(r1.trades[0].controlled, true);
  const n = seen.length;
  const r2 = await s.report('BBL');
  assert.equal(r2.cached, true);
  assert.equal(seen.length, n);
  t = 31_000;
  await s.report('BBL');
  assert.ok(seen.length > n);
  assert.ok(!seen.includes('tx') || seen.filter((c) => c === 'tx').length === 1); // validated tx cached permanently
  assert.ok(seen.every((c) => ['account_info', 'account_objects', 'account_lines', 'gateway_balances', 'book_offers', 'account_tx', 'tx'].includes(c)));
  assert.ok(events.length > 0);
  assert.ok(events.every((ev) => ev.type === 'sentinel.finding' && ev.mode === 'LIVE_TESTNET' && ['medium', 'high'].includes(ev.severity)));
  assert.equal(new Set(events.map((ev) => ev.findingId)).size, events.length); // no duplicates across scans
  assert.equal(await s.report('XYZ'), null);
});

test('exercise and Guardian demo', () => {
  assert.ok(EXERCISE.length >= 5 && EXERCISE.length <= 6);
  for (const s of EXERCISE) { assert.equal(s.choices.filter((c) => c.ok).length, 1); assert.ok(s.catches && s.limits && s.config); }
  const g = guardianDemo();
  assert.ok(g.some((x) => x.verdict.allowed) && g.some((x) => !x.verdict.allowed));
  assert.equal(g.find((x) => /claws back/.test(x.label)).verdict.allowed, false);
  assert.equal(g.find((x) => /5 XRP bid/.test(x.label)).verdict.allowed, true);
});
