// Titan View — Multi-Scale Capital Injection. All participant capital here is SIMULATION;
// the LIVE TESTNET capacity panel is a separate, read-only view of real demo-account reserves.
const STYLE = `
.cap-root .cap-profiles { display:grid; gap:8px; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); }
.cap-root .cap-prof { text-align:left; border:1px solid var(--line); background:var(--bg); color:var(--ink); border-radius:8px; padding:10px; cursor:pointer; font:inherit; }
.cap-root .cap-prof[aria-pressed="true"] { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent) inset; }
.cap-root .cap-prof b { display:block; font-size:13px; } .cap-root .cap-prof span { font:600 15px var(--mono); }
.cap-root .cap-row { display:grid; gap:10px; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); }
.cap-root .cap-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
.cap-root .cap-tiles { display:grid; gap:8px; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); }
.cap-root .cap-tile { border:1px solid var(--line); border-radius:8px; padding:8px 10px; }
.cap-root .cap-tile .k { font-size:12px; color:var(--muted); } .cap-root .cap-tile .v { font:600 16px var(--mono); font-variant-numeric:tabular-nums; }
.cap-root .cap-tile .d { font-size:12px; color:var(--muted); font-family:var(--mono); }
.cap-root .cap-ring { display:grid; grid-template-columns:76px 1fr 92px; gap:8px; align-items:center; font-size:12px; margin:6px 0; }
.cap-root .cap-bars { display:grid; gap:2px; }
.cap-root .cap-bar { height:8px; border-radius:0 4px 4px 0; background:var(--line); min-width:0; transition:width .5s ease; }
.cap-root .cap-bar.after { background:var(--accent); }
.cap-root .cap-legend { display:flex; gap:14px; font-size:12px; color:var(--muted); margin-bottom:6px; }
.cap-root .cap-sw { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:4px; vertical-align:-1px; }
.cap-root .cap-flag { border-left:3px solid var(--bad); background:var(--bad-bg); padding:8px 10px; border-radius:4px; margin:8px 0; font-size:13px; }
.cap-root .cap-ok { border-left:3px solid var(--live); background:var(--live-bg); padding:8px 10px; border-radius:4px; margin:8px 0; font-size:13px; }
.cap-root .cap-live { border:2px dashed var(--live); }
.cap-root .cap-steps { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
.cap-root .cap-step { font:12px var(--mono); padding:3px 8px; border-radius:12px; border:1px solid var(--line); color:var(--muted); }
.cap-root .cap-step.on { border-color:var(--accent); color:var(--ink); }
.cap-root .cap-step.done { color:var(--ink); }
.cap-root .cap-chart svg { width:100%; height:auto; display:block; }
.cap-root .cap-chart .ax { stroke:var(--line); } .cap-root .cap-chart text { fill:var(--muted); font:11px var(--mono); }
.cap-root .cap-chart .ln { fill:none; stroke:var(--accent); stroke-width:2; }
.cap-root .cap-chart .cap { stroke:var(--bad); stroke-dasharray:4 3; stroke-width:1.5; }
.cap-root .cap-chart .hit { fill:transparent; } .cap-root .cap-chart .hit:hover + .pt { opacity:1; }
.cap-root .cap-chart .pt { fill:var(--accent); opacity:0; pointer-events:none; }
.cap-root .cap-chart .mk { stroke:var(--panel); stroke-width:2; }
.cap-root .cap-tip { font:12px var(--mono); min-height:18px; color:var(--muted); }
.cap-root ul.cap-edu { margin:0; padding-left:18px; font-size:13px; } .cap-root ul.cap-edu li { margin:4px 0; }
.cap-root .cap-scroll { overflow-x:auto; }
`;

