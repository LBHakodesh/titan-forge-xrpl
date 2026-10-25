// Shared Titan Forge domain model. Imported by the browser (/domain.js) and Node (../public/domain.js).
// Numeric parameters here are ILLUSTRATIVE demo values for the temporary adapter,
// not the authentic Titan Ghost Quoter / Strategic Engine parameters.

// MAINNET_OBSERVED = read-only statistics sampled from XRPL Mainnet (no Mainnet transactions are ever signed).
export const MODES = { LIVE: 'LIVE_TESTNET', SIM: 'SIMULATION', REPLAY: 'REPLAY', MAINNET: 'MAINNET_OBSERVED' };

export const MARKETS = [
  { id: 'currencies', label: 'Currencies', demoAsset: 'TUS', demoSupply: 100_000_000, refPriceXrp: 0.4 },
  { id: 'securities', label: 'Securities', demoAsset: 'TSE', demoSupply: 10_000_000, refPriceXrp: 20 },
  { id: 'real_estate', label: 'Real Estate', demoAsset: 'TRE', demoSupply: 1_000_000, refPriceXrp: 200 },
  { id: 'precious_metals', label: 'Precious Metals', demoAsset: 'TAU', demoSupply: 10_000_000, refPriceXrp: 8 },
];

// Six rings, innermost (tightest spread, fastest turnover) to outermost (deep reserve).
// spreadBps: half-spread from mid. flowUsd: modeled daily flow reaching the ring.
// turnover: times per day capital in the ring is modeled to trade (wide rings fill rarely).
export const RINGS = [
  { id: 'VELOCITY', spreadBps: 5, turnover: 2, flowUsd: 40_000, role: 'Tightest quotes; captures most retail flow' },
  { id: 'BRIDGE', spreadBps: 15, turnover: 0.8, flowUsd: 120_000, role: 'XRP auto-bridge path depth' },
  { id: 'EARN', spreadBps: 40, turnover: 0.3, flowUsd: 300_000, role: 'Core earning band' },
  { id: 'MONEY', spreadBps: 100, turnover: 0.08, flowUsd: 900_000, role: 'Larger tickets, wider spread' },
  { id: 'DEEP', spreadBps: 250, turnover: 0.02, flowUsd: 3_000_000, role: 'Absorbs block trades and shocks' },
  { id: 'CEILING', spreadBps: 600, turnover: 0.005, flowUsd: 12_000_000, role: 'Outer backstop; caps price impact' },
];

export const PROFILES = [
  { id: 'retail', label: 'Individual / Retail', capitalUsd: 100 },
  { id: 'adv_retail', label: 'Advanced Retail', capitalUsd: 5_000 },
  { id: 'pro_mm', label: 'Professional Market Maker', capitalUsd: 100_000 },
  { id: 'family_office', label: 'Family Office', capitalUsd: 1_000_000 },
  { id: 'institutional', label: 'Institutional', capitalUsd: 25_000_000 },
];

// Funding arrangement is independent of participant size.
export const TIERS = [
  { id: 'T1', label: 'Tier 1 — Uncommitted', route: 'TGLW flexible self-custodial liquidity' },
  { id: 'T2', label: 'Tier 2 — Committed', route: 'TGLW self-custodial term-committed liquidity' },
  { id: 'T3', label: 'Tier 3 — Underwritten', route: 'Separate formal credit and lending-vault pathway' },
];

// Token-to-corridor lifecycle. Transitions may go backward (reversible).
export const STAGES = [
  { id: 'entered', label: 'Project entered' },
  { id: 'spoke', label: 'Initial XRP spoke' },
  { id: 'growing_spoke', label: 'Reinforced spoke' },
  { id: 'corridor', label: 'Six-ring corridor' },
  { id: 'mature', label: 'Mature corridor' },
  { id: 'standby', label: 'Optimized / standby' },
];

// Temporary demo allocator (marginal-earnings water-filling).
// Ring i earning for allocation x (USD/day): spread_i * turnover_i * flow_i * (1 - e^(-x / flow_i)).
// Marginal yield (bps/day per USD) = spread_i * turnover_i * e^(-x / flow_i): diminishing returns once x nears the ring's flow.
// Capital stops being deployed once every ring's marginal falls below hurdleBps -> reported as idle.
// `flowScale` scales modeled demand (e.g. by Demand Proof); `ringsActive` limits a spoke to inner rings.
export function allocateRings(capitalUsd, { flowScale = 1, hurdleBps = 2, ringsActive = RINGS.length, steps = 400 } = {}) {
  const rings = RINGS.slice(0, ringsActive).map((r) => ({ ...r, flow: r.flowUsd * flowScale, alloc: 0 }));
  const chunk = capitalUsd / steps;
  let idle = 0;
  const marginal = (r) => r.spreadBps * r.turnover * Math.exp(-r.alloc / r.flow);
  for (let i = 0; i < steps; i++) {
    let best = null;
    for (const r of rings) if (!best || marginal(r) > marginal(best)) best = r;
    if (!best || marginal(best) < hurdleBps) { idle += chunk; continue; }
    best.alloc += chunk;
  }
  const out = rings.map((r) => {
    const dailyEarnUsd = (r.spreadBps * r.turnover / 10_000) * r.flow * (1 - Math.exp(-r.alloc / r.flow));
    return { id: r.id, allocUsd: r.alloc, dailyEarnUsd, marginalBps: marginal(r), utilization: Math.min(1, r.alloc / r.flow) };
  });
  const deployed = capitalUsd - idle;
  const dailyEarnUsd = out.reduce((s, r) => s + r.dailyEarnUsd, 0);
  return { mode: MODES.SIM, capitalUsd, deployedUsd: deployed, idleUsd: idle, dailyEarnUsd, yieldBpsOnDeployed: deployed ? (dailyEarnUsd / deployed) * 10_000 : 0, rings: out };
}

// Modeled price impact (bps) of a market order of sizeUsd against a ring allocation.
export function priceImpactBps(sizeUsd, rings) {
  let remaining = sizeUsd, worst = 0;
  for (const r of rings) {
    if (remaining <= 0) break;
    const spec = RINGS.find((x) => x.id === r.id);
    const take = Math.min(remaining, r.allocUsd);
    if (take > 0) { worst = spec.spreadBps; remaining -= take; }
  }
  return remaining > 0 ? Infinity : worst;
}
