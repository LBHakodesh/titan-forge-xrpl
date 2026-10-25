// TGAN — Titan Ghost Advisory Network API (hackathon DEMONSTRATION; HYPOTHETICAL advisors, approvals and fees).
// GETs are public read-only views. State-changing POSTs are SIMULATION records restricted to direct localhost callers.
// POST /api/tgan/fee-calculator is pure (changes nothing) and open. No route here signs, submits, bills, collects a fee
// or moves funds; TGAN never calls /api/launch, /api/pathfinder/run or any x402 purchase route.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TganService, ProjectSource, NOTICE, isLocalRequest, LEGAL_GATE_RULE, gateOverrideAttempt, ELIGIBILITY_NOT_ENABLED, ALLOWED_FEE_BASES, PROHIBITED_FEE_BASES, EXPENSE_TREATMENTS, MEASUREMENT_PERIODS } from '../tgan/index.mjs';
import { entitlements, publicPolicy } from '../entitlement/index.mjs';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

export const FLOW = [
  { id: 'request', title: 'Project request', source: 'Project Incubator' },
  { id: 'advisor_review', title: 'Advisor review', source: 'TGAN (HYPOTHETICAL)' },
  { id: 'funding', title: 'TGLB funding structure', source: 'Project Incubator capital stack (read-only)' },
  { id: 'incubation', title: 'XRP/RLUSD incubation', source: 'TGAN governance + Guardian' },
  { id: 'execution', title: 'Execution (replay / simulation)', source: 'Incubator SIMULATION/REPLAY' },
  { id: 'performance', title: 'Performance measurement', source: 'TGAN recomputation' },
  { id: 'xdlc', title: 'XDLC opportunity evaluation', source: 'XDLC is a proposed XRPL amendment, not live' },
  { id: 'graduation', title: 'Potential graduation', source: 'Incubator state (not changeable from TGAN)' },
];

