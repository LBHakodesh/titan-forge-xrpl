// Pathfinder Flow tests: fixture Mainnet ledgers/metadata and a fake Testnet ledger. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPayment, classifyOfferCreate, buildProfile, flowShape, sampleProfile, retryAfterMs, DEFAULT_SHAPE } from '../lib/pathfinder/profile.mjs';
import { consumedOffers, ammTouches, balanceChanges, currencyCode, tokenStr, assetLabel } from '../lib/pathfinder/amounts.mjs';
import { PathfinderRunner, PathfinderError, normalizeOptions, samplePayments, attribute, buildPlan, scorecard, CAPS, STATEMENT } from '../lib/pathfinder/replay.mjs';
import { STRATEGIES, RIVAL_STRATEGIES, buildQuotes } from '../lib/pathfinder/strategies.mjs';
import { guardCheck } from '../lib/guardian.mjs';
import { ownerBucket, evidenceFills, bridgeInference, normalizeBook, depthSummary, depthAfter, routeDepthXrp, pricing, classifyNoPath, buildEvidence, compareRuns } from '../lib/pathfinder/evidence.mjs';
import { buildContinuityPlan, continuityDryRun, walkLevels, predictPhase, phases } from '../lib/pathfinder/continuity.mjs';

// ---------------- Mainnet fixtures ----------------
const USD = { currency: 'USD', issuer: 'rUSDissuer' };
const EUR = { currency: 'EUR', issuer: 'rEURissuer' };
const amt = (c, v) => ({ ...c, value: String(v) });
const offerNode = (kind, owner, seq, prevGets, prevPays, gets, pays) => ({
  [kind]: { LedgerEntryType: 'Offer', FinalFields: { Account: owner, Sequence: seq, TakerGets: gets, TakerPays: pays }, PreviousFields: { TakerGets: prevGets, TakerPays: prevPays } },
});
const acctNode = (account, prev, fin, extra = {}) => ({ ModifiedNode: { LedgerEntryType: 'AccountRoot', FinalFields: { Account: account, Balance: String(fin), ...extra }, PreviousFields: { Balance: String(prev) } } });
const rsNode = (low, high, cur, prev, fin) => ({ ModifiedNode: { LedgerEntryType: 'RippleState', FinalFields: { Balance: { currency: cur, issuer: 'rrrrrrrrrrrrrrrrrrrrBZbvji', value: String(fin) }, LowLimit: { currency: cur, issuer: low, value: '0' }, HighLimit: { currency: cur, issuer: high, value: '1000' } }, PreviousFields: { Balance: { currency: cur, issuer: 'rrrrrrrrrrrrrrrrrrrrBZbvji', value: String(prev) } } } });
const entry = (tx, meta) => ({ hash: tx.hash || 'H' + Math.random().toString(16).slice(2), tx_json: { Fee: '12', Flags: 0, ...tx }, meta: { TransactionResult: 'tesSUCCESS', ...meta } });

// XRP -> USD through one book offer by rMakerA (2 XRP for 1 USD).
const xrpToUsd = entry({ TransactionType: 'Payment', Account: 'rAlice', Destination: 'rBob', SendMax: '2100000', DeliverMax: amt(USD, 1) }, {
  delivered_amount: amt(USD, 1),
  AffectedNodes: [acctNode('rAlice', 10_000_000, 7_999_988), offerNode('ModifiedNode', 'rMakerA', 5, amt(USD, 10), '20000000', amt(USD, 9), '18000000')],
});
// USD -> EUR auto-bridged through XRP: USD/XRP offer by rMakerA, XRP/EUR offer by rMakerB.
const usdToEurBridged = entry({ TransactionType: 'Payment', Account: 'rAlice', Destination: 'rCarol', SendMax: amt(USD, 6), DeliverMax: amt(EUR, 4), Paths: [[{ currency: 'XRP' }, { currency: 'EUR', issuer: 'rEURissuer' }]] }, {
  delivered_amount: amt(EUR, 4),
  AffectedNodes: [
    offerNode('DeletedNode', 'rMakerA', 7, '10000000', amt(USD, 5), '0', amt(USD, 0)), // A gave 10 XRP, received 5 USD
    offerNode('ModifiedNode', 'rMakerB', 8, amt(EUR, 10), '25000000', amt(EUR, 6), '15000000'), // B gave 4 EUR, received 10 XRP
  ],
});
const partial = entry({ TransactionType: 'Payment', Account: 'rSpam', Destination: 'rVictim', Flags: 0x00020000, SendMax: '1000000', DeliverMax: amt(USD, 1000) }, {
  delivered_amount: amt(USD, 0.0001),
  AffectedNodes: [offerNode('ModifiedNode', 'rMakerA', 5, amt(USD, 9), '18000000', amt(USD, 8.9999), '17999800')],
});
const circular = entry({ TransactionType: 'Payment', Account: 'rArb', Destination: 'rArb', SendMax: '5000000', DeliverMax: '5000100', Paths: [[{ currency: 'USD', issuer: 'rUSDissuer' }]] }, {
  delivered_amount: '5000100',
  AffectedNodes: [offerNode('ModifiedNode', 'rMakerA', 5, amt(USD, 8), '16000000', amt(USD, 5.5), '11000000'), offerNode('ModifiedNode', 'rMakerC', 9, '9000000', amt(USD, 4), '4000000', amt(USD, 1.5))],
});
// XRP -> EUR via an AMM pool account (AMMID) — no Offer nodes.
const viaAmm = entry({ TransactionType: 'Payment', Account: 'rDave', Destination: 'rErin', SendMax: '3000000', DeliverMax: amt(EUR, 1) }, {
  delivered_amount: amt(EUR, 1),
  AffectedNodes: [acctNode('rDave', 50_000_000, 47_500_000), acctNode('rAMMpool', 100_000_000, 102_499_988, { AMMID: 'ABC' }), rsNode('rAMMpool', 'rEURissuer', 'EUR', 500, 499)],
});
const directXrp = entry({ TransactionType: 'Payment', Account: 'rAlice', Destination: 'rBob', DeliverMax: '1000000' }, { delivered_amount: '1000000', AffectedNodes: [] });
const dust = entry({ TransactionType: 'Payment', Account: 'rDust', Destination: 'rDust2', SendMax: '100', DeliverMax: amt(USD, 0.00001) }, {
  delivered_amount: amt(USD, 0.00001), AffectedNodes: [acctNode('rDust', 1000000, 999888), acctNode('rAMMpool', 100_000_000, 100_000_100, { AMMID: 'ABC' })],
});
const crossingOffer = entry({ TransactionType: 'OfferCreate', Account: 'rTaker', TakerGets: '2000000', TakerPays: amt(USD, 1) }, {
  AffectedNodes: [offerNode('ModifiedNode', 'rMakerA', 5, amt(USD, 9), '18000000', amt(USD, 8), '16000000')],
});

test('currency codes and labels decode', () => {
  assert.equal(currencyCode('USD'), 'USD');
  assert.equal(currencyCode('544F544F00000000000000000000000000000000'), 'TOTO');
  assert.equal(assetLabel('XRP'), 'XRP');
  assert.match(assetLabel('USD.rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq'), /^USD\.rhub8…F3wq$/);
  assert.deepEqual([331.6749123, 0.5, 1000, 10].map(tokenStr), ['331.6749123', '0.5', '1000', '10']);
});

test('classifies a direct-book XRP→token payment', () => {
  const c = classifyPayment(xrpToUsd);
  assert.equal(c.pathfound, true);
  assert.equal(c.route, 'xrp_to_token');
  assert.equal(c.bridged, false);
  assert.equal(c.hops, 1);
  assert.equal(c.liquidity, 'book');
  assert.equal(c.partial, false);
  assert.ok(Math.abs(c.xrpEquiv - 2) < 1e-9, 'XRP spent net of fee');
  assert.deepEqual(c.makers.map((m) => m.owner), ['rMakerA']);
});

