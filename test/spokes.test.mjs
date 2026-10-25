// Spokes data layer tests. No network: every Mainnet / provider / Testnet interaction uses fixtures or fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseRanking, ProviderError } from '../lib/spokes/provider.mjs';
import { spokeId, parseSpokeId, ledgerCurrency, displayTicker, currencyFields, tickerCollisions } from '../lib/spokes/identity.mjs';
import { SpokesMainnetReader, SPOKES_READ_COMMANDS } from '../lib/spokes/mainnet-read.mjs';
import { parseAsks, parseBids, bookSummary, ammDepth, parseAmm, issuerProfile, LSF } from '../lib/spokes/market.mjs';
import { providerChecks, ledgerChecks, isEligible, nameIntegrity } from '../lib/spokes/eligibility.mjs';
import { analyzePayment, inferXrpBridge, consumedLiquidity, testnetFlowsFromRuns, flowStats } from '../lib/spokes/flows.mjs';
import { buildMainnetSpoke, buildTestnetSpoke, assembleResponse, spokeKeyMap, fillGroup } from '../lib/spokes/build.mjs';
import { recordReplay, buildReplay } from '../lib/spokes/replay.mjs';
import { SpokesService, discover } from '../lib/spokes/service.mjs';

// ---------- fixtures ----------
const ISS = {
  rlusd: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
  gatehub: 'rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq',
  fakeUsd: 'rfFnxUxKuMyWReSAs6TeuofMhjbCAPweyi',
  foo: 'rFooissuerAAAAAAAAAAAAAAAAAAAAAAA',
  bar: 'rBarissuerBBBBBBBBBBBBBBBBBBBBBBB',
  testnet: 'rLXCWBHdR489cqwtcwai6QHEdFSkhFoFGP',
};
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-24T03:00:00Z');
const tok = (o) => ({ tokenType: 'trustline', vol24hxrp: 1000, vol24htx: 500, uniqueTraders24h: 100, dateon: NOW - 800 * DAY, exch: '0.5', usd: '1.2', verified: false, kyc: false, ...o });
const RANKING = {
  success: true, attribution: 'Required: ...', total: 999, sortBy: 'vol24hxrp',
  tokens: [
    tok({ currency: '524C555344000000000000000000000000000000', issuer: ISS.rlusd, name: 'RLUSD', verified: 1, kyc: true, vol24hxrp: 3_900_000 }),
    tok({ currency: 'USD', issuer: ISS.gatehub, name: 'USD', verified: 1, kyc: true }),
    tok({ currency: 'USD', issuer: ISS.fakeUsd, name: 'USD', vol24htx: 4149, uniqueTraders24h: 37 }),
    tok({ currency: ledgerCurrency('XRPX'), issuer: ISS.foo, name: 'XRPX', dateon: NOW - 4 * DAY }),
    tok({ currency: '464F4F0000000000000000000000000000000000', issuer: ISS.foo, name: 'FOO', dateon: NOW - 30 * DAY }),
    tok({ currency: '03ABCDEF00000000000000000000000000000000', issuer: ISS.bar, name: 'LP', tokenType: 'lp' }),
    { issuer: 'XRPL', currency: 'XRP', name: 'XRP' },
  ],
};

function fakeTransport(networkId = 0, handlers = {}) {
  const calls = [];
  return {
    calls,
    make: () => ({
      async request(req) {
        calls.push(req.command);
        if (req.command === 'server_info') return { result: { info: { network_id: networkId, validated_ledger: { seq: 100 } } } };
        if (handlers[req.command]) return handlers[req.command](req);
        return { result: {} };
      },
      async disconnect() {},
    }),
  };
}

// Offers: asks sell token for XRP (TakerGets token, TakerPays drops); bids buy token with XRP.
const ask = (acct, tokQty, xrp, extra = {}) => ({ Account: acct, TakerGets: { currency: 'FOO', issuer: ISS.foo, value: String(tokQty) }, TakerPays: String(Math.round(xrp * 1e6)), ...extra });
const bid = (acct, tokQty, xrp, extra = {}) => ({ Account: acct, TakerGets: String(Math.round(xrp * 1e6)), TakerPays: { currency: 'FOO', issuer: ISS.foo, value: String(tokQty) }, ...extra });

