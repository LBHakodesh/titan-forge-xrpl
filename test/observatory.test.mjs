// Liquidity Observatory pure-logic tests: layout, status styles, flow classification, provenance,
// replay determinism, candidate routes and the dev fixture against the /api/spokes contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import obs, {
  STATUSES, statusStyle, layoutSpokes, pointAlong, classifyFlow, provenance, replayOrder, flowEnds, matchSpoke,
  candidatePaths, captureOf, validateSpokes, validateSpoke, validateDetail, validateTx, allSpokes, fmtAge, explorerFor, isHash, amountText,
} from '../public/modules/25-observatory.js';

const fixture = JSON.parse(fs.readFileSync(new URL('../public/observatory-fixture.json', import.meta.url), 'utf8'));
const body = fixture.spokes;
const spokes = allSpokes(body);
const H = 'AB'.repeat(32);
const tx = (over = {}) => ({ hash: H, ledger: 1, network: 'testnet', kind: 'LIVE_TESTNET', at: '2026-10-24T10:00:00Z', from: { currency: 'XRP', issuer: null }, to: { currency: 'X', issuer: 'r1' }, viaXrp: false, delivered: '1', rate: 1, partial: false, offerOwners: [], depthAfter: null, explorer: '', ...over });

test('module shape', () => {
  assert.equal(obs.id, 'observatory');
  assert.equal(typeof obs.mount, 'function');
  assert.ok(obs.order > 20 && obs.order < 30);
});

test('fixture matches the /api/spokes contract', () => {
  assert.deepEqual(validateSpokes(body), []);
  assert.equal(spokes.length, 26);
  assert.equal(body.groups.A.spokes.length, 13);
  assert.equal(body.groups.B.spokes.length, 13);
  for (const st of STATUSES) assert.ok(spokes.some((s) => s.status === st), `fixture covers ${st}`);
  assert.match(fixture._fixture.note, /FIXTURE/);
  assert.equal(body.snapshot.source, 'fixture');
});

test('fixture details, flows and replay match their contracts', () => {
  for (const s of spokes) {
    const d = fixture.details[s.id];
    assert.ok(d, `detail for ${s.id}`);
    assert.deepEqual(validateDetail(d), [], s.id);
  }
  for (const f of fixture.flows.flows) { assert.deepEqual(validateTx(f), []); assert.ok(Array.isArray(f.spokeIds)); }
  for (const r of fixture.replay.sequence) { assert.equal(r.kind, 'REPLAY'); assert.deepEqual(validateTx(r), []); }
});

test('validator catches contract breaks', () => {
  const bad = structuredClone(body);
  bad.groups.A.spokes[0].status = 'LIVE';
  bad.groups.B.spokes[0].corridor.mode = 'LIVE_TESTNET';
  bad.counts.displayed = 25;
  bad.snapshot.freshness = 'fresh';
  const e = validateSpokes(bad);
  assert.ok(e.some((x) => /status LIVE/.test(x)));
  assert.ok(e.some((x) => /corridor/.test(x)));
  assert.ok(e.some((x) => /counts.displayed/.test(x)));
  assert.ok(e.some((x) => /snapshot/.test(x)));
  assert.ok(validateSpoke(null).length);
  assert.deepEqual(validateSpokes(null), ['body: not an object']);
});

test('layout places 26 nodes on two arcs inside the viewBox', () => {
  const { nodes, aggregates } = layoutSpokes(body);
  assert.equal(nodes.length, 26); assert.equal(aggregates.length, 0);
  assert.ok(nodes.filter((n) => n.group === 'A').every((n) => n.x < 0), 'Group A on the left');
  assert.ok(nodes.filter((n) => n.group === 'B').every((n) => n.x > 0), 'Group B on the right');
  for (const n of nodes) {
    assert.ok(Math.abs(n.x) + n.nodeR < 500 && Math.abs(n.y) + n.nodeR < 500, 'inside viewBox');
    assert.ok(Math.hypot(n.x, n.y) - n.nodeR > 70 + 20, 'clear of the hub');
  }
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > a.nodeR + b.nodeR + 10, `no overlap ${a.id} / ${b.id}`);
  }
  // Phone text scale enlarges nodes but still no overlap
  const big = layoutSpokes(body, { k: 2 }).nodes;
  for (let i = 1; i < big.length; i++) assert.ok(Math.hypot(big[i].x - big[i - 1].x, big[i].y - big[i - 1].y) > 2 * big[i].nodeR);
  // Deterministic
  assert.deepEqual(layoutSpokes(body), layoutSpokes(body));
});