test('detects XRP auto-bridging for token→token (path step and two XRP legs)', () => {
  const c = classifyPayment(usdToEurBridged);
  assert.equal(c.route, 'token_to_token');
  assert.equal(c.bridged, true);
  assert.equal(c.multiHop, true);
  assert.equal(c.pathCount, 1);
  assert.equal(c.maxPathLen, 2);
  assert.equal(c.xrpEquiv, 10);
  // Same payment without the Paths field: metadata alone (X/XRP + XRP/Y legs) still shows the bridge.
  const noPaths = structuredClone(usdToEurBridged); delete noPaths.tx_json.Paths;
  assert.equal(classifyPayment(noPaths).bridged, true);
});

test('AMM involvement, partial payments, circular and dust are separated', () => {
  const amm = classifyPayment(viaAmm);
  assert.equal(amm.amm, true);
  assert.equal(amm.liquidity, 'amm');
  assert.equal(amm.makers[0].owner, 'rAMMpool');
  assert.ok(ammTouches(viaAmm.meta)[0].assets.includes('EUR.rEURissuer'));
  assert.equal(classifyPayment(partial).partial, true);
  assert.equal(classifyPayment(circular).circular, true);
  assert.equal(classifyPayment(circular).route, 'xrp_to_xrp');
  assert.equal(classifyPayment(directXrp).pathfound, false);
  const p = buildProfile([{ ledger_index: 100, close_time_iso: '2026-10-23T00:00:00Z', transactions: [xrpToUsd, usdToEurBridged, viaAmm, partial, circular, directXrp, dust, crossingOffer] },
    { ledger_index: 101, close_time_iso: '2026-10-23T00:00:04Z', transactions: [] }]);
  assert.equal(p.mode, 'MAINNET_OBSERVED');
  assert.deepEqual([p.window.fromLedger, p.window.toLedger, p.window.seconds], [100, 101, 4]);
  assert.equal(p.totals.pathfound, 6);
  assert.equal(p.totals.endUser, 3);
  assert.equal(p.totals.partial, 1);
  assert.equal(p.totals.circular, 1);
  assert.equal(p.totals.dust, 1);
  assert.equal(p.endUser.routeMix.xrp_to_token, 2);
  assert.equal(p.endUser.routeMix.token_to_token, 1);
  assert.equal(p.endUser.xrpBridged.shareOfTokenToToken, 1);
  assert.equal(p.endUser.ammInvolved.count, 1);
  assert.match(p.partial.note, /fake-volume/);
  assert.deepEqual(p.offerCreate, { total: 1, crossed: 1, bridged: 0, amm: 0 });
  // Maker capture: rMakerA (2 XRP + 10 XRP), rMakerB 10, AMM 2.5 -> top1 = A
  assert.equal(p.endUser.makerCapture.top[0].account, 'rMake…kerA');
  assert.ok(p.endUser.makerCapture.top5Share === 1);
  assert.equal(classifyOfferCreate(crossingOffer).crossed, true);
});

test('flowShape falls back to the labeled default without a sample', () => {
  assert.equal(flowShape(null), DEFAULT_SHAPE);
  assert.match(DEFAULT_SHAPE.source, /default/);
});

test('sampler is rate limited, backs off on tooBusy, and is cancellable', async () => {
  const waits = [];
  let calls = 0;
  const req = async (r) => {
    calls++;
    if (r.ledger_index === 'validated') return { result: { ledger_index: 500 } };
    if (r.ledger_index === 499 && !req.busted) { req.busted = true; throw Object.assign(new Error('busy'), { data: { error: 'tooBusy', error_message: 'rate limit: units quota exhausted, retry in ~1500ms' } }); }
    return { result: { ledger: { ledger_index: r.ledger_index, close_time_iso: '2026-10-23T00:00:00Z', transactions: [xrpToUsd] } } };
  };
  const p = await sampleProfile(req, { n: 3, rps: 3, wait: async (ms) => { waits.push(ms); } });
  assert.equal(p.window.ledgers, 3);
  assert.equal(p.window.backoffs, 1);
  assert.ok(waits.includes(2000), 'waited server-requested retry + margin');
  assert.ok(waits.filter((w) => w === 334).length >= 3, '~3 req/s pacing');
  assert.equal(retryAfterMs({ data: { error: 'slowDown', error_message: '' } }), 10000);
  const ac = new AbortController(); ac.abort();
  await assert.rejects(sampleProfile(req, { n: 3, signal: ac.signal, wait: async () => {} }), /cancelled/);
});

// ---------------- Fake Testnet ledger ----------------
const ADDR = { issuer: 'rISS', maker: 'rMAK', taker: 'rTAK', rival: 'rRIV', router: 'rROU', router2: 'rRO2', router3: 'rRO3' };
const drops = (x) => String(Math.round(x * 1e6));
const tok = (code, v) => ({ currency: code, issuer: ADDR.issuer, value: tokenStr(v) });

