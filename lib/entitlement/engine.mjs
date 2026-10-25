// Entitlement engine: participant registry + access decisions. Synchronous decisions (checkAccess is called
// in-line by the x402 layer); live measurements are refreshed asynchronously and cached here.
// Decision values: 'essential' | 'free' | 'subscription' | 'x402' | 'deny'.
import { MODES } from '../../public/domain.js';
import { guardCheck } from '../guardian.mjs';
import { policyFromEnv, resourceInfo, CATEGORIES, PLAN_DISCLAIMER } from './policy.mjs';
import { measureParticipant, timeWeightedUsd, statusFor, planOffer, simulatedWallets } from './qualify.mjs';

const HOUR = 3_600_000;
const LIVE = MODES.LIVE, SIM = MODES.SIM;
const MAX_SAMPLES = 2_000;

export class Entitlements {
  constructor({ policy = policyFromEnv(), bus = null, now = () => Date.now() } = {}) {
    this.policy = policy;
    this.bus = bus;
    this.now = now;
    this.participants = new Map();
    this.orgState = new Map(); // orgKey -> { status, aboveSince }
    this.lastDecision = new Map();
  }

  // ---------- registry ----------
  upsert(p) {
    const prev = this.participants.get(p.id);
    const mode = p.mode ?? prev?.mode, category = p.category ?? prev?.category;
    if (![LIVE, SIM].includes(mode)) throw new Error('Participant mode must be LIVE_TESTNET or SIMULATION');
    if (!CATEGORIES.some((c) => c.id === category)) throw new Error(`Unknown category ${category}`);
    if (prev && prev.mode !== mode) throw new Error('A participant cannot switch between live and simulated data');
    if ((mode === SIM) !== String(p.id).startsWith('sim-')) throw new Error('Simulated participant ids start with "sim-"; live ids never do');
    const rec = {
      demo: true, organic: false, subscription: null, x402Eligible: true, delegates: [], permittedTiers: ['T1', 'T2'],
      underwriting: { approved: false }, samples: [], measurement: null, orgId: null, wallets: [], ...prev, ...p,
    };
    rec.addresses = rec.wallets.map((w) => w.address);
    if (rec.orgId) for (const o of this.members(rec.orgId)) if (o.id !== rec.id && o.mode !== rec.mode) throw new Error('Linked accounts must share one mode (live and simulated are never mixed)');
    this.participants.set(rec.id, rec);
    return rec;
  }

  get(id) { return this.participants.get(id) || null; }
  orgKey(p) { return p.orgId || p.id; }
  members(orgKey) { return [...this.participants.values()].filter((p) => this.orgKey(p) === orgKey); }

  // Record a fresh measurement (wallet snapshots + prices) as a time-weighted sample.
  record(id, { wallets, prices = {}, at = this.now(), meta = {} }) {
    const p = this.participants.get(id);
    if (!p) throw new Error(`Unknown participant ${id}`);
    const m = measureParticipant(wallets, prices);
    p.wallets = wallets; p.addresses = wallets.map((w) => w.address);
    p.measurement = { ...m, prices, at, ...meta };
    p.samples.push({ at, usd: m.usd });
    if (p.samples.length > MAX_SAMPLES) p.samples.splice(0, p.samples.length - MAX_SAMPLES);
    this.evaluate(id);
    return p;
  }

  // ---------- qualification ----------
  qualifyingUsd(p, now = this.now()) {
    return this.members(this.orgKey(p)).reduce((s, m) => s + timeWeightedUsd(m.samples, { now, windowHours: this.policy.twaWindowHours }), 0);
  }

  evaluate(id, { now = this.now(), publish = true } = {}) {
    const p = this.participants.get(id);
    if (!p) return null;
    const key = this.orgKey(p);
    const prev = this.orgState.get(key) || { status: 'free', aboveSince: null };
    const qualifyingUsd = this.qualifyingUsd(p, now);
    const st = statusFor({ qualifyingUsd, thresholdUsd: this.policy.thresholdUsd, aboveSince: prev.aboveSince, now, graceHours: this.policy.graceHours });
    this.orgState.set(key, { status: st.status, aboveSince: st.aboveSince });
    if (publish && this.bus && st.status !== prev.status) {
      this.bus.publish('access.threshold_crossed', p.mode, {
        participantId: p.id, orgId: p.orgId, members: this.members(key).map((m) => m.id), category: p.category,
        from: prev.status, to: st.status, qualifyingUsd, thresholdUsd: this.policy.thresholdUsd,
        graceEndsAt: st.graceEndsAt ? new Date(st.graceEndsAt).toISOString() : null, demo: true, organic: false,
      });
    }
    return { qualifyingUsd, ...st };
  }