// ---------- ranking + identity ----------
test('ranking parse: ranks, hex currencies, xrpUsd, skips native XRP row', () => {
  const r = parseRanking(RANKING, { fetchedAt: '2026-10-24T03:00:00.000Z' });
  assert.equal(r.assets.length, 6);
  assert.equal(r.total, 999);
  const rl = r.assets[0];
  assert.equal(rl.rank, 1);
  assert.equal(rl.currency, 'RLUSD');
  assert.equal(rl.currencyHex, '524C555344000000000000000000000000000000');
  assert.equal(rl.id, `mainnet:524C555344000000000000000000000000000000:${ISS.rlusd}`);
  assert.equal(rl.vol24hXrp, 3_900_000);
  assert.equal(rl.verified, true);
  assert.ok(Math.abs(rl.xrpUsd - 2.4) < 1e-9);
  assert.equal(rl.rankedAt, '2026-10-24T03:00:00.000Z');
  assert.throws(() => parseRanking({ success: false }), ProviderError);
});

test('identity is (network, currency, issuer): hex currency and ticker collisions', () => {
  assert.equal(ledgerCurrency('FUZZY'), '46555A5A59000000000000000000000000000000');
  assert.equal(displayTicker('46555A5A59000000000000000000000000000000'), 'FUZZY');
  assert.deepEqual(currencyFields('USD'), { currency: 'USD', currencyHex: null });
  assert.equal(displayTicker('03ABCDEF00000000000000000000000000000000').startsWith('LP:'), true);
  // Same ticker, different issuer -> different ids
  const a = spokeId('mainnet', 'USD', ISS.gatehub), b = spokeId('mainnet', 'USD', ISS.fakeUsd);
  assert.notEqual(a, b);
  // Same currency+issuer, different network -> different ids
  assert.notEqual(spokeId('mainnet', 'BBL', ISS.testnet), spokeId('testnet', 'BBL', ISS.testnet));
  // hex "USD" padded is a different on-ledger currency than standard "USD"
  assert.notEqual(spokeId('mainnet', '5553440000000000000000000000000000000000', ISS.fakeUsd), b);
  assert.deepEqual(parseSpokeId(a), { network: 'mainnet', currency: 'USD', issuer: ISS.gatehub });
  assert.equal(parseSpokeId('USD'), null);
  assert.throws(() => spokeId('devnet', 'USD', ISS.gatehub));
  const r = parseRanking(RANKING);
  const col = tickerCollisions(r.assets);
  assert.equal(col.get('USD').length, 2);
  assert.ok(!col.has('RLUSD'));
});

// ---------- eligibility ----------
test('eligibility: impersonation, wash activity, LP type, collisions flagged', () => {
  const r = parseRanking(RANKING);
  const col = tickerCollisions(r.assets);
  const by = Object.fromEntries(r.assets.map((a) => [`${a.name}:${a.issuer}`, a]));
  const ids = (cs) => cs.filter((c) => c.blocking && !c.ok).map((c) => c.id);
  assert.deepEqual(ids(providerChecks(by[`RLUSD:${ISS.rlusd}`], { collisions: col, now: NOW })), []);
  assert.deepEqual(ids(providerChecks(by[`USD:${ISS.gatehub}`], { collisions: col, now: NOW })), []);
  const fake = providerChecks(by[`USD:${ISS.fakeUsd}`], { collisions: col, now: NOW });
  assert.ok(ids(fake).includes('name_integrity'));
  assert.ok(ids(fake).includes('activity_quality')); // 4149 trades / 37 traders
  assert.ok(fake.some((c) => c.id === 'ticker_collision' && !c.ok && !c.blocking));
  assert.ok(ids(providerChecks(by[`XRPX:${ISS.foo}`], { now: NOW })).includes('name_integrity'));
  assert.ok(ids(providerChecks(by[`LP:${ISS.bar}`], { now: NOW })).includes('token_type'));
  assert.equal(nameIntegrity({ name: 'XRP', currency: 'XRP', issuer: ISS.foo, verified: true }).ok, false);
  assert.equal(nameIntegrity({ name: 'mXRP', currency: 'mXRP', issuer: ISS.foo, verified: true }).ok, true);
  // scam list blocks
  assert.ok(ids(providerChecks(by[`FOO:${ISS.foo}`], { scamSet: new Set([ISS.foo]), now: NOW })).includes('scam_blocklist'));
});

