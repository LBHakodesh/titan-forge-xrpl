// Live Testnet launch loop: validate -> trustlines -> issue -> bid/ask -> controlled fill -> verify.
import crypto from 'node:crypto';
import { validateLaunch } from '../validate.mjs';
import { QUOTE } from '../ledger.mjs';

export const STEPS = [
  { key: 'validate', label: 'Validate name, ticker and policy' },
  { key: 'trust_maker', label: 'Maker opens trustline to issuer' },
  { key: 'trust_taker', label: 'Counterparty opens trustline' },
  { key: 'issue', label: 'Issuer issues supply to maker' },
  { key: 'ask', label: `Maker posts ask: ${QUOTE.askQty} @ ${QUOTE.ask} XRP` },
  { key: 'bid', label: `Maker posts bid: ${QUOTE.bidQty} @ ${QUOTE.bid} XRP` },
  { key: 'fill', label: `Controlled counterparty buys ${QUOTE.fillQty}` },
  { key: 'verify', label: 'Verify balances and order book on validated ledger' },
];

const MAX_PER_HOUR = 30;
const MAX_TOTAL = 150;

export function register(app, ctx) {
  const { ledger, store, bus, json } = ctx;
  let queue = Promise.resolve();
  const recentStarts = [];

  async function run(launch) {
    const step = async (key, fn) => {
      const s = launch.steps.find((x) => x.key === key);
      s.status = 'running'; s.startedAt = new Date().toISOString();
      bus.publish('launch.step', 'LIVE_TESTNET', { launchId: launch.id, code: launch.code, step: { ...s } });
      try {
        const out = await fn();
        s.status = 'done';
        if (out?.hash) Object.assign(s, { hash: out.hash, result: out.result, ledger: out.ledger, validated: out.validated, explorer: out.explorer });
        else if (out) s.detail = out;
        store.save();
        bus.publish('launch.step', 'LIVE_TESTNET', { launchId: launch.id, code: launch.code, step: { ...s } });
        return out;
      } catch (e) {
        s.status = 'failed'; s.error = e.message;
        if (e.tx) Object.assign(s, { hash: e.tx.hash, result: e.tx.result, explorer: e.tx.explorer });
        throw e;
      }
    };
    try {
      launch.status = 'running'; store.save();
      await step('validate', async () => ({ ok: true }));
      const v = await ledger.launch(launch, step);
      store.update(launch.id, { status: 'live', stage: 'spoke', completedAt: new Date().toISOString(), issuer: v.issuer, fillHash: v.fillHash, book: v.book });
      bus.publish('launch.done', 'LIVE_TESTNET', { launchId: launch.id, code: launch.code, name: launch.name, fillHash: v.fillHash, book: v.book, issuer: v.issuer });
    } catch (e) {
      store.update(launch.id, { status: 'failed', error: e.message });
      bus.publish('launch.failed', 'LIVE_TESTNET', { launchId: launch.id, code: launch.code, error: e.message });
    }
  }

  // Shared by POST /api/launch and the demo loop (ctx.launches.start). Returns { status, body, done? }.
  function startLaunch(body, extra = {}) {
    if (!ctx.ledgerReady) return { status: 503, body: { error: ctx.ledgerError ? `Testnet unavailable: ${ctx.ledgerError}` : 'Testnet accounts still bootstrapping', replayAvailable: store.launches.some((l) => l.status === 'live') } };
    const v = validateLaunch(body);
    if (!v.ok) return { status: 400, body: { errors: v.errors } };
    if (store.byCode(v.value.code)) return { status: 409, body: { errors: [`Ticker ${v.value.code} is already launched in this demo.`] } };
    const now = Date.now();
    while (recentStarts.length && now - recentStarts[0] > 3600_000) recentStarts.shift();
    if (recentStarts.length >= MAX_PER_HOUR) return { status: 429, body: { errors: ['Hourly launch limit reached; try replay mode.'] } };
    if (store.launches.filter((l) => l.status !== 'failed').length >= MAX_TOTAL) return { status: 429, body: { errors: ['Demo launch capacity reached.'] } };
    recentStarts.push(now);

    const launch = store.add({
      id: crypto.randomUUID(), ...v.value, mode: 'LIVE_TESTNET', status: 'queued', stage: 'entered',
      createdAt: new Date().toISOString(), organic: false, // demo-generated activity is never organic demand
      steps: STEPS.map((s) => ({ ...s, status: 'pending' })), ...extra,
    });
    bus.publish('launch.created', 'LIVE_TESTNET', { launchId: launch.id, code: launch.code, name: launch.name, category: launch.category });
    const done = queue.then(() => run(launch)).then(() => store.get(launch.id));
    queue = done.catch(() => {});
    return { status: 202, body: { id: launch.id }, done };
  }
  ctx.launches = { start: startLaunch };

  app.post('/api/launch', (req, res, params, body) => {
    const r = startLaunch(body);
    json(res, r.status, r.body);
  });

  app.get('/api/launches', (req, res) => json(res, 200, store.launches));
  app.get('/api/launches/:id', (req, res, { id }) => {
    const l = store.get(id);
    return l ? json(res, 200, l) : json(res, 404, { error: 'Unknown launch' });
  });
  app.get('/api/book/:code', async (req, res, { code }) => {
    if (!ctx.ledgerReady) return json(res, 503, { error: 'Testnet not ready' });
    json(res, 200, { mode: 'LIVE_TESTNET', code, ...(await ledger.book(code.toUpperCase())) });
  });
  app.get('/api/status', async (req, res) => {
    if (!ctx.ledgerReady) return json(res, 503, { error: ctx.ledgerError || 'bootstrapping' });
    const s = await ledger.status();
    const live = store.launches.filter((l) => l.status === 'live');
    json(res, 200, {
      mode: 'LIVE_TESTNET', ...s,
      launches: { live: live.length, failed: store.launches.filter((l) => l.status === 'failed').length },
      validatedTxCount: live.reduce((n, l) => n + l.steps.filter((x) => x.hash).length, 0),
    });
  });
}
