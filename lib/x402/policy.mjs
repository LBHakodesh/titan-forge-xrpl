// Rate limiting and the agent x402 spend policy. Guardian (lib/guardian.mjs) is consulted on every decision.
import { guardCheck } from '../guardian.mjs';
import { APPROVED_NETWORKS } from './protocol.mjs';

export class RateLimiter {
  constructor({ limit = 20, windowMs = 60_000, now = () => Date.now() } = {}) { Object.assign(this, { limit, windowMs, now }); this.hits = new Map(); }
  check(key) {
    const t = this.now();
    const arr = (this.hits.get(key) || []).filter((x) => t - x < this.windowMs);
    const ok = arr.length < this.limit;
    if (ok) arr.push(t);
    this.hits.set(key, arr);
    if (this.hits.size > 5000) this.hits.delete(this.hits.keys().next().value);
    return { ok, used: arr.length, limit: this.limit, windowMs: this.windowMs, retryAfterSec: ok ? 0 : Math.ceil((this.windowMs - (t - arr[0])) / 1000) };
  }
}

export const DEFAULT_AGENT_POLICY = Object.freeze({
  allowedEndpoints: ['wake', 'capital', 'book'],
  maxPriceDrops: 60_000,          // 0.06 XRP per request
  sessionBudgetDrops: 150_000,    // 0.15 XRP per agent session
  approvedNetworks: APPROVED_NETWORKS,
  maxRequestsPerMin: 3,
  requireAuthorization: true,     // no unattended spending
});

export function normalizePolicy(p = {}) {
  const d = DEFAULT_AGENT_POLICY;
  const num = (v, def, max) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(Number(v), max) : def);
  return {
    allowedEndpoints: Array.isArray(p.allowedEndpoints) ? p.allowedEndpoints.map(String).slice(0, 10) : [...d.allowedEndpoints],
    maxPriceDrops: num(p.maxPriceDrops, d.maxPriceDrops, 100_000),
    sessionBudgetDrops: num(p.sessionBudgetDrops, d.sessionBudgetDrops, 1_000_000),
    approvedNetworks: Array.isArray(p.approvedNetworks) ? p.approvedNetworks.filter((n) => APPROVED_NETWORKS.includes(n)) : [...d.approvedNetworks],
    maxRequestsPerMin: num(p.maxRequestsPerMin, d.maxRequestsPerMin, 30),
    requireAuthorization: true, // not configurable
  };
}

// Evaluate one proposed purchase. Each check names the control that enforces it.
export function evaluateSpend({ policy, resource, requirements, authorized, spentDrops = 0, rate, mode = 'SIMULATION' }) {
  const amt = Number(requirements.amount);
  const checks = [
    { control: 'spend-policy', rule: 'explicit authorization', ok: authorized === true, detail: authorized === true ? 'Operator authorized this agent session.' : 'No authorization: the agent never spends unattended.' },
    { control: 'spend-policy', rule: 'allowed endpoint', ok: policy.allowedEndpoints.includes(resource), detail: `${resource} ${policy.allowedEndpoints.includes(resource) ? 'is' : 'is not'} on the allow-list.` },
    { control: 'spend-policy', rule: 'approved network', ok: policy.approvedNetworks.includes(requirements.network), detail: `Network ${requirements.network}.` },
    { control: 'spend-policy', rule: 'max price per request', ok: amt <= policy.maxPriceDrops, detail: `${amt / 1e6} XRP vs max ${policy.maxPriceDrops / 1e6} XRP.` },
    { control: 'spend-policy', rule: 'session budget', ok: spentDrops + amt <= policy.sessionBudgetDrops, detail: `Spent ${spentDrops / 1e6} + ${amt / 1e6} vs budget ${policy.sessionBudgetDrops / 1e6} XRP.` },
  ];
  if (rate) checks.push({ control: 'rate-limiter', rule: 'requests per minute', ok: rate.ok, detail: `${rate.used}/${rate.limit} in window.` });
  const live = mode === 'LIVE_TESTNET';
  const g = live
    ? guardCheck({ mode, txType: 'Payment', role: 'router', amountXrp: amt / 1e6, requiresApproval: true, approved: authorized === true })
    : guardCheck({ mode });
  checks.push({ control: 'guardian', rule: live ? 'LIVE_TESTNET Payment boundaries' : 'mode boundaries', ok: g.allowed, detail: g.allowed ? 'Guardian allowed.' : g.reasons.join(' ') });
  const failed = checks.filter((c) => !c.ok);
  return { allowed: failed.length === 0, checks, blockedBy: failed[0]?.control || null, reasons: failed.map((c) => `${c.rule}: ${c.detail}`), guardian: g };
}
