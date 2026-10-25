// GYW1313 Liquidity Observatory (Titan View): 26 spokes around the XRP hub.
// Pick an asset, watch executed value move spoke -> XRP -> spoke, see which maker captured each fill,
// and see how funded depth changes the routes that are available.
// Pure helpers are exported for node:test (test/observatory.test.mjs); DOM code lives in mount().
// Provenance rule: executed flows are only MAINNET_OBSERVED, LIVE_TESTNET (validated hash) or REPLAY,
// drawn as solid moving particles. Candidate/pathfinder routes are dashed, static and labeled SIMULATION.
// Fixture data (public/observatory-fixture.json) is always badged FIXTURE.
import { RINGS, STAGES } from '../domain.js';

export const STATUSES = ['MAINNET_OBSERVED', 'TESTNET_FUNDED', 'TESTNET_CANDIDATE', 'SIMULATION', 'REPLAY', 'UNAVAILABLE'];
export const FRESHNESS = ['live', 'cached', 'unavailable'];
export const TX_KINDS = ['MAINNET_OBSERVED', 'LIVE_TESTNET', 'REPLAY'];
export const ROLES = ['titan', 'rival', 'other', 'amm'];
export const SPEEDS = [0.25, 0.5, 1, 2, 4];
const EXECUTED = new Set(TX_KINDS);
const KIND_NET = { MAINNET_OBSERVED: 'mainnet', LIVE_TESTNET: 'testnet' };

// ---------- pure helpers ----------

// Status -> visual encoding. Every status differs by more than color: stroke pattern, fill and a text code.
export const STATUS_STYLE = {
  MAINNET_OBSERVED: { cls: 'st-mainnet', code: 'OBS', label: 'Mainnet observed (read-only)', badge: 'mainnet', dash: null, filled: false, double: false, blocked: false, live: false, desc: 'Read-only Mainnet statistics. Nothing is ever signed on Mainnet.' },
  TESTNET_FUNDED: { cls: 'st-funded', code: 'LIVE', label: 'Testnet funded (live)', badge: 'live', dash: null, filled: true, double: false, blocked: false, live: true, desc: 'Funded Testnet book. Executions here are validated Testnet transactions.' },
  TESTNET_CANDIDATE: { cls: 'st-candidate', code: 'CAND', label: 'Testnet candidate (unfunded)', badge: 'cand', dash: '7 5', filled: false, double: false, blocked: false, live: false, desc: 'Testnet spoke exists but has no funded book yet.' },
  SIMULATION: { cls: 'st-sim', code: 'SIM', label: 'Simulation', badge: 'sim', dash: '2 5', filled: true, double: false, blocked: false, live: false, desc: 'Modeled only. No ledger activity.' },
  REPLAY: { cls: 'st-replay', code: 'RPL', label: 'Replay', badge: 'replay', dash: null, filled: false, double: true, blocked: false, live: false, desc: 'Recorded sequence played back. Not happening now.' },
  UNAVAILABLE: { cls: 'st-blocked', code: 'OFF', label: 'Unavailable / blocked', badge: 'bad', dash: '3 3', filled: false, double: false, blocked: true, live: false, desc: 'Blocked by an eligibility check or missing data.' },
};
// Unknown statuses are treated as blocked, never as live.
const COUNT_LABEL = { MAINNET_OBSERVED: 'Mainnet observed', TESTNET_FUNDED: 'Testnet funded', TESTNET_CANDIDATE: 'Testnet candidate', SIMULATION: 'Simulation', REPLAY: 'Replay', UNAVAILABLE: 'Unavailable' };
export function statusStyle(status) { return STATUS_STYLE[status] || STATUS_STYLE.UNAVAILABLE; }

export const isHash = (h) => typeof h === 'string' && /^[0-9A-F]{64}$/i.test(h);

// 'executed' (solid animated particle), 'candidate' (dashed static, never animated) or 'invalid' (not drawn).
export function classifyFlow(r) {
  if (!r || typeof r !== 'object') return 'invalid';
  if (r.candidate === true || r.suggested === true || r.executed === false) return 'candidate';
  if (!EXECUTED.has(r.kind)) return 'candidate';
  if (KIND_NET[r.kind] && r.network && r.network !== KIND_NET[r.kind]) return 'invalid'; // e.g. LIVE_TESTNET claiming mainnet
  if (r.kind !== 'REPLAY' && !isHash(r.hash)) return 'candidate'; // no validated hash -> not proven executed
  return 'executed';
}

// Badge for a timeline event / tx. fixture=true adds the FIXTURE flag; it never upgrades the mode.
export function provenance(r, { fixture = false } = {}) {
  const cls = classifyFlow(r);
  let mode, label;
  if (cls === 'executed') { mode = r.kind; label = r.kind.replace(/_/g, ' '); }
  else if (cls === 'candidate') { mode = 'SIMULATION'; label = 'CANDIDATE · SIMULATION'; }
  else { mode = 'INVALID'; label = 'UNVERIFIED'; }
  return { mode, label, cls, fixture: !!fixture, animate: cls === 'executed' };
}

export const allSpokes = (body) => [...(body?.groups?.A?.spokes || []), ...(body?.groups?.B?.spokes || [])];

// Positions: XRP hub at (0,0); Group A on the left arc (ranks top->bottom), Group B on the right arc.
// Angle 0 = up, clockwise. Alternating radii keep 13 nodes per arc legible. Collapsed groups -> one aggregate node.
export function layoutSpokes(body, { expanded = { A: true, B: true }, R = 400, k = 1, span = 156 } = {}) {
  const nodeR = +(26 * Math.min(Math.max(k, 1), 1.5)).toFixed(2);
  const nodes = [], aggregates = [];
  const pt = (deg, r) => { const a = (deg * Math.PI) / 180; return { x: +(r * Math.sin(a)).toFixed(2), y: +(-r * Math.cos(a)).toFixed(2) }; };
  for (const g of ['A', 'B']) {
    const list = body?.groups?.[g]?.spokes || [];
    const center = g === 'A' ? 270 : 90;
    if (!expanded[g]) {
      aggregates.push({ group: g, count: list.length, angle: center, r: R * 0.72, nodeR: nodeR * 1.9, ...pt(center, R * 0.72) });
      continue;
    }
    const n = list.length;
    list.forEach((s, i) => {
      const t = n > 1 ? i / (n - 1) : 0.5;
      const angle = g === 'A' ? center + span / 2 - span * t : center - span / 2 + span * t;
      const r = n > 6 && i % 2 ? R * 0.7 : R;
      nodes.push({ id: s.id, group: g, i, angle: +angle.toFixed(3), r: +r.toFixed(2), nodeR, ...pt(angle, r) });
    });
  }
  return { nodes, aggregates, hubR: 70 };
}

// Point at fraction f (0..1) along a polyline of {x,y}.
export function pointAlong(pts, f) {
  if (!pts?.length) return { x: 0, y: 0 };
  if (pts.length === 1 || f <= 0) return { ...pts[0] };
  const seg = []; let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(d); total += d; }
  let want = Math.min(1, f) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) { const u = seg[i] ? Math.min(1, want / seg[i]) : 1; return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * u, y: pts[i].y + (pts[i + 1].y - pts[i].y) * u }; }
    want -= seg[i];
  }
  return { ...pts.at(-1) };
}

const hexToAscii = (h) => { try { return h && /^[0-9A-F]{40}$/i.test(h) ? decodeHex(h) : null; } catch { return null; } };
function decodeHex(h) { let s = ''; for (let i = 0; i < 40; i += 2) { const c = parseInt(h.slice(i, i + 2), 16); if (c) s += String.fromCharCode(c); } return s; }
const curEq = (side, s) => [s.currency, s.currencyHex, s.testnet?.code].filter(Boolean).some((c) => c === side.currency || c === hexToAscii(side.currency));

// 'hub' for XRP, else the matching spoke id (issuer + currency, also the Testnet mirror), else null.
export function matchSpoke(spokes, side) {
  if (!side || (side.currency === 'XRP' && !side.issuer)) return 'hub';
  const hit = spokes.find((s) => (s.issuer === side.issuer || s.testnet?.issuer === side.issuer) && curEq(side, s));
  return hit ? hit.id : null;
}

// Endpoints of a flow: {from, to} each 'hub' | spoke id | null.
export function flowEnds(rec, spokes) {
  const ids = Array.isArray(rec?.spokeIds) ? rec.spokeIds : rec?.spokeId ? [rec.spokeId] : [];
  let from = matchSpoke(spokes, rec?.from), to = matchSpoke(spokes, rec?.to);
  const known = (id) => spokes.some((s) => s.id === id);
  if (from == null && to !== 'hub' && ids[0] && ids[0] !== to && known(ids[0])) from = ids[0];
  if (to == null && from !== 'hub' && ids.at(-1) && ids.at(-1) !== from && known(ids.at(-1))) to = ids.at(-1);
  if (from == null && to === 'hub' && ids[0] && known(ids[0])) from = ids[0];
  if (to == null && from === 'hub' && ids[0] && known(ids[0])) to = ids[0];
  return { from, to };
}

// Deterministic presentation order: by offsetMs, then seq, then time, then hash, then input index.
// Every item becomes kind REPLAY. delay = ms (at 1x) to wait after the previous item.
export function replayOrder(body, { minGap = 400, maxGap = 4000 } = {}) {
  const arr = Array.isArray(body) ? body : ['frames', 'sequence', 'flows', 'events', 'transactions', 'items'].map((k) => body?.[k]).find(Array.isArray) || [];
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  const keyed = arr.filter((x) => x && typeof x === 'object').map((rec, idx) => ({ rec, idx, off: num(rec.offsetMs ?? rec.tMs), seq: num(rec.seq), t: Number.isFinite(Date.parse(rec.at)) ? Date.parse(rec.at) : null }));
  const cmp = (a, b) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : a - b);
  keyed.sort((a, b) => cmp(a.off, b.off) || cmp(a.seq, b.seq) || cmp(a.t, b.t) || String(a.rec.hash || '').localeCompare(String(b.rec.hash || '')) || a.idx - b.idx);
  let prev = null, vt = 0;
  return keyed.map((x, i) => {
    const pos = x.off ?? x.t;
    const gap = i === 0 ? 0 : prev != null && pos != null ? pos - prev : 1500;
    const delay = i === 0 ? 0 : Math.round(Math.min(maxGap, Math.max(minGap, gap)));
    prev = pos ?? prev; vt += delay;
    return { delay, vt, rec: { ...x.rec, kind: 'REPLAY' } };
  });
}

