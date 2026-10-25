// Titan View — Project Growth Visualizer.
// Hub-and-spoke SVG: XRP hub at center, one spoke per launched Testnet token.
// Pure layout / state helpers are exported for node:test (test/view.test.mjs); DOM code lives in mount().
// Mode rule: ledger-backed visuals are LIVE_TESTNET; ring bands, capital pulses and other modeled data
// carry SIMULATION; the timeline re-animation carries REPLAY. Unknown modes are never shown as live.
import { STAGES, RINGS } from '../domain.js';
import { CREATURES, creatureFor, catchBoard } from '../creatures.js';
import { oceanTick } from '../ocean.js';

export const STEP_KEYS = ['validate', 'trust_maker', 'trust_taker', 'issue', 'ask', 'bid', 'fill', 'verify'];
const STEP_PHASE = { validate: 'Validating', trust_maker: 'Trustlines', trust_taker: 'Trustlines', issue: 'Issuance', ask: 'Order book', bid: 'Order book', fill: 'Demo fill', verify: 'Verifying' };
const RANK = { pending: 0, running: 1, done: 2, failed: 2 };
export const RING_STAGES = new Set(['corridor', 'mature']);
const MODE_SET = new Set(['LIVE_TESTNET', 'SIMULATION', 'REPLAY']);
const CATEGORY_MARKET = { currency: 'currencies', securities: 'securities', real_estate: 'real_estate', precious_metals: 'precious_metals' };
const TICKER_MAX = 20;
const FILL_XRP = 1; // launch demo fill: QUOTE.fillQty × QUOTE.ask in lib/ledger.mjs

// ---------- pure helpers ----------

// Anything not explicitly labeled is treated as simulated, never as live.
export function normMode(m) { return MODE_SET.has(m) ? m : 'SIMULATION'; }
export function stageLabel(id) { return STAGES.find((s) => s.id === id)?.label || id || '—'; }
export function initialState() { return { nodes: {}, order: [], ticker: [], capital: null }; }

function blankNode(code, extra = {}) {
  return { code, name: code, launchId: null, category: null, status: 'queued', stage: 'entered', stageMode: 'LIVE_TESTNET', stageFrom: 'launch',
    steps: {}, fillHash: null, issuer: null, error: null, rings: null, ringsMode: null, ringsOn: false, findings: [], external: false, ...extra };
}
const cloneState = (s) => ({ ...s, nodes: { ...s.nodes }, order: [...s.order], ticker: [...s.ticker] });

// Step updates never downgrade (SSE backlog can replay a "running" after a "done").
export function mergeStep(steps, step) {
  if (!step?.key) return steps;
  const prev = steps[step.key];
  if (prev && (RANK[prev.status] ?? 0) > (RANK[step.status] ?? 0)) return { ...steps, [step.key]: { ...step, ...prev, hash: prev.hash || step.hash } };
  return { ...steps, [step.key]: { ...prev, ...step } };
}

export function progressOf(node) {
  if (!node) return 0;
  if (node.status === 'live') return 1;
  return STEP_KEYS.filter((k) => node.steps[k]?.status === 'done').length / STEP_KEYS.length;
}

export function phaseOf(node) {
  if (node.external) return 'External corridor market';
  if (node.status === 'live') return 'Spoke online';
  if (node.status === 'failed') return 'Launch failed';
  const running = STEP_KEYS.find((k) => node.steps[k]?.status === 'running');
  if (running) return STEP_PHASE[running];
  return node.status === 'queued' ? 'Queued' : 'In progress';
}

const fmtUsd = (n) => { n = Number(n) || 0; return n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : `$${Math.round(n)}`; };
export function summarize(ev) {
  const c = ev.code || '';
  switch (ev.type) {
    case 'launch.created': return `${c} entered: ${ev.name || ''}`.trim();
    case 'launch.step': return `${c} · ${ev.step?.label || ev.step?.key} — ${ev.step?.status}`;
    case 'launch.done': return `${c} spoke online · validated fill${ev.fillHash ? ' ' + String(ev.fillHash).slice(0, 10) + '…' : ''} (demo counterparty)`;
    case 'launch.failed': return `${c} launch failed: ${ev.error || 'error'}`;
    case 'corridor.stage_changed': return `${c} ${stageLabel(ev.from)} → ${stageLabel(ev.to)}`;
    case 'capital.injected': return `${fmtUsd(ev.capitalUsd)} injected → ${ev.marketId || 'market'}${ev.tierId ? ' · ' + ev.tierId : ''}${ev.profileId ? ' · ' + ev.profileId : ''}`;
    case 'sentinel.finding': return `${c ? c + ' · ' : ''}${ev.severity || 'info'}: ${ev.title || 'finding'}`;
    case 'pathfinder.payment': { const k = creatureFor(ev.sizeXrp); return `${k.emoji} ${k.id} caught · ${ev.from}→${ev.to} ${Number(ev.sizeXrp).toFixed(3)} XRP${ev.bridged ? ' · bridged via XRP' : ''} (demo payment)`; }
    case 'loop.started': return 'Demo loop started (operator-approved capped session)';
    case 'loop.stopped': return `Demo loop stopped: ${ev.reason || ''}`;
    default: return ev.type;
  }
}
// Running-step events would flood the ticker (two per step); keep only outcomes. Bookkeeping events
// (finding edits, every quote/cancel of a Pathfinder run, loop phase ticks) have their own tabs.
const TICKER_SKIP = new Set(['findings.updated', 'pathfinder.step', 'loop.round', 'loop.stopping', 'spokes.flow', 'corridor.score']);
export const tickerWorthy = (ev) => !TICKER_SKIP.has(ev.type) && (ev.type !== 'launch.step' || ['done', 'failed'].includes(ev.step?.status));

// Latest SIMULATION capital injection from GET /api/capital/state (so the ocean runs even if it happened before the page opened).
export function latestCapital(state) {
  let best = null;
  for (const [marketId, snap] of Object.entries(state?.snapshots || {})) for (const inj of snap.injections || []) if (!best || Date.parse(inj.at) > Date.parse(best.at)) best = { ...inj, marketId };
  return best ? { marketId: best.marketId, profileId: best.profileId, tierId: best.tierId, capitalUsd: best.capitalUsd, mode: 'SIMULATION', at: best.at } : null;
}

