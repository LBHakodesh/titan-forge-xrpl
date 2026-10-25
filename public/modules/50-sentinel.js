// TG Sentinel: universal observability (coverage map, findings, audit history) + read-only token security scans
// + guided SIMULATION exercise. Records and recommends only: nothing here authorizes spending or moves capital.
const STYLE = `
.sen .sen-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.sen .sen-row select { width:auto; min-width:140px; flex:1 1 160px; max-width:320px; }
.sen .sen-counts { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0 0; }
.sen .sen-sev { display:inline-block; white-space:nowrap; flex:none; font:600 11px var(--mono); padding:2px 6px; border-radius:4px; text-transform:uppercase; letter-spacing:.04em; }
.sen .sen-sev.high { color:var(--bad); background:var(--bad-bg); }
.sen .sen-sev.medium { color:var(--sim); background:var(--sim-bg); }
.sen .sen-sev.low { color:var(--accent); background:var(--bg); border:1px solid var(--line); }
.sen .sen-sev.info { color:var(--muted); background:var(--bg); border:1px solid var(--line); }
.sen .sen-group h3 { margin:16px 0 8px; }
.sen details.sen-f { border:1px solid var(--line); border-radius:8px; padding:8px 10px; margin-bottom:8px; background:var(--bg); }
.sen details.sen-f summary { cursor:pointer; display:flex; gap:8px; align-items:baseline; list-style:none; }
.sen details.sen-f summary::-webkit-details-marker { display:none; }
.sen details.sen-f summary::before { content:'▸'; color:var(--muted); }
.sen details.sen-f[open] summary::before { content:'▾'; }
.sen .sen-f dl { margin:8px 0 0; display:grid; grid-template-columns:minmax(90px,max-content) 1fr; gap:4px 12px; font-size:13px; }
.sen .sen-f dt { color:var(--muted); } .sen .sen-f dd { margin:0; overflow-wrap:anywhere; }
.sen .sen-scroll { overflow-x:auto; }
.sen .sen-ok { color:var(--live); font-weight:600; } .sen .sen-no { color:var(--bad); font-weight:600; }
.sen .sen-q { border:1px solid var(--line); border-radius:8px; padding:12px; margin-bottom:12px; background:var(--bg); }
.sen .sen-q pre { background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:8px; overflow-x:auto; font:12px var(--mono); margin:8px 0; white-space:pre-wrap; word-break:break-word; }
.sen .sen-choices { display:grid; gap:6px; margin:8px 0; }
.sen .sen-choices button { text-align:left; }
.sen .sen-choices button.right { border-color:var(--live); color:var(--live); }
.sen .sen-choices button.wrong { border-color:var(--bad); color:var(--bad); }
.sen .sen-reveal { border-left:3px solid var(--accent); padding-left:10px; font-size:14px; }
.sen .sen-reveal p { margin:4px 0; }
.sen .sen-nav { display:flex; gap:8px; justify-content:space-between; align-items:center; flex-wrap:wrap; }
.sen .tgs-statement { border-left:3px solid var(--accent); padding:8px 10px; background:var(--bg); border-radius:0 6px 6px 0; font-size:14px; margin:8px 0; }
.sen .tgs-totals { display:flex; flex-wrap:wrap; gap:6px 12px; align-items:center; font-size:13px; margin-top:6px; }
.sen .tgs-cov { display:grid; gap:8px; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); margin-top:10px; }
.sen .tgs-tile { border:1px solid var(--line); border-radius:8px; padding:8px 10px; background:var(--bg); text-align:left; color:var(--ink); font:inherit; cursor:pointer; min-width:0; display:flex; flex-direction:column; gap:4px; }
.sen .tgs-tile[aria-pressed="true"] { border-color:var(--accent); box-shadow:inset 0 0 0 1px var(--accent); }
.sen .tgs-tile.unavailable { border-style:dashed; }
.sen .tgs-tile b { font-size:13px; line-height:1.25; }
.sen .tgs-tile .tgs-meta { font-size:11px; color:var(--muted); }
.sen .tgs-chips { display:flex; flex-wrap:wrap; gap:4px; }
.sen .tgs-st { display:inline-block; font:600 10px var(--mono); padding:1px 5px; border-radius:4px; letter-spacing:.04em; }
.sen .tgs-st.observed { color:var(--live); background:var(--live-bg); }
.sen .tgs-st.reported { color:var(--sim); background:var(--sim-bg); }
.sen .tgs-st.unavailable, .sen .tgs-st.pending { color:var(--muted); border:1px dashed var(--muted); }
.sen .badge.reported { color:var(--sim); background:var(--bg); border:1px dashed var(--sim); }
.sen .badge.unav { color:var(--muted); background:var(--bg); border:1px dashed var(--muted); }
.sen .sen-sev.critical { color:#fff; background:var(--bad); }
.sen .tgs-filters { display:grid; gap:8px; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); margin-bottom:10px; }
.sen .tgs-filters label { margin:0 0 2px; font-size:12px; }
.sen .tgs-top { list-style:none; padding:0; margin:8px 0 0; display:grid; gap:6px; }
.sen .tgs-top li { border:1px solid var(--line); border-radius:6px; padding:6px 8px; background:var(--bg); display:flex; flex-wrap:wrap; gap:6px; align-items:center; font-size:13px; }
.sen .tgs-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
.sen .tgs-scroll table { min-width:640px; }
.sen tr.tgs-row { cursor:pointer; } .sen tr.tgs-row:hover td { background:var(--bg); }
.sen tr.tgs-ev td { background:var(--bg); font-size:12px; }
.sen .tgs-tabs { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
.sen .tgs-tabs button[aria-pressed="true"] { border-color:var(--accent); color:var(--accent); }
.sen .tgs-flash { animation: tgs-flash 1.6s ease-out 2; }
@keyframes tgs-flash { 0% { box-shadow:0 0 0 0 var(--accent); } 40% { box-shadow:0 0 0 6px var(--accent); } 100% { box-shadow:0 0 0 0 transparent; } }
@media (prefers-reduced-motion: reduce) { .sen .tgs-flash { animation:none; outline:3px solid var(--accent); } }
@media (max-width: 520px) { .sen .tgs-cov { grid-template-columns:1fr 1fr; } .sen .tgs-tile b { font-size:12px; } }
`;
const SEV = ['high', 'medium', 'low', 'info'];
const SEV_LABEL = { high: 'High', medium: 'Medium', low: 'Low', info: 'Info / passing' };