const usd = (n) => n == null || !Number.isFinite(n) ? '—' : '$' + (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M' : Math.abs(n) >= 1e4 ? Math.round(n / 1e3) + 'k' : Math.round(n).toLocaleString('en-US'));
const pct = (x) => x == null ? '—' : (x * 100).toFixed(1) + '%';
const bps = (x) => x == null ? '—' : x.toFixed(x < 10 ? 1 : 0) + ' bps';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default {
  id: 'capital', title: 'Capital Injection', order: 30,
  async mount(el, api) {
    if (!document.getElementById('cap-style')) { const s = document.createElement('style'); s.id = 'cap-style'; s.textContent = STYLE; document.head.append(s); }
    const SIM = api.badge('SIMULATION'), LIVE = api.badge('LIVE_TESTNET');
    el.classList.add('cap-root');
    el.innerHTML = `<div class="card muted">Loading capital simulator…</div>`;
    let st;
    try { st = await api.get('/api/capital/state'); } catch (e) { el.innerHTML = `<div class="card err">Capital simulator unavailable: ${api.esc(e.message)}</div>`; return; }
    let sel = { profileId: 'retail', capitalUsd: 100, marketId: 'currencies', tierId: 'T1' };
    let busy = false;

    el.innerHTML = `
      <div class="card">
        <h2>Multi-scale capital injection ${SIM}</h2>
        <p class="muted" style="margin-top:0">Hypothetical capital from five participant types flowing into Titan Ghost's six liquidity rings. Presets are <b>demonstration presets only</b> — not investment minimums, eligibility thresholds or funded balances. Every simulated figure is labeled ${SIM}.</p>
        <div class="cap-profiles" id="cap-prof"></div>
        <div class="cap-row">
          <div><label for="cap-amt">Amount (USD, manual override)</label><input id="cap-amt" type="number" min="1" step="1"></div>
          <div><label for="cap-mkt">Market</label><select id="cap-mkt">${st.markets.map((m) => `<option value="${api.esc(m.id)}">${api.esc(m.label)} (${api.esc(m.demoAsset)})</option>`).join('')}</select></div>
          <div><label for="cap-tier">TGLB funding tier</label><select id="cap-tier">${st.tiers.map((t) => `<option value="${api.esc(t.id)}">${api.esc(t.label)}</option>`).join('')}</select></div>
        </div>
        <p class="muted" id="cap-tiernote" style="font-size:13px"></p>
        <p class="muted" style="font-size:13px">The tier is chosen <b>independently of participant size</b>: a $100 participant can term-commit and a $25M participant can stay flexible. Tier changes custody and delegation, not the modeled ring allocation.</p>
        <div class="cap-actions">
          <button class="primary" id="cap-go">Inject (simulated)</button>
          <button class="ghost" id="cap-seq">Play retail → institutional sequence</button>
          <button class="ghost" id="cap-reset">Reset market</button>
        </div>
        <div class="cap-steps" id="cap-steps"></div>
        <p class="err" id="cap-err" role="alert"></p>
      </div>
      <div class="grid">
        <div class="card"><h3>Ring allocation ${SIM}</h3>
          <div class="cap-legend"><span><span class="cap-sw" style="background:var(--line)"></span>Before</span><span><span class="cap-sw" style="background:var(--accent)"></span>After</span></div>
          <div id="cap-rings"></div><p class="muted" style="font-size:12px" id="cap-eng"></p></div>
        <div class="card"><h3>Market metrics ${SIM}</h3><div class="cap-tiles" id="cap-tiles"></div>
          <h3 style="margin-top:14px">Price impact for sample orders ${SIM}</h3><div class="cap-scroll" id="cap-impact"></div></div>
      </div>
      <div class="grid">
        <div class="card cap-chart"><h3>Earning curve: marginal yield vs total capital ${SIM}</h3><div id="cap-curve"></div><div class="cap-tip" id="cap-tip"></div><p class="muted" style="font-size:12px" id="cap-curvenote"></p></div>
        <div class="card"><h3>Sentinel indicators ${SIM}</h3><div id="cap-sent"></div></div>
      </div>
      <div class="grid">
        <div class="card"><h3>Guardian verdict</h3><div id="cap-guard" class="muted">No proposal yet.</div>
          <h3 style="margin-top:14px">Engine recommendations ${SIM}</h3><div id="cap-recs"></div></div>
        <div class="card"><h3>Why scale matters</h3><ul class="cap-edu">${st.education.map((t) => `<li>${api.esc(t)}</li>`).join('')}</ul>
          <p class="muted" style="font-size:12px">${api.esc(st.baseNote)} Market demand scales are illustrative.</p></div>
      </div>
      <div class="card cap-live"><h3>Real Testnet capacity ${LIVE}</h3>
        <p class="muted" style="font-size:13px;margin-top:0">Separate from the simulation above: actual XRP balances and reserves of the isolated demo maker/taker accounts on XRPL Testnet (no monetary value). Read-only.</p>
        <div id="cap-live" class="muted">Loading…</div><button class="ghost" id="cap-live-refresh" style="margin-top:8px">Refresh</button></div>`;

    const $ = (id) => el.querySelector('#' + id);
    const profEl = $('cap-prof'), amt = $('cap-amt'), mkt = $('cap-mkt'), tier = $('cap-tier'), err = $('cap-err');

    function renderProfiles() {
      profEl.innerHTML = st.profiles.map((p) => `<button type="button" class="cap-prof" data-p="${api.esc(p.id)}" aria-pressed="${p.id === sel.profileId}">
        <b>${api.esc(p.label)}</b><span>${usd(p.capitalUsd)}</span> <small class="muted">demo preset</small></button>`).join('');
      profEl.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => {
        const p = st.profiles.find((x) => x.id === b.dataset.p); sel.profileId = p.id; sel.capitalUsd = p.capitalUsd; amt.value = p.capitalUsd; renderProfiles();
      });
    }
    const tierNote = () => { $('cap-tiernote').textContent = st.tiers.find((t) => t.id === tier.value)?.note || ''; };
    amt.value = sel.capitalUsd; renderProfiles(); tierNote();
    tier.onchange = tierNote;
    mkt.onchange = () => { renderSnapshot(st.snapshots[mkt.value], null); renderCurveFromState(); };

    function renderRings(before, after) {
      const max = Math.max(1, ...after.rings.map((r) => r.allocUsd), ...(before ? before.rings.map((r) => r.allocUsd) : []));
      $('cap-rings').innerHTML = after.rings.map((r, i) => {
        const b = before?.rings[i];
        return `<div class="cap-ring" title="${api.esc(r.id)}: half-spread ${r.halfSpreadBps} bps, utilization ${pct(r.utilization)}">
          <span class="mono">${api.esc(r.id)}</span>
          <div class="cap-bars"><div class="cap-bar" style="width:${((b ? b.allocUsd : r.allocUsd) / max) * 100}%"></div><div class="cap-bar after" style="width:${(r.allocUsd / max) * 100}%"></div></div>
          <span class="mono" style="text-align:right">${b ? usd(b.allocUsd) + '→' : ''}${usd(r.allocUsd)}</span></div>`;
      }).join('');
      $('cap-eng').innerHTML = `Allocator: ${api.esc(st.engine.label)}. Depth per ring = modeled capital resting in that ring.`;
    }

    function tile(k, v, d = '') { return `<div class="cap-tile"><div class="k">${k} ${SIM}</div><div class="v">${v}</div><div class="d">${d}</div></div>`; }
    function renderSnapshot(after, before, r) {
      renderRings(before, after);
      const dd = (f, fmt) => before ? `before ${fmt(before[f])}` : '';
      $('cap-tiles').innerHTML = [
        tile('Total capital', usd(after.totalUsd), dd('totalUsd', usd)),
        tile('Deployed', usd(after.deployedUsd), dd('deployedUsd', usd)),
        tile('Idle', usd(after.idleUsd), dd('idleUsd', usd)),
        tile('Touch spread', bps(after.touchSpreadBps), dd('touchSpreadBps', bps)),
        tile('Depth-weighted spread', bps(after.weightedSpreadBps), dd('weightedSpreadBps', bps)),
        tile('Modeled daily earnings', usd(after.dailyEarnUsd), dd('dailyEarnUsd', usd)),
        tile('Proprietary / independent', `${pct(after.proprietaryShare)} / ${pct(after.independentShare)}`, 'Titan Ghost base vs participants'),
        tile('Productive capacity', usd(after.productiveCapacityUsd), 'beyond this, capital idles'),
        ...(r ? [tile('This injection: incremental yield', bps(r.contribution.incrementalYieldBps) + '/day', `${pct(r.contribution.productiveShare)} deployed · ${r.contribution.retailEquivalents.toLocaleString('en-US')}× retail preset`)] : []),
      ].join('');
      $('cap-impact').innerHTML = `<table><thead><tr><th>Order</th><th class="num">Before</th><th class="num">After</th></tr></thead><tbody>${after.impact.map((x, i) => {
        const f = (y) => y.exceedsDepth ? '<span class="err">exceeds depth</span>' : bps(y.impactBps);
        return `<tr><td class="mono">${usd(x.sizeUsd)}</td><td class="num">${before ? f(before.impact[i]) : '—'}</td><td class="num">${f(x)}</td></tr>`;
      }).join('')}</tbody></table><p class="muted" style="font-size:12px">Worst ring half-spread touched when the order sweeps the modeled rings. Idle capital adds no depth.</p>`;
      renderSentinel(after);
    }

    function renderSentinel(s) {
      const x = s.sentinel;
      $('cap-sent').innerHTML = `<div class="cap-tiles">
          ${tile('Concentration (HHI)', x.hhi.toLocaleString('en-US'), api.esc(x.hhiBand))}
          ${tile('Top independent participant', x.topParticipant ? pct(x.topParticipant.share) : '—', x.topParticipant ? api.esc(x.topParticipant.label) : 'none yet')}
          ${tile('Inventory (bid / ask)', `${usd(x.inventory.bidUsd)} / ${usd(x.inventory.askUsd)}`, `outer rings ${pct(x.inventory.outerRingShare)} · turn ${x.inventory.turnDays ? x.inventory.turnDays.toFixed(1) + 'd' : '—'}`)}
          ${tile('Idle share', pct(x.inventory.idleShare))}
        </div>
        ${x.systemicRisk ? `<div class="cap-flag"><b>⚠ Systemic-risk flag.</b> ${api.esc(x.systemicNote)}</div>` : `<div class="cap-ok">✓ No single independent participant above 50%.</div>`}
        ${x.delegation.map((d) => `<p style="font-size:13px"><b>Delegation · ${api.esc(d.tierId)}:</b> ${api.esc(d.note)}</p>`).join('')}
        <p class="muted" style="font-size:12px">HHI includes the Titan Ghost base as one provider. ${api.esc(x.inventory.note)}</p>`;
    }

    function renderCurve(curve, beforeUsd, afterUsd) {
      const W = 560, H = 230, L = 44, R = 12, T = 12, B = 34;
      const pts = curve.points, lx = (c) => Math.log10(c);
      const x0 = lx(pts[0].capitalUsd), x1 = lx(pts.at(-1).capitalUsd);
      const yMax = Math.max(1, ...pts.map((p) => p.marginalBps)) * 1.1;
      const X = (c) => L + ((lx(Math.min(Math.max(c, pts[0].capitalUsd), pts.at(-1).capitalUsd)) - x0) / (x1 - x0)) * (W - L - R);
      const Y = (v) => T + (1 - v / yMax) * (H - T - B);
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.capitalUsd).toFixed(1)},${Y(p.marginalBps).toFixed(1)}`).join('');
      const ticks = []; for (let e = Math.ceil(x0); e <= Math.floor(x1); e++) ticks.push(10 ** e);
      const yt = [0, yMax / 2 / 1.1, yMax / 1.1].map((v) => +v.toFixed(1));
      const cap = curve.productiveCapacityUsd;
      const interp = (c) => { const p = pts.reduce((a, b) => Math.abs(lx(b.capitalUsd) - lx(c)) < Math.abs(lx(a.capitalUsd) - lx(c)) ? b : a); return p.marginalBps; };
      const marker = (c, label, fill) => c ? `<circle class="mk" cx="${X(c)}" cy="${Y(interp(c))}" r="5" fill="${fill}"><title>${label}: ${usd(c)}</title></circle>` : '';
      $('cap-curve').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Marginal modeled yield in basis points per day against total market capital, log scale">
        <line class="ax" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/>
        ${yt.map((v) => `<line class="ax" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke-opacity=".5"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
        ${ticks.map((t) => `<text x="${X(t)}" y="${H - B + 16}" text-anchor="middle">${usd(t)}</text>`).join('')}
        <text x="${L}" y="${H - 4}">total capital in market (log)</text>
        <text x="${L + 4}" y="${T + 10}">bps/day on next $</text>
        ${cap ? `<line class="cap" x1="${X(cap)}" x2="${X(cap)}" y1="${T}" y2="${H - B}"/><text x="${X(cap) > W * 0.6 ? X(cap) - 4 : X(cap) + 4}" text-anchor="${X(cap) > W * 0.6 ? 'end' : 'start'}" y="${T + 24}" style="fill:var(--bad)">extra capital idles →</text>` : ''}
        <path class="ln" d="${d}"/>
        ${pts.map((p, i) => `<rect class="hit" data-i="${i}" x="${X(p.capitalUsd) - 8}" y="${T}" width="16" height="${H - T - B}"/><circle class="pt" cx="${X(p.capitalUsd)}" cy="${Y(p.marginalBps)}" r="4"/>`).join('')}
        ${marker(beforeUsd, 'Before', 'var(--muted)')}${marker(afterUsd, 'After', 'var(--accent)')}
      </svg>`;
      $('cap-curve').querySelectorAll('.hit').forEach((h) => h.onmouseenter = () => {
        const p = pts[h.dataset.i];
        $('cap-tip').textContent = `${usd(p.capitalUsd)} total → next-dollar ${bps(p.marginalBps)}/day · deployed ${usd(p.deployedUsd)} · idle ${usd(p.idleUsd)} (SIMULATION)`;
      });
      $('cap-curvenote').textContent = `${curve.note} Grey dot = before, blue dot = after. Hover the curve for values.`;
    }
    let curveCache = { ...(st.curves || {}) };
    async function renderCurveFromState() {
      const c = curveCache[mkt.value];
      const s = st.snapshots[mkt.value];
      if (c) renderCurve(c, null, s.totalUsd); else { $('cap-curve').innerHTML = '<p class="muted">Inject into this market to draw its curve.</p>'; $('cap-curvenote').textContent = ''; }
    }

    function renderGuard(g) {
      $('cap-guard').innerHTML = g.allowed ? `<div class="cap-ok">✓ Guardian allowed this SIMULATION proposal (no transaction is submitted).</div>`
        : `<div class="cap-flag">✕ Guardian rejected: ${g.reasons.map(api.esc).join(' ')}</div>`;
    }
    function renderRecs(recs) {
      const lab = (id) => st.markets.find((m) => m.id === id)?.label || id;
      $('cap-recs').innerHTML = (recs.items.length ? `<ul class="cap-edu">${recs.items.map((r) => `<li><b>${api.esc(r.action)}</b> ${usd(r.amountUsd)} ${api.esc(lab(r.fromMarket))} → ${api.esc(lab(r.toMarket))}. <span class="muted">${api.esc(r.rationale)}</span></li>`).join('')}</ul>` : '<p class="muted">No reallocation recommended across the four markets.</p>')
        + `<p class="muted" style="font-size:12px">${api.esc(recs.engine.label)}. Recommendations are illustrative, not advice.</p>`;
    }

    function applyResult(r) {
      st.snapshots[r.input.marketId] = r.after;
      curveCache[r.input.marketId] = r.earningCurve;
      renderSnapshot(r.after, r.before, r); renderCurve(r.earningCurve, r.before.totalUsd, r.after.totalUsd); renderGuard(r.guardian); renderRecs(r.recommendations);
    }
    const lock = (on) => { busy = on; ['cap-go', 'cap-seq', 'cap-reset'].forEach((id) => $(id).disabled = on); };

    $('cap-go').onclick = async () => {
      if (busy) return; err.textContent = ''; lock(true);
      try { applyResult(await api.post('/api/capital/inject', { profileId: sel.profileId, capitalUsd: Number(amt.value), marketId: mkt.value, tierId: tier.value })); $('cap-steps').innerHTML = ''; }
      catch (e) { err.textContent = (e.body?.errors || [e.message]).join(' '); if (e.body?.guardian) renderGuard(e.body.guardian); }
      finally { lock(false); }
    };
    $('cap-seq').onclick = async () => {
      if (busy) return; err.textContent = ''; lock(true);
      try {
        const r = await api.post('/api/capital/sequence', { marketId: mkt.value, tierId: tier.value });
        const chips = () => r.steps.map((s, j) => `<span class="cap-step ${j < i ? 'done' : j === i ? 'on' : ''}">${j + 1}. ${api.esc(s.profile.label)} ${usd(s.input.capitalUsd)}</span>`).join('');
        let i = 0;
        for (; i < r.steps.length; i++) { $('cap-steps').innerHTML = chips() + ' ' + SIM; applyResult(r.steps[i]); await sleep(1300); }
        $('cap-steps').innerHTML = chips() + ' ' + SIM;
      } catch (e) { err.textContent = (e.body?.errors || [e.message]).join(' '); }
      finally { lock(false); }
    };
    $('cap-reset').onclick = async () => {
      if (busy) return; lock(true);
      try { st = { ...st, ...(await api.post('/api/capital/reset', { marketId: mkt.value })) }; Object.assign(curveCache, st.curves || {}); renderSnapshot(st.snapshots[mkt.value], null); renderRecs(st.recommendations); renderCurveFromState(); $('cap-steps').innerHTML = ''; }
      catch (e) { err.textContent = e.message; } finally { lock(false); }
    };

    async function live() {
      const box = $('cap-live');
      try {
        const l = await api.get('/api/capital/live-capacity');
        box.classList.remove('muted');
        box.innerHTML = `<div class="cap-scroll"><table><thead><tr><th>Demo account</th><th class="num">XRP</th><th class="num">Owner objects</th><th class="num">Reserved</th><th class="num">Spendable</th><th class="num">More offers</th></tr></thead><tbody>
          ${Object.entries(l.accounts).map(([role, a]) => `<tr><td>${api.esc(role)} <span class="mono">${api.esc(a.address.slice(0, 8))}…</span></td><td class="num">${a.xrp.toFixed(2)}</td><td class="num">${a.ownerCount}</td><td class="num">${a.lockedXrp.toFixed(2)}</td><td class="num">${a.spendableXrp.toFixed(2)}</td><td class="num">${a.additionalOffers ?? '—'}</td></tr>`).join('')}
          </tbody></table></div>
          <p style="font-size:13px">${LIVE} Ledger ${l.validatedLedger} · base reserve ${l.reserveBaseXrp} XRP · owner reserve ${l.reserveIncXrp} XRP per object.</p>
          <p class="muted" style="font-size:12px">${api.esc(l.note)}</p>`;
      } catch (e) { box.innerHTML = `<span class="badge bad">TESTNET UNAVAILABLE</span> ${api.esc(e.message)}`; }
    }
    $('cap-live-refresh').onclick = live;

    renderSnapshot(st.snapshots[mkt.value], null); renderRecs(st.recommendations); renderCurveFromState(); live();
  },
};