export const sumDepth = (side) => (Array.isArray(side) ? side.reduce((a, b) => a + (Number(b?.xrp) || 0), 0) : 0);

// Modeled routes (SIMULATION, never executed): selling this spoke's token into XRP needs bids here,
// buying the other token with that XRP needs asks there. Capacity = the thinner of the two.
export function candidatePaths(spoke, spokes, { limit = 5 } = {}) {
  if (!spoke) return { paths: [], blocked: 'No spoke selected' };
  if (spoke.status === 'UNAVAILABLE') return { paths: [], blocked: 'Spoke is unavailable or blocked' };
  if (spoke.eligibility && spoke.eligibility.eligible === false) return { paths: [], blocked: 'Fails eligibility: ' + (spoke.eligibility.checks || []).filter((c) => !c.ok).map((c) => c.id).join(', ') };
  const out = sumDepth(spoke.market?.depthXrp?.bids);
  if (!(out > 0)) return { paths: [], blocked: 'No funded bids: nothing can buy this token for XRP yet' };
  const paths = [{ from: spoke.id, to: 'hub', viaXrp: false, capacityXrp: out, kind: 'CANDIDATE', mode: 'SIMULATION' }];
  for (const o of spokes) {
    if (o.id === spoke.id || o.network !== spoke.network || o.status === 'UNAVAILABLE' || o.eligibility?.eligible === false) continue;
    const inn = sumDepth(o.market?.depthXrp?.asks);
    if (inn > 0) paths.push({ from: spoke.id, to: o.id, viaXrp: true, capacityXrp: Math.min(out, inn), kind: 'CANDIDATE', mode: 'SIMULATION' });
  }
  paths.sort((a, b) => b.capacityXrp - a.capacityXrp || String(a.to).localeCompare(String(b.to)));
  return { paths: paths.slice(0, limit), blocked: null, total: paths.length };
}

// Maker capture from executed tx offer owners.
export function captureOf(txs) {
  const c = { titan: 0, rival: 0, other: 0, amm: 0 }; let n = 0;
  for (const t of txs || []) for (const o of t?.offerOwners || []) { const r = ROLES.includes(o?.role) ? o.role : 'other'; c[r]++; n++; }
  return { counts: c, total: n, share: Object.fromEntries(ROLES.map((r) => [r, n ? c[r] / n : 0])) };
}

export function fmtAge(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60 ? (sec % 60) + 's' : ''}`.trim();
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}
export const shortAddr = (a, n = 6) => (a && String(a).length > n * 2 + 1 ? `${String(a).slice(0, n)}…${String(a).slice(-4)}` : String(a ?? ''));
export function amountText(v, cur) {
  if (v == null) return '—';
  if (typeof v === 'object') return `${num(v.value)} ${v.currency || cur || ''}`.trim();
  return `${num(v)} ${cur || ''}`.trim();
}
const num = (x, d = 4) => (x == null || x === '' || !Number.isFinite(Number(x)) ? (x == null ? '—' : String(x)) : Number(x).toLocaleString('en-US', { maximumFractionDigits: d }));

// ---------- contract validation (used by tests on the fixture and at runtime on the API) ----------

const isNumOrNull = (v) => v === null || (typeof v === 'number' && Number.isFinite(v));
export function validateSpoke(s, where = 'spoke') {
  const e = [];
  const req = (cond, msg) => { if (!cond) e.push(`${where}: ${msg}`); };
  if (!s || typeof s !== 'object') return [`${where}: not an object`];
  req(typeof s.id === 'string' && s.id, 'id');
  req(['A', 'B'].includes(s.group), 'group A|B');
  const ph = typeof s.id === 'string' && s.id.startsWith('placeholder:');
  req(s.rank === null || Number.isFinite(s.rank), 'rank number|null');
  req(['mainnet', 'testnet'].includes(s.network), 'network');
  req((typeof s.currency === 'string' && s.currency) || (ph && s.currency === null), 'currency');
  req(s.currencyHex === null || (typeof s.currencyHex === 'string' && /^[0-9A-F]{40}$/i.test(s.currencyHex)), 'currencyHex 40-hex|null');
  req((typeof s.issuer === 'string' && s.issuer) || (ph && s.issuer === null), 'issuer');
  req(typeof s.name === 'string', 'name');
  req(STATUSES.includes(s.status), `status ${s.status}`);
  req(typeof s.eligibility?.eligible === 'boolean' && Array.isArray(s.eligibility?.checks) && s.eligibility.checks.every((c) => typeof c.id === 'string' && typeof c.ok === 'boolean' && 'detail' in c), 'eligibility');
  const m = s.market;
  req(m && ['vol24hXrp', 'bid', 'ask', 'spreadBps'].every((k) => isNumOrNull(m[k])), 'market numbers|null');
  req(m && ['bids', 'asks'].every((k) => Array.isArray(m.depthXrp?.[k]) && m.depthXrp[k].every((b) => typeof b.band === 'string' && Number.isFinite(b.xrp))), 'market.depthXrp');
  req(m && (m.amm === null || typeof m.amm === 'object') && 'observedAt' in m, 'market.amm/observedAt');
  req(s.testnet === null || (s.testnet && 'code' in s.testnet && 'issuer' in s.testnet && typeof s.testnet.funded === 'boolean' && 'book' in s.testnet), 'testnet');
  req(s.corridor && typeof s.corridor.stage === 'string' && 'recommendation' in s.corridor && s.corridor.mode === 'SIMULATION' && typeof s.corridor.engineLabel === 'string', 'corridor (mode must be SIMULATION)');
  const f = s.flows;
  req(f && ['validated', 'mainnetObserved', 'liveTestnet'].every((k) => Number.isFinite(f[k])) && isNumOrNull(f.titanShare) && isNumOrNull(f.rivalShare), 'flows');
  req(Array.isArray(s.alerts) && s.alerts.every((a) => typeof a.severity === 'string' && typeof a.text === 'string'), 'alerts');
  return e;
}

export function validateSpokes(body) {
  const e = [];
  if (!body || typeof body !== 'object') return ['body: not an object'];
  if (body.hub?.currency !== 'XRP') e.push('hub.currency must be XRP');
  const sn = body.snapshot;
  if (!sn || !['source', 'fetchedAt', 'attribution'].every((k) => k in sn) || !FRESHNESS.includes(sn.freshness) || !isNumOrNull(sn.ageSec) || !isNumOrNull(sn.refreshMin)) e.push('snapshot');
  for (const g of ['A', 'B']) {
    const grp = body.groups?.[g];
    if (!grp || typeof grp.title !== 'string' || !Array.isArray(grp.spokes)) { e.push(`groups.${g}`); continue; }
    if (grp.spokes.length !== 13) e.push(`groups.${g}: expected 13 spokes, got ${grp.spokes.length}`);
    grp.spokes.forEach((s, i) => { e.push(...validateSpoke(s, `groups.${g}[${i}]`)); if (s?.group && s.group !== g) e.push(`groups.${g}[${i}]: group mismatch`); });
  }
  const sp = allSpokes(body);
  if (new Set(sp.map((s) => s.id)).size !== sp.length) e.push('duplicate spoke ids');
  const c = body.counts;
  if (!c) e.push('counts');
  else {
    for (const k of ['displayed', ...STATUSES, 'eligible']) if (!Number.isFinite(c[k])) e.push(`counts.${k}`);
    const real = sp.filter((x) => !String(x?.id).startsWith('placeholder:')).length; // placeholders fill empty slots
    if (c.displayed !== sp.length && c.displayed !== real) e.push(`counts.displayed ${c.displayed} != ${sp.length}`);
    for (const st of STATUSES) if (Number.isFinite(c[st]) && c[st] !== sp.filter((s) => s.status === st).length) e.push(`counts.${st} mismatch`);
    if (Number.isFinite(c.eligible) && c.eligible !== sp.filter((s) => s.eligibility?.eligible).length) e.push('counts.eligible mismatch');
  }
  const cv = body.coverage;
  if (!cv || !['mainnetLedgersScanned', 'mainnetPaymentsMatched'].every((k) => isNumOrNull(cv[k])) || !('from' in cv) || !('to' in cv)) e.push('coverage');
  return e;
}

export function validateTx(t, where = 'tx') {
  const e = [];
  const req = (cond, msg) => { if (!cond) e.push(`${where}: ${msg}`); };
  if (!t || typeof t !== 'object') return [`${where}: not an object`];
  req(typeof t.hash === 'string', 'hash');
  req(Number.isFinite(t.ledger), 'ledger');
  req(['mainnet', 'testnet'].includes(t.network), 'network');
  req(TX_KINDS.includes(t.kind), `kind ${t.kind}`);
  req(typeof t.at === 'string' && Number.isFinite(Date.parse(t.at)), 'at');
  req(t.from && typeof t.from.currency === 'string' && 'issuer' in t.from && t.to && typeof t.to.currency === 'string' && 'issuer' in t.to, 'from/to');
  req(t.viaXrp === true || t.viaXrp === false || t.viaXrp === null, 'viaXrp bool|null');
  req('delivered' in t && 'rate' in t && typeof t.partial === 'boolean', 'delivered/rate/partial');
  req(Array.isArray(t.offerOwners) && t.offerOwners.every((o) => typeof o.account === 'string' && ROLES.includes(o.role)), 'offerOwners');
  req('depthAfter' in t && typeof t.explorer === 'string', 'depthAfter/explorer');
  return e;
}
export function validateDetail(b) {
  if (!b || typeof b !== 'object') return ['detail: not an object'];
  return [...validateSpoke(b.spoke, 'detail.spoke'), ...(Array.isArray(b.transactions) ? b.transactions.flatMap((t, i) => validateTx(t, `detail.tx[${i}]`)) : ['detail.transactions'])];
}

export function explorerFor(t) {
  if (typeof t?.explorer === 'string' && /^https:\/\/(testnet|livenet)\.xrpl\.org\//.test(t.explorer)) return t.explorer;
  if (!isHash(t?.hash)) return null;
  return `https://${t.network === 'mainnet' ? 'livenet' : 'testnet'}.xrpl.org/transactions/${t.hash}`;
}

