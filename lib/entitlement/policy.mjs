// Access & Free Threshold policy (operator policy, final):
//   "TGLW is free for EVERY participant up to one configurable capital/usage threshold,
//    regardless of participant category."
// Every number in this file is a DEMONSTRATION SETTING. None is an approved commercial threshold,
// price or quota, and nothing here connects to a billing provider or charges anyone.
import { PROFILES, TIERS } from '../../public/domain.js';

export const DEMO_THRESHOLD_USD = 50_000; // example — not an approved threshold
export const DEMO_GRACE_HOURS = 72;        // sustained time above threshold before a plan applies (demo)
export const DEMO_TWA_WINDOW_HOURS = 24;   // time-weighting window for qualifying liquidity (demo)
export const DEMO_XRP_USD = 2.0;           // illustrative XRP/USD conversion rate — not a market price

export const CATEGORIES = PROFILES.map((p) => ({ id: p.id, label: p.label }));
export const ONBOARDING_MINIMUM_USD = 0; // no minimum capital to onboard, for any category

const num = (v) => (v == null || v === '' ? null : Number(v));
const posOrNull = (v) => { const n = num(v); return Number.isFinite(n) && n > 0 ? n : null; };

export function policyFromEnv(env = process.env) {
  const envThreshold = posOrNull(env.FREE_LIQUIDITY_THRESHOLD_USD);
  const envRate = posOrNull(env.TF_ACCESS_XRP_USD);
  const envGrace = num(env.TF_ACCESS_GRACE_HOURS);
  return {
    thresholdUsd: envThreshold ?? DEMO_THRESHOLD_USD,
    thresholdSource: envThreshold ? 'env:FREE_LIQUIDITY_THRESHOLD_USD' : 'demo-default',
    graceHours: Number.isFinite(envGrace) && envGrace >= 0 ? envGrace : DEMO_GRACE_HOURS,
    twaWindowHours: DEMO_TWA_WINDOW_HOURS,
    xrpUsd: envRate ?? DEMO_XRP_USD,
    xrpUsdSource: envRate ? 'env:TF_ACCESS_XRP_USD' : 'demo-default',
    plans: defaultPlans(),
  };
}

// Demo paid service / capacity plans shown ABOVE the free threshold. Prices and quotas are demo settings,
// not live offers. capacityMultiple is relative to the current threshold, so plans follow a threshold change.
export function defaultPlans() {
  return [
    { id: 'capacity_plus', label: 'Capacity Plus (demo)', capacityMultiple: 10, monthlyUsdDemo: 49, premium: ['data.depth_history', 'data.ring_analytics'], requestQuotaDemo: 50_000 },
    { id: 'capacity_pro', label: 'Capacity Pro (demo)', capacityMultiple: 200, monthlyUsdDemo: 490, premium: ['data.depth_history', 'data.ring_analytics', 'data.wake_signals', 'data.corridor_analytics'], requestQuotaDemo: 1_000_000 },
    { id: 'capacity_unlimited', label: 'Capacity Unlimited (demo)', capacityMultiple: Infinity, monthlyUsdDemo: 4_900, premium: ['*'], requestQuotaDemo: null },
  ];
}

export const PLAN_DISCLAIMER = 'Demo plan: price and quota are configurable demonstration settings, not a live offer. No billing provider is connected and nothing is charged.';
export const THRESHOLD_LABEL = 'example — not an approved threshold';

