// Entitlement seam (inclusion-first access). Owned by the Access agent; signature is stable:
//   checkAccess({ participantId, resource, mode }) ->
//     { decision: 'essential' | 'free' | 'subscription' | 'x402' | 'deny', reason, mode, thresholdUsd?, qualifyingUsd?, offer? }
// 'essential' resources (own positions, offer cancellation, revocation, permitted withdrawals, security warnings) are never gated.
// Premium data resources not covered by free/subscription return 'x402' (optional pay-per-request), never a hard wall on participation.
// Optional extra fields (all optional, backwards compatible): actorAddress, targetParticipantId, role, amountXrp, amountUsd,
// requiresApproval, approved, marketId. No double charging: only decision === 'x402' may lead to a 402 / payment.
import { PROFILES } from '../../public/domain.js';
import { Entitlements } from './engine.mjs';

export { Entitlements } from './engine.mjs';
export * from './policy.mjs';
export { measureWallet, measureParticipant, timeWeightedUsd, statusFor, planOffer, simulatedWallets } from './qualify.mjs';

export function seedSimulatedProfiles(ent) {
  for (const p of PROFILES) ent.simulate({ id: `sim-${p.id}`, category: p.id, capitalUsd: p.capitalUsd, label: `${p.label} (simulated preset)` });
}

let shared = null;
export function entitlements() {
  if (!shared) { shared = new Entitlements(); seedSimulatedProfiles(shared); }
  return shared;
}
export function attachBus(bus) { entitlements().bus = bus; }

// True only when the request should be offered pay-per-request. Entitled/subscribed/essential requests never get a 402.
export const requiresPayment = (result) => result?.decision === 'x402';

const DEDUP_MS = 10_000;
export function checkAccess({ participantId, resource, mode, ...opts } = {}) {
  const ent = entitlements();
  const result = ent.decide(participantId, resource, { mode, ...opts });
  if (ent.bus) {
    const key = `${participantId}|${resource}|${result.decision}`;
    const t = Date.now();
    if (!(t - (ent.lastDecision.get(key) || 0) < DEDUP_MS)) {
      ent.lastDecision.set(key, t);
      ent.bus.publish('access.decision', result.mode, { participantId: result.participantId, resource: result.resource, decision: result.decision, reason: result.reason, qualifyingUsd: result.qualifyingUsd ?? null, thresholdUsd: result.thresholdUsd, status: result.status ?? null, demo: true, organic: false });
    }
  }
  return result;
}