// Event reducer: returns a new state plus animation cues (fx). Unknown event types only reach the ticker.
export function reduce(prev, ev, { fx: wantFx = true } = {}) {
  if (!ev || typeof ev.type !== 'string') return { state: prev, fx: [] };
  const s = cloneState(prev);
  const fx = [];
  const mode = normMode(ev.mode);
  const code = typeof ev.code === 'string' && ev.code ? ev.code.toUpperCase() : null;
  const put = (n) => { if (!s.nodes[n.code]) s.order.push(n.code); s.nodes[n.code] = n; };
  const cur = code ? s.nodes[code] : null;

  switch (ev.type) {
    case 'launch.created': {
      if (!code) break;
      if (cur && cur.launchId === ev.launchId) { put({ ...cur, name: ev.name || cur.name }); break; }
      if (cur && cur.status === 'live' && !cur.external) break; // stale backlog for a ticker that is already live
      put(blankNode(code, { name: ev.name || code, launchId: ev.launchId || null, category: ev.category || null, status: 'queued', ...(cur ? { rings: cur.rings, ringsMode: cur.ringsMode, findings: cur.findings } : {}) }));
      fx.push({ kind: 'appear', code, mode });
      break;
    }
    case 'launch.step': {
      if (!code || !ev.step) break;
      if (cur && cur.launchId && ev.launchId && cur.launchId !== ev.launchId && cur.status === 'live') break;
      const n = cur ? { ...cur } : blankNode(code, { launchId: ev.launchId || null });
      n.steps = mergeStep(n.steps, ev.step);
      if (ev.step.status === 'failed') { n.status = 'failed'; n.error = ev.step.error || n.error; }
      else if (n.status !== 'live' && n.status !== 'failed') n.status = 'running';
      n.external = false;
      put(n);
      fx.push({ kind: 'step', code, mode });
      break;
    }
    case 'launch.done': {
      if (!code) break;
      const n = cur ? { ...cur } : blankNode(code, { name: ev.name || code, launchId: ev.launchId || null });
      n.status = 'live'; n.external = false;
      n.name = ev.name || n.name;
      if (n.stageFrom !== 'corridor' && n.stage === 'entered') n.stage = 'spoke';
      const steps = { ...n.steps };
      for (const k of STEP_KEYS) if (steps[k]?.status !== 'failed') steps[k] = { key: k, ...steps[k], status: 'done' };
      n.steps = steps;
      Object.assign(n, { fillHash: ev.fillHash || n.fillHash, issuer: ev.issuer || n.issuer, book: ev.book || n.book });
      put(n);
      fx.push({ kind: 'fill', code, mode });
      fx.push({ kind: 'creature', from: 'XRP', to: code, xrp: FILL_XRP, mode });
      break;
    }
    case 'launch.failed': {
      if (!code) break;
      if (cur && cur.launchId && ev.launchId && cur.launchId !== ev.launchId && cur.status === 'live') break;
      put({ ...(cur || blankNode(code, { launchId: ev.launchId || null })), status: 'failed', error: ev.error || 'failed' });
      fx.push({ kind: 'failed', code, mode });
      break;
    }
    case 'corridor.stage_changed': {
      if (!code || !ev.to) break;
      const n = cur ? { ...cur } : blankNode(code, { status: 'external', external: true });
      const wasOn = n.ringsOn;
      // Two tracks: a SIMULATION event sets simStage only; live/replay evidence sets the real stage.
      if (mode === 'SIMULATION' && !n.external) n.simStage = ev.to;
      else { n.stage = ev.to; n.stageMode = mode; n.stageFrom = 'corridor'; if (n.simStage === ev.to) n.simStage = null; }
      // Ring allocations are modeled capital even on the live-evidence track: never label them LIVE.
      if (Array.isArray(ev.rings)) { n.rings = ev.rings; n.ringsMode = mode === 'REPLAY' ? 'REPLAY' : 'SIMULATION'; }
      n.ringsOn = RING_STAGES.has(n.stage) || RING_STAGES.has(n.simStage);
      put(n);
      if (n.ringsOn && !wasOn) fx.push({ kind: 'graduate', code, mode });
      else if (!n.ringsOn && wasOn) fx.push({ kind: 'demote', code, mode });
      else fx.push({ kind: 'stage', code, mode });
      break;
    }
    case 'capital.injected': {
      s.capital = { marketId: ev.marketId, profileId: ev.profileId, tierId: ev.tierId, capitalUsd: ev.capitalUsd, mode, at: ev.at };
      fx.push({ kind: 'domino', marketId: ev.marketId, capitalUsd: ev.capitalUsd, mode });
      break;
    }
    case 'pathfinder.payment': {
      // One creature per validated pathfound payment, classed by its XRP-equivalent size.
      const from = String(ev.from || '').toUpperCase(), to = String(ev.to || '').toUpperCase();
      const c = ev.capturedBy || {};
      const bucket = (c.maker || 0) >= Math.max(c.rival || 0, c.other || 0) && (c.maker || 0) > 0 ? 'maker' : (c.rival || 0) >= (c.other || 0) && (c.rival || 0) > 0 ? 'rival' : 'other';
      fx.push({ kind: 'creature', from, to, xrp: Number(ev.sizeXrp) || 0, bridged: !!ev.bridged, bucket, mode });
      break;
    }
    case 'sentinel.finding': {
      if (!cur) break;
      put({ ...cur, findings: [...cur.findings, { severity: ev.severity || 'info', title: ev.title || 'finding', mode, at: ev.at }].slice(-10) });
      fx.push({ kind: 'warn', code, mode });
      break;
    }
    default: break;
  }
  if (tickerWorthy(ev)) s.ticker = [{ type: ev.type, mode, at: ev.at || null, code, text: summarize({ ...ev, code }) }, ...s.ticker].slice(0, TICKER_MAX);
  return { state: s, fx: wantFx ? fx : [] };
}

// Merge authoritative launch records (GET /api/launches). Prefers a non-failed record per ticker.
export function hydrate(prev, launches) {
  if (!Array.isArray(launches)) return prev;
  const best = new Map();
  for (const r of launches) {
    if (!r?.code) continue;
    const c = best.get(r.code);
    if (!c || c.status === 'failed' || r.status !== 'failed') best.set(r.code, r);
  }
  const s = cloneState(prev);
  for (const r of best.values()) {
    const code = r.code.toUpperCase();
    const old = s.nodes[code];
    const n = old ? { ...old } : blankNode(code);
    let steps = {};
    for (const st of r.steps || []) steps = mergeStep(steps, st);
    if (old && old.launchId === r.id) for (const st of Object.values(old.steps)) steps = mergeStep(steps, st);
    Object.assign(n, { name: r.name || code, launchId: r.id, category: r.category || null, status: r.status || 'queued', steps,
      fillHash: r.fillHash || null, issuer: r.issuer || null, error: r.error || null, book: r.book || null, external: false });
    if (n.stageFrom !== 'corridor') n.stage = r.stage || (r.status === 'live' ? 'spoke' : 'entered');
    if (!old) s.order.push(code);
    s.nodes[code] = n;
  }
  return s;
}

// Extract [{code, stage, mode, rings}] from an unknown-shape /api/corridor response.
export function corridorItems(resp) {
  if (!resp || typeof resp !== 'object') return [];
  let arr = Array.isArray(resp) ? resp : ['tokens', 'corridors', 'items', 'projects', 'markets', 'launches', 'data'].map((k) => resp[k]).find(Array.isArray);
  if (!arr) arr = Object.values(resp).find(Array.isArray);
  if (!arr) {
    const vals = Object.entries(resp).filter(([, v]) => v && typeof v === 'object' && (v.stage || v.to));
    arr = vals.map(([k, v]) => ({ code: k, ...v }));
  }
  // 40-corridor shape: { tokens: [{ code, liveStage, simStage }] } — two tracks, emitted separately (live first).
  return arr.flatMap((it) => {
    const code = String(it?.code || it?.ticker || '').toUpperCase();
    const rings = Array.isArray(it?.rings) ? it.rings : undefined;
    const explicit = it?.stage || it?.to;
    if (explicit) return [{ code, stage: explicit, mode: normMode(it?.mode || resp.mode), rings }];
    const out = [];
    if (it?.liveStage) out.push({ code, stage: it.liveStage, mode: 'LIVE_TESTNET', rings });
    if (it?.simStage) out.push({ code, stage: it.simStage, mode: 'SIMULATION', rings });
    return out;
  })
    .filter((x) => x.code && x.stage && STAGES.some((st) => st.id === x.stage));
}

// Node positions around the hub. Angle 0 = top, clockwise. Large counts stagger across two orbits.
export function layoutNodes(n, { radius = 330 } = {}) {
  if (n <= 0) return [];
  const nodeR = n <= 6 ? 34 : Math.max(16, 34 - (n - 6) * 1.4);
  const stagger = n > 10;
  const out = [];
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const r = stagger ? radius * (i % 2 ? 1.08 : 0.74) : radius;
    out.push({ x: +(r * Math.cos(angle)).toFixed(2), y: +(r * Math.sin(angle)).toFixed(2), angle: +((angle * 180) / Math.PI).toFixed(3), r: +r.toFixed(2), nodeR });
  }
  // Ring-band room: half the gap to the neighbour minus the node itself.
  const chord = n > 1 ? 2 * (stagger ? radius * 0.74 : radius) * Math.sin(Math.PI / n) * (stagger ? 1.6 : 1) : 400;
  const bandMax = Math.max(8, Math.min(46, chord / 2 - nodeR - 6));
  return out.map((p) => ({ ...p, bandMax: +bandMax.toFixed(2) }));
}

