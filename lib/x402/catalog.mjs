// x402 demo data catalog. Each resource: a FREE sample (never gated) and a separately gated PREMIUM report.
// Built only from existing app data (store, read-only ledger queries, capital/corridor/sentinel libs).
// Never included: strategy coefficients beyond the already-public illustrative demo values, participant-private data,
// seeds, keys or system secrets. Addresses are shortened.
import { MARKETS, RINGS, MODES } from '../../public/domain.js';
import { getEngine } from '../engine/index.mjs';
import { createState, snapshot, MARKET_FLOW_SCALE } from '../capital.mjs';
import { ringAllocation, ringsActiveFor, THRESHOLDS, nextStage } from '../corridor.mjs';
import { QUOTE } from '../ledger.mjs';
import { shortAddr, EXPLORER_TX } from './protocol.mjs';

const R_ADDR = /\br[1-9A-HJ-NP-Za-km-z]{24,34}\b/g;
export const redactText = (s) => String(s ?? '').replace(R_ADDR, (a) => shortAddr(a));
const live = (store) => store.launches.filter((l) => l.status === 'live');
const engineLabel = () => { const i = getEngine().info(); return { id: i.id, label: i.label, authentic: i.authentic === true }; };

// Deterministic thin-market scenario used by Wake premium data and the agent demo (SIMULATION).
export const THIN_MARKET_SCENARIO = [['currencies', 250_000], ['securities', 250_000], ['precious_metals', 250_000], ['real_estate', 2_000_000]]
  .map(([marketId, capitalUsd]) => ({ marketId, capitalUsd, flowScale: MARKET_FLOW_SCALE[marketId], ringsActive: RINGS.length }));

async function books(c) {
  const out = [];
  for (const l of live(c.store)) {
    let b = null, mode = MODES.REPLAY, source = 'recorded at launch';
    if (c.ledgerReady()) { try { b = await c.ledger.book(l.code); mode = MODES.LIVE; source = 'book_offers, validated ledger (funded amounts)'; } catch { b = null; } }
    if (!b) b = l.book || { asks: [], bids: [] };
    out.push({ code: l.code, mode, source, book: b });
  }
  return out;
}
const demoSet = (c) => new Set(Object.values(c.ledger?.wallets || {}).map((w) => w.address));