test('eligibility: issuer freeze / auth / transfer fee / liquidity are blocking', () => {
  const deep = bookSummary(parseAsks([ask('rA', 10_000, 5_000)]), parseBids([bid('rB', 10_000, 4_990)]));
  const ok = issuerProfile({ account_data: { Flags: LSF.DefaultRipple } });
  assert.ok(isEligible(ledgerChecks(ok, deep, 'A')));
  const frozen = issuerProfile({ account_data: { Flags: LSF.DefaultRipple | LSF.GlobalFreeze } });
  assert.ok(!isEligible(ledgerChecks(frozen, deep, 'A')));
  const auth = issuerProfile({ account_data: { Flags: LSF.DefaultRipple | LSF.RequireAuth } });
  assert.ok(!isEligible(ledgerChecks(auth, deep, 'A')));
  const fee = issuerProfile({ account_data: { Flags: LSF.DefaultRipple, TransferRate: 1_050_000_000 } });
  assert.equal(fee.transferFeePct, 5);
  assert.ok(!isEligible(ledgerChecks(fee, deep, 'A')));
  assert.ok(!isEligible(ledgerChecks({ exists: false }, deep, 'A')));
  const bh = issuerProfile({ account_data: { Flags: LSF.DefaultRipple | LSF.DisableMaster, RegularKey: 'rrrrrrrrrrrrrrrrrrrrBZbvji' }, signer_lists: [] });
  assert.equal(bh.blackholed, true);
  assert.equal(issuerProfile({ account_data: { Flags: LSF.DisableMaster }, signer_lists: [{}] }).blackholed, false);
});

// ---------- Mainnet wrapper isolation ----------
test('Mainnet wrapper: refuses submit/sign and non-allowlisted commands, no submit method', async () => {
  const ft = fakeTransport(0);
  const r = new SpokesMainnetReader({ makeTransport: ft.make, minGapMs: 0 });
  assert.equal(typeof r.submit, 'undefined');
  for (const cmd of ['submit', 'sign', 'sign_for', 'submit_multisigned', 'wallet_propose', 'ripple_path_find', 'path_find', 'subscribe', 'channel_authorize']) {
    await assert.rejects(r.request({ command: cmd }), (e) => e.code === 'COMMAND');
  }
  await assert.rejects(r.request({ command: 'account_info', account: ISS.foo, secret: 'x' }), (e) => e.code === 'COMMAND');
  assert.deepEqual(ft.calls, []); // nothing reached the transport
  await r.request({ command: 'account_info', account: ISS.foo });
  assert.deepEqual(ft.calls, ['server_info', 'account_info']); // network verified first
  assert.deepEqual([...SPOKES_READ_COMMANDS].sort(), ['account_info', 'account_lines', 'account_tx', 'amm_info', 'book_offers', 'gateway_balances', 'ledger', 'server_info', 'tx']);
  assert.throws(() => new SpokesMainnetReader({ nodes: ['wss://s.altnet.rippletest.net:51233'] }), /not an allowlisted/);
});

test('Mainnet wrapper: refuses network_id != 0 (e.g. Testnet = 1)', async () => {
  const ft = fakeTransport(1);
  const r = new SpokesMainnetReader({ makeTransport: ft.make, minGapMs: 0 });
  await assert.rejects(r.request({ command: 'ledger', ledger_index: 'validated' }), (e) => e.code === 'NETWORK');
  assert.deepEqual(ft.calls, ['server_info']);
  const ft2 = fakeTransport(null); // network_id missing/unknown -> refuse
  await assert.rejects(new SpokesMainnetReader({ makeTransport: ft2.make, minGapMs: 0 }).request({ command: 'tx', transaction: 'AB' }), (e) => e.code === 'NETWORK');
});