// Six concentric bands (VELOCITY innermost → CEILING outermost), thickness ∝ allocation.
export function ringBands(rings, { inner = 40, total = 40 } = {}) {
  const byId = new Map((rings || []).map((r) => [r.id, r]));
  const allocs = RINGS.map((R) => Math.max(0, Number(byId.get(R.id)?.allocUsd) || 0));
  const sum = allocs.reduce((a, b) => a + b, 0);
  const illustrative = !(sum > 0);
  const minT = Math.min(1.5, total / 12);
  const raw = allocs.map((a) => (illustrative ? total / RINGS.length : Math.max(minT, (total * a) / sum)));
  const k = total / raw.reduce((a, b) => a + b, 0);
  let r0 = inner;
  return RINGS.map((R, i) => {
    const t = raw[i] * k;
    const band = { id: R.id, r0: +r0.toFixed(2), r1: +(r0 + t).toFixed(2), allocUsd: allocs[i], utilization: Number(byId.get(R.id)?.utilization) || 0, illustrative };
    r0 += t;
    return band;
  });
}

// Recorded launch history → timed events (mode REPLAY). Gaps are compressed for presentation.
export function buildReplay(launches, { scale = 0.12, minGap = 120, maxGap = 700 } = {}) {
  const raw = [];
  const T = (x) => { const t = Date.parse(x); return Number.isFinite(t) ? t : null; };
  for (const l of launches || []) {
    const t0 = T(l.createdAt);
    if (t0 == null || !l.code) continue;
    const base = { launchId: l.id, code: l.code };
    raw.push({ t: t0, ev: { type: 'launch.created', ...base, name: l.name, category: l.category } });
    const steps = (l.steps || []).filter((s) => T(s.startedAt) != null);
    steps.forEach((s, i) => {
      const ts = T(s.startedAt);
      const te = i + 1 < steps.length ? T(steps[i + 1].startedAt) : (T(l.completedAt) ?? ts + 400);
      raw.push({ t: ts, ev: { type: 'launch.step', ...base, step: { key: s.key, label: s.label, status: 'running' } } });
      if (s.status === 'done' || s.status === 'failed') raw.push({ t: Math.max(ts + 1, te - 1), ev: { type: 'launch.step', ...base, step: { ...s } } });
    });
    if (l.status === 'live') raw.push({ t: T(l.completedAt) ?? (raw.at(-1).t + 1), ev: { type: 'launch.done', ...base, name: l.name, fillHash: l.fillHash, issuer: l.issuer, book: l.book } });
    else if (l.status === 'failed') raw.push({ t: raw.at(-1).t + 2, ev: { type: 'launch.failed', ...base, error: l.error } });
  }
  raw.sort((a, b) => a.t - b.t);
  let last = null;
  return raw.map(({ t, ev }) => {
    const delay = last == null ? 0 : Math.round(Math.min(maxGap, Math.max(minGap, (t - last) * scale)));
    last = t;
    return { delay, ev: { ...ev, mode: 'REPLAY', at: new Date(t).toISOString(), recordedAt: new Date(t).toISOString() } };
  });
}

export function explorerUrl(step) {
  if (typeof step?.explorer === 'string' && step.explorer.startsWith('https://testnet.xrpl.org/')) return step.explorer;
  return step?.hash && /^[0-9A-F]{64}$/i.test(step.hash) ? `https://testnet.xrpl.org/transactions/${step.hash}` : null;
}

export function marketForCategory(cat) { return CATEGORY_MARKET[cat] || null; }

// ---------- DOM ----------

const NS = 'http://www.w3.org/2000/svg';
const STYLE = `
.tv-root{--tv-hub:var(--accent)}
.tv-root .tv-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
.tv-root .tv-bar h2{margin:0 auto 0 0}
.tv-root .tv-bar input[type=range]{width:160px;max-width:40vw;padding:0}
.tv-root .tv-main{display:grid;gap:16px;grid-template-columns:minmax(0,1fr)}
@media (min-width:900px){.tv-root .tv-main{grid-template-columns:minmax(0,1fr) 340px}}
.tv-root .tv-stage{position:relative;padding:8px;min-width:0}
.tv-root svg.tv-svg{display:block;width:100%;height:auto;max-height:78vh;margin:0 auto;font-family:system-ui,-apple-system,Segoe UI,sans-serif;touch-action:manipulation}
.tv-root .tv-replay-on svg.tv-svg{outline:2px dashed var(--replay);outline-offset:-2px;border-radius:8px}
.tv-root .tv-side{min-width:0}
.tv-root .tv-side table{table-layout:fixed}
.tv-root .tv-side td,.tv-root .tv-side th{overflow-wrap:anywhere}
.tv-root .tv-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--muted);margin-top:8px}
.tv-root .tv-legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:-1px;border:2px solid var(--c);background:var(--panel)}
.tv-root .tv-ticker{list-style:none;margin:0;padding:0;font-size:13px;max-height:340px;overflow-y:auto}
.tv-root .tv-ticker li{display:flex;gap:8px;align-items:baseline;padding:5px 0;border-bottom:1px solid var(--line);min-width:0}
.tv-root .tv-ticker li span.t{overflow-wrap:anywhere;min-width:0}
.tv-root .tv-ticker time{font:11px var(--mono);color:var(--muted);flex:none}
.tv-root .tv-ticker .badge{flex:none}
.tv-root .tv-st-entered{--c:var(--muted)} .tv-root .tv-st-spoke{--c:var(--accent)} .tv-root .tv-st-growing_spoke{--c:var(--replay)}
.tv-root .tv-st-corridor{--c:var(--live)} .tv-root .tv-st-mature{--c:var(--live)} .tv-root .tv-st-standby{--c:var(--sim)} .tv-root .tv-st-failed{--c:var(--muted)}
.tv-root .tv-hub-core{fill:var(--panel);stroke:var(--tv-hub);stroke-width:5}
.tv-root .tv-hub-glow{fill:var(--tv-hub);opacity:.12}
.tv-root .tv-txt{fill:var(--ink)} .tv-root .tv-sub{fill:var(--muted)}
.tv-root .tv-orbit{fill:none;stroke:var(--line);stroke-width:1.5;stroke-dasharray:4 8}
.tv-root .tv-spoke{transition:transform .8s ease}
.tv-root .tv-spoke line.base{stroke:var(--line);stroke-width:4;stroke-linecap:round;transition:stroke .6s}
.tv-root .tv-spoke.on line.base{stroke:var(--c);stroke-opacity:.75}
.tv-root .tv-spoke.failed line.base{stroke-dasharray:6 10}
.tv-root .tv-spoke line.glow{stroke:var(--c);stroke-width:10;stroke-linecap:round;opacity:0;filter:drop-shadow(0 0 6px var(--c))}
.tv-root .tv-spoke circle.pulse{fill:var(--c);opacity:0;filter:drop-shadow(0 0 8px var(--c))}
.tv-root .tv-node{cursor:pointer;transition:transform .8s ease;outline:none}
.tv-root .tv-node .core{fill:var(--panel);stroke:var(--c);stroke-width:4;transition:stroke .5s}
.tv-root .tv-node.failed{opacity:.55} .tv-root .tv-node.failed .core{stroke-dasharray:5 5}
.tv-root .tv-node .track{fill:none;stroke:var(--line);stroke-width:5}
.tv-root .tv-node .arc{fill:none;stroke:var(--c);stroke-width:5;stroke-linecap:round;transition:stroke-dasharray .6s ease}
.tv-root .tv-node.running .arc{animation:tv-blink 1.2s ease-in-out infinite}
.tv-root .tv-node.sel .core,.tv-root .tv-node:focus-visible .core{stroke:var(--accent);stroke-width:7}
.tv-root .tv-node .ringset{transform:scale(0);transition:transform .9s cubic-bezier(.2,.8,.2,1.15);opacity:.95}
.tv-root .tv-node.rings .ringset{transform:scale(1)}
.tv-root .tv-node .band{fill:none;stroke:var(--c)}
.tv-root .tv-node .ringtag{fill:var(--sim);font-family:var(--mono);font-weight:700}
.tv-root .tv-node .warn{fill:var(--sim)} .tv-root .tv-node .warn.hi{fill:var(--bad)}
.tv-root .tv-node .warn-x{fill:var(--panel);font:800 16px system-ui}
.tv-root .tv-node .modetag{font-family:var(--mono);font-weight:700}
.tv-root .tv-m-LIVE_TESTNET{fill:var(--live)} .tv-root .tv-m-SIMULATION{fill:var(--sim)} .tv-root .tv-m-REPLAY{fill:var(--replay)}
.tv-root .tv-wave{fill:none;stroke:var(--sim);stroke-width:6;opacity:0}
.tv-root .tv-banner{font-family:var(--mono);font-weight:700}
.tv-root .tv-empty{fill:var(--muted)}
.tv-root .tv-creature{pointer-events:none}
.tv-root .tv-creature.tv-cr-maker text:first-child{filter:drop-shadow(0 0 10px #2a78d6)}
.tv-root .tv-creature.tv-cr-rival text:first-child{filter:drop-shadow(0 0 10px #eb6834)}
.tv-root .tv-creature.tv-cr-sim text:first-child{filter:drop-shadow(0 0 8px var(--sim))}
.tv-root .tv-cr-cap{font-family:var(--mono);font-weight:700;paint-order:stroke;stroke:var(--panel);stroke-width:3px}
.tv-root .tv-catch td,.tv-root .tv-catch th{padding:3px 8px;font-size:13px;white-space:nowrap}
.tv-root .tv-catch .bar{font-family:var(--mono);letter-spacing:-1px;color:var(--accent)}
.tv-root .tv-catch tr.hit td{font-weight:700}
.tv-root .tv-catch-wrap{overflow-x:auto}
.tv-root .tv-boards{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
.tv-root .tv-boards .card{min-width:0}
@keyframes tv-blink{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.tv-root *{transition:none!important;animation:none!important}}
`;

