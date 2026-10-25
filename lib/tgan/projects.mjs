// TGAN project source. TGAN CONSUMES the Project Incubator (GET /api/incubator/projects[/:id]); it never implements,
// changes or advances incubator state. Until that route responds, a local FIXTURE with the same shape is used and
// badged FIXTURE; TGAN switches to the incubator automatically when it answers.

export const FIXTURE_LABEL = 'FIXTURE — local TGAN stand-in with the incubator\'s shape; the Project Incubator API did not respond';

// Same shape as GET /api/incubator/projects. Amounts are illustrative SIMULATION figures.
export const FIXTURE_PROJECTS = [
  {
    id: 'demo-aurora', name: 'Aurora (demo project)', source: 'FIXTURE', token: 'AUR', stage: 'incubation', program: 'XRP_RLUSD_INTERIM',
    capitalStack: { targetUsd: 250_000, sources: { T1: 40_000, T2: 60_000, T3: 50_000, PROJECT: 20_000, PROPRIETARY: 0 } },
    capitalStates: { committedUsd: 170_000, deployedUsd: 120_000, idleUsd: 50_000, mode: 'SIMULATION' },
    gates: { legal: 'PENDING', economic: 'NOT_MET' }, outcome: 'STAYS_IN_XRP_RLUSD_INCUBATION', mode: 'SIMULATION',
    performance: {
      mode: 'SIMULATION', source: 'FIXTURE',
      periods: [
        { label: 'Q1', beginValue: 100_000, endValue: 96_500, deposits: 0, withdrawals: 0, expenses: 500, realizedPnl: -1_800, unrealizedPnl: -1_700, deployedUsd: 70_000 },
        { label: 'Q2', beginValue: 96_000, endValue: 121_000, deposits: 20_000, withdrawals: 0, expenses: 600, realizedPnl: 2_900, unrealizedPnl: 400, deployedUsd: 95_000 },
        { label: 'Q3', beginValue: 120_400, endValue: 124_900, deposits: 0, withdrawals: 2_000, expenses: 700, realizedPnl: 5_200, unrealizedPnl: 1_700, deployedUsd: 110_000 },
      ],
    },
  },
  {
    id: 'demo-beacon', name: 'Beacon (demo project)', source: 'FIXTURE', token: 'BCN', stage: 'graduated', program: 'PROJECT_TOKEN_CORRIDOR',
    capitalStack: { targetUsd: 500_000, sources: { T1: 90_000, T2: 160_000, T3: 150_000, PROJECT: 60_000, PROPRIETARY: 40_000 } },
    capitalStates: { committedUsd: 500_000, deployedUsd: 430_000, idleUsd: 70_000, mode: 'SIMULATION' },
    gates: { legal: 'PASSED', economic: 'MET' }, outcome: 'GRADUATED_TO_PROJECT_TOKEN_CORRIDOR', mode: 'SIMULATION',
    performance: {
      mode: 'REPLAY', source: 'FIXTURE',
      periods: [
        { label: 'Q1', beginValue: 100_000, endValue: 112_000, deposits: 0, withdrawals: 0, expenses: 2_000, realizedPnl: 8_000, unrealizedPnl: 4_000, deployedUsd: 85_000 },
        { label: 'Q2', beginValue: 110_000, endValue: 105_000, deposits: 0, withdrawals: 0, expenses: 0, realizedPnl: -3_000, unrealizedPnl: 2_000, deployedUsd: 90_000 },
        { label: 'Q3', beginValue: 105_000, endValue: 163_000, deposits: 50_000, withdrawals: 0, expenses: 0, realizedPnl: 6_000, unrealizedPnl: 4_000, deployedUsd: 140_000 },
      ],
    },
  },
];

