// Titan Arena — Bootstrap Challenge. Guided educational game (SIMULATION), optionally linked to a
// real launched Testnet token whose on-ledger facts are shown as LIVE TESTNET.
import { MARKETS, PROFILES, TIERS, RINGS } from '/domain.js';

const CSS = `
.arena { --a-gap: 14px; }
.arena .arena-hero { display:flex; flex-wrap:wrap; gap:12px; align-items:center; justify-content:space-between; }
.arena .arena-hero h2 { font-size: clamp(18px, 2.4vw, 28px); margin:0; }
.arena .arena-lead { font-size: clamp(15px, 1.6vw, 19px); margin: 6px 0 0; }
.arena .arena-btn { min-height:52px; padding:12px 18px; font-size:clamp(15px,1.6vw,19px); border-radius:10px; }
.arena .arena-big { display:grid; gap:12px; grid-template-columns:repeat(auto-fit, minmax(min(100%, 200px), 1fr)); }
.arena .arena-opt { text-align:left; background:var(--bg); color:var(--ink); border:2px solid var(--line); border-radius:12px; padding:14px; font:inherit; cursor:pointer; min-height:72px; transition:border-color .15s, transform .15s; }
.arena .arena-opt:hover { border-color:var(--accent); }
.arena .arena-opt:active { transform:scale(.98); }
.arena .arena-opt[aria-pressed="true"] { border-color:var(--accent); background:color-mix(in srgb, var(--accent) 12%, var(--panel)); }
.arena .arena-opt b { display:block; font-size:clamp(15px,1.6vw,19px); }
.arena .arena-opt small { display:block; color:var(--muted); margin-top:4px; line-height:1.35; }
.arena .arena-opt.arena-trap small.arena-pitch { color:var(--ink); }
.arena .arena-steps { display:flex; gap:4px; margin:4px 0 8px; }
.arena .arena-steps span { flex:1; height:8px; border-radius:4px; background:var(--line); transition:background .3s; }
.arena .arena-steps span.done { background:var(--accent); }
.arena .arena-steps span.now { background:color-mix(in srgb, var(--accent) 55%, var(--line)); }
.arena .arena-stepname { font-size:13px; color:var(--muted); }
.arena .arena-row { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-top:12px; }
.arena .arena-dev { margin-top:12px; border-top:1px dashed var(--line); padding-top:8px; font-size:13px; }
.arena .arena-dev summary { cursor:pointer; color:var(--accent); font-weight:600; }
.arena .arena-dev code { font-family:var(--mono); font-size:12px; }
.arena .arena-depth { display:grid; gap:6px; margin:10px 0; }
.arena .arena-ring { display:grid; grid-template-columns:86px 1fr 92px; gap:8px; align-items:center; font-size:13px; }
.arena .arena-ring .arena-track { position:relative; height:22px; background:var(--bg); border:1px solid var(--line); border-radius:6px; overflow:hidden; }
.arena .arena-ring .arena-fill, .arena .arena-ring .arena-ghost { position:absolute; left:0; top:0; bottom:0; transition:width .7s cubic-bezier(.2,.8,.2,1); }
.arena .arena-ring .arena-fill { background:var(--accent); }
.arena .arena-ring .arena-ghost { background:repeating-linear-gradient(45deg, var(--bad) 0 4px, transparent 4px 8px); opacity:.45; }
.arena .arena-ring.off { opacity:.4; }
.arena .arena-stats { display:grid; gap:8px; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); margin:10px 0; }
.arena .arena-stat { background:var(--bg); border:1px solid var(--line); border-radius:10px; padding:8px 10px; }
.arena .arena-stat b { display:block; font-size:clamp(17px,2vw,24px); font-variant-numeric:tabular-nums; }
.arena .arena-stat span { font-size:12px; color:var(--muted); }
.arena .arena-event { padding:8px 10px; border-radius:8px; margin:6px 0; background:var(--sim-bg); color:var(--ink); border-left:4px solid var(--sim); }
.arena .arena-event.bad { background:var(--bad-bg); border-color:var(--bad); }
.arena .arena-check { display:flex; gap:10px; align-items:flex-start; padding:8px 0; border-bottom:1px solid var(--line); }
.arena .arena-check i { font-style:normal; font-weight:700; width:22px; text-align:center; }
.arena .arena-check.ok i { color:var(--live); } .arena .arena-check.no i { color:var(--bad); }
.arena .arena-score { font-size:clamp(44px,8vw,88px); font-weight:800; line-height:1; font-variant-numeric:tabular-nums; }
.arena .arena-bar { height:12px; background:var(--bg); border:1px solid var(--line); border-radius:6px; overflow:hidden; }
.arena .arena-bar > div { height:100%; background:var(--accent); width:0; transition:width .9s ease; }
.arena .arena-quiz { padding:10px 0; border-bottom:1px solid var(--line); }
.arena .arena-quiz .arena-big { grid-template-columns:repeat(auto-fit, minmax(min(100%, 150px), 1fr)); gap:8px; margin-top:6px; }
.arena .arena-quiz .arena-opt { min-height:52px; padding:10px; }
.arena .arena-cmp { overflow-x:auto; }
.arena .arena-cmp th, .arena .arena-cmp td { white-space:nowrap; }
.arena .arena-cmp td.good { color:var(--live); font-weight:600; } .arena .arena-cmp td.poor { color:var(--bad); font-weight:600; }
.arena .arena-facts { font-size:13px; }
.arena .arena-err { color:var(--bad); font-weight:600; min-height:1.2em; }
.arena .arena-pill { display:inline-block; padding:2px 8px; border-radius:999px; border:1px solid var(--line); font-size:12px; margin:2px; }
@media (max-width: 520px) { .arena .arena-ring { grid-template-columns:70px 1fr 70px; font-size:12px; } }
@media (prefers-reduced-motion: reduce) { .arena * { transition:none !important; } }
`;

