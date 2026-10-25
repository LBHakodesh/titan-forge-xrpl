// Capital Injection API. Simulated capital (SIMULATION) is kept in memory; the live-capacity
// endpoint is a READ-ONLY view of real Testnet reserves (LIVE_TESTNET). Nothing here submits transactions.
import { dropsToXrp } from 'xrpl';
import { createState, resetState, simulateInjection, simulateSequence, describeState, reserveCapacity, marketById } from '../capital.mjs';

const strip = (r) => { const { nextState, ...rest } = r; return rest; };

export function register(app, ctx) {
  const { bus, json, ledger } = ctx;
  let state = createState();

  const publish = (r, extra = {}) => bus.publish('capital.injected', 'SIMULATION', {
    marketId: r.input.marketId, profileId: r.input.profileId, capitalUsd: r.input.capitalUsd, tierId: r.input.tierId,
    allocation: { rings: r.after.rings.map((x) => ({ id: x.id, allocUsd: x.allocUsd })) },
    deployedUsd: r.after.deployedUsd, idleUsd: r.after.idleUsd, totalUsd: r.after.totalUsd, ...extra,
  });

  // Used by the demo loop (SIMULATION only: modeled capital, nothing is signed).
  ctx.capital = {
    inject(body) {
      const r = simulateInjection(state, body);
      if (!r.ok) return { ok: false, errors: r.errors };
      state = r.nextState;
      publish(r, body.loop ? { loop: body.loop } : {});
      return { ok: true, deployedUsd: r.after.deployedUsd, idleUsd: r.after.idleUsd, totalUsd: r.after.totalUsd };
    },
  };

  app.get('/api/capital/state', (req, res) => json(res, 200, describeState(state)));

  app.post('/api/capital/inject', (req, res, params, body = {}) => {
    const r = simulateInjection(state, body);
    if (!r.ok) return json(res, 400, { mode: 'SIMULATION', errors: r.errors, guardian: r.guardian });
    state = r.nextState;
    publish(r);
    json(res, 200, strip(r));
  });

  app.post('/api/capital/reset', (req, res, params, body = {}) => {
    if (body.marketId && !marketById(body.marketId)) return json(res, 400, { errors: [`Unknown market ${body.marketId}.`] });
    state = resetState(state, body.marketId);
    bus.publish('capital.reset', 'SIMULATION', { marketId: body.marketId || null });
    json(res, 200, describeState(state));
  });

  app.post('/api/capital/sequence', (req, res, params, body = {}) => {
    if (!marketById(body.marketId)) return json(res, 400, { errors: [`Unknown market ${body.marketId}.`] });
    const r = simulateSequence(state, { marketId: body.marketId, tierId: body.tierId || 'T1', fresh: body.fresh !== false });
    const bad = r.steps.find((s) => !s.ok);
    if (bad) return json(res, 400, { mode: 'SIMULATION', errors: bad.errors, guardian: bad.guardian });
    state = r.nextState;
    // Staggered events so Titan View can animate step by step.
    r.steps.forEach((s, i) => setTimeout(() => publish(s, { sequence: { index: i, total: r.steps.length } }), i * 900).unref?.());
    json(res, 200, { mode: 'SIMULATION', marketId: r.marketId, tierId: r.tierId, steps: r.steps.map(strip) });
  });

  // READ-ONLY: real demo-account balances and reserves on XRPL Testnet.
  app.get('/api/capital/live-capacity', async (req, res) => {
    if (!ctx.ledgerReady) return json(res, 503, { mode: 'LIVE_TESTNET', error: ctx.ledgerError || 'Testnet accounts still bootstrapping' });
    await ledger.connect(); // asserts Testnet network_id
    const info = (await ledger.client.request({ command: 'server_info' })).result.info;
    const vl = info.validated_ledger || {};
    const reserveBaseXrp = Number(vl.reserve_base_xrp), reserveIncXrp = Number(vl.reserve_inc_xrp);
    const accounts = {};
    for (const role of ['maker', 'taker']) {
      const address = ledger.wallets[role].address;
      const a = (await ledger.client.request({ command: 'account_info', account: address, ledger_index: 'validated' })).result.account_data;
      accounts[role] = { address, ...reserveCapacity({ xrp: Number(dropsToXrp(a.Balance)), ownerCount: a.OwnerCount, reserveBaseXrp, reserveIncXrp }) };
    }
    json(res, 200, {
      mode: 'LIVE_TESTNET', network: 'XRPL Testnet', networkId: info.network_id, validatedLedger: vl.seq,
      reserveBaseXrp, reserveIncXrp, accounts,
      note: 'Real Testnet demo accounts (no monetary value). Each new offer adds one owner object and needs one owner reserve; a 1 XRP fee buffer is held back. XRP-side bids also need XRP to fund them. These are demo accounts, not participant capital.',
    });
  });
}