  evaluateAll(opts) { const seen = new Set(); for (const p of this.participants.values()) { const k = this.orgKey(p); if (!seen.has(k)) { seen.add(k); this.evaluate(p.id, opts); } } }

  setPolicy(patch = {}) {
    const errors = [];
    const next = { ...this.policy };
    if (patch.reset) Object.assign(next, policyFromEnv(), { plans: policyFromEnv().plans });
    if (patch.thresholdUsd != null) {
      const t = Number(patch.thresholdUsd);
      if (!(Number.isFinite(t) && t > 0 && t <= 1e12)) errors.push('thresholdUsd must be a positive number.');
      else { next.thresholdUsd = t; next.thresholdSource = 'runtime-demo-control'; }
    }
    if (patch.graceHours != null) {
      const g = Number(patch.graceHours);
      if (!(Number.isFinite(g) && g >= 0 && g <= 24 * 90)) errors.push('graceHours must be 0–2160.'); else next.graceHours = g;
    }
    if (patch.xrpUsd != null) {
      const r = Number(patch.xrpUsd);
      if (!(Number.isFinite(r) && r > 0 && r < 1e4)) errors.push('xrpUsd must be a positive illustrative rate.'); else { next.xrpUsd = r; next.xrpUsdSource = 'runtime-demo-control'; }
    }
    if (Array.isArray(patch.plans)) {
      next.plans = next.plans.map((pl) => {
        const u = patch.plans.find((x) => x && x.id === pl.id);
        if (!u) return pl;
        const out = { ...pl };
        if (u.monthlyUsdDemo != null) { const v = Number(u.monthlyUsdDemo); if (Number.isFinite(v) && v >= 0) out.monthlyUsdDemo = v; else errors.push(`Bad price for ${pl.id}.`); }
        if (u.requestQuotaDemo != null) { const v = Number(u.requestQuotaDemo); if (Number.isFinite(v) && v >= 0) out.requestQuotaDemo = v; else errors.push(`Bad quota for ${pl.id}.`); }
        return out;
      });
    }
    if (errors.length) return { ok: false, errors };
    this.policy = next;
    this.evaluateAll();
    return { ok: true, policy: this.policy };
  }

  // ---------- simulation ----------
  // SIMULATION only. Registers/overwrites a simulated participant and returns its evaluation.
  simulate({ id, category, capitalUsd, linkedWallets = 1, overlappingOffers = 1, hoursAbove = null, subscriptionPlanId = null, label } = {}) {
    const errors = [];
    if (!CATEGORIES.some((c) => c.id === category)) errors.push(`category must be one of ${CATEGORIES.map((c) => c.id).join(', ')}.`);
    const cap = Number(capitalUsd);
    if (!(Number.isFinite(cap) && cap >= 0)) errors.push('capitalUsd must be a number ≥ 0.');
    const g = guardCheck({ mode: SIM, amountUsd: cap > 0 ? cap : 1 });
    if (!g.allowed) errors.push(...g.reasons);
    if (subscriptionPlanId && !this.policy.plans.some((p) => p.id === subscriptionPlanId)) errors.push(`Unknown demo plan ${subscriptionPlanId}.`);
    if (errors.length) return { ok: false, errors, guardian: g };
    const now = this.now();
    const pid = id || `sim-${category}`;
    if (!/^sim-[\w-]{1,48}$/.test(pid)) return { ok: false, errors: ['Simulated participant ids must start with "sim-".'] };
    const wallets = simulatedWallets({ capitalUsd: cap, linkedWallets, overlappingOffers, idPrefix: pid });
    const prices = { USD_SIM: 1 };
    const sustained = hoursAbove == null ? Math.max(this.policy.graceHours, this.policy.twaWindowHours) : Math.max(0, Number(hoursAbove) || 0);
    const at = now - sustained * HOUR;
    this.upsert({ id: pid, label: label || `${CATEGORIES.find((c) => c.id === category).label} (simulated)`, category, mode: SIM, wallets: [], samples: [],
      subscription: subscriptionPlanId ? { planId: subscriptionPlanId, status: 'active', demo: true } : null });
    const p = this.participants.get(pid);
    const m = measureParticipant(wallets, prices);
    p.wallets = wallets; p.addresses = wallets.map((w) => w.address);
    p.measurement = { ...m, prices, at: now, source: 'SIMULATION: injected hypothetical capital' };
    p.samples = [{ at, usd: m.usd }];
    // Simulated clock: the participant has been at this level for `sustained` hours.
    this.orgState.set(this.orgKey(p), { status: this.orgState.get(this.orgKey(p))?.status || 'free', aboveSince: m.usd > this.policy.thresholdUsd ? at : null });
    const ev = this.evaluate(pid, { now });
    const perWalletUsd = m.wallets.map((w) => w.usd);
    return {
      ok: true, mode: SIM, participant: this.describe(pid),
      demonstrations: {
        linkedAccounts: { wallets: wallets.length, perWalletUsd, everyWalletBelowThreshold: perWalletUsd.every((u) => u <= this.policy.thresholdUsd), aggregatedUsd: m.usd, status: ev.status,
          note: 'The threshold applies to the participant/organization aggregate, so splitting inventory across linked wallets does not multiply the free allowance.' },
        overlappingOffers: { offersPerWallet: Math.max(1, Math.floor(overlappingOffers)), naiveOfferedUsd: m.naiveOfferedUsd, countedUsd: m.usd, excludedUsd: m.overlapExcludedUsd,
          note: 'Several offers backed by the same inventory count once: offered amounts are capped by the funded balance per asset.' },
      },
    };
  }

