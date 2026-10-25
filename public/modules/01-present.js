// 3-Minute Pitch tab. The header ▶ Present button now opens the simple full-screen pitch (/pitch.html, public/pitch.js);
// this module keeps the original "Detailed tour": a deterministic presentation mode over the live staging tabs.
// The timeline (CUES) is pure data; the controller shows each cue's tab with api.show(id) and then dispatches
//   window.dispatchEvent(new CustomEvent('tf:present', { detail: { scene } }))
// so modules that support a scene can jump to it. Missing modules fall back (cue.fallback) or keep the current screen.
// The lower-third overlay lives on <body> so it survives tab switches. Keyboard: space pause/resume, ←/→ previous/next
// cue, Esc exit, F fullscreen, S script. Nothing here signs, submits or calls a POST endpoint.

export const DURATION = 180;
export const ERA = Object.freeze({
  pre: 'PRE-HACKATHON',
  new: 'NEW · OCT 24–25',
  mixed: 'PRE-HACKATHON ENGINE · NEW VIEW',
});

// start/end in seconds. modes: honest data labels for what is on screen (PROPOSED = a draft, not data).
export const CUES = Object.freeze([
  { start: 0, end: 30, show: 'theater', fallback: ['view'], scene: 'evidence', era: 'mixed', modes: ['HISTORICAL_MAINNET', 'LIVE_TESTNET'],
    title: 'Titan Ghost engine v11: the evidence',
    caption: 'Titan Ghost engine v11 was built before the hackathon. Terminal = browser recreation of its TUI. Its own Mainnet record shows as HISTORICAL MAINNET (read-only) once its public address is loaded. Fills and routing: validated XRPL Testnet.',
    say: 'This is Titan Ghost, the market-making engine behind GYW1313. Engine version 11 was built before this hackathon. The terminal is a browser recreation of the engine\'s own TUI layout, built this weekend. Titan Ghost\'s own Mainnet record appears read-only, labeled HISTORICAL MAINNET, whenever its public address is loaded. The fills, routing and Sentinel findings beside it are validated XRPL Testnet transactions between our demo accounts, labeled LIVE TESTNET. The live engine is not connected to this staging node.' },
  { start: 30, end: 36, show: 'theater', fallback: ['view'], scene: 'fills', era: 'mixed', modes: ['LIVE_TESTNET', 'HISTORICAL_MAINNET'],
    title: 'Real fills',
    caption: 'Real fills: every row with a hash is a validated ledger transaction. SIMULATION rows never carry a hash.',
    say: 'These fills are real: every row with a transaction hash is validated on the ledger. Simulated rows never carry one.' },
  { start: 36, end: 42, show: 'theater', fallback: ['view'], scene: 'dolphin', era: 'new', modes: ['SIMULATION'],
    title: 'Dolphin',
    caption: 'Dolphin: a small taker. Size-ladder scenario in the new theater (SIMULATION).',
    say: 'Now scale it up. The theater, new this weekend, sizes flow on a creature ladder. A Dolphin is a small taker.' },
  { start: 42, end: 48, show: 'theater', fallback: ['view'], scene: 'shark', era: 'new', modes: ['SIMULATION'],
    title: 'Shark',
    caption: 'Shark: mid-size flow testing the book (SIMULATION).',
    say: 'A Shark is mid-size flow testing the book.' },
  { start: 48, end: 54, show: 'theater', fallback: ['view'], scene: 'whale', era: 'new', modes: ['SIMULATION'],
    title: 'Whale',
    caption: 'Whale: large flow the six liquidity rings must absorb (SIMULATION).',
    say: 'A Whale is large flow the six liquidity rings have to absorb.' },
  { start: 54, end: 60, show: 'theater', fallback: ['view'], scene: 'kraken', era: 'new', modes: ['SIMULATION'],
    title: 'Kraken',
    caption: 'Kraken: book-moving size. Dolphin to Kraken are SIMULATION scenarios against modeled ring depth; only hashed fills are real.',
    say: 'And a Kraken moves the book. These four are SIMULATION scenarios. Only the fills before them were real.' },
  { start: 60, end: 80, show: 'xdlc-app', fallback: ['observatory'], scene: 'radar', era: 'new', modes: ['SIMULATION', 'MAINNET_OBSERVED'],
    title: 'TG Intelligence finds thin liquidity',
    caption: 'TG Intelligence radar (new, demo adapter) ranks thin markets from read-only Mainnet observations. Scores are SIMULATION; it never trades on Mainnet.',
    say: 'Where should liquidity go? The TG Intelligence opportunity radar, new this weekend, ranks thin markets from read-only Mainnet observations: wide spreads, shallow depth, and the modeled benefit after costs. The scoring is a labeled demo adapter, so its output is SIMULATION. It reads Mainnet and never trades there.' },
  { start: 80, end: 95, show: 'incubator', fallback: ['capital'], scene: 'tglb', era: 'new', modes: ['SIMULATION'],
    title: 'TGLB three-tier funding',
    caption: 'TGLB Lending & Borrowing studio (new): Tier 1 flexible, Tier 2 term-committed, Tier 3 underwritten lending vault. All capital SIMULATION.',
    say: 'Once a project qualifies, TGLB, Titan Ghost Liquidity Bootstrap, coordinates three funding tiers: flexible participation, term-committed liquidity, and a separate underwritten lending vault. The lending studio is new this weekend, and every dollar here is SIMULATION.' },
  { start: 95, end: 130, show: 'xdlc-app', fallback: ['corridor'], scene: 'lifecycle', era: 'new', modes: ['SIMULATION'],
    title: 'XDLC application lifecycle',
    caption: 'XDLC application (new): corridor stages as Titan Ghost application logic. Each advance is a SIMULATION record with human approval. XDLC is not native to XRPL today.',
    say: 'This is the XDLC application, built this weekend. A corridor moves through its lifecycle stage by stage, and every advance is Titan Ghost application logic: an operator SIMULATION record with a human approval, never a signed transaction. XRP auto-bridging is the existing XRPL feature. XDLC itself is not native to XRPL today.' },
  { start: 130, end: 145, show: 'sentinel', fallback: ['findings'], scene: 'sentinel', era: 'new', modes: ['LIVE_TESTNET', 'MAINNET_OBSERVED', 'SIMULATION'],
    title: 'TG Sentinel flags risk',
    caption: 'TG Sentinel: concentration, demo-generated fills and corridor risk, each finding labeled with its provenance. Expanded coverage is new.',
    say: 'TG Sentinel watches the whole loop. It flags concentration, demo-generated fills and corridor risk, and labels each finding with its provenance, so a simulated finding never looks live. The expanded coverage is new this weekend.' },
  { start: 145, end: 160, show: 'redeploy', fallback: ['capital'], scene: 'redeploy', era: 'new', modes: ['SIMULATION'],
    title: 'Watch capital move',
    caption: 'Risk rises, capital moves: modeled redeployment of proprietary capital to a radar-picked market. SIMULATION; it stops at the human approval step.',
    say: 'When risk rises, capital moves. This redeployment is modeled, SIMULATION: only authorized proprietary capital moves, participant Tier 1 and 2 and Tier 3 loan proceeds stay locked, and it stops at the human approval step.' },
  { start: 160, end: 170, show: 'xdlc-protocol', fallback: [], scene: 'protocol', era: 'new', modes: ['PROPOSED'],
    title: 'XDLC: proposed open XRPL amendment',
    caption: 'XDLC proposed amendment draft: not submitted, not reviewed, not implemented in xrpld, not activated.',
    say: 'Where does this go next? We drafted XDLC as a proposed open XRPL amendment, so any market maker could run corridors natively. It is a draft: not submitted, not reviewed, not implemented in xrpld, and not activated.' },
  { start: 170, end: 176, show: 'vendors', fallback: ['merchant', 'x402'], scene: 'vendors', era: 'new', modes: ['SIMULATION'],
    title: 'Ecosystem and vendors',
    caption: 'Vendor adapters and TG Merchant agentic finance (new). SIMULATION unless a screen says otherwise.',
    say: 'Vendor adapters and TG Merchant connect agentic payments to the ecosystem.' },
  { start: 176, end: 180, show: 'products', fallback: [], scene: 'products', era: 'pre', modes: [],
    title: 'One GYW1313 ecosystem',
    caption: 'Sixteen established products plus TGAN: one GYW1313 ecosystem. Each product\'s real operational status is on this page.',
    say: 'Sixteen established products plus TGAN, one GYW1313 ecosystem. Thank you.' },
]);