// ---------- depth bands ----------
test('funded depth band math, expired/unfunded offers skipped, AMM depth added', () => {
  const asks = parseAsks([
    ask('rA', 100, 101),                      // 1.01
    ask('rB', 100, 103, { taker_gets_funded: { currency: 'FOO', issuer: ISS.foo, value: '50' }, taker_pays_funded: '51500000' }), // 1.03, half funded
    ask('rC', 100, 110),                      // 1.10
    ask('rX', 100, 50, { Expiration: 1 }),    // expired: ignored
    ask('rU', 100, 102, { taker_gets_funded: { currency: 'FOO', issuer: ISS.foo, value: '0' } }), // unfunded
  ], NOW / 1000);
  const bids = parseBids([bid('rD', 100, 99), bid('rE', 100, 98.5), bid('rF', 100, 90)], NOW / 1000);
  assert.equal(asks.length, 3);
  const s = bookSummary(asks, bids);
  assert.equal(s.ask, 1.01); assert.equal(s.bid, 0.99); assert.equal(s.mid, 1);
  assert.equal(s.spreadBps, 200);
  const d = (side, band) => s.depthXrp[side].find((x) => x.band === band).xrp;
  assert.equal(d('asks', '0.5%'), 0);
  assert.equal(d('asks', '1%'), 101);     // boundary inclusive: 1.01 <= mid * 1.01
  assert.equal(d('asks', '2%'), 101);
  assert.equal(d('asks', '5%'), 101 + 51.5);
  assert.equal(d('bids', '1%'), 99);
  assert.equal(d('bids', '2%'), 99 + 98.5);
  assert.equal(d('bids', '5%'), 99 + 98.5);
  const amm = parseAmm({ amm: { amount: '1000000000', amount2: { currency: 'FOO', issuer: ISS.foo, value: '1000' }, account: 'rAMM', trading_fee: 500 } });
  assert.equal(amm.present, true); assert.equal(amm.xrp, 1000); assert.equal(amm.priceXrp, 1); assert.equal(amm.tradingFeeBps, 50);
  const dep = ammDepth(1000, 0.02);
  assert.ok(Math.abs(dep.ask - 1000 * (Math.sqrt(1.02) - 1)) < 1e-9);
  const s2 = bookSummary(asks, bids, amm);
  assert.ok(Math.abs(s2.depthXrp.asks[2].xrp - (101 + dep.ask)) < 1e-5);
  assert.equal(parseAmm({}).present, false);
});

test('missing liquidity: empty/one-sided books give null spread, zero depth, failed liquidity check', () => {
  const empty = bookSummary([], []);
  assert.equal(empty.spreadBps, null); assert.equal(empty.bid, null); assert.equal(empty.refPrice, null);
  assert.ok(empty.depthXrp.asks.every((x) => x.xrp === 0));
  const one = bookSummary(parseAsks([ask('rA', 100, 100)]), []);
  assert.equal(one.spreadBps, null); assert.equal(one.refBasis, 'best_ask');
  const a = parseRanking(RANKING).assets[4];
  const sp = buildMainnetSpoke(a, 'B', { ok: true, issuer: issuerProfile({ account_data: { Flags: LSF.DefaultRipple } }), asks: [], bids: [], amm: { present: false, xrp: 0, token: 0 }, at: 'x' }, { now: NOW });
  assert.equal(sp.eligibility.eligible, false);
  assert.ok(sp.eligibility.checks.some((c) => c.id === 'two_sided_liquidity' && !c.ok));
  assert.ok(sp.alerts.some((x) => /empty/.test(x.text)));
  const un = buildMainnetSpoke(a, 'B', { ok: false, error: 'timeout' }, { now: NOW });
  assert.equal(un.status, 'UNAVAILABLE'); assert.equal(un.eligibility.eligible, false);
  // crossed book: the smaller crossed set is treated as uncrossable and excluded
  const x = bookSummary(parseAsks([ask('rA', 100, 101), ask('rA2', 1000, 1020)]), parseBids([bid('rB', 1, 4.7), bid('rC', 100, 99)]));
  assert.equal(x.uncrossableDropped, 1); assert.equal(x.bid, 0.99); assert.equal(x.spreadBps, 200); assert.equal(x.crossed, false);
});

// ---------- flows ----------
const FOO_HEX = ledgerCurrency('FOO');
const offerNode = (kind, acct, getsPrev, getsFinal, paysPrev, paysFinal) => ({ [kind]: { LedgerEntryType: 'Offer', FinalFields: { Account: acct, TakerGets: getsFinal, TakerPays: paysFinal }, PreviousFields: { TakerGets: getsPrev, TakerPays: paysPrev } } });
const iou = (c, i, v) => ({ currency: c, issuer: i, value: String(v) });
const SRC = 'rSourceAAAAAAAAAAAAAAAAAAAAAAAAAA', DST = 'rDestBBBBBBBBBBBBBBBBBBBBBBBBBBBB', M1 = 'rMakerOneCCCCCCCCCCCCCCCCCCCCCCC', M2 = 'rMakerTwoDDDDDDDDDDDDDDDDDDDDDDD', AMM = 'rAmmPoolEEEEEEEEEEEEEEEEEEEEEEEE';
const bridgedEntry = {
  hash: 'H1', ledger_index: 500, close_time_iso: '2026-10-24T03:00:00Z',
  tx_json: { TransactionType: 'Payment', Account: SRC, Destination: DST, DeliverMax: iou('BAR', ISS.bar, 5), SendMax: iou('FOO', ISS.foo, 11), Fee: '12', Flags: 0x00020000 },
  meta: {
    TransactionResult: 'tesSUCCESS', delivered_amount: iou('BAR', ISS.bar, 4.5),
    AffectedNodes: [
      offerNode('DeletedNode', M1, '5000000', '0', iou('FOO', ISS.foo, 10), iou('FOO', ISS.foo, 0)),       // M1 buys FOO with XRP
      offerNode('ModifiedNode', M2, iou('BAR', ISS.bar, 10), iou('BAR', ISS.bar, 5.5), '10000000', '5000000'), // M2 sells BAR for XRP
      { ModifiedNode: { LedgerEntryType: 'RippleState', FinalFields: { Balance: iou('FOO', 'rrrrrrrrrrrrrrrrrrrrBZbvji', 90), LowLimit: iou('FOO', SRC, 1000), HighLimit: iou('FOO', ISS.foo, 0) }, PreviousFields: { Balance: iou('FOO', 'rrrrrrrrrrrrrrrrrrrrBZbvji', 100) } } },
      { ModifiedNode: { LedgerEntryType: 'Offer', FinalFields: { Account: 'rUnfundedRemoved', TakerGets: '1', TakerPays: iou('FOO', ISS.foo, 1) }, PreviousFields: {} } },
    ],
  },
};

