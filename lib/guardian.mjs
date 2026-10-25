// Titan Guardian: authorization boundaries for any proposed action.
// guardCheck({ mode, txType, role?, amountXrp?, amountUsd?, marketId?, approved? }) -> { allowed, reasons[] }
import { MODES, MARKETS } from '../public/domain.js';

const LIVE_TX_TYPES = new Set(['TrustSet', 'Payment', 'OfferCreate', 'OfferCancel', 'AccountSet']);
const LIVE_ROLES = new Set(['issuer', 'maker', 'taker', 'rival', 'router', 'router2', 'router3']);
export const LIMITS = { liveMaxXrpPerTx: 20, simMaxUsd: 1_000_000_000 };

export function guardCheck(p = {}) {
  const reasons = [];
  if (!Object.values(MODES).includes(p.mode)) reasons.push('Unknown mode.');
  if (p.marketId && !MARKETS.some((m) => m.id === p.marketId)) reasons.push(`Unknown market ${p.marketId}.`);
  if (p.mode === MODES.LIVE) {
    if (!LIVE_TX_TYPES.has(p.txType)) reasons.push(`Transaction type ${p.txType} is not authorized for the demo.`);
    if (!LIVE_ROLES.has(p.role)) reasons.push('Only isolated demo accounts may sign.');
    if (p.amountXrp != null && !(p.amountXrp >= 0 && p.amountXrp <= LIMITS.liveMaxXrpPerTx)) reasons.push(`Live amount must be 0–${LIMITS.liveMaxXrpPerTx} XRP per transaction.`);
    if (p.requiresApproval && p.approved !== true) reasons.push('Explicit operator approval required.');
  }
  if (p.mode === MODES.SIM && p.amountUsd != null && !(p.amountUsd > 0 && p.amountUsd <= LIMITS.simMaxUsd)) reasons.push('Simulated amount out of range.');
  if ((p.mode === MODES.REPLAY || p.mode === MODES.MAINNET) && p.txType) reasons.push(`${p.mode} mode cannot propose transactions.`);
  return { allowed: reasons.length === 0, reasons };
}
