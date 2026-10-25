// TG product registry logic: verifies tabs and /api namespaces against the code, resolves aliases,
// builds the naming/alias matrix and keeps the ecosystem count pinned to the reconciled catalog.
// Pure apart from reading lib/routes and public/modules source text (read-only).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTRIES, DOMAINS, RECONCILIATION, REVIEW_NOTES, DECISIONS, AMBIGUOUS_ALIASES, ESTABLISHED_CLAIM, TRADEMARK_NOTE, APPROVAL, OPS } from './catalog.mjs';

export { ENTRIES, DOMAINS, RECONCILIATION, REVIEW_NOTES, DECISIONS, AMBIGUOUS_ALIASES, ESTABLISHED_CLAIM, TRADEMARK_NOTE, APPROVAL, OPS };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const ROUTE_DIR = path.join(ROOT, 'lib/routes');
export const MODULE_DIR = path.join(ROOT, 'public/modules');

// Endpoints that sign on the live Testnet ledger: never for automated agents (mirrors scripts/browser-check.mjs).
const LIVE_SIGNING = new Set(['POST /api/launch', 'POST /api/pathfinder/run', 'POST /api/x402/live/purchase']);

export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
export const nsOf = (p) => (String(p).match(/^\/api\/[^/:]+/) || [null])[0];