export function register(app, ctx) {
  const { json, bus } = ctx;
  const readonly = process.env.TF_READONLY === '1';
  const file = process.env.TF_TGAN_FILE || path.join(DATA, 'tgan.json');
  const port = process.env.PORT || 4131;
  const projects = new ProjectSource({
    routeExists: (p) => !!app.match('GET', p),
    fetchJson: async (p) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { signal: AbortSignal.timeout(4000) }); if (!r.ok) throw new Error(`${p} -> HTTP ${r.status}`); return r.json(); },
  });
  const svc = new TganService({ file, persist: !readonly || !!process.env.TF_TGAN_FILE, bus, projects, log: (m) => console.error('[tgan]', m) });
  ctx.tgan = svc; // other modules may read (never required)

  const local = (req, res) => { if (isLocalRequest(req)) return true; json(res, 403, { error: 'TGAN changes are SIMULATION records restricted to direct localhost callers (Content-Type: application/json, no proxy, local origin).' }); return false; };
  const send = (res, r, extra = {}) => { const { status = 200, ...rest } = r; json(res, status, { mode: 'SIMULATION', hypothetical: true, ...rest, ...extra }); };
  const access = () => { try { return { accessPolicy: publicPolicy(entitlements().policy) }; } catch (e) { return { accessError: e.message }; } };

  app.get('/api/tgan', async (req, res) => {
    const list = await svc.projectList();
    json(res, 200, {
      mode: 'SIMULATION', hypothetical: true, name: 'TGAN — Titan Ghost Advisory Network', notice: NOTICE, legalGateRule: LEGAL_GATE_RULE,
      flow: FLOW, projectSource: { origin: list.origin, label: list.label, error: list.error || null },
      projects: list.projects.map((p) => ({ id: p.id, name: p.name, token: p.token, stage: p.stage, program: p.program, outcome: p.outcome, gates: { legal: p.gates.legal, economic: p.gates.economic }, mode: p.mode, origin: p.origin })),
      eligibility: svc.eligibility(), clientCriteria: svc.state.clientCriteria,
      feeOptions: { allowedBases: ALLOWED_FEE_BASES, prohibitedBases: Object.keys(PROHIBITED_FEE_BASES), expenseTreatments: EXPENSE_TREATMENTS, measurementPeriods: MEASUREMENT_PERIODS, eligibilityDefault: ELIGIBILITY_NOT_ENABLED },
      events: ['tgan.advisor_assigned', 'tgan.recommendation', 'tgan.fee_calculated'],
    });
  });

  app.get('/api/tgan/advisors', (req, res) => json(res, 200, { mode: 'SIMULATION', hypothetical: true, notice: NOTICE, advisors: svc.advisors() }));
  app.get('/api/tgan/advisors/:id', (req, res, { id }) => { const a = svc.advisor(id); return a ? json(res, 200, { mode: 'SIMULATION', hypothetical: true, advisor: a }) : json(res, 404, { error: `Unknown advisor ${id}` }); });
  app.post('/api/tgan/advisors/:id/verification', (req, res, { id }, body = {}) => { if (local(req, res)) send(res, svc.recordVerification(id, body || {})); });

  app.get('/api/tgan/portfolios/:projectId', async (req, res, { projectId }) => {
    const p = await svc.portfolio(projectId);
    return p ? json(res, 200, p) : json(res, 404, { error: `Unknown project ${projectId}` });
  });
  app.post('/api/tgan/portfolios/:projectId/assign', async (req, res, { projectId }, body = {}) => { if (local(req, res)) send(res, await svc.assign(projectId, body || {})); });
  app.post('/api/tgan/portfolios/:projectId/authorizations', (req, res, { projectId }, body = {}) => { if (local(req, res)) send(res, svc.addAuthorization(projectId, body || {})); });
  app.post('/api/tgan/portfolios/:projectId/authorizations/:authId/revoke', (req, res, { projectId, authId }) => { if (local(req, res)) send(res, svc.revokeAuthorization(projectId, authId)); });
  app.post('/api/tgan/portfolios/:projectId/proposals', async (req, res, { projectId }, body = {}) => {
    if (!local(req, res)) return;
    if (gateOverrideAttempt(body || {})) return json(res, 400, { mode: 'SIMULATION', errors: [LEGAL_GATE_RULE], refused: 'gate-override' });
    send(res, await svc.propose(projectId, body || {}));
  });
  app.post('/api/tgan/portfolios/:projectId/proposals/:proposalId/review', async (req, res, { projectId, proposalId }, body = {}) => {
    if (!local(req, res)) return;
    if (gateOverrideAttempt(body || {})) return json(res, 400, { mode: 'SIMULATION', errors: [LEGAL_GATE_RULE], refused: 'gate-override' });
    send(res, await svc.review(projectId, proposalId, body || {}));
  });
  app.post('/api/tgan/portfolios/:projectId/fee-config', async (req, res, { projectId }, body = {}) => { if (local(req, res)) send(res, await svc.setFeeConfig(projectId, body || {})); });

  app.get('/api/tgan/performance/:projectId', async (req, res, { projectId }) => {
    const p = await svc.performance(projectId);
    if (!p) return json(res, 404, { error: `Unknown project ${projectId}` });
    json(res, 200, { ...p, fee: await svc.projectFee(projectId) });
  });
  app.post('/api/tgan/performance/:projectId/report', async (req, res, { projectId }, body = {}) => { if (local(req, res)) send(res, await svc.addReport(projectId, body || {})); });

  // Pure calculator: computes a HYPOTHETICAL illustration; never stores a fee, bills or collects.
  app.get('/api/tgan/fee-calculator', (req, res) => json(res, 200, { mode: 'SIMULATION', hypothetical: true, ...svc.workedExample(), clientCriteria: svc.state.clientCriteria, criteriaNote: 'Operator-configurable. Verify with counsel; values change. No default criteria are claimed.' }));
  app.post('/api/tgan/fee-calculator', (req, res, params, body = {}) => {
    const out = svc.calculate(body || {}, { projectId: typeof body?.projectId === 'string' ? body.projectId.slice(0, 64) : null });
    json(res, out.ok ? 200 : 400, out);
  });
  app.post('/api/tgan/legal-review', (req, res, params, body = {}) => { if (local(req, res)) send(res, svc.recordLegalReview(body || {})); });
  app.get('/api/tgan/eligibility-criteria', (req, res) => json(res, 200, { mode: 'SIMULATION', criteria: svc.state.clientCriteria, note: 'Operator-configurable "qualified client" style criteria. Verify with counsel; values change. TGAN ships no default values.' }));
  app.post('/api/tgan/eligibility-criteria', (req, res, params, body = {}) => { if (local(req, res)) send(res, svc.setClientCriteria(body?.criteria)); });

  app.get('/api/tgan/revenue', async (req, res) => json(res, 200, await svc.revenue(access())));
  app.get('/api/tgan/sentinel-signals', async (req, res) => json(res, 200, await svc.signals()));
  app.post('/api/tgan/reset', (req, res) => { if (local(req, res)) send(res, svc.reset(), { note: 'TGAN demo scenario restored.' }); });
}
