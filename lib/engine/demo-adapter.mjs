// TemporaryDemoAdapter: illustrative Testnet demo logic only. NOT the Titan Ghost Rust Quoter / Strategic Engine.
// v1 (synchronous, stable): info() / allocate(capitalUsd, opts) / recommend(markets)
// v2 (async, contract-shaped): strategyAsync(StrategyRequest) -> StrategyResponse, quoteAsync(QuoteRequest) -> rejects (no quoter)
import { allocateRings, MODES } from '../../public/domain.js';
import { CONTRACT_VERSION } from './contracts.mjs';

export const DEMO_ID = 'temporary-demo-adapter';
export const DEMO_LABEL = 'Temporary Testnet demonstration adapter (not the Titan Ghost engines)';

export class TemporaryDemoAdapter {
  constructor({ statusNote } = {}) { this.statusNote = statusNote || (() => null); }
  info() {
    const note = this.statusNote();
    return { id: DEMO_ID, label: DEMO_LABEL, authentic: false, contractVersion: CONTRACT_VERSION, transport: 'in-process', ...(note ? { note } : {}) };
  }
  allocate(capitalUsd, opts) { return allocateRings(capitalUsd, opts); }
  recommend(markets) {
    const evals = markets.map((m) => {
      const a = allocateRings(m.capitalUsd, m);
      const edge = a.rings.reduce((mx, r) => Math.max(mx, r.marginalBps), 0);
      return { ...m, idleUsd: a.idleUsd, edge };
    });
    if (evals.length < 2) return [];
    const best = evals.reduce((x, y) => (y.edge > x.edge ? y : x));
    const recs = [];
    for (const e of evals) {
      if (e === best || e.capitalUsd <= 0) continue;
      if (e.idleUsd > 0 || best.edge > e.edge * 1.5) {
        const amountUsd = Math.round(Math.max(e.idleUsd, e.capitalUsd * 0.1));
        recs.push({ source: 'Wake/CFIE/DMSIE (demo adapter)', action: 'reallocate', fromMarket: e.marketId, toMarket: best.marketId, amountUsd,
          rationale: `Marginal yield ${best.edge.toFixed(2)} bps/day in ${best.marketId} vs ${e.edge.toFixed(2)} in ${e.marketId}${e.idleUsd ? `; $${Math.round(e.idleUsd).toLocaleString()} idle` : ''}.`, mode: MODES.SIM });
      }
    }
    return recs;
  }
  // v2: same demo logic, wrapped in the StrategyResponse contract.
  async strategyAsync(req) {
    const markets = req.markets.map((m) => ({ ringsActive: 6, flowScale: 1, ...m, hurdleBps: req.hurdleBps }));
    return {
      source: DEMO_LABEL, authentic: false, mode: MODES.SIM,
      allocations: markets.map((m) => ({ marketId: m.marketId, allocation: this.allocate(m.capitalUsd, m) })),
      recommendations: this.recommend(markets),
    };
  }
  async quoteAsync() {
    throw Object.assign(new Error('No Quoter connected: the temporary demo adapter does not produce quotes. Set TF_ENGINE_BIN or TF_ENGINE_URL.'), { code: 'NOT_READY' });
  }
}
