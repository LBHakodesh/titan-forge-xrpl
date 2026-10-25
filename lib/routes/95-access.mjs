// Access & Free Threshold API.
//   LIVE_TESTNET: demo participants (maker, rival) qualified READ-ONLY from validated account_info /
//                 account_lines / book_offers. Demo accounts, organic:false.
//   SIMULATION:   threshold/plan demo settings, simulated participants (five PROFILES + custom amounts).
// Nothing here signs, submits, bills or charges.
import { MODES, PROFILES } from '../../public/domain.js';
import { entitlements, attachBus, checkAccess, publicPolicy, Entitlements, RESOURCES } from '../entitlement/index.mjs';
import { LIVE_PARTICIPANTS, measureLive } from '../entitlement/live.mjs';

const LIVE = MODES.LIVE, SIM = MODES.SIM;
const REFRESH_MS = 30_000;
const LADDER_DEFAULT = [100, 5_000, 49_999, 50_000, 50_001, 100_000, 1_000_000, 25_000_000];

export function register(app, ctx) {
  const { json, bus, ledger, store } = ctx;
  attachBus(bus);
  const ent = entitlements();
  const live = { lastAt: 0, inflight: null, error: null, meta: {} };

  const ensureLiveRecords = () => {
    if (!ctx.ledgerReady || !ledger.wallets) return false;
    for (const lp of LIVE_PARTICIPANTS) {
      const w = ledger.wallets[lp.role];
      if (!w || ent.get(lp.id)) continue;
      ent.upsert({ id: lp.id, label: lp.label, category: lp.category, mode: LIVE, wallets: [{ address: w.address, balances: {}, offers: [] }], role: lp.role });
    }
    return true;
  };

  const refreshLive = async (force = false) => {
    if (!ensureLiveRecords()) { live.error = ctx.ledgerError || 'Testnet accounts still bootstrapping'; return; }
    if (!force && Date.now() - live.lastAt < REFRESH_MS) return;
    if (live.inflight) return live.inflight;
    live.inflight = (async () => {
      try {
        const codes = store.launches.filter((l) => l.status === 'live').map((l) => l.code);
        for (const lp of LIVE_PARTICIPANTS) {
          if (!ent.get(lp.id)) continue;
          const m = await measureLive(ledger, { roles: [lp.role], xrpUsd: ent.policy.xrpUsd, codes });
          ent.record(lp.id, { wallets: m.wallets, prices: m.prices, meta: { source: 'LIVE_TESTNET read-only: account_info, account_lines, book_offers (validated)', validatedLedger: m.validatedLedger, valuation: m.valuation, reserveBaseXrp: m.reserveBaseXrp, reserveIncXrp: m.reserveIncXrp, books: m.books, xrpUsd: ent.policy.xrpUsd } });
          live.meta = { validatedLedger: m.validatedLedger, networkId: m.networkId };
        }
        live.lastAt = Date.now(); live.error = null;
      } catch (e) { live.error = e.message; console.error('[access] live refresh failed:', e.message); }
      finally { live.inflight = null; }
    })();
    return live.inflight;
  };
  const timer = setInterval(() => refreshLive().catch(() => {}), 60_000); timer.unref?.();

  const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
  const all = () => [...ent.participants.values()].map((p) => ent.describe(p.id));

  app.get('/api/access/policy', (req, res) => json(res, 200, { mode: SIM, settingsNote: 'Threshold, grace, rate, plan prices and quotas are demonstration settings.', policy: publicPolicy(ent.policy) }));

  app.post('/api/access/policy', (req, res, params, body = {}) => {
    const r = ent.setPolicy(body || {});
    if (!r.ok) return json(res, 400, { mode: SIM, errors: r.errors });
    bus.publish('access.policy_changed', SIM, { thresholdUsd: ent.policy.thresholdUsd, thresholdSource: ent.policy.thresholdSource, graceHours: ent.policy.graceHours, xrpUsd: ent.policy.xrpUsd });
    if (body?.xrpUsd != null) live.lastAt = 0; // re-value live figures at the new illustrative rate
    json(res, 200, { mode: SIM, policy: publicPolicy(ent.policy) });
  });

  app.get('/api/access/participants', async (req, res) => {
    await withTimeout(refreshLive(), 8_000);
    const ps = all();
    json(res, 200, {
      thresholdUsd: ent.policy.thresholdUsd,
      live: { mode: LIVE, network: 'XRPL Testnet', ...live.meta, error: live.error, refreshedAt: live.lastAt ? new Date(live.lastAt).toISOString() : null, participants: ps.filter((p) => p.mode === LIVE) },
      simulated: { mode: SIM, participants: ps.filter((p) => p.mode === SIM) },
    });
  });

  app.get('/api/access/participants/:id', async (req, res, params) => {
    if (params.id.startsWith('live-')) await withTimeout(refreshLive(), 8_000);
    const d = ent.describe(params.id);
    if (!d) return json(res, 404, { error: `Unknown participant ${params.id}` });
    json(res, 200, d);
  });

  app.post('/api/access/simulate', (req, res, params, body = {}) => {
    const { category, capitalUsd, linkedWallets, overlappingOffers, hoursAbove, subscriptionPlanId, id } = body || {};
    const r = ent.simulate({ id: id || (category ? `sim-custom-${category}` : undefined), category, capitalUsd, linkedWallets, overlappingOffers, hoursAbove, subscriptionPlanId });
    if (!r.ok) return json(res, 400, { mode: SIM, errors: r.errors });
    const decisions = Object.fromEntries(['tglw.provide_liquidity', 'data.market_summary', 'data.depth_history', 'offers.cancel'].map((rs) => [rs, ent.decide(r.participant.id, rs)]));
    json(res, 200, { ...r, decisions });
  });

  // SIMULATION ladder: every category x amount, evaluated on a scratch engine (does not touch the registry).
  app.get('/api/access/ladder', (req, res, params, body, url) => {
    const amounts = (url.searchParams.get('amounts') || '').split(',').filter((x) => x.trim() !== '').map(Number).filter((n) => Number.isFinite(n) && n >= 0).slice(0, 20);
    const scratch = new Entitlements({ policy: { ...ent.policy } });
    const list = amounts.length ? amounts : [...LADDER_DEFAULT.filter((a) => a !== 50_000 && a !== 49_999 && a !== 50_001), ent.policy.thresholdUsd - 1, ent.policy.thresholdUsd, ent.policy.thresholdUsd + 1].sort((a, b) => a - b);
    const rows = list.map((capitalUsd) => ({
      capitalUsd,
      byCategory: PROFILES.map((p) => {
        const s = scratch.simulate({ id: `sim-ladder-${p.id}`, category: p.id, capitalUsd });
        const d = scratch.decide(s.participant.id, 'tglw.provide_liquidity');
        return { category: p.id, status: s.participant.status, decision: d.decision, offer: s.participant.offer?.planId || null };
      }),
    }));
    for (const r of rows) r.identical = r.byCategory.every((c) => c.decision === r.byCategory[0].decision && c.status === r.byCategory[0].status);
    json(res, 200, { mode: SIM, thresholdUsd: ent.policy.thresholdUsd, rows, categoryNeutral: rows.every((r) => r.identical) });
  });

  app.post('/api/access/check', async (req, res, params, body = {}) => {
    const { participantId, resource } = body || {};
    if (typeof resource !== 'string' || !resource) return json(res, 400, { errors: ['resource is required.'], resources: Object.keys(RESOURCES) });
    if (participantId?.startsWith?.('live-')) await withTimeout(refreshLive(), 8_000);
    json(res, 200, checkAccess(body));
  });

  refreshLive().catch(() => {});
}