const usd = (n) => (n == null ? '–' : '$' + Math.round(n).toLocaleString('en-US'));
const pct = (x) => (x == null ? '–' : Math.round(x * 100) + '%');
const prof = (id) => PROFILES.find((p) => p.id === id);
const tierLabel = (id) => TIERS.find((t) => t.id === id)?.label || id;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default {
  id: 'arena', title: 'Titan Arena', order: 60,
  async mount(el, api) {
    if (!document.getElementById('arena-style')) { const st = document.createElement('style'); st.id = 'arena-style'; st.textContent = CSS; document.head.append(st); }
    const E = api.esc, B = api.badge;
    el.innerHTML = `<div class="arena">
      <div class="card arena-hero">
        <div><h2>Titan Arena: Bootstrap Challenge ${B('SIMULATION')}</h2>
          <p class="arena-lead muted">Build a liquid market for a new token in about 4 minutes. You score points for informed decisions, verifiable participants and managing risk. Price going up earns nothing.</p></div>
        <div class="arena-row" style="margin:0"><button class="primary arena-btn" data-a="start">Start a game</button></div>
      </div>
      <div class="card" data-a="game" hidden></div>
      <div class="card"><h2>Leaderboard ${B('SIMULATION')}</h2><div data-a="board" class="muted">Loading…</div></div>
    </div>`;
    const root = el.querySelector('.arena'), game = root.querySelector('[data-a="game"]'), boardEl = root.querySelector('[data-a="board"]');
    let meta = null, s = null, busy = false, prevRings = {}, ui = {};

    const dev = (html) => `<details class="arena-dev"><summary>Developer detail</summary>${html}</details>`;
    const err = (m) => { const e = game.querySelector('.arena-err'); if (e) e.textContent = m || ''; };

    async function act(action) {
      if (busy) return; busy = true; err('');
      try { s = await api.post(`/api/arena/${s.id}/action`, action); render(); }
      catch (e) { err(e.message); }
      finally { busy = false; }
    }

    async function start() {
      try {
        meta = meta || (await api.get('/api/arena/meta'));
        s = await api.post('/api/arena/start', {});
        ui = { accept: new Set(), custom: [], flags: new Set(), answers: {} }; prevRings = {};
        game.hidden = false; render(); game.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { game.hidden = false; game.innerHTML = `<p class="err">Could not start: ${E(e.message)}</p>`; }
    }
    root.querySelector('[data-a="start"]').onclick = start;

    function header() {
      const i = s.stepIndex, n = s.steps.length;
      const p = s.project;
      const proj = p ? `<div class="arena-facts"><b>${E(p.code)}</b> ${E(p.name)} ${p.linked ? B('LIVE_TESTNET') + ' token' : B('SIMULATION') + ' token'}
        ${s.marketId ? ` · ${E(MARKETS.find((m) => m.id === s.marketId)?.label)}` : ''}${s.spoke ? ` · spoke ${usd(s.spoke.capitalUsd)} ${E(meta.spreads[s.spoke.spread].label)}` : ''}</div>` : '';
      return `<div class="arena-stepname">Step ${i + 1} of ${n}: <b>${E(s.steps[i].label)}</b> · seed <span class="mono">${E(s.seed)}</span></div>
        <div class="arena-steps" role="progressbar" aria-valuemin="1" aria-valuemax="${n}" aria-valuenow="${i + 1}">${s.steps.map((_, k) => `<span class="${k < i ? 'done' : k === i ? 'now' : ''}"></span>`).join('')}</div>${proj}`;
    }

    function render() {
      const fn = { project, market, spoke, recruit, observe, assess, promote, compare, quiz, debrief }[s.step];
      game.innerHTML = header() + `<div data-a="body"></div><p class="arena-err" role="alert"></p>`;
      fn(game.querySelector('[data-a="body"]'));
      animate();
    }
    function animate() {
      requestAnimationFrame(() => requestAnimationFrame(() => game.querySelectorAll('[data-w]').forEach((x) => { x.style.width = x.dataset.w; })));
    }

    // ---- 1. Project ----
    async function project(b) {
      b.innerHTML = `<h3>1 · Name your project token</h3>
        <p>Every market starts with a token. Invent one for this game, or use a real token you launched on XRPL Testnet.</p>
        <div class="grid">
          <form data-a="nf"><h3>Invent a token ${B('SIMULATION')}</h3>
            <label>Project name</label><input name="name" maxlength="40" placeholder="e.g. Harbour Coffee Club" required>
            <label>Ticker (3 letters or digits)</label><input name="code" maxlength="3" placeholder="HCC" required>
            <label>Category</label><select name="category"><option value="community">Community / Gaming</option><option value="currency">Currency / Payments</option><option value="securities">Illustrative Securities</option><option value="real_estate">Illustrative Real Estate</option><option value="precious_metals">Illustrative Precious Metals</option></select>
            <div class="arena-row"><button class="primary arena-btn">Use this name</button></div>
            <p class="muted" style="font-size:13px">Same rules as a real launch: no brand names, no reserved tickers, no backing claims.</p>
          </form>
          <div><h3>Use my live Testnet token ${B('LIVE_TESTNET')}</h3><div data-a="live" class="muted">Loading launched tokens…</div>
            <div class="arena-row"><button class="ghost arena-btn" data-a="golaunch">Launch a real token first →</button></div></div>
        </div>
        ${dev(`<p>A real launch runs <code>TrustSet</code> (holder opts in to the issuer's token), then <code>Payment</code> (issuer issues supply), then <code>OfferCreate</code> (bid and ask). All are signed transactions validated by XRPL consensus. Linking shows those hashes as ${B('LIVE_TESTNET')}; the game around them stays ${B('SIMULATION')}.</p>`)}`;
      b.querySelector('[data-a="nf"]').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); act({ type: 'name', name: f.get('name'), code: String(f.get('code')).toUpperCase(), category: f.get('category') }); };
      b.querySelector('[data-a="golaunch"]').onclick = () => api.show('launch');
      const live = (await api.get('/api/launches').catch(() => [])).filter((l) => l.status === 'live');
      const box = b.querySelector('[data-a="live"]'); if (!box) return;
      box.innerHTML = live.length ? `<div class="arena-big">${live.slice().reverse().slice(0, 8).map((l) => `<button class="arena-opt" data-l="${E(l.id)}"><b>${E(l.code)}</b><small>${E(l.name)} · issued on Testnet</small></button>`).join('')}</div>`
        : '<p>No live tokens yet.</p>';
      box.querySelectorAll('[data-l]').forEach((x) => x.onclick = () => act({ type: 'link', launchId: x.dataset.l }));
    }

    function linkedFacts() {
      const L = s.project?.linked; if (!L) return '';
      const bk = L.book || {};
      return `<div class="arena-event" style="background:var(--live-bg);border-color:var(--live)">${B('LIVE_TESTNET')} <b>${E(L.code)}</b> facts from XRPL Testnet:
        ${L.txs.length} validated transactions · issuer <span class="mono">${E(L.issuer)}</span> · book ${(bk.asks || []).length} asks / ${(bk.bids || []).length} bids ${B(L.bookMode)}
        ${L.fillHash ? `· fill <a class="mono" target="_blank" rel="noopener" href="https://testnet.xrpl.org/transactions/${E(L.fillHash)}">${E(L.fillHash.slice(0, 12))}…</a>` : ''}
        <div class="muted" style="font-size:12px">The launch fill came from a demo counterparty: it proves mechanics, not organic demand. Everything else in this game is ${B('SIMULATION')}.</div></div>`;
    }

    // ---- 2. Market ----
    function market(b) {
      b.innerHTML = `${linkedFacts()}<h3>2 · Pick a market for your spoke</h3><p>Your token will trade against XRP. Each market has a different reference price and typical flow.</p>
        <div class="arena-big">${MARKETS.map((m) => `<button class="arena-opt" data-m="${m.id}"><b>${E(m.label)}</b><small>Reference asset ${E(m.demoAsset)} · ref price ${m.refPriceXrp} XRP</small></button>`).join('')}</div>
        ${dev('<p>Pairing every token with XRP lets the XRPL payment engine <b>auto-bridge</b> through XRP: TOKEN→XRP→OTHER in one Payment or OfferCreate. That is an existing XRPL feature, no amendment needed.</p>')}`;
      b.querySelectorAll('[data-m]').forEach((x) => x.onclick = () => act({ type: 'market', marketId: x.dataset.m }));
    }

    // ---- 3. Spoke ----
    function spoke(b) {
      ui.cap = ui.cap || null; ui.spread = ui.spread || null;
      const draw = () => {
        b.innerHTML = `<h3>3 · Open the initial XRP spoke ${B('SIMULATION')}</h3>
          <p>Choose how much capital you quote with and how wide your spread is. Too little capital means trades move the price. Too much just sits idle.</p>
          <label>Starting capital (simulated)</label>
          <div class="arena-big">${meta.capitalOptions.map((c) => `<button class="arena-opt" data-c="${c}" aria-pressed="${ui.cap === c}"><b>${usd(c)}</b><small>${c <= 1000 ? 'Shoestring: a typical order may not fit' : c <= 10000 ? 'Lean start' : c <= 100000 ? 'Solid base' : 'Heavy: watch for idle capital'}</small></button>`).join('')}</div>
          <label>Spread width</label>
          <div class="arena-big">${Object.entries(meta.spreads).map(([k, v]) => `<button class="arena-opt" data-s="${k}" aria-pressed="${ui.spread === k}"><b>${E(v.label)} · ${E(v.bps)}</b><small>${E(v.tradeoff)} Uses ${v.ringsActive} of 6 rings.</small></button>`).join('')}</div>
          <div class="arena-row"><button class="primary arena-btn" data-a="go" ${ui.cap && ui.spread ? '' : 'disabled'}>Open spoke</button></div>
          ${dev(`<p>Each quote is an <code>OfferCreate</code> resting in the XRP/TOKEN order book. Every offer and trustline is a ledger object that raises the owner's XRP <b>reserve</b> (base reserve plus an owner reserve per object; check <code>server_info</code> for current values). The six rings (${RINGS.map((r) => `${r.id} ${r.spreadBps} bps`).join(', ')}) are Titan Ghost strategy, shown here by the ${E(s.engineLabel)}.</p>`)}`;
        b.querySelectorAll('[data-c]').forEach((x) => x.onclick = () => { ui.cap = Number(x.dataset.c); draw(); });
        b.querySelectorAll('[data-s]').forEach((x) => x.onclick = () => { ui.spread = x.dataset.s; draw(); });
        b.querySelector('[data-a="go"]').onclick = () => act({ type: 'spoke', capitalUsd: ui.cap, spread: ui.spread });
      };
      draw();
    }

    function guardianLine() {
      const g = s.guardian[s.guardian.length - 1]; if (!g) return '';
      return `<p class="muted" style="font-size:13px">Guardian: <b style="color:${g.allowed ? 'var(--live)' : 'var(--bad)'}">${g.allowed ? 'allowed' : 'blocked'}</b> · ${E(g.label)} ${B(g.mode)}</p>`;
    }

    // ---- 4. Recruit ----
    function recruit(b) {
      const sp = s.spoke.preview;
      const draw = () => {
        const n = ui.accept.size + ui.custom.length;
        b.innerHTML = `${guardianLine()}<div class="arena-event">Your spoke ${B('SIMULATION')}: ${usd(sp.deployedUsd)} working, ${usd(sp.idleUsd)} idle, a ${usd(meta.refTradeUsd)} order moves price ${sp.typicalImpactBps == null ? '<b>more than your book can fill</b>' : sp.typicalImpactBps + ' bps'}.</div>
          <h3>4 · Recruit liquidity providers</h3><p>These offers arrived. Pick up to ${meta.maxLps} in total. Read carefully: not every offer is what it seems.</p>
          <div class="arena-big">${s.scenario.offers.map((o) => {
            const p = prof(o.profileId);
            const sub = o.kind === 'genuine' ? `${E(p.label)} · ${usd(o.capitalUsd)} · ${E(tierLabel(o.tier))}` : o.kind === 'pledge' ? `Claims ${usd(o.claimedUsd)} of depth` : 'Promises volume';
            return `<button class="arena-opt ${o.kind !== 'genuine' ? 'arena-trap' : ''}" data-o="${o.id}" aria-pressed="${ui.accept.has(o.id)}"><b>${E(sub)}</b><small class="arena-pitch">"${E(o.pitch)}"</small></button>`;
          }).join('')}</div>
          <label>Or simulate your own LP (up to ${meta.maxCustom})</label>
          <div class="arena-row" style="margin-top:0"><select data-a="cp" style="flex:2;min-width:160px">${PROFILES.map((p) => `<option value="${p.id}">${E(p.label)} · ${usd(p.capitalUsd)}</option>`).join('')}</select>
            <select data-a="ct" style="flex:1;min-width:120px">${TIERS.map((t) => `<option value="${t.id}">${E(t.id)}</option>`).join('')}</select>
            <button class="ghost arena-btn" data-a="add" ${ui.custom.length >= meta.maxCustom || n >= meta.maxLps ? 'disabled' : ''}>Add</button></div>
          <div>${ui.custom.map((c, i) => `<span class="arena-pill">${E(prof(c.profileId).label)} · ${E(c.tier)} <a href="#" data-rm="${i}" aria-label="remove">✕</a></span>`).join('')}</div>
          <p class="muted" style="font-size:13px">${TIERS.map((t) => `<b>${E(t.id)}</b> ${E(t.route)}`).join(' · ')}. Tier is how capital is committed, independent of size.</p>
          <div class="arena-row"><button class="primary arena-btn" data-a="go">Continue with ${n} LP${n === 1 ? '' : 's'}</button></div>
          ${dev(`<p><b>Verifiable participation:</b> an LP who signs their own <code>OfferCreate</code> from their own account can be checked by anyone with <code>account_offers</code> and <code>book_offers</code>. <b>Unfunded offers:</b> XRPL lets an offer sit in the book even if its owner's balance can't cover it; it is skipped or removed when crossed, so it is not real depth. <b>Wash trading:</b> two accounts you control trading with each other produce real, validated fills that prove nothing about demand.</p>`)}`;
        b.querySelectorAll('[data-o]').forEach((x) => x.onclick = () => { const id = x.dataset.o; if (ui.accept.has(id)) ui.accept.delete(id); else if (n < meta.maxLps) ui.accept.add(id); draw(); });
        b.querySelector('[data-a="add"]').onclick = () => { ui.custom.push({ profileId: b.querySelector('[data-a="cp"]').value, tier: b.querySelector('[data-a="ct"]').value }); draw(); };
        b.querySelectorAll('[data-rm]').forEach((x) => x.onclick = (e) => { e.preventDefault(); ui.custom.splice(Number(x.dataset.rm), 1); draw(); });
        b.querySelector('[data-a="go"]').onclick = () => act({ type: 'recruit', accept: [...ui.accept], custom: ui.custom });
      };
      draw();
    }

    // Depth bars (animated from the previous round's widths).
    function depth(rings, key = 'live', ringsActive = 6) {
      const max = Math.max(1, ...rings.map((r) => Math.max(r.allocUsd, r.shownUsd ?? 0)));
      const html = `<div class="arena-depth">${rings.map((r, i) => {
        const w = (100 * r.allocUsd) / max, gw = (100 * Math.max(0, (r.shownUsd ?? r.allocUsd))) / max;
        const k = `${key}:${r.id}`; const from = prevRings[k] ?? 0, gfrom = prevRings[k + 'g'] ?? 0; prevRings[k] = w; prevRings[k + 'g'] = gw;
        return `<div class="arena-ring ${r.active === false || i >= ringsActive ? 'off' : ''}"><span class="mono">${r.id}</span>
          <div class="arena-track"><div class="arena-ghost" style="width:${gfrom}%" data-w="${gw}%"></div><div class="arena-fill" style="width:${from}%" data-w="${w}%"></div></div>
          <span class="mono" style="text-align:right">${usd(r.allocUsd)}</span></div>`;
      }).join('')}</div>`;
      return html;
    }

    // ---- 5. Observe ----
    function observe(b) {
      const last = s.rounds[s.rounds.length - 1];
      const evs = [];
      if (last) {
        if (last.shock) evs.push([`Shock! A ${usd(last.tradeUsd)} block trade hit the book: ${last.exhausted ? `only ${pct(last.fillRatio)} could fill` : `absorbed at ${last.impactBps} bps`}.`, last.exhausted]);
        if (last.withdrawnLps.length) evs.push([`${last.withdrawnLps.length} Tier 1 LP${last.withdrawnLps.length > 1 ? 's' : ''} pulled liquidity during the stress.`, true]);
        if (last.phantomDepthUsd) evs.push([`${usd(last.phantomDepthUsd)} of pledged depth showed in the book, then vanished when crossed (striped bars).`, true]);
        if (last.washFills) evs.push([`Explorers show ${usd(last.displayedVolumeUsd)} volume, but ${usd(last.washVolumeUsd)} of it is wash trading.`, true]);
        if (last.idleUsd > 0) evs.push([`${usd(last.idleUsd)} is idle: marginal yield fell below the hurdle.`, false]);
      }
      const done = s.rounds.length;
      b.innerHTML = `<h3>5 · Watch trading ${B('SIMULATION')} <span class="muted" style="font-weight:400">round ${done} of ${meta.rounds}</span></h3>
        <p class="muted" style="font-size:13px">Depth per ring from the ${E(s.engineLabel)}. Each round is one simulated day, reproducible from seed ${E(s.seed)}.</p>
        ${last ? depth(last.rings, 'obs', s.spoke.ringsActive) : depth(RINGS.map((r, i) => ({ id: r.id, allocUsd: 0, active: i < s.spoke.ringsActive })), 'obs', s.spoke.ringsActive)}
        ${last ? `<div class="arena-stats">
          <div class="arena-stat"><b>${last.impactBps == null ? 'unfilled' : last.impactBps + ' bps'}</b><span>impact of ${usd(last.tradeUsd)} ${last.shock ? 'block' : 'order'}</span></div>
          <div class="arena-stat"><b>${last.fills}</b><span>independent fills</span></div>
          <div class="arena-stat"><b>${usd(last.deployedUsd)}</b><span>capital working</span></div>
          <div class="arena-stat"><b>${usd(last.idleUsd)}</b><span>capital idle</span></div>
          <div class="arena-stat"><b>${last.marginalBps.toFixed(2)}</b><span>marginal yield, bps/day</span></div>
          <div class="arena-stat"><b>${last.midXrp.toPrecision(4)}</b><span>sim mid, XRP (not scored)</span></div></div>` : '<p>Press play to run the first trading day.</p>'}
        ${evs.map(([t, bad]) => `<div class="arena-event ${bad ? 'bad' : ''}">${E(t)}</div>`).join('')}
        <div class="arena-row"><button class="primary arena-btn" data-a="one">${done ? 'Next round' : 'Play round 1'}</button><button class="ghost arena-btn" data-a="all">Play all</button></div>
        ${dev('<p>Simulated takers send <code>OfferCreate</code> with <code>tfImmediateOrCancel</code>: cross what is there, cancel the rest. Nothing rests in the book. Impact = spread of the outermost ring the order reaches. If it runs out of depth, the remainder goes unfilled. On a real ledger each crossing is visible in transaction metadata.</p>')}`;
      b.querySelector('[data-a="one"]').onclick = () => act({ type: 'round' });
      b.querySelector('[data-a="all"]').onclick = async () => {
        while (s.step === 'observe') {
          const before = s.rounds.length;
          await act({ type: 'round' });
          if (s.step !== 'observe' || s.rounds.length === before) break; // finished, or the request failed
          await sleep(700);
        }
      };
    }

    // ---- 6. Assess ----
    function assess(b) {
      const m = s.metrics, iss = s.issuerInfo;
      const draw = () => {
        b.innerHTML = `<h3>6 · Spot the risks</h3><p>Here are the facts from your market. Flag every risk you see. Flagging unfunded depth or wash activity also removes it from your evidence.</p>
          <div class="arena-stats">
            <div class="arena-stat"><b>${pct(m.maxShare)}</b><span>largest participant's share</span></div>
            <div class="arena-stat"><b>${usd(m.pledgedUsd)}</b><span>pledged depth with no funds</span></div>
            <div class="arena-stat"><b>${m.washFills}</b><span>fills between linked accounts</span></div>
            <div class="arena-stat"><b>${iss.flags.length ? E(iss.flags.length + ' setting' + (iss.flags.length > 1 ? 's' : '')) : 'none'}</b><span>issuer control settings</span></div>
            <div class="arena-stat"><b>${pct(m.idlePct)}</b><span>capital idle (avg)</span></div>
            <div class="arena-stat"><b>${m.medianImpactBps >= 10000 ? 'unfilled' : m.medianImpactBps + ' bps'} / ${pct(m.shockFillRatio)}</b><span>typical impact / block filled</span></div>
          </div>
          ${iss.flags.length ? `<p class="muted" style="font-size:13px">Issuer: ${iss.flags.map(E).join('; ')}. ${E(iss.note)}</p>` : ''}
          <label>Which risks are present?</label>
          <div class="arena-big">${meta.risks.map((r) => `<button class="arena-opt" data-f="${r.id}" aria-pressed="${ui.flags.has(r.id)}"><b>${E(r.label)}</b><small>${E(r.hint)}</small></button>`).join('')}</div>
          <label>Economic efficiency: average marginal yield ${m.lastMarginalBps?.toFixed(2)} bps/day, ${usd(m.avgDailyEarnUsd)}/day earned on ${usd(m.totalCapitalUsd)}. What now?</label>
          <div class="arena-big">${Object.entries(meta.efficiency).map(([k, v]) => `<button class="arena-opt" data-e="${k}" aria-pressed="${ui.eff === k}"><b>${E(v)}</b></button>`).join('')}</div>
          <div class="arena-row"><button class="primary arena-btn" data-a="go" ${ui.eff ? '' : 'disabled'}>Lock in assessment</button></div>
          ${dev('<p><b>Issuer controls</b> live in the issuer\'s AccountRoot: <code>lsfRequireAuth</code>, <code>lsfNoFreeze</code> (absent = issuer may freeze), <code>lsfAllowTrustLineClawback</code>. Check with <code>account_info</code>. <b>Idle capital</b> is the demo adapter\'s diminishing-returns model: once every ring\'s marginal yield is below the hurdle, more money earns nothing.</p>')}`;
        b.querySelectorAll('[data-f]').forEach((x) => x.onclick = () => { const f = x.dataset.f; ui.flags.has(f) ? ui.flags.delete(f) : ui.flags.add(f); draw(); });
        b.querySelectorAll('[data-e]').forEach((x) => x.onclick = () => { ui.eff = x.dataset.e; draw(); });
        b.querySelector('[data-a="go"]').onclick = () => act({ type: 'assess', flags: [...ui.flags], efficiency: ui.eff });
      };
      draw();
    }

    // ---- 7. Promote ----
    function promote(b) {
      const g = s.gate;
      b.innerHTML = `<h3>7 · Request corridor promotion? ${B('SIMULATION')}</h3>
        <p>Promotion from spoke to six-ring corridor needs evidence of real, independent demand and honest depth. Here is your evidence checklist.</p>
        <div>${g.checks.map((c) => `<div class="arena-check ${c.ok ? 'ok' : 'no'}"><i>${c.ok ? '✓' : '✕'}</i><div><b>${E(c.label)}</b><div class="muted" style="font-size:13px">${E(c.detail)}</div></div></div>`).join('')}</div>
        <p><b>${g.eligible ? 'All evidence is in place.' : `Missing ${g.missing.length} item${g.missing.length > 1 ? 's' : ''}.`}</b> <span class="muted" style="font-size:13px">${E(g.note)}</span></p>
        <div class="arena-row"><button class="primary arena-btn" data-r="1">Request promotion</button><button class="ghost arena-btn" data-r="0">Not yet: keep building</button></div>
        ${dev('<p>Corridor stage (entered → spoke → reinforced spoke → corridor → mature → standby) is <b>Titan Ghost application logic</b>. XRPL has no corridor object. XDLC would make corridors protocol-native, but it is a <b>proposed amendment, not live</b>.</p>')}`;
      b.querySelectorAll('[data-r]').forEach((x) => x.onclick = () => act({ type: 'promote', request: x.dataset.r === '1' }));
    }

    // ---- 8. Compare ----
    function compare(b) {
      const c = s.comparison, P = s.promotion;
      const cols = [c.you, c.reinforced, c.underfunded];
      const rows = [
        ['Capital', (m) => usd(m.totalCapitalUsd)],
        ['Verifiable LPs', (m) => m.verifiableLps, (m) => m.verifiableLps >= 2],
        ['Largest share', (m) => pct(m.maxShare), (m) => m.maxShare <= 0.5],
        ['Typical impact', (m) => (m.medianImpactBps >= 10000 ? 'unfilled' : m.medianImpactBps + ' bps'), (m) => m.medianImpactBps <= 40],
        ['Block trade filled', (m) => pct(m.shockFillRatio), (m) => m.shockFillRatio >= 0.5],
        ['Independent fills', (m) => m.fills, (m) => m.fills >= 15],
        ['Wash fills', (m) => m.washFills, (m) => m.washFills === 0],
        ['Unfunded pledges', (m) => usd(m.pledgedUsd), (m) => m.pledgedUsd === 0],
        ['Idle capital', (m) => pct(m.idlePct), (m) => m.idlePct <= 0.15],
        ['Earned / day', (m) => usd(m.avgDailyEarnUsd)],
      ];
      b.innerHTML = `<div class="arena-event ${P.granted ? '' : P.requested ? 'bad' : ''}">${P.granted ? 'Promotion granted: your token is a six-ring corridor candidate.' : P.requested ? 'Promotion refused: evidence missing.' : 'You held back on promotion.'} Stage: <b>${E(P.stage)}</b> ${B('SIMULATION')}</div>
        <h3>8 · Compare with two reference markets ${B('SIMULATION')}</h3><p>Same seed, same days. One market done right, one done badly.</p>
        <div class="arena-cmp"><table><thead><tr><th></th>${cols.map((x) => `<th class="num">${E(x.label)}</th>`).join('')}</tr></thead><tbody>
          ${rows.map(([l, f, ok]) => `<tr><td>${E(l)}</td>${cols.map((x) => `<td class="num ${ok ? (ok(x.metrics) ? 'good' : 'poor') : ''}">${E(f(x.metrics))}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div>
        <div class="grid" style="margin-top:12px">${cols.map((x, i) => `<div><b>${E(x.label)}</b>${depth(x.lastRings, 'cmp' + i, x.ringsActive)}</div>`).join('')}</div>
        <p class="muted" style="font-size:12px">Engine: ${E(c.engineLabel)}</p>
        <div class="arena-row"><button class="primary arena-btn" data-a="go">Got it: on to the quiz</button></div>`;
      b.querySelector('[data-a="go"]').onclick = () => act({ type: 'compared' });
    }

    // ---- 9. Quiz ----
    function quiz(b) {
      const draw = () => {
        const all = s.quizItems.every((q) => ui.answers[q.id]);
        b.innerHTML = `<h3>9 · Who validates what?</h3><p>For each item: is it validated by the XRPL ledger, decided by Titan Ghost application logic, or only part of the XDLC proposal?</p>
          ${s.quizItems.map((q, i) => `<div class="arena-quiz"><b>${i + 1}. ${E(q.text)}</b><div class="arena-big">${Object.entries(meta.categories).map(([k, v]) => `<button class="arena-opt" data-q="${q.id}" data-v="${k}" aria-pressed="${ui.answers[q.id] === k}"><b style="font-size:15px">${E(v)}</b></button>`).join('')}</div></div>`).join('')}
          <label>Alias for the leaderboard (optional)</label><input data-a="alias" maxlength="24" value="${E(ui.alias || s.alias || '')}" placeholder="e.g. LondonLiquidity">
          <div class="arena-row"><button class="primary arena-btn" data-a="go" ${all ? '' : 'disabled'}>Finish and see my score</button></div>`;
        b.querySelectorAll('[data-q]').forEach((x) => x.onclick = () => { ui.alias = b.querySelector('[data-a="alias"]').value; ui.answers[x.dataset.q] = x.dataset.v; draw(); });
        b.querySelector('[data-a="go"]').onclick = () => act({ type: 'quiz', answers: ui.answers, alias: b.querySelector('[data-a="alias"]').value });
      };
      draw();
    }

    // ---- 10. Debrief ----
    function debrief(b) {
      const sc = s.score;
      b.innerHTML = `<div class="arena-hero"><div><div class="arena-score">${sc.total}<span class="muted" style="font-size:.4em"> / ${sc.max}</span></div>
          <div>${B('SIMULATION')} ${s.project.linked ? `with ${B('LIVE_TESTNET')} token ${E(s.project.linked.code)}` : ''} · seed <span class="mono">${E(s.seed)}</span></div></div>
          <button class="primary arena-btn" data-a="again">Play again</button></div>
        <h3 style="margin-top:16px">Score breakdown</h3>
        ${sc.categories.map((c) => `<div style="margin:10px 0"><div style="display:flex;justify-content:space-between"><b>${E(c.label)}</b><span class="mono">${c.pts} / ${c.max}</span></div>
          <div class="arena-bar"><div data-w="${(100 * c.pts) / c.max}%"></div></div>
          <details class="arena-dev"><summary>Why</summary><table><tbody>${c.items.map((x) => `<tr><td>${E(x.label)}</td><td class="num mono">${x.pts}/${x.max}</td><td class="muted">${E(x.why)}</td></tr>`).join('')}</tbody></table></details></div>`).join('')}
        ${sc.notScored.map((x) => `<div class="arena-check ok"><i>0</i><div><b>${E(x.label)}: not scored</b><div class="muted" style="font-size:13px">${E(x.why)}</div></div></div>`).join('')}
        <h3 style="margin-top:16px">Debrief</h3><ul>${s.debrief.map((d) => `<li>${E(d)}</li>`).join('')}</ul>
        ${linkedFacts()}
        <h3>Quiz review</h3>${s.quiz.results.map((q) => `<div class="arena-check ${q.correct ? 'ok' : 'no'}"><i>${q.correct ? '✓' : '✕'}</i><div><b>${E(q.text)}</b><div class="muted" style="font-size:13px">${E(meta.categories[q.correctCat])}. ${E(q.why)}</div></div></div>`).join('')}
        <div class="arena-row">${s.onLeaderboard ? `<span>On the leaderboard as <b>${E(s.alias)}</b> ${B('SIMULATION')}</span>`
          : `<input data-a="alias" maxlength="24" placeholder="Alias for the leaderboard" style="max-width:260px"><button class="ghost arena-btn" data-a="sub">Add to leaderboard</button>`}</div>`;
      b.querySelector('[data-a="again"]').onclick = start;
      const sub = b.querySelector('[data-a="sub"]'); if (sub) sub.onclick = () => act({ type: 'alias', alias: b.querySelector('[data-a="alias"]').value });
      loadBoard();
    }

    async function loadBoard() {
      try {
        const lb = await api.get('/api/arena/leaderboard');
        boardEl.classList.toggle('muted', !lb.entries.length);
        boardEl.innerHTML = lb.entries.length ? `<table><thead><tr><th>#</th><th>Alias</th><th class="num">Score</th><th>Mode</th><th>Token</th></tr></thead><tbody>${lb.entries.slice(0, 10).map((e, i) => `
          <tr><td>${i + 1}</td><td>${E(e.alias)}</td><td class="num">${e.score}</td><td>${B(e.mode)}</td><td>${e.linkedToken ? `${E(e.linkedToken.code)} ${B(e.linkedToken.mode)}` : '<span class="muted">simulated</span>'}</td></tr>`).join('')}</tbody></table>
          <p class="muted" style="font-size:12px">${E(lb.note)}</p>` : 'No scores yet. Be the first.';
      } catch (e) { boardEl.textContent = 'Leaderboard unavailable.'; }
    }
    api.on((ev) => { if (ev.type === 'arena.completed') loadBoard(); });
    loadBoard();
  },
};