// ---------- DOM ----------

const NS = 'http://www.w3.org/2000/svg';
const STYLE = `
.obs{--obs-titan:#2a78d6;--obs-rival:#eb6834;--obs-other:#8a8f98;--obs-amm:#8a5a00;--obs-cand:var(--sim)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .obs{--obs-titan:#3987e5;--obs-rival:#d95926;--obs-other:#6f7681;--obs-amm:#f0b443}}
:root[data-theme="dark"] .obs{--obs-titan:#3987e5;--obs-rival:#d95926;--obs-other:#6f7681;--obs-amm:#f0b443}
.obs{min-width:0}
.obs .obs-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.obs .obs-bar h2{margin:0 auto 0 0;display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-width:0}
.obs .obs-bar h2 small{font-weight:400;font-size:13px;color:var(--muted)}
.obs button.ghost{min-height:36px}
.obs button.ghost[aria-pressed="true"]{border-color:var(--accent);color:var(--accent)}
.obs .obs-counts{display:grid;gap:6px;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));margin:12px 0 8px}
.obs .obs-count{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:6px 8px;min-width:0}
.obs .obs-count b{display:block;font-size:19px;line-height:1.2;font-variant-numeric:tabular-nums}
@media (max-width:600px){.obs .obs-count{padding:4px 6px}.obs .obs-count b{font-size:16px}.obs .obs-count span{font-size:11px;line-height:1.25}}
.obs .obs-count span{font-size:12px;color:var(--muted);display:flex;gap:5px;align-items:center}
.obs .obs-attr{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--muted);align-items:center}
.obs .obs-attr b{color:var(--ink);font-weight:600}
.obs .badge.cand{color:var(--live);background:none;border:1px dashed var(--live)}
.obs .badge.fx{color:var(--bad);background:var(--bad-bg);border:1px dashed var(--bad)}
.obs .obs-ctl{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin-bottom:8px}
.obs .obs-ctl label{display:flex;gap:6px;align-items:center;margin:0;color:var(--ink)}
.obs .obs-ctl input[type=range]{width:120px;padding:0}
.obs .obs-main{display:grid;gap:16px;grid-template-columns:minmax(0,1fr)}
@media (min-width:980px){.obs .obs-main{grid-template-columns:minmax(0,1fr) 380px}}
.obs .obs-stage{min-width:0;position:relative}
.obs svg.obs-svg{display:block;width:100%;height:auto;max-height:80vh;margin:0 auto;font-family:system-ui,-apple-system,Segoe UI,sans-serif;touch-action:manipulation}
.obs .obs-replay-on svg.obs-svg{outline:2px dashed var(--replay);outline-offset:-2px;border-radius:8px}
.obs .obs-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--muted);margin-top:8px}
.obs .obs-legend span{display:inline-flex;gap:5px;align-items:center}
.obs .obs-legend svg{flex:none}
.obs .obs-side{min-width:0;font-size:14px}
.obs .obs-side section{border-top:1px solid var(--line);padding:10px 0}
.obs .obs-side h3{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.obs .obs-kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 10px;margin:0;font-size:13px}
.obs .obs-kv dt{color:var(--muted)} .obs .obs-kv dd{margin:0;overflow-wrap:anywhere;min-width:0}
.obs .obs-checks{list-style:none;padding:0;margin:0;font-size:13px}
.obs .obs-checks li{padding:2px 0} .obs .obs-checks .ok{color:var(--live);font-weight:700} .obs .obs-checks .no{color:var(--bad);font-weight:700}
.obs .obs-depth{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:3px 6px;align-items:center;font-size:12px}
.obs .obs-depth .bl{display:flex;justify-content:flex-end}
.obs .obs-depth i{display:block;height:12px;border-radius:3px;min-width:2px}
.obs .obs-depth .bid i{background:var(--live)} .obs .obs-depth .ask i{background:var(--replay)}
.obs .obs-depth .band{font-family:var(--mono);color:var(--muted);text-align:center}
.obs .obs-cap{display:flex;height:14px;border-radius:4px;overflow:hidden;gap:2px;background:var(--panel);margin:4px 0}
.obs .obs-cap span{display:block;height:100%}
.obs .obs-key{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--muted)}
.obs .obs-key i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.obs .obs-rings{width:100%;font-size:12px;table-layout:fixed}
.obs .obs-rings td{overflow-wrap:anywhere}
.obs .obs-txs{list-style:none;padding:0;margin:0}
.obs .obs-tx{border:1px solid var(--line);border-left:4px solid var(--c,var(--line));border-radius:6px;padding:6px 8px;margin:6px 0;font-size:13px;min-width:0}
.obs .obs-tx.k-MAINNET_OBSERVED{--c:var(--accent)} .obs .obs-tx.k-LIVE_TESTNET{--c:var(--live)} .obs .obs-tx.k-REPLAY{--c:var(--replay)}
.obs .obs-tx .mono{font-size:11px}
.obs .obs-paths{border:2px dashed var(--obs-cand);border-radius:8px;padding:8px 10px;margin-top:6px;background:var(--sim-bg)}
.obs .obs-paths ol{padding-left:18px;margin:6px 0;font-size:13px}
.obs .obs-pbar{display:block;height:6px;border-radius:3px;background:repeating-linear-gradient(90deg,var(--obs-cand) 0 6px,transparent 6px 9px);margin-top:2px}
.obs .obs-tl{list-style:none;margin:0;padding:0;font-size:13px;max-height:360px;overflow-y:auto}
.obs .obs-tl li{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline;padding:5px 0;border-bottom:1px solid var(--line);min-width:0}
.obs .obs-tl li .t{overflow-wrap:anywhere;min-width:0;flex:1 1 200px}
.obs .obs-tl time{font:11px var(--mono);color:var(--muted);flex:none}
.obs .obs-tl button.lnk{background:none;border:0;padding:0;color:var(--accent);font:inherit;cursor:pointer;text-align:left}
.obs .obs-note{font-size:12px;color:var(--muted)}
.obs .obs-warn{background:var(--sim-bg);border-left:4px solid var(--sim);padding:6px 10px;border-radius:6px;font-size:13px;margin:8px 0}
.obs .obs-fxwarn{background:var(--bad-bg);border-left:4px solid var(--bad);padding:6px 10px;border-radius:6px;font-size:13px;margin:8px 0}
/* SVG */
.obs .o-txt{fill:var(--ink)} .obs .o-sub{fill:var(--muted)}
.obs .o-hub{fill:var(--panel);stroke:var(--ink);stroke-width:5} .obs .o-hubglow{fill:var(--accent);opacity:.1}
.obs .o-spoke{stroke:var(--line);stroke-width:3}
.obs .o-spoke.blocked{stroke-dasharray:6 8}
.obs .o-spoke.sel{stroke:var(--accent);stroke-width:5}
.obs .st-mainnet{--c:var(--accent);--f:var(--panel)} .obs .st-funded{--c:var(--live);--f:var(--live-bg)} .obs .st-candidate{--c:var(--live);--f:var(--panel)}
.obs .st-sim{--c:var(--sim);--f:var(--sim-bg)} .obs .st-replay{--c:var(--replay);--f:var(--panel)} .obs .st-blocked{--c:var(--muted);--f:var(--panel)}
.obs .o-node{cursor:pointer;outline:none}
.obs .o-node .hit{fill:transparent;stroke:none;pointer-events:all}
.obs .o-node .core{fill:var(--f);stroke:var(--c);stroke-width:4}
.obs .o-node.st-funded .core{stroke-width:6}
.obs .o-node.st-candidate .core{stroke-dasharray:7 5}
.obs .o-node.st-sim .core{stroke-dasharray:2 5;stroke-linecap:round}
.obs .o-node .outer{fill:none;stroke:var(--c);stroke-width:2.5;display:none} .obs .o-node.st-replay .outer{display:block}
.obs .o-node.st-blocked{opacity:.62} .obs .o-node.st-blocked .core{stroke-dasharray:3 3}
.obs .o-node .slash{stroke:var(--c);stroke-width:3;display:none} .obs .o-node.st-blocked .slash{display:block}
.obs .o-node .code{fill:var(--c);font-family:var(--mono);font-weight:700}
.obs .o-node .sel-ring{fill:none;stroke:var(--accent);stroke-width:4;display:none}
.obs .o-node.sel .sel-ring,.obs .o-node:focus-visible .sel-ring{display:block}
.obs .o-node:focus-visible .sel-ring{stroke-dasharray:6 4}
.obs .o-node .warn{fill:var(--sim)} .obs .o-node .warn.hi{fill:var(--bad)}
.obs .o-agg{cursor:pointer;outline:none} .obs .o-agg .core{fill:var(--bg);stroke:var(--muted);stroke-width:3;stroke-dasharray:10 6}
.obs .o-agg:focus-visible .core{stroke:var(--accent);stroke-width:5}
.obs .o-gtitle{cursor:pointer;fill:var(--ink);font-weight:700} .obs .o-gtitle:focus-visible{outline:2px solid var(--accent)}
.obs .o-cand{fill:none;stroke:var(--obs-cand);stroke-width:3;stroke-dasharray:10 8;opacity:.95}
.obs .o-candlbl{fill:var(--sim);font-family:var(--mono);font-weight:700}
.obs .o-trail{fill:none;stroke-width:6;stroke-linecap:round;stroke-linejoin:round}
.obs .o-p{stroke:var(--panel);stroke-width:3}
.obs .k-MAINNET_OBSERVED{--k:var(--accent)} .obs .k-LIVE_TESTNET{--k:var(--live)} .obs .k-REPLAY{--k:var(--replay)}
.obs .o-trail{stroke:var(--k)} .obs .o-p{fill:var(--k)} .obs .o-plbl{fill:var(--k);font-family:var(--mono);font-weight:700;paint-order:stroke;stroke:var(--panel);stroke-width:5px}
.obs .o-banner{font-family:var(--mono);font-weight:700}
.obs .o-m-LIVE{fill:var(--live)} .obs .o-m-REPLAY{fill:var(--replay)} .obs .o-m-FIXTURE{fill:var(--bad)}
.obs.obs-full{position:fixed;inset:0;z-index:1000;background:var(--bg);overflow:auto;padding:12px}
.obs:fullscreen{background:var(--bg);overflow:auto;padding:12px}
.obs.obs-full svg.obs-svg,.obs:fullscreen svg.obs-svg{max-height:calc(100vh - 230px)}
.obs.obs-full #obs-srcnote,.obs:fullscreen #obs-srcnote{display:none}
.obs.obs-full .card,.obs:fullscreen .card{padding:10px;margin-bottom:8px}
.obs.obs-full .obs-counts,.obs:fullscreen .obs-counts{grid-template-columns:repeat(auto-fit,minmax(84px,1fr));margin:6px 0 4px}
.obs.obs-full .obs-count b,.obs:fullscreen .obs-count b{font-size:16px}
@media (prefers-reduced-motion:reduce){.obs *{transition:none!important;animation:none!important}}
`;