test('XRP-bridge inference from metadata: X/XRP + XRP/Y consumed => viaXrp true', () => {
  const keys = new Map([[`${FOO_HEX}.${ISS.foo}`, 'mainnet:FOO'], [`BAR.${ISS.bar}`, 'mainnet:BAR']]);
  const f = analyzePayment(bridgedEntry, keys);
  assert.equal(f.kind, 'MAINNET_OBSERVED');
  assert.equal(f.viaXrp, true);
  assert.equal(f.partial, true);
  assert.equal(f.offersConsumed, 2); // the PreviousFields-less node is not a consumption
  assert.deepEqual(f.spokeIds.sort(), ['mainnet:BAR', 'mainnet:FOO']);
  assert.equal(f.delivered.value, 4.5);
  assert.equal(f.rate, 0.45); // 4.5 BAR delivered for 10 FOO spent
  assert.equal(f.explorer, 'https://livenet.xrpl.org/transactions/H1');
  assert.equal(f.ledger, 500);
  // direct X/Y book -> false; XRP on one side -> null (hub leg); unrelated payment -> null result
  const direct = { offers: [{ account: M1, gets: `${FOO_HEX}.${ISS.foo}`, pays: `BAR.${ISS.bar}` }], pools: [] };
  assert.equal(inferXrpBridge(`BAR.${ISS.bar}`, `${FOO_HEX}.${ISS.foo}`, direct), false);
  assert.equal(inferXrpBridge('XRP', `${FOO_HEX}.${ISS.foo}`, direct), null);
  assert.equal(analyzePayment(bridgedEntry, new Map()), null);
  assert.equal(analyzePayment({ ...bridgedEntry, meta: { ...bridgedEntry.meta, TransactionResult: 'tecPATH_DRY' } }, keys), null);
});

