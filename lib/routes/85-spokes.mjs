// Spokes API: the 26-spoke XRP hub network (GYW1313 13 + 13). Read-only on every network.
//   GET  /api/spokes            snapshot (MAINNET_OBSERVED + TESTNET_FUNDED spokes, SIMULATION corridor)
//   GET  /api/spokes/flows      merged flows for animation, newest first (?since=<iso>&limit=)
//   GET  /api/spokes/replay     deterministic REPLAY sequence (same output every call)
//   GET  /api/spokes/:id        one spoke + its transactions (id URL-encoded: <network>:<currency>:<issuer>)
//   POST /api/spokes/refresh    read-only rediscovery (localhost only, rate-limited)
// Contract: docs/SPOKES_API.md.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpokesService } from '../spokes/service.mjs';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function register(app, ctx) {
  const { json, bus, store, ledger } = ctx;
  const svc = new SpokesService({
    file: process.env.TF_SPOKES_FILE || path.join(DATA, 'spokes-snapshot.json'),
    runsFile: path.join(DATA, 'pathfinder-runs.json'),
    store, ledger, bus,
  });
  svc.start();
  ctx.spokes = svc;

  app.get('/api/spokes', (req, res) => json(res, 200, svc.response()));

  app.get('/api/spokes/flows', (req, res, params, body, url) => json(res, 200, {
    flows: svc.flows({ since: url.searchParams.get('since'), limit: url.searchParams.get('limit') }),
    note: 'MAINNET_OBSERVED = read-only third-party Mainnet payments; LIVE_TESTNET = Titan Forge demo payments (organic:false).',
  }));

  app.get('/api/spokes/replay', (req, res) => json(res, 200, svc.replay()));

  app.post('/api/spokes/refresh', (req, res) => {
    if (!LOCAL.has(req.socket.remoteAddress)) return json(res, 403, { error: 'Refresh is restricted to localhost.' });
    const r = svc.requestRefresh();
    const { httpStatus, ...rest } = r;
    json(res, httpStatus, rest);
  });

  app.get('/api/spokes/:id', (req, res, { id }) => {
    const d = svc.detail(id);
    return d ? json(res, 200, d) : json(res, 404, { error: 'Unknown spoke id', hint: 'Use the URL-encoded id from GET /api/spokes, e.g. testnet%3ABBL%3Ar...' });
  });
}