class FakeLedger {
  constructor({ xrp = {}, lines = {}, offers = [] } = {}) {
    this.xrp = { issuer: 100, maker: 100, taker: 100, rival: 100, router: 100, router2: 100, router3: 100, ...xrp };
    this.owners = { issuer: 0, maker: 0, taker: 1, rival: 0, router: 0, router2: 0, router3: 0 };
    this.lines = { maker: { BBL: 1e6 }, taker: { BBL: 0 }, rival: {}, router: {}, router2: {}, router3: {}, ...lines };
    this.offers = offers; // { role, seq, code, side, tokenQty, xrp }
    this.seq = 1000;
    this.submitted = [];
    this.hash = 0;
  }
  addresses() { return { ...ADDR }; }
  roleOf(a) { return Object.entries(ADDR).find(([, x]) => x === a)?.[0]; }
  // Walk the book: XRP needed to buy `qty` tokens (asks), or tokens needed to obtain `x` XRP (bids).
  walk(code, side, want, mutate, nodes) {
    const book = this.offers.filter((o) => o.code === code && o.side === side)
      .sort((a, b) => (side === 'ask' ? a.xrp / a.tokenQty - b.xrp / b.tokenQty : b.xrp / b.tokenQty - a.xrp / a.tokenQty) || a.seq - b.seq);
    let left = want, cost = 0;
    for (const o of book) {
      if (left <= 1e-12) break;
      const price = o.xrp / o.tokenQty;
      const takeTok = side === 'ask' ? Math.min(left, o.tokenQty) : Math.min(left / price, o.tokenQty);
      const takeXrp = takeTok * price;
      left -= side === 'ask' ? takeTok : takeXrp;
      cost += side === 'ask' ? takeXrp : takeTok;
      if (mutate) {
        const prev = { ...o };
        o.tokenQty -= takeTok; o.xrp -= takeXrp;
        const gone = o.tokenQty < 1e-9;
        const g = (x) => (side === 'ask' ? tok(code, x.tokenQty) : drops(x.xrp));
        const p = (x) => (side === 'ask' ? drops(x.xrp) : tok(code, x.tokenQty));
        nodes.push({ [gone ? 'DeletedNode' : 'ModifiedNode']: { LedgerEntryType: 'Offer', FinalFields: { Account: ADDR[o.role], Sequence: o.seq, TakerGets: g(o), TakerPays: p(o) }, PreviousFields: { TakerGets: g(prev), TakerPays: p(prev) } } });
        if (side === 'ask') { this.lines[o.role][code] -= takeTok; this.xrp[o.role] += takeXrp; } else { this.lines[o.role][code] += takeTok; this.xrp[o.role] -= takeXrp; }
        if (gone) { this.offers = this.offers.filter((x) => x !== o); this.owners[o.role]--; }
      }
    }
    return left > 1e-9 ? null : cost;
  }
  // Source cost for a payment (and optionally execute it).
  route(from, to, deliver, mutate, nodes) {
    if (from === 'XRP') return this.walk(to, 'ask', Number(deliver.value), mutate, nodes);
    if (to === 'XRP') return this.walk(from, 'bid', Number(deliver) / 1e6, mutate, nodes);
    const x = this.walk(to, 'ask', Number(deliver.value), mutate, nodes);
    return x == null ? null : this.walk(from, 'bid', x, mutate, nodes);
  }
  async request(req) {
    const r = (result) => ({ result });
    switch (req.command) {
      case 'server_info': return r({ info: { network_id: 1, load_factor: 1, validated_ledger: { seq: 77, reserve_base_xrp: 1, reserve_inc_xrp: 0.2, base_fee_xrp: 0.00001 } } });
      case 'account_info': { const role = this.roleOf(req.account); return r({ account_data: { Balance: drops(this.xrp[role]), OwnerCount: this.owners[role] } }); }
      case 'account_lines': { const role = this.roleOf(req.account); return r({ lines: Object.entries(this.lines[role] || {}).map(([currency, b]) => ({ currency, balance: String(b), limit: '1000000000' })) }); }
      case 'book_offers': {
        const isAsk = typeof req.taker_gets === 'object' && req.taker_gets.currency !== 'XRP';
        const code = isAsk ? req.taker_gets.currency : req.taker_pays.currency;
        const list = this.offers.filter((o) => o.code === code && o.side === (isAsk ? 'ask' : 'bid'))
          .sort((a, b) => (isAsk ? a.xrp / a.tokenQty - b.xrp / b.tokenQty : b.xrp / b.tokenQty - a.xrp / a.tokenQty));
        return r({ offers: list.map((o) => ({ Account: ADDR[o.role], Sequence: o.seq, TakerGets: isAsk ? tok(code, o.tokenQty) : drops(o.xrp), TakerPays: isAsk ? drops(o.xrp) : tok(code, o.tokenQty) })) });
      }
      case 'ripple_path_find': {
        const d = req.destination_amount;
        const to = typeof d === 'string' ? 'XRP' : d.currency;
        const sc = req.source_currencies[0];
        const from = sc.currency;
        const payer = this.roleOf(req.source_account) || 'router';
        if (from !== 'XRP' && !(this.lines[payer]?.[from] > 0)) return r({ alternatives: [] });
        const cost = this.route(from, to, d, false);
        if (cost == null) return r({ alternatives: [] });
        const paths = from !== 'XRP' && to !== 'XRP' ? [[{ currency: 'XRP' }, { currency: to, issuer: ADDR.issuer }]] : [];
        return r({ alternatives: [{ source_amount: from === 'XRP' ? drops(cost) : tok(from, cost), paths_computed: paths }] });
      }
      default: throw new Error(`fake: ${req.command}`);
    }
  }
  async submit(role, tx) {
    this.submitted.push({ role, tx });
    const hash = `HASH${++this.hash}`;
    const nodes = [];
    const ok = (meta = {}) => ({ hash, result: 'tesSUCCESS', ledger: 77, explorer: 'x/' + hash, meta: { TransactionResult: 'tesSUCCESS', AffectedNodes: nodes, ...meta } });
    if (tx.TransactionType === 'TrustSet') { this.lines[role] ||= {}; this.lines[role][tx.LimitAmount.currency] = 0; this.owners[role]++; return ok(); }
    if (tx.TransactionType === 'OfferCancel') { const o = this.offers.find((x) => x.role === role && x.seq === tx.OfferSequence); if (o) { this.offers = this.offers.filter((x) => x !== o); this.owners[role]--; } return ok(); }
    if (tx.TransactionType === 'OfferCreate') {
      if (tx.OfferSequence != null) await this.submit(role, { TransactionType: 'OfferCancel', OfferSequence: tx.OfferSequence });
      const seq = ++this.seq;
      const ask = typeof tx.TakerGets === 'object';
      const o = { role, seq, code: ask ? tx.TakerGets.currency : tx.TakerPays.currency, side: ask ? 'ask' : 'bid', tokenQty: Number(ask ? tx.TakerGets.value : tx.TakerPays.value), xrp: Number(ask ? tx.TakerPays : tx.TakerGets) / 1e6 };
      this.offers.push(o); this.owners[role]++;
      nodes.push({ CreatedNode: { LedgerEntryType: 'Offer', NewFields: { Account: ADDR[role], Sequence: seq, TakerGets: tx.TakerGets, TakerPays: tx.TakerPays } } });
      return ok();
    }
    if (tx.TransactionType === 'Payment' && !tx.SendMax) { // issuer inventory
      const to = this.roleOf(tx.Destination); this.lines[to][tx.Amount.currency] += Number(tx.Amount.value); return ok();
    }
    if (tx.TransactionType === 'Payment') {
      assert.ok(!(Number(tx.Flags || 0) & 0x00020000), 'never a partial payment');
      const d = tx.Amount;
      const to = typeof d === 'string' ? 'XRP' : d.currency;
      const from = typeof tx.SendMax === 'string' ? 'XRP' : tx.SendMax.currency;
      const cost = this.route(from, to, d, false);
      const max = typeof tx.SendMax === 'string' ? Number(tx.SendMax) / 1e6 : Number(tx.SendMax.value);
      if (cost == null || cost > max + 1e-9) { const e = new Error('Payment failed: tecPATH_PARTIAL'); e.tx = { hash, result: 'tecPATH_PARTIAL' }; throw e; }
      this.route(from, to, d, true, nodes);
      if (from !== 'XRP') {
        const prev = this.lines[role][from]; this.lines[role][from] -= cost;
        nodes.push(rsNode(ADDR[role], ADDR.issuer, from, prev, this.lines[role][from]));
      } else this.xrp[role] -= cost;
      return ok({ delivered_amount: d });
    }
    throw new Error('fake: unsupported tx');
  }
}

const launchQuotes = () => [
  { role: 'maker', seq: 1, code: 'BBL', side: 'ask', tokenQty: 900, xrp: 9 },
  { role: 'maker', seq: 2, code: 'BBL', side: 'bid', tokenQty: 100, xrp: 0.8 },
];
const profile1 = { endUser: { count: 10, routeMix: { xrp_to_token: 5, token_to_xrp: 5, token_to_token: 2 }, sizeHist: [{ lo: 10, hi: 100, count: 10 }], sizeXrp: { median: 40 }, xrpBridged: { shareOfTokenToToken: 1 } }, window: { fromLedger: 1, toLedger: 40 } };

function harness(fakeOpts = {}, runnerOpts = {}) {
  const fake = new FakeLedger({ offers: launchQuotes(), ...fakeOpts });
  const events = [];
  let t = Date.parse('2026-10-24T10:00:00Z');
  const sleeps = [];
  let saved = null;
  const runner = new PathfinderRunner({
    io: fake, bus: { publish: (type, mode, payload) => events.push({ type, mode, ...payload }) },
    persist: { load: () => ({}), save: (v) => { saved = v; } },
    sleep: async (ms) => { sleeps.push(ms); t += ms; }, now: () => t, readonly: () => false, id: (() => { let i = 0; return () => `run${++i}`; })(),
    ...runnerOpts,
  });
  return { fake, runner, events, sleeps, saved: () => saved, tick: (ms) => { t += ms; } };
}

test('options: strategy names, k caps, tokens must be live', () => {
  assert.throws(() => normalizeOptions({ k: CAPS.maxK + 1 }, ['BBL']), /k must be/);
  assert.throws(() => normalizeOptions({ strategy: 'moon' }, ['BBL']), /Unknown strategy/);
  assert.throws(() => normalizeOptions({ tokens: ['XYZ'] }, ['BBL']), /not a live/);
  assert.throws(() => normalizeOptions({}, []), /No live token/);
  const o = normalizeOptions({ seed: 7 }, ['BBL', 'LDN', 'ZZZ']);
  assert.deepEqual([o.strategy, o.rivalStrategy, o.k, o.tokens, o.seed], ['tight', 'static_wide', 8, ['BBL', 'LDN'], 7]);
});

