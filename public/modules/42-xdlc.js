// XDLC Lifecycle: application-level corridor state machine (Titan Ghost application logic; XDLC itself is a PROPOSED
// XRPL amendment, not live) + TG Intelligence Opportunity Radar (demo adapter). Nothing here signs or moves funds:
// every advance is an operator SIMULATION record, POSTs are accepted from localhost only, approval is a human checkbox.
// Presenter hook: window.dispatchEvent(new CustomEvent('tf:present', { detail: { scene: 'radar' | 'lifecycle' } })).
const STYLE = `
.xd .xd-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.xd .xd-row > select{width:auto;flex:1 1 200px;min-width:0}
.xd .xd-seg{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.xd .xd-seg button{border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:16px;padding:5px 12px;font:inherit;font-size:13px;cursor:pointer}
.xd .xd-seg button[aria-pressed="true"]{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.xd .xd-rail{display:grid;gap:6px;grid-template-columns:repeat(auto-fill,minmax(min(100%,150px),1fr));margin:0;padding:0;list-style:none;counter-reset:st}
.xd .xd-rail li{border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-size:12px;color:var(--muted);counter-increment:st;transition:border-color .3s,box-shadow .3s,background .3s}
.xd .xd-rail li b{display:block;color:var(--ink);font-size:12px;overflow-wrap:anywhere}
.xd .xd-rail li b::before{content:counter(st) ". "}
.xd .xd-rail li.done{border-color:var(--live)}
.xd .xd-rail li.current{border-color:var(--accent);box-shadow:inset 0 0 0 2px var(--accent);background:var(--bg)}
.xd .xd-rail li.next{border-style:dashed;border-color:var(--sim)}
.xd .xd-rail li.flash{background:var(--sim-bg)}
.xd .xd-fund{display:grid;gap:4px;margin:8px 0}
.xd .xd-fb{display:grid;grid-template-columns:96px minmax(0,1fr) auto;gap:6px;align-items:center;font-size:12px}
.xd .trk{height:9px;border-radius:5px;background:var(--line);overflow:hidden}
.xd .trk i{display:block;height:100%;background:var(--sim);transition:width .6s}
.xd .xd-fb.f1 .trk i{background:var(--muted)} .xd .xd-fb.f4 .trk i{background:var(--accent)}
.xd .xd-note{border-left:3px solid var(--sim);padding:4px 10px;margin:8px 0;font-size:13px}
.xd .xd-flag{border-left:3px solid var(--bad);background:var(--bad-bg);padding:6px 10px;border-radius:4px;margin:6px 0;font-size:13px}
.xd .xd-ok{border-left:3px solid var(--live);background:var(--live-bg);padding:6px 10px;border-radius:4px;margin:6px 0;font-size:13px}
.xd textarea{font-family:var(--mono);font-size:12px;min-height:90px}
.xd .xd-fin{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(min(100%,130px),1fr))}
.xd .xd-scroll{overflow-x:auto;max-width:100%}
.xd .xd-log{max-height:420px;overflow:auto}
.xd .xd-log td{vertical-align:top;font-size:12px}
.xd details{font-size:12px}
.xd details pre{white-space:pre-wrap;font-size:11px;max-height:220px;overflow:auto;background:var(--bg);padding:6px;border-radius:6px}
.xd .xd-fac{display:grid;gap:3px;margin:6px 0}
.xd .xd-fac div{display:grid;grid-template-columns:minmax(0,150px) minmax(0,1fr) 48px;gap:6px;align-items:center;font-size:11px}
.xd .xd-fac .bar{position:relative;height:10px;background:var(--line);border-radius:3px;overflow:hidden}
.xd .xd-fac .bar::after{content:"";position:absolute;left:50%;top:0;bottom:0;width:1px;background:var(--muted)}
.xd .xd-fac .bar i{position:absolute;top:0;bottom:0;transition:width .7s ease-out}
.xd .xd-fac .bar i.p{left:50%;background:var(--live)} .xd .xd-fac .bar i.n{right:50%;background:var(--bad)}
.xd .xd-fac small{color:var(--muted);grid-column:1/-1;margin:-2px 0 2px}
.xd tr.xd-hi td{background:var(--sim-bg);transition:background .4s}
.xd .xd-score{font:600 13px var(--mono)}
.xd .neg{color:var(--bad)} .xd .pos{color:var(--live)}
.xd .xd-chip{display:inline-block;font:11px var(--mono);padding:1px 6px;border:1px solid var(--line);border-radius:10px;color:var(--muted)}
`;