export const CATALOG = [
  {
    id: 'corridor', entitlementResource: 'data.corridor_analytics', title: 'Liquidity corridor snapshot', priceDrops: 20_000,
    sample: (c) => ({ mode: MODES.LIVE, tokens: live(c.store).map((l) => ({ code: l.code, stage: l.stage, ringsActive: ringsActiveFor(l.stage) })), note: 'Stage is the recorded corridor stage of each live Testnet token.' }),
    premium: (c) => ({
      mode: MODES.SIM, engine: engineLabel(),
      tokens: live(c.store).map((l) => {
        const nxt = nextStage(l.stage);
        return { code: l.code, stage: l.stage, modeledRings: ringAllocation(l.stage, 0, 0), next: nxt ? { stage: nxt, gate: THRESHOLDS[nxt]?.why || null } : null };
      }),
      note: 'Ring allocations are modeled (SIMULATION) by the temporary demo adapter at demand score 0 and 0% independent share.',
    }),
  },
  {
    id: 'book', entitlementResource: 'data.depth_history', title: 'Funded order-book depth', priceDrops: 30_000,
    sample: async (c) => {
      const b = (await books(c))[0];
      if (!b) return { mode: MODES.REPLAY, tokens: [] };
      return { mode: b.mode, code: b.code, bestAsk: b.book.asks[0]?.priceXrp ?? null, bestBid: b.book.bids[0]?.priceXrp ?? null, source: b.source };
    },
    premium: async (c) => {
      const demo = demoSet(c);
      const side = (arr) => { let cum = 0, cumXrp = 0; return arr.map((o) => { cum += o.qty; cumXrp += o.qty * o.priceXrp; return { priceXrp: o.priceXrp, qty: o.qty, cumQty: cum, cumXrp: +cumXrp.toFixed(6), account: shortAddr(o.account), demoAccount: demo.has(o.account) }; }); };
      return {
        tokens: (await books(c)).map((b) => {
          const a = b.book.asks[0]?.priceXrp, d = b.book.bids[0]?.priceXrp;
          return { code: b.code, mode: b.mode, source: b.source, spreadBps: a && d ? Math.round(((a - d) / ((a + d) / 2)) * 10_000) : null, asks: side(b.book.asks), bids: side(b.book.bids) };
        }),
        note: 'Depth by demo accounts is demonstration liquidity, not organic demand.',
      };
    },
  },
  {
    id: 'fills', entitlementResource: 'x402.data.fills', title: 'Validated fill analytics', priceDrops: 20_000,
    sample: (c) => ({ mode: MODES.LIVE, validatedFills: live(c.store).filter((l) => l.fillHash).length, organic: 0, note: 'Fills recorded from validated Testnet transactions; all by demo counterparties.' }),
    premium: (c) => ({
      mode: MODES.LIVE,
      fills: live(c.store).filter((l) => l.fillHash).map((l) => {
        const step = (l.steps || []).find((s) => s.key === 'fill') || {};
        const first = (l.steps || []).find((s) => s.ledger);
        return { code: l.code, transaction: l.fillHash, explorer: EXPLORER_TX + l.fillHash, ledger: step.ledger ?? null, result: step.result ?? null,
          qty: QUOTE.fillQty, priceXrp: Number(QUOTE.ask), notionalXrp: QUOTE.fillQty * Number(QUOTE.ask), ledgersFromFirstStep: step.ledger && first?.ledger ? step.ledger - first.ledger : null,
          organic: false, counterparty: 'demo taker (controlled)' };
      }),
      note: 'Every fill here is a controlled demo counterparty fill. It proves mechanics, not organic demand. Re-verify hashes in the Sentinel tab.',
    }),
  },
  {
    id: 'wake', entitlementResource: 'data.wake_signals', title: 'Wake Intelligence recommendations', priceDrops: 50_000,
    sample: () => { const recs = getEngine().recommend(THIN_MARKET_SCENARIO); return { mode: MODES.SIM, engine: engineLabel(), recommendationsAvailable: recs.length, actionsPreview: [...new Set(recs.map((r) => r.action))], note: 'Free sample shows only whether recommendations exist. Detail is premium.' }; },
    premium: () => {
      const cur = createState();
      const curMarkets = MARKETS.map((m) => ({ marketId: m.id, capitalUsd: cur.baseUsd, flowScale: MARKET_FLOW_SCALE[m.id], ringsActive: RINGS.length }));
      return { mode: MODES.SIM, engine: engineLabel(), adapterNote: 'Temporary demo adapter via getEngine().recommend(); not the Titan Ghost engines.',
        scenarios: { baseline: { markets: curMarkets.map(({ marketId, capitalUsd }) => ({ marketId, capitalUsd })), recommendations: getEngine().recommend(curMarkets) },
          thinMarket: { markets: THIN_MARKET_SCENARIO.map(({ marketId, capitalUsd }) => ({ marketId, capitalUsd })), recommendations: getEngine().recommend(THIN_MARKET_SCENARIO) } } };
    },
  },
  {
    id: 'capital', entitlementResource: 'data.ring_analytics', title: 'CFIE/DMSIE capital-efficiency analytics', priceDrops: 40_000,
    sample: () => { const s = createState(); return { mode: MODES.SIM, engine: engineLabel(), markets: MARKETS.map((m) => { const x = snapshot(s, m.id); return { marketId: m.id, deployedShare: x.totalUsd ? +(x.deployedUsd / x.totalUsd).toFixed(3) : 0 }; }) }; },
    premium: () => {
      const s = createState();
      return { mode: MODES.SIM, engine: engineLabel(), markets: MARKETS.map((m) => {
        const x = snapshot(s, m.id);
        return { marketId: m.id, totalUsd: x.totalUsd, deployedUsd: Math.round(x.deployedUsd), idleUsd: Math.round(x.idleUsd), dailyEarnUsd: +x.dailyEarnUsd.toFixed(2), yieldBpsOnDeployed: +x.yieldBpsOnDeployed.toFixed(2),
          productiveCapacityUsd: x.productiveCapacityUsd, touchSpreadBps: x.touchSpreadBps, impact: x.impact,
          ringUtilization: x.rings.map((r) => ({ id: r.id, utilization: +r.utilization.toFixed(3), shareOfDeployed: +r.shareOfDeployed.toFixed(3) })) };
      }), note: 'Illustrative demo adapter outputs (SIMULATION). Participant lists are excluded.' };
    },
  },
  {
    id: 'sentinel', entitlementResource: 'x402.data.sentinel', title: 'Authorized Sentinel risk report', priceDrops: 50_000, needsLedger: true,
    sample: async (c) => {
      if (!c.ledgerReady() || !c.sentinel) return { mode: MODES.LIVE, available: false, note: 'Testnet not ready.' };
      const s = await c.sentinel.summary();
      return { mode: MODES.LIVE, tokens: s.map((t) => ({ code: t.code, counts: t.counts || null, verified: t.verified ?? null })), note: 'Free: severity counts. Security warnings themselves are essential and stay free in the Sentinel tab.' };
    },
    premium: async (c) => {
      const out = [];
      for (const l of live(c.store)) {
        const r = await c.sentinel.report(l.code);
        if (!r) continue;
        out.push({ code: r.code, scannedAt: r.scannedAt, counts: r.counts, findings: r.findings.map((x) => ({ id: x.id, severity: x.severity, title: redactText(x.title), evidence: redactText(x.evidence), protects: redactText(x.protects), limits: redactText(x.limits) })) });
      }
      return { mode: MODES.LIVE, tokens: out, note: 'Addresses shortened. Read-only scan of validated Testnet state.' };
    },
  },
  {
    id: 'positions', entitlementResource: 'x402.data.positions', title: 'Participant-private positions', priceDrops: 0, restricted: true,
    sample: () => ({ mode: MODES.SIM, restricted: true, note: 'Participant-private data is never sold via x402. Participants see their own positions free (essential).' }),
    premium: () => { throw new Error('restricted'); },
  },
];

export function catalogFor(env = process.env) {
  const enabled = env.TF_X402_RESOURCES ? new Set(env.TF_X402_RESOURCES.split(',').map((s) => s.trim())) : null;
  return CATALOG.filter((r) => !enabled || enabled.has(r.id) || r.restricted).map((r) => {
    const o = Number(env[`TF_X402_PRICE_${r.id.toUpperCase()}`]);
    return { ...r, priceDrops: r.restricted ? 0 : Number.isFinite(o) && o > 0 ? Math.min(o, 100_000) : r.priceDrops };
  });
}
