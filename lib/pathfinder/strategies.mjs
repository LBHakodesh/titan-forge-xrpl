// Maker quoting strategies for the Testnet pathfinding replay.
// Spreads borrow the ILLUSTRATIVE ring half-spreads from public/domain.js (temporary demo adapter values,
// not the authentic Titan Ghost Quoter). Sizes are deliberately tiny (XRP notional per quote).
import { RINGS } from '../../public/domain.js';

const ring = (id) => RINGS.find((r) => r.id === id).spreadBps;

// sides: 'both' | 'ask' (sell token for XRP: captures XRP→token flow) | 'bid' (buy token: captures token→XRP flow)
// scope: 'primary' quotes only the first selected token's XRP book; 'all' (all current strategies) quotes every selected token's XRP book.
export const STRATEGIES = {
  tight: { label: 'Tight (VELOCITY-like)', ring: 'VELOCITY', halfSpreadBps: ring('VELOCITY'), sides: 'both', notionalXrp: 3, scope: 'all', replenish: false,
    explain: 'Quotes closest to mid. The payment engine consumes the best-quality funded offer first, so this should win flow until its size runs out.' },
  wide: { label: 'Wide (CEILING-like)', ring: 'CEILING', halfSpreadBps: ring('CEILING'), sides: 'both', notionalXrp: 3, scope: 'all', replenish: false,
    explain: 'Far from mid. Earns more per fill but only fills after tighter liquidity is exhausted.' },
  two_sided: { label: 'Two-sided (EARN-like)', ring: 'EARN', halfSpreadBps: ring('EARN'), sides: 'both', notionalXrp: 3, scope: 'all', replenish: false,
    explain: 'Bid and ask at a moderate spread: competes for both XRP→token and token→XRP flow.' },
  one_sided: { label: 'One-sided ask (EARN-like)', ring: 'EARN', halfSpreadBps: ring('EARN'), sides: 'ask', notionalXrp: 3, scope: 'all', replenish: false,
    explain: 'Only sells the token. It can only attract XRP→token payments; token→XRP flow goes elsewhere.' },
  bridge_leg: { label: 'Bridge leg (BRIDGE-like)', ring: 'BRIDGE', halfSpreadBps: ring('BRIDGE'), sides: 'both', notionalXrp: 5, scope: 'all', replenish: false,
    explain: 'Deeper quotes on both sides of every selected token\'s XRP book, sized so token→token payments can auto-bridge through XRP across our books on both legs (A→XRP and XRP→B).' },
  replenish: { label: 'Tight + replenish', ring: 'VELOCITY', halfSpreadBps: ring('VELOCITY'), sides: 'both', notionalXrp: 1.5, scope: 'all', replenish: true,
    explain: 'Smaller tight quotes that are re-posted after each fill, so the best price stays on the book.' },
};

// Rival demo maker baselines. Default: static, wider two-sided quotes.
export const RIVAL_STRATEGIES = {
  static_wide: { label: 'Static wider two-sided (rival default)', ring: 'MONEY', halfSpreadBps: ring('MONEY'), sides: 'both', notionalXrp: 3, scope: 'all', replenish: false,
    explain: 'A competitor quoting both sides a bit wider than our inner rings, never re-quoting.' },
  ...Object.fromEntries(Object.entries(STRATEGIES).map(([k, v]) => [k, { ...v }])),
  none: { label: 'No rival', halfSpreadBps: null, sides: 'none', notionalXrp: 0, scope: 'all', replenish: false, explain: 'Rival posts nothing.' },
};

const sig = (x) => Number(x.toPrecision(8));

// Quotes for one maker: [{ role, code, side, priceXrp, tokenQty, xrp }]
export function buildQuotes(role, strat, tokens, mids) {
  if (!strat || strat.sides === 'none' || !strat.notionalXrp) return [];
  const list = strat.scope === 'all' ? tokens : tokens.slice(0, 1);
  const out = [];
  for (const code of list) {
    const mid = mids[code];
    if (!(mid > 0)) continue;
    const hs = strat.halfSpreadBps / 10_000;
    if (strat.sides === 'both' || strat.sides === 'ask') {
      const price = sig(mid * (1 + hs));
      out.push({ role, code, side: 'ask', priceXrp: price, tokenQty: sig(strat.notionalXrp / price), xrp: strat.notionalXrp });
    }
    if (strat.sides === 'both' || strat.sides === 'bid') {
      const price = sig(mid * (1 - hs));
      out.push({ role, code, side: 'bid', priceXrp: price, tokenQty: sig(strat.notionalXrp / price), xrp: strat.notionalXrp });
    }
  }
  return out;
}

export const publicStrategies = () => ({
  ours: Object.entries(STRATEGIES).map(([id, s]) => ({ id, ...s })),
  rival: Object.entries(RIVAL_STRATEGIES).map(([id, s]) => ({ id, ...s })),
  note: 'Spreads reuse the illustrative ring values in public/domain.js (temporary demo adapter), not the authentic Titan Ghost Quoter.',
});
