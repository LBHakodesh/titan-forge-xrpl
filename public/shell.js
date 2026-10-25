// GYW1313 experience shell for Titan Forge (London staging).
// Loads every public/modules/*.js (default { id, title, order?, mount(el, api) }) and groups them under a primary
// GYW1313 navigation (NAV below). Every module still gets exactly one button in #tabs (secondary row), so
// api.show(id), localStorage tab memory and scripts/browser-check.mjs keep working. Unknown modules fall under MORE.
// Entries whose modules are not present yet render as "coming online" (never a broken tab).
// DOM side effects run only in a browser, so Node tests can import NAV / resolveNav / entryFor.

// Primary navigation: entry key -> module ids (first available id is the entry's landing tab).
// `scenes` entries dispatch tf:present {scene} after showing the module.
export const NAV = Object.freeze([
  { key: 'watch', label: 'WATCH TITAN GHOST', modules: ['theater', 'view', 'loop'] },
  { key: 'explore', label: 'EXPLORE MAINNET', modules: ['observatory', 'pathfinder'] },
  { key: 'creatures', label: 'DOLPHIN / SHARK / WHALE / KRAKEN', modules: ['theater', 'view'], scenes: ['dolphin', 'shark', 'whale', 'kraken'] },
  { key: 'tglb', label: 'TGLB BOOTSTRAP', modules: ['incubator', 'capital'] },
  { key: 'xdlc', label: 'XDLC PROTOCOL', modules: ['xdlc-protocol', 'xdlc-app', 'xdlc-amm', 'corridor'] },
  { key: 'capital-move', label: 'WATCH CAPITAL MOVE', modules: ['redeploy'] },
  { key: 'sentinel', label: 'TG SENTINEL', modules: ['sentinel', 'findings'] },
  { key: 'vendors', label: 'VENDOR INTEGRATIONS', modules: ['vendors', 'merchant', 'x402', 'access'] },
  { key: 'products', label: 'ALL PRODUCTS', modules: ['products'] },
  { key: 'pitch', label: '▶ 3-MINUTE PITCH', modules: ['present'], header: true },
  { key: 'more', label: 'MORE', modules: [], more: true },
]);

// Resolve NAV against the module ids actually loaded. Returns entries with `available` ids (in NAV order;
// MORE collects every id no other entry claims, in load order) and `online` (false = "coming online").
export function resolveNav(ids, nav = NAV) {
  const have = new Set(ids);
  const claimed = new Set(nav.flatMap((n) => n.modules));
  return nav.map((n) => {
    const available = n.more ? ids.filter((id) => !claimed.has(id)) : n.modules.filter((id) => have.has(id));
    return { ...n, available, online: available.length > 0 };
  });
}

// Which entry should be active when module `id` is shown? Keep the current entry if it contains the id;
// otherwise the first (non-header) entry that offers it; otherwise MORE.
export function entryFor(id, currentKey, entries) {
  const cur = entries.find((e) => e.key === currentKey);
  if (cur && cur.available.includes(id)) return cur.key;
  const hit = entries.find((e) => !e.header && !e.more && e.available.includes(id)) || entries.find((e) => e.available.includes(id));
  return hit ? hit.key : 'more';
}

const BADGE_CLASS = { LIVE_TESTNET: 'live', SIMULATION: 'sim', REPLAY: 'replay', MAINNET_OBSERVED: 'mainnet', MAINNET_OBSERVED_READ_ONLY: 'mainnet', HISTORICAL_MAINNET: 'hist', PROPOSED: 'prop' };
const listeners = new Set();

export const api = {
  async get(path) { const r = await fetch(path); const b = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(b.error || r.statusText), { status: r.status, body: b }); return b; },
  async post(path, body) { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const b = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(b.error || (b.errors || []).join(' ') || r.statusText), { status: r.status, body: b }); return b; },
  // Subscribe to bus events ({ type, mode, at, ... }). Returns unsubscribe.
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  badge(mode) { const c = BADGE_CLASS[mode] || 'bad'; return `<span class="badge ${c}">${(mode || '?').replace(/_/g, ' ')}</span>`; },
  esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  // Cross-module navigation, e.g. api.show('view'). Returns true if the module exists.
  show(id) { return select(id); },
  // Is a module loaded? (Lets modules degrade gracefully when another workstream's tab isn't present.)
  has(id) { return registry.has(id); },
  modules() { return [...registry.keys()]; },
  // Show a module and send it a presentation scene: window 'tf:present' CustomEvent {detail:{scene}}.
  present(id, scene) { const ok = select(id); if (scene) window.dispatchEvent(new CustomEvent('tf:present', { detail: { scene, id } })); return ok; },
};

const registry = new Map();
let entries = resolveNav([]);
let activeKey = null;
let tabs, panels, gnav, menuBtn;