test('offer-owner attribution: AMM pools, Mainnet owners are other; Testnet maker=titan, rival=rival', () => {
  const ammEntry = {
    hash: 'H2', ledger_index: 501,
    tx_json: { TransactionType: 'Payment', Account: SRC, Destination: DST, Amount: iou('FOO', ISS.foo, 10), SendMax: '20000000', Fee: '10', Flags: 0 },
    meta: {
      TransactionResult: 'tesSUCCESS', delivered_amount: iou('FOO', ISS.foo, 10),
      AffectedNodes: [
        { ModifiedNode: { LedgerEntryType: 'AccountRoot', FinalFields: { Account: AMM, AMMID: 'X', Balance: '1010000000' }, PreviousFields: { Balance: '1000000000' } } },
        { ModifiedNode: { LedgerEntryType: 'RippleState', FinalFields: { Balance: iou('FOO', 'rrrrrrrrrrrrrrrrrrrrBZbvji', 990), LowLimit: iou('FOO', AMM, 0), HighLimit: iou('FOO', ISS.foo, 0) }, PreviousFields: { Balance: iou('FOO', 'rrrrrrrrrrrrrrrrrrrrBZbvji', 1000) } } },
        { ModifiedNode: { LedgerEntryType: 'AccountRoot', FinalFields: { Account: SRC, Balance: '89999990' }, PreviousFields: { Balance: '100000000' } } },
        offerNode('ModifiedNode', M1, iou('FOO', ISS.foo, 5), iou('FOO', ISS.foo, 4), '5000000', '4000000'),
      ],
    },
  };
  const f = analyzePayment(ammEntry, new Map([['FOO.' + ISS.foo, 'mainnet:FOO']]));
  assert.equal(f.amm, true);
  assert.equal(f.viaXrp, null); // XRP -> FOO is a hub leg
  assert.deepEqual(f.offerOwners.map((o) => o.role).sort(), ['amm', 'other']);
  assert.ok(!f.offerOwners.some((o) => o.role === 'titan'));
  assert.equal(f.rate, 1); // 10 FOO for 10 XRP (fee excluded)
  const liq = consumedLiquidity(ammEntry.meta);
  assert.deepEqual(liq.pools[0].assets.sort(), [`FOO.${ISS.foo}`, 'XRP'].sort());

  const runs = { runs: [{ id: 'run1', options: { strategy: 'tight' }, payments: [
    { status: 'success', hash: 'T1', ledger: 10, at: '2026-10-24T00:01:00Z', from: 'BBL', to: 'LDN', explorer: 'https://testnet.xrpl.org/transactions/T1',
      attribution: { bridged: true, deliveredXrp: 1, spentXrp: 1, capturedBy: { maker: 3, rival: 1, other: 0 }, winner: 'maker',
        fills: [{ owner: 'rMaker', bucket: 'maker', code: 'BBL', side: 'bid', tokenQty: 100 }, { owner: 'rRival', bucket: 'rival', code: 'LDN', side: 'ask', tokenQty: 98 }] } },
    { status: 'skipped', from: 'XRP', to: 'BBL' },
    { status: 'success', hash: 'T2', ledger: 11, at: '2026-10-24T00:02:00Z', from: 'LDN', to: 'XRP', attribution: { bridged: false, deliveredXrp: 0.5, capturedBy: { maker: 0.5, rival: 0, other: 0 }, fills: [{ owner: 'rMaker', bucket: 'maker', code: 'LDN', side: 'bid', tokenQty: 55 }] } },
  ] }] };
  const ts = new Map([['BBL', { id: `testnet:BBL:${ISS.testnet}`, issuer: ISS.testnet }], ['LDN', { id: `testnet:LDN:${ISS.testnet}`, issuer: ISS.testnet }]]);
  const tf = testnetFlowsFromRuns(runs, ts);
  assert.equal(tf.length, 2);
  assert.equal(tf[0].hash, 'T2'); // newest first
  assert.equal(tf[0].kind, 'LIVE_TESTNET'); assert.equal(tf[0].network, 'testnet'); assert.equal(tf[0].viaXrp, null);
  const t1 = tf[1];
  assert.equal(t1.viaXrp, true);
  assert.deepEqual(t1.offerOwners, [{ account: 'rMaker', role: 'titan' }, { account: 'rRival', role: 'rival' }]);
  assert.equal(t1.rate, 0.98);
  const st = flowStats(`testnet:BBL:${ISS.testnet}`, [], tf);
  assert.equal(st.liveTestnet, 1); assert.equal(st.titanShare, 0.75); assert.equal(st.rivalShare, 0.25); assert.equal(st.mainnetObserved, 0);
  const st2 = flowStats('mainnet:FOO', [f], tf);
  assert.equal(st2.titanShare, null); assert.equal(st2.mainnetObserved, 1);
});

// ---------- grouping + isolation ----------
const launch = (code) => ({ id: code, code, name: code, status: 'live', issuer: ISS.testnet, createdAt: '2026-10-23T22:51:51Z', steps: [{ key: 'issue', status: 'done', result: 'tesSUCCESS' }], book: { asks: [], bids: [] } });

