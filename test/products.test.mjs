// TG product registry: acronym uniqueness, alias resolution, exclusions, namespace honesty, domain rules, count pinning.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTRIES, DOMAINS, RECONCILIATION, ESTABLISHED_CLAIM, AMBIGUOUS_ALIASES, OPS, APPROVAL, buildRegistry, aliasIndex, resolve, ecosystemCount, matrix, listProducts, scanRoutes, scanTabs, norm } from '../lib/products/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TG = ENTRIES.filter((x) => x.approval !== 'EXCLUDED');

test('every APPROVED/PROPOSED entry has a unique TG acronym', () => {
  const acrs = TG.map((x) => x.acronym);
  for (const a of acrs) assert.match(a, /^TG[A-Z]*$/, `${a} must start with TG`);
  assert.equal(new Set(acrs).size, acrs.length, 'duplicate acronym');
  for (const x of ENTRIES) assert.ok(APPROVAL.includes(x.approval), x.name);
});

test('Commander naming: approved and proposed sets are exactly as directed', () => {
  const by = (s) => ENTRIES.filter((x) => x.approval === s).map((x) => x.acronym).sort();
  assert.deepEqual(by('APPROVED'), ['TG', 'TGAN', 'TGAR', 'TGLB', 'TGLW']);
  assert.deepEqual(by('PROPOSED'), ['TGAT', 'TGDP', 'TGG', 'TGI', 'TGM', 'TGPA', 'TGS', 'TGSEO', 'TGT', 'TGV']);
  const names = Object.fromEntries(TG.map((x) => [x.acronym, x.name]));
  assert.equal(names.TGLW, 'Titan Ghost Liquidity Wake');
  assert.equal(names.TGLB, 'Titan Ghost Liquidity Bootstrap');
  assert.equal(names.TGAN, 'Titan Ghost Advisory Network');
});

test('EXCLUDED brands never get a TG acronym or TG name', () => {
  const ex = ENTRIES.filter((x) => x.approval === 'EXCLUDED');
  for (const n of ['GYW1313', 'XDLC', '1313VERSE', 'Brooklyn Bullies', 'KINSMER', 'BDIU']) assert.ok(ex.some((x) => x.name === n), `${n} excluded`);
  for (const x of ex) {
    assert.equal(x.acronym, null, `${x.name} must have no acronym`);
    assert.ok(![x.name, x.formalName, ...x.aliases].some((s) => /^TG|Titan Ghost/i.test(s)), `${x.name} carries TG branding`);
    assert.ok(!x.domain || !x.domain.startsWith('tg-'), `${x.name} has a tg- domain`);
  }
  // No excluded alias resolves to a TG product.
  for (const x of ex) for (const a of [x.name, ...x.aliases]) { const r = resolve(a); if (r.found) assert.equal(r.entry.acronym, null, a); }
});

test('alias resolution: case-insensitive acronyms, names and existing aliases', () => {
  const cases = { tglw: 'TGLW', 'Titan Sentinel': 'TGS', SENTINEL: 'TGS', 'Titan Merchant': 'TGM', 'wake intelligence': 'TGI', 'Titan Advisory Network': 'TGAN', 'titan ghost': 'TG', 'Titan View': 'TGV', 'titan-arena': 'TGAR', 'Liquidity Bootstrap': 'TGLB', xdlc: 'XDLC', bbl: 'Brooklyn Bullies' };
  for (const [q, id] of Object.entries(cases)) { const r = resolve(q); assert.ok(r.found, q); assert.equal(r.id, id, q); }
  assert.equal(resolve('tgs').via, 'acronym');
  assert.equal(resolve('titan sentinel').via, 'alias');
  assert.equal(resolve('nope-product').found, false);
  assert.equal(resolve('').found, false);
});