test('payment sampling follows the profile shape, scaled to Testnet caps; one token drops token→token', () => {
  const shape = flowShape(profile1);
  const one = samplePayments(shape, { k: 20, tokens: ['BBL'], seed: 3 });
  assert.equal(one.payments.length, 20);
  assert.ok(one.payments.every((p) => p.route !== 'token_to_token'));
  assert.ok(one.notes.some((n) => /second launched token/.test(n)));
  assert.ok(one.payments.every((p) => p.sizeXrp >= CAPS.minPaymentXrp && p.sizeXrp <= CAPS.maxPaymentXrp));
  const two = samplePayments(shape, { k: 20, tokens: ['BBL', 'LDN'], seed: 3 });
  assert.ok(two.payments.some((p) => p.route === 'token_to_token' && p.from !== 'XRP' && p.to !== 'XRP'));
  assert.deepEqual(samplePayments(shape, { k: 5, tokens: ['BBL'], seed: 9 }), samplePayments(shape, { k: 5, tokens: ['BBL'], seed: 9 }), 'seeded');
});

test('quotes: tight sits inside the rival static_wide, one_sided only asks', () => {
  const mids = { BBL: 0.009 };
  const ours = buildQuotes('maker', STRATEGIES.tight, ['BBL'], mids);
  const theirs = buildQuotes('rival', RIVAL_STRATEGIES.static_wide, ['BBL'], mids);
  assert.ok(ours.find((q) => q.side === 'ask').priceXrp < theirs.find((q) => q.side === 'ask').priceXrp);
  assert.ok(ours.find((q) => q.side === 'bid').priceXrp > theirs.find((q) => q.side === 'bid').priceXrp);
  assert.deepEqual(buildQuotes('maker', STRATEGIES.one_sided, ['BBL'], mids).map((q) => q.side), ['ask']);
  assert.equal(buildQuotes('maker', STRATEGIES.bridge_leg, ['BBL', 'LDN'], { BBL: 0.009, LDN: 0.02 }).length, 4);
  assert.deepEqual(buildQuotes('rival', RIVAL_STRATEGIES.none, ['BBL'], mids), []);
});

test('plan is a read-only dry run: setup, budget, guardian verdicts, pathfind results', async () => {
  const { fake, runner } = harness();
  const plan = await runner.plan(normalizeOptions({ k: 6, seed: 11 }, ['BBL']), profile1);
  assert.equal(fake.submitted.length, 0, 'plan never submits');
  assert.equal(plan.dryRun, true);
  assert.equal(plan.organic, false);
  assert.equal(plan.statement, STATEMENT);
  assert.ok(plan.setup.some((s) => s.role === 'rival' && s.step === 'trustline'));
  assert.ok(plan.setup.some((s) => s.role === 'issuer' && s.to === 'router'));
  assert.equal(plan.budget.ok, true);
  assert.ok(plan.proposals.every((p) => p.allowedIfApproved === true));
  assert.equal(plan.payments.length, 6);
  const tokenSourced = plan.payments.find((p) => p.from !== 'XRP');
  if (tokenSourced) assert.match(tokenSourced.pathfind.reason, /Router holds no/);
  const xrpSourced = plan.payments.find((p) => p.from === 'XRP');
  if (xrpSourced) assert.equal(xrpSourced.pathfind.ok, true);
});

test('budget guard blocks runs that do not fit spendable XRP', async () => {
  const { runner, fake } = harness({ xrp: { router: 1.1 } });
  const plan = await runner.plan(normalizeOptions({ k: 8, seed: 1 }, ['BBL']), profile1);
  assert.equal(plan.budget.ok, false);
  assert.ok(plan.budget.reasons.some((r) => /router needs/.test(r)));
  const run = runner.start(normalizeOptions({ k: 8, seed: 1 }, ['BBL']), profile1, { approved: true });
  await runner.done.get(run.id);
  assert.equal(run.status, 'failed');
  assert.match(run.error, /Budget check failed/);
  assert.equal(fake.submitted.length, 0);
});

test('live run requires approval, refuses read-only, queues one at a time', async () => {
  const { runner } = harness();
  const o = normalizeOptions({ k: 2, seed: 5 }, ['BBL']);
  assert.throws(() => runner.start(o, profile1, {}), (e) => e instanceof PathfinderError && /approval/.test(e.message));
  const ro = harness({}, { readonly: () => true }).runner;
  assert.throws(() => ro.start(o, profile1, { approved: true }), (e) => e.status === 403);
  const a = runner.start(o, profile1, { approved: true });
  const b = runner.start(o, profile1, { approved: true });
  assert.throws(() => runner.start(o, profile1, { approved: true }), (e) => e.status === 429);
  assert.equal(b.status, 'queued');
  await runner.done.get(b.id);
  assert.equal(a.status, 'done');
  assert.ok(Date.parse(a.finishedAt) <= Date.parse(b.startedAt), 'second run starts after the first finishes');
});

test('tight strategy captures pathfound flow over the static wide rival; attribution → scorecard', async () => {
  const { runner, fake, events, sleeps } = harness();
  const run = runner.start(normalizeOptions({ strategy: 'tight', k: 8, seed: 21 }, ['BBL']), profile1, { approved: true });
  await runner.done.get(run.id);
  assert.equal(run.status, 'done', run.error);
  const sc = run.scorecard;
  assert.equal(sc.organic, false);
  assert.equal(sc.payments.succeeded, 8);
  assert.ok(sc.capture.maker.share > sc.capture.rival.share, JSON.stringify(sc.capture));
  assert.ok(sc.capture.maker.fills > 0);
  assert.ok(sc.realizedSpreadXrp.maker > 0, 'maker earns spread vs mid');
  assert.ok(sc.execution.avgBpsVsMid >= 0);
  // Every payment was a non-partial pathfound Payment with SendMax.
  const pays = fake.submitted.filter((s) => s.role === 'router' && s.tx.TransactionType === 'Payment');
  assert.equal(pays.length, 8);
  assert.ok(pays.every((p) => p.tx.SendMax && !(Number(p.tx.Flags || 0) & 0x20000)));
  // Paced at >= 4 s between payments.
  assert.ok(sleeps.filter((ms) => ms > 0).length >= 7 && sleeps.every((ms) => ms <= CAPS.paceMs));
  // Events.
  const pe = events.filter((e) => e.type === 'pathfinder.payment');
  assert.equal(pe.length, 8);
  assert.ok(pe.every((e) => e.mode === 'LIVE_TESTNET' && e.runId === run.id && e.hash && e.capturedBy));
  const done = events.find((e) => e.type === 'pathfinder.run_done');
  assert.equal(done.strategy, 'tight');
  assert.equal(done.scorecard, sc);
  // Cleanup: no strategy offers left; launch quotes untouched.
  assert.deepEqual(fake.offers.filter((o) => o.role === 'rival'), []);
  assert.ok(fake.offers.every((o) => o.seq <= 2));
  assert.deepEqual(runner.openOffers, { maker: [], rival: [] });
});

test('wide strategy loses flow to the rival; one_sided cannot capture token→XRP', async () => {
  const { runner } = harness();
  const w = runner.start(normalizeOptions({ strategy: 'wide', k: 6, seed: 4 }, ['BBL']), profile1, { approved: true });
  await runner.done.get(w.id);
  assert.ok(w.scorecard.capture.rival.share > w.scorecard.capture.maker.share, JSON.stringify(w.scorecard.capture));
  const h2 = harness();
  const one = h2.runner.start(normalizeOptions({ strategy: 'one_sided', rivalStrategy: 'none', k: 8, seed: 21 }, ['BBL']), profile1, { approved: true });
  await h2.runner.done.get(one.id);
  for (const p of one.payments.filter((x) => x.status === 'success' && x.to === 'XRP')) assert.equal(p.attribution.capturedBy.maker, 0);
});