export function fmt(t) { const s = Math.max(0, Math.floor(t)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }

// Index of the cue playing at time t (seconds). t >= DURATION -> last cue.
export function cueIndexAt(t, cues = CUES) {
  if (!(t > 0)) return 0;
  for (let i = 0; i < cues.length; i++) if (t < cues[i].end) return i;
  return cues.length - 1;
}
export function nextStart(t, cues = CUES) { const i = cueIndexAt(t, cues); return i + 1 < cues.length ? cues[i + 1].start : DURATION; }
// "Previous": restart the current cue if more than 2 s into it, else go to the cue before.
export function prevStart(t, cues = CUES) { const i = cueIndexAt(t, cues); return (t - cues[i].start > 2 || i === 0) ? cues[i].start : cues[i - 1].start; }
// First of [show, ...fallback] that is loaded; null if none.
export function resolveTarget(cue, has) { for (const id of [cue.show, ...(cue.fallback || [])]) if (has(id)) return id; return null; }
// Sequence of cue indices crossed when playing from a to b (deterministic, used by tests and the controller).
export function crossed(a, b, cues = CUES) { const out = []; for (let i = cueIndexAt(a, cues); i <= cueIndexAt(b, cues); i++) out.push(i); return out; }
export function validate(cues = CUES) {
  const errs = [];
  if (cues[0]?.start !== 0) errs.push('first cue must start at 0');
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (!(c.end > c.start)) errs.push(`cue ${i} empty`);
    if (i && cues[i - 1].end !== c.start) errs.push(`gap/overlap before cue ${i}`);
    if (!c.show || !c.scene || !c.caption || !c.say || !ERA[c.era]) errs.push(`cue ${i} incomplete`);
  }
  if (cues.at(-1)?.end !== DURATION) errs.push(`last cue must end at ${DURATION}`);
  return errs;
}