function setEntry(key) {
  activeKey = key;
  const e = entries.find((x) => x.key === key);
  for (const b of gnav?.querySelectorAll('button[data-entry]') || []) b.setAttribute('aria-current', b.dataset.entry === key ? 'true' : 'false');
  const pb = document.getElementById('present-btn'); if (pb) pb.classList.toggle('on', key === 'pitch');
  for (const [mid, { btn }] of registry) btn.hidden = !(e && e.available.includes(mid));
  // Scene chips (creatures) and "coming online" note live in the sub-row after the tab buttons.
  const extra = document.getElementById('tabs-extra');
  if (extra) {
    let h = '';
    if (e && e.scenes && e.online) h = `<span class="tabs-label">Scenario</span>${e.scenes.map((s) => `<button type="button" class="chip" data-scene="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}`;
    if (e && !e.online) h = `<span class="coming">${api.esc(e.label)}: coming online</span>`;
    extra.innerHTML = h;
  }
  try { localStorage.setItem('tf-nav', key); } catch {}
}

function select(id, key) {
  if (!registry.has(id)) return false;
  for (const [mid, { btn, el }] of registry) { const on = mid === id; btn.setAttribute('aria-selected', on); el.hidden = !on; }
  setEntry(key || entryFor(id, activeKey, entries));
  try { localStorage.setItem('tf-tab', id); } catch {}
  return true;
}

function openEntry(key) {
  const e = entries.find((x) => x.key === key);
  if (!e) return;
  if (!e.online) { for (const [, { btn, el }] of registry) { btn.setAttribute('aria-selected', false); el.hidden = true; } comingPanel(e); setEntry(key); return; }
  comingPanel(null);
  select(e.available[0], key);
  if (e.scenes) window.dispatchEvent(new CustomEvent('tf:present', { detail: { scene: e.scenes[0], id: e.available[0] } }));
  closeMenu();
}

// Placeholder for an entry whose module is not built yet: honest, never broken.
function comingPanel(e) {
  let p = document.getElementById('tf-coming');
  if (!e) { if (p) p.hidden = true; return; }
  if (!p) { p = document.createElement('section'); p.id = 'tf-coming'; p.className = 'panel'; panels.prepend(p); }
  p.hidden = false;
  p.innerHTML = `<div class="card"><h2>${api.esc(e.label)}</h2><p><span class="badge bad">COMING ONLINE</span> This area's module (${e.modules.map((m) => `<span class="mono">${api.esc(m)}</span>`).join(', ')}) is not loaded on this node yet. Nothing here is simulated or hidden: it simply hasn't shipped to this staging build.</p></div>`;
}

function renderNav() {
  gnav.innerHTML = entries.filter((e) => !e.header && (!e.more || e.online)).map((e) =>
    `<button type="button" data-entry="${e.key}" class="${e.online ? '' : 'pending'}" aria-current="false"${e.online ? '' : ' title="coming online"'}>${api.esc(e.label)}${e.online ? '' : ' <small>coming online</small>'}</button>`).join('');
}

function closeMenu() { if (menuBtn) { menuBtn.setAttribute('aria-expanded', 'false'); gnav.classList.remove('open'); } }

async function boot() {
  const files = await api.get('/api/modules');
  const mods = [];
  for (const f of files) {
    try { mods.push((await import(f)).default); } catch (e) { console.error('Module failed', f, e); }
  }
  mods.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  entries = resolveNav(mods.map((m) => m.id));
  renderNav();
  // Tab buttons first (so the nav is complete immediately), then mount modules one by one.
  const els = [];
  for (const m of mods) {
    const btn = document.createElement('button'); btn.role = 'tab'; btn.type = 'button'; btn.textContent = m.title; btn.dataset.id = m.id; btn.hidden = true;
    btn.onclick = () => { comingPanel(null); select(m.id); };
    const el = document.createElement('section'); el.className = 'panel'; el.hidden = true; el.dataset.module = m.id;
    tabs.append(btn); panels.append(el); registry.set(m.id, { btn, el });
    els.push([m, el]);
  }
  let saved = null, savedNav = null; try { saved = localStorage.getItem('tf-tab'); savedNav = localStorage.getItem('tf-nav'); } catch {}
  const hash = decodeURIComponent((location.hash || '').slice(1)).split('/')[0];
  const first = entries.find((e) => e.key === 'watch' && e.online)?.available[0] || mods[0]?.id;
  const start = registry.has(hash) ? hash : registry.has(saved) ? saved : first;
  const navOk = entries.find((e) => e.key === savedNav && e.available.includes(start));
  if (start) select(start, navOk && !registry.has(hash) ? savedNav : undefined);
  // The visible tab mounts first; the rest mount in parallel so no tab waits behind a slow one.
  const mountOne = async ([m, el]) => {
    try { await m.mount(el, api); } catch (e) { el.innerHTML = `<div class="card err">Module ${api.esc(m.title)} failed: ${api.esc(e.message)}</div>`; }
  };
  const visible = els.find(([m]) => m.id === start);
  if (visible) await mountOne(visible);
  await Promise.all(els.filter((x) => x !== visible).map(mountOne));
  window.dispatchEvent(new CustomEvent('tf:ready', { detail: { modules: [...registry.keys()] } }));
}

