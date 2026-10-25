// Workstream G: GYW1313 navigation mapping, 3-minute pitch timeline determinism, XDLC spec doc whitelist.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV, resolveNav, entryFor, api } from '../public/shell.js';
import present, { CUES, DURATION, ERA, cueIndexAt, nextStart, prevStart, resolveTarget, crossed, validate, fmt } from '../public/modules/01-present.js';
import xdlc, { renderMarkdown, STATUS_TEXT } from '../public/modules/45-xdlc-protocol.js';
import { allowedDocs, isAllowedDoc, declaredDocs, normalizeName, DOC_PATTERN, MAX_DOCS, register } from '../lib/routes/46-xdlc-spec.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('nav: primary entries map to the agreed module ids', () => {
  const by = Object.fromEntries(NAV.map((n) => [n.key, n]));
  assert.equal(by.watch.modules[0], 'theater');
  assert.ok(by.explore.modules.includes('observatory') && by.explore.modules.includes('pathfinder'));
  assert.deepEqual(by.creatures.scenes, ['dolphin', 'shark', 'whale', 'kraken']);
  assert.equal(by.creatures.modules[0], 'theater');
  assert.equal(by.tglb.modules[0], 'incubator');
  assert.deepEqual(by.xdlc.modules.slice(0, 2), ['xdlc-protocol', 'xdlc-app']);
  assert.deepEqual(by['capital-move'].modules, ['redeploy']);
  assert.deepEqual(by.sentinel.modules, ['sentinel', 'findings']);
  assert.deepEqual(by.vendors.modules.slice(0, 2), ['vendors', 'merchant']);
  assert.deepEqual(by.products.modules, ['products']);
  assert.deepEqual(by.pitch.modules, ['present']);
  // Never TG-brand GYW1313 or XDLC in labels.
  for (const n of NAV) assert.ok(!/TG[\s-]*(GYW|XDLC)/i.test(n.label), n.label);
});

test('nav: unknown modules fall under MORE; missing modules degrade to "coming online"', () => {
  const ids = ['present', 'launch', 'view', 'observatory', 'incubator', 'sentinel', 'findings', 'x402', 'products', 'arena', 'brand-new'];
  const e = Object.fromEntries(resolveNav(ids).map((x) => [x.key, x]));
  assert.deepEqual(e.more.available, ['launch', 'arena', 'brand-new']);
  assert.equal(e['capital-move'].online, false);
  assert.deepEqual(e.watch.available, ['view']); // theater not built yet -> Titan View
  assert.deepEqual(e.xdlc.available, []); assert.equal(e.xdlc.online, false);
  // Every loaded id is reachable from at least one entry.
  for (const id of ids) assert.ok(Object.values(e).some((x) => x.available.includes(id)), id);
  // Active entry follows the shown module, keeping the current entry when it also offers it.
  const list = resolveNav(['theater', 'view', 'sentinel', 'launch']);
  assert.equal(entryFor('theater', 'creatures', list), 'creatures');
  assert.equal(entryFor('theater', 'sentinel', list), 'watch');
  assert.equal(entryFor('launch', null, list), 'more');
  assert.equal(entryFor('nope', null, list), 'more');
});

test('nav: every current module id is claimed by a primary entry or lands in MORE', () => {
  const ids = fs.readdirSync(path.join(ROOT, 'public/modules')).filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(ROOT, 'public/modules', f), 'utf8').match(/export default \{\s*id:\s*['"]([^'"]+)['"]/)?.[1]).filter(Boolean);
  assert.ok(ids.includes('present') && ids.includes('xdlc-protocol') && ids.includes('products'));
  const r = resolveNav(ids);
  for (const id of ids) assert.ok(r.some((x) => x.available.includes(id)), id);
});

test('api.badge: honest mode labels incl. HISTORICAL_MAINNET and PROPOSED', () => {
  assert.match(api.badge('HISTORICAL_MAINNET'), /badge hist/);
  assert.match(api.badge('PROPOSED'), /badge prop/);
  assert.match(api.badge('SIMULATION'), /badge sim/);
  assert.match(api.badge('WHATEVER'), /badge bad/);
});

test('present: module contract and timeline is contiguous, 3:00 long', () => {
  assert.equal(present.id, 'present'); assert.equal(present.order, 1); assert.equal(present.title, '▶ 3-Minute Pitch');
  assert.equal(DURATION, 180);
  assert.deepEqual(validate(), []);
  assert.deepEqual(validate([{ start: 0, end: 10, show: 'x', scene: 'y', caption: 'c', say: 's', era: 'pre' }]), ['last cue must end at 180']);
});