test('token→token payments auto-bridge through XRP; bridge_leg quotes both books', async () => {
  const { runner, fake } = harness({ lines: { maker: { BBL: 1e6, LDN: 1e6 }, taker: { BBL: 0, LDN: 0 }, rival: {}, router: {} },
    offers: [...launchQuotes(), { role: 'maker', seq: 3, code: 'LDN', side: 'ask', tokenQty: 900, xrp: 9 }, { role: 'maker', seq: 4, code: 'LDN', side: 'bid', tokenQty: 100, xrp: 0.8 }] });
  const tt = { ...profile1, endUser: { ...profile1.endUser, routeMix: { xrp_to_token: 0, token_to_xrp: 0, token_to_token: 1 } } };
  const run = runner.start(normalizeOptions({ strategy: 'bridge_leg', k: 4, seed: 8 }, ['BBL', 'LDN']), tt, { approved: true });
  await runner.done.get(run.id);
  assert.equal(run.status, 'done', run.error);
  assert.equal(run.quotes.filter((q) => q.role === 'maker').length, 4);
  assert.ok(run.payments.every((p) => p.route === 'token_to_token'));
  assert.ok(run.scorecard.payments.bridged >= 1);
  const tx = fake.submitted.find((s) => s.role === 'router' && s.tx.TransactionType === 'Payment').tx;
  assert.ok(tx.Paths?.[0]?.some((s) => s.currency === 'XRP'), 'path steps through XRP');
});

test('replenish re-posts consumed quotes; guardian refusal stops the run', async () => {
  const { runner } = harness();
  const run = runner.start(normalizeOptions({ strategy: 'replenish', k: 8, seed: 21 }, ['BBL']), profile1, { approved: true });
  await runner.done.get(run.id);
  assert.equal(run.status, 'done', run.error);
  assert.ok(run.replenished > 0);
  assert.ok(run.actions.some((a) => /re-quotes/.test(a.what)));

  const refuse = (p) => (p.txType === 'Payment' && p.role === 'router' ? { allowed: false, reasons: ['test refusal'] } : guardCheck(p));
  const h = harness({}, { guard: refuse });
  const r2 = h.runner.start(normalizeOptions({ k: 3, seed: 21 }, ['BBL']), profile1, { approved: true });
  await h.runner.done.get(r2.id);
  assert.equal(r2.status, 'failed');
  assert.match(r2.error, /Guardian refused/);
  assert.equal(h.fake.submitted.filter((s) => s.role === 'router' && s.tx.TransactionType === 'Payment').length, 0);
  assert.deepEqual(h.fake.offers.filter((o) => o.role === 'rival'), [], 'quotes cleaned up after failure');
});

test('hourly cap counts sent payments', async () => {
  const { runner } = harness();
  runner.runs.push({ id: 'old', options: {}, payments: Array.from({ length: CAPS.perHour - 2 }, () => ({ hash: 'h', at: '2026-10-24T09:30:00Z' })) });
  assert.throws(() => runner.start(normalizeOptions({ k: 3 }, ['BBL']), profile1, { approved: true }), (e) => e.status === 429);
});

test('attribution reads offer deltas: owner, side, XRP captured, bridging, edge vs mid', () => {
  const meta = {
    TransactionResult: 'tesSUCCESS', delivered_amount: tok('LDN', 100),
    AffectedNodes: [
      // LDN ask by maker (strategy seq 50): gave 100 LDN, got 1.0 XRP
      { DeletedNode: { LedgerEntryType: 'Offer', FinalFields: { Account: ADDR.maker, Sequence: 50, TakerGets: tok('LDN', 0), TakerPays: '0' }, PreviousFields: { TakerGets: tok('LDN', 100), TakerPays: '1000000' } } },
      // BBL bid by rival: gave 1.0 XRP, got 112 BBL
      { ModifiedNode: { LedgerEntryType: 'Offer', FinalFields: { Account: ADDR.rival, Sequence: 60, TakerGets: '2000000', TakerPays: tok('BBL', 224) }, PreviousFields: { TakerGets: '3000000', TakerPays: tok('BBL', 336) } } },
      rsNode(ADDR.router, ADDR.issuer, 'BBL', 200, 88),
    ],
  };
  const a = attribute(meta, { addrs: ADDR, mids: { BBL: 0.009, LDN: 0.0099 }, strategySeqs: { maker: new Set([50]), rival: new Set([60]) }, from: 'BBL', to: 'LDN' });
  assert.equal(a.bridged, true);
  assert.deepEqual(a.capturedBy, { maker: 1, rival: 1, other: 0 });
  assert.equal(a.fills.find((f) => f.role === 'maker').side, 'ask');
  assert.equal(a.fills.find((f) => f.role === 'rival').side, 'bid');
  assert.ok(Math.abs(a.fills.find((f) => f.role === 'maker').edgeXrp - 0.01) < 1e-9);
  assert.ok(Math.abs(a.spentXrp - 112 * 0.009) < 1e-9);
  assert.ok(a.execBpsVsMid > 0);
  // Non-strategy maker offers (launch quotes) are attributed to "other".
  const b = attribute(meta, { addrs: ADDR, mids: { BBL: 0.009, LDN: 0.0099 }, strategySeqs: {}, from: 'BBL', to: 'LDN' });
  assert.equal(b.capturedBy.other, 1);
  assert.deepEqual(consumedOffers(meta, ADDR.router).map((o) => o.owner), [ADDR.maker, ADDR.rival]);
  assert.equal(balanceChanges(meta).get(ADDR.router).get(`BBL.${ADDR.issuer}`), -112);
});

test('buildPlan flags missing maker inventory and hourly cap', () => {
  const state = { addrs: ADDR, reserveBase: 1, reserveInc: 0.2, feeXrp: 0.00001, mids: { BBL: 0.009 }, books: {}, validatedLedger: 1,
    accounts: Object.fromEntries(Object.keys(ADDR).map((r) => [r, { address: ADDR[r], xrp: 100, ownerCount: 0, spendable: 99, lines: r === 'maker' ? { BBL: { balance: 10 } } : r === 'taker' ? { BBL: { balance: 0 } } : {} }])) };
  const plan = buildPlan(state, normalizeOptions({ k: 5, seed: 2 }, ['BBL']), flowShape(profile1), { paymentsLastHour: CAPS.perHour - 2 });
  assert.equal(plan.budget.ok, false);
  assert.ok(plan.budget.reasons.some((r) => /maker holds 10 BBL/.test(r)));
  assert.ok(plan.budget.reasons.some((r) => /Hourly cap/.test(r)));
});

test('flowShape falls back to all pathfound flow (labeled) when a window has no full-delivery payments', () => {
  const p = buildProfile([{ ledger_index: 1, close_time_iso: '2026-10-23T00:00:00Z', transactions: [partial, partial, partial, circular] }]);
  assert.equal(p.totals.endUser, 0);
  const s = flowShape(p);
  assert.equal(s.fallback, true);
  assert.match(s.source, /never partial/);
  assert.ok(s.routeMix.xrp_to_token >= 3);
  const legacy = { ...p }; delete legacy.pathfoundAll;
  const s2 = flowShape(legacy);
  assert.deepEqual(s2.routeMix, s.routeMix);
});