function svgEl(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}
const fmtXrp = (x) => (x >= 1000 ? Math.round(x).toLocaleString() : Number(x).toFixed(x < 1 ? 3 : 2));
const short = (h, n = 10) => (h ? `${String(h).slice(0, n)}…` : '');
const timeOf = (at) => { const d = new Date(at); return Number.isFinite(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--'; };

export default {
  id: 'view', title: 'Titan View', order: 20,
  async mount(el, api) {
    const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const mountedAt = Date.now();
    if (!document.getElementById('tv-style')) { const st = document.createElement('style'); st.id = 'tv-style'; st.textContent = STYLE; document.head.append(st); }

    el.innerHTML = `<div class="tv-root">
      <div class="card">
        <div class="tv-bar">
          <h2>Titan View · project growth <span id="tv-mode">${api.badge('LIVE_TESTNET')}</span></h2>
          <button class="ghost" id="tv-play" type="button" aria-pressed="false">▶ Replay timeline</button>
          <button class="ghost" id="tv-live" type="button" hidden>● Back to live</button>
          <input type="range" id="tv-scrub" min="0" max="0" value="0" aria-label="Replay position" hidden>
          <span id="tv-pos" class="muted mono"></span>
        </div>
        <div class="tv-main">
          <div class="tv-stage" id="tv-stage">
            <svg class="tv-svg" viewBox="-500 -500 1000 1000" role="img" aria-labelledby="tv-svg-title">
              <title id="tv-svg-title">XRP hub with one spoke per launched Testnet token</title>
              <g class="tv-layer-orbit"></g><g class="tv-layer-spokes"></g><g class="tv-layer-hub"></g><g class="tv-layer-nodes"></g><g class="tv-layer-fx"></g><g class="tv-layer-banner"></g>
            </svg>
            <div class="tv-legend" id="tv-legend"></div>
          </div>
          <aside class="tv-side" id="tv-side"></aside>
        </div>
      </div>
      <div class="tv-boards">
        <div class="card"><h3>Catch board · Testnet ${api.badge('LIVE_TESTNET')} <span class="badge bad">demo fills · organic:false</span></h3><div id="tv-catch" class="muted">Loading…</div></div>
        <div class="card"><h3>Catch board · ocean model ${api.badge('SIMULATION')}</h3><div id="tv-ocean" class="muted">Inject capital (Capital Injection tab or the Demo Loop) to start the modeled ocean.</div></div>
      </div>
      <div class="card"><h3>Event ticker <span class="muted" style="font-weight:400">· last ${TICKER_MAX}</span></h3><ul class="tv-ticker" id="tv-ticker"><li class="muted">Waiting for events…</li></ul></div>
    </div>`;

    const $ = (s) => el.querySelector(s);
    const svg = $('svg.tv-svg');
    const L = { orbit: $('.tv-layer-orbit'), spokes: $('.tv-layer-spokes'), hub: $('.tv-layer-hub'), nodes: $('.tv-layer-nodes'), fx: $('.tv-layer-fx'), banner: $('.tv-layer-banner') };
    const side = $('#tv-side'), tickerEl = $('#tv-ticker');

    $('#tv-legend').innerHTML = STAGES.map((s) => `<span class="tv-st-${s.id}"><i></i>${api.esc(s.label)}</span>`).join('') +
      `<span class="tv-st-failed"><i style="border-style:dashed"></i>Failed</span>
       <span>${api.badge('LIVE_TESTNET')} spokes, fills, steps</span><span>${api.badge('SIMULATION')} ring bands, capital pulses</span><span>${api.badge('REPLAY')} timeline</span>`;

    // Hub
    svgEl('circle', { class: 'tv-hub-glow', r: 92 }, L.hub);
    const hubCore = svgEl('circle', { class: 'tv-hub-core', r: 60 }, L.hub);
    svgEl('text', { class: 'tv-txt', 'text-anchor': 'middle', y: 10, 'font-size': 34, 'font-weight': 800 }, L.hub).textContent = 'XRP';
    svgEl('text', { class: 'tv-sub', 'text-anchor': 'middle', y: 34, 'font-size': 13 }, L.hub).textContent = 'Testnet hub';
    svgEl('title', {}, hubCore).textContent = 'XRP hub (XRPL Testnet). Spokes are token/XRP order books.';

    let live = initialState();
    let replay = null; // { events, idx, state, timer }
    let selected = null;
    const nodeEls = new Map(); // code -> { g, spoke, ... }
    let launchesCache = [];

    const view = () => (replay ? replay.state : live);
    const animOk = () => !reduced();

    function ensureNode(code) {
      let r = nodeEls.get(code);
      if (r) return r;
      const spoke = svgEl('g', { class: 'tv-spoke' }, L.spokes);
      const base = svgEl('line', { class: 'base', x1: 0, y1: 0, x2: 0, y2: 0 }, spoke);
      const glow = svgEl('line', { class: 'glow', x1: 0, y1: 0, x2: 0, y2: 0 }, spoke);
      const pulse = svgEl('circle', { class: 'pulse', r: 11 }, spoke);
      const g = svgEl('g', { class: 'tv-node', tabindex: 0, role: 'button' }, L.nodes);
      const ringset = svgEl('g', { class: 'ringset' }, g);
      const ringTitle = svgEl('title', {}, ringset);
      const track = svgEl('circle', { class: 'track' }, g);
      const arc = svgEl('circle', { class: 'arc', pathLength: 100, transform: 'rotate(-90)' }, g);
      const core = svgEl('circle', { class: 'core' }, g);
      const tick = svgEl('text', { class: 'tv-txt', 'text-anchor': 'middle', 'font-weight': 800 }, g);
      const name = svgEl('text', { class: 'tv-txt', 'text-anchor': 'middle' }, g);
      const stage = svgEl('text', { class: 'tv-sub', 'text-anchor': 'middle' }, g);
      const mtag = svgEl('text', { class: 'modetag', 'text-anchor': 'middle' }, g);
      const simtag = svgEl('text', { class: 'modetag tv-m-SIMULATION', 'text-anchor': 'middle' }, g);
      const warn = svgEl('g', { class: 'warnset' }, g);
      const title = svgEl('title', {}, g);
      const open = () => { selected = code; render(); renderSide(true); };
      g.addEventListener('click', open);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      r = { g, spoke, base, glow, pulse, ringset, ringTitle, track, arc, core, tick, name, stage, mtag, simtag, warn, title, bandsKey: '' };
      nodeEls.set(code, r);
      return r;
    }

    function render() {
      const s = view();
      const codes = s.order.filter((c) => s.nodes[c]);
      // Text scale: keep labels legible when the SVG is phone-narrow (viewBox is 1000 units wide).
      const k = Math.min(2, Math.max(1, 560 / (svg.clientWidth || 1000)));
      const pos = layoutNodes(codes.length, { radius: 330 - (k - 1) * 70 });
      // orbit guide
      L.orbit.replaceChildren();
      [...new Set(pos.map((p) => p.r))].forEach((r) => svgEl('circle', { class: 'tv-orbit', r }, L.orbit));
      for (const [code, r] of nodeEls) if (!s.nodes[code]) { r.g.remove(); r.spoke.remove(); nodeEls.delete(code); }
      codes.forEach((code, i) => {
        const n = s.nodes[code], p = pos[i], r = ensureNode(code);
        const stCls = n.status === 'failed' ? 'failed' : n.stage;
        const failed = n.status === 'failed';
        const nodeMode = replay ? 'REPLAY' : n.external ? n.stageMode : 'LIVE_TESTNET';
        r.g.setAttribute('class', `tv-node tv-st-${stCls}${failed ? ' failed' : ''}${n.status === 'running' || n.status === 'queued' ? ' running' : ''}${n.ringsOn ? ' rings' : ''}${selected === code ? ' sel' : ''}`);
        r.g.style.transform = `translate(${p.x}px, ${p.y}px)`;
        r.pos = { x: p.x, y: p.y, R: p.nodeR };
        r.g.setAttribute('aria-label', `${n.code} ${n.name}, ${stageLabel(n.stage)}, ${phaseOf(n)}. Open details.`);
        r.spoke.setAttribute('class', `tv-spoke tv-st-${stCls}${n.status === 'live' || n.external ? ' on' : ''}${failed ? ' failed' : ''}`);
        r.spoke.style.transform = `rotate(${p.angle}deg)`;
        const len = Math.max(0, p.r - p.nodeR - 6);
        for (const ln of [r.base, r.glow]) { ln.setAttribute('x1', 66); ln.setAttribute('x2', len); }
        r.spokeLen = len;
        const R = p.nodeR;
        r.core.setAttribute('r', R);
        r.track.setAttribute('r', R + 8); r.arc.setAttribute('r', R + 8);
        r.arc.setAttribute('stroke-dasharray', `${(progressOf(n) * 100).toFixed(1)} 100`);
        r.track.style.display = r.arc.style.display = n.status === 'live' || n.external ? 'none' : '';
        const fs = Math.max(15, R * 0.62) * Math.min(k, 1.4);
        r.tick.setAttribute('y', fs * 0.36); r.tick.setAttribute('font-size', fs); r.tick.textContent = n.code;
        // Labels sit on the outside of the node relative to the hub.
        const below = p.y >= -40;
        const lab = R + 14 + (n.ringsOn ? p.bandMax + 4 : 0);
        const showSim = !replay && n.simStage && n.simStage !== n.stage;
        const ly = below ? lab + 18 * k : -lab - (showSim ? 62 : 44) * k;
        r.name.setAttribute('y', ly); r.name.setAttribute('font-size', 22 * k); const maxCh = Math.round(22 / k); r.name.textContent = n.name.length > maxCh ? n.name.slice(0, maxCh - 1) + '…' : n.name;
        r.stage.setAttribute('y', ly + 21 * k); r.stage.setAttribute('font-size', 16 * k); r.stage.textContent = failed ? 'Launch failed' : n.status === 'live' || n.external ? stageLabel(n.stage) : `${phaseOf(n)} · ${Math.round(progressOf(n) * 100)}%`;
        const stageMode = replay ? 'REPLAY' : n.stageFrom === 'corridor' ? n.stageMode : 'LIVE_TESTNET';
        r.mtag.setAttribute('y', ly + 39 * k); r.mtag.setAttribute('font-size', 13 * k); r.mtag.setAttribute('class', `modetag tv-m-${stageMode}`); r.mtag.textContent = stageMode.replace('_', ' ');
        r.simtag.setAttribute('y', ly + 57 * k); r.simtag.setAttribute('font-size', 13 * k);
        r.simtag.textContent = showSim ? `SIMULATION: ${stageLabel(n.simStage)}` : '';
        r.title.textContent = `${n.code} · ${n.name} — ${stageLabel(n.stage)} (${nodeMode.replace(/_/g, ' ')})${showSim ? ` · simulated: ${stageLabel(n.simStage)}` : ''}`;
        // Ring bands (SIMULATION or whatever mode the corridor event carried)
        const bands = ringBands(n.rings, { inner: R + 4, total: p.bandMax });
        const key = JSON.stringify(bands) + n.ringsMode + below + k + !!replay;
        if (key !== r.bandsKey) {
          r.bandsKey = key;
          [...r.ringset.querySelectorAll('circle,text')].forEach((x) => x.remove());
          bands.forEach((b, j) => {
            const c = svgEl('circle', { class: 'band', r: ((b.r0 + b.r1) / 2).toFixed(2), 'stroke-width': Math.max(0.5, b.r1 - b.r0 - 0.8).toFixed(2), 'stroke-opacity': (0.9 - j * 0.12).toFixed(2), 'data-ring': j }, r.ringset);
            svgEl('title', {}, c).textContent = `${b.id} ring · ${b.illustrative ? 'illustrative (no allocation reported)' : fmtUsd(b.allocUsd) + ' allocated · ' + Math.round(b.utilization * 100) + '% utilization'} · ${(n.ringsMode || 'SIMULATION').replace('_', ' ')}`;
          });
          // Ring tag sits on the side opposite the text labels so they never collide.
          const tag = svgEl('text', { class: 'ringtag', 'text-anchor': 'middle', 'font-size': 12 * k, y: below ? -(R + p.bandMax + 8) : R + p.bandMax + 8 + 12 * k }, r.ringset);
          tag.textContent = (replay ? 'REPLAY' : n.ringsMode === 'LIVE_TESTNET' ? 'LIVE TESTNET' : (n.ringsMode || 'SIMULATION').replace('_', ' ')) + (bands[0].illustrative ? ' · illustrative' : '');
        }
        r.ringTitle.textContent = `Six-ring corridor (VELOCITY → CEILING), thickness ∝ allocation · ${(n.ringsMode || 'SIMULATION').replace('_', ' ')}`;
        // Sentinel marker
        r.warn.replaceChildren();
        if (n.findings.length) {
          const f = n.findings.at(-1);
          const hi = /crit|high/i.test(f.severity);
          const wx = R * 0.75, wy = -R * 0.75;
          const tri = svgEl('path', { class: `warn${hi ? ' hi' : ''}`, d: `M${wx} ${wy - 14} L${wx + 14} ${wy + 11} L${wx - 14} ${wy + 11} Z` }, r.warn);
          svgEl('text', { class: 'warn-x', x: wx, y: wy + 8, 'text-anchor': 'middle' }, r.warn).textContent = '!';
          svgEl('title', {}, tri).textContent = `${n.findings.length} Sentinel finding(s) · latest ${f.severity}: ${f.title} (${f.mode.replace('_', ' ')})`;
        }
      });
      // Empty state + banner
      L.banner.replaceChildren();
      if (!codes.length) svgEl('text', { class: 'tv-empty', 'text-anchor': 'middle', y: 150, 'font-size': 20 * k }, L.banner).textContent = replay ? 'Replay: waiting for first recorded launch…' : 'No tokens yet — launch one to grow a spoke';
      if (replay) svgEl('text', { class: 'tv-banner tv-m-REPLAY', x: -480, y: -470, 'font-size': 18 * k }, L.banner).textContent = 'REPLAY · recorded launch history';
      else svgEl('text', { class: 'tv-banner tv-m-LIVE_TESTNET', x: -480, y: -470, 'font-size': 18 * k }, L.banner).textContent = 'LIVE TESTNET';
      if (s.capital) {
        const t = svgEl('text', { class: `tv-banner tv-m-${replay ? 'REPLAY' : s.capital.mode}`, x: -480, y: 485, 'font-size': 15 * k }, L.banner);
        t.textContent = `${s.capital.mode.replace('_', ' ')} · last capital injection ${fmtUsd(s.capital.capitalUsd)} → ${s.capital.marketId || '?'}`;
      }
      $('#tv-mode').innerHTML = api.badge(replay ? 'REPLAY' : 'LIVE_TESTNET');
      $('.tv-stage').classList.toggle('tv-replay-on', !!replay);
      renderTicker(s);
      if (selected) renderSide(false);
    }

    function renderTicker(s) {
      tickerEl.innerHTML = s.ticker.length ? s.ticker.map((t) => `<li><time>${api.esc(timeOf(t.at))}</time>${api.badge(t.mode)}<span class="t">${api.esc(t.text)}</span></li>`).join('') : `<li class="muted">${replay ? 'Replay starting…' : 'Waiting for events…'}</li>`;
    }

    // ---- side panel ----
    const books = new Map(); // code -> {loading, data, error}
    async function loadBook(code, force) {
      if (!force && books.get(code)?.data) return;
      books.set(code, { loading: true });
      try { books.set(code, { data: await api.get(`/api/book/${encodeURIComponent(code)}`), at: new Date().toISOString() }); }
      catch (e) { books.set(code, { error: e.message }); }
      if (selected === code) renderSide(false);
    }
    function bookHtml(code) {
      const b = books.get(code);
      if (!b || b.loading) return '<p class="muted">Loading order book…</p>';
      if (b.error) return `<p class="err">Order book unavailable: ${api.esc(b.error)}</p>`;
      const rows = (side, list) => (list || []).map((o) => `<tr><td>${side}</td><td class="num">${api.esc(o.priceXrp)}</td><td class="num">${api.esc(o.qty)}</td><td class="mono">${api.esc(short(o.account, 8))}</td></tr>`).join('');
      const body = rows('Ask', b.data.asks) + rows('Bid', b.data.bids);
      return `<table><thead><tr><th>Side</th><th class="num">Price XRP</th><th class="num">Qty</th><th>Account</th></tr></thead><tbody>${body || '<tr><td colspan="4" class="muted">Empty book</td></tr>'}</tbody></table>
        <p class="muted" style="font-size:12px">Read ${api.esc(timeOf(b.at))} from the validated ledger. Offers are posted by the demo maker account.</p>`;
    }
    function renderSide(fresh) {
      const s = view();
      const n = selected && s.nodes[selected];
      if (!n) { side.innerHTML = `<div class="muted" style="padding:8px 0">Tap a token node to see its stage, live order book and every Testnet transaction.</div>`; return; }
      if (fresh && !n.external) loadBook(n.code, true);
      const steps = STEP_KEYS.map((k) => n.steps[k]).filter(Boolean);
      const modeNow = replay ? 'REPLAY' : n.external ? n.stageMode : 'LIVE_TESTNET';
      side.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><h3 style="margin:0">${api.esc(n.name)} · <span class="mono" style="font-size:15px">${api.esc(n.code)}</span></h3>
          <button class="ghost" type="button" data-close aria-label="Close details" style="padding:2px 8px">✕</button></div>
        <p style="margin:6px 0">${api.badge(modeNow)} <b>${api.esc(stageLabel(n.stage))}</b>${n.stageFrom === 'corridor' ? ` <span class="muted">stage set by corridor logic</span>` : ''}</p>
        ${n.simStage && n.simStage !== n.stage ? `<p style="margin:0 0 6px">${api.badge('SIMULATION')} <b>${api.esc(stageLabel(n.simStage))}</b> <span class="muted">modeled scenario, not on-ledger</span></p>` : ''}
        <p class="muted" style="margin:0 0 8px">${api.esc(phaseOf(n))}${n.category ? ' · ' + api.esc(n.category) : ''}${n.issuer ? ` · issuer <span class="mono">${api.esc(short(n.issuer, 12))}</span>` : ''}</p>
        ${n.status === 'failed' ? `<p class="err">Launch failed: ${api.esc(n.error || '')}</p>` : ''}
        ${n.external ? `<p class="muted">Not launched in this demo; shown because a corridor event referenced it.</p>` : `
        <h3 style="margin-top:12px">Order book ${api.badge('LIVE_TESTNET')} <button class="ghost" type="button" data-refresh style="padding:2px 8px;font-size:12px">Refresh</button></h3>
        ${bookHtml(n.code)}`}
        ${n.fillHash ? `<p style="margin:8px 0">${api.badge(replay ? 'REPLAY' : 'LIVE_TESTNET')} Validated fill <a class="mono" target="_blank" rel="noopener" href="https://testnet.xrpl.org/transactions/${api.esc(n.fillHash)}">${api.esc(short(n.fillHash, 16))}</a></p>
          <p class="muted" style="font-size:13px">This fill came from a demo counterparty we control. It proves the mechanics, not organic demand.</p>` : ''}
        ${steps.length ? `<h3 style="margin-top:12px">Testnet transactions</h3><ol style="padding-left:18px;margin:0;font-size:13px">${steps.map((st) => {
          const url = explorerUrl(st);
          return `<li style="padding:3px 0">${api.esc(st.label || st.key)} <span class="${st.status === 'failed' ? 'err' : 'muted'}">${api.esc(st.status || '')}</span>${url ? `<div class="mono"><a href="${api.esc(url)}" target="_blank" rel="noopener">${api.esc(short(st.hash, 16))}</a> ${api.esc(st.result || '')}${st.ledger ? ' · ledger ' + api.esc(st.ledger) : ''}</div>` : ''}</li>`;
        }).join('')}</ol>` : ''}
        ${n.ringsOn ? `<h3 style="margin-top:12px">Ring allocation ${api.badge(n.ringsMode || 'SIMULATION')}</h3>${n.rings?.length ? `<table><thead><tr><th>Ring</th><th class="num">Alloc</th><th class="num">Util</th></tr></thead><tbody>${RINGS.map((R) => { const x = n.rings.find((y) => y.id === R.id); return `<tr><td>${R.id}</td><td class="num">${x ? fmtUsd(x.allocUsd) : '—'}</td><td class="num">${x ? Math.round((Number(x.utilization) || 0) * 100) + '%' : '—'}</td></tr>`; }).join('')}</tbody></table>` : '<p class="muted">No allocation reported; bands drawn as illustrative equal widths.</p>'}` : ''}
        ${n.findings.length ? `<h3 style="margin-top:12px">Sentinel findings</h3><ul style="padding-left:18px;margin:0;font-size:13px">${n.findings.slice().reverse().map((f) => `<li>${api.badge(f.mode)} <b>${api.esc(f.severity)}</b> ${api.esc(f.title)}</li>`).join('')}</ul>` : ''}`;
      side.querySelector('[data-close]').onclick = () => { selected = null; render(); renderSide(false); };
      const rb = side.querySelector('[data-refresh]'); if (rb) rb.onclick = () => loadBook(n.code, true);
    }

    // ---- animations (Web Animations API; skipped under reduced motion) ----
    function play(fx) {
      if (!animOk() || !fx.length) return;
      for (const f of fx) {
        const r = f.code && nodeEls.get(f.code);
        if (f.kind === 'fill' && r) {
          const len = r.spokeLen || 200;
          r.pulse.animate([{ transform: 'translateX(66px)', opacity: 1 }, { transform: `translateX(${len}px)`, opacity: 1 }, { transform: `translateX(${len}px)`, opacity: 0 }], { duration: 1300, easing: 'ease-in' });
          r.glow.setAttribute('stroke-dasharray', `${len} ${len}`);
          r.glow.animate([{ strokeDashoffset: len, opacity: 1 }, { strokeDashoffset: 0, opacity: 1, offset: 0.6 }, { strokeDashoffset: 0, opacity: 0 }], { duration: 2200, easing: 'ease-out' });
          r.core.animate([{ strokeWidth: 4 }, { strokeWidth: 14, offset: 0.55 }, { strokeWidth: 4 }], { duration: 1600, delay: 900 });
        } else if (f.kind === 'appear' && r) {
          r.core.animate([{ transform: 'scale(0)' }, { transform: 'scale(1.2)' }, { transform: 'scale(1)' }], { duration: 700, easing: 'ease-out' });
        } else if (f.kind === 'failed' && r) {
          r.core.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 300, iterations: 2 });
        } else if (f.kind === 'warn' && r) {
          r.warn.animate([{ transform: 'scale(1.8)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 500, easing: 'ease-out' });
        } else if (f.kind === 'domino') domino(f);
        else if (f.kind === 'creature') creature(f);
        else if ((f.kind === 'graduate' || f.kind === 'demote') && r) corridorFlash(f, r);
      }
    }
    // A creature swims the route its fill took: token node <-> XRP hub (bridged payments cross the hub to the other spoke).
    function creature(f) {
      const at = (code) => (code === 'XRP' ? { x: 0, y: 0 } : nodeEls.get(code)?.pos || null);
      const pts = [at(f.from), ...(f.bridged || (f.from !== 'XRP' && f.to !== 'XRP') ? [{ x: 0, y: 0 }] : []), at(f.to)].filter(Boolean);
      if (pts.length < 2) return;
      const c = creatureFor(f.xrp), tier = CREATURES.length - 1 - CREATURES.indexOf(c); // 0 = plankton … 16 = kraken
      const size = 26 + tier * 7;
      const g = svgEl('g', { class: `tv-creature tv-cr-${f.bucket || 'maker'}` }, L.fx);
      const t = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': size }, g); t.textContent = c.emoji;
      const cap = svgEl('text', { class: `tv-cr-cap tv-m-${replay ? 'REPLAY' : f.mode}`, 'text-anchor': 'middle', y: size * 0.75 + 6, 'font-size': 13 }, g);
      cap.textContent = `${f.mode === 'SIMULATION' ? 'SIM · ' : ''}${c.id} · ${fmtXrp(f.xrp)} XRP`;
      svgEl('title', {}, g).textContent = `${c.id} (${f.xrp} XRP fill) · ${f.from}→${f.to}${f.bridged ? ' via XRP' : ''} · demo fill, ${replay ? 'REPLAY' : f.mode.replace('_', ' ')}`;
      const frames = pts.map((p, i) => ({ transform: `translate(${p.x}px, ${p.y}px) scale(${i === 0 ? 0.4 : 1})`, opacity: i === 0 ? 0 : 1, offset: i / (pts.length - 1) }));
      frames.splice(1, 0, { transform: `translate(${pts[0].x}px, ${pts[0].y}px) scale(1.15)`, opacity: 1, offset: 0.12 / (pts.length - 1) });
      frames.push({ ...frames.at(-1), offset: undefined }); frames.at(-2).offset = 0.92; frames.at(-1).opacity = 0; delete frames.at(-1).offset;
      const a = g.animate(frames, { duration: 2200 + (pts.length - 2) * 900, easing: 'ease-in-out' });
      a.onfinish = () => g.remove();
      if (f.mode !== 'SIMULATION') catchesDirty();
    }
    function corridorFlash(f, r) {
      const up = f.kind === 'graduate';
      const lbl = svgEl('text', { class: `tv-banner tv-m-${replay ? 'REPLAY' : f.mode}`, 'text-anchor': 'middle', x: r.pos?.x || 0, y: (r.pos?.y || 0) - (r.pos?.R || 40) - 70, 'font-size': 16 }, L.fx);
      lbl.textContent = `${(replay ? 'REPLAY' : f.mode).replace('_', ' ')} · ${f.code} corridor ${up ? 'stood up: 6 rings live' : 'torn down: capital released'}`;
      lbl.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 3200 }).onfinish = () => lbl.remove();
      r.ringset.animate(up ? [{ transform: 'scale(0.2)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }] : [{ transform: 'scale(1)' }, { transform: 'scale(1.1)', opacity: 1 }, { transform: 'scale(0)', opacity: 0.2 }], { duration: 1100, easing: 'ease-out' });
    }
    function domino(f) {
      const wave = svgEl('circle', { class: 'tv-wave', r: 60 }, L.fx);
      const a = wave.animate([{ transform: 'scale(1)', opacity: 0.9 }, { transform: 'scale(7.5)', opacity: 0 }], { duration: 1800, easing: 'ease-out' });
      a.onfinish = () => wave.remove();
      const lbl = svgEl('text', { class: `tv-banner tv-m-${replay ? 'REPLAY' : f.mode}`, 'text-anchor': 'middle', y: -110, 'font-size': 16 }, L.fx);
      lbl.textContent = `${f.mode.replace('_', ' ')} · ${fmtUsd(f.capitalUsd)} capital pulse`;
      lbl.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 2600 }).onfinish = () => lbl.remove();
      const s = view();
      const target = s.order.filter((c) => s.nodes[c] && (!f.marketId || marketForCategory(s.nodes[c].category) === f.marketId || s.nodes[c].code === f.marketId));
      const codes = target.length ? target : s.order.filter((c) => s.nodes[c]?.status === 'live' || s.nodes[c]?.external);
      codes.forEach((c) => {
        const r = nodeEls.get(c); if (!r) return;
        const len = r.spokeLen || 200;
        r.pulse.animate([{ transform: 'translateX(66px)', opacity: 1 }, { transform: `translateX(${len}px)`, opacity: 1 }, { transform: `translateX(${len}px)`, opacity: 0 }], { duration: 900, delay: 300, easing: 'ease-in' });
        r.ringset.querySelectorAll('circle.band').forEach((b, j) => b.animate([{ strokeOpacity: b.getAttribute('stroke-opacity') }, { strokeOpacity: 1, stroke: 'var(--sim)' }, { strokeOpacity: b.getAttribute('stroke-opacity') }], { duration: 500, delay: 1200 + j * 140 }));
        if (!s.nodes[c].ringsOn) r.core.animate([{ strokeWidth: 4 }, { strokeWidth: 10, stroke: 'var(--sim)' }, { strokeWidth: 4 }], { duration: 700, delay: 1200 });
      });
    }

    // ---- catch board (every validated demo fill, classed by size) ----
    let catchTimer = null;
    async function loadCatches() {
      try {
        const d = await api.get('/api/loop/catches');
        $('#tv-catch').innerHTML = boardHtml(d, d.note);
      } catch (e) { $('#tv-catch').innerHTML = `<p class="muted">Catch board unavailable: ${api.esc(e.message)}</p>`; }
    }
    function boardHtml(d, note) {
      const bar = (sh, n) => { const k = n ? Math.max(1, Math.round(sh * 22)) : 0; return '▓'.repeat(k) + '░'.repeat(22 - k); };
      return `<p style="margin:4px 0"><b>Total catches ${d.total}</b> · Biggest beast ${d.biggest ? `${d.biggest.emoji} ${api.esc(d.biggest.creature)} ${api.esc(fmtXrp(d.biggest.xrp))} XRP` : '—'} · Last 5m ${d.last5} (${d.last5Big} big)</p>
        <div class="tv-catch-wrap"><table class="tv-catch"><thead><tr><th>Creature</th><th class="num">Size XRP</th><th class="num">Caught</th><th>Zone</th><th>Frequency</th></tr></thead><tbody>${d.rows.map((r) => `<tr class="${r.caught ? 'hit' : ''}"><td>${r.emoji} ${api.esc(r.id)}</td><td class="num">${api.esc(r.size)}</td><td class="num">${r.caught}</td><td>${api.esc(r.zone)}</td><td class="bar" aria-label="${r.caught} caught">${bar(r.share, r.caught)}</td></tr>`).join('')}</tbody></table></div>
        <p class="muted" style="font-size:12px;margin:6px 0 0">${api.esc(note)}</p>`;
    }
    // ---- SIMULATION ocean: modeled fills from active rings × injected capital (this screen only, never on-ledger) ----
    const oceanFills = [];
    let oceanBoardTimer = null;
    function oceanStep() {
      const s = live;
      if (replay || !s.capital || s.capital.mode !== 'SIMULATION' || document.hidden) return;
      const tokens = s.order.map((c) => s.nodes[c]).filter((n) => n && (n.status === 'live' || n.external)).map((n) => ({ code: n.code, stage: n.simStage || n.stage, rings: n.rings }));
      const fills = oceanTick(tokens, { capitalUsd: s.capital.capitalUsd, dtSec: 1 });
      for (const f of fills) {
        oceanFills.push({ xrp: f.xrp, at: new Date().toISOString() });
        if (animOk()) creature({ from: 'XRP', to: f.code, xrp: f.xrp, mode: 'SIMULATION', bucket: 'sim' });
      }
      if (oceanFills.length > 5000) oceanFills.splice(0, oceanFills.length - 5000);
      if (fills.length && !oceanBoardTimer) oceanBoardTimer = setTimeout(() => { oceanBoardTimer = null; $('#tv-ocean').innerHTML = boardHtml(catchBoard(oceanFills), `Modeled fills since this screen opened: sizes unlocked by active rings (spoke 2 · growing spoke 4 · corridor 6 · standby 1), frequency scaled by the last injected capital (${fmtUsd(live.capital?.capitalUsd)}). Not on-ledger, not demand.`); }, 1000);
    }
    setInterval(oceanStep, 1000);
    function catchesDirty() { clearTimeout(catchTimer); catchTimer = setTimeout(loadCatches, 1500); }

    // ---- live wiring ----
    function applyLive(ev) {
      const fresh = !ev.at || Date.parse(ev.at) >= mountedAt - 3000; // SSE backlog: update state, don't animate
      const out = reduce(live, ev, { fx: fresh });
      live = out.state;
      if (!replay) { render(); play(out.fx); }
      if (selected === ev.code && ev.type === 'launch.done' && !replay) loadBook(ev.code, true);
    }
    let hydrateTimer = null;
    const rehydrate = () => { clearTimeout(hydrateTimer); hydrateTimer = setTimeout(async () => {
      try { launchesCache = await api.get('/api/launches'); live = hydrate(live, launchesCache); if (!replay) render(); } catch {}
    }, 400); };

    api.on((ev) => {
      if (!ev || typeof ev.type !== 'string') return;
      applyLive(ev);
      if (ev.type === 'launch.done' || ev.type === 'launch.failed' || ev.type === 'launch.created') rehydrate();
      if (ev.type === 'launch.done' || ev.type === 'pathfinder.payment') catchesDirty();
    });

    try { launchesCache = await api.get('/api/launches'); live = hydrate(live, launchesCache); } catch (e) { live = { ...live, ticker: [{ type: 'error', mode: 'SIMULATION', at: new Date().toISOString(), text: `Could not load launches: ${e.message}` }, ...live.ticker] }; }
    try { const cap = latestCapital(await api.get('/api/capital/state')); if (cap && (!live.capital || Date.parse(cap.at) > Date.parse(live.capital.at || 0))) live = { ...live, capital: cap }; } catch { /* capital module absent: no ocean until an injection event */ }
    try {
      const corr = await api.get('/api/corridor');
      for (const it of corridorItems(corr)) {
        const cur = live.nodes[it.code];
        if (cur && (it.mode === 'SIMULATION' ? cur.simStage === it.stage || (!cur.simStage && cur.stage === it.stage) : cur.stage === it.stage && cur.stageFrom === 'corridor')) continue;
        live = reduce(live, { type: 'corridor.stage_changed', code: it.code, from: cur?.stage, to: it.stage, mode: it.mode, rings: it.rings, at: new Date().toISOString() }, { fx: false }).state;
        live.ticker = live.ticker.slice(1); // initial sync is not an event
      }
    } catch { /* corridor module not present yet — fine */ }
    render(); renderSide(false); loadCatches();
    // Re-layout text scale when the SVG width changes (rotation, projector, resize).
    let lastW = 0;
    if (window.ResizeObserver) new ResizeObserver(() => { const w = Math.round(svg.clientWidth); if (w && Math.abs(w - lastW) > 20) { lastW = w; render(); } }).observe(svg);

    // ---- replay timeline (client-only; never touches the server) ----
    const playBtn = $('#tv-play'), liveBtn = $('#tv-live'), scrub = $('#tv-scrub'), posEl = $('#tv-pos');
    function replayStateAt(i) { let st = initialState(); for (let j = 0; j < i; j++) st = reduce(st, replay.events[j].ev, { fx: false }).state; return st; }
    function updateReplayUi() {
      const on = !!replay;
      liveBtn.hidden = scrub.hidden = !on;
      playBtn.textContent = on && replay.timer ? '❚❚ Pause replay' : on ? '▶ Resume replay' : '▶ Replay timeline';
      playBtn.setAttribute('aria-pressed', String(!!(on && replay.timer)));
      posEl.textContent = on ? `REPLAY ${replay.idx}/${replay.events.length}${replay.events[replay.idx - 1] ? ' · ' + timeOf(replay.events[replay.idx - 1].ev.recordedAt) : ''}` : '';
      if (on) { scrub.max = replay.events.length; scrub.value = replay.idx; }
    }
    function step() {
      if (!replay) return;
      if (replay.idx >= replay.events.length) { replay.timer = null; updateReplayUi(); return; }
      const { ev } = replay.events[replay.idx++];
      const out = reduce(replay.state, ev, { fx: true });
      replay.state = out.state; render(); play(out.fx); updateReplayUi();
      const next = replay.events[replay.idx];
      replay.timer = next ? setTimeout(step, reduced() ? Math.min(next.delay, 150) : next.delay) : null;
      if (!next) updateReplayUi();
    }
    function startReplay() {
      const events = buildReplay(launchesCache);
      if (!events.length) { posEl.textContent = 'No recorded launches to replay.'; return; }
      replay = { events, idx: 0, state: initialState(), timer: null };
      step();
    }
    function pause() { if (replay?.timer) { clearTimeout(replay.timer); replay.timer = null; } updateReplayUi(); }
    playBtn.onclick = () => {
      if (!replay) startReplay();
      else if (replay.timer) pause();
      else { if (replay.idx >= replay.events.length) { replay.idx = 0; replay.state = initialState(); } step(); }
      updateReplayUi();
    };
    liveBtn.onclick = () => { pause(); replay = null; render(); renderSide(false); updateReplayUi(); };
    scrub.oninput = () => { if (!replay) return; pause(); replay.idx = Number(scrub.value); replay.state = replayStateAt(replay.idx); render(); updateReplayUi(); };
  },
};
