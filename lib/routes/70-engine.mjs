// Engine contracts: which engine adapter is active, the JSON Schemas the Rust engines must speak, and a validator.
// Read-only: never submits transactions, never calls /api/launch.
import fs from 'node:fs';
import path from 'node:path';
import { getEngine, engineStatus } from '../engine/index.mjs';
import { validate, getSchema, schemaNames, SCHEMA_DIR } from '../engine/validate.mjs';
import { CONTRACT_VERSION, WIRE_VERSION, enumDrift, schemaList, txEvidenceFromStep, tokenRefFromLaunch } from '../engine/contracts.mjs';

const EXAMPLES = path.join(SCHEMA_DIR, '..', 'examples');
const example = (name) => { try { return JSON.parse(fs.readFileSync(path.join(EXAMPLES, `${name}.example.json`), 'utf8')); } catch { return undefined; } };

export function register(app, ctx) {
  const { json, store } = ctx;

  app.get('/api/engine/info', (req, res) => {
    const info = getEngine().info();
    json(res, 200, { active: info, label: info.label, authentic: Boolean(info.authentic), status: engineStatus(), contractVersion: CONTRACT_VERSION, wireVersion: WIRE_VERSION, enumDrift: enumDrift(), schemas: schemaList() });
  });

  app.get('/api/engine/schemas', (req, res) => json(res, 200, schemaList()));
  app.get('/api/engine/schemas/:name', (req, res, { name }) => {
    const s = schemaNames().includes(name) ? getSchema(name) : null;
    return s ? json(res, 200, s) : json(res, 404, { error: `Unknown schema ${name}`, schemas: schemaNames() });
  });
  app.get('/api/engine/examples/:name', (req, res, { name }) => {
    const e = schemaNames().includes(name) ? example(name) : undefined;
    return e === undefined ? json(res, 404, { error: `No example for ${name}` }) : json(res, 200, e);
  });

  app.post('/api/engine/validate', (req, res, params, body) => {
    if (!body || typeof body.schema !== 'string' || !('value' in body)) return json(res, 400, { error: 'Body must be { schema: <name>, value: <any JSON> }' });
    if (!schemaNames().includes(body.schema)) return json(res, 404, { error: `Unknown schema ${body.schema}`, schemas: schemaNames() });
    json(res, 200, { schema: body.schema, ...validate(body.schema, body.value) });
  });

  // Self-test: validate what the ACTIVE adapter produces right now plus real launch evidence. All outputs are SIMULATION.
  app.get('/api/engine/selftest', async (req, res) => {
    const eng = getEngine();
    const checks = [];
    const add = (name, schema, value) => checks.push({ name, schema, ...validate(schema, value) });
    const alloc = eng.allocate(5000, { flowScale: 1, ringsActive: 6 });
    add('allocate(5000)', 'allocation', alloc);
    for (const r of alloc.rings) add(`allocate ring ${r.id}`, 'ring-metrics', r);
    const recs = eng.recommend([{ marketId: 'currencies', capitalUsd: 100000, flowScale: 1, ringsActive: 6 }, { marketId: 'securities', capitalUsd: 400000, flowScale: 0.2, ringsActive: 6 }]);
    recs.forEach((r, i) => add(`recommend[${i}]`, 'recommendation', r));
    if (eng.strategyAsync) {
      try { add('strategyAsync(example)', 'strategy-response', await eng.strategyAsync(example('strategy-request'))); }
      catch (e) { checks.push({ name: 'strategyAsync(example)', schema: 'strategy-response', valid: false, errors: [{ path: '', message: e.message }] }); }
    }
    for (const l of store.launches.filter((x) => x.status === 'live')) {
      const t = tokenRefFromLaunch(l); if (t) add(`${l.code} token`, 'token-ref', t);
      for (const s of l.steps) { const ev = txEvidenceFromStep(s); if (ev) add(`${l.code} ${s.key}`, 'tx-evidence', ev); }
    }
    json(res, 200, { mode: 'SIMULATION', engine: eng.info(), sample: { allocation: alloc, recommendations: recs }, passed: checks.filter((c) => c.valid).length, total: checks.length, checks });
  });
}