test('13 + 13 grouping always yields 26 (placeholders clearly labeled), counts add up', () => {
  const none = assembleResponse(null);
  assert.equal(none.groups.A.spokes.length, 13); assert.equal(none.groups.B.spokes.length, 13);
  assert.equal(none.snapshot.freshness, 'unavailable');
  assert.equal(none.counts.UNAVAILABLE, 26); assert.equal(none.counts.displayed, 0);
  assert.ok(none.groups.A.spokes.every((s) => s.placeholder && /placeholder/i.test(s.name) && s.status === 'UNAVAILABLE'));
  const assets = parseRanking(RANKING).assets;
  const good = { ok: true, issuer: issuerProfile({ account_data: { Flags: LSF.DefaultRipple } }), asks: parseAsks([ask('rA', 10_000, 10_100)]), bids: parseBids([bid('rB', 10_000, 9_950)]), amm: null, at: 'now' };
  const snap = {
    fetchedAt: new Date(NOW).toISOString(), xrpUsd: 2.4,
    groups: { A: [buildMainnetSpoke(assets[0], 'A', good, { now: NOW })], B: [buildTestnetSpoke(launch('BBL'), null), buildTestnetSpoke(launch('LDN'), null), buildMainnetSpoke(assets[4], 'B', good, { now: NOW })] },
    mainnetFlows: [], coverage: { mainnetLedgersScanned: 3, mainnetPaymentsMatched: 0, from: 1, to: 3 },
  };
  const r = assembleResponse(snap, { now: NOW + 1000, lastRefreshOk: true });
  assert.equal(r.groups.A.spokes.length + r.groups.B.spokes.length, 26);
  assert.equal(r.groups.B.spokes[0].status, 'TESTNET_FUNDED');
  assert.equal(r.counts.TESTNET_FUNDED, 2);
  assert.equal(r.counts.displayed, 4);
  assert.equal(r.counts.MAINNET_OBSERVED + r.counts.TESTNET_FUNDED + r.counts.UNAVAILABLE + r.counts.TESTNET_CANDIDATE + r.counts.SIMULATION + r.counts.REPLAY, 26);
  assert.equal(r.snapshot.freshness, 'live');
  assert.equal(r.snapshot.attribution, 'Rankings: XRPL.to');
  assert.deepEqual(r.hub, { currency: 'XRP' });
  for (const s of [...r.groups.A.spokes, ...r.groups.B.spokes]) {
    assert.equal(s.corridor.mode, 'SIMULATION'); assert.ok(s.corridor.engineLabel); assert.equal(s.corridor.autoAllocate, false);
    assert.ok(['DISCOVERY', 'BOOTSTRAP', 'REINFORCED', 'MATURE', 'OPTIMIZED', 'STANDBY'].includes(s.corridor.stage));
  }
  // ineligible / placeholder spokes get no modeled notional; eligible ones are not all equal by construction
  assert.ok([...r.groups.A.spokes, ...r.groups.B.spokes].filter((s) => !s.eligibility.eligible).every((s) => s.corridor.modeledNotionalUsd === 0));
  assert.equal(fillGroup('A', [], [], 13).length, 13);
});

test('Testnet/Mainnet isolation: testnet spokes never enter Mainnet matching or figures', () => {
  const tn = buildTestnetSpoke(launch('BBL'), { ok: true, asks: parseAsks([ask('rM', 100, 1)]), bids: [], at: 't' }, { roles: { titan: new Set(['rM']) } });
  assert.equal(tn.network, 'testnet'); assert.equal(tn.market.mode, 'LIVE_TESTNET'); assert.equal(tn.market.vol24hXrp, null);
  assert.equal(tn.testnet.book.asks[0].role, 'titan');
  assert.ok(tn.id.startsWith('testnet:'));
  const mn = buildMainnetSpoke(parseRanking(RANKING).assets[0], 'A', null, { now: NOW });
  assert.equal(mn.market.mode, 'MAINNET_OBSERVED');
  const keys = spokeKeyMap([tn, mn]);
  assert.equal(keys.size, 1);
  assert.ok([...keys.values()].every((id) => id.startsWith('mainnet:')));
});

// ---------- replay ----------
test('replay is deterministic (fixed seed, recorded real hashes)', () => {
  const flows = [{ hash: 'A1', at: '2026-10-24T03:00:02Z', kind: 'MAINNET_OBSERVED', network: 'mainnet', spokeIds: ['x'] }, { hash: 'A0', at: '2026-10-24T03:00:01Z', kind: 'MAINNET_OBSERVED', network: 'mainnet', spokeIds: ['x'] }];
  const rec = recordReplay({ mainnetFlows: flows, testnetFlows: [{ hash: 'T1', at: '2026-10-24T00:00:00Z', kind: 'LIVE_TESTNET', network: 'testnet', spokeIds: ['y'] }], recordedAt: 'fixed' });
  const a = buildReplay(rec), b = buildReplay(JSON.parse(JSON.stringify(rec)));
  assert.deepEqual(a, b);
  assert.equal(a.mode, 'REPLAY');
  assert.ok(a.frames.every((f) => f.kind === 'REPLAY'));
  assert.deepEqual(a.frames.map((f) => f.hash), ['T1', 'A0', 'A1']);
  assert.equal(a.frames[1].originalKind, 'MAINNET_OBSERVED');
  assert.ok(a.frames.every((f, i) => i === 0 || f.tMs > a.frames[i - 1].tMs));
});