// BC-07: a fill counts only where PreviousFields TakerGets/TakerPays minus final > 0, for Modified and Deleted alike;
// unfunded / expired removals are never fills or captured flow and are reported separately.
test('BC-07 fill accounting: partial fill, full fill, unfunded removal, expired removal', () => {
  const closeIso = '2026-10-23T00:00:00Z';
  const closeRipple = Math.floor(Date.parse(closeIso) / 1000) - 946684800;
  const meta = {
    TransactionResult: 'tesSUCCESS', delivered_amount: amt(USD, 3),
    AffectedNodes: [
      // partial fill (ModifiedNode with deltas): rPartial gave 1 USD, got 2 XRP
      offerNode('ModifiedNode', 'rPartial', 1, amt(USD, 5), '10000000', amt(USD, 4), '8000000'),
      // full fill (DeletedNode with FinalFields + PreviousFields deltas): rFull gave 2 USD, got 4 XRP
      offerNode('DeletedNode', 'rFull', 2, amt(USD, 2), '4000000', amt(USD, 0), '0'),
      // unfunded removal: DeletedNode, no PreviousFields
      { DeletedNode: { LedgerEntryType: 'Offer', FinalFields: { Account: 'rUnfunded', Sequence: 3, TakerGets: amt(USD, 50), TakerPays: '100000000' } } },
      // expired removal: DeletedNode with Expiration in the past, PreviousFields present but zero delta
      { DeletedNode: { LedgerEntryType: 'Offer', FinalFields: { Account: 'rExpired', Sequence: 4, Expiration: closeRipple - 10, TakerGets: amt(USD, 7), TakerPays: '14000000' }, PreviousFields: { TakerGets: amt(USD, 7), TakerPays: '14000000' } } },
    ],
  };
  const fills = consumedOffers(meta, 'rPayer');
  assert.deepEqual(fills.map((f) => [f.owner, f.deleted, f.getsDelta, f.xrpDelta]), [['rPartial', false, 1, 2], ['rFull', true, 2, 4]]);
  // Mainnet profile: maker capture counts only the two fills; removals are reported separately.
  const e = { ...entry({ TransactionType: 'Payment', Account: 'rPayer', Destination: 'rDest', SendMax: '7000000', DeliverMax: amt(USD, 3) }, meta), close_time_iso: closeIso };
  const c = classifyPayment(e);
  assert.deepEqual(c.makers.map((m) => m.owner), ['rPartial', 'rFull']);
  assert.deepEqual(c.removals, { removed_unfunded: 1, expired: 1 });
  const p = buildProfile([{ ledger_index: 9, close_time_iso: closeIso, transactions: [e] }]);
  assert.deepEqual(p.endUser.makerCapture.top.map((m) => m.account).sort(), ['rFull', 'rPartial'].map((a) => `${a.slice(0, 5)}…${a.slice(-4)}`).sort());
  assert.equal(p.endUser.makerCapture.fills, 2);
  assert.equal(p.endUser.makerCapture.xrp, 6);
  assert.deepEqual(p.endUser.removals, { removed_unfunded: 1, expired: 1 });

  // Testnet attribution + scorecard: same rule.
  const tmeta = {
    TransactionResult: 'tesSUCCESS', delivered_amount: tok('BBL', 300),
    AffectedNodes: [
      { ModifiedNode: { LedgerEntryType: 'Offer', FinalFields: { Account: ADDR.maker, Sequence: 50, TakerGets: tok('BBL', 100), TakerPays: '900000' }, PreviousFields: { TakerGets: tok('BBL', 200), TakerPays: '1800000' } } },
      { DeletedNode: { LedgerEntryType: 'Offer', FinalFields: { Account: ADDR.rival, Sequence: 60, TakerGets: tok('BBL', 0), TakerPays: '0' }, PreviousFields: { TakerGets: tok('BBL', 200), TakerPays: '1820000' } } },
      { DeletedNode: { LedgerEntryType: 'Offer', FinalFields: { Account: 'rStranger', Sequence: 70, TakerGets: tok('BBL', 999), TakerPays: '1000000' } } },
    ],
  };
  const a = attribute(tmeta, { addrs: ADDR, mids: { BBL: 0.009 }, strategySeqs: { maker: new Set([50]), rival: new Set([60]) }, from: 'XRP', to: 'BBL' });
  assert.deepEqual(a.fills.map((f) => [f.role, f.deleted]), [['maker', false], ['rival', true]]);
  assert.deepEqual(a.capturedBy, { maker: 0.9, rival: 1.82, other: 0 });
  assert.deepEqual(a.removals, [{ owner: 'rStranger', seq: 70, reason: 'removed_unfunded', role: 'external' }]);
  const sc = scorecard({ options: { strategy: 'tight', rivalStrategy: 'static_wide', tokens: ['BBL'] }, payments: [{ status: 'success', hash: 'h', attribution: a }], actions: [] });
  assert.equal(sc.capture.other.fills, 0);
  assert.equal(sc.capture.maker.fills + sc.capture.rival.fills, 2);
  assert.equal(sc.offerRemovals.removed_unfunded, 1);
});


// ---------------- evidence + NO_PATH diagnosis + continuity plan (pure / fake ledger) ----------------
const ofr = (kind, owner, seq, prevGets, prevPays, gets, pays) => ({ [kind]: { LedgerEntryType: 'Offer', FinalFields: { Account: owner, Sequence: seq, TakerGets: gets, TakerPays: pays }, PreviousFields: { TakerGets: prevGets, TakerPays: prevPays } } });
// BBL -> LDN bridged: maker bid on BBL (gives XRP, gets BBL) + maker ask on LDN (gives LDN, gets XRP).
const bridgedMeta = {
  TransactionResult: 'tesSUCCESS', delivered_amount: tok('LDN', 100),
  AffectedNodes: [
    ofr('ModifiedNode', ADDR.maker, 11, '5000000', tok('BBL', 556), '4100000', tok('BBL', 456)),
    ofr('ModifiedNode', ADDR.maker, 12, tok('LDN', 554), '5000000', tok('LDN', 454), '4100000'),
    { ModifiedNode: { LedgerEntryType: 'RippleState', FinalFields: { Balance: { currency: 'BBL', issuer: 'rrrrrrrrrrrrrrrrrrrrBZbvji', value: '-300' }, LowLimit: { currency: 'BBL', issuer: ADDR.issuer, value: '0' }, HighLimit: { currency: 'BBL', issuer: ADDR.router, value: '1e9' } }, PreviousFields: { Balance: { currency: 'BBL', issuer: 'rrrrrrrrrrrrrrrrrrrrBZbvji', value: '-400' } } } },
  ],
};
const ectx = { addrs: ADDR, strategySeqs: { maker: new Set([11, 12]), rival: new Set([21]) } };

test('evidence: owner attribution separates strategy quotes, launch seed offers, rival and others', () => {
  assert.equal(ownerBucket(ADDR.maker, 11, ectx), 'maker');
  assert.equal(ownerBucket(ADDR.maker, 99, ectx), 'maker_seed');
  assert.equal(ownerBucket(ADDR.rival, 5, ectx), 'rival');
  assert.equal(ownerBucket('rStranger', 1, ectx), 'other');
  const f = evidenceFills(bridgedMeta, ectx);
  assert.deepEqual(f.map((x) => [x.bucket, x.book, x.side, x.tokenQty, x.xrp]), [['maker', 'BBL/XRP', 'bid', 100, 0.9], ['maker', 'LDN/XRP', 'ask', 100, 0.9]]);
});

test('evidence: XRP bridge-leg inference needs fills in BOTH X/XRP and XRP/Y books', () => {
  const f = evidenceFills(bridgedMeta, ectx);
  const b = bridgeInference(f, 'BBL', 'LDN');
  assert.equal(b.verified, true);
  assert.equal(b.xrpBridged, 0.9);
  assert.equal(b.xrpImbalance, 0);
  assert.equal(bridgeInference([f[0]], 'BBL', 'LDN').verified, false); // one leg only
  assert.equal(bridgeInference(f, 'LDN', 'BBL').verified, false); // wrong direction: LDN bid / BBL ask not consumed
  assert.equal(bridgeInference(f, 'BBL', 'XRP').applicable, false);
  const direct = evidenceFills({ AffectedNodes: [ofr('ModifiedNode', 'rX', 1, tok('LDN', 10), tok('BBL', 10), tok('LDN', 5), tok('BBL', 5))] }, ectx);
  assert.equal(direct[0].side, 'direct');
  assert.match(bridgeInference(direct, 'BBL', 'LDN').note, /direct/);
});

test('evidence: depth before/after from funded book levels and consumed deltas', () => {
  const asks = normalizeBook([
    { Account: ADDR.maker, Sequence: 12, TakerGets: tok('LDN', 554), TakerPays: '5000000' },
    { Account: ADDR.rival, Sequence: 21, TakerGets: tok('LDN', 330), TakerPays: '3000000', taker_gets_funded: tok('LDN', 165), taker_pays_funded: '1500000' },
    { Account: 'rBroke', Sequence: 3, TakerGets: tok('LDN', 10), TakerPays: '100000', taker_gets_funded: tok('LDN', 0), taker_pays_funded: '0' },
  ], { side: 'ask', ...ectx });
  const s = depthSummary(asks);
  assert.equal(s.xrp, 6.5); assert.equal(s.tokenQty, 719); assert.equal(s.unfundedOffers, 1); assert.equal(s.bestPriceXrp, Number((5 / 554).toPrecision(6)));
  assert.deepEqual(s.byBucket, { maker: 5, rival: 1.5 });
  assert.equal(asks[1].partlyFunded, true);
  const after = depthAfter(asks, evidenceFills(bridgedMeta, ectx));
  assert.equal(depthSummary(after).xrp, 5.6);
  assert.equal(after[0].tokenQty, 454);
  const bids = normalizeBook([{ Account: ADDR.maker, Sequence: 11, TakerGets: '5000000', TakerPays: tok('BBL', 556) }], { side: 'bid', ...ectx });
  assert.equal(routeDepthXrp({ from: 'BBL', to: 'LDN' }, { bids, asks }), 5); // min of both legs
  assert.equal(routeDepthXrp({ from: 'XRP', to: 'LDN' }, { asks }), 6.5);
  assert.equal(routeDepthXrp({ from: 'BBL', to: 'XRP' }, { bids }), 5);
});