function svgEl(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}
const timeOf = (at) => { const d = new Date(at); return Number.isFinite(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--'; };
const stageLabel = (id) => STAGES.find((s) => s.id === id)?.label || id || '—';
const pct = (x) => (x == null || !Number.isFinite(Number(x)) ? '—' : `${(Number(x) * 100).toFixed(1)}%`);
const nodeCode = (c) => (!c ? '—' : c.length > 6 ? c.slice(0, 5) + '…' : c);

export default {
  id: 'observatory', title: 'Liquidity Observatory', order: 25,
  async mount(el, api) {
    const { esc, badge } = api;
    if (!document.getElementById('obs-style')) { const st = document.createElement('style'); st.id = 'obs-style'; st.textContent = STYLE; document.head.append(st); }
    const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const mountedAt = Date.now();
    const fxBadge = '<span class="badge fx" title="Invented development data. Not real XRPL data.">FIXTURE</span>';
    const stBadge = (st) => { const s = statusStyle(st); return `<span class="badge ${s.badge}">${esc(s.label.toUpperCase())}</span>`; };
    const modeBadge = (m) => (m === 'INVALID' ? '<span class="badge bad">UNVERIFIED</span>' : badge(m));

    el.innerHTML = `<div class="obs" id="obs-root">
      <div class="card">
        <div class="obs-bar">
          <h2>Liquidity Observatory <small>GYW1313 · 26 spokes · XRP hub</small> <span id="obs-src"></span></h2>
          <button class="ghost" type="button" id="obs-gA" aria-pressed="true">Group A</button>
          <button class="ghost" type="button" id="obs-gB" aria-pressed="true">Group B</button>
          <button class="ghost" type="button" id="obs-fs" aria-pressed="false">⛶ Full screen</button>
        </div>
        <div id="obs-srcnote"></div>
        <div class="obs-counts" id="obs-counts"></div>
        <div class="obs-attr" id="obs-attr"></div>
      </div>
      <div class="card">
        <div class="obs-ctl">
          <label>Speed <input type="range" id="obs-speed" min="0" max="${SPEEDS.length - 1}" step="1" value="2" aria-label="Animation speed"> <span id="obs-speedv" class="mono">1×</span></label>
          <button class="ghost" type="button" id="obs-pause" aria-pressed="false">❚❚ Pause</button>
          <button class="ghost" type="button" id="obs-replay">▶ Presentation replay</button>
          <button class="ghost" type="button" id="obs-stop" hidden>■ Stop replay</button>
          <span id="obs-rpos" class="muted mono" aria-live="polite"></span>
        </div>
        <div class="obs-main">
          <div class="obs-stage" id="obs-stage">
            <svg class="obs-svg" viewBox="-500 -500 1000 1000" role="group" aria-labelledby="obs-svg-t">
              <title id="obs-svg-t">XRP hub with 26 asset spokes. Group A on the left, Group B on the right. Select a spoke for details.</title>
              <g class="L-spokes"></g><g class="L-cand"></g><g class="L-trail"></g><g class="L-hub"></g><g class="L-nodes"></g><g class="L-parts"></g><g class="L-banner"></g>
            </svg>
            <div class="obs-legend" id="obs-legend"></div>
          </div>
          <aside class="obs-side" id="obs-side" aria-live="polite"></aside>
        </div>
      </div>
      <div class="card"><h3>Network timeline <span class="muted" style="font-weight:400">· executed flows, snapshots, Sentinel</span></h3><ol class="obs-tl" id="obs-tl"><li class="muted">Waiting for events…</li></ol></div>
    </div>`;

    const root = el.querySelector('#obs-root');
    const $ = (s) => root.querySelector(s);
    const svg = $('svg.obs-svg');
    const L = Object.fromEntries(['spokes', 'cand', 'trail', 'hub', 'nodes', 'parts', 'banner'].map((k) => [k, $(`.L-${k}`)]));
    const side = $('#obs-side'), tlEl = $('#obs-tl');

    // ---- state ----
    let snap = null, fixture = null, source = { kind: 'loading', reason: '' }, warnings = [], fetchedLocal = Date.now();
    let spokes = [], byId = new Map();
    const expanded = { A: true, B: true };
    let selected = null, layout = null, posById = new Map(), k = 1;
    const details = new Map(); // id -> {loading, data, error}
    const findings = new Map();
    const timeline = []; const seen = new Set();
    const feed = { MAINNET_OBSERVED: 0, LIVE_TESTNET: 0 }; // unique executed flows seen (excludes REPLAY)
    let pfRuns = null;

    const isFixture = () => source.kind === 'fixture';
    async function getFixture() { if (!fixture) { const r = await fetch('/observatory-fixture.json', { cache: 'no-store' }); fixture = await r.json(); } return fixture; }

    async function loadSnapshot() {
      try {
        const b = await api.get('/api/spokes');
        if (!b?.groups?.A?.spokes || !b?.groups?.B?.spokes) throw new Error('unexpected /api/spokes shape');
        snap = b; warnings = validateSpokes(b); source = { kind: 'api', reason: '' };
      } catch (e) {
        try { snap = (await getFixture()).spokes; warnings = []; source = { kind: 'fixture', reason: e.status === 404 ? '/api/spokes is not available yet' : `/api/spokes failed: ${e.message}` }; }
        catch (e2) { source = { kind: 'none', reason: `No data: ${e.message}; fixture failed: ${e2.message}` }; snap = null; }
      }
      fetchedLocal = Date.now();
      spokes = allSpokes(snap); byId = new Map(spokes.map((s) => [s.id, s]));
      if (selected && !byId.has(selected)) selected = null;
      details.clear();
      renderHeader(); render(); renderSide();
    }

    // ---- header ----
    function renderHeader() {
      $('#obs-src').innerHTML = isFixture() ? fxBadge : source.kind === 'api' ? '' : '<span class="badge bad">NO DATA</span>';
      $('#obs-srcnote').innerHTML = isFixture() ? `<div class="obs-fxwarn"><b>FIXTURE data.</b> ${esc(source.reason)}. Assets, issuers and hashes below are invented for layout; nothing here is real XRPL data. The tab switches to the live API automatically when it responds.</div>`
        : source.kind === 'none' ? `<div class="obs-fxwarn">${esc(source.reason)}</div>`
        : warnings.length ? `<div class="obs-warn">${warnings.length} contract warning(s) in /api/spokes: ${esc(warnings.slice(0, 3).join('; '))}${warnings.length > 3 ? '…' : ''}</div>` : '';
      if (!snap) { $('#obs-counts').innerHTML = ''; $('#obs-attr').innerHTML = ''; return; }
      const c = snap.counts || {};
      const sw = (st) => `<svg width="12" height="12" viewBox="-7 -7 14 14" aria-hidden="true">${legendDot(st, 5)}</svg>`;
      const cell = (v, label, st) => `<div class="obs-count"><b>${esc(v ?? '—')}</b><span>${st ? sw(st) : ''}${esc(label)}</span></div>`;
      $('#obs-counts').innerHTML = cell(c.displayed ?? spokes.length, 'displayed') + cell(c.eligible, 'eligible') +
        STATUSES.map((st) => cell(c[st], COUNT_LABEL[st], st)).join('') +
        cell(feed.MAINNET_OBSERVED + feed.LIVE_TESTNET, 'validated flows in feed') + cell(feed.LIVE_TESTNET, 'live Testnet flows') + cell(feed.MAINNET_OBSERVED, 'Mainnet observed flows');
      renderAttr();
    }
    function renderAttr() {
      if (!snap) return;
      const s = snap.snapshot || {};
      const age = (Number(s.ageSec) || 0) + (Date.now() - fetchedLocal) / 1000;
      const fr = s.freshness === 'live' ? '<span class="badge live">LIVE SNAPSHOT</span>' : s.freshness === 'cached' ? '<span class="badge sim">CACHED</span>' : '<span class="badge bad">UNAVAILABLE</span>';
      const cv = snap.coverage || {};
      $('#obs-attr').innerHTML = `${fr} <span>age <b>${esc(fmtAge(age))}</b>${s.refreshMin ? ` · refresh every ${esc(s.refreshMin)} min` : ''}</span>
        <span><b><a href="https://xrpl.to" target="_blank" rel="noopener noreferrer">Data by xrpl.to</a></b></span>
        <span>${badge('MAINNET_OBSERVED')} read-only</span><span>${badge('LIVE_TESTNET')} Testnet live</span>
        <span>source ${esc(s.source || '?')}${isFixture() ? ' ' + fxBadge : ''}</span>
        <span>Mainnet coverage: ${esc(num(cv.mainnetLedgersScanned, 0))} ledgers, ${esc(num(cv.mainnetPaymentsMatched, 0))} payments matched${cv.from != null ? ` (${esc(cv.from)}–${esc(cv.to)})` : ''}</span>`;
    }
    setInterval(renderAttr, 5000);

    // ---- legend ----
    function legendDot(st, r = 7) {
      const s = statusStyle(st);
      return `<g class="o-node ${s.cls}" style="cursor:default"><circle class="outer" r="${r + 3}"></circle><circle class="core" r="${r}" style="stroke-width:2"></circle><line class="slash" x1="${-r * 0.7}" y1="${r * 0.7}" x2="${r * 0.7}" y2="${-r * 0.7}" style="stroke-width:2"></line></g>`;
    }
    $('#obs-legend').innerHTML = STATUSES.map((st) => `<span><svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true">${legendDot(st)}</svg>${esc(statusStyle(st).label)} <span class="mono">${statusStyle(st).code}</span></span>`).join('') +
      `<span><svg width="34" height="10" aria-hidden="true"><line x1="2" y1="5" x2="32" y2="5" stroke="var(--live)" stroke-width="4" stroke-linecap="round"></line><circle cx="22" cy="5" r="4" fill="var(--live)"></circle></svg>Executed flow (solid, moving): MAINNET OBSERVED · LIVE TESTNET · REPLAY</span>
       <span><svg width="34" height="10" aria-hidden="true"><line x1="2" y1="5" x2="32" y2="5" stroke="var(--sim)" stroke-width="3" stroke-dasharray="6 4"></line></svg>Candidate path (dashed, static): SIMULATION, not executed</span>`;

    // ---- SVG render ----
    const nodeEls = new Map();
    svgEl('circle', { class: 'o-hubglow', r: 100 }, L.hub);
    svgEl('circle', { class: 'o-hub', r: 70 }, L.hub);
    const hubT = svgEl('text', { class: 'o-txt', 'text-anchor': 'middle', y: 12, 'font-size': 36, 'font-weight': 800 }, L.hub); hubT.textContent = 'XRP';
    const hubS = svgEl('text', { class: 'o-sub', 'text-anchor': 'middle', y: 38, 'font-size': 14 }, L.hub); hubS.textContent = 'bridge hub';
    svgEl('title', {}, L.hub).textContent = 'XRP hub. Token-to-token payments auto-bridge through XRP order books.';

    function select(id, focus) {
      selected = id; render(); renderSide(true);
      if (focus) nodeEls.get(id)?.g.focus();
    }
    function ensureNode(s) {
      let r = nodeEls.get(s.id);
      if (r) return r;
      const g = svgEl('g', { tabindex: 0, role: 'button', 'data-id': s.id }, L.nodes);
      const r0 = {
        g, hit: svgEl('circle', { class: 'hit' }, g), sel: svgEl('circle', { class: 'sel-ring' }, g), outer: svgEl('circle', { class: 'outer' }, g), core: svgEl('circle', { class: 'core' }, g),
        slash: svgEl('line', { class: 'slash' }, g), tick: svgEl('text', { class: 'o-txt', 'text-anchor': 'middle', 'font-weight': 800 }, g),
        code: svgEl('text', { class: 'code', 'text-anchor': 'middle' }, g), rank: svgEl('text', { class: 'o-sub', 'text-anchor': 'middle' }, g),
        warn: svgEl('g', {}, g), title: svgEl('title', {}, g),
      };
      g.addEventListener('click', () => select(s.id));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(s.id); }
        else if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
          e.preventDefault();
          const vis = layout.nodes.map((n) => n.id); const i = vis.indexOf(s.id);
          const nx = vis[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + vis.length) % vis.length];
          nodeEls.get(nx)?.g.focus();
        } else if (e.key === 'Escape' && selected) { selected = null; render(); renderSide(); }
      });
      nodeEls.set(s.id, r0);
      return r0;
    }

    function render() {
      k = Math.min(2, Math.max(1, 560 / (svg.clientWidth || 1000)));
      layout = layoutSpokes(snap, { expanded, k, R: 400 - (k - 1) * 30 });
      posById = new Map(layout.nodes.map((n) => [n.id, n]));
      for (const a of layout.aggregates) for (const s of spokes.filter((x) => x.group === a.group)) posById.set(s.id, { ...a, agg: true });
      // spokes (structure only, never a flow)
      L.spokes.replaceChildren();
      for (const n of layout.nodes) {
        const s = byId.get(n.id);
        const u = { x: n.x / n.r, y: n.y / n.r };
        svgEl('line', { class: `o-spoke${s.status === 'UNAVAILABLE' ? ' blocked' : ''}${selected === n.id ? ' sel' : ''}`, x1: (u.x * 72).toFixed(1), y1: (u.y * 72).toFixed(1), x2: (n.x - u.x * n.nodeR).toFixed(1), y2: (n.y - u.y * n.nodeR).toFixed(1) }, L.spokes);
      }
      for (const a of layout.aggregates) svgEl('line', { class: 'o-spoke', x1: a.x > 0 ? 72 : -72, y1: 0, x2: a.x - Math.sign(a.x) * a.nodeR, y2: a.y }, L.spokes);
      // nodes
      for (const [id, r] of nodeEls) if (!posById.has(id) || posById.get(id).agg) { r.g.remove(); nodeEls.delete(id); }
      for (const n of layout.nodes) {
        const s = byId.get(n.id), st = statusStyle(s.status), r = ensureNode(s), R = n.nodeR;
        if (!r.g.isConnected) L.nodes.append(r.g);
        r.g.setAttribute('class', `o-node ${st.cls}${selected === s.id ? ' sel' : ''}`);
        r.g.setAttribute('transform', `translate(${n.x} ${n.y})`);
        r.g.setAttribute('aria-label', `${s.currency || 'Empty slot'}, ${s.name || ''}, issuer ${s.issuer || 'none'}, ${s.network}, rank ${s.rank ?? 'unranked'}, ${st.label}${s.eligibility?.eligible ? ', eligible' : ', not eligible'}${s.alerts?.length ? `, ${s.alerts.length} alert(s)` : ''}. Open details.`);
        r.g.setAttribute('aria-pressed', String(selected === s.id));
        r.hit.setAttribute('r', R + 14); r.core.setAttribute('r', R); r.outer.setAttribute('r', R + 7); r.sel.setAttribute('r', R + 12);
        for (const [a, v] of Object.entries({ x1: -R * 0.72, y1: R * 0.72, x2: R * 0.72, y2: -R * 0.72 })) r.slash.setAttribute(a, v.toFixed(1));
        const label = nodeCode(s.currency);
        const fs = Math.min(R * 0.62, (R * 1.75) / Math.max(3, label.length) / 0.62);
        r.tick.setAttribute('font-size', fs.toFixed(1)); r.tick.setAttribute('y', (fs * 0.2).toFixed(1)); r.tick.textContent = label;
        r.code.setAttribute('font-size', (R * 0.36).toFixed(1)); r.code.setAttribute('y', (R * 0.62).toFixed(1)); r.code.textContent = st.code;
        // rank + network outside the node, radially away from the hub
        const ux = n.x / n.r, uy = n.y / n.r, d = R + 16 * k;
        r.rank.setAttribute('x', (ux * d).toFixed(1)); r.rank.setAttribute('y', (uy * d + 5 * k).toFixed(1)); r.rank.setAttribute('font-size', (13 * k).toFixed(1));
        r.rank.textContent = `${s.rank != null ? '#' + s.rank : ''}${s.network === 'mainnet' ? ' M' : ' T'}`;
        r.title.textContent = `${s.currency || 'Empty slot'} · ${s.name || ''}\n${s.network} issuer ${s.issuer || 'none'}\n${st.label}: ${st.desc}`;
        r.warn.replaceChildren();
        if (s.alerts?.length) {
          const hi = s.alerts.some((a) => /high|crit/i.test(a.severity)); const wx = R * 0.8, wy = -R * 0.8;
          svgEl('path', { class: `warn${hi ? ' hi' : ''}`, d: `M${wx} ${wy - 11} L${wx + 11} ${wy + 8} L${wx - 11} ${wy + 8} Z` }, r.warn);
        }
      }
      // aggregates (collapsed groups)
      L.nodes.querySelectorAll('.o-agg').forEach((x) => x.remove());
      for (const a of layout.aggregates) {
        const g = svgEl('g', { class: 'o-agg', tabindex: 0, role: 'button', 'aria-expanded': 'false', transform: `translate(${a.x} ${a.y})`, 'aria-label': `Group ${a.group}: ${a.count} spokes collapsed. Expand.` }, L.nodes);
        svgEl('circle', { class: 'core', r: a.nodeR }, g);
        svgEl('text', { class: 'o-txt', 'text-anchor': 'middle', y: -2, 'font-size': (20 * Math.min(k, 1.5)).toFixed(1), 'font-weight': 800 }, g).textContent = `Group ${a.group}`;
        svgEl('text', { class: 'o-sub', 'text-anchor': 'middle', y: 20 * Math.min(k, 1.5), 'font-size': (14 * Math.min(k, 1.5)).toFixed(1) }, g).textContent = `${a.count} spokes · expand`;
        const tog = () => toggleGroup(a.group);
        g.addEventListener('click', tog); g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tog(); } });
      }
      renderCandidates();
      renderBanner();
      hubS.textContent = snap ? `${spokes.length} spokes` : 'bridge hub';
    }

    function renderBanner() {
      L.banner.replaceChildren();
      const fsz = (15 * k).toFixed(1);
      for (const g of ['A', 'B']) {
        const t = svgEl('text', { class: 'o-gtitle', x: g === 'A' ? -490 : 490, y: -478, 'text-anchor': g === 'A' ? 'start' : 'end', 'font-size': fsz, tabindex: 0, role: 'button', 'aria-expanded': String(expanded[g]) }, L.banner);
        t.textContent = `${expanded[g] ? '▾' : '▸'} Group ${g}`;
        svgEl('title', {}, t).textContent = snap?.groups?.[g]?.title || `Group ${g}`;
        t.addEventListener('click', () => toggleGroup(g)); t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(g); } });
      }
      const mode = rp ? 'REPLAY' : 'LIVE';
      svgEl('text', { class: `o-banner o-m-${mode}`, x: -490, y: 490, 'font-size': fsz }, L.banner).textContent = rp ? 'REPLAY · presentation sequence' : 'LIVE feed · flows animate as they validate';
      if (isFixture()) svgEl('text', { class: 'o-banner o-m-FIXTURE', x: 490, y: 490, 'text-anchor': 'end', 'font-size': fsz }, L.banner).textContent = 'FIXTURE DATA';
      if (!snap) svgEl('text', { class: 'o-sub', 'text-anchor': 'middle', y: 140, 'font-size': 20 * k }, L.banner).textContent = source.kind === 'loading' ? 'Loading spokes…' : 'No spoke data';
    }

    function toggleGroup(g) {
      expanded[g] = !expanded[g];
      $(`#obs-g${g}`).setAttribute('aria-pressed', String(expanded[g]));
      render();
    }
    $('#obs-gA').onclick = () => toggleGroup('A');
    $('#obs-gB').onclick = () => toggleGroup('B');

    const ptOf = (id) => {
      if (id === 'hub') return { x: 0, y: 0, nodeR: 0 };
      return posById.get(id) || null;
    };
    function polyFor(ends) {
      const a = ptOf(ends.from), b = ptOf(ends.to);
      if (!a || !b) return null;
      const edge = (p) => { const r = Math.hypot(p.x, p.y) || 1; return { x: p.x - (p.x / r) * p.nodeR, y: p.y - (p.y / r) * p.nodeR }; };
      const pts = [];
      if (ends.from !== 'hub') pts.push(edge(a));
      pts.push({ x: 0, y: 0 });
      if (ends.to !== 'hub') pts.push(edge(b));
      return pts.length > 1 ? pts : null;
    }
    const ptsAttr = (pts) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    // Candidate (modeled) paths: dashed, static, only for the selected spoke.
    function renderCandidates() {
      L.cand.replaceChildren();
      const s = selected && byId.get(selected);
      if (!s) return;
      const { paths } = candidatePaths(s, spokes, { limit: 4 });
      for (const p of paths) {
        const pts = polyFor({ from: p.from, to: p.to });
        if (!pts) continue;
        const pl = svgEl('polyline', { class: 'o-cand', points: ptsAttr(pts) }, L.cand);
        svgEl('title', {}, pl).textContent = `CANDIDATE path (SIMULATION, not executed): ${s.currency} → XRP${p.to !== 'hub' ? ' → ' + (byId.get(p.to)?.currency || '?') : ''}, modeled capacity ≈ ${num(p.capacityXrp, 0)} XRP`;
        const end = pts.at(-1);
        if (p.to !== 'hub') svgEl('text', { class: 'o-candlbl', x: (end.x * 0.55).toFixed(1), y: (end.y * 0.55 - 6).toFixed(1), 'text-anchor': 'middle', 'font-size': (11 * k).toFixed(1) }, L.cand).textContent = 'CANDIDATE';
      }
    }

    // ---- animation clock (virtual time; speed and pause act on it) ----
    const clock = { v: 0, last: null, speed: 1, paused: false, raf: 0 };
    const parts = [];
    let rp = null; // { items, idx, v0 }
    const DUR = 2600;

    function fire(rec, { animate = true } = {}) {
      const ends = flowEnds(rec, spokes);
      const pts = polyFor(ends);
      if (!pts || !animate) return;
      const kind = rec.kind;
      const trail = svgEl('polyline', { class: `o-trail k-${kind}`, points: ptsAttr(pts), opacity: 0.55 }, L.trail);
      const tag = `${kind === 'MAINNET_OBSERVED' ? 'MAINNET' : kind === 'LIVE_TESTNET' ? 'LIVE' : 'REPLAY'}${isFixture() ? '·FIXTURE' : ''}`;
      if (reduced()) { parts.push({ v0: clock.v, dur: DUR, trail, static: true }); kick(); return; }
      const g = svgEl('g', { class: `k-${kind}` }, L.parts);
      const c = svgEl('circle', { class: 'o-p', r: (9 * Math.min(k, 1.5)).toFixed(1) }, g);
      const t = svgEl('text', { class: 'o-plbl', 'font-size': (12 * k).toFixed(1), dx: 12, dy: -10 }, g);
      t.textContent = `${tag} ${amountText(rec.delivered, rec.to?.currency)}`;
      parts.push({ v0: clock.v, dur: DUR, pts, g, c, t, trail });
      kick();
    }
    function kick() { if (!clock.raf && !clock.paused) clock.raf = requestAnimationFrame(frame); }
    function frame(ts) {
      clock.raf = 0;
      if (clock.last != null && !clock.paused) clock.v += Math.min(100, ts - clock.last) * clock.speed;
      clock.last = ts;
      if (rp && !clock.paused) {
        while (rp.idx < rp.items.length && rp.items[rp.idx].vt <= clock.v - rp.v0) { const it = rp.items[rp.idx++]; fireReplay(it.rec); }
        updateReplayUi();
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; const f = (clock.v - p.v0) / p.dur;
        if (f >= 1) { p.g?.remove(); p.trail?.remove(); parts.splice(i, 1); continue; }
        if (!p.static) { const q = pointAlong(p.pts, f); p.g.setAttribute('transform', `translate(${q.x.toFixed(1)} ${q.y.toFixed(1)})`); p.trail.setAttribute('opacity', (0.55 * (1 - f * 0.8)).toFixed(2)); }
      }
      if (!clock.paused && (parts.length || (rp && rp.idx < rp.items.length))) clock.raf = requestAnimationFrame(frame);
      else clock.last = null;
    }

    // ---- timeline ----
    function txText(rec) {
      const ends = flowEnds(rec, spokes);
      const nm = (id, side) => (id === 'hub' ? 'XRP' : byId.get(id) ? `${byId.get(id).currency} (${shortAddr(byId.get(id).issuer)})` : `${side?.currency || '?'}${side?.issuer ? ' (' + shortAddr(side.issuer) + ')' : ''}`);
      const bridge = ends.from !== 'hub' && ends.to !== 'hub' ? (rec.viaXrp === true ? ' → XRP → ' : rec.viaXrp === false ? ' → (direct) → ' : ' → [bridge unverified] → ') : ' → ';
      const cap = captureOf([rec]).counts;
      const who = ROLES.filter((r) => cap[r]).map((r) => `${r} ${cap[r]}`).join(', ');
      return `${nm(ends.from, rec.from)}${bridge}${nm(ends.to, rec.to)} · ${amountText(rec.delivered, rec.to?.currency)} delivered${who ? ' · makers: ' + who : ''}`;
    }
    function pushTl(item) {
      timeline.unshift(item); if (timeline.length > 60) timeline.length = 60;
      renderTl();
    }
    function renderTl() {
      if (!timeline.length) { tlEl.innerHTML = '<li class="muted">Waiting for events…</li>'; return; }
      tlEl.innerHTML = timeline.map((t, i) => `<li><time>${esc(timeOf(t.at))}</time>${t.badgeHtml}${t.fixture ? ' ' + fxBadge : ''}<span class="t">${t.spokeId ? `<button class="lnk" type="button" data-i="${i}">${esc(t.text)}</button>` : esc(t.text)}</span></li>`).join('');
    }
    tlEl.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); const t = b && timeline[Number(b.dataset.i)]; if (t?.spokeId && byId.has(t.spokeId)) select(t.spokeId, true); });

    function ingestFlow(rec, { fixtureFlag = isFixture(), animate = false } = {}) {
      if (!rec || typeof rec !== 'object') return;
      const key = `${rec.kind}:${rec.hash}:${rec.seq ?? ''}`;
      if (rec.kind !== 'REPLAY' && seen.has(key)) return;
      seen.add(key);
      const pv = provenance(rec, { fixture: fixtureFlag });
      if (pv.cls === 'executed' && rec.kind in feed) { feed[rec.kind]++; renderHeader(); }
      const ends = flowEnds(rec, spokes);
      pushTl({ at: rec.at, badgeHtml: modeBadge(pv.mode), fixture: pv.fixture, text: (pv.cls === 'executed' ? '' : pv.cls === 'candidate' ? 'Not executed: ' : 'Unverified record (network/kind mismatch): ') + txText(rec), spokeId: [ends.from, ends.to].find((x) => x && x !== 'hub') || null });
      if (pv.animate && animate) fire(rec);
    }
    function fireReplay(rec) {
      ingestFlow(rec, { animate: true });
    }

    // ---- replay controls ----
    const rposEl = $('#obs-rpos'), replayBtn = $('#obs-replay'), stopBtn = $('#obs-stop'), pauseBtn = $('#obs-pause');
    function updateReplayUi() {
      stopBtn.hidden = !rp;
      replayBtn.textContent = rp ? '↺ Restart replay' : '▶ Presentation replay';
      rposEl.textContent = rp ? `REPLAY ${rp.idx}/${rp.items.length}${rp.idx >= rp.items.length ? ' · done' : ''}${clock.paused ? ' · paused' : ''}` : clock.paused ? 'paused' : '';
      $('#obs-stage').classList.toggle('obs-replay-on', !!rp);
    }
    async function startReplay() {
      let body;
      try { body = isFixture() ? (await getFixture()).replay : await api.get('/api/spokes/replay'); }
      catch (e) {
        try { body = (await getFixture()).replay; rposEl.textContent = 'Replay API unavailable; using fixture replay.'; } catch { rposEl.textContent = `Replay unavailable: ${e.message}`; return; }
      }
      const items = replayOrder(body);
      if (!items.length) { rposEl.textContent = 'Replay sequence is empty.'; return; }
      rp = { items, idx: 0, v0: clock.v, fixture: isFixture() };
      pushTl({ at: new Date().toISOString(), badgeHtml: badge('REPLAY'), fixture: isFixture(), text: `Presentation replay started · ${items.length} recorded flows, deterministic order` });
      renderBanner(); updateReplayUi(); clock.paused = false; pauseBtn.setAttribute('aria-pressed', 'false'); pauseBtn.textContent = '❚❚ Pause'; kick();
    }
    replayBtn.onclick = () => startReplay();
    stopBtn.onclick = () => { rp = null; renderBanner(); updateReplayUi(); };
    pauseBtn.onclick = () => {
      clock.paused = !clock.paused;
      pauseBtn.setAttribute('aria-pressed', String(clock.paused)); pauseBtn.textContent = clock.paused ? '▶ Resume' : '❚❚ Pause';
      if (!clock.paused) { clock.last = null; kick(); }
      updateReplayUi();
    };
    const speedEl = $('#obs-speed');
    speedEl.oninput = () => { clock.speed = SPEEDS[Number(speedEl.value)] || 1; $('#obs-speedv').textContent = `${clock.speed}×`; speedEl.setAttribute('aria-valuetext', `${clock.speed} times`); };
    speedEl.setAttribute('aria-valuetext', '1 times');

    // ---- full screen (Fullscreen API with CSS fallback) ----
    const fsBtn = $('#obs-fs');
    const isFull = () => document.fullscreenElement === root || root.classList.contains('obs-full');
    const fsUi = () => { fsBtn.setAttribute('aria-pressed', String(isFull())); fsBtn.textContent = isFull() ? '✕ Exit full screen' : '⛶ Full screen'; setTimeout(render, 60); };
    fsBtn.onclick = async () => {
      if (isFull()) { if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); root.classList.remove('obs-full'); return fsUi(); }
      try { if (!root.requestFullscreen) throw new Error('no api'); await root.requestFullscreen(); }
      catch { root.classList.add('obs-full'); }
      fsUi();
    };
    document.addEventListener('fullscreenchange', fsUi);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('obs-full')) { root.classList.remove('obs-full'); fsUi(); } });

    // ---- drill-down ----
    async function loadDetail(id) {
      if (details.get(id)?.data || details.get(id)?.loading) return;
      details.set(id, { loading: true });
      try {
        const d = isFixture() ? (await getFixture()).details?.[id] : await api.get(`/api/spokes/${encodeURIComponent(id)}`);
        if (!d) throw new Error('not in fixture');
        details.set(id, { data: d, warnings: isFixture() ? [] : validateDetail(d) });
      } catch (e) { details.set(id, { error: e.status === 404 ? 'detail endpoint not available yet' : e.message }); }
      if (selected === id) renderSide();
    }
    async function loadFindings(id) {
      if (findings.has(id)) return;
      findings.set(id, { loading: true });
      try { const f = await api.get(`/api/findings?market=${encodeURIComponent(id)}`); findings.set(id, { data: Array.isArray(f) ? f : f.findings || f.items || [] }); }
      catch (e) { findings.set(id, { error: e.status === 404 ? 'Sentinel findings endpoint not available yet' : e.message }); }
      if (selected === id) renderSide();
    }
    async function loadRuns() {
      if (pfRuns) return;
      pfRuns = { loading: true };
      try { const r = await api.get('/api/pathfinder/runs'); pfRuns = { runs: r.runs || [] }; } catch (e) { pfRuns = { error: e.message }; }
      if (selected) renderSide();
    }

    function depthChart(d) {
      const bids = d?.bids || [], asks = d?.asks || [];
      const bands = [...new Set([...bids.map((b) => b.band), ...asks.map((b) => b.band)])];
      if (!bands.length) return '<p class="muted">No depth reported.</p>';
      const max = Math.max(1, ...bids.map((b) => +b.xrp || 0), ...asks.map((b) => +b.xrp || 0));
      const v = (arr, band) => +(arr.find((b) => b.band === band)?.xrp || 0);
      return `<div class="obs-key"><span><i style="background:var(--live)"></i>bids (XRP)</span><span><i style="background:var(--replay)"></i>asks (XRP)</span><span>by distance from mid</span></div>
        <div class="obs-depth" role="table" aria-label="Funded depth by price band">${bands.map((band) => {
          const b = v(bids, band), a = v(asks, band);
          return `<div class="bl bid" role="cell" title="bids ${esc(band)}: ${num(b, 0)} XRP"><span class="mono" style="margin-right:4px">${num(b, 0)}</span><i style="width:${((b / max) * 70).toFixed(1)}%"></i></div>
            <div class="band" role="rowheader">${esc(band)}</div>
            <div class="ask" role="cell" title="asks ${esc(band)}: ${num(a, 0)} XRP" style="display:flex;align-items:center"><i style="width:${((a / max) * 70).toFixed(1)}%"></i><span class="mono" style="margin-left:4px">${num(a, 0)}</span></div>`;
        }).join('')}</div>`;
    }
    function capBar(share, label) {
      const seg = (r) => (share[r] > 0 ? `<span style="width:${(share[r] * 100).toFixed(1)}%;background:var(--obs-${r})" title="${r} ${pct(share[r])}"></span>` : '');
      return `<div class="obs-cap" role="img" aria-label="${esc(label)}: ${ROLES.map((r) => `${r} ${pct(share[r])}`).join(', ')}">${ROLES.map(seg).join('')}</div>`;
    }
    function depthAfterText(d) {
      if (d == null) return '—';
      if (typeof d === 'number') return `${num(d, 0)} XRP`;
      if (typeof d === 'object') return Object.entries(d).map(([kk, vv]) => `${kk} ${typeof vv === 'object' ? JSON.stringify(vv) : num(vv, 0)}`).join(' · ');
      return String(d);
    }
    function txCard(t) {
      const pv = provenance(t, { fixture: isFixture() });
      const url = isFixture() ? null : explorerFor(t);
      const via = t.viaXrp === true ? 'XRP bridge leg verified' : t.viaXrp === false ? 'no XRP leg (direct)' : 'XRP bridge leg unverified';
      return `<li class="obs-tx k-${esc(t.kind)}">
        <div>${modeBadge(pv.mode)}${pv.fixture ? ' ' + fxBadge : ''} <span class="muted">${esc(timeOf(t.at))} · ${esc(t.network)} ledger ${esc(t.ledger)}</span></div>
        <div><b>${esc(t.from?.currency)}</b> <span class="mono">${esc(shortAddr(t.from?.issuer))}</span> → <b>${esc(t.to?.currency)}</b> <span class="mono">${esc(shortAddr(t.to?.issuer))}</span></div>
        <div>${t.viaXrp === true ? '✓' : t.viaXrp === null ? '?' : '–'} ${esc(via)} · delivered <b>${esc(amountText(t.delivered, t.to?.currency))}</b> · rate ${esc(num(t.rate, 6))}${t.partial ? ' · <span class="err">partial</span>' : ''}</div>
        <div>Offer owners: ${(t.offerOwners || []).map((o) => `<span title="${esc(o.account)}"><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--obs-${ROLES.includes(o.role) ? o.role : 'other'})"></i> ${esc(o.role)} <span class="mono">${esc(shortAddr(o.account))}</span></span>`).join(' · ') || '—'}</div>
        <div class="muted">Depth after: ${esc(depthAfterText(t.depthAfter))}</div>
        <div class="mono">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(String(t.hash).slice(0, 16))}…</a>` : `${esc(String(t.hash || '').slice(0, 16))}…${isFixture() ? ' (fixture hash, no explorer link)' : ''}`}</div>
      </li>`;
    }

    function renderSide(fresh) {
      const s = selected && byId.get(selected);
      if (!s) {
        side.innerHTML = `<h3>Select a spoke</h3><p class="muted">Tap or tab to any of the ${spokes.length || 26} asset nodes (arrow keys move between them). You will see who issued it, whether it passes eligibility, its funded depth, which maker captured each execution, and which routes the current liquidity makes possible.</p>
          <p class="obs-note">Solid moving dots are executed flows. Dashed static lines are candidate routes (modeled, not executed).</p>`;
        return;
      }
      if (fresh) { loadDetail(s.id); loadFindings(s.id); loadRuns(); }
      const st = statusStyle(s.status), m = s.market || {};
      const netMode = s.network === 'mainnet' ? 'MAINNET_OBSERVED' : st.live ? 'LIVE_TESTNET' : s.status === 'REPLAY' ? 'REPLAY' : 'SIMULATION';
      const fx = isFixture() ? ' ' + fxBadge : '';
      const det = details.get(s.id);
      const txs = det?.data?.transactions || [];
      const exec = txs.filter((t) => classifyFlow(t) === 'executed');
      const nonExec = txs.filter((t) => classifyFlow(t) !== 'executed');
      const cap = captureOf(exec);
      const latestDepth = exec.slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]?.depthAfter;
      const cp = candidatePaths(s, spokes, { limit: 6 });
      const maxCap = Math.max(1, ...cp.paths.map((p) => p.capacityXrp));
      const fnd = findings.get(s.id);
      const ringActive = ['corridor', 'mature'].includes(s.corridor?.stage) ? RINGS.length : ['spoke', 'growing_spoke'].includes(s.corridor?.stage) ? 2 : 0;
      side.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
          <h3 style="margin:0">${esc(s.currency || 'Empty slot')} · ${esc(s.name || '')}</h3>
          <button class="ghost" type="button" data-close aria-label="Close details" style="padding:2px 10px">✕</button>
        </div>
        <p style="margin:6px 0">${stBadge(s.status)}${fx} <span class="muted">${esc(st.desc)}</span></p>
        <section><h3>Identity</h3><dl class="obs-kv">
          <dt>Network</dt><dd>${esc(s.network)} ${s.network === 'mainnet' ? '(read-only)' : '(Testnet)'}</dd>
          <dt>Currency</dt><dd><b>${esc(s.currency)}</b>${s.currencyHex ? ` <span class="mono">${esc(s.currencyHex)}</span>` : ''}</dd>
          <dt>Issuer</dt><dd>${s.issuer ? `<span class="mono" id="obs-issuer">${esc(s.issuer)}</span> <button class="ghost" type="button" data-copy style="padding:1px 8px;font-size:12px;min-height:0">Copy</button> <span data-copied class="muted" aria-live="polite"></span>` : '<span class="muted">none (empty slot)</span>'}</dd>
          <dt>Rank</dt><dd>${s.rank != null ? '#' + esc(s.rank) : 'unranked'} · Group ${esc(s.group)}</dd>
          ${s.testnet ? `<dt>Testnet</dt><dd>${esc(s.testnet.code)} <span class="mono">${esc(shortAddr(s.testnet.issuer, 8))}</span> · ${s.testnet.funded ? 'funded' : 'not funded'}${s.testnet.book ? ` · book ${esc(typeof s.testnet.book === 'object' ? Object.entries(s.testnet.book).map(([a, b]) => `${a} ${b}`).join(', ') : s.testnet.book)}` : ''}</dd>` : ''}
        </dl></section>
        <section><h3>Eligibility ${s.eligibility?.eligible ? '<span class="badge live">ELIGIBLE</span>' : '<span class="badge bad">NOT ELIGIBLE</span>'}</h3>
          <ul class="obs-checks">${(s.eligibility?.checks || []).map((c) => `<li><span class="${c.ok ? 'ok' : 'no'}">${c.ok ? '✓ pass' : '✗ fail'}</span> <b>${esc(c.id)}</b> <span class="muted">${esc(c.detail)}</span></li>`).join('') || '<li class="muted">No checks reported.</li>'}</ul></section>
        <section><h3>Market ${badge(netMode)}${fx}</h3><dl class="obs-kv">
          <dt>Bid / ask</dt><dd>${esc(num(m.bid, 6))} / ${esc(num(m.ask, 6))} XRP</dd>
          <dt>Spread</dt><dd>${m.spreadBps == null ? '—' : esc(num(m.spreadBps, 1)) + ' bps'}</dd>
          <dt>24h volume</dt><dd>${m.vol24hXrp == null ? '—' : esc(num(m.vol24hXrp, 0)) + ' XRP'}</dd>
          <dt>AMM</dt><dd>${m.amm ? esc(Object.entries(m.amm).map(([a, b]) => `${a} ${typeof b === 'number' ? num(b, 2) : shortAddr(b, 8)}`).join(' · ')) : 'no AMM pool'}</dd>
          <dt>Observed</dt><dd>${esc(timeOf(m.observedAt))}</dd></dl>
          <h3 style="margin-top:8px;font-size:14px">Funded depth by price band</h3>${depthChart(m.depthXrp)}
          <p class="obs-note">Remaining depth after latest fill: ${esc(depthAfterText(latestDepth))}</p></section>
        <section><h3>Corridor ${badge('SIMULATION')}</h3>
          <p style="margin:0 0 4px"><b>${esc(stageLabel(s.corridor?.stage))}</b> · ${esc(s.corridor?.recommendation || '—')}</p>
          <p class="obs-note" style="margin:0 0 6px">Engine: ${esc(s.corridor?.engineLabel || 'unlabeled')}. Modeled recommendation, not an executed action.</p>
          <table class="obs-rings"><thead><tr><th>Ring (modeled)</th><th class="num">Spread</th><th>State</th></tr></thead><tbody>${RINGS.map((R, i) => `<tr><td><b>${R.id}</b><div class="muted">${esc(R.role)}</div></td><td class="num">${R.spreadBps} bps</td><td>${i < ringActive ? 'modeled active' : 'modeled idle'}</td></tr>`).join('')}</tbody></table></section>
        <section><h3>Maker capture</h3>
          <div class="obs-key">${ROLES.map((r) => `<span><i style="background:var(--obs-${r})"></i>${r}</span>`).join('')}</div>
          <p style="margin:6px 0 0">Snapshot share: Titan <b>${esc(pct(s.flows?.titanShare))}</b> · rival <b>${esc(pct(s.flows?.rivalShare))}</b></p>
          ${s.flows?.titanShare != null ? capBar({ titan: +s.flows.titanShare || 0, rival: +s.flows.rivalShare || 0, other: Math.max(0, 1 - (+s.flows.titanShare || 0) - (+s.flows.rivalShare || 0)), amm: 0 }, 'snapshot capture') : ''}
          <p style="margin:6px 0 0">From ${cap.total} offer fills in ${exec.length} executed tx: ${ROLES.map((r) => `${r} ${cap.counts[r]}`).join(' · ')}</p>
          ${cap.total ? capBar(cap.share, 'capture by offer owner role') : ''}
          <p class="obs-note">Flows: ${esc(s.flows?.validated ?? 0)} validated (${esc(s.flows?.mainnetObserved ?? 0)} Mainnet observed, ${esc(s.flows?.liveTestnet ?? 0)} live Testnet).</p></section>
        <section><h3>Sentinel</h3>
          ${(s.alerts || []).length ? `<ul class="obs-checks">${s.alerts.map((a) => `<li><span class="${/high|crit/i.test(a.severity) ? 'no' : ''}">▲ ${esc(a.severity)}</span> ${esc(a.text)}</li>`).join('')}</ul>` : '<p class="muted" style="margin:0">No snapshot alerts.</p>'}
          ${!fnd || fnd.loading ? '<p class="obs-note">Loading Sentinel findings…</p>' : fnd.error ? `<p class="obs-note">Findings: ${esc(fnd.error)}. Showing snapshot alerts only.</p>` : fnd.data.length ? `<ul class="obs-checks">${fnd.data.slice(0, 8).map((f) => `<li>${f.mode ? modeBadge(f.mode) + ' ' : ''}<b>${esc(f.severity || 'info')}</b> ${esc(f.title || f.text || f.id || '')}</li>`).join('')}</ul>` : '<p class="obs-note">No Sentinel findings for this market.</p>'}</section>
        <section><h3>Executed transactions</h3>
          ${!det || det.loading ? '<p class="muted">Loading…</p>' : det.error ? `<p class="obs-note">Transactions unavailable: ${esc(det.error)}</p>` : exec.length ? `<ul class="obs-txs">${exec.map(txCard).join('')}</ul>` : '<p class="muted">No executed transactions recorded for this spoke.</p>'}
          ${nonExec.length ? `<p class="obs-note">${nonExec.length} record(s) without a verified execution are excluded here.</p>` : ''}
          ${det?.warnings?.length ? `<div class="obs-warn">${det.warnings.length} contract warning(s): ${esc(det.warnings.slice(0, 2).join('; '))}</div>` : ''}</section>
        <section><div class="obs-paths"><h3 style="margin:0">Potential paths ${badge('SIMULATION')} <span class="muted" style="font-weight:400;font-size:12px">candidates, not executed</span></h3>
          ${cp.blocked ? `<p style="margin:6px 0 0">${esc(cp.blocked)}.</p>` : `<ol>${cp.paths.map((p) => `<li>${esc(s.currency)} → XRP${p.to !== 'hub' ? ` → <b>${esc(byId.get(p.to)?.currency || '?')}</b> <span class="mono">${esc(shortAddr(byId.get(p.to)?.issuer))}</span>` : ' (sell to the hub)'} · ≈ ${esc(num(p.capacityXrp, 0))} XRP modeled capacity<span class="obs-pbar" style="width:${((p.capacityXrp / maxCap) * 100).toFixed(1)}%"></span></li>`).join('')}</ol>
          <p class="obs-note" style="margin:0">Capacity = the thinner of this spoke's funded bids and the destination's funded asks (snapshot depth). Add depth on either side and the route list changes. ${cp.total > cp.paths.length ? `${cp.total - cp.paths.length} more routes not shown.` : ''}</p>`}
          <p class="obs-note" style="margin:6px 0 0">${!pfRuns || pfRuns.loading ? 'Checking pathfinder runs…' : pfRuns.error ? 'Pathfinder runs unavailable.' : `${pfRuns.runs.length} Pathfinder replay run(s) on Testnet.`} <button class="ghost" type="button" data-pf style="padding:1px 8px;font-size:12px;min-height:0">Open Pathfinder Flow</button></p></div></section>`;
      side.querySelector('[data-close]').onclick = () => { const id = selected; selected = null; render(); renderSide(); nodeEls.get(id)?.g.focus(); };
      side.querySelector('[data-pf]').onclick = () => api.show('pathfinder');
      const copyBtn = side.querySelector('[data-copy]');
      if (copyBtn) copyBtn.onclick = async () => {
        const out = side.querySelector('[data-copied]');
        try { await navigator.clipboard.writeText(s.issuer); out.textContent = 'copied'; }
        catch { const r = document.createRange(); r.selectNodeContents(side.querySelector('#obs-issuer')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); out.textContent = 'selected, press Ctrl+C'; }
      };
    }

    // ---- live wiring ----
    let snapTimer = null;
    api.on((ev) => {
      if (!ev || typeof ev.type !== 'string') return;
      if (ev.type === 'spokes.snapshot') {
        clearTimeout(snapTimer); snapTimer = setTimeout(loadSnapshot, 500);
        pushTl({ at: ev.at, badgeHtml: badge(ev.mode), fixture: false, text: `Spoke snapshot refreshed${ev.freshness ? ' · ' + ev.freshness : ''}` });
      } else if (ev.type === 'spokes.flow') {
        const { type, ...rec } = ev; if (!rec.kind) rec.kind = ev.mode;
        const fresh = !ev.at || Date.parse(ev.at) >= mountedAt - 60000;
        ingestFlow(rec, { fixtureFlag: false, animate: fresh });
      } else if (ev.type === 'sentinel.finding') {
        pushTl({ at: ev.at, badgeHtml: badge(ev.mode), fixture: false, text: `Sentinel ${ev.severity || ''}: ${ev.code ? ev.code + ' · ' : ''}${ev.title || 'finding'}` });
      } else if (ev.type === 'pathfinder.payment') {
        pushTl({ at: ev.at, badgeHtml: badge(ev.mode), fixture: false, text: `Pathfinder replay payment ${ev.route || ''} · captured by ${ev.capturedBy || '?'} (demo accounts, not organic)` });
      }
    });

    async function loadFlows(initial) {
      try {
        let body;
        if (isFixture()) { if (!initial) return; body = (await getFixture()).flows; }
        else {
          const latest = timeline.map((t) => t.at).filter(Boolean).sort().at(-1);
          body = await api.get(`/api/spokes/flows?limit=40${!initial && latest ? '&since=' + encodeURIComponent(latest) : ''}`);
        }
        const list = (body?.flows || []).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
        for (const f of list) ingestFlow(f, { animate: !initial && Date.parse(f.at) >= mountedAt - 60000 });
      } catch { /* flows endpoint not present yet */ }
    }

    await loadSnapshot();
    await loadFlows(true);
    renderTl();
    updateReplayUi();
    // Refresh: API mode follows snapshot.refreshMin; fixture mode retries the API every minute.
    setInterval(async () => {
      if (isFixture() || source.kind === 'none') { const was = source.kind; await loadSnapshot(); if (source.kind === 'api' && was !== 'api') { timeline.length = 0; seen.clear(); feed.MAINNET_OBSERVED = feed.LIVE_TESTNET = 0; await loadFlows(true); renderTl(); } }
    }, 60000);
    setInterval(() => { if (source.kind === 'api') loadSnapshot(); }, Math.max(1, Number(snap?.snapshot?.refreshMin) || 5) * 60000);
    setInterval(() => { if (source.kind === 'api') loadFlows(false); }, 20000);
    let lastW = 0;
    if (window.ResizeObserver) new ResizeObserver(() => { const w = Math.round(svg.clientWidth); if (w && Math.abs(w - lastW) > 20) { lastW = w; render(); } }).observe(svg);
  },
};
