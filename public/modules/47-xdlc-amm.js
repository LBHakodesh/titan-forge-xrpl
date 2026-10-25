// XDLC Corridor vs AMM: interactive SIMULATION of the proposed XDLC design (neutral protocol, draft amendment).
// Reads GET /api/xdlc-amm/simulate (pure compute). Pool inputs come from the real Mainnet XRP/RLUSD AMM (read-only,
// MAINNET_OBSERVED) or a labeled fallback; every computed number is SIMULATION. Nothing signs, submits or fills.
// Presenter hook: window.dispatchEvent(new CustomEvent('tf:present', { detail: { scene: 'xdlc-amm' } })) runs a 20 s demo.
const STYLE = `
.xa .xa-strip{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font-size:13px;padding:8px 12px;border:1px dashed var(--muted);border-radius:8px;margin-bottom:10px}
.xa .xa-pool{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;font-size:13px;color:var(--muted)}
.xa .xa-pool b{color:var(--ink);font-variant-numeric:tabular-nums}
.xa .xa-ctl{display:grid;gap:10px 16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));align-items:end}
.xa .xa-ctl label{margin:0 0 4px}
.xa .xa-ctl output{font:600 13px var(--mono);color:var(--ink)}
.xa input[type=range]{padding:0;border:0;background:none;accent-color:var(--accent)}
.xa .xa-seg{display:flex;border:1px solid var(--line);border-radius:6px;overflow:hidden}
.xa .xa-seg button{flex:1;border:0;background:var(--bg);color:var(--muted);padding:8px 6px;font:inherit;font-size:13px;cursor:pointer}
.xa .xa-seg button[aria-pressed=true]{background:var(--accent);color:#fff}
.xa .xa-g2{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr))}
.xa .xa-g2>.card{margin-bottom:0}
.xa .xa-sec{margin-top:16px}
.xa h3{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.xa svg text{fill:var(--muted);font:11px system-ui,sans-serif}
.xa .xa-leg{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--muted);margin-top:4px}
.xa .xa-leg i{display:inline-block;width:12px;height:4px;border-radius:2px;margin-right:5px;vertical-align:middle}
.xa .xa-big{font:700 34px/1.1 system-ui,sans-serif;font-variant-numeric:tabular-nums;color:var(--live);margin:6px 0 2px}
.xa .xa-big small{font-size:18px;color:var(--ink);font-weight:600}
.xa .xa-split{display:grid;gap:4px;margin:6px 0;font-size:13px;border-left:3px solid var(--live);padding:4px 10px}
.xa .xa-split b{font-family:var(--mono);font-size:13px}
.xa .xa-split i{color:var(--muted)}
.xa .xa-bar{display:flex;height:30px;border-radius:6px;overflow:hidden;background:var(--line);margin:10px 0 4px}
.xa .xa-bar i{display:block;height:100%;width:0;transition:width .45s ease-out;border-right:1px solid var(--panel)}
.xa .xa-bar i.c{background:var(--live)} .xa .xa-bar i.a{background:var(--accent);opacity:.55}
.xa .xa-sizes{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px}
.xa .xa-sizes div{border:1px solid var(--line);border-radius:6px;padding:6px;text-align:center;font-size:12px}
.xa .xa-sizes b{display:block;font:600 14px var(--mono);color:var(--ink)}
.xa .xa-prov{display:grid;gap:8px}
.xa .xa-pr{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:2px 8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)}
.xa .xa-pr .rk{font:700 12px var(--mono);color:var(--muted)}
.xa .xa-pr .nm{font-size:13px;font-weight:600;min-width:0}
.xa .xa-pr .nm span{font-weight:400;color:var(--muted);font-size:12px}
.xa .xa-pr .er{font:600 13px var(--mono);text-align:right}
.xa .xa-pr .bars{grid-column:2/4;display:grid;grid-template-columns:76px 1fr;white-space:nowrap;gap:3px 6px;font-size:11px;color:var(--muted);align-items:center}
.xa .xa-track{height:7px;border-radius:4px;background:var(--line);overflow:hidden}
.xa .xa-track i{display:block;height:100%;transition:width .6s ease-out}
.xa .k-ghost{background:var(--gold)} .xa .k-tglw1{background:var(--accent)} .xa .k-tglw2{background:var(--hist)} .xa .k-org{background:var(--replay)}
.xa .xa-pr.hit{background:linear-gradient(90deg,var(--live-bg),transparent)}
.xa .xa-time{position:relative;height:26px;border-radius:6px;background:var(--line);margin:8px 0 2px;overflow:hidden}
.xa .xa-time i{position:absolute;left:0;top:0;bottom:0;background:var(--hist);opacity:.6;transition:width .8s}
.xa .xa-time b{position:absolute;top:0;bottom:0;width:3px;background:var(--bad);transition:left .8s}
.xa .xa-ticks{display:flex;justify-content:space-between;font-size:11px;color:var(--muted)}
.xa .xa-fee{font:600 13px var(--mono);background:var(--bg);border-radius:6px;padding:8px 10px;margin:8px 0;overflow-wrap:anywhere}
.xa .xa-steps{display:flex;gap:3px;margin:8px 0}
.xa .xa-steps span{flex:1;height:22px;border-radius:3px;background:var(--line);opacity:.25;transition:opacity .3s}
.xa .xa-steps span.on{opacity:1} .xa .xa-steps span.c{background:var(--live)} .xa .xa-steps span.p{background:var(--bad)} .xa .xa-steps span.a{background:var(--accent)}
.xa .xa-var{display:grid;grid-template-columns:minmax(0,170px) 1fr auto;gap:6px 8px;align-items:center;font-size:12px;margin:4px 0}
.xa .xa-var .xa-track{height:12px}
.xa .xa-var b{font:600 12px var(--mono)}
.xa .xa-note{font-size:12px;color:var(--muted);margin:6px 0 0}
.xa .xa-pulse{animation:xap 1.1s ease-in-out 3}
@keyframes xap{50%{box-shadow:0 0 0 4px var(--live-bg)}}
@media (max-width:600px){.xa svg text{font-size:17px}.xa .xa-big{font-size:26px}.xa .xa-big small{font-size:15px}}
@media (prefers-reduced-motion: reduce){.xa .xa-bar i,.xa .xa-track i,.xa .xa-time i,.xa .xa-time b{transition:none}.xa .xa-pulse{animation:none}}
`;