test('evidence: spread at the touch vs price impact (bps)', () => {
  const mids = { BBL: 0.009, LDN: 0.009 };
  // XRP -> LDN at exactly the touch (+15 bps): impact 0.
  let p = pricing({ from: 'XRP', to: 'LDN', spent: 100 * 0.0090135, delivered: 100, mids, touch: { toAsk: 0.0090135 } });
  assert.equal(p.execBps, 15); assert.equal(p.spreadBps, 15); assert.equal(p.impactBps, 0);
  // Walked past the touch: paid 0.00905 average while the touch was 0.0090135.
  p = pricing({ from: 'XRP', to: 'LDN', spent: 100 * 0.00905, delivered: 100, mids, touch: { toAsk: 0.0090135 } });
  assert.equal(p.execBps, 55.6); assert.equal(p.spreadBps, 15); assert.equal(p.impactBps, 40.6);
  // Bridged BBL -> LDN: two half-spreads at the touch ≈ 30 bps.
  p = pricing({ from: 'BBL', to: 'LDN', spent: 100.3, delivered: 100, mids, touch: { fromBid: 0.0089865, toAsk: 0.0090135 } });
  assert.equal(p.spreadBps, 30); assert.equal(p.execBps, 30); assert.equal(p.impactBps, 0);
  assert.equal(pricing({ from: 'BBL', to: 'XRP', spent: 0, delivered: 1, mids }).execBps, null);
});

const goodSnap = () => ({
  from: 'BBL', to: 'LDN', sourceNeeded: 183.5, destQty: 180.3, needXrp: 1.62,
  router: { lines: { BBL: { balance: 440, limit: 1e9 } } }, taker: { lines: { LDN: { balance: 850, limit: 2e6 } } },
  legA: { fundedXrp: 8.8, fundedToken: 993, offers: 3, unfundedOffers: 0 }, legB: { fundedXrp: 16, fundedToken: 1784, offers: 3, unfundedOffers: 0 },
  quotesValidatedBeforePathfind: true, decidedBy: 'rippled_empty_alternatives', request: { ok: true, issues: [] },
  rpf: { full: 0, fullNext: 0, legA: true, legB: true },
});
test('NO_PATH classifier: each cause on fixtures', () => {
  const c = (patch) => classifyNoPath({ ...goodSnap(), ...patch }).category;
  assert.equal(c({}), 'other'); // the runs 4/5 case: everything sufficient, rippled returned no two-book route
  assert.match(classifyNoPath(goodSnap()).summary, /no fallback/);
  assert.equal(c({ router: { lines: {} } }), 'missing_trustline');
  assert.equal(c({ router: { lines: { BBL: { balance: 10, limit: 1e9 } } } }), 'missing_trustline');
  assert.equal(c({ taker: { lines: { LDN: { balance: 1e6, limit: 1e6 } } } }), 'missing_trustline');
  assert.equal(c({ quotesValidatedBeforePathfind: false }), 'offers_not_validated');
  assert.equal(c({ legA: { fundedXrp: 0, fundedToken: 0, offers: 2, unfundedOffers: 2 } }), 'unfunded_offers');
  assert.equal(c({ legB: { fundedXrp: 0.5, fundedToken: 50, offers: 1, unfundedOffers: 0 } }), 'depleted_inventory');
  assert.equal(c({ request: { ok: false, issues: ['bad issuer'] } }), 'request_parameters');
  assert.equal(c({ decidedBy: 'app_precheck' }), 'app_precheck');
  assert.equal(c({ rpf: { full: 1, fullNext: 1, legA: true, legB: true } }), 'insufficient_evidence'); // not reproduced
  assert.equal(classifyNoPath({ from: 'BBL' }).category, 'insufficient_evidence');
});

test('buildEvidence: per-payment evidence, headlines, NO_PATH diagnosis and run comparison', () => {
  const opts = { strategy: 'bridge_leg', rivalStrategy: 'static_wide', k: 1, seed: 11, tokens: ['BBL', 'LDN'], routeMix: { token_to_token: 1 } };
  const quotes = [{ role: 'maker', code: 'BBL', side: 'bid', priceXrp: 0.0089865, tokenQty: 556, xrp: 5 }, { role: 'maker', code: 'LDN', side: 'ask', priceXrp: 0.0090135, tokenQty: 554, xrp: 5 }];
  const pay = { i: 0, route: 'token_to_token', from: 'BBL', to: 'LDN', sizeXrp: 0.9, at: '2026-10-24T00:12:53Z' };
  const runs = [
    { id: 'bad', createdAt: '2026-10-24T00:11:51Z', status: 'done', options: opts, mids: { BBL: 0.009, LDN: 0.009 }, quotes, peakOffers: { maker: 2 }, reserveInc: 0.2, actions: [{ role: 'maker', txType: 'OfferCreate', hash: 'Q1', ledger: 100 }, { role: 'maker', txType: 'OfferCancel', hash: 'C1', what: 'maker cancels offer 11', ledger: 110 }], payments: [{ ...pay, status: 'skipped', reason: 'No path' }] },
    { id: 'good', createdAt: '2026-10-24T00:17:27Z', status: 'done', options: opts, mids: { BBL: 0.009, LDN: 0.009 }, quotes, peakOffers: { maker: 2 }, reserveInc: 0.2, actions: [{ role: 'maker', txType: 'OfferCreate', hash: 'Q2', ledger: 200 }, { role: 'maker', txType: 'OfferCreate', hash: 'Q3', ledger: 201 }], payments: [{ ...pay, status: 'success', hash: 'P1', ledger: 205, result: 'tesSUCCESS' }] },
  ];
  const book = (side) => side === 'bid' ? [{ Account: ADDR.maker, Sequence: 11, TakerGets: '5000000', TakerPays: tok('BBL', 556) }] : [{ Account: ADDR.maker, Sequence: 12, TakerGets: tok('LDN', 554), TakerPays: '5000000' }];
  const raw = {
    addrs: ADDR, collectedAt: 'x',
    txs: { Q1: { createdSeq: 11, feeXrp: 0.000012 }, Q2: { createdSeq: 12, feeXrp: 0.000012 }, Q3: { createdSeq: 11, feeXrp: 0.000012 }, P1: { ledger_index: 205, tx_json: { Fee: '12', SendMax: tok('BBL', 101.5), Paths: [[{ currency: 'XRP' }, { currency: 'LDN', issuer: ADDR.issuer }]] }, meta: bridgedMeta } },
    books: { '204|bid|BBL': book('bid'), '204|ask|LDN': book('ask') },
    primaryRerun: { 'good|0': { alternatives: 0, ledger: 204 } },
    noPath: { 'bad|0': { ...goodSnap(), routeDepthXrp: 5, legA: { ...goodSnap().legA, levels: [] }, legB: { ...goodSnap().legB, levels: [] } } },
  };
  const ev = buildEvidence(raw, runs);
  assert.equal(ev.organic, false);
  const [r1, r2] = ev.runs;
  assert.equal(r1.payments[0].diagnosis.classification.category, 'other');
  const p = r2.payments[0];
  assert.equal(p.bridge.verified, true);
  assert.equal(p.pathfind.method, 'xrp_bridge_fallback (inferred)');
  assert.equal(p.flowWinner, 'maker');
  assert.equal(p.spent.value, 100);
  assert.equal(p.depth.before.routeXrp, 5); assert.equal(p.depth.after.routeXrp, 4.1);
  assert.equal(p.pricing.execBps, 0); assert.equal(p.pricing.spreadBps, 36.1); assert.equal(p.pricing.impactBps, -36.1); // fixture fills at mid; touch 5/556 bid, 5/554 ask
  assert.equal(r2.headlines.flowCaptured.byBucket.maker.xrp, 1.8); // both bridge legs are maker fills
  assert.equal(r2.headlines.capitalEfficiency.reserveXrp, 0.4);
  assert.equal(r1.headlines.continuity.ranOut, null);
  assert.match(r1.headlines.continuity.verdict, /skipped as NO_PATH while funded depth remained/);
  const cmp = compareRuns(ev.runs.map((r) => ({ ...r, _quotes: quotes })));
  assert.equal(cmp.length, 1);
  assert.deepEqual([cmp[0].skippedRun, cmp[0].succeededRun], [1, 2]);
  assert.equal(cmp[0].identical.payments, true);
  assert.deepEqual(ev.noPath.categories, { other: 1 });
});