test('collapsed groups become one aggregate node', () => {
  const l = layoutSpokes(body, { expanded: { A: false, B: true } });
  assert.equal(l.nodes.length, 13);
  assert.equal(l.aggregates.length, 1);
  assert.equal(l.aggregates[0].group, 'A'); assert.equal(l.aggregates[0].count, 13);
  assert.ok(l.aggregates[0].x < 0);
  assert.equal(layoutSpokes(body, { expanded: { A: false, B: false } }).nodes.length, 0);
  assert.deepEqual(layoutSpokes(null).nodes, []);
});

test('every status has a distinct, non-color-only style; unknown is blocked', () => {
  const sig = STATUSES.map((s) => { const x = statusStyle(s); return `${x.dash}|${x.filled}|${x.double}|${x.blocked}|${x.code}`; });
  assert.equal(new Set(sig).size, STATUSES.length);
  assert.equal(new Set(STATUSES.map((s) => statusStyle(s).cls)).size, STATUSES.length);
  assert.equal(statusStyle('WHATEVER'), statusStyle('UNAVAILABLE'));
  assert.equal(statusStyle('TESTNET_FUNDED').live, true);
  assert.ok(STATUSES.filter((s) => statusStyle(s).live).length === 1, 'only funded Testnet is live');
  assert.equal(statusStyle('MAINNET_OBSERVED').badge, 'mainnet');
});

test('executed vs candidate classification', () => {
  assert.equal(classifyFlow(tx()), 'executed');
  assert.equal(classifyFlow(tx({ kind: 'MAINNET_OBSERVED', network: 'mainnet' })), 'executed');
  assert.equal(classifyFlow(tx({ kind: 'REPLAY', hash: null })), 'executed');
  assert.equal(classifyFlow(tx({ hash: 'nope' })), 'candidate', 'no validated hash');
  assert.equal(classifyFlow(tx({ kind: 'SIMULATION' })), 'candidate');
  assert.equal(classifyFlow(tx({ kind: 'CANDIDATE' })), 'candidate');
  assert.equal(classifyFlow(tx({ suggested: true })), 'candidate', 'pathfinder suggestion');
  assert.equal(classifyFlow(tx({ kind: undefined })), 'candidate');
  assert.equal(classifyFlow(tx({ network: 'mainnet' })), 'invalid', 'LIVE_TESTNET on mainnet');
  assert.equal(classifyFlow(tx({ kind: 'MAINNET_OBSERVED', network: 'testnet' })), 'invalid');
  assert.equal(classifyFlow(null), 'invalid');
  const { paths } = candidatePaths(spokes.find((s) => s.status === 'TESTNET_FUNDED' && s.eligibility.eligible) || spokes.find((s) => s.eligibility.eligible), spokes);
  assert.ok(paths.length);
  for (const p of paths) { assert.equal(classifyFlow(p), 'candidate'); assert.equal(p.mode, 'SIMULATION'); }
});

test('provenance badge per event', () => {
  assert.deepEqual(provenance(tx()), { mode: 'LIVE_TESTNET', label: 'LIVE TESTNET', cls: 'executed', fixture: false, animate: true });
  assert.equal(provenance(tx({ kind: 'MAINNET_OBSERVED', network: 'mainnet' })).mode, 'MAINNET_OBSERVED');
  assert.equal(provenance(tx({ kind: 'REPLAY' })).label, 'REPLAY');
  const c = provenance(tx({ suggested: true }));
  assert.equal(c.mode, 'SIMULATION'); assert.equal(c.animate, false); assert.match(c.label, /CANDIDATE/);
  assert.equal(provenance(tx({ network: 'mainnet' })).mode, 'INVALID');
  const f = provenance(tx(), { fixture: true });
  assert.equal(f.fixture, true); assert.equal(f.mode, 'LIVE_TESTNET', 'fixture flag never changes the mode');
});

test('replay ordering is deterministic and always REPLAY', () => {
  const seq = fixture.replay.sequence;
  const a = replayOrder(fixture.replay);
  const shuffled = [...seq].reverse();
  const b = replayOrder({ sequence: shuffled });
  assert.deepEqual(a, b, 'input order does not matter');
  assert.deepEqual(a, replayOrder(fixture.replay), 'repeatable');
  assert.equal(a.length, seq.length);
  assert.ok(a.every((x) => x.rec.kind === 'REPLAY'));
  assert.equal(a[0].delay, 0);
  for (let i = 1; i < a.length; i++) { assert.ok(a[i].vt >= a[i - 1].vt); assert.ok(a[i].delay >= 400 && a[i].delay <= 4000); }
  // ties broken by hash then index; LIVE kinds get relabeled REPLAY
  const t = replayOrder([{ hash: 'B', at: '2026-01-01T00:00:00Z', kind: 'LIVE_TESTNET' }, { hash: 'A', at: '2026-01-01T00:00:00Z' }]);
  assert.deepEqual(t.map((x) => x.rec.hash), ['A', 'B']);
  assert.equal(t[1].rec.kind, 'REPLAY');
  assert.deepEqual(replayOrder(null), []);
  assert.deepEqual(replayOrder([1, null, 'x']), []);
});