test('present: segment boundaries match the brief', () => {
  const at = (t) => CUES[cueIndexAt(t)];
  assert.deepEqual([at(0).show, at(0).scene], ['theater', 'evidence']);
  assert.deepEqual([at(29.9).scene, at(30).scene], ['evidence', 'fills']);
  assert.deepEqual(CUES.filter((c) => c.start >= 30 && c.end <= 60).map((c) => c.scene), ['fills', 'dolphin', 'shark', 'whale', 'kraken']);
  assert.deepEqual([at(60).show, at(60).scene], ['xdlc-app', 'radar']);
  assert.deepEqual([at(94).show, at(94).scene], ['incubator', 'tglb']);
  assert.deepEqual([at(95).show, at(129).scene], ['xdlc-app', 'lifecycle']);
  assert.deepEqual([at(130).show, at(130).scene], ['sentinel', 'sentinel']);
  assert.deepEqual([at(150).show, at(150).scene], ['redeploy', 'redeploy']);
  assert.equal(at(160).show, 'xdlc-protocol');
  assert.deepEqual([at(170).show, at(170).scene], ['vendors', 'vendors']);
  assert.equal(at(179.9).show, 'products'); assert.equal(at(500).show, 'products');
  assert.equal(at(-5).scene, 'evidence');
});

test('present: deterministic navigation (skip/prev/crossed) and honest labels', () => {
  const run = () => { const seq = []; let t = 0; while (t < DURATION) { seq.push(cueIndexAt(t)); t = nextStart(t); } return seq; };
  assert.deepEqual(run(), CUES.map((_, i) => i));
  assert.deepEqual(run(), run());
  assert.equal(prevStart(100), 95); assert.equal(prevStart(96), 80); assert.equal(prevStart(1), 0);
  assert.deepEqual(crossed(0, 180), CUES.map((_, i) => i));
  assert.deepEqual(crossed(31, 47), [1, 2, 3]);
  assert.equal(fmt(95), '01:35'); assert.equal(fmt(180), '03:00');
  const allowed = new Set(['SIMULATION', 'LIVE_TESTNET', 'MAINNET_OBSERVED', 'HISTORICAL_MAINNET', 'PROPOSED']);
  for (const c of CUES) for (const m of c.modes) assert.ok(allowed.has(m), m);
  // Pre-hackathon vs new is stated: evidence is pre-hackathon; XDLC/radar/TGLB/Sentinel/vendors are new.
  assert.notEqual(CUES[0].era, 'new'); assert.ok(ERA.pre && ERA.new);
  for (const s of ['radar', 'tglb', 'lifecycle', 'sentinel', 'protocol', 'vendors']) assert.equal(CUES.find((c) => c.scene === s).era, 'new', s);
  assert.match(CUES.find((c) => c.scene === 'protocol').caption, /not submitted, not reviewed, not implemented in xrpld, not activated/);
  assert.match(CUES[0].caption, /before the hackathon/);
  // Fallbacks keep the show going when another workstream's tab isn't present.
  assert.equal(resolveTarget(CUES[0], (id) => id === 'view'), 'view');
  assert.equal(resolveTarget(CUES[0], () => false), null);
  assert.equal(resolveTarget(CUES[0], () => true), 'theater');
});

test('xdlc-protocol: module contract, honest status, safe markdown', () => {
  assert.equal(xdlc.id, 'xdlc-protocol'); assert.equal(xdlc.order, 45); assert.equal(xdlc.title, 'XDLC Protocol');
  assert.equal(STATUS_TEXT, 'Draft — not submitted, not reviewed, not implemented in xrpld, not activated');
  const h = renderMarkdown('# Title\n\nText with `code` and **bold** <script>x</script>\n\n- a\n- b\n\n1. one\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```\n<b>raw</b>\n```\n\n[bad](javascript:alert(1)) [ok](https://xrpl.org)');
  assert.match(h, /<h2 class="xp-h">Title<\/h2>/);
  assert.match(h, /<code>code<\/code>/); assert.match(h, /<strong>bold<\/strong>/);
  assert.ok(!h.includes('<script>')); assert.match(h, /&lt;script&gt;/);
  assert.match(h, /<ul><li>a<\/li><li>b<\/li><\/ul>/); assert.match(h, /<ol><li>one<\/li><\/ol>/);
  assert.match(h, /<th>A<\/th><th>B<\/th>/); assert.match(h, /<td>1<\/td><td>2<\/td>/);
  assert.match(h, /&lt;b&gt;raw&lt;\/b&gt;/);
  assert.ok(!/javascript:/i.test(h.replace(/&[a-z]+;/g, ''))); assert.match(h, /href="https:\/\/xrpl.org"/);
});