test('continuity plan: book walk prediction finds when VELOCITY depth runs out', () => {
  const w = walkLevels([{ role: 'maker', level: 'L2', bps: 15, remaining: 1 }, { role: 'maker', level: 'L1', bps: 5, remaining: 1 }, { role: 'rival', level: 'R', bps: 100, remaining: 3 }], 2.5);
  assert.deepEqual(w.fills.map((f) => [f.level, f.xrp]), [['L1', 1], ['L2', 1], ['R', 0.5]]);
  const a = predictPhase(phases(['BBL', 'LDN'])[0]);
  assert.equal(a.velocityInsufficientAt, 2); // 0.25 + 0.5 used, 0.25 left < 0.75
  assert.deepEqual(a.rows.at(-1).levelsTouched, ['Titan L3', 'rival']);
  assert.equal(predictPhase(phases()[3]).rows.every((r) => r.titanShare === 1), true); // replenished each time (assumed)
});

test('continuity dry run computes the budget and NEVER submits (fake ledger throws on submit)', async () => {
  let submits = 0;
  const io = {
    addresses: () => ADDR,
    submit: () => { submits++; throw new Error('submit must never be called by the dry run'); },
    async request(req) {
      if (req.command === 'server_info') return { result: { info: { validated_ledger: { seq: 5, base_fee_xrp: 0.00001, reserve_inc_xrp: 0.2 }, load_factor: 1 } } };
      if (req.command === 'book_offers') return { result: { offers: [] } };
      if (req.command === 'account_lines') return { result: { lines: [{ currency: 'BBL', balance: '100000' }, { currency: 'LDN', balance: '100000' }] } };
      throw new Error(`unexpected ${req.command}`);
    },
  };
  const plan = await continuityDryRun(io, { tokens: ['BBL', 'LDN'] });
  assert.equal(submits, 0);
  assert.equal(plan.planned, true); assert.equal(plan.approved, false); assert.equal(plan.submitted, 0);
  assert.equal(plan.guardian.allowedNow, 0); // nothing is allowed without approval
  assert.equal(plan.guardian.allowedIfApproved, plan.guardian.total);
  const b = plan.budget;
  assert.equal(b.txs.total, b.txs.maker + b.txs.rival + b.txs.router + b.txs.issuer);
  assert.equal(b.feesXrp, Number((b.txs.total * 0.000012).toFixed(6)));
  assert.equal(b.payments, 19);
  assert.equal(b.inventorySetup.length, 0);
  assert.ok(b.maxSingleTxXrp <= 20);
  const offline = buildContinuityPlan({ source: 't', feeXrp: 0.000012, reserveInc: 0.2, mids: { BBL: 0.009, LDN: 0.009 }, accounts: {} });
  assert.ok(offline.budget.inventorySetup.length > 0); // no balances known -> issuance would be planned (still not submitted)
});

test('quoteXrp: operator quote size applies to our maker only and is validated', async () => {
  const { ourStrategy } = await import('../lib/pathfinder/replay.mjs');
  assert.equal(normalizeOptions({}, ['BBL']).quoteXrp, null);
  assert.equal(normalizeOptions({ quoteXrp: 12 }, ['BBL']).quoteXrp, 12);
  for (const q of [0.5, 16, 'x']) assert.throws(() => normalizeOptions({ quoteXrp: q }, ['BBL']), PathfinderError);
  const o = normalizeOptions({ strategy: 'bridge_leg', quoteXrp: 12 }, ['BBL']);
  assert.equal(ourStrategy(o).notionalXrp, 12);
  assert.equal(STRATEGIES.bridge_leg.notionalXrp, 5); // default untouched
  const quotes = buildQuotes('maker', ourStrategy(o), ['BBL'], { BBL: 0.009 });
  assert.ok(quotes.length === 2 && quotes.every((q) => q.xrp === 12));
});

test('routers: 1–3 parallel payers, round-robin, each with its own setup, budget and Guardian role', async () => {
  const { routerRoles, ROUTER_ROLES, payerState } = await import('../lib/pathfinder/replay.mjs');
  assert.deepEqual(ROUTER_ROLES, ['router', 'router2', 'router3']);
  assert.equal(normalizeOptions({}, ['BBL']).routers, 1);
  for (const r of [0, 4, 1.5]) assert.throws(() => normalizeOptions({ routers: r }, ['BBL']), /routers must be/);
  const o = normalizeOptions({ routers: 3, k: 7, replenish: true, strategy: 'bridge_leg' }, ['BBL']);
  assert.deepEqual(routerRoles(o), ['router', 'router2', 'router3']);
  const { ourStrategy } = await import('../lib/pathfinder/replay.mjs');
  assert.equal(ourStrategy(o).replenish, true); assert.equal(STRATEGIES.bridge_leg.replenish, false);
  for (const role of ['router2', 'router3']) assert.equal(guardCheck({ mode: 'LIVE_TESTNET', txType: 'Payment', role, amountXrp: 1, requiresApproval: true, approved: true }).allowed, true, role);
  assert.equal(guardCheck({ mode: 'LIVE_TESTNET', txType: 'Payment', role: 'router4', amountXrp: 1 }).allowed, false);
  const st = { addrs: { router: 'rA', router2: 'rB' } };
  assert.equal(payerState(st, 'router2').addrs.router, 'rB'); assert.equal(payerState(st, 'router').addrs.router, 'rA'); assert.equal(payerState(st, 'router3'), st);
});

test('three routers: payments go out in parallel batches, each from its own account, all attributed', async () => {
  const { runner, fake, sleeps } = harness();
  const run = runner.start(normalizeOptions({ strategy: 'tight', k: 7, seed: 21, routers: 3 }, ['BBL']), profile1, { approved: true });
  await runner.done.get(run.id);
  const r = runner.get(run.id);
  assert.equal(r.status, 'done', r.error);
  const pays = fake.submitted.filter((x) => x.tx.TransactionType === 'Payment' && x.tx.SendMax);
  assert.deepEqual(pays.map((x) => x.role).sort(), ['router', 'router', 'router', 'router2', 'router2', 'router3', 'router3']);
  assert.equal(r.payments.filter((p) => p.status === 'success').length, 7);
  for (const p of r.payments) assert.ok(p.attribution.fills.every((f) => f.role !== p.router), 'a payer never fills itself');
  // setup gives each payer that spends tokens its own trustline + inventory
  const lines = fake.submitted.filter((x) => x.tx.TransactionType === 'TrustSet').map((x) => x.role);
  for (const role of new Set(r.payments.filter((p) => p.from !== 'XRP').map((p) => p.router))) assert.ok(lines.includes(role), role);
  // 7 payments / 3 routers = 3 batches, so 2 pacing waits (vs 6 for a single router)
  assert.equal(sleeps.filter((ms) => ms > 0 && ms <= CAPS.paceMs).length, 2);
});