const fmt = (n) => (n == null || !Number.isFinite(+n) ? '—' : Math.round(+n).toLocaleString('en-US'));
const usd = (n) => (n == null ? '—' : `${n < 0 ? '−' : ''}$${fmt(Math.abs(n))}`);
const short = (h) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : '—');

// Evidence templates for the operator form (the operator edits them; nothing is auto-approved).
const TEMPLATES = {
  OPPORTUNITY_EVALUATION: { evidence: { radarId: 'radar:…', note: '' } },
  PROJECT_REQUEST: { evidence: { origin: 'RADAR_DISCOVERED', netBenefitUsd: { low: 0, base: 0, high: 0 } } },
  CAPITAL_STRUCTURE: { funding: { requestedUsd: 0 } },
  APPROVAL_PENDING: { funding: { committedUsd: 0 }, evidence: { sources: { PROPRIETARY: { usd: 0, reallocatable: true } } } },
  BOOTSTRAPPING: { funding: { fundedUsd: 0 } },
  ACTIVE: { funding: { executableUsd: 0 }, evidence: { offersPlaced: 12 } },
  REINFORCED: { evidence: { independentShare: 0.3 } },
  MATURE: { evidence: { independentShare: 0.6, persistence: 0.75 } },
  SUPPORT_REDUCTION: { evidence: { releasableUsd: 0 } },
  CAPITAL_AVAILABLE: { evidence: { availableBalanceVerified: true } },
  REDEPLOYMENT_RECOMMENDED: { evidence: { destinationMarketId: '' } },
  APPROVED_REDEPLOYMENT: { evidence: {} },
  NEW_CORRIDOR_ACTIVE: { evidence: { destinationFundedUsd: 0 } },
};