const STYLE = `
.tfp-ov { position: fixed; left: 16px; right: 16px; bottom: 16px; z-index: 2000; max-width: 1100px; margin: 0 auto; background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.25); padding: 12px 14px; }
.tfp-ov .tfp-row { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
.tfp-ov .tfp-time { font: 700 20px var(--mono); font-variant-numeric: tabular-nums; }
.tfp-ov .tfp-title { font-weight: 700; flex: 1 1 200px; min-width: 0; }
.tfp-ov .tfp-era { font: 700 11px var(--mono); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--gold); color: var(--gold); white-space: nowrap; }
.tfp-ov .tfp-era.new { border-color: var(--accent); color: var(--accent); }
.tfp-ov .tfp-cap { font-size: 18px; line-height: 1.4; margin: 8px 0; overflow-wrap: anywhere; }
.tfp-ov .tfp-bar { height: 4px; background: var(--line); border-radius: 2px; overflow: hidden; margin: 6px 0 8px; }
.tfp-ov .tfp-bar > i { display: block; height: 100%; background: var(--accent); width: 0; }
.tfp-ov .tfp-ctl button { background: none; border: 1px solid var(--line); color: var(--ink); border-radius: 6px; padding: 5px 10px; font: inherit; font-size: 13px; cursor: pointer; }
.tfp-ov .tfp-ctl .tfp-x { margin-left: auto; }
.tfp-ov .tfp-miss { color: var(--muted); font-size: 12px; font-style: italic; }
.tfp-script { position: fixed; top: 16px; right: 16px; z-index: 2001; width: min(440px, calc(100vw - 32px)); max-height: calc(100vh - 260px); overflow: auto; background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
.tfp-script ol { margin: 0; padding-left: 0; list-style: none; }
.tfp-script li { padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; overflow-wrap: anywhere; }
.tfp-script li.on { background: var(--bg); outline: 1px solid var(--accent); }
.tfp-script li b { font-family: var(--mono); font-size: 12px; margin-right: 6px; }
html.tf-presenting main { padding-bottom: 240px; }
.tfp .tfp-big { font-size: 16px; }
.tfp ol.tfp-say { padding-left: 18px; } .tfp ol.tfp-say li { margin: 6px 0; overflow-wrap: anywhere; }
@media (max-width: 600px) {
  .tfp-ov { padding: 10px; bottom: 8px; } .tfp-ov .tfp-cap { font-size: 15px; } .tfp-ov .tfp-time { font-size: 16px; }
  .tfp-script { max-height: 45vh; }
}
`;

