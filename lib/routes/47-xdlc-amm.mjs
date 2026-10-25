// XDLC corridor vs XRPL AMM simulation (namespace /api/xdlc-amm). Pure compute, read-only.
//   GET /api/xdlc-amm/reference[?refresh=1]   Mainnet XRP/RLUSD AMM pool (MAINNET_OBSERVED, read-only) or labeled fallback
//   GET /api/xdlc-amm/simulate?size=&improvementBps=&side=&scenario=&seed=&jumpPct=&pauseBps=&exitDay=&exitFeeBps=
//   GET /api/xdlc-amm/scenarios
// XDLC is a PROPOSED XRPL amendment (draft). Everything computed is SIMULATION; nothing signs, submits or fills anywhere.
// The only network access is the read-only amm_info call inside lib/xdlc-amm/reference.mjs (MainnetObserver).
import { simulate, SCENARIOS, DEFAULT_PROVIDERS, PROVIDER_KINDS, MIN_IMPROVEMENT_BPS, MAX_IMPROVEMENT_BPS, MODEL_VERSION } from '../xdlc-amm/model.mjs';
import { createReferenceService } from '../xdlc-amm/reference.mjs';

const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? Math.min(hi, Math.max(lo, n)) : d; };

export function parseParams(q) {
  const g = (k) => q.get(k);
  return {
    sizeUsd: num(g('size'), 10000, 50, 250000),
    improvementBps: num(g('improvementBps'), 1, MIN_IMPROVEMENT_BPS, MAX_IMPROVEMENT_BPS),
    side: g('side') === 'sell' ? 'sell' : 'buy',
    scenario: SCENARIOS.some((s) => s.id === g('scenario')) ? g('scenario') : 'single',
    seed: /^[\w-]{1,32}$/.test(g('seed') || '') ? g('seed') : 1313,
    jumpPct: num(g('jumpPct'), 3, -15, 15) || 3,
    pauseBps: num(g('pauseBps'), 50, 5, 1000),
    exitDay: num(g('exitDay'), 45, 0, 90),
    exitFeeBps: num(g('exitFeeBps'), 200, 0, 1000),
  };
}

export function register(app, ctx) {
  const ref = ctx.xdlcAmmReference || createReferenceService({ offline: !!ctx.offline });
  const { json } = ctx;

  app.get('/api/xdlc-amm/reference', async (req, res, params, body, url) => {
    const r = await ref.get({ refresh: url.searchParams.get('refresh') === '1' });
    json(res, 200, { ...r, readOnly: true, status: { label: 'PROPOSED', text: 'XDLC: proposed XRPL amendment (draft)' } });
  });

  app.get('/api/xdlc-amm/scenarios', (req, res) => {
    json(res, 200, { mode: 'SIMULATION', model: MODEL_VERSION, scenarios: SCENARIOS, providers: DEFAULT_PROVIDERS, kinds: PROVIDER_KINDS,
      improvementBps: { min: MIN_IMPROVEMENT_BPS, max: MAX_IMPROVEMENT_BPS, default: 1 }, sizeUsd: { min: 50, max: 250000, default: 10000 } });
  });

  app.get('/api/xdlc-amm/simulate', async (req, res, params, body, url) => {
    const p = parseParams(url.searchParams);
    const r = await ref.get();
    const out = simulate(r, p);
    out.reference = { mode: r.mode, label: r.label, freshness: r.freshness, source: r.source, observedAt: r.observedAt, ledgerIndex: r.ledgerIndex, ammAccount: r.ammAccount ?? null, note: r.note ?? null, pool: r.pool };
    json(res, 200, out);
  });
}