const gateStatus = (g) => {
  if (g == null) return 'UNKNOWN';
  if (typeof g === 'string') return g.toUpperCase();
  if (typeof g === 'boolean') return g ? 'PASSED' : 'NOT_MET';
  return String(g.status ?? g.state ?? (g.passed === true ? 'PASSED' : g.passed === false ? 'NOT_MET' : 'UNKNOWN')).toUpperCase();
};
const amt = (v) => (typeof v === 'number' ? v : Number(v?.usd ?? v?.amountUsd ?? v?.committedUsd ?? v?.valueUsd ?? 0) || 0);

// Sum of EXECUTABLE across sources when the incubator reports per-source capital states; null otherwise.
const executable = (cs) => {
  if (!cs || typeof cs !== 'object') return null;
  const vals = Object.values(cs).map((v) => (v && typeof v === 'object' ? Number(v.EXECUTABLE) : NaN)).filter(Number.isFinite);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
};

// Normalize one incubator project to the fields TGAN reads. Keeps the raw gate objects for display.
export function normalizeProject(p, origin) {
  const sources = p?.capitalStack?.sources || {};
  return {
    id: String(p.id), name: p.name || p.id, source: p.source ?? null, stage: p.stage ?? null,
    // Incubator tokens are { network, currency, issuer }; TGAN compares by currency code.
    token: p.token == null ? null : typeof p.token === 'object' ? (p.token.currency ?? p.token.code ?? null) : String(p.token),
    tokenInfo: p.token && typeof p.token === 'object' ? p.token : null,
    program: p.program || 'NONE', mode: p.mode || 'SIMULATION', outcome: p.outcome ?? null,
    capitalStack: { targetUsd: amt(p?.capitalStack?.targetUsd), sources: Object.fromEntries(['T1', 'T2', 'T3', 'PROJECT', 'PROPRIETARY'].map((k) => [k, amt(sources[k])])) },
    capitalStates: p.capitalStates ?? null,
    executableUsd: executable(p.capitalStates),
    gates: { legal: gateStatus(p?.gates?.legal), economic: gateStatus(p?.gates?.economic), raw: p.gates ?? null },
    performance: p.performance ?? null,
    origin, // 'INCUBATOR' | 'FIXTURE'
  };
}

// ProjectSource: fetchJson(path) is injected (loopback fetch in the route, a stub in tests).
export class ProjectSource {
  constructor({ fetchJson = null, routeExists = () => false, ttlMs = 10_000, now = () => Date.now() } = {}) {
    Object.assign(this, { fetchJson, routeExists, ttlMs, now });
    this.cache = null; this.lastError = null;
  }
  async list() {
    if (this.cache && this.now() - this.cache.at < this.ttlMs) return this.cache.value;
    let value;
    if (this.fetchJson && this.routeExists('/api/incubator/projects')) {
      try {
        const b = await this.fetchJson('/api/incubator/projects');
        const arr = Array.isArray(b?.projects) ? b.projects : Array.isArray(b) ? b : null;
        if (!arr) throw new Error('unexpected incubator response shape');
        value = { origin: 'INCUBATOR', label: 'Project Incubator (GET /api/incubator/projects)', projects: arr.map((p) => normalizeProject(p, 'INCUBATOR')) };
        this.lastError = null;
      } catch (e) { this.lastError = e.message; }
    } else this.lastError = 'GET /api/incubator/projects is not registered on this node yet';
    if (!value) value = { origin: 'FIXTURE', label: FIXTURE_LABEL, error: this.lastError, projects: FIXTURE_PROJECTS.map((p) => normalizeProject(p, 'FIXTURE')) };
    this.cache = { at: this.now(), value };
    return value;
  }
  async get(id) {
    const l = await this.list();
    let p = l.projects.find((x) => x.id === id) || null;
    // Detail endpoint may carry more (e.g. performance); prefer it when the incubator is live.
    if (l.origin === 'INCUBATOR' && this.fetchJson) {
      try {
        const b = await this.fetchJson(`/api/incubator/projects/${encodeURIComponent(id)}`);
        const d = b?.project || b;
        if (d?.id) p = normalizeProject(d, 'INCUBATOR');
      } catch { /* list entry is enough */ }
    }
    return p ? { project: p, origin: l.origin, label: l.label } : null;
  }
}
