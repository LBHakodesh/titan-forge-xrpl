// Titan Ghost Engine Theater — full-screen, trading-terminal-style view of the Titan Ghost engine.
// A BROWSER RECREATION of the Titan Ghost Rust TUI layout (ratatui-style panels). The authentic TUI capture is pending
// from NY-Node; when a sanitized capture is dropped into data/tui-captures/ it is replayed in the CAPTURE panel.
// Data honesty: every number carries its mode badge. LIVE_TESTNET = validated Testnet activity between our demo
// accounts (organic:false). MAINNET_OBSERVED = third-party Mainnet sample. HISTORICAL_MAINNET = Titan Ghost's own
// Mainnet accounts (read-only, only when the Commander supplies public addresses). SIMULATION = the creature scenarios:
// seeded, hypothetical fills against modeled ring depth; they never have tx hashes.
// Presentation hooks: window.TitanTheater = { playScenario(id), reset(), present(scene) } and
// window 'tf:present' CustomEvent {detail:{scene}} with scene in evidence|fills|dolphin|shark|whale|kraken.
const CSS = `
.tth { --t-bg:#070b0d; --t-panel:#0b1114; --t-ink:#c9d6cf; --t-dim:#6c7f78; --t-line:#22403a; --t-green:#3ee07f; --t-amber:#f5b83d; --t-cyan:#3fd0e0; --t-red:#ff5d57; --t-violet:#b493ff; --t-blue:#6ea8ff; }
.tth .tth-intro { display:flex; flex-wrap:wrap; gap:8px 12px; align-items:center; justify-content:space-between; margin-bottom:12px; }
.tth .tth-intro h2 { margin:0; }
.tth .tth-intro p { margin:4px 0 0; color:var(--muted); font-size:13px; }
.tth-term { background:var(--t-bg); color:var(--t-ink); font:12px/1.45 var(--mono); border:1px solid var(--t-line); border-radius:8px; padding:10px; min-width:0; overflow:hidden; color-scheme:dark; }
.tth-term:fullscreen, .tth-term.tth-focus { border-radius:0; overflow:auto; padding:12px 16px; }
.tth-term.tth-focus { position:fixed; inset:0; z-index:1000; }
.tth-term:fullscreen { width:100vw; height:100vh; }
.tth-term a { color:var(--t-cyan); }
.tth-term button { font:600 12px var(--mono); background:transparent; color:var(--t-ink); border:1px solid var(--t-line); border-radius:3px; padding:5px 10px; cursor:pointer; }
.tth-term button:hover { border-color:var(--t-green); color:var(--t-green); }
.tth-term button[aria-pressed="true"] { background:#10251b; border-color:var(--t-green); color:var(--t-green); }
.tth-term button:focus-visible { outline:2px solid var(--t-cyan); outline-offset:1px; }
.tth-term .badge { border:1px solid currentColor; background:transparent; font-size:10px; padding:0 4px; }
.tth-term .badge.live { color:var(--t-green); } .tth-term .badge.sim { color:var(--t-amber); } .tth-term .badge.replay { color:var(--t-violet); }
.tth-term .badge.mainnet { color:var(--t-blue); } .tth-term .badge.hist { color:var(--t-cyan); } .tth-term .badge.bad { color:var(--t-red); }
.tth-top { display:flex; flex-wrap:wrap; gap:4px 14px; align-items:baseline; border-bottom:1px solid var(--t-line); padding-bottom:6px; margin-bottom:6px; }
.tth-top .tth-brand { color:var(--t-green); font-weight:700; letter-spacing:.12em; }
.tth-top .tth-meta { color:var(--t-dim); }
.tth-top .tth-meta b { color:var(--t-ink); font-weight:600; }
.tth-recr { color:var(--t-amber); border:1px dashed var(--t-amber); padding:4px 8px; margin:6px 0; border-radius:3px; }
.tth-ctrl { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin:8px 0; }
.tth-ctrl .tth-sep { flex:1 1 auto; }
.tth-ctrl .tth-scn small { color:var(--t-dim); font-weight:400; margin-left:4px; }
.tth-grid { display:grid; gap:8px; grid-template-columns:repeat(12, minmax(0,1fr)); }
.tth-p { border:1px solid var(--t-line); border-radius:2px; margin:0; padding:6px 8px 8px; min-width:0; background:var(--t-panel); transition:box-shadow .3s, border-color .3s; }
.tth-p > legend { padding:0 4px; color:var(--t-cyan); font-weight:700; letter-spacing:.06em; max-width:100%; white-space:normal; }
.tth-p > legend::before { content:'┤ '; color:var(--t-line); } .tth-p > legend::after { content:' ├'; color:var(--t-line); }
.tth-p.flash { border-color:var(--t-amber); box-shadow:0 0 0 1px var(--t-amber), 0 0 18px rgba(245,184,61,.35); }
.s3 { grid-column:span 3; } .s4 { grid-column:span 4; } .s5 { grid-column:span 5; } .s6 { grid-column:span 6; } .s7 { grid-column:span 7; } .s8 { grid-column:span 8; } .s12 { grid-column:span 12; }
@media (max-width:1100px) { .tth-grid { grid-template-columns:repeat(6, minmax(0,1fr)); } .s3,.s4,.s5 { grid-column:span 3; } .s6,.s7,.s8,.s12 { grid-column:span 6; } }
@media (max-width:700px) { .tth-grid { grid-template-columns:minmax(0,1fr); } .s3,.s4,.s5,.s6,.s7,.s8,.s12 { grid-column:auto; } .tth-term { padding:6px; font-size:11.5px; } }
.tth .dim { color:var(--t-dim); } .tth .g { color:var(--t-green); } .tth .a { color:var(--t-amber); } .tth .c { color:var(--t-cyan); } .tth .r { color:var(--t-red); } .tth .v { color:var(--t-violet); }
.tth .row { display:flex; gap:8px; justify-content:space-between; align-items:baseline; min-width:0; }
.tth .row > :first-child { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tth .row > :last-child { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
.tth .sub { color:var(--t-dim); margin:6px 0 2px; border-top:1px dotted var(--t-line); padding-top:4px; display:flex; flex-wrap:wrap; gap:4px 8px; align-items:center; }
.tth .sub:first-child, .tth legend + .sub { border-top:0; margin-top:0; padding-top:0; }
.tth .note { color:var(--t-dim); font-size:11px; margin-top:4px; overflow-wrap:anywhere; }
.tth .bar { display:block; white-space:nowrap; overflow:hidden; letter-spacing:-1px; }
.tth .list { max-height:220px; overflow:auto; scrollbar-width:thin; }
.tth .ring { display:grid; grid-template-columns:minmax(64px,9ch) minmax(0,1fr) minmax(0,1fr) auto; gap:6px; align-items:center; padding:3px 4px; border-radius:2px; transition:background .4s, box-shadow .4s; }
.tth .ring .rn { font-weight:700; color:var(--t-ink); }
.tth .ring .ask { color:var(--t-red); text-align:right; direction:rtl; } .tth .ring .bid { color:var(--t-green); }
.tth .ring.hit { animation:tth-glow 1.4s ease-out; }
.tth .ring.hot .rn { color:var(--t-amber); }
@keyframes tth-glow { 0% { background:rgba(245,184,61,.45); box-shadow:0 0 22px rgba(245,184,61,.8); } 100% { background:transparent; box-shadow:none; } }
.tth .ring.refill { animation:tth-refill 1.6s ease-out; }
@keyframes tth-refill { 0% { background:rgba(63,208,224,.35); box-shadow:0 0 18px rgba(63,208,224,.7); } 100% { background:transparent; } }
.tth .rings-head { display:grid; grid-template-columns:minmax(64px,9ch) minmax(0,1fr) minmax(0,1fr) auto; gap:6px; color:var(--t-dim); padding:0 4px; }
.tth .rings-head span:nth-child(2) { text-align:right; }
.tth .tape { max-height:150px; overflow:auto; scrollbar-width:thin; }
.tth .tape div { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.tth .cap-screen { background:#000; color:#d0d0d0; padding:6px; overflow:auto; max-height:420px; margin:4px 0 0; font:11px/1.2 var(--mono); white-space:pre; }
.tth .big { font-size:18px; font-weight:700; color:var(--t-ink); font-variant-numeric:tabular-nums; }
.tth .kpis { display:grid; grid-template-columns:repeat(auto-fit, minmax(110px,1fr)); gap:6px; }
.tth .kpi { border:1px solid var(--t-line); padding:4px 6px; min-width:0; }
.tth .kpi span { display:block; color:var(--t-dim); font-size:10.5px; }
.tth .simstep { color:var(--t-amber); }
`;