  // ---------- decisions ----------
  describe(id, now = this.now()) {
    const p = this.participants.get(id);
    if (!p) return null;
    const ev = this.evaluate(id, { now, publish: true });
    const over = ev.status === 'over';
    return {
      id: p.id, label: p.label, category: p.category, mode: p.mode, demo: p.demo, organic: p.organic, orgId: p.orgId,
      linkedParticipants: this.members(this.orgKey(p)).map((m) => m.id),
      addresses: p.addresses, qualifyingUsd: ev.qualifyingUsd, thresholdUsd: this.policy.thresholdUsd,
      shareOfThreshold: this.policy.thresholdUsd ? ev.qualifyingUsd / this.policy.thresholdUsd : null,
      status: ev.status, aboveSince: ev.aboveSince ? new Date(ev.aboveSince).toISOString() : null, graceEndsAt: ev.graceEndsAt ? new Date(ev.graceEndsAt).toISOString() : null,
      subscription: p.subscription, x402Eligible: p.x402Eligible, permittedTiers: p.permittedTiers, underwriting: p.underwriting,
      offer: ev.status === 'free' ? null : { ...planOffer(ev.qualifyingUsd, this.policy), disclaimer: PLAN_DISCLAIMER, appliesAfterGrace: !over },
      measurement: p.measurement, samples: p.samples.length,
    };
  }

  // Authorization first: capital, plans and payment never override ownership, delegation, tier permissions,
  // underwriting, transaction limits, treasury rules (Guardian) or confidential-data boundaries.
  authorize(p, r, o) {
    const reasons = [];
    let actorRole = 'owner';
    if (o.actorAddress && p) {
      if (p.addresses.includes(o.actorAddress)) actorRole = 'owner';
      else {
        const d = p.delegates.find((x) => x.address === o.actorAddress && !x.revoked);
        if (!d) reasons.push('Actor is neither the account owner nor an authorized delegate.');
        else {
          actorRole = 'delegate';
          if (Array.isArray(d.allowed) && !d.allowed.includes(r.id)) reasons.push(`Delegated authority does not include ${r.id}.`);
          if (d.maxAmountXrp != null && o.amountXrp != null && o.amountXrp > d.maxAmountXrp) reasons.push(`Delegated limit is ${d.maxAmountXrp} XRP per transaction.`);
        }
      }
    }
    if (r.confidential && o.targetParticipantId && p && o.targetParticipantId !== p.id && !this.members(this.orgKey(p)).some((m) => m.id === o.targetParticipantId))
      reasons.push('Confidential-data boundary: records of another participant are not accessible.');
    let guardian = null;
    const mode = o.mode || p?.mode || SIM;
    if (r.txType && mode === LIVE) {
      guardian = guardCheck({ mode, txType: r.txType, role: o.role ?? p?.role, amountXrp: o.amountXrp, requiresApproval: o.requiresApproval, approved: o.approved });
    } else if (o.amountUsd != null || mode !== LIVE) {
      guardian = guardCheck({ mode, amountUsd: o.amountUsd ?? undefined, marketId: o.marketId });
    }
    if (guardian && !guardian.allowed) reasons.push(...guardian.reasons.map((x) => `Guardian: ${x}`));
    return { allowed: reasons.length === 0, reasons, actorRole, guardian };
  }