// ---------- cached fallback ----------
test('cached snapshot fallback: provider down -> serve cache as cached with age; no cache -> unavailable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spokes-'));
  const file = path.join(dir, 'snap.json');
  const down = { ranking: async () => { throw new ProviderError('xrpl.to unreachable: fixture'); }, scams: async () => null, reader: { request: async () => { throw new Error('should not be called'); }, disconnect: async () => {} }, testnetRequest: null };
  const quiet = () => {};
  const empty = new SpokesService({ file, env: { TF_SPOKES_AUTO: '0' }, deps: down, log: quiet });
  assert.equal(await empty.refresh(), null);
  const r0 = empty.response();
  assert.equal(r0.snapshot.freshness, 'unavailable');
  assert.match(r0.snapshot.lastError, /unreachable/);
  assert.equal(r0.groups.A.spokes.length + r0.groups.B.spokes.length, 26);

  const fetchedAt = new Date(Date.now() - 3600_000).toISOString();
  fs.writeFileSync(file, JSON.stringify({ fetchedAt, groups: { A: [], B: [] }, mainnetFlows: [], coverage: { mainnetLedgersScanned: 7 }, replay: recordReplay({ mainnetFlows: [{ hash: 'Z', at: 'a', spokeIds: [] }], recordedAt: 'r' }) }));
  const svc = new SpokesService({ file, env: { TF_SPOKES_AUTO: '0' }, deps: down, log: quiet });
  assert.equal(await svc.refresh(), null);
  const r = svc.response();
  assert.equal(r.snapshot.freshness, 'cached');
  assert.ok(r.snapshot.ageSec >= 3599);
  assert.equal(r.coverage.mainnetLedgersScanned, 7);
  assert.deepEqual(svc.replay(), svc.replay());
  assert.equal(svc.replay().frames[0].hash, 'Z');
  // manual refresh is rate-limited
  assert.equal(svc.requestRefresh().httpStatus, 429);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('discover with fakes: 13 + 13 selection, Testnet BBL/LDN funded, unreachable Mainnet aborts', async () => {
  const assets = Array.from({ length: 30 }, (_, i) => tok({ currency: ledgerCurrency(`TK${String.fromCharCode(65 + (i % 26))}${i}`), issuer: `rXssuer${String(i).padStart(2, '0').replace(/0/g, 'z')}AAAAAAAAAAAAAAAAAAAA`, name: `TK${i}`, dateon: NOW - (i % 2 ? 30 : 800) * DAY, vol24hxrp: 10_000 - i }));
  const handlers = {
    account_info: () => ({ result: { account_data: { Flags: LSF.DefaultRipple } } }),
    book_offers: (req) => ({ result: { offers: req.taker_pays.currency === 'XRP' ? [{ Account: 'rM', TakerGets: { ...req.taker_gets, value: '100000' }, TakerPays: '100500000000' }] : [{ Account: 'rM', TakerGets: '99500000000', TakerPays: { ...req.taker_pays, value: '100000' } }] } }),
    amm_info: () => { const e = new Error('actNotFound'); e.data = { error: 'actNotFound' }; throw e; },
    ledger: (req) => ({ result: { validated: true, ledger: { close_time_iso: '2026-10-24T03:00:00Z', transactions: [] } } }),
  };
  const ft = fakeTransport(0, handlers);
  const reader = new SpokesMainnetReader({ makeTransport: ft.make, minGapMs: 0 });
  const snap = await discover({ ranking: async () => parseRanking({ success: true, tokens: assets }), scams: async () => new Set(), reader, testnetRequest: null, launches: [launch('BBL'), launch('LDN')], roles: {}, now: NOW, scan: { ledgers: 3, deadlineMs: 5000 } });
  assert.equal(snap.groups.A.length, 13);
  assert.equal(snap.groups.B.length, 13);
  assert.equal(snap.groups.B.filter((s) => s.status === 'TESTNET_FUNDED').length, 2);
  assert.ok(snap.groups.A.every((s) => s.eligibility.eligible && s.network === 'mainnet'));
  assert.equal(snap.coverage.mainnetLedgersScanned, 3);
  assert.ok(!ft.calls.some((c) => /submit|sign/.test(c)));
  const dead = { request: async () => { throw new Error('websocket closed'); } };
  await assert.rejects(discover({ ranking: async () => parseRanking({ success: true, tokens: assets }), reader: dead, launches: [], now: NOW }), /Mainnet unreachable/);
});
