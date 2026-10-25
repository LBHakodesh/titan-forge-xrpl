// Titan Sentinel routes: read-only security reports for launched tokens + a SIMULATION exercise.
import { Sentinel, EXERCISE, guardianDemo } from '../sentinel.mjs';
import { SENTINEL_STATEMENT } from '../findings/universal.mjs';

export function register(app, ctx) {
  const { json } = ctx;
  const sentinel = new Sentinel(ctx);

  // Registered before /:code so the literal path wins.
  // TG Sentinel universal observability (read-only projections of the findings registry owned by 55-findings).
  const svc = (res) => { if (ctx.findings) return ctx.findings; json(res, 503, { error: 'Findings registry not loaded on this node.', statement: SENTINEL_STATEMENT }); return null; };
  app.get('/api/sentinel/coverage', (req, res) => { const s = svc(res); if (s) json(res, 200, s.coverage()); });
  app.get('/api/sentinel/audit', (req, res, p, b, url) => {
    const s = svc(res); if (!s) return;
    const kind = ['all', 'status', 'changes'].includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : 'changes';
    json(res, 200, { statement: SENTINEL_STATEMENT, ...s.audit({ kind, limit: Number(url.searchParams.get('limit')) || 100, subsystem: url.searchParams.get('subsystem') || null }), note: 'Entries come from the append-only SHA-256 hash-chained registry history (GET /api/findings/verify).' });
  });
  app.get('/api/sentinel/findings', (req, res, p, b, url) => {
    const s = svc(res); if (!s) return;
    const q = Object.fromEntries(['severity', 'status', 'q'].map((k) => [k, url.searchParams.get(k) || '']).filter(([, v]) => v));
    let list = s.universal(Object.keys(q).length ? q : null);
    const sub = url.searchParams.get('subsystem'), prov = url.searchParams.get('provenance');
    if (sub) list = list.filter((f) => f.subsystem === sub);
    if (prov) list = list.filter((f) => f.provenance === prov);
    json(res, 200, { statement: SENTINEL_STATEMENT, count: list.length, findings: list });
  });
  app.get('/api/sentinel/exercise', (req, res) => json(res, 200, { mode: 'SIMULATION', scenarios: EXERCISE, guardian: guardianDemo(), note: 'Educational scenarios. Guardian verdicts are computed by lib/guardian.mjs; nothing is submitted.' }));

  app.get('/api/sentinel', async (req, res) => {
    if (!ctx.ledgerReady) return json(res, 503, { error: ctx.ledgerError || 'Testnet not ready' });
    json(res, 200, { mode: 'LIVE_TESTNET', tokens: await sentinel.summary() });
  });

  app.get('/api/sentinel/:code', async (req, res, { code }) => {
    if (!/^[A-Za-z0-9]{3}$/.test(code)) return json(res, 400, { error: 'Bad ticker' });
    if (!ctx.ledgerReady) return json(res, 503, { error: ctx.ledgerError || 'Testnet not ready' });
    const r = await sentinel.report(code); // ~30s cache protects the public Testnet endpoint
    return r ? json(res, 200, r) : json(res, 404, { error: `No launched token ${code}` });
  });
}