export default {
  id: 'sentinel', title: 'Sentinel', order: 50,
  async mount(el, api) {
    const e = api.esc;
    if (!document.getElementById('sen-style')) { const s = document.createElement('style'); s.id = 'sen-style'; s.textContent = STYLE; document.head.append(s); }
    el.classList.add('sen');
    el.innerHTML = `
      <div class="card" data-tgs-head>
        <h2 style="margin:0">TG Sentinel: universal observability</h2>
        <div class="tgs-statement"><b>Records and recommends only.</b> TG Sentinel does not authorize spending, sign transactions or move capital. Every finding carries its provenance; nothing is shown without evidence or a recorded report.</div>
        <div class="tgs-totals" data-tgs-totals><span class="muted">Loading coverage…</span></div>
      </div>
      <div class="card" data-tgs-covcard>
        <div class="sen-row" style="justify-content:space-between"><h2 style="margin:0">System coverage map</h2><button class="ghost" data-tgs-refresh>Refresh</button></div>
        <p class="muted" style="font-size:13px;margin:6px 0 0">Each subsystem: is it observed on this node, when was it last checked, and its open findings by severity. Tap a tile to filter the findings table. Unavailable sources are shown as unavailable, never assumed.</p>
        <div class="tgs-cov" data-tgs-cov></div>
        <h3 style="margin:14px 0 0">Top open findings</h3>
        <ul class="tgs-top" data-tgs-top></ul>
      </div>
      <div class="card" data-tgs-findcard>
        <h2>All findings</h2>
        <div class="tgs-filters" data-tgs-filters></div>
        <div class="tgs-scroll" data-tgs-table><p class="muted">Loading…</p></div>
      </div>
      <div class="card">
        <h2>Audit history</h2>
        <p class="muted" style="font-size:13px;margin:0 0 8px">From the registry's append-only, SHA-256 hash-chained change log. <span data-tgs-chain></span></p>
        <div class="tgs-tabs" role="group" aria-label="Audit filter"><button class="ghost" data-tgs-kind="changes" aria-pressed="true">Changes</button><button class="ghost" data-tgs-kind="status" aria-pressed="false">Status changes</button><button class="ghost" data-tgs-kind="all" aria-pressed="false">Everything</button></div>
        <div class="tgs-scroll" data-tgs-audit><p class="muted">Loading…</p></div>
      </div>
      <div class="card">
        <h2>Titan Sentinel: project security ${api.badge('LIVE_TESTNET')}</h2>
        <p class="muted">Read-only inspection of each launched token on the validated XRPL Testnet ledger: issuer flags, keys, trustlines, supply and book concentration, offer funding, demo-activity labeling and transaction re-verification. Sentinel never signs or submits anything.</p>
        <div class="sen-row"><label for="sen-pick" style="margin:0">Token</label><select id="sen-pick"><option>Loading…</option></select>
          <button class="ghost" id="sen-refresh">Rescan</button><span class="muted" id="sen-meta"></span></div>
        <div class="sen-counts" id="sen-counts"></div>
      </div>
      <div class="card"><h2>Findings</h2><div id="sen-findings" class="muted">Loading…</div></div>
      <div class="card"><h2>Ledger verification ${api.badge('LIVE_TESTNET')}</h2><p class="muted">Every recorded launch step hash re-fetched with <span class="mono">tx</span>: must be validated, tesSUCCESS and in the recorded ledger.</p><div id="sen-verify" class="sen-scroll muted">Loading…</div></div>
      <div class="card"><h2>Security exercise ${api.badge('SIMULATION')}</h2><p class="muted">Six made-up bad configurations. Pick what you think the risk is, then see which Sentinel or Guardian control catches it and what it cannot protect against.</p><div id="sen-ex">Loading…</div></div>
      <div class="card"><h2>Guardian demo ${api.badge('SIMULATION')}</h2><p class="muted">Proposed actions run through the real <span class="mono">guardCheck()</span> authorization rules. Nothing is submitted.</p><div id="sen-guard" class="sen-scroll">Loading…</div></div>`;

    const $ = (s) => el.querySelector(s);
    const pick = $('#sen-pick');
    const sev = (s) => `<span class="sen-sev ${e(s)}">${e(s)}</span>`;
    const short = (h) => `${e(String(h).slice(0, 12))}…`;
    let current = null;

    async function loadList() {
      try {
        const s = await api.get('/api/sentinel');
        if (!s.tokens.length) { pick.innerHTML = '<option value="">No live tokens</option>'; $('#sen-findings').textContent = 'No launched tokens yet.'; $('#sen-verify').textContent = ''; return; }
        const prev = current || pick.value;
        pick.innerHTML = s.tokens.map((t) => `<option value="${e(t.code)}">${e(t.code)} · ${e(t.name)}${t.counts ? ` (${t.counts.high}H/${t.counts.medium}M)` : ''}</option>`).join('');
        if (prev && s.tokens.some((t) => t.code === prev)) pick.value = prev;
        await loadReport(pick.value);
      } catch (err) {
        pick.innerHTML = '<option value="">Unavailable</option>';
        $('#sen-findings').innerHTML = `<p class="err">Sentinel unavailable: ${e(err.message)}</p><p class="muted">Testnet may be offline. The exercise below still works.</p>`;
        $('#sen-verify').textContent = '';
      }
    }

    function renderFinding(f) {
      const links = (f.links || []).map((l) => `<a href="${e(l.href)}" target="_blank" rel="noopener">${e(l.label)}</a>`).join(' · ');
      return `<details class="sen-f"${f.severity === 'high' || f.severity === 'medium' ? ' open' : ''}>
        <summary>${sev(f.severity)} <span><b>${e(f.title)}</b></span></summary>
        <dl><dt>Evidence</dt><dd>${e(f.evidence)}</dd>
          <dt>What it protects</dt><dd>${e(f.whatItProtects)}</dd>
          <dt>Limits</dt><dd>${e(f.limits)}</dd>
          <dt>Mode</dt><dd>${api.badge(f.mode)} <span class="mono">${e(f.id)}</span></dd>
          ${links ? `<dt>Explorer</dt><dd>${links}</dd>` : ''}</dl></details>`;
    }

    async function loadReport(code) {
      if (!code) return;
      current = code;
      $('#sen-findings').innerHTML = '<span class="muted">Scanning Testnet…</span>';
      try {
        const r = await api.get(`/api/sentinel/${encodeURIComponent(code)}`);
        if (current !== code) return;
        $('#sen-meta').innerHTML = `${api.badge(r.mode)} ledger ${e(r.validatedLedger ?? '?')} · scanned ${e(new Date(r.scannedAt).toLocaleTimeString())}${r.cached ? ` (cached ${Math.round(r.ageMs / 1000)}s)` : ''}`;
        $('#sen-counts').innerHTML = SEV.map((s) => `${sev(s)} <span class="muted">${r.counts[s]}</span>`).join(' ');
        const demo = `<p class="muted">${api.badge('LIVE_TESTNET')} <b>${e(r.code)}</b> is a demo token. organic=${e(r.organic)}: every current fill was generated by accounts we control and is not evidence of organic demand.</p>`;
        $('#sen-findings').innerHTML = demo + SEV.map((s) => {
          const fs = r.findings.filter((f) => f.severity === s);
          return fs.length ? `<div class="sen-group"><h3>${sev(s)} ${SEV_LABEL[s]} (${fs.length})</h3>${fs.map(renderFinding).join('')}</div>` : '';
        }).join('') + (r.fetchErrors?.length ? `<p class="err">Some reads failed: ${e(r.fetchErrors.join('; '))}</p>` : '');
        $('#sen-verify').innerHTML = r.verification.length ? `<table><thead><tr><th>Step</th><th>Type</th><th>Hash</th><th class="num">Ledger</th><th>Result</th><th>Validated</th><th></th></tr></thead><tbody>${r.verification.map((v) => `
          <tr><td>${e(v.key)}</td><td>${e(v.type ?? '')}</td><td class="mono"><a href="${e(v.explorer)}" target="_blank" rel="noopener">${short(v.hash)}</a></td>
          <td class="num">${e(v.ledger ?? '—')}</td><td class="mono">${e(v.result ?? v.error ?? '—')}</td><td>${v.validated ? 'yes' : 'no'}</td>
          <td>${v.ok ? '<span class="sen-ok">✓ OK</span>' : '<span class="sen-no">✕ FAIL</span>'}</td></tr>`).join('')}</tbody></table>` : '<span class="muted">No recorded transaction hashes.</span>';
      } catch (err) {
        $('#sen-findings').innerHTML = `<p class="err">Scan failed: ${e(err.message)}</p>`;
      }
    }

    pick.onchange = () => loadReport(pick.value);
    $('#sen-refresh').onclick = () => loadReport(pick.value);

    // Exercise (SIMULATION)
    let ex = null, idx = 0, score = 0;
    const answered = new Map();
    function renderEx() {
      const s = ex.scenarios[idx];
      const a = answered.get(s.id);
      $('#sen-ex').innerHTML = `<div class="sen-q">
        <div class="sen-nav"><b>${idx + 1} / ${ex.scenarios.length}: ${e(s.title)}</b> ${api.badge('SIMULATION')}</div>
        <pre>${e(JSON.stringify(s.config, null, 2))}</pre>
        <div>${e(s.question)}</div>
        <div class="sen-choices">${s.choices.map((c, i) => `<button class="ghost ${a != null ? (c.ok ? 'right' : i === a ? 'wrong' : '') : ''}" data-c="${i}" ${a != null ? 'disabled' : ''}>${e(c.t)}</button>`).join('')}</div>
        ${a != null ? `<div class="sen-reveal">
          <p><b>${s.choices[a].ok ? 'Correct.' : 'Not quite.'}</b> ${e(s.choices.find((c) => c.ok).t)}.</p>
          <p><b>What catches it:</b> ${e(s.catches)}</p>
          <p><b>Control:</b> ${e(s.control)}</p>
          <p><b>Limits:</b> ${e(s.limits)}</p></div>` : ''}
        <div class="sen-nav" style="margin-top:10px">
          <button class="ghost" data-nav="-1" ${idx === 0 ? 'disabled' : ''}>← Back</button>
          <span class="muted">Score ${score} / ${answered.size}</span>
          <button class="ghost" data-nav="1" ${idx === ex.scenarios.length - 1 ? 'disabled' : ''}>Next →</button></div></div>`;
      $('#sen-ex').querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { const i = Number(b.dataset.c); answered.set(s.id, i); if (s.choices[i].ok) score++; renderEx(); });
      $('#sen-ex').querySelectorAll('[data-nav]').forEach((b) => b.onclick = () => { idx = Math.max(0, Math.min(ex.scenarios.length - 1, idx + Number(b.dataset.nav))); renderEx(); });
    }
    try {
      ex = await api.get('/api/sentinel/exercise');
      renderEx();
      $('#sen-guard').innerHTML = `<table><thead><tr><th>Proposed action</th><th>Mode</th><th>Verdict</th><th>Reasons</th></tr></thead><tbody>${ex.guardian.map((g) => `
        <tr><td>${e(g.label)}<div class="mono muted">${e(g.proposal.txType ?? '')}${g.proposal.role ? ' · ' + e(g.proposal.role) : ''}</div></td><td>${api.badge(g.proposal.mode)}</td>
        <td>${g.verdict.allowed ? '<span class="sen-ok">Allowed</span>' : '<span class="sen-no">Blocked</span>'}</td>
        <td>${e(g.verdict.reasons.join(' ') || '—')}</td></tr>`).join('')}</tbody></table>
        <p class="muted">Guardian limits what our own demo system may propose. It cannot restrict what an outside issuer or key holder does on the ledger; that is what Sentinel's monitoring is for.</p>`;
    } catch (err) { $('#sen-ex').innerHTML = `<p class="err">${e(err.message)}</p>`; $('#sen-guard').textContent = ''; }

    // ---------- TG Sentinel universal view ----------
    const PCLASS = ['LIVE_TESTNET', 'MAINNET_OBSERVED', 'REPORTED', 'REPLAY', 'SIMULATION', 'UNAVAILABLE'];
    const SEV5 = ['critical', 'high', 'medium', 'low', 'info'];
    const pbadge = (p) => p === 'REPORTED' ? '<span class="badge reported" title="Recorded report; not reproduced on this node">REPORTED</span>' : p === 'UNAVAILABLE' ? '<span class="badge unav">UNAVAILABLE</span>' : api.badge(p);
    const when = (t) => (t ? e(String(t).replace('T', ' ').replace(/\.\d+Z$/, 'Z')) : '—');
    const ago = (t) => { const s = Math.round((Date.now() - Date.parse(t)) / 1000); return !t || !Number.isFinite(s) ? '—' : s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };
    const tg = { cov: null, list: [], filters: { subsystem: '', severity: '', provenance: '', status: '', q: '' }, kind: 'changes', open: null };

    function renderCoverage(c) {
      const t = c.totals;
      $('[data-tgs-totals]').innerHTML = `<span><b>${e(t.findings)}</b> findings (${e(t.open)} open)</span>`
        + PCLASS.filter((p) => t.byProvenance[p]).map((p) => `<span>${pbadge(p)} <b class="mono">${e(t.byProvenance[p])}</b></span>`).join('')
        + `<span class="muted">${e(t.observed)} of ${e(t.subsystems)} subsystems observed · ${e(t.reported)} reported · ${e(t.unavailable)} unavailable · collectors ran ${e(ago(c.lastRun))}</span>`;
      $('[data-tgs-cov]').innerHTML = c.subsystems.map((s) => {
        const chips = SEV5.filter((k) => s.open[k]).map((k) => `<span style="white-space:nowrap">${sev(k)} <span class="mono" style="font-size:11px">${s.open[k]}</span></span>`).join(' ');
        const provs = Object.entries(s.openByProvenance || {}).map(([p, n]) => `<span style="white-space:nowrap">${pbadge(p)} <span class="mono" style="font-size:11px">${n}</span></span>`).join(' ');
        return `<button class="tgs-tile ${e(s.observed)}" data-sub="${e(s.id)}" aria-pressed="${tg.filters.subsystem === s.id}" title="${e(s.reason || s.sources.map((x) => `${x.collector}: ${x.status}`).join(', '))}">
          <span class="sen-row" style="gap:6px"><span class="tgs-st ${e(s.observed)}">${e(s.observed.toUpperCase())}</span></span>
          <b>${e(s.label)}</b>
          <span class="tgs-chips">${chips || '<span class="muted" style="font-size:12px">no open findings</span>'}</span>
          ${provs ? `<span class="tgs-chips">${provs}</span>` : ''}
          <span class="tgs-meta">checked ${e(ago(s.lastCheck))}${s.observed === 'unavailable' && s.reason ? ` · ${e(s.reason.slice(0, 90))}` : ''}</span>
          ${s.dataSource ? `<span class="tgs-meta" data-tgs-source>${e(s.dataSource)}</span>` : ''}</button>`;
      }).join('');
      for (const b of el.querySelectorAll('[data-sub]')) b.onclick = () => { tg.filters.subsystem = tg.filters.subsystem === b.dataset.sub ? '' : b.dataset.sub; renderCoverage(tg.cov); renderFilters(); renderTable(); $('[data-tgs-findcard]').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      $('[data-tgs-top]').innerHTML = c.topFindings.length ? c.topFindings.map((f) => `<li>${sev(f.severity)} ${pbadge(f.provenance)} <span class="mono">${e(f.id)}</span> <span>${e(f.title)}</span> <span class="muted">· ${e(f.affectedSystem)} · ${e(f.owner)}</span></li>`).join('') : '<li class="muted">No open findings.</li>';
    }

    function renderFilters() {
      const opt = (k, vals, label, fmt = (x) => x) => `<div><label for="tgs-${k}">${label}</label><select id="tgs-${k}" data-tf="${k}"><option value="">All</option>${vals.map(([v, l]) => `<option value="${e(v)}" ${tg.filters[k] === v ? 'selected' : ''}>${e(fmt(l))}</option>`).join('')}</select></div>`;
      const subs = (tg.cov?.subsystems || []).map((s) => [s.id, s.label]);
      $('[data-tgs-filters]').innerHTML = opt('subsystem', subs, 'Affected system') + opt('severity', SEV5.map((x) => [x, x]), 'Severity')
        + opt('provenance', PCLASS.map((x) => [x, x.replace(/_/g, ' ')]), 'Provenance') + opt('status', ['open', 'investigating', 'mitigation-proposed', 'resolved', 'accepted'].map((x) => [x, x]), 'Status')
        + `<div><label for="tgs-q">Search</label><input id="tgs-q" data-tf="q" placeholder="id, title" value="${e(tg.filters.q)}"></div>`;
      for (const x of el.querySelectorAll('[data-tf]')) x.addEventListener(x.tagName === 'INPUT' ? 'input' : 'change', () => { tg.filters[x.dataset.tf] = x.value; if (x.dataset.tf === 'subsystem') renderCoverage(tg.cov); renderTable(); });
    }

    function renderTable() {
      const f = tg.filters, q = f.q.toLowerCase();
      const list = tg.list.filter((x) => (!f.subsystem || x.subsystem === f.subsystem) && (!f.severity || x.severity === f.severity) && (!f.provenance || x.provenance === f.provenance) && (!f.status || x.status === f.status) && (!q || `${x.id} ${x.title} ${x.affectedSystem}`.toLowerCase().includes(q)));
      if (!list.length) { $('[data-tgs-table]').innerHTML = '<p class="muted">No findings match these filters.</p>'; return; }
      $('[data-tgs-table]').innerHTML = `<p class="muted" style="font-size:12px;margin:0 0 6px">${list.length} finding(s). Tap a row for evidence.</p><table><thead><tr><th>ID</th><th>Severity</th><th>Finding</th><th>Affected system</th><th>Provenance</th><th>Owner</th><th>Remediation</th><th>Last seen</th><th class="num">Evidence</th></tr></thead><tbody>${list.map((x) => `
        <tr class="tgs-row" tabindex="0" data-fid="${e(x.id)}"><td class="mono">${e(x.id)}</td><td>${sev(x.severity)}</td><td>${e(x.title)}</td><td>${e(x.affectedSystem)}</td><td>${pbadge(x.provenance)}</td><td>${e(x.owner)}</td><td>${e(x.remediationStatus)} <span class="muted">· ${e(x.status)}</span></td><td class="mono">${when(x.timestamp)}</td><td class="num">${x.evidenceCount}</td></tr>
        ${tg.open === x.id ? `<tr class="tgs-ev"><td colspan="9">${x.evidenceCount ? x.evidence.map((v) => `<div><span class="badge unav">${e(v.kind)}</span> <span class="mono">${e(v.ref)}</span>${v.url ? ` <a href="${e(v.url)}" target="_blank" rel="noopener">explorer ↗</a>` : ''}</div>`).join('') + (x.evidenceCount > 3 ? `<div class="muted">+${x.evidenceCount - 3} more</div>` : '') : `<div><span class="badge reported">REPORTED</span> ${e(x.evidenceNote)}</div>`}
          <div class="muted" style="margin-top:4px">Verification ${e(x.verification)} · seen ${e(x.count)}× since ${when(x.firstSeen)} · <button class="ghost" style="padding:2px 8px;font-size:12px" data-full>Full record in Sentinel Findings</button></div></td></tr>` : ''}`).join('')}</tbody></table>`;
      for (const tr of el.querySelectorAll('tr[data-fid]')) { const go = () => { tg.open = tg.open === tr.dataset.fid ? null : tr.dataset.fid; renderTable(); }; tr.onclick = go; tr.onkeydown = (ev) => { if (ev.key === 'Enter') go(); }; }
      el.querySelector('[data-full]')?.addEventListener('click', (ev) => { ev.stopPropagation(); api.show('findings'); });
    }

    async function loadAudit() {
      for (const b of el.querySelectorAll('[data-tgs-kind]')) b.setAttribute('aria-pressed', b.dataset.tgsKind === tg.kind);
      try {
        const [a, v] = await Promise.all([api.get(`/api/sentinel/audit?kind=${tg.kind}&limit=25`), api.get('/api/findings/verify').catch(() => null)]);
        if (v) $('[data-tgs-chain]').innerHTML = `<span class="badge ${v.ok ? 'live' : 'bad'}">${v.ok ? `CHAIN VERIFIED · ${e(v.entries)} ENTRIES` : `CHAIN FAILED · ${e(v.problems.length)} PROBLEM(S)`}</span>`;
        $('[data-tgs-audit]').innerHTML = a.entries.length ? `<p class="muted" style="font-size:12px;margin:0 0 6px">Newest ${a.entries.length} of ${a.total}.</p><table><thead><tr><th class="num">Seq</th><th>At</th><th>Finding</th><th>Action</th><th>Status</th><th>Actor</th><th>Hash</th></tr></thead><tbody>${a.entries.map((h) => `<tr><td class="num">${e(h.seq)}</td><td class="mono">${when(h.at)}</td><td><span class="mono">${e(h.findingId)}</span> ${e(h.title.slice(0, 70))}</td><td>${e(h.action)}${h.severity ? ` <span class="muted">${e(h.severity.from)}→${e(h.severity.to)}</span>` : ''}${h.note ? ` <span class="muted">${e(h.note.slice(0, 80))}</span>` : ''}</td><td>${h.status ? `${e(h.status.from || '—')} → <b>${e(h.status.to)}</b>` : '—'}</td><td>${e(h.actor)}</td><td class="mono" style="font-size:11px" title="${e(h.hash)}">${e(String(h.hash).slice(0, 10))}…</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No entries.</p>';
      } catch (err) { $('[data-tgs-audit]').innerHTML = `<p class="err">${e(err.message)}</p>`; }
    }
    for (const b of el.querySelectorAll('[data-tgs-kind]')) b.onclick = () => { tg.kind = b.dataset.tgsKind; loadAudit(); };

    async function loadUniversal() {
      try {
        const [c, l] = await Promise.all([api.get('/api/sentinel/coverage'), api.get('/api/sentinel/findings')]);
        tg.cov = c; tg.list = l.findings;
        renderCoverage(c); renderFilters(); renderTable();
      } catch (err) { $('[data-tgs-cov]').innerHTML = `<p class="err">Coverage unavailable: ${e(err.message)}</p>`; }
      loadAudit();
    }
    $('[data-tgs-refresh]').onclick = loadUniversal;

    // Presentation hook: CustomEvent('tf:present', {detail:{scene:'sentinel'}}) scrolls to and highlights the coverage map + top findings.
    const present = async (ev) => {
      if (ev?.detail?.scene !== 'sentinel') return;
      if (!tg.cov) await loadUniversal();
      const card = $('[data-tgs-covcard]');
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      for (const x of [card, $('[data-tgs-top]')]) { x.classList.remove('tgs-flash'); void x.offsetWidth; x.classList.add('tgs-flash'); }
    };
    window.addEventListener('tf:present', present);

    let t = null, tu = null;
    api.on((ev) => {
      if (ev.type === 'launch.done') { clearTimeout(t); t = setTimeout(loadList, 2000); }
      if (String(ev.type).startsWith('findings.')) { clearTimeout(tu); tu = setTimeout(loadUniversal, 1500); }
    });
    loadUniversal();
    loadList();
  },
};
