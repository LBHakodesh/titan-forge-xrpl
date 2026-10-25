// Titan Forge: simple 3-minute pitch (public/pitch.html) for the Why Not? track: Titan Ghost.
// Story: Titan Ghost (existing engine) plus three capabilities built INTO it this weekend: lending (TGLB, supported by the
// separate TGLW platform), agentic payments (TG Merchant, x402) and XDLC. The other 12 products appear only as
// "coming to market". One idea per scene: headline, one big illustration, one small honest badge, at most one live number.
// Timeline: 135 s of narrated beats (S1–S7, then the website end card) around the Commander's live slot (default 45 s,
// ?talk=N). Default total 180 s; with ?talk=N the narrated part keeps its length and the total becomes 135 + N.
// Read-only: the only network calls are the GETs in ENDPOINTS plus local audio/images. Nothing signs, submits or POSTs.
// If a GET fails the scene still plays with no number (a number is never invented).
// Keys: Space start/pause · ←/→ previous/next · M mute · F fullscreen · N presenter notes · Esc back to the app.
// Deep link: /pitch.html?scene=4&autostart=1&pause=1&mute=1&talk=60&siteLive=1 (scene is 1-based; at=seconds into it).

// The presenter: edit name and dissertation here (one place). Rendered on the 'presenter' credential scene.
export const PRESENTER = Object.freeze({
  name: 'Commander, GYW1313',
  military: Object.freeze(['Enlisted Infantry', 'Commissioned Infantry Officer', 'Branch-transferred to the Signal Corps']),
  certification: 'CISSP',
  education: Object.freeze(['MS, Cybersecurity', 'BS, Information Systems Management', 'PhD candidate, Financial Cybersecurity (expected end of 2027)']),
  dissertation: 'How to mitigate the threat of the rise of attacks across blockchain transactions related to the maturation of emerging technologies and their nefarious deployment',
});

// Playback modes. Default = presenter-narrated: voice muted (M toggles it on), no auto-advance: each scene holds on its
// final frame until → or Space. ?voice=1 starts unmuted; ?auto=1 restores the timed 180 s auto-advance with voice.
export function playbackMode(q) {
  const get = (k) => (q && typeof q.get === 'function' ? q.get(k) : null);
  const auto = get('auto') === '1';
  const muted = get('mute') === '1' ? true : !(auto || get('voice') === '1');
  return { auto, muted };
}
// Manual mode: once playback reaches the current scene's end it holds just before it (final frame, timer paused).
export const HOLD_EPS = 0.01;
export const holdPoint = (t, scene, auto) => (!auto && scene && t >= scene.end - HOLD_EPS ? scene.end - HOLD_EPS : null);

export const DURATION = 180;
export const ERA = Object.freeze({ pre: 'PRE-HACKATHON', new: 'NEW THIS WEEKEND' });
export const MODE_TEXT = Object.freeze({
  LIVE_TESTNET: 'LIVE TESTNET', MAINNET_OBSERVED: 'MAINNET OBSERVED', SIMULATION: 'SIMULATION', PROPOSED: 'PROPOSED',
  MIXED: 'MIXED · LABELED PER ITEM', ILLUSTRATIVE: 'ILLUSTRATIVE',
});
// GET only. Keys are what scenes read from the `data` object.
export const ENDPOINTS = Object.freeze({
  theater: '/api/theater/state',
  vendors: '/api/vendors',
});
export const HERO_IMG = '/gyw1313-hero.png';
export const SITE_PREVIEW = '/site/titan-ghost/preview-1440.png'; // produced by the website build; falls back to HERO_IMG
export const SITE_URL = 'gyw1313.com/titan-ghost';
export const SITE_LIVE_DEFAULT = false; // the Commander deploys the site himself: never claim "Live at" unless ?siteLive=1
export const siteTag = (live) => (live === true ? 'Live at' : 'Launching at');
export const siteLiveFrom = (v) => v === '1' || v === 'true';
// Mainnet sample (read-only observer), quoted on the problem scene as MAINNET OBSERVED · sample.
export const STAT = Object.freeze({ failed: 133, succeeded: 79, top5Share: 97 });