test('ambiguous aliases never resolve, and no alias key maps to two products', () => {
  const w = resolve('Wake');
  assert.equal(w.found, false); assert.equal(w.ambiguous, true); assert.deepEqual(w.candidates.sort(), ['TGI', 'TGLW']);
  assert.deepEqual(aliasIndex().clashes, [], 'alias clash between entries');
  const seen = new Map();
  for (const x of ENTRIES) for (const k of new Set([x.acronym, x.name, x.formalName, ...x.aliases].filter(Boolean).map(norm))) {
    if (AMBIGUOUS_ALIASES.some((a) => norm(a.alias) === k)) continue;
    assert.ok(!seen.has(k) || seen.get(k) === x, `alias ${k} used twice`); seen.set(k, x);
  }
  // A clash injected into a copy is detected and dropped rather than resolved arbitrarily.
  const dup = [...ENTRIES, { ...ENTRIES[4], acronym: 'TGX', name: 'Dup', formalName: 'Dup', aliases: ['Titan Sentinel'] }];
  assert.ok(aliasIndex(dup).clashes.some((c) => c.key === 'titansentinel'));
  assert.equal(resolve('Titan Sentinel', dup).found, false);
});

test('API namespaces exist in lib/routes or are marked not built', () => {
  const routes = scanRoutes();
  const src = fs.readdirSync(path.join(ROOT, 'lib/routes')).map((f) => fs.readFileSync(path.join(ROOT, 'lib/routes', f), 'utf8')).join('\n');
  for (const p of buildRegistry({ routes })) {
    for (const n of p.apiNamespaces) {
      if (n.status === 'exists') { assert.ok(routes.has(n.namespace), n.namespace); assert.ok(src.includes(`'${n.namespace}`) || src.includes(`\`${n.namespace}`), `${n.namespace} not in route source`); }
      else assert.equal(n.status, 'not built');
    }
    for (const c of p.capabilities) assert.ok(src.includes(c.path), `capability ${c.path} not in route source`);
    assert.ok(OPS.includes(p.operational.status), `${p.name} ops ${p.operational.status}`);
  }
  // Known existing namespaces are detected; our own namespace too.
  for (const ns of ['/api/sentinel', '/api/findings', '/api/x402', '/api/access', '/api/spokes', '/api/pathfinder', '/api/products']) assert.ok(routes.has(ns), ns);
});

test('operational status is derived: missing routes => NOT_BUILT; live signing endpoints flagged', () => {
  const empty = buildRegistry({ routes: new Map(), tabs: new Map() });
  const by = Object.fromEntries(empty.map((p) => [p.acronym || p.name, p]));
  assert.equal(by.TGAN.operational.status, 'NOT_BUILT');
  assert.equal(by.TGS.operational.status, 'NOT_BUILT');
  assert.equal(by.TGS.websiteRoute.status, 'not built');
  // With a fake /api/tgan route the declared status applies.
  const withTgan = buildRegistry({ routes: new Map([['/api/tgan', { files: new Set(['87-tgan.mjs']), endpoints: [{ method: 'GET', path: '/api/tgan', file: '87-tgan.mjs' }] }]]), tabs: new Map() });
  assert.equal(withTgan.find((p) => p.acronym === 'TGAN').operational.status, 'SIMULATION');
  const tgt = buildRegistry().find((p) => p.acronym === 'TGT');
  assert.match(tgt.capabilities.find((c) => c.method === 'POST' && c.path === '/api/launch').use, /never call from automated agents/);
  // Brooklyn Bullies: LIVE_TESTNET only when its demo token is live in the store.
  const bb = (store) => buildRegistry({ store }).find((p) => p.name === 'Brooklyn Bullies').operational.status;
  assert.equal(bb({ byCode: (c) => (c === 'BBL' ? { status: 'live' } : null) }), 'LIVE_TESTNET');
  assert.equal(bb({ byCode: () => null }), 'NOT_CONNECTED');
});

test('website routes point at existing tab ids or say not built', () => {
  const tabs = scanTabs();
  assert.equal(tabs.get('products')?.order, 99);
  for (const p of buildRegistry({ tabs })) if (p.websiteRoute.status === 'exists') assert.ok(tabs.has(p.websiteRoute.id));
});

