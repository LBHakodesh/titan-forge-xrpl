// x402 telemetry with provenance. Three books kept strictly apart:
//   OBSERVED   — this server's real HTTP request handling (any client, including curl)
//   SIMULATION — in-process demo runs (flow visualizer, agent demo, attack lab)
//   REPLAY     — replays of recorded runs
// Counting rules (tested): a 402 challenge is never a payment; nothing counts as settled without settlement evidence;
// revenue accrues only from settlement evidence, split by network + asset + evidence kind.
import { shortAddr } from './protocol.mjs';

export const PROVENANCE = ['OBSERVED', 'SIMULATION', 'REPLAY'];
const HEX64 = /^[0-9A-F]{64}$/i;

export function validEvidence(ev) {
  if (!ev || typeof ev !== 'object' || !HEX64.test(ev.transaction || '')) return false;
  if (!/^\d+$/.test(String(ev.amountDrops ?? ''))) return false;
  if (ev.kind === 'LIVE_TESTNET_VALIDATED') return ev.validated === true && ev.result === 'tesSUCCESS' && String(ev.deliveredDrops) === String(ev.amountDrops);
  if (ev.kind === 'SIMULATED_FIXTURE') return ev.simulated === true;
  return false;
}

const emptyBook = () => ({
  requests: 0, challenges: 0, verifiedPaid: 0, verificationFailures: 0, settlementConfirmations: 0, settlementFailures: 0,
  freeServed: 0, denied: 0, serverErrors: 0, responses: 0, rejectedEvidence: 0,
  revenue: {}, guardian: { allowed: 0, denied: 0 }, incidents: {}, agent: { runs: 0, purchases: 0, spentDrops: 0, blocked: 0 },
});

function pct(sorted, p) { if (!sorted.length) return null; const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1); return sorted[Math.max(0, i)]; }

export class Telemetry {
  constructor({ now = () => Date.now(), maxEvents = 400, startedAt } = {}) {
    this.now = now; this.maxEvents = maxEvents; this.startedAt = startedAt ?? now();
    this.books = Object.fromEntries(PROVENANCE.map((p) => [p, emptyBook()]));
    this.events = []; this.latency = new Map(); this.reqTimes = Object.fromEntries(PROVENANCE.map((p) => [p, []])); this.seq = 0;
  }

  // e: { provenance, mode, kind, endpoint, status?, latencyMs?, network?, asset?, reason?, control?, evidence?, payer?, note? }
  record(e) {
    if (!PROVENANCE.includes(e.provenance)) throw new Error(`Bad provenance ${e.provenance}`);
    const b = this.books[e.provenance];
    let kind = e.kind;
    if ((kind === 'settled' || kind === 'delivered_paid') && !validEvidence(e.evidence)) { b.rejectedEvidence++; kind = kind === 'settled' ? 'settle_failed' : 'delivered_unpaid'; e = { ...e, reason: e.reason || 'no_settlement_evidence' }; }
    switch (kind) {
      case 'request': b.requests++; this.reqTimes[e.provenance].push(this.now()); break;
      case 'challenge': b.challenges++; break;
      case 'verify_failed': b.verificationFailures++; break;
      case 'settled': {
        b.settlementConfirmations++;
        const k = `${e.evidence.network}|${e.evidence.asset}|${e.evidence.kind}`;
        b.revenue[k] = (b.revenue[k] || 0) + Number(e.evidence.amountDrops);
        break;
      }
      case 'settle_failed': b.settlementFailures++; break;
      case 'delivered_paid': b.verifiedPaid++; break;
      case 'free': b.freeServed++; break;
      case 'denied': b.denied++; break;
      case 'rejected': b.incidents[e.control || 'unknown'] = (b.incidents[e.control || 'unknown'] || 0) + 1; break;
      case 'guardian': b.guardian[e.allowed ? 'allowed' : 'denied']++; break;
      case 'agent_run': b.agent.runs++; break;
      case 'agent_purchase': b.agent.purchases++; b.agent.spentDrops += validEvidence(e.evidence) ? Number(e.evidence.amountDrops) : 0; break;
      case 'agent_blocked': b.agent.blocked++; break;
      default: break;
    }
    if (e.status != null) {
      b.responses++; if (e.status >= 500) b.serverErrors++;
      if (e.latencyMs != null) {
        const key = `${e.provenance}|${e.endpoint}`;
        const arr = this.latency.get(key) || []; arr.push(e.latencyMs); if (arr.length > 500) arr.shift(); this.latency.set(key, arr);
      }
    }
    const ev = {
      id: ++this.seq, at: new Date(this.now()).toISOString(), provenance: e.provenance, mode: e.mode || null, kind, endpoint: e.endpoint || null,
      network: e.network || null, asset: e.asset || null, status: e.status ?? null, latencyMs: e.latencyMs ?? null,
      reason: e.reason || null, control: e.control || null, payer: shortAddr(e.payer), note: e.note || null,
      evidence: e.evidence && validEvidence(e.evidence) ? { kind: e.evidence.kind, transaction: e.evidence.transaction, explorer: e.evidence.explorer || null, ledger: e.evidence.ledger ?? null } : null,
    };
    this.events.push(ev); if (this.events.length > this.maxEvents) this.events.shift();
    return ev;
  }

  snapshot() {
    const t = this.now();
    const out = { generatedAt: new Date(t).toISOString(), uptimeSec: Math.round((t - this.startedAt) / 1000), books: {} };
    for (const p of PROVENANCE) {
      const b = this.books[p];
      this.reqTimes[p] = this.reqTimes[p].filter((x) => t - x < 60_000);
      const lat = {};
      for (const [k, arr] of this.latency) {
        if (!k.startsWith(p + '|')) continue;
        const s = [...arr].sort((x, y) => x - y);
        lat[k.slice(p.length + 1)] = { n: s.length, p50: pct(s, 50), p95: pct(s, 95) };
      }
      out.books[p] = {
        ...structuredClone(b), requestsPerMin: this.reqTimes[p].length,
        availability: b.responses ? +(1 - b.serverErrors / b.responses).toFixed(4) : null,
        latency: lat,
        revenue: Object.entries(b.revenue).map(([k, drops]) => { const [network, asset, evidenceKind] = k.split('|'); return { network, asset, evidenceKind, drops, xrp: drops / 1e6, realValue: false }; }),
      };
    }
    out.note = 'Revenue rows come only from settlement evidence. LIVE_TESTNET_VALIDATED = validated Testnet tesSUCCESS (no monetary value); SIMULATED_FIXTURE = local fixture, nothing broadcast.';
    return out;
  }
  recent(n = 100, provenance) { const ev = provenance ? this.events.filter((e) => e.provenance === provenance) : this.events; return ev.slice(-n); }
}