let api = null;
const ctl = { running: false, paused: false, base: 0, startedAt: 0, idx: -1, timer: null, ov: null, script: null };
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
const elapsed = () => Math.min(DURATION, ctl.paused || !ctl.running ? ctl.base : ctl.base + (now() - ctl.startedAt));
const has = (id) => !!api?.has?.(id);

function apply(i) {
  const c = CUES[i];
  const target = resolveTarget(c, has);
  if (target) {
    api.show(target);
    window.dispatchEvent(new CustomEvent('tf:present', { detail: { scene: c.scene, id: target } }));
  }
  render(target);
}

function seek(t) {
  ctl.base = Math.max(0, Math.min(DURATION, t)); ctl.startedAt = now();
  ctl.idx = -1; tick();
}

function tick() {
  if (!ctl.running) return;
  const t = elapsed();
  const i = cueIndexAt(t);
  if (i !== ctl.idx) { ctl.idx = i; apply(i); }
  if (t >= DURATION && !ctl.paused) { ctl.base = DURATION; ctl.paused = true; }
  update(t);
}

function update(t) {
  if (!ctl.ov) return;
  const q = (s) => ctl.ov.querySelector(s);
  q('.tfp-time').textContent = `${fmt(t)} / ${fmt(DURATION)}`;
  q('.tfp-bar > i').style.width = `${(100 * t / DURATION).toFixed(2)}%`;
  q('[data-a="pause"]').textContent = t >= DURATION ? '↺ Restart' : ctl.paused ? '▶ Resume' : '❚❚ Pause';
}

function render(target) {
  if (!ctl.ov) return;
  const c = CUES[ctl.idx];
  const e = api.esc;
  ctl.ov.querySelector('.tfp-head').innerHTML = `<span class="tfp-time"></span><span class="tfp-title">${e(fmt(c.start))}–${e(fmt(c.end))} · ${e(c.title)}</span>
    <span class="tfp-era ${c.era === 'new' ? 'new' : ''}">${e(ERA[c.era])}</span>${c.modes.map((m) => api.badge(m)).join(' ')}`;
  ctl.ov.querySelector('.tfp-cap').textContent = c.caption;
  ctl.ov.querySelector('.tfp-miss').textContent = target ? (target !== c.show ? `Showing ${target}: the ${c.show} tab is not on this node yet.` : '') : `The ${c.show} screen is coming online; narration continues.`;
  if (ctl.script) for (const li of ctl.script.querySelectorAll('li')) li.classList.toggle('on', Number(li.dataset.i) === ctl.idx);
  update(elapsed());
}

