// Watch Capital Move: scripted capital redeployment walk-through between the INITIAL XRP/RLUSD corridor and a radar-picked
// DESTINATION market. ALL SIMULATION: no Mainnet transfers, no signing, no offers placed or cancelled anywhere.
// Only authorized proprietary capital moves; Tier 1/2 TGLW (self-custodial) and Tier 3 TGLB loan proceeds stay locked.
// Approval is a human button press; the presenter hook auto-plays only up to the approval step.
// Presenter hook: window.dispatchEvent(new CustomEvent('tf:present', { detail: { scene: 'redeploy' } })).
const STYLE = `
.rd .rd-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.rd .rd-mk{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))}
.rd .rd-m h3{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.rd .rd-stack{display:flex;height:34px;border-radius:8px;overflow:hidden;background:var(--line);margin:6px 0}
.rd .rd-stack i{display:block;height:100%;transition:width 1.4s cubic-bezier(.4,0,.2,1);min-width:0}
.rd .rd-prop{background:var(--accent)}
.rd .rd-lock{background:repeating-linear-gradient(45deg,var(--muted) 0 6px,var(--line) 6px 12px);opacity:.75}
.rd .rd-cost{background:var(--bad)}
.rd .rd-leg{display:flex;flex-wrap:wrap;gap:8px 14px;font-size:12px;color:var(--muted)}
.rd .rd-leg span::before{content:"";display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.rd .rd-leg .p::before{background:var(--accent)} .rd .rd-leg .l::before{background:var(--muted)} .rd .rd-leg .c::before{background:var(--bad)}
.rd .rd-amt{font:600 20px var(--mono);font-variant-numeric:tabular-nums}
.rd .rd-flow{height:6px;border-radius:3px;background:var(--line);overflow:hidden;margin:8px 0}
.rd .rd-flow i{display:block;height:100%;width:0;background:var(--accent);transition:width 1.4s}
.rd ol.rd-steps{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.rd ol.rd-steps li{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px;opacity:.35;transition:opacity .4s,border-color .4s}
.rd ol.rd-steps li.on{opacity:1}
.rd ol.rd-steps li.done{border-color:var(--live)} .rd ol.rd-steps li.awaiting_approval{border-color:var(--sim);border-style:dashed} .rd ol.rd-steps li.blocked{border-color:var(--bad)}
.rd ol.rd-steps li b{display:block}
.rd ol.rd-steps details{font-size:12px} .rd ol.rd-steps pre{white-space:pre-wrap;font-size:11px;max-height:200px;overflow:auto;background:var(--bg);padding:6px;border-radius:6px}
.rd .rd-note{border-left:3px solid var(--sim);padding:4px 10px;margin:8px 0;font-size:13px}
.rd .rd-flag{border-left:3px solid var(--bad);background:var(--bad-bg);padding:6px 10px;border-radius:4px;margin:6px 0;font-size:13px}
.rd .rd-pulse{animation:rdp 1.2s ease-in-out infinite}
@keyframes rdp{0%,100%{box-shadow:0 0 0 0 var(--sim)}50%{box-shadow:0 0 0 4px var(--sim-bg)}}
@media (prefers-reduced-motion: reduce){.rd .rd-stack i,.rd .rd-flow i{transition:none}.rd .rd-pulse{animation:none}}
`;

const fmt = (n) => (n == null || !Number.isFinite(+n) ? '—' : Math.round(+n).toLocaleString('en-US'));
const usd = (n) => (n == null ? '—' : `${n < 0 ? '−' : ''}$${fmt(Math.abs(n))}`);