export default {
  id: 'xdlc-app',
  title: 'XDLC Lifecycle',
  order: 42,
  async mount(el, api) {
    const { esc, badge } = api;
    if (!document.getElementById('xd-style')) { const s = document.createElement('style'); s.id = 'xd-style'; s.textContent = STYLE; document.head.append(s); }
    el.classList.add('xd');
    let view = 'lifecycle', list = null, current = null, radar = null, sel = null, busy = false, timers = [];
    const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

    el.innerHTML = `
      <div class="card">
        <h2>XDLC Lifecycle <span class="badge sim">SIMULATION</span></h2>
        <p class="muted" style="margin:0 0 6px">Application-level corridor lifecycle run by Titan Ghost application logic. <b>XDLC is a proposed XRPL amendment, not live.</b> XRP auto-bridging is the existing XRPL feature. Transitions are hash-chained SIMULATION records; a record cites a ledger transaction only when a real recorded Testnet hash exists.</p>
        <div class="xd-row"><span class="muted" style="font-size:12px">Engine:</span> <span class="xd-chip" data-engine>loading…</span></div>
      </div>
      <div class="xd-seg" role="group" aria-label="XDLC view">
        <button data-v="lifecycle" aria-pressed="true">Lifecycle</button>
        <button data-v="radar" aria-pressed="false">Opportunity Radar</button>
        <button data-go="redeploy">Watch Capital Move →</button>
      </div>
      <div data-body></div>`;
    const body = el.querySelector('[data-body]');
    el.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => setView(b.dataset.v)));
    el.querySelector('[data-go]').onclick = () => api.show('redeploy');

    function setView(v) {
      view = v; clearTimers();
      el.querySelectorAll('[data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
      return v === 'radar' ? renderRadar() : renderLifecycle();
    }

    // ---------- Lifecycle ----------
    async function loadCorridors() { list = await api.get('/api/xdlc/corridors'); if (!sel || !list.corridors.some((c) => c.id === sel)) sel = list.corridors[0]?.id; current = sel ? await api.get(`/api/xdlc/corridors/${encodeURIComponent(sel)}`) : null; }

    function rail(c, highlight = null) {
      const idx = list.states.indexOf(c.state);
      return `<ol class="xd-rail" data-rail>${list.states.map((s, i) => `<li class="${i < idx ? 'done' : i === idx ? 'current' : i === idx + 1 ? 'next' : ''}${highlight === s ? ' flash' : ''}" data-st="${s}"><b>${esc(list.labels[s])}</b>${list.approvalRequired.includes(s) ? '<span class="xd-chip">operator approval</span>' : ''}</li>`).join('')}</ol>`;
    }

    function fundingBars(f) {
      const max = Math.max(1, f.requestedUsd, f.committedUsd, f.fundedUsd, f.executableUsd);
      const row = (cls, label, v) => `<div class="xd-fb ${cls}"><span>${label}</span><span class="trk"><i style="width:${(v / max * 100).toFixed(1)}%"></i></span><span class="mono">${usd(v)}</span></div>`;
      return `<div class="xd-fund">${row('f1', 'Requested', f.requestedUsd)}${row('f2', 'Committed', f.committedUsd)}${row('f3', 'Funded', f.fundedUsd)}${row('f4', 'Executable', f.executableUsd)}</div>
        <p class="muted" style="font-size:11px;margin:0">Four separate categories, never summed. ${badge('SIMULATION')}</p>`;
    }

    function logTable(log) {
      if (!log.length) return '<p class="muted">No transitions yet.</p>';
      return `<div class="xd-scroll xd-log"><table class="tf-stack"><thead><tr><th>#</th><th>When</th><th>Transition</th><th>Mode</th><th>Authorization</th><th>Ledger</th><th>Hash chain</th></tr></thead><tbody>
        ${[...log].reverse().map((r) => `<tr>
          <td data-label="#">${r.seq}</td>
          <td data-label="When" class="mono">${esc(r.at.replace('T', ' ').slice(0, 19))}</td>
          <td data-label="Transition"><b>${esc(r.from)}</b> → <b>${esc(r.to)}</b>
            <details><summary>evidence · funding · risk · reconciliation</summary><pre>${esc(JSON.stringify({ evidence: r.evidence, funding: r.funding, risk: r.risk, reconciliation: r.reconciliation }, null, 2))}</pre></details></td>
          <td data-label="Mode">${badge(r.mode)}</td>
          <td data-label="Authorization">${r.authorization.required ? (r.authorization.approved ? `<span class="pos">approved</span> <span class="muted">by ${esc(r.authorization.approvedBy)}</span>` : '<span class="neg">not approved</span>') : '<span class="muted">not required</span>'}<br><span class="muted">Guardian: ${r.authorization.guardian.allowed ? 'allowed' : esc(r.authorization.guardian.reasons.join(' '))}</span></td>
          <td data-label="Ledger">${r.ledgerRef ? `<a href="${esc(r.ledgerRef.explorer || `https://testnet.xrpl.org/transactions/${r.ledgerRef.hash}`)}" target="_blank" rel="noopener" class="mono">${short(r.ledgerRef.hash)}</a> ${badge('LIVE_TESTNET')}<br><span class="muted">${esc(r.ledgerRef.source || '')}</span>` : '<span class="muted">none (SIMULATION)</span>'}</td>
          <td data-label="Hash chain" class="mono" title="${esc(r.hash)}">${short(r.prevHash)} → ${short(r.hash)}</td></tr>`).join('')}
      </tbody></table></div>`;
    }

    async function renderLifecycle(highlight = null) {
      try { await loadCorridors(); } catch (e) { body.innerHTML = `<div class="card err">XDLC unavailable: ${esc(e.message)}</div>`; return; }
      const c = current;
      if (!c) { body.innerHTML = '<div class="card muted">No corridors.</div>'; return; }
      const nxt = c.next;
      const needs = list.approvalRequired.includes(nxt);
      body.innerHTML = `
        <div class="card">
          <div class="xd-row"><select data-sel aria-label="Corridor">${list.corridors.map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.label)} — ${esc(x.state)}</option>`).join('')}</select>
            <span class="xd-chip">origin ${esc(c.origin)}</span> <span class="xd-chip">${esc(c.marketId)}</span>
            ${c.chain.ok ? `<span class="badge live" title="head ${esc(c.chain.head)}">CHAIN OK · ${c.transitions}</span>` : `<span class="badge bad">CHAIN BROKEN: ${esc(c.chain.reason)}</span>`}</div>
          <h3 style="margin-top:12px">Lifecycle rail (14 states)</h3>
          ${rail(c, highlight)}
        </div>
        <div class="grid">
          <div class="card"><h3>Funding status</h3>${fundingBars(c.funding)}</div>
          <div class="card"><h3>Advance (operator)</h3>
            ${nxt ? `<p style="margin:0 0 6px">Next legal state: <b>${esc(nxt)}</b>${needs ? ' <span class="badge bad">REQUIRES OPERATOR APPROVAL</span>' : ''}</p>
              <label for="xd-ev">Evidence / funding (JSON, edit before submitting)</label>
              <textarea id="xd-ev" data-ev>${esc(JSON.stringify(TEMPLATES[nxt] || { evidence: {} }, null, 2))}</textarea>
              ${needs ? '<label style="display:flex;gap:6px;align-items:center;color:var(--ink)"><input type="checkbox" data-appr style="width:auto"> I am the operator and I explicitly approve this step</label>' : ''}
              <div class="xd-row" style="margin-top:8px"><button class="primary" data-adv>Advance to ${esc(nxt)}</button><span class="muted" style="font-size:12px">Localhost only · SIMULATION record · guards + Guardian verdict</span></div>
              <div data-msg></div>` : '<p class="xd-ok">Terminal state reached.</p>'}
            <details style="margin-top:8px"><summary>Create a corridor from a radar entry</summary>
              <div class="xd-row" style="margin-top:6px"><input data-new placeholder="marketId (e.g. mainnet:…)" style="flex:1 1 200px;width:auto"><select data-origin style="flex:0 1 200px"><option>RADAR_DISCOVERED</option><option>PROJECT_REQUESTED</option></select><button class="ghost" data-create>Create</button></div></details>
          </div>
        </div>
        <div class="card"><h3>Transition log <span class="muted" style="font-weight:400;font-size:12px">sha256 hash-chained · newest first</span></h3>${logTable(current.log)}</div>`;
      body.querySelector('[data-sel]').onchange = (e) => { sel = e.target.value; renderLifecycle(); };
      const adv = body.querySelector('[data-adv]');
      if (adv) adv.onclick = async () => {
        if (busy) return; const msg = body.querySelector('[data-msg]');
        let payload; try { payload = JSON.parse(body.querySelector('[data-ev]').value || '{}'); } catch (e) { msg.innerHTML = `<p class="xd-flag">Invalid JSON: ${esc(e.message)}</p>`; return; }
        const appr = body.querySelector('[data-appr]');
        busy = true; adv.disabled = true;
        try {
          const r = await api.post(`/api/xdlc/corridors/${encodeURIComponent(sel)}/advance`, { to: nxt, evidence: payload.evidence || {}, funding: payload.funding, approved: appr ? appr.checked === true : undefined });
          await renderLifecycle(r.record.to);
        } catch (e) { msg.innerHTML = `<div class="xd-flag"><b>Rejected.</b><ul style="margin:4px 0;padding-left:16px">${(e.body?.reasons || [e.message]).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`; }
        finally { busy = false; adv.disabled = false; }
      };
      body.querySelector('[data-create]').onclick = async () => {
        const id = body.querySelector('[data-new]').value.trim(); if (!id) return;
        try { const c2 = await api.post('/api/xdlc/corridors', { marketId: id, origin: body.querySelector('[data-origin]').value }); sel = c2.id; renderLifecycle(); }
        catch (e) { body.querySelector('[data-msg]') && (body.querySelector('[data-msg]').innerHTML = `<p class="xd-flag">${esc(e.message)}</p>`); }
      };
    }

    // Presenter: step the rail through the selected corridor's recorded history.
    async function playLifecycle() {
      await setView('lifecycle');
      const r = body.querySelector('[data-rail]'); if (!r || !current) return;
      const states = ['DISCOVERY', ...current.log.map((x) => x.to)];
      r.querySelectorAll('li').forEach((li) => li.classList.remove('done', 'current', 'next'));
      states.forEach((s, i) => timers.push(setTimeout(() => {
        const items = [...r.querySelectorAll('li')];
        const idx = list.states.indexOf(s);
        items.forEach((li, j) => { li.classList.toggle('done', j < idx); li.classList.toggle('current', j === idx); li.classList.toggle('next', j === idx + 1 && i === states.length - 1); });
        items[idx]?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      }, 600 * i)));
    }

    // ---------- Radar ----------
    function facBars(c, animate) {
      const max = 30;
      return `<div class="xd-fac">${c.contributions.map((f) => { const w = Math.min(50, Math.abs(f.contribution) / max * 50); return `<div title="${esc(f.display)}"><span>${esc(f.label)} ${badge(f.provenance)}</span><span class="bar"><i class="${f.contribution >= 0 ? 'p' : 'n'}" data-w="${w.toFixed(1)}" style="width:${animate ? 0 : w.toFixed(1)}%"></i></span><span class="mono ${f.contribution < 0 ? 'neg' : ''}">${f.contribution > 0 ? '+' : ''}${f.contribution}</span><small>${esc(f.display)}</small></div>`; }).join('')}</div>`;
    }

    async function renderRadar(animate = false) {
      try { radar = await api.get('/api/xdlc/radar'); } catch (e) { body.innerHTML = `<div class="card err">Radar unavailable: ${esc(e.message)}</div>`; return; }
      el.querySelector('[data-engine]').textContent = radar.engine.label;
      const A = radar.model.assumptions;
      body.innerHTML = `
        <div class="card">
          <h3>TG Intelligence Opportunity Radar ${badge('SIMULATION')} <span class="muted" style="font-weight:400;font-size:12px">inputs ${badge('MAINNET_OBSERVED')} ${badge('LIVE_TESTNET')}</span></h3>
          <p class="xd-note">${esc(radar.adapter)} Engine: <b>${esc(radar.engine.label)}</b>.</p>
          <p class="muted" style="font-size:13px;margin:4px 0">Thin is not automatically profitable: markets whose modeled net benefit after costs is negative rank below every positive one. Origins: ${radar.origins.map((o) => `<span class="xd-chip">${esc(o)}</span>`).join(' ')}. Available capital: ${usd(radar.inputs.availableCapitalUsd)} authorized proprietary (${badge('SIMULATION')}); Tier 1/2 and Tier 3 never counted.</p>
          <details><summary>Model: ${esc(radar.model.name)} · ${radar.model.horizonDays}-day horizon · assumptions</summary><pre>${esc(JSON.stringify(A, null, 2))}</pre></details>
          ${radar.inputs.mainnetProfile ? `<p class="muted" style="font-size:12px;margin:6px 0 0">Mainnet sample ${badge('MAINNET_OBSERVED')} ${esc(radar.inputs.mainnetProfile.sampledAt)} · pathfound-flow maker HHI ${fmt(radar.inputs.mainnetProfile.hhi)} (read-only third-party activity).</p>` : ''}
          ${radar.inputs.noPathEvidence ? `<p class="muted" style="font-size:12px;margin:2px 0 0">NO_PATH evidence ${badge('LIVE_TESTNET')} (demo-generated, organic:false): ${Object.entries(radar.inputs.noPathEvidence.currencies).map(([k, v]) => `${esc(k)} ${v.count}`).join(' · ')}</p>` : ''}
          <p style="font-size:12px;margin:6px 0 0">${radar.attributionHtml || ''}</p>
        </div>
        <div class="card"><div class="xd-scroll"><table class="tf-stack" data-rt><thead><tr><th>#</th><th>Market</th><th>Origin</th><th class="num">Score</th><th>Net benefit ${radar.model.horizonDays}d (low / base / high)</th><th>Why</th></tr></thead><tbody>
          ${radar.ranking.map((c) => `<tr data-rank="${c.rank}">
            <td data-label="#">${c.rank}</td>
            <td data-label="Market"><b>${esc(c.pair)}</b> ${badge(c.provenance)}<br><span class="muted" style="font-size:11px">${esc(c.name)} · ${esc(c.network)}${c.role === 'INITIAL_CORRIDOR' ? ' · initial corridor' : ''}${c.candidate ? '' : ` · <span class="neg">excluded: ${esc(c.exclusion)}</span>`}</span></td>
            <td data-label="Origin"><span class="xd-chip">${esc(c.origin)}</span></td>
            <td data-label="Score" class="num xd-score ${c.score < 0 ? 'neg' : ''}">${c.score}</td>
            <td data-label="Net benefit"><span class="${c.economics.netBenefitUsd.low < 0 ? 'neg' : 'pos'}">${usd(c.economics.netBenefitUsd.low)}</span> / <b class="${c.economics.netBenefitUsd.base < 0 ? 'neg' : 'pos'}">${usd(c.economics.netBenefitUsd.base)}</b> / <span class="${c.economics.netBenefitUsd.high < 0 ? 'neg' : 'pos'}">${usd(c.economics.netBenefitUsd.high)}</span> ${badge('SIMULATION')}<br><span class="muted" style="font-size:11px">on ${usd(c.economics.deployUsd)} deployed · reserve ${c.economics.reserveLockedXrp} XRP locked (not profit)</span></td>
            <td data-label="Why"><details ${c.rank <= 1 ? 'open' : ''}><summary>${esc(c.rationale[c.rationale.length - 1])}</summary><ul style="margin:4px 0;padding-left:16px">${c.rationale.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${facBars(c, animate)}</details></td></tr>`).join('')}
        </tbody></table></div>
        ${radar.engineView?.length ? `<p class="muted" style="font-size:12px">Engine view (${esc(radar.engine.label)}): ${radar.engineView.map((r) => esc(r.rationale)).join(' · ')}</p>` : ''}
        <p class="muted" style="font-size:12px">${esc(radar.provenanceNote)}</p></div>`;
      if (animate) requestAnimationFrame(() => body.querySelectorAll('.xd-fac i').forEach((i) => (i.style.width = `${i.dataset.w}%`)));
    }

    async function playRadar() {
      await setView('radar');
      await renderRadar(true);
      const rows = [...body.querySelectorAll('[data-rt] tbody tr')].slice(0, 5);
      rows.forEach((tr, i) => timers.push(setTimeout(() => {
        rows.forEach((x) => x.classList.remove('xd-hi')); tr.classList.add('xd-hi');
        const d = tr.querySelector('details'); if (d) { d.open = true; d.querySelectorAll('.xd-fac i').forEach((b) => (b.style.width = `${b.dataset.w}%`)); }
        tr.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      }, 900 * i)));
    }

    window.addEventListener('tf:present', (e) => {
      const scene = e?.detail?.scene;
      if (scene === 'radar') { api.show('xdlc-app'); playRadar(); }
      else if (scene === 'lifecycle') { api.show('xdlc-app'); playLifecycle(); }
    });
    api.on((ev) => { if (ev.type === 'xdlc.transition' && view === 'lifecycle' && !busy) renderLifecycle(ev.to); });

    try { const r = await api.get('/api/xdlc/radar'); el.querySelector('[data-engine]').textContent = r.engine.label; } catch { el.querySelector('[data-engine]').textContent = 'unavailable'; }
    await renderLifecycle();
  },
};