const RECREATION = 'Browser recreation of the Titan Ghost TUI layout — authentic TUI capture pending from NY-Node';
const TX = 'https://testnet.xrpl.org/transactions/';
const SCENES = ['dolphin', 'shark', 'whale', 'kraken'];
const STEP_MS = 1300;

const n = (x, d = 2) => (x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const usd = (x, d = 0) => (x == null || !Number.isFinite(Number(x)) ? '—' : `$${n(x, d)}`);
const short = (h) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : '');
const bar = (f, w = 18, ch = '█', bg = '░') => { const k = Math.max(0, Math.min(w, Math.round((Number(f) || 0) * w))); return ch.repeat(k) + bg.repeat(w - k); };
const hhmmss = (iso) => { const d = iso ? new Date(iso) : new Date(); return Number.isNaN(d.getTime()) ? '--:--:--' : d.toISOString().slice(11, 19); };

// Minimal VT100/ANSI screen for replaying an authentic asciicast / frame capture (SGR colors, cursor moves, clears).
const PAL16 = ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5', '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff'];
function pal256(i) {
  if (i < 16) return PAL16[i];
  if (i >= 232) { const v = 8 + (i - 232) * 10; return `rgb(${v},${v},${v})`; }
  const k = i - 16, c = (x) => (x ? 55 + x * 40 : 0);
  return `rgb(${c(Math.floor(k / 36))},${c(Math.floor(k / 6) % 6)},${c(k % 6)})`;
}
export class VT {
  constructor(w = 120, h = 40) { this.w = Math.max(10, Math.min(400, w)); this.h = Math.max(5, Math.min(200, h)); this.reset(); }
  reset() { this.buf = Array.from({ length: this.h }, () => this.blank()); this.x = 0; this.y = 0; this.st = {}; }
  blank() { return Array.from({ length: this.w }, () => [' ', '']); }
  style() { const s = this.st; let fg = s.fg, bg = s.bg; if (s.rev) [fg, bg] = [bg || '#000', fg || '#d0d0d0']; return `${fg ? `color:${fg};` : ''}${bg ? `background:${bg};` : ''}${s.bold ? 'font-weight:700;' : ''}`; }
  scroll() { this.buf.shift(); this.buf.push(this.blank()); this.y = this.h - 1; }
  write(s) {
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\x1b') {
        const nx = s[i + 1];
        if (nx === '[') { let j = i + 2; while (j < s.length && !/[@-~]/.test(s[j])) j++; this.csi(s.slice(i + 2, j), s[j]); i = j; continue; }
        if (nx === ']') { let j = i + 2; while (j < s.length && s[j] !== '\x07' && !(s[j] === '\x1b' && s[j + 1] === '\\')) j++; i = s[j] === '\x07' ? j : j + 1; continue; }
        i++; continue;
      }
      if (c === '\r') this.x = 0;
      else if (c === '\n') { this.y++; if (this.y >= this.h) this.scroll(); }
      else if (c === '\b') this.x = Math.max(0, this.x - 1);
      else if (c >= ' ') { if (this.x >= this.w) { this.x = 0; this.y++; if (this.y >= this.h) this.scroll(); } this.buf[this.y][this.x++] = [c, this.style()]; }
    }
  }
  csi(params, f) {
    const p = params.replace(/^[?>]/, '').split(';').map((v) => parseInt(v, 10));
    const a = Number.isFinite(p[0]) ? p[0] : 0;
    const cl = () => { this.x = Math.max(0, Math.min(this.w - 1, this.x)); this.y = Math.max(0, Math.min(this.h - 1, this.y)); };
    switch (f) {
      case 'H': case 'f': this.y = (a || 1) - 1; this.x = (p[1] || 1) - 1; cl(); break;
      case 'A': this.y -= a || 1; cl(); break; case 'B': this.y += a || 1; cl(); break;
      case 'C': this.x += a || 1; cl(); break; case 'D': this.x -= a || 1; cl(); break;
      case 'G': this.x = (a || 1) - 1; cl(); break; case 'd': this.y = (a || 1) - 1; cl(); break;
      case 'J':
        if (a === 2 || a === 3) this.buf = Array.from({ length: this.h }, () => this.blank());
        else if (a === 0) { for (let x = this.x; x < this.w; x++) this.buf[this.y][x] = [' ', '']; for (let y = this.y + 1; y < this.h; y++) this.buf[y] = this.blank(); }
        break;
      case 'K': { const row = this.buf[this.y]; for (let x = a === 1 ? 0 : a === 2 ? 0 : this.x; x < (a === 1 ? this.x + 1 : this.w); x++) row[x] = [' ', '']; break; }
      case 'm': this.sgr(params === '' ? [0] : p.map((v) => (Number.isFinite(v) ? v : 0))); break;
      default: break;
    }
  }
  sgr(p) {
    for (let i = 0; i < p.length; i++) {
      const v = p[i];
      if (v === 0) this.st = {}; else if (v === 1) this.st.bold = true; else if (v === 22) this.st.bold = false;
      else if (v === 7) this.st.rev = true; else if (v === 27) this.st.rev = false;
      else if (v >= 30 && v <= 37) this.st.fg = PAL16[v - 30]; else if (v >= 90 && v <= 97) this.st.fg = PAL16[v - 82];
      else if (v >= 40 && v <= 47) this.st.bg = PAL16[v - 40]; else if (v >= 100 && v <= 107) this.st.bg = PAL16[v - 92];
      else if (v === 39) delete this.st.fg; else if (v === 49) delete this.st.bg;
      else if (v === 38 || v === 48) {
        const key = v === 38 ? 'fg' : 'bg';
        if (p[i + 1] === 5) { this.st[key] = pal256(p[i + 2] || 0); i += 2; }
        else if (p[i + 1] === 2) { this.st[key] = `rgb(${p[i + 2] || 0},${p[i + 3] || 0},${p[i + 4] || 0})`; i += 4; }
      }
    }
  }
  html(esc) {
    return this.buf.map((row) => {
      let out = '', cur = null, txt = '';
      const flush = () => { if (txt) out += cur ? `<span style="${cur}">${esc(txt)}</span>` : esc(txt); txt = ''; };
      for (const [ch, st] of row) { if (st !== cur) { flush(); cur = st; } txt += ch; }
      flush();
      return out.replace(/\s+$/, '');
    }).join('\n');
  }
}

