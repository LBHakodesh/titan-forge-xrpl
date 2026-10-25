// TG Products registry API (read-only). Naming + alias matrix for Commander review.
//   GET /api/products            ?status=APPROVED|PROPOSED|EXCLUDED &category=…
//   GET /api/products/matrix     naming + alias matrix, domains, reconciliation, review notes, decisions
//   GET /api/products/:acronym   case-insensitive; resolves names and aliases
// Nothing here signs, submits, purchases or calls a registrar. Registry data is descriptive (no mode badge needed),
// each entry's operational status is derived from the code on this node.
import { buildRegistry, listProducts, matrix, resolve, ecosystemCount, scanRoutes, scanTabs, DOMAINS, RECONCILIATION, REVIEW_NOTES, DECISIONS, TRADEMARK_NOTE, APPROVAL } from '../products/index.mjs';
import { getEngine } from '../engine/index.mjs';

export function register(app, ctx) {
  const { json, store } = ctx;
  // Is the namespace registered in this running process? (Our file loads early, so check at request time.)
  const isLoaded = (ns) => app.routes.some((r) => { const s = r.re.source.replace(/\\\//g, '/'); return s.startsWith(`^${ns}/`) || s === `^${ns}$`; });
  let cache = null;
  const registry = () => {
    // Re-scan at most every 30 s so routes added by other modules (e.g. /api/tgan) show up without guessing.
    if (!cache || Date.now() - cache.at > 30_000) cache = { at: Date.now(), routes: scanRoutes(), tabs: scanTabs() };
    const reg = buildRegistry({ routes: cache.routes, tabs: cache.tabs, isLoaded, store });
    const engine = getEngine().info();
    for (const r of reg) if (r.operational.status === 'DEMO_ADAPTER') r.operational.engineLabel = engine.label;
    return reg;
  };

  app.get('/api/products', (req, res, params, body, url) => {
    const status = url?.searchParams.get('status') || '', category = url?.searchParams.get('category') || '';
    if (status && !APPROVAL.includes(status.toUpperCase())) return json(res, 400, { error: `status must be one of ${APPROVAL.join(', ')}` });
    const all = registry();
    const products = listProducts(all, { status, category });
    json(res, 200, {
      products, total: products.length, filters: { status: status || null, category: category || null },
      categories: [...new Set(all.map((p) => p.category))],
      count: ecosystemCount(), reconciliation: RECONCILIATION, reviewNotes: REVIEW_NOTES, decisions: DECISIONS,
      domains: DOMAINS, trademark: TRADEMARK_NOTE, readOnly: true,
    });
  });

  app.get('/api/products/matrix', (req, res) => json(res, 200, { ...matrix(), readOnly: true }));

  app.get('/api/products/:acronym', (req, res, { acronym }) => {
    const r = resolve(acronym);
    if (!r.found) return json(res, r.ambiguous ? 409 : 404, { error: r.reason, ambiguous: !!r.ambiguous, candidates: r.candidates || [] });
    const product = registry().find((p) => (p.acronym || p.name) === r.id);
    json(res, 200, { product, resolvedVia: r.via, query: acronym, readOnly: true });
  });
}
