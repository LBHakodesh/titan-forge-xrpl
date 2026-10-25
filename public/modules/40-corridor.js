// Demand & Corridor: explainable Demand Proof Score and the Titan Ghost spoke-to-corridor lifecycle.
const STYLE = `
.cor .cor-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.cor .cor-row select{width:auto;min-width:140px}
.cor .cor-gauges{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.cor .cor-gauge{border:1px solid var(--line);border-radius:8px;padding:10px;text-align:center}
.cor .cor-gauge svg{width:100%;max-width:170px;height:auto;display:block;margin:0 auto}
.cor .cor-gauge .cor-cap{font-size:12px;color:var(--muted)}
.cor .cor-tbl{overflow-x:auto}
.cor .cor-tbl td,.cor .cor-tbl th{white-space:nowrap}
.cor .cor-tbl td.cor-lbl{white-space:normal;min-width:150px}
.cor .cor-tbl small{display:block;color:var(--muted);font-size:11px;white-space:normal}
.cor .cor-ladder{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.cor .cor-step{flex:1 1 90px;border:1px solid var(--line);border-radius:6px;padding:6px 8px;font-size:12px;color:var(--muted);position:relative}
.cor .cor-step b{display:block;color:var(--ink);font-size:12px}
.cor .cor-step.on{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);color:var(--ink)}
.cor .cor-step.past{opacity:.75}
.cor .cor-step.standby{border-style:dashed}
.cor .cor-tr{font-size:13px;padding:6px 0;border-bottom:1px solid var(--line)}
.cor .cor-ok{color:var(--live)} .cor .cor-no{color:var(--bad)}
.cor .cor-bar{height:10px;border-radius:5px;background:var(--line);overflow:hidden}
.cor .cor-bar > i{display:block;height:100%;background:var(--accent)}
.cor .cor-bar.sim > i{background:var(--sim)}
.cor .cor-ring{display:grid;grid-template-columns:72px 1fr 120px;gap:8px;align-items:center;font-size:12px;margin:4px 0}
.cor .cor-share{display:flex;height:14px;border-radius:7px;overflow:hidden;border:1px solid var(--line)}
.cor .cor-share i{display:block;height:100%}
.cor .cor-note{border-left:3px solid var(--line);padding:4px 10px;margin:8px 0;font-size:13px}
.cor .cor-note.sim{border-color:var(--sim)} .cor .cor-note.live{border-color:var(--live)}
.cor .cor-verdict{font-size:13px;margin-top:8px;padding:8px;border-radius:6px;background:var(--bg)}
.cor .cor-verdict ul{margin:4px 0 0;padding-left:18px}
.cor .cor-btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.cor .cor-spark{width:100%;height:60px;display:block}
.cor .cor-chk{display:flex;gap:8px;align-items:flex-start;color:var(--ink);font-size:13px}
.cor .cor-chk input{width:auto;margin-top:3px}
.cor .cor-three{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}
.cor .cor-three div{border:1px solid var(--line);border-radius:6px;padding:8px;font-size:13px}
`;

const COLORS = { organic: 'var(--live)', demo: 'var(--muted)', sim: 'var(--sim)' };

function gauge(value, color, label) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const a = Math.PI * (1 - v / 100);
  const x = 60 + 48 * Math.cos(a), y = 60 - 48 * Math.sin(a);
  const arc = v > 0 ? `<path d="M12 60 A48 48 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"/>` : '';
  return `<svg viewBox="0 0 120 72" role="img" aria-label="${label}: ${value == null ? 'no data' : v}">
    <path d="M12 60 A48 48 0 0 1 108 60" fill="none" stroke="var(--line)" stroke-width="10" stroke-linecap="round"/>${arc}
    <text x="60" y="58" text-anchor="middle" font-size="22" font-weight="700" fill="var(--ink)">${value == null ? '—' : v.toFixed(v % 1 ? 1 : 0)}</text></svg>`;
}