export default {
  id: 'theater', title: 'Watch Titan Ghost', order: 5,
  async mount(el, api) {
    const { esc } = api;
    const badge = (m) => (m === 'HISTORICAL_MAINNET' ? '<span class="badge hist">HISTORICAL MAINNET</span>' : api.badge(m));
    if (!document.getElementById('tth-style')) { const s = document.createElement('style'); s.id = 'tth-style'; s.textContent = CSS; document.head.append(s); }
    el.classList.add('tth');
    el.innerHTML = `
      <div class="tth-intro"><div><h2>Watch Titan Ghost: Engine Theater</h2>
        <p>Trading-terminal view of the engine. Live panels read validated XRPL Testnet data from our demo accounts (organic:false); the creature buttons run a labeled SIMULATION.</p></div>
        <button class="ghost" type="button" id="tth-fs">⛶ Full screen</button></div>
      <div class="tth-term" id="tth-term" tabindex="-1">
        <div class="tth-top">
          <span class="tth-brand">TITAN GHOST ▸ ENGINE THEATER</span>
          <span class="tth-meta">UTC <b id="tth-clock">--:--:--</b></span>
          <span class="tth-meta">TESTNET LEDGER <b id="tth-ledger">—</b></span>
          <span class="tth-meta">ENGINE <b id="tth-engine">…</b></span>
          <span class="tth-meta" id="tth-modes"></span>
        </div>
        <div class="tth-recr" id="tth-recr">▲ ${esc(RECREATION)}. <span id="tth-capstat">Checking for an authentic capture…</span></div>
        <div class="tth-ctrl" role="toolbar" aria-label="Scenario controls">
          <span class="dim">SCENARIO ${api.badge('SIMULATION')}</span>
          <span id="tth-scn"></span>
          <button type="button" id="tth-reset">⟲ RESET</button>
          <span class="tth-sep"></span>
          <button type="button" id="tth-snd" aria-pressed="false" title="WebAudio blips, muted by default">♪ SOUND OFF</button>
          <button type="button" id="tth-fs2" title="Full screen">⛶ FULL SCREEN</button>
        </div>
        <div class="tth-grid">
          <fieldset class="tth-p s8" id="p-rings"><legend>LIQUIDITY RINGS ×6</legend><div id="b-rings"></div></fieldset>
          <fieldset class="tth-p s4" id="p-quoter"><legend>QUOTER METRICS</legend><div id="b-quoter"></div></fieldset>
          <fieldset class="tth-p s4" id="p-xrp"><legend>XRP INVENTORY</legend><div id="b-xrp"></div></fieldset>
          <fieldset class="tth-p s4" id="p-rlusd"><legend>RLUSD INVENTORY</legend><div id="b-rlusd"></div></fieldset>
          <fieldset class="tth-p s4" id="p-strat"><legend>STRATEGIC OBSERVATIONS · SHADOW-ONLY</legend><div id="b-strat"></div></fieldset>
          <fieldset class="tth-p s4" id="p-offers"><legend>RESTING OFFERS · BID / ASK</legend><div id="b-offers"></div></fieldset>
          <fieldset class="tth-p s8" id="p-fills"><legend>FILLED OFFERS</legend><div id="b-fills"></div></fieldset>
          <fieldset class="tth-p s4" id="p-fees"><legend>TRADING FEES</legend><div id="b-fees"></div></fieldset>
          <fieldset class="tth-p s4" id="p-pnl"><legend>P&amp;L ATTRIBUTION</legend><div id="b-pnl"></div></fieldset>
          <fieldset class="tth-p s4" id="p-path"><legend>PATHFINDER ROUTING</legend><div id="b-path"></div></fieldset>
          <fieldset class="tth-p s6" id="p-depth"><legend>MARKET DEPTH</legend><div id="b-depth"></div></fieldset>
          <fieldset class="tth-p s6" id="p-eff"><legend>CORRIDOR CAPITAL EFFICIENCY</legend><div id="b-eff"></div></fieldset>
          <fieldset class="tth-p s6" id="p-sent"><legend>TG SENTINEL FINDINGS</legend><div id="b-sent"></div></fieldset>
          <fieldset class="tth-p s6" id="p-hist"><legend>TITAN GHOST MAINNET HISTORY</legend><div id="b-hist"></div></fieldset>
          <fieldset class="tth-p s12" id="p-tape"><legend>EVENT TAPE</legend><div class="tape" id="b-tape" aria-live="polite"></div></fieldset>
          <fieldset class="tth-p s12" id="p-cap"><legend>AUTHENTIC TUI CAPTURE</legend><div id="b-cap"></div></fieldset>
        </div>
      </div>`;
    const $ = (id) => el.querySelector(`#${id}`);
    const term = $('tth-term');
    $('tth-modes').innerHTML = ['LIVE_TESTNET', 'MAINNET_OBSERVED', 'HISTORICAL_MAINNET', 'SIMULATION'].map(badge).join(' ');

    // ---------- state ----------
    const S = { state: null, status: null, books: {}, catches: null, findings: null, history: null, capture: null, sim: null, simStep: -1, timers: [], tape: [], playing: null, optimized: false };
    let readyResolve; const ready = new Promise((r) => { readyResolve = r; });

    // ---------- sound (muted by default; AudioContext created only on the user's toggle) ----------
    let audio = null, soundOn = false;
    const blip = (freq = 660, dur = 0.07, vol = 0.05) => {
      if (!soundOn || !audio) return;
      try { const o = audio.createOscillator(), g = audio.createGain(); o.type = 'square'; o.frequency.value = freq; g.gain.value = vol; g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur); o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + dur); } catch {}
    };
    $('tth-snd').onclick = () => {
      soundOn = !soundOn;
      if (soundOn && !audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { soundOn = false; } }
      $('tth-snd').setAttribute('aria-pressed', String(soundOn)); $('tth-snd').textContent = soundOn ? '♪ SOUND ON' : '♪ SOUND OFF';
      if (soundOn) blip(880);
    };

    // ---------- full screen (with a CSS focus-mode fallback where the API is unavailable, e.g. iPhone Safari) ----------
    const fullscreen = async () => {
      if (document.fullscreenElement) { await document.exitFullscreen().catch(() => {}); return; }
      if (term.classList.contains('tth-focus')) { term.classList.remove('tth-focus'); return; }
      if (term.requestFullscreen) { try { await term.requestFullscreen(); return; } catch {} }
      term.classList.add('tth-focus'); term.focus();
    };
    $('tth-fs').onclick = fullscreen; $('tth-fs2').onclick = fullscreen;
    term.addEventListener('keydown', (e) => { if (e.key === 'Escape' && term.classList.contains('tth-focus')) term.classList.remove('tth-focus'); });

    // ---------- tape ----------
    const tape = (mode, text) => {
      S.tape.unshift(`<div><span class="dim">${hhmmss()}</span> ${badge(mode)} ${text}</div>`);
      S.tape.length = Math.min(S.tape.length, 80);
      $('b-tape').innerHTML = S.tape.join('');
    };
    const flash = (id) => { const p = $(id); if (!p) return; p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash'); setTimeout(() => p.classList.remove('flash'), 2200); };

    // ---------- renderers ----------
    const simStepNow = () => (S.sim && S.simStep >= 0 ? S.sim.steps[Math.min(S.simStep, S.sim.steps.length - 1)] : null);

    function renderRings(hitRings = [], refill = false) {
      const st = S.state; if (!st) return;
      const step = simStepNow();
      const opt = S.optimized && S.sim?.optimization;
      let depth, mode, caption;
      if (opt) { depth = opt.rings.map((r) => ({ ring: r.ring, askUsd: r.afterUsd / 2, bidUsd: r.afterUsd / 2 })); mode = 'SIMULATION'; caption = 'after capital-optimization step (modeled)'; }
      else if (step) { depth = step.depth; mode = 'SIMULATION'; caption = `${S.sim.scenario} fill ${step.i + 1}/${S.sim.steps.length}`; }
      else if (S.sim) { depth = S.sim.initialBook.map((r) => ({ ring: r.id, askUsd: r.askUsd, bidUsd: r.bidUsd })); mode = 'SIMULATION'; caption = `${S.sim.scenario} ready`; }
      else { depth = st.efficiency.rings.map((r) => ({ ring: r.id, askUsd: r.allocUsd / 2, bidUsd: r.allocUsd / 2 })); mode = 'SIMULATION'; caption = 'modeled engine allocation (idle)'; }
      const init = S.sim ? Object.fromEntries(S.sim.initialBook.map((r) => [r.id, r])) : Object.fromEntries(st.efficiency.rings.map((r) => [r.id, { askUsd: r.allocUsd / 2, bidUsd: r.allocUsd / 2 }]));
      const max = Math.max(1, ...Object.values(init).map((r) => Math.max(r.askUsd, r.bidUsd)), ...depth.map((d) => Math.max(d.askUsd, d.bidUsd)));
      const hot = new Set(S.sim ? S.sim.steps.slice(0, S.simStep + 1).flatMap((s) => s.rings) : []);
      $('b-rings').innerHTML = `<div class="sub">${badge(mode)} <span>${esc(caption)}</span> <span class="dim">· depth per side, USD · ${esc(st.engine.label)}</span></div>
        <div class="rings-head"><span>RING</span><span>◀ ASK (XRP out)</span><span>BID (RLUSD out) ▶</span><span>SPREAD</span></div>
        ${st.rings.map((r) => { const d = depth.find((x) => x.ring === r.id) || { askUsd: 0, bidUsd: 0 }; return `<div class="ring${hitRings.includes(r.id) ? (refill ? ' refill' : ' hit') : ''}${hot.has(r.id) ? ' hot' : ''}" data-ring="${r.id}" title="${esc(r.role)}">
          <span class="rn">${esc(r.id)}</span>
          <span class="ask"><span class="bar">${bar(d.askUsd / max, 16)}</span><span class="dim">${usd(d.askUsd)}</span></span>
          <span class="bid"><span class="bar">${bar(d.bidUsd / max, 16)}</span><span class="dim">${usd(d.bidUsd)}</span></span>
          <span class="dim">${r.spreadBps}bp</span></div>`; }).join('')}
        <div class="note">Ring spreads/flows are illustrative demo parameters (public/domain.js), not authentic Titan Ghost values. Glow = a SIMULATION fill touched that ring.</div>`;
    }

    function renderQuoter() {
      const st = S.state; if (!st) return;
      const q = st.live.quoter || {};
      const books = Object.entries(S.books).filter(([, b]) => b && !b.error);
      const spreads = books.map(([code, b]) => { const ask = Math.min(...b.asks.map((a) => a.priceXrp)), bid = Math.max(...b.bids.map((a) => a.priceXrp)); const mid = (ask + bid) / 2; return { code, bps: Number.isFinite(ask) && Number.isFinite(bid) && mid ? ((ask - bid) / mid) * 10_000 : null }; });
      $('b-quoter').innerHTML = `<div class="sub">${badge('LIVE_TESTNET')} demo quoter on Testnet · organic:false</div>
        <div class="kpis"><div class="kpi"><span>maker fills</span><b class="big">${n(q.makerFills, 0)}</b></div><div class="kpi"><span>maker XRP</span><b class="big">${n(q.makerXrp, 3)}</b></div>
        <div class="kpi"><span>flow share</span><b class="big">${q.makerShare == null ? '—' : `${n(q.makerShare * 100, 1)}%`}</b></div><div class="kpi"><span>avg exec vs mid</span><b class="big">${q.avgExecBpsVsMid == null ? '—' : `${n(q.avgExecBpsVsMid, 1)}bp`}</b></div></div>
        ${spreads.map((s) => `<div class="row"><span>${esc(s.code)} quoted spread</span><span>${s.bps == null ? '<span class="dim">one-sided</span>' : `${n(s.bps, 0)} bp`}</span></div>`).join('') || '<div class="dim">No live books read yet.</div>'}
        <div class="note">${esc(q.source || '')}. Authentic Rust Quoter: ${st.engine.authentic ? 'connected' : 'not connected on this node'}.</div>`;
    }

    function renderInventory() {
      const st = S.state; if (!st) return;
      const accts = S.status?.accounts || {};
      const step = simStepNow();
      const simInv = step ? step.inventory : S.sim ? { xrp: S.sim.startInventory.xrp, rlusd: S.sim.startInventory.rlusd } : null;
      const start = S.sim?.startInventory;
      const hist = S.history?.inventory || [];
      const xrpLive = Object.entries(accts).map(([role, a]) => `<div class="row"><span>${esc(role)} <span class="dim">${esc(short(a.address))}</span></span><span>${n(a.xrp, 2)} XRP</span></div>`).join('');
      $('b-xrp').innerHTML = `<div class="sub">${badge('LIVE_TESTNET')} demo accounts</div>${xrpLive || `<div class="dim">${S.status?.error ? `Testnet status unavailable: ${esc(S.status.error)}` : 'Loading…'}</div>`}
        <div class="sub">${badge('SIMULATION')} modeled XRP/RLUSD book</div>${simInv ? `<div class="row"><span>XRP</span><span class="a">${n(simInv.xrp, 0)} XRP</span></div><span class="bar a">${bar(simInv.xrp / (start.xrp * 2), 22)}</span><div class="note">start ${n(start.xrp, 0)} · Δ ${n(simInv.xrp - start.xrp, 0)} XRP</div>` : '<div class="dim">Run a scenario to see modeled inventory move.</div>'}
        <div class="sub">${badge('HISTORICAL_MAINNET')}</div>${hist.length ? hist.map((h) => `<div class="row"><span>${esc(short(h.account))}</span><span>${h.xrp == null ? '—' : `${n(h.xrp, 2)} XRP`}</span></div>`).join('') : `<div class="dim">${esc(S.history?.status === 'awaiting' ? 'Awaiting Titan Ghost Mainnet account address (public) from Commander' : (S.history?.message || 'Not fetched.'))}</div>`}`;
      const histR = hist.flatMap((h) => h.lines.filter((l) => l.currency === 'RLUSD').map((l) => ({ ...l, account: h.account })));
      $('b-rlusd').innerHTML = `<div class="sub">${badge('LIVE_TESTNET')}</div><div class="dim">No RLUSD in the Testnet demo: demo books are TOKEN/XRP. Nothing to show rather than a made-up balance.</div>
        <div class="sub">${badge('SIMULATION')} modeled XRP/RLUSD book</div>${simInv ? `<div class="row"><span>RLUSD</span><span class="a">${n(simInv.rlusd, 0)} RLUSD</span></div><span class="bar a">${bar(simInv.rlusd / (start.rlusd * 2), 22)}</span><div class="note">start ${n(start.rlusd, 0)} · Δ ${n(simInv.rlusd - start.rlusd, 0)} RLUSD</div>` : '<div class="dim">Run a scenario to see modeled inventory move.</div>'}
        <div class="sub">${badge('HISTORICAL_MAINNET')}</div>${histR.length ? histR.map((l) => `<div class="row"><span>${esc(short(l.account))} <span class="dim">iss ${esc(short(l.issuer))}</span></span><span>${n(l.balance, 2)} RLUSD</span></div>`).join('') : `<div class="dim">${S.history?.status === 'loaded' ? 'No RLUSD trustline on the configured accounts.' : 'Awaiting public Mainnet address.'}</div>`}`;
    }

    function renderStrategic() {
      const s = S.state?.strategic; if (!s) return;
      const recs = s.recommendations || [];
      const opt = S.optimized && S.sim?.optimization;
      $('b-strat').innerHTML = `<div class="sub">${badge('SIMULATION')} <span class="a">SHADOW-ONLY · never executed</span></div>
        ${recs.length ? recs.map((r) => `<div>▸ <span class="c">${esc(r.action)}</span> ${r.fromMarket ? `${esc(r.fromMarket)} → ${esc(r.toMarket)} ${usd(r.amountUsd)}` : ''}<div class="note">${esc(r.rationale || '')}</div></div>`).join('') : '<div class="dim">No reallocation observed for the modeled inputs.</div>'}
        ${opt ? `<div class="sub">${badge('SIMULATION')} post-KRAKEN observation</div><div>▸ <span class="c">rebalance</span> ${esc(opt.rebalance.direction)} ${usd(opt.rebalance.usd)} <span class="dim">(XRP share ${n(opt.xrpShare * 100, 1)}%)</span></div><div class="note">${esc(opt.rebalance.note)}</div>` : ''}
        <div class="note">${esc(s.source)}. Inputs are modeled, not market data.</div>`;
    }

    function renderOffers() {
      const codes = Object.keys(S.books);
      const rows = codes.map((code) => {
        const b = S.books[code];
        if (!b || b.error) return `<div class="sub">${esc(code)}</div><div class="dim">${esc(b?.error || 'loading…')}</div>`;
        const asks = [...b.asks].sort((x, y) => x.priceXrp - y.priceXrp).slice(0, 3).reverse(), bids = [...b.bids].sort((x, y) => y.priceXrp - x.priceXrp).slice(0, 3);
        return `<div class="sub">${badge(b.mode || 'LIVE_TESTNET')} ${esc(code)}/XRP</div>
          ${asks.map((o) => `<div class="row"><span class="r">ASK ${n(o.qty, 2)} ${esc(code)}</span><span class="r">${n(o.priceXrp, 6)}</span></div>`).join('')}
          ${bids.map((o) => `<div class="row"><span class="g">BID ${n(o.qty, 2)} ${esc(code)}</span><span class="g">${n(o.priceXrp, 6)}</span></div>`).join('')}
          ${!asks.length && !bids.length ? '<div class="dim">book empty</div>' : ''}`;
      }).join('');
      const ho = S.history?.offers || [];
      $('b-offers').innerHTML = `<div class="list">${rows || '<div class="dim">No live demo tokens.</div>'}
        <div class="sub">${badge('HISTORICAL_MAINNET')}</div>${ho.length ? ho.slice(0, 6).map((o) => `<div class="row"><span>${esc(short(o.account))} #${o.seq}</span><span class="dim">offer</span></div>`).join('') : `<div class="dim">${S.history?.blocked?.some((b) => b.command === 'account_offers') ? 'account_offers not in the Mainnet observer allowlist (Lead decision).' : 'Awaiting public Mainnet address.'}</div>`}</div>`;
    }

    function renderFills() {
      const st = S.state; if (!st) return;
      const sim = S.sim ? S.sim.steps.slice(0, S.simStep + 1).reverse() : [];
      const live = (st.live.fills || []).slice(0, 8);
      const direct = (S.catches?.recent || []).filter((f) => f.kind === 'direct').slice(0, 4);
      const hist = (S.history?.fills || []).slice(0, 6);
      $('b-fills').innerHTML = `<div class="list">
        <div class="sub">${badge('SIMULATION')} scenario fills · hypothetical · no tx hash</div>
        ${sim.length ? sim.map((s) => `<div class="row simstep"><span>${s.emoji} ${esc(s.creature)} ${esc(s.side)} ${n(s.sizeXrp, 2)} XRP <span class="dim">${esc(s.takerAction)} · rings ${esc(s.rings.join('→') || 'none')}</span></span><span>${usd(s.filledUsd)} · ${s.impactBps ?? '—'}bp · <span class="dim">SIM · no tx</span></span></div>`).join('') : '<div class="dim">No scenario running.</div>'}
        <div class="sub">${badge('LIVE_TESTNET')} maker fills in Pathfinder payments · organic:false</div>
        ${live.length ? live.map((f) => `<div class="row"><span><span class="${f.side === 'BID' ? 'g' : 'r'}">${esc(f.side)}</span> ${esc(f.code)} ${n(f.xrp, 4)} XRP @ ${n(f.priceXrp, 7)} <span class="dim">${hhmmss(f.at)}</span></span><span><a href="${TX}${esc(f.hash)}" target="_blank" rel="noopener">${esc(short(f.hash))}</a></span></div>`).join('') : '<div class="dim">No validated maker fills recorded.</div>'}
        ${obsLine()}
        ${direct.length ? `<div class="sub">${badge('LIVE_TESTNET')} launch fills (direct)</div>${direct.map((f) => `<div class="row"><span>${esc(f.code)} ${n(f.xrp, 3)} XRP <span class="dim">${hhmmss(f.at)}</span></span><span><a href="${TX}${esc(f.hash)}" target="_blank" rel="noopener">${esc(short(f.hash))}</a></span></div>`).join('')}` : ''}
        <div class="sub">${badge('HISTORICAL_MAINNET')} Titan Ghost's own Mainnet fills</div>
        ${hist.length ? hist.map((f) => `<div class="row"><span>${esc(f.txType)} ${Object.entries(f.deltas).map(([k, v]) => `${esc(k)} ${v > 0 ? '+' : ''}${n(v, 4)}`).join(' / ')}</span><span><a href="${esc(f.explorer)}" target="_blank" rel="noopener">${esc(short(f.hash))}</a></span></div>`).join('') : `<div class="dim">${esc(histMsg())}</div>`}
      </div>`;
    }
    // Fill observation source: "Data via QuickNode" when QUICKNODE_XRPL_WSS serves Testnet, otherwise the public node.
    function obsLine() {
      const o = S.observe, src = o?.source || S.state?.observation;
      if (!src) return '';
      const re = o && Array.isArray(o.fills) && o.fills.length ? ` · re-read ${o.confirmed}/${o.fills.length} latest fills validated tesSUCCESS${o.validatedLedger ? ` at ledger ${n(o.validatedLedger, 0)}` : ''}` : o?.error ? ` · observation unavailable: ${esc(o.error)}` : '';
      return `<div class="note" data-observe-source="${esc(src.provider || '')}">${esc(src.label)}${src.host ? ` <span class="dim">(${esc(src.host)})</span>` : ''}${re}${src.quicknodeSkipped ? `<br><span class="dim">${esc(src.quicknodeSkipped)}</span>` : ''}</div>`;
    }
    const histMsg = () => (!S.history || S.history.status === 'awaiting' ? 'Awaiting Titan Ghost Mainnet account address (public) from Commander' : S.history.message || (S.history.status === 'loaded' ? 'No fills in the fetched window.' : 'Not fetched yet.'));

    function renderFees() {
      const st = S.state; if (!st) return;
      const f = st.live.fees || {};
      const t = S.sim ? S.sim.steps.slice(0, S.simStep + 1).reduce((s, x) => s + x.spreadCaptureUsd, 0) : null;
      $('b-fees').innerHTML = `<div class="sub">${badge('LIVE_TESTNET')} XRPL network fees</div>
        <div class="row"><span>all demo accounts (${n(f.txs, 0)} tx)</span><span>${n(f.networkFeesXrp, 6)} XRP</span></div>
        <div class="row"><span>maker offers</span><span>${n(f.makerFeesXrp, 6)} XRP</span></div>
        <div class="note">${esc(f.basis || '')}</div>
        <div class="sub">${badge('SIMULATION')} modeled spread capture</div>
        ${t == null ? '<div class="dim">Run a scenario.</div>' : `<div class="row"><span>${esc(S.sim.scenario)} so far</span><span class="a">${usd(t, 2)}</span></div>`}
        <div class="sub">${badge('HISTORICAL_MAINNET')}</div><div class="row"><span>fees paid</span><span>${S.history?.pnl?.feesXrp != null ? `${n(S.history.pnl.feesXrp, 6)} XRP` : '<span class="dim">not attributable</span>'}</span></div>`;
    }

    function renderPnl() {
      const st = S.state; if (!st) return;
      const p = st.live.pnl || {};
      const tot = S.sim && S.simStep >= 0 ? S.sim.steps.slice(0, S.simStep + 1).reduce((s, x) => s + x.spreadCaptureUsd, 0) : null;
      const hp = S.history?.pnl;
      $('b-pnl').innerHTML = `<div class="sub">${badge('LIVE_TESTNET')} maker edge vs recorded mid</div>
        ${p.status === 'attributable_vs_mid' ? `<div class="row"><span>spread capture</span><span class="g">${n(p.spreadCaptureXrp, 6)} XRP</span></div>
          ${Object.entries(p.byCode || {}).map(([k, v]) => `<div class="row"><span class="dim">· ${esc(k)}</span><span>${n(v, 6)}</span></div>`).join('')}
          <div class="row"><span class="dim">· BID / ASK</span><span>${n(p.bySide?.BID, 6)} / ${n(p.bySide?.ASK, 6)}</span></div>
          <div class="row"><span>net of maker fees</span><span>${n(p.netAfterMakerFeesXrp, 6)} XRP</span></div>` : '<div class="dim">not attributable</div>'}
        <div class="note">${esc(p.basis || '')}</div>
        <div class="sub">${badge('SIMULATION')}</div>${tot == null ? '<div class="dim">Run a scenario.</div>' : `<div class="row"><span>modeled spread capture</span><span class="a">${usd(tot, 2)}</span></div>`}
        <div class="sub">${badge('HISTORICAL_MAINNET')}</div><div class="dim">${hp?.status === 'flows_only' ? `${esc(hp.reason)}` : 'not attributable'}</div>
        ${hp?.status === 'flows_only' ? Object.entries(hp.netFlowsByAsset).map(([k, v]) => `<div class="row"><span>net ${esc(k)}</span><span>${n(v, 4)}</span></div>`).join('') : ''}`;
    }

    function renderPath() {
      const st = S.state; if (!st) return;
      const r = st.live.routing || {};
      const total = Object.values(r.routeMix || {}).reduce((s, x) => s + x, 0) || 1;
      const mm = st.mainnet?.routeMix || {};
      const mt = Object.values(mm).reduce((s, x) => s + x, 0) || 1;
      $('b-path').innerHTML = `<div class="sub">${badge('LIVE_TESTNET')} route mix (${n(st.live.payments, 0)} payments, ${n(r.bridgedViaXrp, 0)} bridged via XRP)</div>
        ${Object.entries(r.routeMix || {}).map(([k, v]) => `<div class="row"><span>${esc(k.replace(/_/g, ' '))}</span><span>${v}</span></div><span class="bar c">${bar(v / total, 22)}</span>`).join('')}
        <div class="list" style="max-height:120px">${(S.livePays || []).concat(r.recent || []).slice(0, 6).map((p) => `<div class="row"><span>${esc(p.from)} ${p.viaXrp ? '→ <span class="c">XRP</span> ' : ''}→ ${esc(p.to)} <span class="dim">${n(p.sizeXrp, 3)} XRP</span></span><span>${p.hash ? `<a href="${TX}${esc(p.hash)}" target="_blank" rel="noopener">${esc(short(p.hash))}</a>` : '<span class="dim">—</span>'}</span></div>`).join('')}</div>
        <div class="sub">${badge('MAINNET_OBSERVED')} third-party pathfound mix</div>
        ${Object.entries(mm).filter(([, v]) => v).map(([k, v]) => `<div class="row"><span>${esc(k.replace(/_/g, ' '))}</span><span>${v}</span></div><span class="bar v">${bar(v / mt, 22)}</span>`).join('') || '<div class="dim">no sample</div>'}`;
    }

    function renderDepth() {
      const st = S.state; if (!st) return;
      const rows = Object.entries(S.books).filter(([, b]) => b && !b.error).map(([code, b]) => ({ code, ask: b.asks.reduce((s, o) => s + o.qty * o.priceXrp, 0), bid: b.bids.reduce((s, o) => s + o.qty * o.priceXrp, 0) }));
      const max = Math.max(1e-9, ...rows.map((r) => Math.max(r.ask, r.bid)));
      const step = simStepNow();
      const mo = st.mainnet?.offerCreate;
      $('b-depth').innerHTML = `<div class="sub">${badge('LIVE_TESTNET')} resting depth, XRP value</div>
        ${rows.map((r) => `<div class="row"><span>${esc(r.code)} <span class="g">bid ${n(r.bid, 3)}</span> · <span class="r">ask ${n(r.ask, 3)}</span></span><span class="dim">XRP</span></div><span class="bar"><span class="g">${bar(r.bid / max, 11, '▓', ' ')}</span><span class="r">${bar(r.ask / max, 11, '▓', ' ')}</span></span>`).join('') || '<div class="dim">No live books.</div>'}
        <div class="sub">${badge('SIMULATION')} modeled ring depth remaining</div>
        ${S.sim ? (() => { const d = step ? step.depth : S.sim.initialBook.map((r) => ({ askUsd: r.askUsd, bidUsd: r.bidUsd })); const a = d.reduce((s, x) => s + x.askUsd, 0), b = d.reduce((s, x) => s + x.bidUsd, 0); const a0 = S.sim.initialBook.reduce((s, x) => s + x.askUsd, 0); return `<div class="row"><span>ASK side</span><span class="a">${usd(a)} / ${usd(a0)}</span></div><span class="bar a">${bar(a / (a0 || 1), 22)}</span><div class="row"><span>BID side</span><span class="a">${usd(b)}</span></div>`; })() : '<div class="dim">Run a scenario.</div>'}
        <div class="sub">${badge('MAINNET_OBSERVED')} OfferCreate in sample window</div>
        ${mo ? `<div class="row"><span>total / crossed / bridged / AMM</span><span>${n(mo.total, 0)} / ${n(mo.crossed, 0)} / ${n(mo.bridged, 0)} / ${n(mo.amm, 0)}</span></div><div class="note">${n(st.mainnet.window.ledgers, 0)} ledgers, ${n(st.mainnet.window.seconds, 0)} s, sampled ${esc(st.mainnet.sampledAt || '')}</div>` : '<div class="dim">no sample</div>'}`;
    }

    function renderEff() {
      const st = S.state; if (!st) return;
      const e = st.efficiency;
      const opt = S.optimized && S.sim?.optimization;
      $('b-eff').innerHTML = `<div class="sub">${badge('SIMULATION')} engine allocation of ${usd(e.capitalUsd)} modeled capital</div>
        <div class="kpis"><div class="kpi"><span>deployed</span><b class="big">${usd(e.deployedUsd)}</b></div><div class="kpi"><span>idle</span><b class="big">${usd(e.idleUsd)}</b></div>
        <div class="kpi"><span>yield on deployed</span><b class="big">${n(e.yieldBpsOnDeployed, 2)}bp/d</b></div><div class="kpi"><span>modeled earn</span><b class="big">${usd(e.dailyEarnUsd)}/d</b></div></div>
        ${e.rings.map((r) => `<div class="row"><span>${esc(r.id)} <span class="dim">util</span></span><span>${n(r.utilization * 100, 0)}%</span></div><span class="bar a">${bar(r.utilization, 22)}</span>`).join('')}
        ${opt ? `<div class="sub">${badge('SIMULATION')} <span class="c">capital-optimization step after KRAKEN</span></div>
          <div class="row"><span>portfolio after sweep</span><span>${usd(opt.portfolioUsd)}</span></div>
          ${opt.rings.map((r) => `<div class="row"><span>${esc(r.ring)}</span><span>${usd(r.beforeUsd)} → <span class="c">${usd(r.afterUsd)}</span></span></div>`).join('')}
          <div class="row"><span>yield on deployed</span><span class="c">${n(opt.yieldBpsOnDeployed, 2)}bp/d</span></div>
          <div class="note">Proposal only (executed:false). ${esc(opt.source)}</div>` : ''}
        <div class="note">${esc(e.source)}</div>`;
    }

    function renderSentinel() {
      const f = S.findings;
      if (!f) { $('b-sent').innerHTML = '<div class="dim">Loading findings…</div>'; return; }
      if (f.error) { $('b-sent').innerHTML = `<div class="dim">Findings unavailable: ${esc(f.error)}</div>`; return; }
      const list = f.findings || [];
      const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      const bySev = {}; for (const x of list) bySev[x.severity] = (bySev[x.severity] || 0) + 1;
      const top = [...list].sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || String(b.lastSeen).localeCompare(String(a.lastSeen))).slice(0, 7);
      const pv = (p) => (p === 'MAINNET_OBSERVED_READ_ONLY' ? 'MAINNET_OBSERVED' : p);
      $('b-sent').innerHTML = `<div class="sub">${n(list.length, 0)} findings · ${Object.entries(bySev).map(([k, v]) => `<span class="${k === 'high' || k === 'critical' ? 'r' : k === 'medium' ? 'a' : 'dim'}">${esc(k)} ${v}</span>`).join(' · ')}</div>
        <div class="list">${top.map((x) => `<div><span class="${x.severity === 'high' || x.severity === 'critical' ? 'r' : x.severity === 'medium' ? 'a' : 'dim'}">[${esc(String(x.severity).toUpperCase())}]</span> <span class="dim">${esc(x.id)}</span> ${esc(x.title)} ${['LIVE_TESTNET', 'SIMULATION', 'MAINNET_OBSERVED', 'REPLAY'].includes(pv(x.provenance)) ? badge(pv(x.provenance)) : `<span class="badge bad">${esc(x.provenance || '?')}</span>`} <span class="dim">${esc(x.verification || '')}</span></div>`).join('') || '<div class="dim">No findings.</div>'}</div>
        <div class="note">From /api/findings (TG Sentinel registry). Each finding carries its own provenance.</div>`;
    }

    function renderHist() {
      const h = S.history;
      if (!h) { $('b-hist').innerHTML = '<div class="dim">Loading…</div>'; return; }
      $('b-hist').innerHTML = `<div class="sub">${badge('HISTORICAL_MAINNET')} read-only · via lib/mainnet-observer.mjs</div>
        ${h.status === 'awaiting' ? `<div class="a">${esc(h.message)}</div><div class="note">${esc(h.howTo || '')}</div>` : `
          <div class="row"><span>accounts</span><span>${(h.accounts || []).map((a) => esc(short(a))).join(', ')}</span></div>
          <div class="row"><span>status</span><span>${esc(h.status)}${h.fetchedAt ? ` · ${esc(h.fetchedAt.slice(0, 16))}Z` : ''}</span></div>
          <div class="row"><span>fills read</span><span>${n(h.fills?.length || 0, 0)}</span></div>
          <div class="row"><span>P&amp;L</span><span>${h.pnl?.status === 'flows_only' ? 'flows only' : 'not attributable'}</span></div>
          ${h.message ? `<div class="note">${esc(h.message)}</div>` : ''}
          ${(h.blocked || []).map((b) => `<div class="note r">${esc(b.command)}: blocked by observer allowlist. ${esc(b.fix)}</div>`).join('')}`}
        ${(h.rejected || []).map((r) => `<div class="note r">Rejected ${esc(r.value)}: ${esc(r.reason)}</div>`).join('')}`;
    }

    // ---------- authentic capture replay ----------
    let capTimer = null;
    function renderCapture() {
      const c = S.capture;
      const box = $('b-cap');
      if (!c) { box.innerHTML = '<div class="dim">Checking…</div>'; return; }
      if (c.status !== 'loaded') {
        $('tth-capstat').textContent = c.status === 'error' ? `Capture error: ${c.error}` : 'No authentic capture loaded.';
        box.innerHTML = `<div class="sub">${api.badge('REPLAY')} <span>no authentic capture loaded</span></div>
          <div class="dim">${esc(c.message || c.error || '')}</div>
          <div class="note">Drop a sanitized asciicast v2 (.cast) or JSON frame list into data/tui-captures/ on the server; it replays here.</div>`;
        return;
      }
      $('tth-capstat').innerHTML = `Authentic capture loaded: <b>${esc(c.source)}</b> (replay below).`;
      box.innerHTML = `<div class="sub">${api.badge('REPLAY')} authentic Titan Ghost TUI · ${esc(c.source)} · ${esc(c.format)} · ${c.width}×${c.height} · ${n(c.frames.length, 0)} frames</div>
        <div class="tth-ctrl"><button type="button" id="cap-play">▶ REPLAY</button><button type="button" id="cap-stop">■ STOP</button><span class="dim" id="cap-pos"></span></div>
        <pre class="cap-screen" id="cap-screen" aria-label="Authentic TUI capture replay"></pre><div class="note">${esc(c.note || '')}</div>`;
      const vt = new VT(c.width, c.height);
      const scr = $('cap-screen');
      const stop = () => { clearTimeout(capTimer); capTimer = null; };
      const play = () => {
        stop(); vt.reset(); let i = 0;
        const tick = () => {
          if (i >= c.frames.length) { $('cap-pos').textContent = 'end'; return; }
          const f = c.frames[i];
          if (c.kind === 'snapshots') vt.reset();
          vt.write(f.data);
          scr.innerHTML = vt.html(esc);
          $('cap-pos').textContent = `t=${n(f.t, 1)}s · ${i + 1}/${c.frames.length}`;
          const next = c.frames[++i];
          capTimer = setTimeout(tick, next ? Math.min(1000, Math.max(16, (next.t - f.t) * 1000)) : 0);
        };
        tick();
      };
      $('cap-play').onclick = play; $('cap-stop').onclick = stop;
      play();
    }

    function renderAll() { renderRings(); renderQuoter(); renderInventory(); renderStrategic(); renderOffers(); renderFills(); renderFees(); renderPnl(); renderPath(); renderDepth(); renderEff(); renderSentinel(); renderHist(); }

    // ---------- data loading (all real endpoints) ----------
    const safe = (p) => p.catch((e) => ({ error: e.message }));
    async function loadState() {
      const st = await safe(api.get('/api/theater/state'));
      if (st.error) { $('b-rings').innerHTML = `<div class="r">Theater state unavailable: ${esc(st.error)}</div>`; return; }
      S.state = st;
      $('tth-engine').textContent = st.engine.authentic ? st.engine.label : 'temporary demo adapter (not the Rust engines)';
      if (!$('tth-scn').childElementCount) {
        $('tth-scn').innerHTML = st.scenarios.map((s) => `<button type="button" class="tth-scn" data-scn="${s.id}" aria-pressed="false" title="${esc(s.blurb)}">${s.emoji} ${s.id}<small>${n(s.minXrp, 0)}${s.id === 'KRAKEN' ? '+' : `–${n(s.maxXrp, 0)}`} XRP</small></button>`).join(' ');
        $('tth-scn').onclick = (e) => { const b = e.target.closest('button[data-scn]'); if (b) playScenario(b.dataset.scn); };
      }
    }
    async function loadStatus() { S.status = await safe(api.get('/api/status')); $('tth-ledger').textContent = S.status.validatedLedger ?? '—'; }
    async function loadBooks() {
      const codes = (S.state?.liveTokens || []).slice(0, 4);
      const res = await Promise.all(codes.map((c) => safe(api.get(`/api/book/${encodeURIComponent(c)}`))));
      S.books = Object.fromEntries(codes.map((c, i) => [c, res[i]]));
    }
    async function loadCatches() { S.catches = await safe(api.get('/api/loop/catches')); }
    async function loadFindings() { S.findings = await safe(api.get('/api/findings')); }
    async function loadHistory() { S.history = await safe(api.get('/api/theater/history')); if (S.history.error) S.history = { status: 'error', message: S.history.error }; }
    async function loadCapture() { S.capture = await safe(api.get('/api/theater/capture')); if (S.capture.error && !S.capture.status) S.capture = { status: 'error', error: S.capture.error }; renderCapture(); }

    async function loadObserve() { const o = await safe(api.get('/api/theater/observe')); S.observe = o; }
    async function refreshLive() { await loadState(); await Promise.all([loadStatus(), loadBooks(), loadCatches(), loadObserve()]); renderAll(); }

    // ---------- scenarios (SIMULATION) ----------
    const clearTimers = () => { for (const t of S.timers) clearTimeout(t); S.timers = []; };
    function reset() {
      clearTimers(); S.sim = null; S.simStep = -1; S.optimized = false; S.playing = null;
      for (const b of el.querySelectorAll('button[data-scn]')) b.setAttribute('aria-pressed', 'false');
      renderAll(); tape('SIMULATION', 'Scenario reset: modeled book restored. Live panels unaffected.');
    }
    async function playScenario(id) {
      await ready;
      const sid = String(id || '').toUpperCase();
      if (!S.state?.scenarios?.some((s) => s.id === sid)) { tape('SIMULATION', `Unknown scenario ${esc(id)}`); return null; }
      clearTimers(); S.optimized = false;
      const sim = await safe(api.get(`/api/theater/scenario/${sid}?seed=1`));
      if (sim.error) { tape('SIMULATION', `<span class="r">Scenario failed: ${esc(sim.error)}</span>`); return null; }
      S.sim = sim; S.simStep = -1; S.playing = sid;
      for (const b of el.querySelectorAll('button[data-scn]')) b.setAttribute('aria-pressed', String(b.dataset.scn === sid));
      renderAll(); flash('p-rings');
      tape('SIMULATION', `<span class="a">${sim.emoji} ${sid}</span> start · ${esc(sim.blurb)} · seed ${sim.seed} · ${sim.steps.length} hypothetical fill(s), no tx hashes`);
      sim.steps.forEach((s, k) => {
        S.timers.push(setTimeout(() => {
          S.simStep = k;
          renderRings(s.rings); renderInventory(); renderFills(); renderFees(); renderPnl(); renderDepth();
          blip(sid === 'KRAKEN' ? 110 + k * 40 : 520 + k * 90, sid === 'KRAKEN' ? 0.35 : 0.07);
          if (s.rings.length > 1) flash('p-rings');
          tape('SIMULATION', `<span class="a">${s.emoji} ${esc(s.side)} ${n(s.sizeXrp, 2)} XRP</span> ${esc(s.takerAction)} → rings ${esc(s.rings.join('→') || 'none')} · impact ${s.impactBps ?? '—'}bp · capture ${usd(s.spreadCaptureUsd, 2)}${s.unfilledUsd ? ` · <span class="r">unfilled ${usd(s.unfilledUsd)}</span>` : ''} · SIM, no tx`);
        }, 400 + k * STEP_MS));
      });
      const end = 400 + sim.steps.length * STEP_MS;
      if (sim.optimization) {
        S.timers.push(setTimeout(() => {
          S.optimized = true;
          renderRings(sim.optimization.ringsRefilled, true); renderEff(); renderStrategic(); flash('p-eff'); flash('p-strat');
          blip(990, 0.15);
          tape('SIMULATION', `<span class="c">capital-optimization step</span>: re-allocate ${usd(sim.optimization.portfolioUsd)} across rings (refill ${esc(sim.optimization.ringsRefilled.join(', ') || 'none')}); rebalance ${esc(sim.optimization.rebalance.direction)} ${usd(sim.optimization.rebalance.usd)} · proposal only`);
        }, end + 600));
      }
      S.timers.push(setTimeout(() => { tape('SIMULATION', `${sim.emoji} ${sid} done · volume ${usd(sim.totals.volumeUsd)} · rings swept ${esc(sim.totals.ringsSwept.join(', '))}`); }, end + (sim.optimization ? 900 : 100)));
      return { scenario: sid, fills: sim.steps.length, ringsSwept: sim.totals.ringsSwept };
    }

    async function present(scene) {
      const s = String(scene || '').toLowerCase();
      if (SCENES.includes(s)) return playScenario(s);
      await ready;
      if (s === 'evidence') { for (const id of ['p-quoter', 'p-path', 'p-pnl', 'p-sent']) flash(id); $('p-path').scrollIntoView?.({ behavior: 'smooth', block: 'center' }); tape('LIVE_TESTNET', 'Evidence: validated Testnet fills, routing and Sentinel findings (real ledger data, organic:false).'); return { scene: s }; }
      if (s === 'fills') { flash('p-fills'); flash('p-offers'); $('p-fills').scrollIntoView?.({ behavior: 'smooth', block: 'center' }); tape('LIVE_TESTNET', 'Fills: every row with a hash is a validated Testnet transaction; SIMULATION rows never have one.'); return { scene: s }; }
      return null;
    }

    const onPresent = (e) => { const sc = e?.detail?.scene; if (sc && (!e.detail.id || e.detail.id === 'theater')) present(sc); };
    window.addEventListener('tf:present', onPresent);
    window.TitanTheater = { playScenario, reset, present, ready: () => ready };
    $('tth-reset').onclick = reset;

    // ---------- live events (SSE) ----------
    let refreshT = null;
    const soon = () => { clearTimeout(refreshT); refreshT = setTimeout(() => refreshLive().catch(() => {}), 1500); };
    S.livePays = [];
    api.on((ev) => {
      const t = ev.type || '';
      if (t === 'pathfinder.payment') {
        const p = ev.payment || ev;
        if (p.hash) S.livePays.unshift({ from: p.from, to: p.to, sizeXrp: p.sizeXrp, viaXrp: !!(p.attribution?.bridged || p.bridged), hash: p.hash });
        S.livePays.length = Math.min(S.livePays.length, 6);
        tape(ev.mode || 'LIVE_TESTNET', `pathfinder.payment ${esc(p.from || '')} → ${esc(p.to || '')} ${p.sizeXrp != null ? `${n(p.sizeXrp, 3)} XRP` : ''} ${p.hash ? `<a href="${TX}${esc(p.hash)}" target="_blank" rel="noopener">${esc(short(p.hash))}</a>` : ''}`);
        blip(1200, 0.04); renderPath(); soon();
      } else if (t === 'launch.done') { tape(ev.mode || 'LIVE_TESTNET', `launch.done ${esc(ev.code)} fill ${ev.fillHash ? `<a href="${TX}${esc(ev.fillHash)}" target="_blank" rel="noopener">${esc(short(ev.fillHash))}</a>` : ''}`); soon(); }
      else if (t === 'loop.round') { tape(ev.mode || 'LIVE_TESTNET', `loop.round ${esc(ev.round ?? '')} ${esc(ev.phase || '')} ${esc(ev.code || '')}`); }
      else if (t === 'sentinel.finding' || t === 'findings.recorded' || t === 'findings.updated') { tape(ev.mode || 'LIVE_TESTNET', `${esc(t)} ${esc(ev.severity || '')} ${esc(ev.title || '')}`); loadFindings().then(renderSentinel); }
      else if (t === 'capital.injected' || t === 'corridor.stage_changed') { tape(ev.mode || 'SIMULATION', `${esc(t)} ${esc(ev.marketId || ev.code || '')}`); }
    });

    // ---------- boot ----------
    const clock = setInterval(() => { if (!el.isConnected) return clearInterval(clock); $('tth-clock').textContent = hhmmss(); }, 1000);
    $('tth-clock').textContent = hhmmss();
    renderCapture(); renderSentinel(); renderHist();
    await loadState();
    await Promise.all([loadStatus(), loadBooks(), loadCatches(), loadFindings(), loadHistory()]);
    renderAll(); loadCapture();
    readyResolve();
    tape('LIVE_TESTNET', `Theater online · ${n(S.state?.live?.payments, 0)} validated demo payments on record · ${esc(RECREATION)}`);
    const iv = setInterval(() => { if (!el.isConnected) return clearInterval(iv); if (!el.hidden || document.fullscreenElement === term) refreshLive().catch(() => {}); }, 20_000);
    const iv2 = setInterval(() => { if (!el.isConnected) return clearInterval(iv2); loadFindings().then(renderSentinel); loadHistory().then(() => { renderHist(); }); }, 90_000);
  },
};