// Scene definitions. dur = fixed seconds for each narrated beat (they sum to NARRATED = 135 s); the 'talk' scene is the
// Commander's live slot (no narration audio), DEFAULT_TALK = 40 s, overridden by ?talk=N.
// say = narration (notes drawer + pre-rendered audio, scripts/render-pitch-audio.mjs); for the talk slot it holds the
// presenter's talking points instead. module = which Titan Ghost module (1–3) this scene lights up.
export const DEFAULT_TALK = 40;
export const MAX_TALK = 600;
export const SCENE_DEFS = Object.freeze([
  { id: 'open', dur: 13, lead: 2.5, art: 'open', modes: ['ILLUSTRATIVE'], badge: 'WHY NOT? TRACK',
    headline: 'Why should any XRPL market lack liquidity?',
    sub: '',
    say: 'This is Titan Ghost, from GYW1313. Our answer to the Why Not track: why should any XRP Ledger market go without liquidity?' },
  { id: 'presenter', dur: 12, silent: true, art: 'presenter', modes: ['ILLUSTRATIVE'], badge: 'PRESENTER',
    headline: 'Built by a security-first operator.',
    sub: '',
    say: '(No audio.) Introduce yourself: infantry to Signal Corps, CISSP, MS Cybersecurity, PhD candidate in financial cybersecurity. Then the problem.' },
  { id: 'problem', dur: 15, art: 'problem', modes: ['MAINNET_OBSERVED'], badge: 'MAINNET OBSERVED · SAMPLE',
    headline: 'Thin markets lose trades.',
    sub: '',
    say: 'Thin markets lose trades. In our Mainnet sample, more cross-currency payments failed than succeeded, and a handful of providers supplied almost all the liquidity.' },
  { id: 'engine', dur: 17, art: 'engine', era: 'pre', modes: ['ILLUSTRATIVE'], badge: 'PRE-HACKATHON ENGINE',
    headline: 'Titan Ghost: six rings of liquidity.',
    sub: '',
    say: 'Titan Ghost is our existing market-making engine. It places liquidity in six rings: tight inner rings for everyday payments, and deep reserves behind them. The XRP Ledger routes payments through it.' },
  { id: 'proof', dur: 8, art: 'proof', modes: ['LIVE_TESTNET'], badge: 'LIVE TESTNET · DEMO ACCOUNTS',
    headline: 'Real payments already fill our offers.',
    sub: '',
    say: 'On Testnet, real payments have already filled our offers, bridged through XRP.' },
  { id: 'lending', dur: 22, art: 'lending', module: 1, era: 'new', modes: ['SIMULATION'], badge: 'NEW · SIMULATION',
    headline: 'Built into Titan Ghost: lending.',
    sub: 'Two platforms: TGLW supports TGLB.',
    say: "This weekend we built three capabilities into Titan Ghost. First, lending. TGLB funds new markets in three tiers, and TGLW, our self-custody liquidity platform, supplies tiers one and two straight from participants' own wallets." },
  { id: 'agentic', dur: 18, art: 'agentic', module: 2, era: 'new', modes: ['LIVE_TESTNET'], badge: 'NEW · LIVE TESTNET x402 RAIL · APPROVAL REQUIRED',
    headline: 'Built into Titan Ghost: agentic payments.',
    sub: '',
    say: "Second, agentic payments. Through TG Merchant, AI agents buy Titan Ghost market data over x402 on the XRP Ledger, and every payment needs a person's approval." },
  { id: 'xdlc', dur: 20, art: 'xdlc', module: 3, era: 'new', modes: ['SIMULATION', 'PROPOSED'], badge: 'NEW · SIMULATION + PROPOSED',
    headline: 'XDLC: a neutral corridor that beats the AMM.',
    sub: 'Proposed open XRPL amendment · draft · simulated today',
    say: "Third, XDLC: a neutral protocol. Its corridor quotes a better price than the XRP Ledger's AMM at every depth, and anyone can provide liquidity: Titan Ghost, TGLW participants, or other firms. We propose it as an open amendment, a draft not yet submitted." },
  { id: 'talk', talk: true, art: 'showcase', modes: ['ILLUSTRATIVE'], badge: 'COMING TO MARKET · PRESENTER SPEAKS',
    headline: 'More from GYW1313 · coming to market',
    sub: '',
    say: 'Live, about 40 s. Titan Ghost is one of 17 GYW1313 products; five are featured today. Coming to market: '
      + 'Intelligence and protection: TG Intelligence guides where capital goes, TG Sentinel watches risk, TG Guardian holds the spending limits. '
      + 'Authority, advice and assets: TG Authority, the TG Advisory Network, and TG Tokenization for asset setup. '
      + 'Visualize and play: TG View shows the market live, TG Arena teaches it as a game, TG Play Analysis reviews the play. '
      + 'Build and grow: the TG Developer Platform, TG SEO Intelligence, and 1313VERSE, our community world. '
      + 'Then hand over to the website.' },
  { id: 'site', dur: 15, lead: 1, art: 'site', modes: ['MIXED'], badge: 'STATUS PER VENDOR',
    headline: 'XDLC: Liquidity for every market.',
    sub: '',
    say: 'XDLC: liquidity for every market. Titan Ghost, from GYW1313. Learn more at G Y W thirteen thirteen dot com.' },
]);
// lead = seconds of visuals before the voice starts (default 0.5 s; the open lets the wordmark land first).
export const DEFAULT_LEAD = 0.5;
export const leadOf = (d) => (typeof d.lead === 'number' ? d.lead : DEFAULT_LEAD);
export const NARRATED = SCENE_DEFS.filter((d) => !d.talk).reduce((a, d) => a + d.dur, 0);
// The three modules built into Titan Ghost this weekend (lit one per scene, S5–S7, and they stay lit).
export const MODULES = Object.freeze(['Lending', 'Agentic payments', 'XDLC']);
// The five products featured today, and the 12 shown only as "coming to market" (4 groups of 3, highlighted in turn).
export const FEATURED = Object.freeze(['Titan Ghost', 'TGLB', 'TGLW', 'TG Merchant', 'XDLC']);
export const SHOWCASE = Object.freeze([
  { group: 'Intelligence & protection', products: ['TG Intelligence', 'TG Sentinel', 'TG Guardian'] },
  { group: 'Authority, advice & assets', products: ['TG Authority', 'TG Advisory Network (TGAN)', 'TG Tokenization'] },
  { group: 'Visualize & play', products: ['TG View', 'TG Arena (TGAR)', 'TG Play Analysis'] },
  { group: 'Build & grow', products: ['TG Developer Platform', 'TG SEO Intelligence', '1313VERSE'] },
].map((g) => Object.freeze({ ...g, products: Object.freeze(g.products) })));
export const SHOWCASE_PRODUCTS = Object.freeze(SHOWCASE.flatMap((g) => g.products));
export const APPROVED_ACRONYMS = Object.freeze(['TGLW', 'TGLB', 'TGAN', 'TGAR']);
// Group windows (absolute seconds) for the talk slot: four equal quarters.
export function showcaseBeats(scene) {
  const len = scene.end - scene.start; const n = SHOWCASE.length;
  return SHOWCASE.map((g, k) => ({ ...g, start: Math.round((scene.start + (k * len) / n) * 100) / 100, end: Math.round((scene.start + ((k + 1) * len) / n) * 100) / 100 }));
}

const r1 = (x) => Math.round(x * 10) / 10;
export const talkLength = (talk) => { const n = Number(talk); return talk === null || talk === undefined || talk === '' || !Number.isFinite(n) ? DEFAULT_TALK : r1(Math.max(0, Math.min(MAX_TALK, n))); };
// Timeline for a talk slot of `talk` seconds: narrated beats keep their fixed length; total = NARRATED + talk.
export function buildTimeline(talk = DEFAULT_TALK, defs = SCENE_DEFS) {
  const T = talkLength(talk); let t = 0;
  return Object.freeze(defs.map((d) => { const len = d.talk ? T : d.dur; const s = Object.freeze({ ...d, start: r1(t), end: r1(t + len) }); t = s.end; return s; }));
}
export const totalOf = (scenes) => scenes.at(-1).end;
export const SCENES = buildTimeline(DEFAULT_TALK);
// TTS-only respelling so the voice pronounces names; the notes drawer shows `say` unchanged.
export function speechText(say) {
  return String(say)
    .replace(/GYW1313/g, 'G Y W thirteen thirteen').replace(/\bXRPL\b/g, 'X R P L').replace(/\bXDLC\b/g, 'X D L C')
    .replace(/\bTGLB\b/g, 'T G L B').replace(/\bTGLW\b/g, 'T G L W').replace(/\bTGAN\b/g, 'T G A N').replace(/\bTG\b/g, 'T G')
    .replace(/\bx402\b/g, 'x four oh two').replace(/\bXRP\b/g, 'X R P').replace(/\bt54\b/g, 'T fifty-four').replace(/\bAWS\b/g, 'A W S')
    .replace(/’/g, "'");
}
export const audioFile = (id) => `scene-${String(SCENE_DEFS.findIndex((d) => d.id === id) + 1).padStart(2, '0')}.wav`;

