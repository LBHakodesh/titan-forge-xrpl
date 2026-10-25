// Demand Proof Score + spoke-to-corridor graduation API. Read-only on the ledger: this module never submits transactions.
import path from 'node:path';
import { Corridor } from '../corridor.mjs';
import { MODES } from '../../public/domain.js';

export function register(app, ctx) {
  const { store, bus, json } = ctx;
  const dataDir = path.dirname(store.file);
  const mainFile = path.join(dataDir, 'corridor.json');
  // Private TF_READONLY instances (agent test servers) must not clobber the main server's state:
  // they seed from data/corridor.json and write to data/corridor.readonly-<PORT>.json instead.
  const file = process.env.TF_CORRIDOR_FILE || (process.env.TF_READONLY === '1' ? path.join(dataDir, `corridor.readonly-${process.env.PORT || 'x'}.json`) : mainFile);
  const cor = new Corridor({ store, bus, ledger: ctx.ledger, file, seedFile: file !== mainFile ? mainFile : null, isLedgerReady: () => ctx.ledgerReady && !!ctx.ledger?.wallets });
  bus.on('event', (ev) => { try { cor.onEvent(ev); } catch (e) { console.error('[corridor]', e.message); } });
  ctx.corridor = cor; // optional handle for other modules (read-only use)

  const code = (c) => String(c || '').toUpperCase();

  app.get('/api/corridor', async (req, res, params, body, url) => {
    // Refresh live evidence (cached ~20 s) unless ?cached=1.
    if (url?.searchParams.get('cached') !== '1') for (const c of Object.keys(cor.state.tokens)) { try { await cor.live(c); } catch { /* summary falls back to snapshot */ } }
    json(res, 200, { engine: cor.engine.info(), modes: { organic: MODES.LIVE, demo: MODES.LIVE, sim: MODES.SIM },
      note: 'organic = independent accounts only; demo = our own demo accounts (never adoption evidence); sim = scenario model.',
      tokens: Object.keys(cor.state.tokens).map((c) => cor.summary(c)) });
  });

  app.get('/api/corridor/:code', async (req, res, { code: c }) => {
    const v = await cor.view(code(c));
    return v ? json(res, 200, v) : json(res, 404, { error: 'Unknown token' });
  });

  app.post('/api/corridor/:code/simulate', (req, res, { code: c }, body = {}) => {
    try { json(res, 200, cor.simulate(code(c), body.scenario, body.periods)); }
    catch (e) { json(res, e.status || 500, { error: e.message }); }
  });

  app.post('/api/corridor/:code/promote', async (req, res, { code: c }, body = {}) => {
    const r = await cor.promote(code(c), { approved: body.approved === true, mode: body.mode || MODES.SIM });
    json(res, r.status, r.body);
  });

  app.post('/api/corridor/:code/demote', (req, res, { code: c }, body = {}) => {
    const r = cor.demote(code(c), { mode: body.mode || MODES.SIM, to: body.to });
    json(res, r.status, r.body);
  });
}