function buildOverlay() {
  if (!document.getElementById('tfp-style')) { const s = document.createElement('style'); s.id = 'tfp-style'; s.textContent = STYLE; document.head.append(s); }
  const ov = document.createElement('div');
  ov.className = 'tfp-ov'; ov.id = 'tfp-overlay'; ov.setAttribute('role', 'region'); ov.setAttribute('aria-label', '3-minute pitch captions');
  ov.innerHTML = `<div class="tfp-row tfp-head"></div><div class="tfp-bar"><i></i></div><div class="tfp-cap" aria-live="polite"></div><div class="tfp-miss"></div>
    <div class="tfp-row tfp-ctl"><button type="button" data-a="prev" title="Previous (←)">⏮ Prev</button><button type="button" data-a="pause" title="Pause / resume (space)">❚❚ Pause</button>
    <button type="button" data-a="next" title="Skip (→)">⏭ Skip</button><button type="button" data-a="restart" title="Restart">↺ Restart</button>
    <button type="button" data-a="fs" title="Fullscreen (F)">⛶ Fullscreen</button><button type="button" data-a="script" title="Script (S)">☰ Script</button>
    <button type="button" class="tfp-x" data-a="exit" title="Exit (Esc)">✕ Exit</button></div>`;
  ov.addEventListener('click', (ev) => { const b = ev.target.closest('button[data-a]'); if (b) action(b.dataset.a); });
  document.body.append(ov);
  ctl.ov = ov;
}

function scriptHtml(e) {
  return `<ol>${CUES.map((c, i) => `<li data-i="${i}"><b>${e(fmt(c.start))}</b><strong>${e(c.title)}</strong> <span class="muted">[${e(ERA[c.era])}${c.modes.length ? ' · ' + e(c.modes.join(', ')) : ''}]</span><br>${e(c.say)}</li>`).join('')}</ol>`;
}

function toggleScript() {
  if (ctl.script) { ctl.script.remove(); ctl.script = null; return; }
  const s = document.createElement('div'); s.className = 'tfp-script'; s.id = 'tfp-script';
  s.innerHTML = `<h3>Presenter script</h3>${scriptHtml(api.esc)}`;
  s.addEventListener('click', (ev) => { const li = ev.target.closest('li[data-i]'); if (li) seek(CUES[Number(li.dataset.i)].start); });
  document.body.append(s); ctl.script = s; render(resolveTarget(CUES[Math.max(0, ctl.idx)], has));
}

function action(a) {
  const t = elapsed();
  if (a === 'pause') { if (t >= DURATION) return seekRestart(); if (ctl.paused) { ctl.paused = false; ctl.startedAt = now(); } else { ctl.base = t; ctl.paused = true; } update(elapsed()); }
  else if (a === 'next') seek(nextStart(t));
  else if (a === 'prev') seek(prevStart(t));
  else if (a === 'restart') seekRestart();
  else if (a === 'fs') { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); } catch {} }
  else if (a === 'script') toggleScript();
  else if (a === 'exit') stop();
}
function seekRestart() { ctl.paused = false; seek(0); }