function spark(points) {
  if (!points?.length) return '<p class="muted">Run a scenario to see the simulated trajectory.</p>';
  const w = 300, h = 60, n = points.length;
  const xy = points.map((p, i) => `${n === 1 ? w / 2 : (i / (n - 1)) * w},${h - (p.score / 100) * (h - 4) - 2}`);
  const thr = [35, 60, 80].map((t) => `<line x1="0" x2="${w}" y1="${h - (t / 100) * (h - 4) - 2}" y2="${h - (t / 100) * (h - 4) - 2}" stroke="var(--line)" stroke-dasharray="3 3"/>`).join('');
  return `<svg class="cor-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Simulated score trajectory">${thr}
    <polyline points="${xy.join(' ')}" fill="none" stroke="var(--sim)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

export default {
  id: 'corridor', title: 'Demand & Corridor', order: 40,
  async mount(el, api) {
    const { esc, badge } = api;
    if (!document.getElementById('cor-style')) { const s = document.createElement('style'); s.id = 'cor-style'; s.textContent = STYLE; document.head.append(s); }
    el.classList.add('cor');
    el.innerHTML = `
      <div class="card">
        <div class="cor-row" style="justify-content:space-between">
          <h2 style="margin:0">Demand Proof &amp; corridor graduation</h2>
          <div class="cor-row"><label for="cor-pick" style="margin:0">Token</label><select id="cor-pick"></select><button class="ghost" id="cor-refresh">Refresh</button></div>
        </div>
        <div class="cor-three" style="margin-top:10px" id="cor-three"></div>
      </div>
      <div id="cor-body"><div class="card muted">Loading…</div></div>`;
    const pick = el.querySelector('#cor-pick'), body = el.querySelector('#cor-body');
    let current = null, data = null, verdict = { LIVE_TESTNET: '', SIMULATION: '' }, busy = false;
    let allocTrack = 'SIMULATION';

    async function loadList() {
      const r = await api.get('/api/corridor?cached=1');
      const prev = pick.value || current;
      pick.innerHTML = r.tokens.map((t) => `<option value="${esc(t.code)}">${esc(t.code)} · ${esc(t.name)}</option>`).join('') || '<option value="">No tokens yet</option>';
      if (r.tokens.some((t) => t.code === prev)) pick.value = prev;
      current = pick.value || null;
    }

    async function load() {
      if (!current) { body.innerHTML = '<div class="card muted">Launch a token first (Launch tab). Every launched token gets a corridor state here.</div>'; return; }
      try { data = await api.get(`/api/corridor/${encodeURIComponent(current)}`); render(); }
      catch (e) { body.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
    }

    function scoreCol(s, id) { const c = s?.components.find((x) => x.id === id); return c ? (c.norm == null ? '<span class="muted">n/a</span>' : c.points.toFixed(1)) : '<span class="muted">—</span>'; }

    function trackCard(tr, mode) {
      const isSim = mode === 'SIMULATION';
      if (!tr) return `<div class="card"><h3>${isSim ? 'Simulation track' : 'Live track'} ${badge(mode)}</h3><p class="muted">No simulation yet. Run a scenario below; the simulated track starts from the live stage and the live organic baseline.</p></div>`;
      const stages = data.stages;
      const ladder = stages.filter((s) => s.id !== 'standby').map((s, i, arr) => {
        const idx = arr.findIndex((x) => x.id === tr.stage);
        return `<div class="cor-step ${s.id === tr.stage ? 'on' : idx > i ? 'past' : ''}"><b>${esc(s.label)}</b>${esc(s.id)} · ${ringsFor(s.id, tr.score)} rings</div>`;
      }).join('') + `<div class="cor-step standby ${tr.stage === 'standby' ? 'on' : ''}"><b>Optimized / standby</b>standby · 1 ring</div>`;
      const trs = tr.transitions.map((t) => `<div class="cor-tr">
          <span class="${t.thresholdsMet ? 'cor-ok' : 'cor-no'}">${t.thresholdsMet ? '✓' : '✕'}</span>
          <b>${t.kind === 'promote' ? 'Promote' : 'Demote'} → ${esc(t.to)}</b> ${t.requiresApproval ? '<span class="muted">(operator approval)</span>' : '<span class="muted">(reversible)</span>'}
          <div class="muted" style="font-size:12px">${esc(t.why || '')}</div>
          ${t.reasons.length ? `<div class="cor-no" style="font-size:12px">${t.reasons.map(esc).join(' ')}</div>` : ''}</div>`).join('');
      const promo = tr.transitions.find((t) => t.kind === 'promote');
      const demos = tr.transitions.filter((t) => t.kind === 'demote');
      return `<div class="card">
        <h3>${isSim ? 'Simulation track' : 'Live track'} ${badge(mode)} <span class="muted" style="font-weight:400">gated on ${isSim ? 'simulated' : 'organic (non-demo)'} score ${tr.score}</span></h3>
        <div class="cor-ladder">${ladder}</div>
        ${tr.demoteRecommended ? `<div class="cor-note sim"><b>Demotion recommended</b> → ${esc(tr.demoteRecommended.to)}: ${esc(tr.demoteRecommended.reason)}</div>` : ''}
        ${trs}
        <label class="cor-chk"><input type="checkbox" data-approve="${mode}"> I approve this ${isSim ? 'SIMULATION' : 'LIVE_TESTNET'} promotion as operator.</label>
        <div class="cor-btns">
          ${promo ? `<button class="primary" data-promote="${mode}" ${busy ? 'disabled' : ''}>Promote → ${esc(promo.to)}</button>` : ''}
          ${demos.map((d) => `<button class="ghost" data-demote="${mode}" data-to="${esc(d.to)}" ${busy ? 'disabled' : ''}>Demote → ${esc(d.to)}</button>`).join('')}
        </div>
        <div data-verdict="${mode}">${verdict[mode] || ''}</div>
        ${tr.history.length ? `<details style="margin-top:8px"><summary class="muted">Stage history (${tr.history.length})</summary>${tr.history.slice().reverse().map((h) => `<div class="mono">${esc(h.at.slice(0, 19))} ${esc(h.from)} → ${esc(h.to)} · score ${h.score} · ${esc(h.reason)}</div>`).join('')}</details>` : ''}
      </div>`;
    }

    function ringsFor(stage, score) { return { entered: 0, spoke: 2, growing_spoke: score >= 48 ? 4 : 3, corridor: 6, mature: 6, standby: 1 }[stage]; }

    function allocCard() {
      const tr = data.tracks[allocTrack === 'SIMULATION' && data.tracks.sim ? 'sim' : 'live'];
      const mode = tr.mode;
      const a = tr.allocation; const max = Math.max(1, ...a.rings.map((r) => r.allocUsd));
      const o = tr.ownership;
      const recs = tr.recommendations || [];
      return `<div class="card">
        <div class="cor-row" style="justify-content:space-between"><h3 style="margin:0">Ring allocation ${badge('SIMULATION')}</h3>
          <div class="cor-row"><button class="ghost" data-alloc="LIVE_TESTNET" ${mode === 'LIVE_TESTNET' ? 'aria-pressed="true" style="border-color:var(--accent)"' : ''}>Live track</button>
          <button class="ghost" data-alloc="SIMULATION" ${!data.tracks.sim ? 'disabled' : ''} ${mode === 'SIMULATION' ? 'aria-pressed="true" style="border-color:var(--accent)"' : ''}>Sim track</button></div></div>
        <p class="muted" style="font-size:12px">Modeled allocation for the ${esc(mode === 'SIMULATION' ? 'simulated' : 'live')} track's stage <b>${esc(tr.stage)}</b>: ${a.ringsActive} ring(s) active, modeled proprietary capital $${a.capitalUsd.toLocaleString()}, flowScale ${a.flowScale.toFixed(2)} (from ${mode === 'SIMULATION' ? 'simulated' : 'organic'} score). Capital and fills here are hypothetical: SIMULATION.<br>Engine: <b>${esc(data.engine.label)}</b></p>
        ${a.rings.length ? a.rings.map((r) => `<div class="cor-ring"><span class="mono">${esc(r.id)}</span><div class="cor-bar sim" title="utilization ${(r.utilization * 100).toFixed(0)}%"><i style="width:${(r.allocUsd / max) * 100}%"></i></div><span class="mono" style="text-align:right">$${r.allocUsd.toLocaleString()} · ${(r.utilization * 100).toFixed(0)}%</span></div>`).join('')
          : '<p class="muted">No rings active at this stage.</p>'}
        <p class="muted" style="font-size:12px">Deployed $${Math.round(a.deployedUsd).toLocaleString()} · idle $${Math.round(a.idleUsd).toLocaleString()} ${badge('SIMULATION')}</p>
        <h3 style="margin-top:12px">Liquidity ownership ${badge(mode === 'SIMULATION' ? 'SIMULATION' : data.scores.live.mode)}</h3>
        <div class="cor-share" role="img" aria-label="Proprietary ${Math.round(o.proprietaryShare * 100)}%, independent ${Math.round(o.independentShare * 100)}%"><i style="width:${o.proprietaryShare * 100}%;background:var(--accent)"></i><i style="width:${o.independentShare * 100}%;background:var(--live)"></i></div>
        <p style="font-size:12px"><span style="color:var(--accent)">■</span> ${esc(o.proprietaryLabel)} ${Math.round(o.proprietaryShare * 100)}% · <span style="color:var(--live)">■</span> independent providers ${Math.round(o.independentShare * 100)}% <span class="muted">(share of funded book depth)</span></p>
        ${tr.released ? `<div class="cor-note sim">Standby/demotion released <b>$${tr.released.usd.toLocaleString()}</b> of modeled proprietary capital ${badge('SIMULATION')}</div>` : ''}
        <h3 style="margin-top:12px">Recommendations</h3>
        ${recs.length ? recs.map((r) => `<div class="cor-note sim">${badge(r.mode)} <b>${esc(r.action)}</b> $${(r.amountUsd || 0).toLocaleString()} ${esc(r.fromMarket)} → ${esc(r.toMarket)} <span class="muted">(${esc(r.toKind)})</span><div class="muted" style="font-size:12px">${esc(r.rationale)} · ${esc(r.source)}</div></div>`).join('')
          : `<p class="muted" style="font-size:13px">${tr.demoteRecommended ? `Demote to ${esc(tr.demoteRecommended.to)} to release capital; the engine then recommends where it should go.` : 'None. Recommendations appear after a demotion/standby releases proprietary capital.'}</p>`}
      </div>`;
    }

    function render() {
      const d = data, s = d.scores, live = d.evidence.live, sim = d.evidence.sim;
      el.querySelector('#cor-three').innerHTML = `
        <div><b>XRP auto-bridging</b> <span class="muted">· existing XRPL feature</span><br><span class="muted">${esc(d.labels.autoBridging.replace(/^[^:]*:\s*/, ''))}</span></div>
        <div><b>Titan Ghost corridor lifecycle</b> <span class="muted">· our application logic</span><br><span class="muted">${esc(d.labels.lifecycle.replace(/^[^:]*:\s*/, ''))}</span></div>
        <div><b>XDLC</b> <span class="muted">· proposed amendment, not live</span><br><span class="muted">${esc(d.labels.xdlc.replace(/^[^:]*:\s*/, ''))}</span></div>`;
      const rows = s.live.organic.components.map((c, i) => {
        const def = d.scores.sim?.components[i];
        return `<tr><td class="cor-lbl">${esc(c.label)}<small>${esc(c.explain)}</small></td><td class="num">${c.weight.toFixed(1)}</td>
          <td class="num">${scoreCol(s.live.organic, c.id)}</td><td class="num">${scoreCol(s.live.demo, c.id)}</td><td class="num">${s.sim ? scoreCol(s.sim, c.id) : '—'}</td></tr>`;
      }).join('');
      const ev = (e) => e ? `${e.participants} accts · ${e.validatedTx} tx · ${(+e.depthXrp).toFixed(1)} XRP depth · ${e.fillDays} fill-days · ${(+e.volumeXrp).toFixed(1)} XRP vol · spread ${e.spreadBps == null ? 'n/a' : e.spreadBps + ' bps'}` : '—';
      body.innerHTML = `
        <div class="grid">
          <div class="card">
            <h3>Demand Proof Score · ${esc(d.code)}</h3>
            <div class="cor-gauges">
              <div class="cor-gauge">${gauge(s.live.organic.total, COLORS.organic, 'Organic score')}<b>Organic</b> ${badge(s.live.mode)}<div class="cor-cap">independent accounts only — the only score that gates live promotion</div></div>
              <div class="cor-gauge">${gauge(s.live.demo.total, COLORS.demo, 'Demo-generated score')}<b>Demo-generated</b> ${badge(s.live.mode)}<div class="cor-cap">our own demo accounts — not adoption evidence</div></div>
              <div class="cor-gauge">${gauge(s.sim ? s.sim.total : null, COLORS.sim, 'Simulated score')}<b>Simulated</b> ${badge('SIMULATION')}<div class="cor-cap">${sim ? `scenario model · day ${sim.period} · last: ${esc(sim.lastScenario)}` : 'no scenario run yet'}</div></div>
            </div>
            <div class="cor-note live">${badge(live.mode)} ${esc(live.note || '')}</div>
            <p class="muted" style="font-size:12px">Never used as evidence: nominal market cap, issuer-created volume. Quality components (spread, efficiency, cost, risk, Sentinel) count only once ≥ 5 independent participants exist.${s.live.organic.sentinelPresent ? '' : ' Sentinel input absent for live evidence — its weight is redistributed.'}</p>
          </div>
          <div class="card">
            <h3>Scenarios ${badge('SIMULATION')}</h3>
            <p class="muted" style="font-size:13px">Each click advances the model 7 simulated days. Simulated evidence is stored and scored separately from ledger evidence.</p>
            <div class="cor-btns">${Object.entries(d.scenarios).map(([k, v]) => `<button class="ghost" data-sim="${esc(k)}" title="${esc(v.explain)}" ${busy ? 'disabled' : ''}>${esc(v.label)}</button>`).join('')}<button class="ghost" data-sim="reset" ${busy ? 'disabled' : ''}>Reset</button></div>
            <div style="margin-top:8px">${spark(sim?.trajectory)}</div>
            ${sim ? `<p class="muted" style="font-size:12px">${badge('SIMULATION')} dashed lines: thresholds 35 / 60 / 80. ${esc(ev(sim.evidence))}</p>` : ''}
          </div>
        </div>
        <div class="card cor-tbl">
          <h3>Score breakdown (points)</h3>
          <table><thead><tr><th>Component</th><th class="num">Weight</th><th class="num">Organic ${badge(s.live.mode)}</th><th class="num">Demo ${badge(s.live.mode)}</th><th class="num">Simulated ${badge('SIMULATION')}</th></tr></thead>
          <tbody>${rows}<tr><th>Total</th><th class="num">100</th><th class="num">${s.live.organic.total}</th><th class="num">${s.live.demo.total}</th><th class="num">${s.sim ? s.sim.total : '—'}</th></tr></tbody></table>
          <details style="margin-top:8px"><summary class="muted">Raw evidence</summary>
            <p class="mono">Organic ${esc(live.mode)}: ${esc(ev(live.organic))}</p>
            <p class="mono">Demo ${esc(live.mode)}: ${esc(ev(live.demo))}</p>
            <p class="mono">Simulated SIMULATION: ${esc(ev(sim?.evidence))}</p>
            <p class="mono">Demo accounts (excluded from organic): ${(live.demoAccounts || []).map(esc).join(', ') || '—'}</p>
            ${(live.stepStatus || []).map((x) => `<div class="mono">${x.validated ? '●' : '○'} ${esc(x.key)} <a href="https://testnet.xrpl.org/transactions/${esc(x.hash)}" target="_blank" rel="noopener">${esc(x.hash.slice(0, 16))}…</a> ${esc(x.result || x.error || '')} · signed by demo account</div>`).join('')}
            ${live.ledger ? `<p class="mono">${badge(live.mode)} validated ledger ${live.ledger.validatedLedger} · reserves base ${live.ledger.reserveBaseXrp} / inc ${live.ledger.reserveIncXrp} XRP · as of ${esc(live.at || '')}</p>` : ''}
          </details>
        </div>
        <div class="grid">${trackCard(d.tracks.live, 'LIVE_TESTNET')}${trackCard(d.tracks.sim, 'SIMULATION')}</div>
        ${allocCard()}
        <details class="card"><summary><b>Promotion thresholds</b></summary>
          ${Object.entries(d.thresholds).map(([k, t]) => `<p style="font-size:13px"><b>${esc(k)}</b>: ${esc(t.why)}${t.hold != null ? ` <span class="muted">Hold level ${t.hold} (below it, demotion is recommended).</span>` : ''}</p>`).join('')}
          <p class="muted" style="font-size:13px">Every promotion also needs explicit operator approval and a Guardian check. Live promotion additionally needs organic evidence and enough funded maker XRP above reserves; if not, the same promotion is offered in SIMULATION.</p>
        </details>`;
    }

    function verdictHtml(r, mode) {
      const b = r.body || r;
      const ok = b.allowed !== false && !b.error;
      const g = b.guardian ? `<div>Guardian: ${b.guardian.allowed ? '<span class="cor-ok">allowed</span>' : '<span class="cor-no">blocked</span>'}${b.guardian.reasons?.length ? ' — ' + b.guardian.reasons.map(esc).join(' ') : ''}</div>` : '';
      const cap = b.capital ? `<div class="mono">${badge(b.capital.mode)} ${b.capital.mode === 'LIVE_TESTNET' ? `maker spendable ${b.capital.spendableXrp} XRP (balance ${b.capital.balanceXrp} − reserves ${b.capital.reservedXrp}) vs required ${b.capital.requiredXrp} XRP` : `modeled pool $${b.capital.poolUsd.toLocaleString()} vs $${b.capital.requiredUsd.toLocaleString()}`}</div>` : '';
      const offer = b.offer ? `<div style="margin-top:6px">${esc(b.offer.message)} <button class="ghost" data-offer="1">Promote in SIMULATION instead</button></div>` : '';
      return `<div class="cor-verdict">${badge(mode)} ${ok ? `<b class="cor-ok">${esc(b.from || '')} → ${esc(b.to || '')} done</b>` : '<b class="cor-no">Refused</b>'}
        ${b.reasons?.length ? `<ul>${b.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${b.error ? `<div class="cor-no">${esc(b.error)}</div>` : ''}${g}${cap}
        ${b.releasedUsd ? `<div>Released $${b.releasedUsd.toLocaleString()} modeled capital ${badge('SIMULATION')}</div>` : ''}${offer}</div>`;
    }

    async function act(fn, mode) {
      if (busy) return; busy = true;
      try { const r = await fn(); if (mode) verdict[mode] = verdictHtml(r, mode); }
      catch (e) { if (mode) verdict[mode] = verdictHtml(e.body || { error: e.message }, mode); else alert(e.message); }
      busy = false; await load();
    }

    el.addEventListener('click', (e) => {
      const t = e.target.closest('button'); if (!t || !current) return;
      const c = encodeURIComponent(current);
      if (t.dataset.sim) act(() => api.post(`/api/corridor/${c}/simulate`, { scenario: t.dataset.sim }));
      else if (t.dataset.promote) {
        const mode = t.dataset.promote;
        const approved = !!el.querySelector(`[data-approve="${mode}"]`)?.checked;
        act(() => api.post(`/api/corridor/${c}/promote`, { approved, mode }), mode);
      } else if (t.dataset.demote) act(() => api.post(`/api/corridor/${c}/demote`, { mode: t.dataset.demote, to: t.dataset.to }), t.dataset.demote);
      else if (t.dataset.offer) {
        if (!confirm('Approve this promotion as operator in SIMULATION mode? No capital moves; results are labeled SIMULATION.')) return;
        act(async () => { if (!data.tracks.sim) await api.post(`/api/corridor/${c}/simulate`, { scenario: 'growth' }); return api.post(`/api/corridor/${c}/promote`, { approved: true, mode: 'SIMULATION' }); }, 'SIMULATION');
      } else if (t.dataset.alloc) { allocTrack = t.dataset.alloc; render(); }
    });
    pick.addEventListener('change', () => { current = pick.value; verdict = { LIVE_TESTNET: '', SIMULATION: '' }; load(); });
    el.querySelector('#cor-refresh').addEventListener('click', async () => { await loadList(); load(); });

    let t = null;
    api.on((ev) => {
      if (ev.type === 'launch.done' || ev.type === 'launch.created') { loadList().then(load); return; }
      if (!busy && ev.type?.startsWith('corridor.') && ev.code === current) { clearTimeout(t); t = setTimeout(load, 300); }
    });

    await loadList(); await load();
  },
};