const SIZE_MIN = 500, SIZE_MAX = 100000;
const sizeFromSlider = (v) => Math.round(SIZE_MIN * Math.pow(SIZE_MAX / SIZE_MIN, v / 100) / 100) * 100;
const sliderFromSize = (s) => Math.round((Math.log(s / SIZE_MIN) / Math.log(SIZE_MAX / SIZE_MIN)) * 100);
const f0 = (n) => (Number.isFinite(+n) ? Math.round(+n).toLocaleString('en-US') : '—');
const f2 = (n, d = 2) => (Number.isFinite(+n) ? (+n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const usd = (n) => (Number.isFinite(+n) ? `${n < 0 ? '−' : ''}$${Math.abs(n) >= 100 ? f0(Math.abs(n)) : f2(Math.abs(n))}` : '—');
const kUsd = (n) => (n >= 1000 ? `$${+(n / 1000).toFixed(n < 10000 ? 1 : 0)}k` : `$${f0(n)}`);

export default {
  id: 'xdlc-amm',
  title: 'XDLC Corridor vs AMM',
  order: 47,
  async mount(el, api) {
    const { esc, badge } = api;
    if (!document.getElementById('xa-style')) { const s = document.createElement('style'); s.id = 'xa-style'; s.textContent = STYLE; document.head.append(s); }
    el.classList.add('xa');
    const SIM = badge('SIMULATION');
    const st = { imp: 1, size: 10000, side: 'buy', scenario: 'single', seed: '1313', jump: 3, exitDay: 45, arb: false };
    let data = null, seq = 0, debounce = null, animTimers = [], demoTimers = [];
    const clearAnim = () => { animTimers.forEach(clearTimeout); animTimers = []; };

    el.innerHTML = `
      <div class="card">
        <h2>XDLC Corridor vs AMM ${SIM} ${badge('PROPOSED')}</h2>
        <div class="xa-strip"><b>Neutral protocol — any organization can provide liquidity</b><span class="muted">·</span><span>Proposed XRPL amendment (draft)</span></div>
        <p class="muted" style="margin:0 0 8px;font-size:13px">A corridor of liquidity that quotes the XRPL AMM's price <i>including its trading fee</i>, improved by <b>ImprovementBps</b> at every depth level. Takers get filled by the corridor first while it is strictly better, then by the AMM.</p>
        <div class="xa-pool" data-k="pool">Loading reference pool…</div>
      </div>
      <div class="card">
        <div class="xa-ctl">
          <div><label for="xa-imp">ImprovementBps <output data-k="impv">1 bp</output></label><input id="xa-imp" type="range" min="1" max="20" step="1" value="1"></div>
          <div><label for="xa-size">Taker order <output data-k="sizev">$10,000</output></label><input id="xa-size" type="range" min="0" max="100" step="1" value="${sliderFromSize(10000)}"></div>
          <div><label>Taker side</label><div class="xa-seg" data-k="side"><button type="button" data-v="buy" aria-pressed="true">Buys XRP</button><button type="button" data-v="sell" aria-pressed="false">Sells XRP</button></div></div>
          <div><label for="xa-sc">Scenario</label><select id="xa-sc"><option value="single">Single taker order</option><option value="flow">Seeded taker flow (40 orders)</option><option value="arb-burst">Arbitrage burst</option></select></div>
          <div data-k="seedbox" hidden><label for="xa-seed">Seed</label><input id="xa-seed" value="1313" maxlength="32"></div>
        </div>
      </div>
      <div class="xa-g2">
        <div class="card"><h3>1 · Depth: AMM vs corridor ladder ${SIM}</h3><div data-k="depth"></div>
          <div class="xa-leg"><span><i style="background:var(--accent)"></i>AMM marginal price (incl. fee)</span><span><i style="background:var(--live)"></i>Corridor ladder (AMM − ImprovementBps)</span><span><i style="background:var(--live);opacity:.3;height:10px"></i>consumed by this order</span></div></div>
        <div class="card"><h3>2 · Taker fill ${SIM}</h3><div data-k="fill"></div></div>
      </div>
      <div class="xa-g2 xa-sec">
        <div class="card"><h3>3 · Providers: fill priority = tenure ${SIM}</h3><div data-k="prov"></div></div>
        <div class="card"><h3>4 · TGLW Tier 2 early exit ${SIM}</h3><div data-k="exit"></div></div>
      </div>
      <div class="card xa-sec"><h3>5 · Arbitrage burst ${SIM}</h3>
        <div class="xa-ctl" style="margin-bottom:6px">
          <div><label>External price jump</label><div class="xa-seg" data-k="jump"><button type="button" data-v="3" aria-pressed="true">+3%</button><button type="button" data-v="8" aria-pressed="false">+8%</button><button type="button" data-v="-3" aria-pressed="false">−3%</button></div></div>
          <div><button type="button" class="primary" data-k="arbbtn" style="width:100%">▶ Run arbitrage burst</button></div>
        </div>
        <div data-k="arb"></div>
      </div>
      <p class="muted" style="font-size:12px" data-k="disc"></p>`;
    const $ = (k) => el.querySelector(`[data-k="${k}"]`);
    const imp = el.querySelector('#xa-imp'), size = el.querySelector('#xa-size'), sc = el.querySelector('#xa-sc'), seed = el.querySelector('#xa-seed');

    const syncControls = () => {
      imp.value = st.imp; size.value = sliderFromSize(st.size); sc.value = st.scenario;
      $('impv').textContent = `${st.imp} bp${st.imp > 1 ? 's' : ''}`; $('sizev').textContent = `$${f0(st.size)}`;
      for (const b of $('side').children) b.setAttribute('aria-pressed', String(b.dataset.v === st.side));
      for (const b of $('jump').children) b.setAttribute('aria-pressed', String(Number(b.dataset.v) === st.jump));
      $('seedbox').hidden = st.scenario !== 'flow';
    };
    const schedule = (ms = 160) => { clearTimeout(debounce); debounce = setTimeout(load, ms); };
    imp.oninput = () => { st.imp = Number(imp.value); syncControls(); schedule(); };
    size.oninput = () => { st.size = sizeFromSlider(Number(size.value)); syncControls(); schedule(); };
    sc.onchange = () => { st.scenario = sc.value; st.arb = st.scenario === 'arb-burst'; syncControls(); schedule(0); };
    seed.onchange = () => { st.seed = seed.value.replace(/[^\w-]/g, '').slice(0, 32) || '1313'; schedule(0); };
    $('side').onclick = (e) => { const b = e.target.closest('button[data-v]'); if (b) { st.side = b.dataset.v; syncControls(); schedule(0); } };
    $('jump').onclick = (e) => { const b = e.target.closest('button[data-v]'); if (b) { st.jump = Number(b.dataset.v); syncControls(); schedule(0); } };
    $('arbbtn').onclick = () => { st.arb = true; if (data) renderArb(true); };

    async function load() {
      const my = ++seq;
      const q = new URLSearchParams({ size: st.size, improvementBps: st.imp, side: st.side, scenario: st.scenario, seed: st.seed, jumpPct: st.jump, exitDay: st.exitDay });
      try {
        const d = await api.get(`/api/xdlc-amm/simulate?${q}`);
        if (my !== seq) return;
        data = d; render();
      } catch (e) { if (my === seq) $('fill').innerHTML = `<p class="err">Simulation unavailable: ${esc(e.message)}</p>`; }
    }

    function render() {
      renderPool(); renderDepth(); renderFill(); renderProviders(); renderExit(); renderArb(st.arb);
      $('disc').textContent = (data.disclaimers || []).join(' ');
    }

    function renderPool() {
      const r = data.reference || {}, p = r.pool || {};
      const when = r.observedAt ? new Date(r.observedAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : null;
      const tag = r.label === 'ILLUSTRATIVE' ? '<span class="badge bad">ILLUSTRATIVE</span>' : badge(r.mode);
      $('pool').innerHTML = `${tag}<span>Reference: Mainnet XRP/RLUSD AMM</span>
        <span><b>${f0(p.xrp)}</b> XRP</span><span><b>${f0(p.rlusd)}</b> RLUSD</span><span>fee <b>${f2((p.feeBps ?? p.tradingFee / 10) / 100, 3)}%</b></span>
        <span>mid <b>${f2(data.inputs.pool.mid, 4)}</b></span>${r.ledgerIndex ? `<span>ledger <b>${f0(r.ledgerIndex)}</b></span>` : ''}${when ? `<span>${esc(r.freshness === 'live' ? 'read' : 'cached')} ${esc(when)}</span>` : ''}
        ${r.note ? `<span class="muted">${esc(r.note)}</span>` : ''}`;
    }

    // (1) Depth chart: x = cumulative depth (USD), y = taker cost vs AMM mid (bps).
    function renderDepth() {
      const W = 560, H = 250, pl = 40, pr = 22, pt = 24, pb = 30;
      // Zoom to the order: at least 3 levels, about 1.6x the order size, at most the whole ladder.
      const full = data.ladder.levelUsd * data.ladder.levels.length;
      const maxX = Math.min(full, Math.max(data.ladder.levelUsd * 3, data.params.sizeUsd * 1.6));
      const P = data.inputs.pool, fz = P.feeBps / 1e4, midP = P.rlusd / P.xrp, buy = data.params.side === 'buy';
      const marg = (q) => (buy ? (P.xrp * P.rlusd) / ((P.xrp - q) ** 2 * (1 - fz)) : (P.xrp * P.rlusd * (1 - fz)) / (P.xrp + q * (1 - fz)) ** 2);
      const cost = (pr2) => (buy ? pr2 / midP - 1 : 1 - pr2 / midP) * 1e4;
      const d = { amm: Array.from({ length: 81 }, (_, k) => { const u = (maxX * k) / 80; return { depthUsd: u, bps: cost(marg(u / midP)) }; }),
        corridor: data.depth.corridor.filter((c) => c.fromUsd < maxX - 1e-6).map((c) => ({ ...c, toUsd: Math.min(c.toUsd, maxX) })) };
      const ys = [...d.amm.map((p) => p.bps), ...d.corridor.map((c) => c.bps)];
      const gs = Math.max(...ys) > 200 ? 50 : Math.max(...ys) > 80 ? 20 : 10;
      const y0 = Math.min(0, Math.floor(Math.min(...ys) / gs) * gs), y1 = Math.ceil(Math.max(...ys) / gs) * gs || gs;
      const X = (v) => pl + (v / maxX) * (W - pl - pr), Y = (v) => pt + (1 - (v - y0) / (y1 - y0)) * (H - pt - pb);
      const mid = data.inputs.pool.mid;
      const qa = data.route.ammQtyXrp * mid;
      const used = new Set(data.route.legs.filter((l) => l.venue === 'corridor').map((l) => l.level));
      const ammPath = d.amm.map((p, i) => `${i ? 'L' : 'M'}${X(p.depthUsd).toFixed(1)},${Y(p.bps).toFixed(1)}`).join('');
      const steps = d.corridor.map((c) => `M${X(c.fromUsd).toFixed(1)},${Y(c.bps).toFixed(1)}H${X(c.toUsd).toFixed(1)}`).join('');
      const fills = d.corridor.filter((c) => used.has(c.level)).map((c) => `<rect x="${X(c.fromUsd).toFixed(1)}" y="${Y(c.bps).toFixed(1)}" width="${(X(c.toUsd) - X(c.fromUsd)).toFixed(1)}" height="${(Y(y0) - Y(c.bps)).toFixed(1)}" fill="var(--live)" opacity=".18"/>`).join('');
      const ammShade = qa > 0 ? (() => { const pts = d.amm.filter((p) => p.depthUsd <= qa); const last = pts[pts.length - 1]; return pts.length > 1 ? `<path d="M${X(0)},${Y(y0)}${pts.map((p) => `L${X(p.depthUsd).toFixed(1)},${Y(p.bps).toFixed(1)}`).join('')}L${X(last.depthUsd).toFixed(1)},${Y(y0)}Z" fill="var(--accent)" opacity=".12"/>` : ''; })() : '';
      const yt = []; const ys2 = (y1 - y0) / gs > 6 ? gs * 2 : gs; for (let v = y0; v <= y1; v += ys2) yt.push(v);
      const xt = [0, 0.25, 0.5, 0.75, 1].map((k) => k * maxX);
      $('depth').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="AMM marginal price curve and corridor ladder, in basis points versus AMM mid, against cumulative depth">
        ${yt.map((v) => `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${pl - 4}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
        ${xt.map((v) => `<text x="${X(v)}" y="${H - 12}" text-anchor="middle">${kUsd(v)}</text>`).join('')}
        <text x="${W - pr}" y="${H - 1}" text-anchor="end">cumulative depth (USD) →</text><text x="${pl - 34}" y="10">bps vs mid (taker cost)</text>
        ${ammShade}${fills}
        <path d="${ammPath}" fill="none" stroke="var(--accent)" stroke-width="2.2"/>
        <path d="${steps}" fill="none" stroke="var(--live)" stroke-width="2.6"/>
      </svg>
      <p class="xa-note">Showing the first ${kUsd(maxX)} of depth. Level width ${kUsd(data.ladder.levelUsd)}. Each corridor level is priced at the AMM's marginal price at the start of its band minus ${data.params.improvementBps} bp, so every corridor unit beats every AMM unit in that band.</p>`;
    }

    // (2) Taker fill: animated legs + big savings number.
    function renderFill() {
      clearAnim();
      const r = data.route, s = data.savings, mid = data.inputs.pool.mid;
      const total = r.qtyXrp || 1;
      const legs = r.legs.map((l, i) => `<i class="${l.venue === 'corridor' ? 'c' : 'a'}" data-w="${((l.qtyXrp / total) * 100).toFixed(2)}" title="${l.venue === 'corridor' ? `Corridor L${l.level}` : 'AMM'}: $${f0(l.qtyXrp * mid)} @ ${f2(l.price, 5)}"></i>`).join('');
      const fl = data.flow;
      $('fill').innerHTML = `
        <div class="muted" style="font-size:13px">Taker ${data.params.side === 'buy' ? 'buys' : 'sells'} $${f0(data.params.sizeUsd)} of XRP (${f0(data.params.sizeXrp)} XRP)</div>
        <div class="xa-big" data-k="big">saves ${f2(s.savedBps, 1)} bps <small>· ${usd(s.savedRlusd)} modeled</small></div>
        <div class="xa-split">
          <div><b>${f2(s.fromImprovementBps, 1)} bps · ${usd(s.fromImprovementRlusd)}</b> price improvement from the corridor rule (${data.params.improvementBps} bp on corridor fills)</div>
          <div><b>${f2(s.fromAddedDepthBps, 1)} bps · ${usd(s.fromAddedDepthRlusd)}</b> extra depth from illustrative providers <i>(amounts are hypothetical)</i></div>
        </div>
        <div class="muted" style="font-size:12px">vs AMM-only ${usd(s.ammOnly.amountRlusd)} (avg ${f2(s.ammOnly.effPrice, 5)}). Not guaranteed: savings scale with how much liquidity providers actually commit; only the improvement part follows from the rule itself.</div>
        <div class="xa-bar" data-k="bar">${legs}</div>
        <div class="xa-leg"><span><i style="background:var(--live)"></i>corridor ${f2((r.corridorQtyXrp / total) * 100, 0)}%</span><span><i style="background:var(--accent);opacity:.55"></i>AMM ${f2((r.ammQtyXrp / total) * 100, 0)}%</span><span>${r.legs.length} legs, in fill order</span>${r.unfilledXrp > 1e-6 ? `<span class="err">unfilled ${f0(r.unfilledXrp)} XRP</span>` : ''}</div>
        <div class="xa-sizes">${data.sizes.map((z) => `<div>${kUsd(z.sizeUsd)}<b>${f2(z.savedBps, 1)} bps</b><span title="rule improvement + illustrative extra depth">${f2(z.fromImprovementBps, 1)} + ${f2(z.fromAddedDepthBps, 1)}</span></div>`).join('')}</div>
        <p class="xa-note">Per size: total = rule improvement + illustrative extra depth (bps).</p>
        ${fl ? `<div class="xa-fee" style="margin-top:10px">Seeded day (seed ${esc(fl.seed)}, ${fl.orders.length} orders): takers save ${f2(fl.takerSavedBps, 1)} bps · ${usd(fl.takerSavedRlusd)} in total</div>` : ''}`;
      const bars = [...$('bar').children];
      const step = Math.max(60, Math.min(260, 1600 / Math.max(1, bars.length)));
      bars.forEach((b, i) => animTimers.push(setTimeout(() => { b.style.width = `${b.dataset.w}%`; }, 40 + i * step)));
    }

    // (3) Provider stack: tenure bars, who got filled (tenure priority), modeled earnings.
    function renderProviders() {
      const rows = data.providers.rows, fl = data.flow;
      const maxT = Math.max(1, ...rows.map((r) => r.tenureDays));
      const earn = fl ? new Map(fl.providerEarnings.map((p) => [p.id, p.spreadCapturedRlusd])) : null;
      $('prov').innerHTML = `<div class="xa-prov">${rows.map((r) => {
        const kind = r.kind;
        const fillPct = r.offeredXrp > 0 ? (r.filledXrp / r.offeredXrp) * 100 : 0;
        const e = earn ? earn.get(r.id) : r.spreadCapturedRlusd;
        return `<div class="xa-pr${r.filledXrp > 0 ? ' hit' : ''}">
          <span class="rk">#${r.priority}</span>
          <span class="nm">${esc(r.name)} <span>· MinRate ${r.minRateBps} bps · max $${f0(r.maxPerLevelUsd)}/level</span></span>
          <span class="er" title="modeled spread captured vs AMM mid">${usd(e)}</span>
          <span class="bars"><span>tenure ${r.tenureDays}d</span><span class="xa-track"><i class="k-${kind}" style="width:${((r.tenureDays / maxT) * 100).toFixed(1)}%"></i></span>
          <span>filled</span><span class="xa-track"><i class="k-${kind}" style="width:${fillPct.toFixed(1)}%"></i></span></span></div>`;
      }).join('')}</div>
      <p class="xa-note">At each level the oldest provider fills first, up to its MaxPerLevel. Earnings = modeled spread vs AMM mid ${fl ? 'over the seeded day' : 'for this order'}; inventory risk is shown in the arbitrage panel. Providers and amounts are illustrative.</p>`;
    }

    // (4) Early exit: Tier 2 provider exits at day N of 90 -> prorated fee -> stayers by tenure.
    function renderExit() {
      const x = data.exit; if (!x) { $('exit').innerHTML = '<p class="muted">No Tier 2 provider in this set.</p>'; return; }
      const maxS = Math.max(...x.distribution.shares.map((s) => s.shareUsd), 1e-9);
      $('exit').innerHTML = `
        <label for="xa-exit">${esc(x.exiting.name)} exits at day <output>${x.exitDay}</output> of ${x.termDays}</label>
        <input id="xa-exit" type="range" min="0" max="${x.termDays}" value="${x.exitDay}">
        <div class="xa-time"><i style="width:${((x.exitDay / x.termDays) * 100).toFixed(1)}%"></i><b style="left:calc(${((x.exitDay / x.termDays) * 100).toFixed(1)}% - 1px)"></b></div>
        <div class="xa-ticks"><span>day 0 · corridor activation (term clock starts)</span><span>day ${x.termDays}</span></div>
        <div class="xa-fee">fee = $${f0(x.withdrawnUsd)} × ${f2(x.exitFeeBps / 100)}% × ${x.remainingDays}/${x.termDays} = <span style="color:var(--bad)">${usd(x.feeUsd)}</span></div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px">Paid only to providers who stay, weighted by tenure (sum ${usd(x.distribution.distributedUsd)}):</div>
        ${x.distribution.shares.map((s) => `<div class="xa-var"><span>${esc(s.name)} <span class="muted">${s.tenureDays}d</span></span><span class="xa-track"><i class="k-${s.kind}" style="width:${((s.shareUsd / maxS) * 100).toFixed(1)}%"></i></span><b>${usd(s.shareUsd)}</b></div>`).join('')}`;
      const r = el.querySelector('#xa-exit');
      r.oninput = () => { r.previousElementSibling.querySelector('output').textContent = r.value; };
      r.onchange = () => { st.exitDay = Number(r.value); schedule(0); };
    }

    // (5) Arbitrage burst: corridor absorbs the first part. No oracle in the protocol: on-ledger MinRate is static, the
    // protocol protection is the AMM-based volatility pause; the third bar adds a provider's own off-ledger software.
    function renderArb(play) {
      const a = data.arbitrage, v = a.variants, sw = v.pauseSoftware;
      const maxL = Math.max(1e-9, ...Object.values(v).map((x) => x.corridorMtmLossRlusd));
      const row = (label, x) => `<div class="xa-var"><span>${label}</span><span class="xa-track"><i style="width:${play ? ((x.corridorMtmLossRlusd / maxL) * 100).toFixed(1) : 0}%;background:var(--bad)"></i></span><b>${play ? usd(x.corridorMtmLossRlusd) : '—'}</b></div>`;
      const cells = sw.steps.map((s) => `<span class="${s.paused ? 'p' : s.corridorXrp > 1e-9 ? 'c' : 'a'}" title="step ${s.step + 1}: ${s.paused ? 'protocol pause' : s.corridorXrp > 1e-9 ? `corridor filled ${f0(s.corridorXrp * sw.mid0)} USD` : 'AMM only (provider software had raised MinRate)'}; AMM moved ${f2(s.moveBps, 0)} bps"></span>`).join('');
      $('arb').innerHTML = `
        <p style="margin:0 0 6px;font-size:13px">External XRP price jumps <b>${sw.jumpPct > 0 ? '+' : ''}${sw.jumpPct}%</b>. An arbitrageur trades until the AMM matches. The corridor re-pegs to the AMM before each step, so it absorbs the first part and is marked to market at the new price.</p>
        <div class="xa-steps" data-k="steps">${cells}</div>
        <div class="xa-leg"><span><i style="background:var(--live)"></i>corridor filled</span><span><i style="background:var(--accent)"></i>AMM only (provider software raised its MinRate)</span><span><i style="background:var(--bad)"></i>protocol pause (AMM moved &gt; ${sw.pauseBps} bps)</span></div>
        <div style="margin-top:8px;font-size:12px;color:var(--muted)">Corridor mark-to-market loss:</div>
        ${row('Unprotected', v.none)}${row('Protocol pause', v.pause)}${row('Pause + provider software <span class="muted">(off-ledger, e.g. Titan Ghost)</span>', sw)}
        <p class="xa-note">${play ? `Protocol pause cuts the loss by ${f2(a.pauseCut * 100, 0)}%; with the provider's own software ${f2(a.pauseSoftwareCut * 100, 0)}%. ` : 'Press ▶ Run arbitrage burst. '}No oracle in the protocol: on-ledger, MinRate is a static worst acceptable price the provider set, and the protocol's own protection is the deterministic AMM-based volatility pause. The third bar is the provider's own off-ledger software (e.g. Titan Ghost's proprietary risk engine) updating its MinRate by transaction ${sw.providerUpdateLagSteps} step after the jump; that is provider behaviour, not a protocol feature.</p>`;
      if (play) {
        const sp = [...$('steps').children];
        sp.forEach((c, i) => animTimers.push(setTimeout(() => c.classList.add('on'), 120 + i * 220)));
      }
    }

    // Presentation: 20 s scripted sequence.
    function demo() {
      demoTimers.forEach(clearTimeout); demoTimers = [];
      api.show('xdlc-amm');
      const at = (ms, fn) => demoTimers.push(setTimeout(fn, ms));
      Object.assign(st, { imp: 1, size: 1000, side: 'buy', scenario: 'single', arb: false, jump: 3, exitDay: 45 }); syncControls(); schedule(0);
      [3000, 10000, 25000, 50000].forEach((s, i) => at(1500 + i * 1500, () => { st.size = s; syncControls(); schedule(0); }));
      at(7500, () => { $('big')?.classList.add('xa-pulse'); });
      at(9500, () => { $('prov').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('prov').closest('.card').classList.add('xa-pulse'); });
      at(12500, () => { $('exit').closest('.card').classList.add('xa-pulse'); });
      at(15000, () => { $('arb').scrollIntoView({ behavior: 'smooth', block: 'center' }); st.arb = true; if (data) renderArb(true); });
      at(20000, () => { el.querySelectorAll('.xa-pulse').forEach((n) => n.classList.remove('xa-pulse')); });
    }
    if (window.__tfXdlcAmmPresent) window.removeEventListener('tf:present', window.__tfXdlcAmmPresent);
    window.__tfXdlcAmmPresent = (e) => { if (e?.detail?.scene === 'xdlc-amm') demo(); };
    window.addEventListener('tf:present', window.__tfXdlcAmmPresent);

    syncControls();
    await load();
  },
};