test('domains: tg-<name>.com format, never purchased, snapshot labeled, six priorities', () => {
  for (const d of DOMAINS) {
    assert.equal(d.purchased, false, d.domain);
    assert.equal(d.verifiedGoDaddy, false, d.domain);
    if (d.platform) { assert.equal(d.domain, 'gyw1313.com'); continue; }
    assert.match(d.domain, /^tg-[a-z0-9]+\.com$/, d.domain);
    if (d.availability === 'REPORTED_AVAILABLE') assert.match(d.label, /Namecheap snapshot.*2026-10-24.*not verified at GoDaddy.*NOT purchased/);
    assert.doesNotMatch(d.label, /(?<!NOT )\b(purchased|registered|owned|reserved)\b/, `${d.domain} label implies ownership`);
  }
  assert.deepEqual(DOMAINS.filter((d) => d.priority).map((d) => d.domain).sort(), ['tg-advisorynetwork.com', 'tg-liquiditybootstrap.com', 'tg-liquiditywake.com', 'tg-marketmaker.com', 'tg-merchant.com', 'tg-sentinel.com']);
  for (const d of ['tg-seo.com', 'tg-advisory.com']) assert.equal(DOMAINS.find((x) => x.domain === d).availability, 'REPORTED_UNAVAILABLE');
  assert.equal(DOMAINS.filter((d) => d.availability === 'REPORTED_AVAILABLE').length, 18);
  // Every TG entry's domain is a listed candidate.
  for (const x of TG) assert.ok(DOMAINS.some((d) => d.domain === x.domain && d.acronym === x.acronym), x.acronym);
});

test('ecosystem count: established 16 + Commander-added TGAN = 17; other new entries never auto-increment it', () => {
  const c = ecosystemCount();
  assert.equal(c.established, 16);
  assert.equal(c.total, 17);
  assert.deepEqual(c.commanderAdded, ['TGAN']);
  assert.equal(c.verified, false, 'no enumerated list was found');
  assert.deepEqual(c.newNotCounted, []);
  const more = [...ENTRIES, { ...ENTRIES[3], acronym: 'TGZZ', name: 'Extra', newProduct: true }];
  assert.equal(ecosystemCount(more).established, 16);
  assert.equal(ecosystemCount(more).total, 17);
  assert.deepEqual(ecosystemCount(more).newNotCounted, ['TGZZ']);
  assert.notEqual(ecosystemCount().established, TG.length);
  assert.equal(ESTABLISHED_CLAIM.enumeratedListFound, false);
  assert.equal(RECONCILIATION.verdict, 'NOT_RECONCILED');
  assert.ok(RECONCILIATION.found.length < 16, 'never pad the found list to 16');
  assert.ok(!RECONCILIATION.found.some((f) => f.acronym === 'TGAN'), 'TGAN is new, not part of the established catalog');
});

test('matrix and filters', () => {
  const m = matrix();
  assert.equal(m.rows.length, ENTRIES.length);
  assert.ok(m.reviewNotes.some((n) => n.acronyms.includes('TGAR') && n.acronyms.includes('TGAN') && n.acronyms.includes('TGAT')));
  assert.ok(m.reviewNotes.some((n) => n.acronyms.includes('TGT')));
  assert.ok(m.reviewNotes.some((n) => n.acronyms.includes('TGS')));
  assert.ok(m.decisions.length >= 3);
  const reg = buildRegistry();
  assert.equal(listProducts(reg, { status: 'approved' }).length, 5);
  assert.equal(listProducts(reg, { status: 'EXCLUDED' }).every((p) => p.acronym === null), true);
  assert.ok(listProducts(reg, { category: 'security-risk' }).every((p) => p.category === 'security-risk'));
});

test('TGAR replaces TGA: no acronym is a strict prefix of another, and "TGA" does not resolve', () => {
  const acrs = TG.map((x) => x.acronym);
  assert.ok(!acrs.includes('TGA'));
  for (const a of ['TGAR', 'TGAN', 'TGAT']) for (const b of ['TGAR', 'TGAN', 'TGAT']) if (a !== b) assert.ok(!b.startsWith(a));
  assert.equal(resolve('TGA').found, false);
  assert.equal(resolve('Titan Arena').entry.acronym, 'TGAR');
});