async function net() {
  const el = document.getElementById('net');
  try {
    const s = await api.get('/api/status');
    if (s.offline || s.mode === 'REPLAY') { replayBanner(); el.innerHTML = `${api.badge('REPLAY')} recorded ledger ${api.esc(s.validatedLedger ?? '—')} · ${s.launches.live} recorded tokens · ${s.validatedTxCount} recorded tx`; return; }
    el.innerHTML = `${api.badge('LIVE_TESTNET')} ledger ${s.validatedLedger} · ${s.launches.live} live tokens · ${s.validatedTxCount} validated tx`;
  }
  catch (e) { el.innerHTML = `<span class="badge bad">TESTNET OFFLINE</span> ${api.esc(e.message)} · replay available`; }
}

// Offline replay mode (server started with TF_OFFLINE=1): a global banner on every tab.
function replayBanner() {
  if (document.getElementById('tf-replay-banner')) return;
  const b = document.createElement('div');
  b.id = 'tf-replay-banner'; b.className = 'replay-banner'; b.setAttribute('role', 'status');
  b.innerHTML = `${api.badge('REPLAY')} <b>Offline replay mode.</b> <span>No network: recorded XRPL Testnet data is replayed. Nothing is signed or submitted; live actions are refused.</span>`;
  document.querySelector('header.top')?.after(b);
  document.documentElement.dataset.offline = '1';
}
// In offline replay mode nothing on screen is live: api.badge('LIVE_TESTNET') renders REPLAY, and any hard-coded
// LIVE TESTNET badge a module prints is relabeled too (Contract rule 2: recorded data is never shown as live).
let offline = false;
const badge = api.badge;
api.badge = (mode) => badge(offline && mode === 'LIVE_TESTNET' ? 'REPLAY' : mode);
function relabelLive(root) {
  if (!offline) return;
  for (const b of root.querySelectorAll('.badge.live')) { b.classList.replace('live', 'replay'); b.textContent = 'REPLAY'; b.title = 'Recorded XRPL Testnet data (offline replay mode)'; }
}

// Phone layout: wide tables (4+ columns) stack into label/value rows under 600px.
// Labels come from each table's header row, so modules need no changes.
function labelTables(root) {
  for (const t of root.querySelectorAll('table')) {
    const heads = [...(t.tHead?.rows[0]?.cells || [])].map((c) => c.textContent.trim());
    if (heads.length < 4) continue;
    t.classList.add('tf-stack');
    for (const row of t.tBodies[0]?.rows || []) {
      [...row.cells].forEach((td, i) => { if (!td.dataset.label && heads[i]) td.dataset.label = heads[i]; });
    }
  }
}

// Light / dark / auto theme toggle (tokens in shell.css). Auto follows the OS.
function initTheme() {
  const btn = document.getElementById('theme-btn');
  const apply = (t) => { if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; if (btn) btn.textContent = t === 'light' ? '☀ Light' : t === 'dark' ? '☾ Dark' : '◐ Auto'; };
  let t = null; try { t = localStorage.getItem('tf-theme'); } catch {}
  apply(t);
  if (btn) btn.onclick = () => { t = t === 'light' ? 'dark' : t === 'dark' ? null : 'light'; apply(t); try { t ? localStorage.setItem('tf-theme', t) : localStorage.removeItem('tf-theme'); } catch {} };
}

function init() {
  tabs = document.getElementById('tabs');
  panels = document.getElementById('panels');
  gnav = document.getElementById('gnav');
  menuBtn = document.getElementById('menu-btn');
  // Scene chips / "coming online" note sit next to (not inside) #tabs, so #tabs holds exactly one button per module.
  if (!document.getElementById('tabs-extra')) { const x = document.createElement('div'); x.id = 'tabs-extra'; x.className = 'tabs-extra'; tabs.after(x); }
  gnav.addEventListener('click', (ev) => { const b = ev.target.closest('button[data-entry]'); if (b) openEntry(b.dataset.entry); });
  document.getElementById('tabs-extra').addEventListener('click', (ev) => {
    const c = ev.target.closest('button[data-scene]');
    if (c) { const e = entries.find((x) => x.key === activeKey); if (e?.online) api.present(e.available[0], c.dataset.scene); }
  });
  if (menuBtn) menuBtn.onclick = () => { const open = menuBtn.getAttribute('aria-expanded') !== 'true'; menuBtn.setAttribute('aria-expanded', String(open)); gnav.classList.toggle('open', open); };
  const pb = document.getElementById('present-btn');
  // ▶ Present opens the simple full-screen pitch (/pitch.html, GET-only). The detailed tab tour stays in the 3-Minute Pitch tab.
  if (pb) pb.onclick = () => { closeMenu(); location.href = '/pitch.html'; };
  initTheme();

  const es = new EventSource('/api/events');
  es.onmessage = (m) => { let ev; try { ev = JSON.parse(m.data); } catch { return; } for (const fn of listeners) fn(ev); };

  new MutationObserver(() => { labelTables(panels); relabelLive(panels); }).observe(panels, { childList: true, subtree: true });
  (async () => {
    try { const h = await api.get('/api/health'); if (h.offline) { offline = true; replayBanner(); } } catch {}
    await boot();
  })();
  net(); setInterval(net, 15000);
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') init();