export default {
  id: 'redeploy',
  title: 'Watch Capital Move',
  order: 44,
  async mount(el, api) {
    const { esc, badge } = api;
    if (!document.getElementById('rd-style')) { const s = document.createElement('style'); s.id = 'rd-style'; s.textContent = STYLE; document.head.append(s); }
    el.classList.add('rd');
    let timers = [], run = null, playing = false;
    const clear = () => { timers.forEach(clearTimeout); timers = []; };

    el.innerHTML = `
      <div class="card">
        <h2>Watch Capital Move <span class="badge sim">SIMULATION</span></h2>
        <p class="muted" style="margin:0 0 6px">Proprietary capital released from a mature XRP/RLUSD corridor and redeployed into the best eligible XRP-connected market from the Opportunity Radar. <b>No Mainnet transfers, no signing, nothing placed or cancelled on any network.</b> Tier 1/2 TGLW participant assets (self-custodial) and Tier 3 loan proceeds are excluded. Reserve release is not profit. Modeled outcomes are ranges and can be negative.</p>
        <div class="rd-row">
          <button class="ghost" data-play>▶ Play walk-through</button>
          <button class="primary" data-approve>Approve redeployment (operator)</button>
          <button class="ghost" data-reset>Reset</button>
          <span class="muted" style="font-size:12px" data-eng></span>
        </div>
        <div data-msg></div>
      </div>
      <div class="card"><div class="rd-mk" data-markets></div>
        <div class="rd-flow" aria-hidden="true"><i data-flow></i></div>
        <div class="rd-leg"><span class="p">Proprietary (reallocatable)</span><span class="l">Tier 1/2 TGLW · Tier 3 TGLB (locked, excluded)</span><span class="c">Conversion cost</span></div>
      </div>
      <div class="card"><h3>Steps</h3><ol class="rd-steps" data-steps></ol></div>`;
    const $ = (s) => el.querySelector(s);

    function rowsFor(alloc, market) { return alloc.filter((x) => x.market === market || (x.bucket === 'conversion_cost' && market === '—')); }
    function drawMarkets(r, phase) {
      const alloc = phase === 'after' ? r.allocation.after : r.allocation.before;
      const total = Math.max(1, ...['before', 'after'].map((k) => r.allocation[k].reduce((s, x) => s + x.usd, 0)));
      const init = r.markets.initial.pair, dest = r.markets.destination?.pair || 'Destination';
      const card = (title, market, prov) => {
        const rows = rowsFor(alloc, market);
        const prop = rows.filter((x) => x.bucket === 'proprietary').reduce((s, x) => s + x.usd, 0);
        const locked = rows.filter((x) => !x.reallocatable && x.bucket !== 'conversion_cost');
        const lockSum = locked.reduce((s, x) => s + x.usd, 0);
        return `<div class="rd-m"><h3>${esc(title)} ${badge(prov === 'MAINNET_OBSERVED' ? 'MAINNET_OBSERVED' : 'SIMULATION')}</h3>
          <div class="rd-amt" data-amt="${esc(market)}">${usd(prop)}</div><div class="muted" style="font-size:12px">proprietary capital (modeled) ${badge('SIMULATION')}</div>
          <div class="rd-stack" data-stack="${esc(market)}"><i class="rd-prop" style="width:${(prop / total * 100).toFixed(2)}%"></i>${locked.map((x) => `<i class="rd-lock" title="${esc(x.bucket)}: ${esc(x.why || '')}" style="width:${(x.usd / total * 100).toFixed(2)}%"></i>`).join('')}</div>
          ${locked.length ? `<div class="muted" style="font-size:12px">Locked, not reallocatable: ${locked.map((x) => `${esc(x.bucket)} ${usd(x.usd)}`).join(' · ')} (${usd(lockSum)})</div>` : '<div class="muted" style="font-size:12px">No participant or loan capital here.</div>'}</div>`;
      };
      const cost = alloc.find((x) => x.bucket === 'conversion_cost');
      $('[data-markets]').innerHTML = card(`Initial · ${init}`, init, r.markets.initial.provenance) + card(`Destination · ${dest}${r.markets.destination ? ` (radar #${r.markets.destination.rank})` : ''}`, dest, r.markets.destination?.provenance)
        + (cost ? `<div class="rd-m"><h3>Conversion cost ${badge('SIMULATION')}</h3><div class="rd-amt" style="color:var(--bad)">${usd(cost.usd)}</div><div class="muted" style="font-size:12px">${esc(cost.why)}</div></div>` : '');
    }

    function stepHtml(s) {
      const extra = { ...s }; for (const k of ['index', 'id', 'title', 'provenance', 'status', 'summary']) delete extra[k];
      return `<li data-i="${s.index}" class="${esc(s.status)}"><b>${s.index + 1}. ${esc(s.title)} ${badge(s.provenance === 'UNAVAILABLE' ? 'UNAVAILABLE' : s.provenance)} ${s.status === 'awaiting_approval' ? '<span class="badge bad">AWAITING OPERATOR APPROVAL</span>' : s.status === 'blocked' ? '<span class="badge bad">BLOCKED</span>' : ''}</b>${esc(s.summary || '')}
        ${Object.keys(extra).length ? `<details><summary>detail</summary><pre>${esc(JSON.stringify(extra, null, 2))}</pre></details>` : ''}</li>`;
    }

    function render(r, { animate = false } = {}) {
      run = r; clear();
      $('[data-eng]').textContent = `Engine: ${r.engine.label} · run ${r.runId}`;
      drawMarkets(r, 'before');
      $('[data-flow]').style.width = '0';
      $('[data-steps]').innerHTML = r.steps.map(stepHtml).join('');
      const items = [...el.querySelectorAll('[data-steps] li')];
      const finalize = () => {
        if (r.allocation.moved) { drawMarkets(r, 'before'); requestAnimationFrame(() => requestAnimationFrame(() => { drawMarkets(r, 'after'); $('[data-flow]').style.width = '100%'; })); }
        const ap = $('[data-approve]');
        ap.classList.toggle('rd-pulse', r.blocked === 'AWAITING_OPERATOR_APPROVAL');
        $('[data-msg]').innerHTML = r.blocked === 'AWAITING_OPERATOR_APPROVAL' ? '<p class="rd-note"><b>Stopped at Guardian approval.</b> The server never self-approves: an operator must press “Approve redeployment”.</p>'
          : r.blocked ? `<p class="rd-flag">${esc(r.reason || r.blocked)}</p>`
          : `<p class="rd-note">Approved by the operator. Lifecycle: ${r.lifecycle.map((l) => `${esc(l.to)} ${l.ok ? '✓' : '✗'}`).join(' → ')} (hash-chained SIMULATION records).</p>`;
        playing = false;
      };
      if (!animate) { items.forEach((li) => li.classList.add('on')); finalize(); return; }
      playing = true;
      items.forEach((li, i) => timers.push(setTimeout(() => { li.classList.add('on'); li.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, 650 * i)));
      timers.push(setTimeout(finalize, 650 * items.length));
    }

    async function load() {
      try { render(await api.get('/api/xdlc/redeploy/plan')); $('[data-msg]').innerHTML = '<p class="rd-note">Preview: nothing has moved. Press Play to walk through, or Approve to run with operator approval.</p>'; }
      catch (e) { $('[data-msg]').innerHTML = `<p class="rd-flag">Redeploy plan unavailable: ${esc(e.message)}</p>`; }
    }
    async function play(approved) {
      if (playing) return;
      try { render(await api.post('/api/xdlc/redeploy/run', { approved: approved === true }), { animate: true }); }
      catch (e) { $('[data-msg]').innerHTML = `<p class="rd-flag">${esc(e.message)}</p>`; }
    }

    $('[data-play]').onclick = () => play(false);
    $('[data-approve]').onclick = () => {
      // Human approval only: an explicit confirmation in the operator console.
      if (!window.confirm('Operator approval: approve the SIMULATED redeployment of proprietary capital only (no Mainnet transfer, Tier 1/2/3 excluded)?')) return;
      play(true);
    };
    $('[data-reset]').onclick = () => { clear(); playing = false; $('[data-approve]').classList.remove('rd-pulse'); load(); };

    window.addEventListener('tf:present', (e) => { if (e?.detail?.scene === 'redeploy') { api.show('redeploy'); playing = false; play(false); } });
    await load();
  },
};