export const fmt = (t) => { const s = Math.max(0, Math.floor(t)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
export const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
export function sceneAt(t, scenes = SCENES) {
  if (!(t > 0)) return 0;
  for (let i = 0; i < scenes.length; i++) if (t < scenes[i].end) return i;
  return scenes.length - 1;
}
export const nextStart = (t, scenes = SCENES) => { const i = sceneAt(t, scenes); return i + 1 < scenes.length ? scenes[i + 1].start : scenes.at(-1).end; };
export const prevStart = (t, scenes = SCENES) => { const i = sceneAt(t, scenes); return (t - scenes[i].start > 2 || i === 0) ? scenes[i].start : scenes[i - 1].start; };
export function validate(scenes = SCENES, total = DURATION) {
  const errs = [];
  if (scenes[0]?.start !== 0) errs.push('first scene must start at 0');
  scenes.forEach((s, i) => {
    if (!(s.end > s.start) && !(s.talk && s.end === s.start)) errs.push(`scene ${i} empty`);
    if (i && scenes[i - 1].end !== s.start) errs.push(`gap/overlap before scene ${i}`);
    if (!s.headline || words(s.headline) > 9) errs.push(`scene ${i} headline must be 1–9 words`);
    if (!s.modes?.length || s.modes.some((m) => !MODE_TEXT[m])) errs.push(`scene ${i} needs a known mode label`);
    if (!s.badge) errs.push(`scene ${i} needs a badge`);
    if (!s.say || words(s.say) > (s.talk ? 120 : 45)) errs.push(`scene ${i} narration too long`);
    if (!s.talk && !(s.dur > 0)) errs.push(`scene ${i} needs a duration`);
    if (s.era && !ERA[s.era]) errs.push(`scene ${i} unknown era`);
  });
  if (scenes.at(-1)?.end !== total) errs.push(`last scene must end at ${total}`);
  if (scenes.filter((s) => s.talk).length !== 1) errs.push('exactly one presenter slot');
  return errs;
}

// ---------- live numbers: pure extractors over GET responses (null when the data is missing; never invented) ----------
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (n) => Math.round(n).toLocaleString('en-US');
export const VENDOR_ORDER = Object.freeze([['xrpl', 'XRPL'], ['t54', 't54'], ['ledger', 'Ledger'], ['quicknode', 'QuickNode'], ['agentcore', 'AWS'], ['mastercard', 'Mastercard']]);
export const VENDOR_STATUS = Object.freeze({
  CONNECTED_TESTED: ['ok', 'connected · tested'], CONNECTED: ['ok', 'connected'], SANDBOX_ONLY: ['warn', 'sandbox only'],
  CREDENTIALS_REQUIRED: ['warn', 'needs credentials'], DOCUMENTATION_ONLY: ['off', 'docs only'], ERROR: ['bad', 'error'],
});

export function liveFor(id, data = {}) {
  const d = data || {};
  if (id === 'proof') {
    const live = d.theater?.live; const n = num(live?.quoter?.makerFills);
    if (n === null || live?.mode !== 'LIVE_TESTNET') return null;
    return { big: int(n), label: 'validated Testnet maker fills', mode: 'LIVE_TESTNET', note: live.organic === false ? 'demo accounts' : '' };
  }
  if (id === 'site') {
    const list = d.vendors?.vendors; if (!Array.isArray(list)) return null;
    const by = Object.fromEntries(list.map((v) => [v.id, v.status]));
    return { vendors: VENDOR_ORDER.map(([vid, name]) => { const s = VENDOR_STATUS[by[vid]]; return { id: vid, name, tone: s ? s[0] : 'off', text: s ? s[1] : 'status unavailable' }; }) };
  }
  return null;
}

// ---------- illustrations (inline SVG, CSS animation only; `narrow` = phone layout) ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (w, h, body, label, cls = '') => `<svg class="art-svg${cls ? ' ' + cls : ''}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${body}</svg>`;
const lock = (x, y, s = 1) => `<g class="lock" transform="translate(${x} ${y}) scale(${s})"><path d="M-6 -2 v-5 a6 6 0 0 1 12 0 v5" fill="none" stroke-width="2.6"/><rect x="-8.5" y="-2" width="17" height="13" rx="3"/></g>`;
const isNarrow = () => typeof window !== 'undefined' && window.innerWidth < 640;

// Titan Ghost core with its three modules (wide: right-hand hub; narrow: a row at the top). k ≤ cur → lit; k = cur → current.
const modState = (k, cur) => (k < cur ? ' lit' : k === cur ? ' lit cur' : '');
const HUB = { core: [1040, 290], mods: [[870, 290], [1090, 140], [1090, 440]] };
function hubWide(cur) {
  const [cx, cy] = HUB.core;
  const labels = [[870, 352], [1090, 92], [1090, 502]];
  return `<g class="hub">
    ${HUB.mods.map(([x, y], i) => `<path class="hub-link${modState(i + 1, cur)}" d="M${cx} ${cy} L${x} ${y}"/>`).join('')}
    <circle class="core-glow" cx="${cx}" cy="${cy}" r="92"/>
    <circle class="core" cx="${cx}" cy="${cy}" r="74"/><circle class="core-in" cx="${cx}" cy="${cy}" r="62"/>
    <text class="t-core" x="${cx}" y="${cy - 4}">TITAN</text><text class="t-core" x="${cx}" y="${cy + 24}">GHOST</text>
    ${HUB.mods.map(([x, y], i) => `<g class="mod${modState(i + 1, cur)}"><circle class="mod-pulse" cx="${x}" cy="${y}" r="34"/><circle class="mod-bg" cx="${x}" cy="${y}" r="34"/><circle class="mod-c" cx="${x}" cy="${y}" r="34"/><text class="t-modn" x="${x}" y="${y + 10}">${i + 1}</text><text class="t-mod" x="${labels[i][0]}" y="${labels[i][1]}">${esc(MODULES[i])}</text></g>`).join('')}
  </g>`;
}
function hubNarrow(cur) {
  const short = ['Lending', 'Agentic', 'XDLC'];
  return `<g class="hub">
    <path class="hub-link${cur >= 1 ? ' lit' : ''}" d="M60 56 H384"/>
    <circle class="core" cx="46" cy="56" r="42"/><circle class="core-in" cx="46" cy="56" r="34"/>
    <text class="t-core sm" x="46" y="52">TITAN</text><text class="t-core sm" x="46" y="70">GHOST</text>
    ${short.map((n, i) => { const x = 100 + i * 100; return `<g class="mod${modState(i + 1, cur)}"><rect class="mod-bg" x="${x}" y="36" width="92" height="40" rx="20"/><rect class="mod-c" x="${x}" y="36" width="92" height="40" rx="20"/><text class="t-modp" x="${x + 46}" y="61"><tspan class="n">${i + 1}</tspan> ${n}</text></g>`; }).join('')}
  </g>`;
}

const ART = {
  open: (live, s, narrow) => {
    const clip = '<defs><clipPath id="heroClip"><rect x="0" y="0" width="1" height="1" rx=".045"/></clipPath><linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3dda7"/><stop offset="1" stop-color="#e9c46a"/></linearGradient></defs>';
    const hero = (x, y, w) => `<g class="o-hero"><svg x="${x}" y="${y}" width="${w}" height="${w}" viewBox="0 0 1 1"><image href="${HERO_IMG}" x="0" y="0" width="1" height="1" preserveAspectRatio="xMidYMid slice" clip-path="url(#heroClip)"/></svg><rect class="o-frame" x="${x}" y="${y}" width="${w}" height="${w}" rx="${w * 0.045}"/></g>`;
    const words2 = (cx, y1, y2, fs, py, ry, ty, by, tfs) => `
      <text class="o-presents" x="${cx}" y="${py}">GYW<tspan class="g">1313</tspan>  PRESENTS</text>
      <g class="o-mark"><text class="o-word" x="${cx}" y="${y1}" style="font-size:${fs}px">TITAN</text><text class="o-word" x="${cx}" y="${y2}" style="font-size:${fs}px">GHOST</text></g>
      <path class="o-rule" d="M${cx - 150} ${ry} H${cx + 150}"/>
      <text class="o-tag" x="${cx}" y="${ty}" style="font-size:${tfs}px">Liquidity for every market</text>
      <text class="o-built" x="${cx}" y="${by}">BUILT ON THE XRP LEDGER</text>`;
    if (narrow) return svg(400, 640, `${clip}${hero(90, 0, 220)}${words2(200, 360, 438, 76, 270, 470, 508, 546, 19)}`, 'GYW1313 presents Titan Ghost, built on the XRP Ledger', 'narrow');
    return svg(1200, 560, `${clip}${hero(60, 40, 480)}${words2(880, 300, 400, 112, 170, 440, 488, 530, 26)}`, 'GYW1313 presents Titan Ghost, built on the XRP Ledger');
  },

  problem: (live, s, narrow) => {
    const bridge = `
      <g class="waves">${[340, 372, 404].map((y, i) => `<path class="wave w${i}" d="M-40 ${y} q40 -12 80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0"/>`).join('')}</g>
      <ellipse class="isle gold" cx="115" cy="300" rx="100" ry="30"/><ellipse class="isle cyan" cx="685" cy="300" rx="100" ry="30"/>
      <circle class="coin gold" cx="115" cy="228" r="46"/><text class="t-coin" x="115" y="236">TOKEN</text>
      <circle class="coin cyan" cx="685" cy="228" r="46"/><text class="t-coin" x="685" y="237">XRP</text>
      <path class="bridge gold" d="M170 262 Q250 238 330 262"/><path class="bridge cyan" d="M470 262 Q550 238 630 262"/>
      <path class="plank" d="M330 262 l10 30"/><path class="plank" d="M470 262 l-8 34"/>
      <circle class="s2-dot" cx="180" cy="248" r="13"/>
      <g class="s2-x"><path class="x" d="M384 186 l32 32 M416 186 l-32 32"/><text class="t-fail" x="400" y="168">no path</text></g>`;
    const failW = 400, succW = Math.round((failW * STAT.succeeded) / STAT.failed);
    const C = 2 * Math.PI * 58; const arc = (C * STAT.top5Share) / 100;
    const stats = `
      <text class="t-cap" x="0" y="26">Cross-currency payments · Mainnet sample</text>
      <rect class="bar fail" x="0" y="48" width="${failW}" height="52" rx="10"/><text class="t-barl" x="18" y="83">failed</text><text class="t-barn fail" x="${failW + 16}" y="88">${STAT.failed}</text>
      <rect class="bar ok" x="0" y="118" width="${succW}" height="52" rx="10"/><text class="t-barl" x="18" y="153">succeeded</text><text class="t-barn ok" x="${succW + 16}" y="158">${STAT.succeeded}</text>
      <circle class="donut-bg" cx="64" cy="282" r="58"/><circle class="donut" cx="64" cy="282" r="58" style="stroke-dasharray:${arc.toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 64 282)"/>
      <text class="t-donut" x="64" y="292">${STAT.top5Share}%</text>
      <text class="t-dl" x="148" y="274">of liquidity from just</text><text class="t-dl b" x="148" y="306">5 providers</text>`;
    if (narrow) return svg(400, 640, `<g transform="translate(0 -40) scale(.5)">${bridge}</g><g transform="translate(28 220) scale(.66)">${stats}</g>`, 'A broken bridge between a token and XRP; 133 failed versus 79 succeeded cross-currency payments; 97% of liquidity from 5 providers', 'narrow');
    return svg(1200, 500, `<g transform="translate(0 10) scale(.8)">${bridge}</g><g transform="translate(690 90)">${stats}</g>`, 'A broken bridge between a token and XRP; 133 failed versus 79 succeeded cross-currency payments; 97% of liquidity from 5 providers');
  },

  engine: (live, s, narrow) => {
    const R = narrow ? [34, 58, 82, 108, 136, 166] : [46, 76, 106, 140, 178, 220];
    const [cx, cy] = narrow ? [200, 190] : [330, 260];
    const rings = R.map((r, i) => `<circle class="ering e${i}" cx="${cx}" cy="${cy}" r="${r}" style="--dl:${(0.5 + i * 0.45).toFixed(2)}s"/>`).join('');
    const ext = narrow ? 16 : 60;
    const pays = [0, 1, 2, 3].map((j) => `<circle class="pay" cx="${cx - R[5] - ext}" cy="${cy}" r="${narrow ? 7 : 9}" style="--dl:${(4 + j * 1.6).toFixed(1)}s;--dx:${2 * R[5] + 2 * ext}px"/>`).join('');
    const core = `<path class="route" d="M${cx - R[5] - ext} ${cy} H${cx + R[5] + ext}"/>${rings}${pays}<circle class="coin gold" cx="${cx}" cy="${cy}" r="${narrow ? 26 : 34}"/><text class="t-mk${narrow ? ' sm' : ''}" x="${cx}" y="${cy + 5}">MARKET</text>`;
    if (narrow) {
      const leg = [['cyan', 'Rings 1–2', 'tight · everyday payments'], ['mid', 'Rings 3–4', 'balanced depth'], ['gold', 'Rings 5–6', 'deep reserves']];
      return svg(400, 600, `${core}${leg.map(([c, a, b], i) => `<g class="eleg" style="--dl:${(3 + i * .5).toFixed(1)}s"><rect class="sw ${c}" x="40" y="${396 + i * 66}" width="26" height="26" rx="13"/><text class="t-ea" x="82" y="${408 + i * 66}">${a}</text><text class="t-eb" x="82" y="${432 + i * 66}">${b}</text></g>`).join('')}`, 'Six rings of liquidity around a market; payments route through them', 'narrow');
    }
    const pt = (r, deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
    const lab = [[R[1], -50, 150, 'cyan', 'Rings 1–2', 'tight · everyday payments'], [R[3], -8, 262, 'mid', 'Rings 3–4', 'balanced depth'], [R[5], 30, 390, 'gold', 'Rings 5–6', 'deep reserves']];
    return svg(1000, 520, `${core}${lab.map(([r, deg, y, c, a, b], i) => { const [x0, y0] = pt(r, deg); return `<g class="eleg" style="--dl:${(3 + i * .5).toFixed(1)}s"><circle class="pin ${c}" cx="${x0.toFixed(1)}" cy="${y0.toFixed(1)}" r="6"/><path class="lead" d="M${x0.toFixed(1)} ${y0.toFixed(1)} L${640} ${y - 8} H${660}"/><text class="t-ea ${c}" x="672" y="${y}">${a}</text><text class="t-eb" x="672" y="${y + 32}">${b}</text></g>`; }).join('')}`, 'Six rings of liquidity around a market; payments route through them');
  },

  proof: (live, s, narrow) => svg(640, 300, `
    <text class="t-cap c" x="320" y="26">our offers on the book</text>
    ${[0, 1, 2].map((i) => `<rect class="offer" x="240" y="${42 + i * 30}" width="160" height="22" rx="6" style="--dl:${(1 + i * 1.2).toFixed(1)}s"/><text class="t-fill" x="412" y="${59 + i * 30}" style="--dl:${(1 + i * 1.2).toFixed(1)}s">filled ✓</text>`).join('')}
    <path class="hop" d="M140 210 H500"/>
    <circle class="coin gold" cx="90" cy="210" r="50"/><text class="t-coin sm" x="90" y="217">TOKEN A</text>
    <circle class="coin cyan" cx="320" cy="210" r="56"/><text class="t-coin" x="320" y="219">XRP</text>
    <circle class="coin gold" cx="550" cy="210" r="50"/><text class="t-coin sm" x="550" y="217">TOKEN B</text>
    <path class="feed" d="M320 154 V132"/>
    <circle class="payer" cx="90" cy="210" r="11"/>`, 'A payment from token A bridges through XRP to token B and fills our offers', narrow ? 'narrow' : ''),

  lending: (live, s, narrow) => {
    const wallet = (x, y) => `<g class="wallet"><rect x="${x - 22}" y="${y - 15}" width="44" height="32" rx="7"/><path d="M${x + 6} ${y - 1} h16"/>${lock(x - 4, y, 0.7)}</g>`;
    const chip = (x, y, w, c, t) => `<rect class="chip ${c}" x="${x}" y="${y}" width="${w}" height="34" rx="17"/><text class="t-chip" x="${x + w / 2}" y="${y + 23}">${t}</text>`;
    if (narrow) {
      return svg(400, 680, `${hubNarrow(1)}
        <g class="platform tglw" data-platform="TGLW"><rect class="plat cyan" x="16" y="128" width="368" height="128" rx="20"/>
          <text class="t-plab" x="36" y="156">PLATFORM</text><text class="t-ptitle cyan" x="36" y="196">TGLW</text><text class="t-psub" x="36" y="226">self-custody liquidity</text>
          ${wallet(240, 192)}${wallet(294, 192)}${wallet(348, 192)}<text class="t-tiny" x="294" y="236">own wallets</text></g>
        <path class="flow cyan" d="M150 256 V372"/><path class="flow cyan" d="M250 256 V372"/>
        <text class="t-flow e" x="138" y="320">Tier 1 · flexible</text><text class="t-flow" x="262" y="320">Tier 2 · term</text>
        <g class="platform tglb" data-platform="TGLB"><rect class="plat gold" x="16" y="372" width="368" height="196" rx="20"/>
          <text class="t-plab" x="36" y="400">PLATFORM</text><text class="t-ptitle gold" x="36" y="440">TGLB</text><text class="t-psub" x="36" y="470">funds new markets</text>
          ${chip(36, 488, 100, 'cyan', 'Tier 1')}${chip(148, 488, 100, 'cyan', 'Tier 2')}${chip(36, 526, 212, 'gold', 'Tier 3 · loans')}</g>
        <path class="flow gold" d="M200 568 V626"/><text class="t-flow c" x="200" y="660">liquidity into Titan Ghost rings</text>`, 'TGLW platform supplies Tier 1 and Tier 2 to the separate TGLB platform, which adds Tier 3 loans and funds Titan Ghost', 'narrow');
    }
    return svg(1200, 560, `${hubWide(1)}
      <g class="platform tglw" data-platform="TGLW"><rect class="plat cyan" x="20" y="150" width="260" height="250" rx="24"/>
        <text class="t-plab" x="150" y="188">PLATFORM</text><text class="t-ptitle cyan" x="150" y="240">TGLW</text><text class="t-psub" x="150" y="270">self-custody liquidity</text>
        ${wallet(86, 326)}${wallet(150, 326)}${wallet(214, 326)}<text class="t-tiny" x="150" y="376">participants’ own wallets</text></g>
      <path class="flow cyan" d="M280 232 H470"/><path class="flow cyan" d="M280 318 H470"/>
      <text class="t-flow c" x="375" y="218">Tier 1 · flexible</text><text class="t-flow c" x="375" y="304">Tier 2 · term</text>
      <g class="platform tglb" data-platform="TGLB"><rect class="plat gold" x="470" y="120" width="290" height="320" rx="24"/>
        <text class="t-plab" x="615" y="158">PLATFORM</text><text class="t-ptitle gold" x="615" y="208">TGLB</text><text class="t-psub" x="615" y="238">funds new markets</text>
        ${chip(500, 268, 110, 'cyan', 'Tier 1')}${chip(620, 268, 110, 'cyan', 'Tier 2')}${chip(500, 316, 230, 'gold', 'Tier 3 · loans')}
        <text class="t-tiny" x="615" y="384">underwritten lending</text></g>
      <path class="flow gold" d="M760 290 H834"/><text class="t-flow c" x="797" y="276">funds</text>`, 'TGLW platform supplies Tier 1 and Tier 2 to the separate TGLB platform, which adds Tier 3 loans and funds the Titan Ghost lending module');
  },

  agentic: (live, s, narrow) => {
    const icon = {
      agent: (x, y, k) => `<g transform="translate(${x} ${y}) scale(${k})"><path class="ic" d="M0 -30 V-20"/><circle class="ic-f" cx="0" cy="-33" r="4"/><rect class="ic" x="-24" y="-20" width="48" height="38" rx="10"/><circle class="ic-f" cx="-10" cy="-2" r="5"/><circle class="ic-f" cx="10" cy="-2" r="5"/><path class="ic" d="M-10 10 h20"/><path class="ic" d="M-24 -4 h-6 M24 -4 h6"/></g>`,
      bill: (x, y, k) => `<g transform="translate(${x} ${y}) scale(${k})"><path class="ic" d="M-20 -28 H12 L22 -18 V28 H-20 Z"/><text class="t-402" x="1" y="4">402</text><path class="ic" d="M-11 14 h22"/></g>`,
      person: (x, y, k) => `<g transform="translate(${x} ${y}) scale(${k})"><circle class="ic" cx="-4" cy="-14" r="11"/><path class="ic" d="M-26 24 C-26 4 18 4 18 24"/><circle class="ok-b" cx="18" cy="-18" r="12"/><path class="ok-c" d="M12 -18 l4 4 l8 -9"/></g>`,
      store: (x, y, k) => `<g transform="translate(${x} ${y}) scale(${k})"><path class="ic" d="M-26 -10 L-20 -26 H20 L26 -10 Z"/><path class="ic" d="M-22 -10 V24 H22 V-10"/><rect class="ic" x="-7" y="4" width="14" height="20" rx="2"/></g>`,
    };
    const nodes = [['agent', 'AI agent', ''], ['bill', 'x402 payment', 'request'], ['person', 'Person', 'approves'], ['store', 'TG Merchant', '']];
    if (narrow) {
      const ys = [170, 290, 410, 530];
      return svg(400, 680, `${hubNarrow(2)}
        <path class="hop" d="M76 170 V530"/>
        <path class="data-arc" d="M300 524 C390 470 390 230 300 176"/><text class="t-flow c" x="318" y="352">market</text><text class="t-flow c" x="318" y="372">data ↑</text>
        ${nodes.map(([k, a, b], i) => `<g class="anode${k === 'person' ? ' gate' : ''}"><circle class="an-c" cx="76" cy="${ys[i]}" r="46"/>${icon[k](76, ys[i] + 2, 0.82)}<text class="t-an" x="134" y="${ys[i] + (b ? -2 : 8)}">${a}</text>${b ? `<text class="t-an2" x="134" y="${ys[i] + 22}">${b}</text>` : ''}</g>`).join('')}
        <circle class="payer" cx="76" cy="170" r="9" style="--dy:360px"/>
        <text class="t-tiny" x="200" y="640">every payment needs a person’s approval</text>`, 'An AI agent sends an x402 payment request, a person approves, TG Merchant delivers Titan Ghost market data', 'narrow v');
    }
    const xs = [100, 310, 520, 730];
    return svg(1200, 560, `${hubWide(2)}
      <path class="hop" d="M100 300 H730"/>
      <path class="data-arc" d="M730 238 C730 120 100 120 100 238"/><text class="t-flow c" x="415" y="138">Titan Ghost market data</text>
      <path class="flow gold" d="M1056 140 C920 140 840 170 776 254"/>
      ${nodes.map(([k, a, b], i) => `<g class="anode${k === 'person' ? ' gate' : ''}"><circle class="an-c" cx="${xs[i]}" cy="300" r="60"/>${icon[k](xs[i], 302, 1.05)}<text class="t-an" x="${xs[i]}" y="400">${a}</text>${b ? `<text class="t-an2" x="${xs[i]}" y="430">${b}</text>` : ''}</g>`).join('')}
      <circle class="payer" cx="100" cy="300" r="11" style="--dx:630px"/>
      <rect class="req" x="410" y="460" width="220" height="40" rx="20"/><text class="t-req" x="520" y="486">approval required</text>`, 'An AI agent sends an x402 payment request, a person approves, TG Merchant delivers Titan Ghost market data');
  },

  // XDLC as a neutral protocol (illustrative): a stepped corridor quoting just inside the AMM curve at every depth,
  // filled first by a taker order, fed by any provider (fill priority by tenure).
  xdlc: (live, s, narrow) => {
    const chart = (ox, oy, w, h, k) => {
      const amm = (t) => oy - h * (0.18 + 0.82 * Math.pow(t, 2.2)); // AMM price (incl. fee) rising with depth
      const curve = Array.from({ length: 41 }, (_, i) => { const t = i / 40; return `${i ? 'L' : 'M'}${(ox + t * w).toFixed(1)} ${amm(t).toFixed(1)}`; }).join(' ');
      const N = 9; let ladder = ''; let area = `M${ox} ${oy}`;
      for (let i = 0; i < N; i++) { const t0 = i / N, t1 = (i + 1) / N; const y = (amm(t0) + 10 * k).toFixed(1); const x0 = (ox + t0 * w).toFixed(1), x1 = (ox + t1 * w).toFixed(1); ladder += `${i ? 'V' : 'M' + x0 + ' '}${y} H${x1} `; area += ` L${x0} ${y} L${x1} ${y}`; }
      area += ` L${ox + w} ${oy} Z`;
      return `<path class="axis" d="M${ox} ${oy - h - 10 * k} V${oy} H${ox + w + 16 * k}"/>
        <text class="t-axis" x="${ox + w}" y="${oy + 26 * k}" style="text-anchor:end">depth →</text><text class="t-axis" x="${ox - 10 * k}" y="${oy - h - 18 * k}" style="text-anchor:start">price</text>
        <g class="ladder-wrap"><path class="ladder-area" d="${area}"/><path class="ladder" d="${ladder}"/><rect class="ladder-mask" x="${ox + 1}" y="${oy - h - 20 * k}" width="${w + 4}" height="${h + 18 * k}"/></g>
        <path class="amm" d="${curve}"/>
        <text class="t-amm" x="${ox + w + 8 * k}" y="${amm(1) + 6 * k}" style="text-anchor:start">AMM</text>
        <path class="taker" d="M${ox + 8 * k} ${oy - 14 * k} H${ox + w * 0.86}"/><path class="taker-h" d="M${ox + w * 0.86 - 10 * k} ${oy - 22 * k} L${ox + w * 0.86 + 4 * k} ${oy - 14 * k} L${ox + w * 0.86 - 10 * k} ${oy - 6 * k}"/>
        <text class="t-taker" x="${ox + 14 * k}" y="${oy - 26 * k}" style="text-anchor:start">taker order fills the corridor first</text>`;
    };
    const lbl = (x, y, fs, two) => (two ? `<text class="t-corr" x="${x}" y="${y}" style="font-size:${fs}px">XDLC corridor</text><text class="t-corr" x="${x}" y="${y + fs + 3}" style="font-size:${fs}px">≥1 bp better</text>` : `<text class="t-corr" x="${x}" y="${y}" style="font-size:${fs}px">XDLC corridor · ≥1 bp better</text>`);
    const providers = ['Titan Ghost', 'TGLW participants', 'Other firms'];
    if (narrow) {
      return svg(400, 680, `${hubNarrow(3)}
        ${chart(44, 420, 300, 230, 0.8)}${lbl(310, 350, 14, true)}
        ${providers.map((p, i) => `<rect class="prov" x="80" y="${458 + i * 46}" width="240" height="36" rx="18"/><text class="t-prov" x="200" y="${482 + i * 46}">${p}</text>`).join('')}
        <text class="t-tiny" x="200" y="618">open to any provider · tenure priority</text>
        <text class="t-tiny" x="200" y="642">neutral protocol</text>`, 'Illustrative: the XDLC corridor quotes just inside the AMM price at every depth; Titan Ghost, TGLW participants and other firms all provide liquidity', 'narrow');
    }
    return svg(1200, 560, `${hubWide(3)}<text class="t-tiny" x="1090" y="528">neutral protocol</text>
      ${chart(70, 380, 620, 300, 1)}${lbl(560, 346, 20)}
      ${providers.map((p, i) => { const x = 64 + i * 215; return `<path class="flow gold thin" d="M${x + 102} 440 V396"/><rect class="prov" x="${x}" y="444" width="205" height="42" rx="21"/><text class="t-prov" x="${x + 102}" y="471">${p}</text>`; }).join('')}
      <text class="t-tiny" x="382" y="522">open to any provider · fill priority by tenure</text>`, 'Illustrative: the XDLC corridor quotes just inside the AMM price at every depth; Titan Ghost, TGLW participants and other firms all provide liquidity');
  },

  // Presenter credential card (HTML). Text comes from PRESENTER.
  presenter: () => {
    const P = PRESENTER; const chev = '<i class="chev" aria-hidden="true"></i>';
    return `<div class="cred" role="img" aria-label="${esc(P.name)}: ${esc(P.military.join(' → '))}; ${esc(P.certification)}; ${esc(P.education.join('; '))}">
      <div class="cred-head"><span class="cred-hex"></span><div><div class="cred-name">${esc(P.name)}</div><div class="cred-role">GYW<b>1313</b> · TITAN GHOST</div></div></div>
      <div class="cred-row"><div class="ck">Military</div><div class="cv mil">${P.military.map((m, i) => `<span class="step s${i}">${esc(m)}</span>`).join(chev)}</div></div>
      <div class="cred-row"><div class="ck">Certification</div><div class="cv"><span class="cissp">${esc(P.certification)}</span></div></div>
      <div class="cred-row"><div class="ck">Education</div><div class="cv edu">${P.education.map((e) => `<span>${esc(e)}</span>`).join('')}</div></div>
      <div class="cred-row"><div class="ck">Dissertation</div><div class="cv diss">${esc(P.dissertation)}</div></div>
    </div>`;
  },

  // Talk slot: the 12 other products as cards, one group of three highlighted per quarter; the featured five noted below.
  showcase: (live, scene) => {
    const slot = Math.max(4, (scene?.end ?? DEFAULT_TALK) - (scene?.start ?? 0)); const beat = slot / SHOWCASE.length;
    const off = Math.max(0, Number(scene?.offset) || 0); // seconds already elapsed in the slot (seek/deep link)
    const anim = (k) => `style="--dl:${(k * beat - off).toFixed(2)}s;--cyc:${slot}s"`;
    return `<div class="show" role="img" aria-label="12 more GYW1313 products coming to market, plus the five featured today">
      <div class="groups">${SHOWCASE.map((g, k) => `<div class="grp lit-anim" ${anim(k)}><div class="gname">${esc(g.group)}</div>${g.products.map((p) => `<div class="pcard${p === '1313VERSE' ? ' nontg' : ''}"><span class="hex"></span><span class="pname">${esc(p)}</span></div>`).join('')}</div>`).join('')}</div>
      <div class="feat"><span class="fl">17 products · five featured today</span>${FEATURED.map((f) => `<span class="fchip">${esc(f)}</span>`).join('')}</div>
    </div>`;
  },

  site: (live, scene) => {
    const vs = live?.vendors || VENDOR_ORDER.map(([id, name]) => ({ id, name, tone: 'off', text: 'status unavailable' }));
    const liveSite = scene?.siteLive === true;
    return `<div class="site">
      <figure class="browser"><div class="chrome"><i></i><i></i><i></i><span class="addr">${esc(SITE_URL)}</span></div><img class="shot" src="${SITE_PREVIEW}" data-fallback="${HERO_IMG}" alt="The Titan Ghost page on gyw1313.com"></figure>
      <div class="site-r">
        <div class="site-tag${liveSite ? ' live' : ''}">${esc(siteTag(liveSite))}</div>
        <div class="site-url">gyw1313.com/<b>titan-ghost</b></div>
        <div class="built"><span class="bl">Built with</span><ul>${vs.map((v) => `<li><i class="sdot ${v.tone}"></i><b>${esc(v.name)}</b><small>${esc(v.text)}</small></li>`).join('')}</ul></div>
      </div>
    </div>`;
  },
};
export const renderArt = (scene, live, narrow = isNarrow()) => ART[scene.art](live, scene, narrow);

// ---------- controller (browser only) ----------
// Audio: one <audio> per narrated scene from public/pitch-audio/manifest.json (local files, works offline). Playback
// needs a user gesture, so the page opens on a "▶ Start pitch" overlay. The voice is always slaved to the timeline:
// on show/seek/resume it plays from (t − scene.start); on pause/mute it stops. A missing file just means silence.
const ctl = { scenes: SCENES, total: DURATION, base: 0, startedAt: 0, paused: true, started: false, idx: -1, auto: false, held: false, data: {}, notes: false, muted: false, audio: {}, playing: null, siteLive: SITE_LIVE_DEFAULT };
const now = () => performance.now() / 1000;
const elapsed = () => Math.min(ctl.total, ctl.paused ? ctl.base : ctl.base + (now() - ctl.startedAt));
const $ = (id) => document.getElementById(id);

async function getJson(path) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 6000);
  try { const r = await fetch(path, { method: 'GET', signal: ac.signal, headers: { Accept: 'application/json' } }); return r.ok ? await r.json() : null; }
  catch { return null; } finally { clearTimeout(t); }
}

function liveHtml(s, live) {
  const parts = [];
  if (s.sub) parts.push(`<p class="sub">${esc(s.sub)}</p>`);
  if (live?.big) parts.push(`<div class="live"><span class="big">${esc(live.big)}</span><span class="lbl">${esc(live.label)}<br><span class="tag">${esc(MODE_TEXT[live.mode])}</span>${live.note ? ` <span class="note">${esc(live.note)}</span>` : ''}</span></div>`);
  return parts.join('');
}

function renderScene(i) {
  const s = ctl.scenes[i]; const live = liveFor(s.id, ctl.data);
  const el = document.querySelector(`.scene[data-i="${i}"]`);
  const off = i === ctl.idx ? Math.max(0, elapsed() - s.start) : 0;
  el.querySelector('.art').innerHTML = renderArt({ ...s, offset: off, siteLive: ctl.siteLive }, live);
  el.querySelector('.cap').innerHTML = liveHtml(s, live);
  // Website preview: fall back to the GYW1313 hero image if the site build has not produced its screenshot.
  for (const img of el.querySelectorAll('img[data-fallback]')) img.addEventListener('error', () => { if (!img.dataset.fb) { img.dataset.fb = '1'; img.src = img.dataset.fallback; img.classList.add('fb'); } }, { once: true });
}

function build() {
  $('stage').innerHTML = ctl.scenes.map((s, i) => `
    <section class="scene s-${s.id}${s.talk ? ' talk' : ''}" data-i="${i}" aria-hidden="true">
      <div class="badge"><span>${esc(s.badge)}</span></div>
      <h1>${esc(s.headline).replace(' · ', '&nbsp;· ').replace(/(\w)-(\w)/g, '$1&#8209;$2')}</h1>
      <div class="art"></div>
      <div class="cap"></div>
    </section>`).join('');
  $('dots').innerHTML = ctl.scenes.map((s, i) => `<button type="button" class="dot${s.talk ? ' talkdot' : ''}" data-i="${i}" aria-label="Scene ${i + 1}: ${esc(s.headline)}"><i></i></button>`).join('');
  ctl.scenes.forEach((_, i) => renderScene(i));
}

// ----- audio -----
function stopAudio() { const a = ctl.playing; ctl.playing = null; if (a) { try { a.pause(); } catch {} } }
function syncAudio() {
  const s = ctl.scenes[ctl.idx]; const a = s && ctl.audio[s.id];
  if (!ctl.started || ctl.paused || ctl.muted || !a) return stopAudio();
  const off = elapsed() - s.start - leadOf(s);
  if (off < 0 || (a.duration && off >= a.duration - 0.05)) return stopAudio();
  if (ctl.playing && ctl.playing !== a) stopAudio();
  // Seek only when (re)starting a clip (scene entry, skip, resume) or after a large drift; seeking every tick while the
  // clip is still buffering over a slow link restarts it from its first words.
  if (a.paused || Math.abs(a.currentTime - off) > 1.5) { if (off > 0.3 && Math.abs(a.currentTime - off) > 0.5) { try { a.currentTime = off; } catch {} } }
  ctl.playing = a;
  if (a.paused) a.play().catch(() => {});
}
async function loadAudio() {
  const man = await getJson('/pitch-audio/manifest.json');
  for (const e of man?.scenes || []) {
    if (!e || typeof e.file !== 'string' || !/^scene-\d\d\.wav$/.test(e.file)) continue;
    const a = new Audio(`/pitch-audio/${e.file}`); a.preload = 'auto'; ctl.audio[e.id] = a;
  }
}

function show(i) {
  ctl.idx = i; stopAudio();
  for (const el of document.querySelectorAll('.scene')) { const on = Number(el.dataset.i) === i; el.classList.toggle('on', on); el.setAttribute('aria-hidden', String(!on)); }
  renderScene(i); // re-render so CSS animations restart from frame 0
  const s = ctl.scenes[i]; document.body.dataset.scene = s.id;
  $('notes-body').innerHTML = `<b>${fmt(s.start)}–${fmt(s.end)} · ${esc(s.headline)}</b><span class="nbadge">${esc(s.badge)}</span><p>${esc(s.say)}</p>`;
}

function tick() {
  let t = elapsed();
  // Presenter mode: hold on the current scene's final frame instead of advancing.
  if (!ctl.paused && ctl.idx >= 0) { const hp = holdPoint(t, ctl.scenes[ctl.idx], ctl.auto); if (hp !== null && ctl.idx < ctl.scenes.length) { ctl.base = hp; ctl.paused = true; ctl.held = true; t = hp; } }
  const done = t >= ctl.total;
  if (done && !ctl.paused) { ctl.base = ctl.total; ctl.paused = true; }
  document.body.classList.toggle('ended', done);
  const i = sceneAt(t, ctl.scenes);
  if (i !== ctl.idx) show(i);
  const s = ctl.scenes[i];
  document.querySelectorAll('.dot').forEach((d, k) => {
    d.classList.toggle('past', k < i); d.classList.toggle('cur', k === i);
    d.querySelector('i').style.width = k === i ? `${Math.min(100, (100 * (t - s.start)) / Math.max(0.1, s.end - s.start)).toFixed(1)}%` : (k < i ? '100%' : '0');
  });
  $('clock').textContent = `${fmt(t)} / ${fmt(ctl.total)}`;
  const cd = $('countdown');
  if (ctl.held && !done) { cd.hidden = false; cd.textContent = i + 1 < ctl.scenes.length ? 'Press → for next' : 'End · Space to restart'; }
  else if (s.talk && !done) { cd.hidden = false; cd.textContent = `Showcase · ${fmt(s.end - t)} left${ctl.paused ? ' · paused' : ''}`; } else cd.hidden = true;
  document.body.classList.toggle('paused', ctl.paused && !done);
  $('b-pause').textContent = done ? '↺' : ctl.paused ? '▶' : '❚❚';
  $('b-mute').textContent = ctl.muted ? '🔇' : '🔊';
  syncAudio();
}

function seek(t) { ctl.base = Math.max(0, Math.min(ctl.total, t)); ctl.startedAt = now(); ctl.idx = -1; ctl.held = false; tick(); }
// → / Space at a held scene end: go to the next scene and play it (in manual mode a held last scene restarts).
function advance() {
  const t = elapsed(); const wasHeld = ctl.held;
  const nt = nextStart(t, ctl.scenes);
  if (wasHeld && nt >= ctl.total) { ctl.paused = false; return seek(0); }
  if (wasHeld) ctl.paused = false;
  seek(nt);
}
function start() { if (ctl.started) return; ctl.started = true; $('start').hidden = true; ctl.paused = false; ctl.startedAt = now(); tick(); }
function togglePause() {
  if (!ctl.started) return start();
  if (ctl.held) return advance();
  const t = elapsed();
  if (t >= ctl.total) { ctl.paused = false; return seek(0); }
  if (ctl.paused) { ctl.paused = false; ctl.startedAt = now(); } else { ctl.base = t; ctl.paused = true; }
  tick();
}
function toggleMute() { ctl.muted = !ctl.muted; tick(); }
function toggleNotes() { ctl.notes = !ctl.notes; $('notes').classList.toggle('open', ctl.notes); }
function fullscreen() { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); } catch {} }
function back() { stopAudio(); try { if (document.fullscreenElement) document.exitFullscreen(); } catch {} location.href = '/'; }