test('flow endpoints resolve spokes, hex currencies and the XRP hub', () => {
  const [s1, s2] = spokes.filter((s) => s.status === 'TESTNET_FUNDED');
  assert.equal(matchSpoke(spokes, { currency: 'XRP', issuer: null }), 'hub');
  assert.equal(matchSpoke(spokes, { currency: s1.currencyHex, issuer: s1.issuer }), s1.id);
  assert.equal(matchSpoke(spokes, { currency: 'NOPE', issuer: 'rX' }), null);
  assert.deepEqual(flowEnds({ from: { currency: s1.currency, issuer: s1.issuer }, to: { currency: s2.currency, issuer: s2.issuer } }, spokes), { from: s1.id, to: s2.id });
  assert.deepEqual(flowEnds({ from: { currency: 'XRP' }, to: { currency: '???', issuer: 'r?' }, spokeIds: [s2.id] }, spokes), { from: 'hub', to: s2.id });
  for (const f of fixture.flows.flows) { const e = flowEnds(f, spokes); assert.ok(e.from && e.to, 'every fixture flow resolves'); }
});

test('pointAlong walks spoke -> hub -> spoke', () => {
  const pts = [{ x: -100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 100 }];
  assert.deepEqual(pointAlong(pts, 0), { x: -100, y: 0 });
  assert.deepEqual(pointAlong(pts, 0.5), { x: 0, y: 0 });
  assert.deepEqual(pointAlong(pts, 0.75), { x: 0, y: 50 });
  assert.deepEqual(pointAlong(pts, 2), { x: 0, y: 100 });
});

test('candidate paths depend on funded depth', () => {
  const s = structuredClone(spokes.find((x) => x.eligibility.eligible && x.network === 'testnet'));
  const base = candidatePaths(s, spokes);
  assert.equal(base.blocked, null);
  assert.equal(base.paths[0].capacityXrp >= base.paths.at(-1).capacityXrp, true);
  s.market.depthXrp.bids.forEach((b) => { b.xrp = 0; });
  assert.match(candidatePaths(s, spokes).blocked, /No funded bids/);
  assert.match(candidatePaths({ ...s, status: 'UNAVAILABLE' }, spokes).blocked, /unavailable/);
  assert.match(candidatePaths({ ...s, eligibility: { eligible: false, checks: [{ id: 'min_depth', ok: false }] } }, spokes).blocked, /min_depth/);
  // never routes across networks or into blocked spokes
  for (const p of base.paths) if (p.to !== 'hub') { const o = spokes.find((x) => x.id === p.to); assert.equal(o.network, s.network); assert.notEqual(o.status, 'UNAVAILABLE'); }
});

test('capture, formatting and explorer helpers', () => {
  const c = captureOf([{ offerOwners: [{ role: 'titan' }, { role: 'rival' }, { role: 'titan' }, { role: 'weird' }] }]);
  assert.deepEqual(c.counts, { titan: 2, rival: 1, other: 1, amm: 0 });
  assert.equal(c.share.titan, 0.5);
  assert.equal(captureOf([]).total, 0);
  assert.equal(fmtAge(42), '42s'); assert.equal(fmtAge(420), '7m'); assert.equal(fmtAge(3720), '1h 2m');
  assert.equal(amountText({ value: '1250.5', currency: 'AURA' }), '1,250.5 AURA');
  assert.equal(amountText(null), '—');
  assert.ok(isHash(H)); assert.ok(!isHash('x'));
  assert.equal(explorerFor({ hash: H, network: 'mainnet' }), `https://livenet.xrpl.org/transactions/${H}`);
  assert.equal(explorerFor({ hash: H, network: 'testnet', explorer: 'javascript:alert(1)' }), `https://testnet.xrpl.org/transactions/${H}`);
  assert.equal(explorerFor({ hash: 'bad' }), null);
});

test('replay accepts the 85-spokes frames/tMs shape; placeholders validate', () => {
  const frames = [{ seq: 1, tMs: 3000, hash: 'B', kind: 'REPLAY' }, { seq: 0, tMs: 1200, hash: 'A', kind: 'REPLAY' }];
  const o = replayOrder({ mode: 'REPLAY', frames });
  assert.deepEqual(o.map((x) => x.rec.hash), ['A', 'B']);
  assert.equal(o[1].delay, 1800);
  const ph = { ...structuredClone(spokes[0]), id: 'placeholder:A:3', currency: null, currencyHex: null, issuer: null, rank: null };
  assert.deepEqual(validateSpoke(ph), []);
  assert.ok(validateSpoke({ ...ph, id: 'mainnet:X:r1' }).some((e) => /currency/.test(e)), 'only placeholders may lack identity');
});