function onKey(ev) {
  if (!ctl.running || ev.altKey || ev.ctrlKey || ev.metaKey) return;
  if (ev.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  const map = { ' ': 'pause', ArrowRight: 'next', ArrowLeft: 'prev', Escape: 'exit', f: 'fs', F: 'fs', s: 'script', S: 'script' };
  const a = map[ev.key];
  if (!a) return;
  ev.preventDefault(); action(a);
}

export function start() {
  if (!api) return;
  if (!ctl.ov) buildOverlay();
  ctl.running = true; ctl.paused = false;
  document.documentElement.classList.add('tf-presenting');
  if (!ctl.timer) ctl.timer = setInterval(tick, 200);
  seek(0);
}
export function stop() {
  ctl.running = false; clearInterval(ctl.timer); ctl.timer = null;
  ctl.ov?.remove(); ctl.ov = null; ctl.script?.remove(); ctl.script = null;
  document.documentElement.classList.remove('tf-presenting');
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch {}
}

export default {
  id: 'present', title: '▶ 3-Minute Pitch', order: 1,
  async mount(el, a) {
    api = a;
    const e = api.esc;
    if (!document.getElementById('tfp-style')) { const s = document.createElement('style'); s.id = 'tfp-style'; s.textContent = STYLE; document.head.append(s); }
    el.classList.add('tfp');
    window.tfPresent = { start, stop };
    document.addEventListener('keydown', onKey);
    el.innerHTML = `
      <div class="card">
        <h2>3-minute pitch</h2>
        <p class="tfp-big"><a class="primary" href="/pitch.html" style="display:inline-block;padding:8px 14px;border-radius:8px;text-decoration:none">▶ Open the simple pitch</a> Full-screen, one idea per scene, voice narration, presenter slot. This is what the header <b>▶ Present</b> button opens.</p>
        <h3>Detailed tour</h3>
        <p class="tfp-big">The original timed walk through the live staging tabs with captions. <b>Space</b> pause/resume · <b>←/→</b> previous/next · <b>Esc</b> exit · <b>F</b> fullscreen · <b>S</b> script. Deep link: <span class="mono">/#present/start</span>.</p>
        <p><button type="button" class="ghost" data-a="start">▶ Start detailed tour</button> <button type="button" class="ghost" data-a="goscript">☰ Read the script</button></p>
        <p class="muted"><span class="badge hist">HISTORICAL MAINNET</span> recorded past Mainnet activity · <span class="badge mainnet">MAINNET OBSERVED</span> read-only · <span class="badge live">LIVE TESTNET</span> validated Testnet · <span class="badge sim">SIMULATION</span> modeled · <span class="badge prop">PROPOSED</span> draft, not live. <b>${e(ERA.pre)}</b>: Titan Ghost engine v11 and the existing products. <b>${e(ERA.new)}</b>: XDLC app and spec, TG Intelligence radar, TGLB lending studio, Sentinel coverage, vendor adapters, theater.</p>
      </div>
      <div class="card"><h2>Timeline</h2><div id="tfp-tl"></div></div>
      <div class="card"><h2>Script</h2><div id="tfp-say"></div></div>`;
    const renderTl = () => {
      el.querySelector('#tfp-tl').innerHTML = `<table><thead><tr><th>Time</th><th>Scene</th><th>Tab</th><th>Labels</th><th>Era</th></tr></thead><tbody>${CUES.map((c) => {
        const t = resolveTarget(c, has);
        return `<tr><td class="mono">${fmt(c.start)}–${fmt(c.end)}</td><td>${e(c.title)} <span class="mono muted">${e(c.scene)}</span></td><td>${t ? `<span class="mono">${e(t)}</span>${t !== c.show ? ` <span class="muted">(fallback for ${e(c.show)})</span>` : ''}` : `<span class="muted">${e(c.show)}: coming online</span>`}</td><td>${c.modes.map((m) => api.badge(m)).join(' ') || '<span class="muted">—</span>'}</td><td>${e(ERA[c.era])}</td></tr>`;
      }).join('')}</tbody></table>`;
    };
    renderTl();
    window.addEventListener('tf:ready', renderTl);
    el.querySelector('#tfp-say').innerHTML = `<ol class="tfp-say">${CUES.map((c) => `<li><b class="mono">${fmt(c.start)}</b> ${e(c.say)}</li>`).join('')}</ol>`;
    el.addEventListener('click', (ev) => { const b = ev.target.closest('button[data-a]'); if (!b) return; if (b.dataset.a === 'start') start(); else if (b.dataset.a === 'goscript') el.querySelector('#tfp-say')?.scrollIntoView({ behavior: 'smooth' }); });
    if ((location.hash || '').startsWith('#present/start')) window.addEventListener('tf:ready', () => start(), { once: true });
  },
};