function boot() {
  const q = new URLSearchParams(location.search);
  ctl.scenes = buildTimeline(q.get('talk'));
  ctl.total = totalOf(ctl.scenes);
  ({ auto: ctl.auto, muted: ctl.muted } = playbackMode(q));
  ctl.siteLive = siteLiveFrom(q.get('siteLive'));
  build();
  const sc = Math.max(1, Math.min(ctl.scenes.length, Number(q.get('scene')) || 1));
  ctl.base = ctl.scenes[sc - 1].start + (Number(q.get('at')) || 0);
  const slot = ctl.scenes.find((s) => s.talk);
  $('start-meta').textContent = ctl.auto ? `Timed ${fmt(ctl.total)} with voice · live slot ${fmt(slot.end - slot.start)}` : `Presenter mode · voice off (M turns it on) · each scene holds until → or Space`;
  if (q.get('autostart') === '1') { ctl.started = true; $('start').hidden = true; ctl.paused = q.get('pause') === '1'; }
  seek(ctl.base);
  setInterval(tick, 150);
  $('start-btn').addEventListener('click', start);
  document.addEventListener('keydown', (ev) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const k = ev.key;
    if (k === ' ' || k === 'Spacebar' || (k === 'Enter' && !ctl.started)) togglePause();
    else if (k === 'ArrowRight') advance();
    else if (k === 'ArrowLeft') seek(prevStart(elapsed(), ctl.scenes));
    else if (k === 'f' || k === 'F') fullscreen();
    else if (k === 'n' || k === 'N') toggleNotes();
    else if (k === 'm' || k === 'M') toggleMute();
    else if (k === 'Escape') back();
    else return;
    ev.preventDefault();
  });
  $('dots').addEventListener('click', (ev) => { const b = ev.target.closest('.dot'); if (b) seek(ctl.scenes[Number(b.dataset.i)].start); });
  $('ctl').addEventListener('click', (ev) => {
    const a = ev.target.closest('button')?.dataset.a;
    if (a === 'pause') togglePause(); else if (a === 'prev') seek(prevStart(elapsed(), ctl.scenes)); else if (a === 'next') advance();
    else if (a === 'notes') toggleNotes(); else if (a === 'mute') toggleMute(); else if (a === 'fs') fullscreen(); else if (a === 'back') back();
  });
  // Phone/desktop layouts differ: re-render when the width class changes.
  let wasNarrow = isNarrow();
  window.addEventListener('resize', () => { const n = isNarrow(); if (n !== wasNarrow) { wasNarrow = n; ctl.scenes.forEach((_, i) => renderScene(i)); } });
  loadAudio();
  // Read-only state probe for rehearsal checks (no controls exposed).
  window.tfPitch = { state: () => ({ t: elapsed(), scene: ctl.scenes[ctl.idx]?.id, paused: ctl.paused, muted: ctl.muted, started: ctl.started, voice: !!(ctl.playing && !ctl.playing.paused), voiceAt: ctl.playing ? ctl.playing.currentTime : null, total: ctl.total, siteLive: ctl.siteLive, auto: ctl.auto, held: ctl.held }) };
  // Live numbers: GET only, in parallel; scenes re-render when their data arrives. Failures leave the scene number-free.
  for (const [key, path] of Object.entries(ENDPOINTS)) {
    getJson(path).then((j) => { if (!j) return; ctl.data[key] = j; ctl.scenes.forEach((_, i) => renderScene(i)); });
  }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
}