// Scan lib/routes/*.mjs source for app.get/post('/api/...') patterns. Returns Map(namespace -> {files, endpoints}).
export function scanRoutes(dir = ROUTE_DIR) {
  const out = new Map();
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort(); } catch { return out; }
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/app\.(get|post)\(\s*['"`](\/api\/[^'"`]+)['"`]/g)) {
      const ns = nsOf(m[2]);
      if (!ns) continue;
      if (!out.has(ns)) out.set(ns, { files: new Set(), endpoints: [] });
      const e = out.get(ns);
      e.files.add(f);
      e.endpoints.push({ method: m[1].toUpperCase(), path: m[2], file: f });
    }
  }
  return out;
}

// Scan public/modules/*.js for `export default { id: '…', title: '…', order: N`.
export function scanTabs(dir = MODULE_DIR) {
  const out = new Map();
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort(); } catch { return out; }
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const m = src.match(/export default \{\s*id:\s*['"]([^'"]+)['"],\s*title:\s*['"]([^'"]+)['"],\s*order:\s*(\d+)/);
    if (m) out.set(m[1], { id: m[1], title: m[2], order: Number(m[3]), file: `public/modules/${f}` });
  }
  return out;
}

const capability = (e) => {
  const key = `${e.method} ${e.path}`;
  const use = LIVE_SIGNING.has(key) ? 'live-signing: never call from automated agents' : e.method === 'GET' ? 'read-only' : 'operator / simulation action (see owning module)';
  return { method: e.method, path: e.path, use, file: `lib/routes/${e.file}` };
};

// Build the resolved registry. `routes`/`tabs` default to scanning the repo; `isLoaded(ns)` (optional) reports whether the
// running server registered the namespace; `store` (optional) lets live demo tokens (e.g. BBL) be checked.
export function buildRegistry({ routes = scanRoutes(), tabs = scanTabs(), isLoaded = null, store = null, entries = ENTRIES } = {}) {
  return entries.map((x) => {
    const namespaces = x.namespaces.map((ns) => {
      const r = routes.get(ns);
      const loaded = isLoaded ? isLoaded(ns) : null;
      return r
        ? { namespace: ns, status: 'exists', files: [...r.files].map((f) => `lib/routes/${f}`), ...(loaded === false ? { loaded: false, note: 'route file present but not registered in this process (restart needed or skipped)' } : {}) }
        : { namespace: ns, status: 'not built' };
    });
    const capabilities = x.namespaces.flatMap((ns) => (routes.get(ns)?.endpoints || []).map(capability));
    const t = x.tab ? tabs.get(x.tab) : null;
    const tab = t ? { id: t.id, title: t.title, file: t.file, status: 'exists' } : { id: x.tab || null, status: 'not built' };

    let ops = { ...x.ops };
    // Derived, not wished: a product whose every API namespace is missing has nothing running here.
    if (x.namespaces.length && namespaces.every((n) => n.status === 'not built')) ops = { status: 'NOT_BUILT', basis: `No lib/routes file serves ${x.namespaces.join(', ')} yet. ${x.ops.basis}` };
    if (x.liveTokenCode && store?.byCode) {
      const l = store.byCode(x.liveTokenCode);
      if (l?.status === 'live') ops = { status: 'LIVE_TESTNET', basis: `Demo token ${x.liveTokenCode} is live on XRPL Testnet (launched via Titan Forge; demo account, organic:false). The brand itself is not a TG product.` };
    }
    const domain = x.domain ? DOMAINS.find((d) => d.domain === x.domain) || null : null;
    return {
      acronym: x.acronym, name: x.name, formalName: x.formalName, approval: x.approval, category: x.category,
      aliases: x.aliases, ...(x.components ? { components: x.components } : {}),
      newProduct: !!x.newProduct,
      websiteRoute: tab, apiNamespaces: namespaces.length ? namespaces : [{ namespace: null, status: 'not built' }],
      capabilities, commercial: x.commercial, dependencies: x.dependencies,
      operational: ops, sources: x.sources,
      candidateDomain: domain ? { domain: domain.domain, label: domain.label, priority: domain.priority, purchased: false } : x.domain ? { domain: x.domain } : null,
    };
  });
}

// Alias index: normalized key -> acronym-or-name. Acronyms, names, formal names and aliases all resolve.
// A key claimed by two entries is dropped (ambiguous) and reported; AMBIGUOUS_ALIASES are never resolvable.
export function aliasIndex(entries = ENTRIES) {
  const map = new Map(), clash = new Map();
  const blocked = new Set(AMBIGUOUS_ALIASES.map((a) => norm(a.alias)));
  const idOf = (x) => x.acronym || x.name;
  for (const x of entries) {
    const keys = new Set([x.acronym, x.name, x.formalName, ...x.aliases].filter(Boolean).map(norm).filter(Boolean));
    for (const k of keys) {
      if (blocked.has(k)) continue;
      if (map.has(k) && map.get(k) !== idOf(x)) { clash.set(k, [...(clash.get(k) || [map.get(k)]), idOf(x)]); continue; }
      map.set(k, idOf(x));
    }
  }
  for (const k of clash.keys()) map.delete(k);
  return { map, clashes: [...clash].map(([key, ids]) => ({ key, ids })) };
}

export function resolve(query, entries = ENTRIES) {
  const k = norm(query);
  if (!k) return { found: false, reason: 'empty query' };
  const amb = AMBIGUOUS_ALIASES.find((a) => norm(a.alias) === k);
  if (amb) return { found: false, ambiguous: true, candidates: amb.candidates, reason: amb.why };
  const id = aliasIndex(entries).map.get(k);
  if (!id) return { found: false, reason: `No product, acronym or alias matches "${query}".` };
  const entry = entries.find((x) => (x.acronym || x.name) === id);
  const via = norm(entry.acronym) === k ? 'acronym' : norm(entry.name) === k || norm(entry.formalName) === k ? 'name' : 'alias';
  return { found: true, id, via, entry };
}

// The ecosystem count is the Commander's catalog figure plus products the Commander explicitly added. It is NEVER
// derived from the registry length: a new or proposed entry only counts once it is named in claim.commanderAdded.
export function ecosystemCount(entries = ENTRIES, claim = ESTABLISHED_CLAIM) {
  const tg = entries.filter((x) => x.approval !== 'EXCLUDED');
  const added = claim.commanderAdded || [];
  const newOnes = entries.filter((x) => x.newProduct).map((x) => x.acronym);
  const counted = newOnes.filter((a) => added.includes(a));
  const notCounted = newOnes.filter((a) => !added.includes(a));
  const total = claim.count + counted.length;
  return {
    established: claim.count,
    total,
    verified: claim.enumeratedListFound === true,
    source: claim.source,
    commanderAdded: counted,
    newNotCounted: notCounted,
    registryEntries: entries.length,
    tgEntries: tg.length,
    note: `${total} products: the Commander's established ${claim.count} (${claim.enumeratedListFound ? 'reconciled' : 'NOT reconciled: no enumerated list found'})${counted.length ? ` + ${counted.join(', ')} (added by Commander decision)` : ''}.${notCounted.length ? ` ${notCounted.join(', ')} approved but not counted; the Commander decides.` : ''}`,
  };
}

export function matrix(entries = ENTRIES) {
  const { clashes } = aliasIndex(entries);
  return {
    standard: 'TG = Titan Ghost: prefix for proprietary fintech products where appropriate. Full name formally; acronym in dashboards, APIs and telemetry. Existing routes, tab ids, files and API identifiers are NOT renamed.',
    rows: entries.map((x) => ({ acronym: x.acronym, name: x.name, approval: x.approval, aliases: x.aliases, components: x.components || [], domain: x.domain || null })),
    ambiguousAliases: AMBIGUOUS_ALIASES,
    aliasClashes: clashes,
    reviewNotes: REVIEW_NOTES,
    domains: DOMAINS,
    trademark: TRADEMARK_NOTE,
    reconciliation: RECONCILIATION,
    count: ecosystemCount(entries),
    decisions: DECISIONS,
  };
}

export function listProducts(registry, { status, category } = {}) {
  const st = status ? String(status).toUpperCase() : null;
  const cat = category ? String(category).toLowerCase() : null;
  return registry.filter((r) => (!st || r.approval === st) && (!cat || r.category === cat));
}