test('xdlc-spec route: only up to four whitelisted docs/XDLC_*.md files', () => {
  const present = ['XDLC_AMENDMENT_PROPOSAL.md', 'XDLC_PROTOCOL_GAP_ANALYSIS.md', 'XDLC_SECURITY_INVARIANTS.md', 'XDLC_DETERMINISTIC_TESTS.md', 'XDLC_EXTRA.md', 'README.md', 'xdlc_lower.md'];
  const allowed = allowedDocs({ summary: null, present });
  assert.equal(allowed.length, MAX_DOCS);
  assert.ok(allowed.every((n) => DOC_PATTERN.test(n)));
  assert.ok(!allowed.includes('XDLC_EXTRA.md'));
  // Summary-declared docs win (validated), unknown/bad declarations ignored.
  const a2 = allowedDocs({ summary: { docs: ['docs/XDLC_EXTRA.md', { file: '../../etc/passwd' }, 'XDLC_NOPE.md'] }, present });
  assert.equal(a2[0], 'XDLC_EXTRA.md'); assert.equal(a2.length, 4);
  assert.deepEqual(declaredDocs({ docs: ['../x.md', 'XDLC_A.md', { name: 'XDLC_B.md' }] }), ['x.md', 'XDLC_A.md', 'XDLC_B.md'].filter((n) => DOC_PATTERN.test(n)));
  for (const bad of ['../package.json', '..%2Fpackage.json', 'XDLC_A.md/../../x', 'XDLC_EXTRA.md', 'README', '/etc/passwd', '', 'XDLC_AMENDMENT_PROPOSAL.md\0', 'xdlc_amendment_proposal.md'])
    assert.equal(isAllowedDoc(bad, allowed), false, bad);
  assert.equal(isAllowedDoc('XDLC_SECURITY_INVARIANTS', allowed), true);
  assert.deepEqual(allowed, ['XDLC_AMENDMENT_PROPOSAL.md', 'XDLC_PROTOCOL_GAP_ANALYSIS.md', 'XDLC_SECURITY_INVARIANTS.md', 'XDLC_DETERMINISTIC_TESTS.md']);
  assert.equal(normalizeName('XDLC_X'), 'XDLC_X.md');
  assert.deepEqual(allowedDocs({ summary: null, present: [] }), []);
});

test('xdlc-spec route: handlers serve summary JSON and refuse non-whitelisted names', async () => {
  const routes = {};
  const app = { get: (p, h) => { routes[p] = h; }, post: () => {} };
  const out = [];
  const json = (res, code, body) => out.push({ code, body });
  register(app, { json });
  assert.ok(routes['/api/xdlc-spec/summary'] && routes['/api/xdlc-spec/doc/:name']);
  routes['/api/xdlc-spec/summary']({}, {});
  const s = out.pop();
  assert.equal(s.code, 200); assert.equal(s.body.status.activated, false); assert.equal(s.body.status.submitted, false);
  assert.ok(s.body.docs.length <= MAX_DOCS);
  for (const name of ['../package.json', 'CONTRACT.md', 'XDLC_DOES_NOT_EXIST.md']) {
    routes['/api/xdlc-spec/doc/:name']({}, {}, { name });
    assert.equal(out.pop().code, 404, name);
  }
  // A whitelisted doc (if Workstream C has written any) is served as text.
  if (s.body.docs[0]) {
    let head = null, text = '';
    routes['/api/xdlc-spec/doc/:name']({}, { writeHead: (c, h) => { head = { c, h }; }, end: (t) => { text = t; } }, { name: s.body.docs[0].name });
    assert.equal(head.c, 200); assert.match(head.h['Content-Type'], /text\/markdown/); assert.ok(text.length > 0);
  }
});

test('xdlc-spec route: allowedDocs reads a real directory listing only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-xdlc-'));
  for (const f of ['XDLC_ONE.md', 'notes.txt', 'XDLC_two.md']) fs.writeFileSync(path.join(dir, f), '# x');
  const present = fs.readdirSync(dir);
  assert.deepEqual(allowedDocs({ summary: null, present }), ['XDLC_ONE.md']);
  fs.rmSync(dir, { recursive: true, force: true });
});