// Resource classes:
//   essential — always available to the authorized owner, regardless of threshold, plan or payment.
//   core      — TGLW core services: free up to the threshold, plan capacity above it.
//   premium   — premium data: free entitlement (if included) -> subscription -> optional x402 -> deny.
//   funding   — TGLB Tier 1 / Tier 2 funding arrangements: separate from billing (never priced here).
//   tier3     — Tier 3 lending / vault underwriting: separate credit path, never granted by any plan.
export const RESOURCES = {
  'positions.view': { cls: 'essential', label: 'View own positions' },
  'records.view': { cls: 'essential', label: 'View own records', confidential: true },
  'offers.cancel': { cls: 'essential', label: 'Cancel authorized offers', txType: 'OfferCancel' },
  'permissions.revoke': { cls: 'essential', label: 'Revoke permissions / delegation' },
  'withdrawals.permitted': { cls: 'essential', label: 'Permitted withdrawals', txType: 'Payment' },
  'security.warnings': { cls: 'essential', label: 'Security warnings (Sentinel)' },
  'tglw.provide_liquidity': { cls: 'core', label: 'Provide liquidity through TGLW', txType: 'OfferCreate' },
  'tglw.rebalance': { cls: 'core', label: 'Ring rebalancing service' },
  'tglw.basic_analytics': { cls: 'core', label: 'Basic analytics on own liquidity' },
  'data.market_summary': { cls: 'premium', label: 'Market summary feed', includedFree: true },
  'data.depth_history': { cls: 'premium', label: 'Order-book depth history' },
  'data.ring_analytics': { cls: 'premium', label: 'Ring analytics' },
  'data.wake_signals': { cls: 'premium', label: 'Wake Intelligence signals' },
  'data.corridor_analytics': { cls: 'premium', label: 'Corridor analytics' },
  'tglb.tier1.fund': { cls: 'funding', tierId: 'T1', label: 'Tier 1 flexible funding' },
  'tglb.tier2.commit': { cls: 'funding', tierId: 'T2', label: 'Tier 2 term commitment' },
  'tglb.tier3.vault': { cls: 'tier3', tierId: 'T3', label: 'Tier 3 underwritten lending vault' },
};
export const ESSENTIAL = Object.keys(RESOURCES).filter((k) => RESOURCES[k].cls === 'essential');

// Unknown resources (e.g. new x402 data products) are treated as premium data not included in the free allowance.
export function resourceInfo(id) {
  if (RESOURCES[id]) return { id, ...RESOURCES[id] };
  return { id, cls: 'premium', label: id || 'unspecified premium data', unlisted: true };
}

export const TIER_SEPARATION = TIERS.map((t) => ({
  ...t,
  billing: t.id === 'T3'
    ? 'Separate formal credit / lending-vault underwriting. No TGLW plan, subscription, threshold or capital amount grants Tier 3.'
    : 'Funding arrangement only. Choosing Tier 1 or Tier 2 never changes the free threshold, plan pricing or x402 charges.',
}));

export function publicPolicy(p) {
  return {
    rule: 'TGLW is free for every participant up to one configurable threshold, regardless of participant category.',
    thresholdUsd: p.thresholdUsd, thresholdLabel: p.thresholdSource === 'demo-default' ? THRESHOLD_LABEL : `${p.thresholdSource === 'runtime-demo-control' ? 'runtime demo setting' : 'configured via ' + p.thresholdSource} — not an approved threshold`,
    thresholdSource: p.thresholdSource, onboardingMinimumUsd: ONBOARDING_MINIMUM_USD,
    graceHours: p.graceHours, twaWindowHours: p.twaWindowHours,
    xrpUsd: p.xrpUsd, xrpUsdLabel: 'illustrative conversion rate — not a market price', xrpUsdSource: p.xrpUsdSource,
    categories: CATEGORIES, sameRuleForEveryCategory: true,
    plans: p.plans.map((pl) => ({ ...pl, capacityMultiple: Number.isFinite(pl.capacityMultiple) ? pl.capacityMultiple : null, capacityUsd: Number.isFinite(pl.capacityMultiple) ? pl.capacityMultiple * p.thresholdUsd : null, demo: true, disclaimer: PLAN_DISCLAIMER })),
    resources: Object.entries(RESOURCES).map(([id, r]) => ({ id, ...r })),
    essential: ESSENTIAL,
    tiers: TIER_SEPARATION,
    measurement: [
      'Qualifying supported liquidity = time-weighted, funded, executable liquidity supported by TGLW — not wealth.',
      'Overlapping offers backed by the same inventory count once: offered amounts are capped by the funded balance per asset.',
      'Excluded: wallet assets not backing offers, nominal token supply, hypothetical/simulated balances, traded volume, and tokens valued only by the participant\'s own quotes.',
      'Linked accounts of one participant/organization are aggregated, so splitting wallets cannot multiply the free allowance.',
      'Crossing the threshold starts a grace period; a plan applies only if the time-weighted figure stays above it for the whole grace period. Falling below restores free status immediately.',
    ],
  };
}