  decide(participantId, resource, o = {}) {
    const now = o.now ?? this.now();
    const r = resourceInfo(resource);
    const p = participantId ? this.participants.get(participantId) : null;
    const policy = this.policy;
    const base = { resource: r.id, resourceClass: r.cls, participantId: participantId || null, thresholdUsd: policy.thresholdUsd, at: new Date(now).toISOString() };
    const out = (decision, reason, extra = {}) => {
      const res = { decision, reason, mode: extra.mode || p?.mode || o.mode || SIM, ...base, ...extra };
      res.charge = { x402: decision === 'x402', subscription: decision === 'subscription' ? (p?.subscription?.planId || null) : null, billed: false, note: 'Demo: no billing provider connected; nothing is charged.' };
      return res;
    };

    // Strict live/simulated separation.
    if (p && o.mode && o.mode !== p.mode && [LIVE, SIM].includes(o.mode))
      return out('deny', `Mode mismatch: ${p.id} is a ${p.mode} participant; ${p.mode === SIM ? 'simulated capital never qualifies a live request' : 'live records are not mixed into simulation'}.`, { mode: o.mode });

    const auth = this.authorize(p, r, o);
    if (!auth.allowed) return out('deny', `Not authorized: ${auth.reasons.join(' ')} Capital, plans and payment never override authorization.`, { authorization: auth });

    if (r.cls === 'essential')
      return out('essential', `${r.label} is an essential function: always available to the account owner regardless of threshold, plan or payment.`, { authorization: auth });

    if (!p) {
      if (r.cls === 'premium') return out('x402', 'No registered participant: premium data is available via optional x402 pay-per-request. Registering is free and has no minimum capital.', { x402: { optional: true } });
      return out('deny', 'Unknown participant. Onboarding is free for every category with no minimum capital — register first.');
    }

    if (r.cls === 'funding') {
      if (!p.permittedTiers.includes(r.tierId)) return out('deny', `${r.label} is not a permitted use for this participant.`, { authorization: auth });
      return out('free', `${r.label}: funding arrangement, separate from TGLW billing — never priced by the threshold, a plan or x402.`, { billing: 'separate-funding-arrangement', authorization: auth });
    }
    if (r.cls === 'tier3') {
      if (p.underwriting?.approved) return out('free', 'Tier 3 via approved underwriting under a separate credit agreement — not part of any TGLW plan.', { billing: 'separate-credit-agreement', authorization: auth });
      return out('deny', 'Tier 3 lending / vault access requires separate underwriting. No TGLW plan, subscription, x402 payment or capital amount grants it.', { billing: 'separate-credit-agreement', authorization: auth });
    }

    const ev = this.evaluate(p.id, { now });
    const q = { qualifyingUsd: ev.qualifyingUsd, status: ev.status, category: p.category, graceEndsAt: ev.graceEndsAt ? new Date(ev.graceEndsAt).toISOString() : null };
    const sub = p.subscription?.status === 'active' ? policy.plans.find((x) => x.id === p.subscription.planId) : null;
    const subCapacity = sub ? (Number.isFinite(sub.capacityMultiple) ? sub.capacityMultiple * policy.thresholdUsd : Infinity) : 0;
    const offer = () => ({ ...planOffer(ev.qualifyingUsd, policy), disclaimer: PLAN_DISCLAIMER });
    const within = ev.status !== 'over';

    if (r.cls === 'core') {
      if (within) return out('free', ev.status === 'grace'
        ? `Above the free threshold but within the grace period — still free. A plan applies only if it stays above until ${q.graceEndsAt}.`
        : 'Within the free threshold — TGLW core services are free (same rule for every category).', { ...q, offer: ev.status === 'grace' ? offer() : undefined });
      if (sub && subCapacity >= ev.qualifyingUsd) return out('subscription', `Covered by demo plan ${sub.label}.`, { ...q });
      return out('deny', `Qualifying liquidity exceeds the free threshold after the grace period. The free allowance still covers the first $${policy.thresholdUsd.toLocaleString('en-US')}; capacity above it needs a plan${sub ? ' with more capacity' : ''}. Essential functions remain available.`, { ...q, offer: offer() });
    }

    // premium data: free entitlement -> subscription -> optional x402 -> deny
    if (r.includedFree && within) return out('free', 'Included in the free allowance.', { ...q });
    if (sub && (r.includedFree || sub.premium.includes('*') || sub.premium.includes(r.id))) return out('subscription', `Included in demo plan ${sub.label}.`, { ...q });
    if (p.x402Eligible !== false) return out('x402', 'Premium data is optional: available via x402 pay-per-request (never a cost of basic participation).', { ...q, x402: { optional: true } });
    return out('deny', 'Premium data not included in the free allowance or a plan, and x402 pay-per-request is disabled for this participant. Basic participation and essential functions are unaffected.', { ...q });
  }
}
