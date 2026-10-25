// Titan Sentinel unified findings registry. Observes and recommends only: nothing on this tab can sign, pay,
// move liquidity, cancel offers, change permissions or disable services.
const STYLE = `
.tsf { overflow-wrap:anywhere; }
.tsf .tsf-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.tsf .tsf-row > * { min-width:0; }
.tsf .tsf-head { display:flex; flex-wrap:wrap; gap:8px; justify-content:space-between; align-items:flex-start; }
.tsf .tsf-head p { margin:4px 0 0; }
.tsf .tsf-tiles { display:grid; gap:10px; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); }
.tsf .tsf-tile { border:1px solid var(--line); border-radius:8px; padding:10px 12px; background:var(--bg); text-align:left; cursor:pointer; color:var(--ink); font:inherit; }
.tsf .tsf-tile[aria-pressed="true"] { border-color:var(--accent); box-shadow:inset 0 0 0 1px var(--accent); }
.tsf .tsf-tile .n { font:700 26px/1.1 system-ui, sans-serif; font-variant-numeric:tabular-nums; }
.tsf .tsf-tile .bk { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; font-size:12px; }
.tsf .tsf-sev { display:inline-block; font:600 11px var(--mono); padding:2px 6px; border-radius:4px; text-transform:uppercase; letter-spacing:.04em; }
.tsf .tsf-sev.critical { color:#fff; background:var(--bad); }
.tsf .tsf-sev.high { color:var(--bad); background:var(--bad-bg); }
.tsf .tsf-sev.medium { color:var(--sim); background:var(--sim-bg); }
.tsf .tsf-sev.low { color:var(--accent); background:var(--bg); border:1px solid var(--line); }
.tsf .tsf-sev.info { color:var(--muted); background:var(--bg); border:1px solid var(--line); }
.tsf .badge.tsf-unav { color:var(--muted); background:var(--bg); border:1px dashed var(--muted); }
.tsf .badge.v-CONFIRMED { color:var(--live); background:var(--live-bg); }
.tsf .badge.v-SUSPECTED { color:var(--sim); background:var(--sim-bg); }
.tsf .badge.v-SIMULATED { color:var(--replay); background:var(--replay-bg); }
.tsf .badge.v-INFORMATIONAL { color:var(--muted); background:var(--bg); border:1px solid var(--line); }
.tsf .badge.v-UNVERIFIED_EXTERNAL { color:var(--bad); background:var(--bad-bg); border:1px dashed var(--bad); }
.tsf .badge.v-MISSING { color:var(--bad); background:var(--bad-bg); }
.tsf .tsf-filters { display:grid; gap:8px; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); }
.tsf .tsf-filters label { margin:0 0 2px; }
.tsf .tsf-views { display:flex; flex-wrap:wrap; gap:6px; margin:12px 0; }
.tsf .tsf-views button[aria-pressed="true"] { border-color:var(--accent); color:var(--accent); }
.tsf .tsf-feat { border:1px solid var(--line); border-radius:8px; padding:12px; background:var(--bg); }
.tsf .tsf-feat.unverified { border:2px dashed var(--bad); }
.tsf .tsf-feat h3 { margin:6px 0; }
.tsf .tsf-lesson { border-left:3px solid var(--accent); padding-left:10px; font-size:14px; margin:8px 0; }
.tsf .tsf-warn { border-left:3px solid var(--bad); padding:6px 10px; background:var(--bad-bg); color:var(--ink); border-radius:0 6px 6px 0; font-size:14px; margin:8px 0; }
.tsf table tr.tsf-click { cursor:pointer; }
.tsf table tr.tsf-click:hover td, .tsf table tr.tsf-click:focus td { background:var(--bg); }
.tsf dl.tsf-kv { margin:8px 0; display:grid; grid-template-columns:minmax(90px,max-content) 1fr; gap:4px 12px; font-size:13px; }
.tsf dl.tsf-kv dt { color:var(--muted); } .tsf dl.tsf-kv dd { margin:0; min-width:0; }
.tsf .tsf-ev { list-style:none; padding:0; margin:6px 0; display:grid; gap:6px; }
.tsf .tsf-ev li { border:1px solid var(--line); border-radius:6px; padding:6px 8px; background:var(--bg); font-size:13px; }
.tsf .tsf-sec { margin-top:14px; } .tsf .tsf-sec h3 { margin-bottom:6px; }
.tsf .tsf-group { border:1px solid var(--line); border-radius:8px; padding:10px 12px; margin-bottom:8px; background:var(--bg); }
.tsf .tsf-group ul { margin:6px 0 0; padding-left:18px; }
.tsf .tsf-group button.linkish { background:none; border:0; padding:0; color:var(--accent); cursor:pointer; font:inherit; text-align:left; }
.tsf .tsf-src { list-style:none; padding:0; margin:0; display:grid; gap:6px; }
.tsf .tsf-src li { display:grid; grid-template-columns:auto 1fr; gap:4px 10px; align-items:baseline; border-bottom:1px solid var(--line); padding:6px 0; font-size:13px; }
.tsf .dot { width:9px; height:9px; border-radius:50%; display:inline-block; }
.tsf .dot.on { background:var(--live); } .tsf .dot.off { background:var(--muted); border:1px solid var(--muted); background:transparent; }
.tsf .tsf-form { display:grid; gap:8px; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); align-items:end; }
.tsf .tsf-form button { width:100%; }
.tsf .tsf-hash { font:11px var(--mono); color:var(--muted); }
`;
const SEV = ['critical', 'high', 'medium', 'low', 'info'];
const PROVS = ['LIVE_TESTNET', 'MAINNET_OBSERVED_READ_ONLY', 'REPLAY', 'SIMULATION', 'UNAVAILABLE'];
const VERIFS = ['CONFIRMED', 'SUSPECTED', 'SIMULATED', 'INFORMATIONAL', 'UNVERIFIED_EXTERNAL'];
const STATUSES = ['open', 'investigating', 'mitigation-proposed', 'resolved', 'accepted'];
const X402_KEY = 'x402:live-settlement-without-independent-approval';
const BC07_KEY = 'external:bc-07:historical-fill-misclassification';

export default {
  id: 'findings', title: 'Sentinel Findings', order: 55,
  async mount(el, api) {
    const e = api.esc;
    if (!document.getElementById('tsf-style')) { const s = document.createElement('style'); s.id = 'tsf-style'; s.textContent = STYLE; document.head.append(s); }
    el.classList.add('tsf');
    const pb = (p) => {
      const cls = { LIVE_TESTNET: 'live', SIMULATION: 'sim', REPLAY: 'replay', MAINNET_OBSERVED_READ_ONLY: 'mainnet', UNAVAILABLE: 'tsf-unav' }[p] || 'bad';
      const label = { MAINNET_OBSERVED_READ_ONLY: 'MAINNET OBSERVED · READ-ONLY' }[p] || String(p || '?').replace(/_/g, ' ');
      return `<span class="badge ${cls}" title="Provenance">${e(label)}</span>`;
    };
    const vb = (v) => `<span class="badge v-${e(v)}" title="Verification">${e(String(v).replace(/_/g, ' '))}</span>`;
    const sv = (s) => `<span class="tsf-sev ${e(s)}">${e(s)}</span>`;
    const num = (n, prov) => `<b class="mono" style="font-size:13px">${e(n)}</b> ${pb(prov)}`;
    const when = (t) => (t ? e(String(t).replace('T', ' ').replace(/\.\d+Z$/, 'Z')) : '—');

    el.innerHTML = `
      <div class="card">
        <div class="tsf-head">
          <div><h2 style="margin:0">Sentinel Findings</h2>
          <p class="muted">Unified, auditable register of every material concern on the London node. Sentinel <b>observes and recommends only</b>: it never signs, pays, moves liquidity, cancels offers, changes permissions or disables services. Every number carries its provenance badge.</p></div>
          <div class="tsf-row"><span data-chain class="badge tsf-unav">CHAIN …</span>
          <button class="ghost" data-refresh>Refresh</button><a class="ghost" style="text-decoration:none;padding:8px 12px;border:1px solid var(--line);border-radius:6px;color:var(--ink)" href="/api/findings/report" target="_blank" rel="noopener">Risk report (markdown)</a></div>
        </div>
        <div class="tsf-sec"><div class="tsf-tiles" data-tiles></div></div>
        <p class="muted" data-split style="font-size:13px;margin:10px 0 0"></p>
      </div>
      <div class="card"><h2>Educational examples</h2><div class="grid" data-feat></div></div>
      <div class="card">
        <h2>Findings</h2>
        <div class="tsf-filters" data-filters></div>
        <div class="tsf-views" role="group" aria-label="View">
          <button class="ghost" data-view="table" aria-pressed="true">Table</button>
          <button class="ghost" data-view="product" aria-pressed="false">By product</button>
          <button class="ghost" data-view="market" aria-pressed="false">By market</button>
        </div>
        <div data-list></div>
      </div>
      <div class="card" data-detail hidden></div>
      <div class="card"><h2>Telemetry sources</h2><p class="muted" style="font-size:13px;margin-top:0">Systems from the directive. Anything not actually wired on this node is shown as unavailable with the reason; no integration is assumed.</p><ul class="tsf-src" data-sources></ul></div>`;
    const $ = (s) => el.querySelector(s);
    const state = { filters: {}, view: 'table', list: [], summary: null, sevTile: '' };

    const F = [
      ['severity', 'Severity', SEV], ['verification', 'Verification', VERIFS], ['provenance', 'Provenance', PROVS], ['status', 'Status', STATUSES],
      ['product', 'Product', []], ['market', 'Market', []], ['category', 'Category', []],
    ];
    const renderFilters = () => {
      const s = state.summary || {};
      const dyn = { product: Object.keys(s.byProduct || {}), market: Object.keys(s.byMarket || {}), category: Object.keys(s.byCategory || {}) };
      $('[data-filters]').innerHTML = F.map(([k, label, opts]) => `<div><label for="tsf-${k}">${label}</label><select id="tsf-${k}" data-f="${k}"><option value="">All</option>${(opts.length ? opts : dyn[k].sort()).map((o) => `<option ${state.filters[k] === o ? 'selected' : ''} value="${e(o)}">${e(o.replace(/_/g, ' '))}</option>`).join('')}</select></div>`).join('')
        + `<div><label for="tsf-q">Search</label><input id="tsf-q" data-f="q" placeholder="id, title, market" value="${e(state.filters.q || '')}"></div>`;
      for (const x of el.querySelectorAll('[data-f]')) x.addEventListener(x.tagName === 'INPUT' ? 'input' : 'change', () => { state.filters[x.dataset.f] = x.value; if (x.dataset.f === 'severity') state.sevTile = x.value; loadList(); });
    };

    const renderTiles = (s) => {
      const tiles = SEV.map((k) => {
        const bp = s.bySeverityProvenance?.[k] || {};
        const parts = PROVS.filter((p) => bp[p]).map((p) => `<span>${num(bp[p], p)}</span>`).join('');
        return `<button class="tsf-tile" data-sev="${k}" aria-pressed="${state.sevTile === k}"><div>${sv(k)}</div><div class="n">${s.bySeverity?.[k] ?? 0}</div><div class="bk">${parts || '<span class="muted">none</span>'}</div></button>`;
      }).join('');
      $('[data-tiles]').innerHTML = tiles;
      for (const b of el.querySelectorAll('[data-sev]')) b.onclick = () => { state.sevTile = state.sevTile === b.dataset.sev ? '' : b.dataset.sev; state.filters.severity = state.sevTile; renderFilters(); loadList(); renderTiles(state.summary); };
      const rv = s.realVsSimulated || {};
      const bp = s.byProvenance || {};
      $('[data-split]').innerHTML = `Totals by provenance: ${PROVS.map((p) => `${num(bp[p] || 0, p)}`).join(' · ')}. Real evidence ${rv.real || 0}, simulated ${rv.simulated || 0}, unverified/unavailable ${rv.unverified_or_unavailable || 0} (tile big numbers are the sum of the badged parts below them). Open ${s.openVsResolved?.open ?? 0}, closed ${s.openVsResolved?.closed ?? 0}.`;
    };

    const renderFeatured = (all) => {
      const pick = (k) => all.find((f) => f.key === k);
      const x = pick(X402_KEY), b = pick(BC07_KEY);
      const card = (f, extra) => !f ? '<div class="tsf-feat muted">Not registered on this node.</div>' : `
        <div class="tsf-feat ${f.verification === 'UNVERIFIED_EXTERNAL' ? 'unverified' : ''}">
          <div class="tsf-row">${sv(f.severity)}${f.severityBasis === 'as-reported' ? '<span class="muted" style="font-size:12px">as reported</span>' : ''} ${vb(f.verification)} ${pb(f.provenance)} <span class="mono">${e(f.id)}</span></div>
          <h3>${e(f.educational?.title || f.title)}</h3>
          ${extra}
          <div class="tsf-lesson">${e(f.educational?.lesson || f.observed)}</div>
          <div class="tsf-row" style="font-size:13px">${(f.facets || []).slice(0, 3).map((x) => `<span>${e(x.facet)}: ${vb(x.status || x.verification)}</span>`).join('')}</div>
          <p style="margin:8px 0 0"><button class="ghost" data-open="${e(f.id)}">Open details</button></p>
        </div>`;
      $('[data-feat]').innerHTML = card(x, x ? `<p style="margin:4px 0;font-size:14px">${e(x.title)}</p>` : '')
        + card(b, '<div class="tsf-warn"><b>UNVERIFIED.</b> Reported in operator chat from another node. Evidence not present on London; not reproduced here.</div>');
      for (const btn of $('[data-feat]').querySelectorAll('[data-open]')) btn.onclick = () => openDetail(btn.dataset.open);
    };

    const renderList = () => {
      const list = state.list;
      const box = $('[data-list]');
      if (!list.length) { box.innerHTML = '<p class="muted">No findings match these filters.</p>'; return; }
      if (state.view === 'table') {
        box.innerHTML = `<table><thead><tr><th>ID</th><th>Severity</th><th>Finding</th><th>Product</th><th>Market</th><th>Verification</th><th>Provenance</th><th>Status</th><th class="num">Seen</th><th>Last seen</th></tr></thead><tbody>
          ${list.map((f) => `<tr class="tsf-click" tabindex="0" data-id="${e(f.id)}"><td class="mono">${e(f.id)}</td><td>${sv(f.severity)}</td><td>${e(f.title)}</td><td>${e(f.product)}</td><td>${e(f.market)}</td><td>${vb(f.verification)}</td><td>${pb(f.provenance)}</td><td>${e(f.status)}</td><td class="num">${num(f.count + '×', f.provenance)}</td><td class="mono">${when(f.lastSeen)}</td></tr>`).join('')}</tbody></table>`;
        for (const tr of box.querySelectorAll('tr[data-id]')) { tr.onclick = () => openDetail(tr.dataset.id); tr.onkeydown = (ev) => { if (ev.key === 'Enter') openDetail(tr.dataset.id); }; }
        return;
      }
      const field = state.view;
      const groups = new Map();
      for (const f of list) { const k = f[field] || '—'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); }
      box.innerHTML = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, fs]) => {
        const byP = PROVS.map((p) => [p, fs.filter((f) => f.provenance === p).length]).filter(([, n]) => n);
        const bySev = SEV.map((s) => [s, fs.filter((f) => f.severity === s)]).filter(([, a]) => a.length);
        return `<div class="tsf-group"><div class="tsf-row"><b>${e(k)}</b> ${byP.map(([p, n]) => num(n, p)).join(' ')}</div>
          <div class="tsf-row" style="margin-top:4px;font-size:12px">${bySev.map(([s, a]) => `<span>${sv(s)} ${PROVS.filter((p) => a.some((f) => f.provenance === p)).map((p) => num(a.filter((f) => f.provenance === p).length, p)).join(' ')}</span>`).join(' ')}</div>
          <ul>${fs.map((f) => `<li><button class="linkish" data-id="${e(f.id)}">${e(f.id)}</button> ${sv(f.severity)} ${e(f.title)} ${vb(f.verification)}</li>`).join('')}</ul></div>`;
      }).join('');
      for (const b of box.querySelectorAll('button[data-id]')) b.onclick = () => openDetail(b.dataset.id);
    };

    const renderSources = (src) => {
      $('[data-sources]').innerHTML = (src.systems || []).map((s) => {
        const on = s.status === 'connected';
        const d = s.detail ? Object.entries(s.detail).filter(([, v]) => v != null && typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join(' · ') : '';
        const counts = on && s.observed != null ? ` · ${s.observed} observed, ${s.created || 0} new, ${s.updated || 0} updated` : '';
        return `<li><span class="dot ${on ? 'on' : 'off'}" aria-hidden="true"></span><div><b>${e(s.system)}</b> <span class="badge ${on ? 'live' : 'tsf-unav'}">${on ? 'CONNECTED' : 'UNAVAILABLE'}</span>${!on ? ` ${pb('UNAVAILABLE')}` : ''}
          <div class="muted">${e(s.reason || s.label || '')}${e(counts)}${d ? ` · ${e(d)}` : ''}${s.lastRunAt ? ` · last run ${when(s.lastRunAt)}` : ''}</div></div></li>`;
      }).join('') + `<li><span></span><div class="muted">Collectors last ran ${when(src.lastRun)}. Bus events not publishable in their mode (e.g. UNAVAILABLE provenance): ${e(src.eventsSuppressed ?? 0)}.</div></li>`;
    };

    const renderEvidence = (f) => !f.evidence?.length ? `<p class="tsf-warn">No evidence on this node. ${e(f.evidenceNote || '')}</p>` : `<ul class="tsf-ev">${f.evidence.map((x) => `<li><div class="tsf-row"><span class="badge tsf-unav">${e(x.kind)}</span> ${pb(x.provenance)} ${x.url ? `<a href="${e(x.url)}" target="_blank" rel="noopener">explorer ↗</a>` : ''}</div>
      <div class="mono">${e(x.ref)}</div>${x.detail ? `<div>${e(typeof x.detail === 'string' ? x.detail : JSON.stringify(x.detail))}</div>` : ''}</li>`).join('')}</ul>`;
    const renderAffected = (a = {}) => { const rows = Object.entries(a).filter(([, v]) => v && (!Array.isArray(v) || v.length)); return rows.length ? `<dl class="tsf-kv">${rows.map(([k, v]) => `<dt>${e(k)}</dt><dd class="${k === 'accounts' || k === 'runs' ? 'mono' : ''}">${e(Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : v)}</dd>`).join('')}</dl>` : '<p class="muted">Not specified.</p>'; };

    async function openDetail(id) {
      const box = $('[data-detail]');
      box.hidden = false; box.innerHTML = '<p class="muted">Loading…</p>';
      let f;
      try { f = await api.get(`/api/findings/${encodeURIComponent(id)}`); } catch (err) { box.innerHTML = `<p class="err">${e(err.message)}</p>`; return; }
      const rem = f.remediation || {};
      box.innerHTML = `
        <div class="tsf-head"><h2 style="margin:0">${e(f.id)}: ${e(f.title)}</h2><button class="ghost" data-close>Close</button></div>
        <div class="tsf-row" style="margin-top:8px">${sv(f.severity)}${f.severityBasis === 'as-reported' ? '<span class="muted" style="font-size:12px">severity as reported</span>' : ''} ${vb(f.verification)} ${pb(f.provenance)} <span class="badge tsf-unav">${e(f.status)}</span></div>
        ${f.verification === 'UNVERIFIED_EXTERNAL' ? '<div class="tsf-warn"><b>Unverified external report.</b> Evidence not present on London. This finding is registered so it is tracked, never presented as reproduced here.</div>' : ''}
        ${f.educational ? `<div class="tsf-lesson"><b>${e(f.educational.title)}.</b> ${e(f.educational.lesson)}</div>` : ''}
        <dl class="tsf-kv">
          <dt>Category</dt><dd>${e(f.category)}</dd><dt>Product</dt><dd>${e(f.product)}</dd><dt>Market</dt><dd>${e(f.market)}</dd>
          <dt>Environment</dt><dd>${e(f.environment)}</dd><dt>Sources</dt><dd>${e((f.sources || []).join(', '))}</dd>
          <dt>First / last seen</dt><dd class="mono">${when(f.firstSeen)} → ${when(f.lastSeen)}</dd><dt>Occurrences</dt><dd>${num(f.count, f.provenance)}</dd>
          <dt>Owner</dt><dd>${e(f.owner)}</dd><dt>Confidence</dt><dd>${e(f.confidence)}</dd>
        </dl>
        <div class="tsf-sec"><h3>Cause: observed vs expected</h3><dl class="tsf-kv"><dt>Observed</dt><dd>${e(f.observed || '—')}</dd><dt>Expected</dt><dd>${e(f.expected || '—')}</dd><dt>Actual</dt><dd>${e(f.actual || '—')}</dd>${f.rootCause ? `<dt>Root cause</dt><dd>${vb(f.rootCause.verification)} ${e(f.rootCause.summary)} <span class="muted">(${e(f.rootCause.by)}, ${when(f.rootCause.at)})</span></dd>` : ''}</dl></div>
        ${f.facets?.length ? `<div class="tsf-sec"><h3>Facets</h3><table><thead><tr><th>Facet</th><th>Status</th><th>Verification</th><th>Detail</th></tr></thead><tbody>${f.facets.map((x) => `<tr><td>${e(x.facet)}</td><td>${x.status ? vb(x.status) : '—'}</td><td>${vb(x.verification)}</td><td>${e(x.detail || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <div class="tsf-sec"><h3>Evidence (${num(f.evidence?.length || 0, f.provenance)})</h3>${renderEvidence(f)}</div>
        <div class="tsf-sec"><h3>Affected components</h3>${renderAffected(f.affected)}</div>
        ${f.impact ? `<div class="tsf-sec"><h3>Impact</h3><p style="margin:0">${e(f.impact)}</p></div>` : ''}
        <div class="tsf-sec"><h3>Proposed remediation <span class="badge tsf-unav">${e(rem.status || 'proposed')}</span></h3>
          <p style="margin:0 0 6px">${e(rem.summary || 'None proposed yet.')}</p>${rem.steps?.length ? `<ol style="margin:0;padding-left:20px">${rem.steps.map((s) => `<li>${e(s)}</li>`).join('')}</ol>` : ''}
          ${rem.reference ? `<p class="muted" style="margin:6px 0 0">Reference: <span class="mono">${e(rem.reference)}</span></p>` : ''}
          <p class="muted" style="font-size:12px;margin:6px 0 0">Recommendation only. Sentinel does not implement it.</p></div>
        <div class="tsf-sec"><h3>History (append-only, SHA-256 chained)</h3>
          <table><thead><tr><th class="num">Seq</th><th>At</th><th>Action</th><th>Actor</th><th>Hash</th></tr></thead><tbody>${(f.history || []).map((h) => `<tr><td class="num">${e(h.seq)}</td><td class="mono">${when(h.at)}</td><td>${e(h.action)}${h.detail?.note ? ` <span class="muted">${e(h.detail.note)}</span>` : ''}</td><td>${e(h.actor)}</td><td><span class="tsf-hash" title="${e(h.hash)}">${e(String(h.hash).slice(0, 12))}… ← ${e(String(h.prevHash).slice(0, 8))}…</span></td></tr>`).join('')}</tbody></table></div>
        ${f.notes?.length ? `<div class="tsf-sec"><h3>Notes</h3><ul>${f.notes.map((n) => `<li><span class="mono">${when(n.at)}</span> ${e(n.actor)}: ${e(n.text)}</li>`).join('')}</ul></div>` : ''}
        <div class="tsf-sec"><h3>Operator update (localhost only)</h3>
          <p class="muted" style="font-size:12px;margin:0 0 6px">Changes only this registry record (status, note). Every change is hashed into history. Refused unless the browser talks to this node directly on localhost.</p>
          <div class="tsf-form"><div><label for="tsf-st">Status</label><select id="tsf-st" data-st>${STATUSES.map((s) => `<option ${s === f.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
          <div><label for="tsf-note">Note</label><input id="tsf-note" data-note maxlength="500" placeholder="Reason or observation"></div>
          <div><button class="ghost" data-save>Save to registry</button></div></div><p data-msg class="muted" style="font-size:13px"></p></div>`;
      box.querySelector('[data-close]').onclick = () => { box.hidden = true; };
      box.querySelector('[data-save]').onclick = async () => {
        const msg = box.querySelector('[data-msg]'); const st = box.querySelector('[data-st]').value; const note = box.querySelector('[data-note]').value.trim();
        try {
          if (st !== f.status) await api.post(`/api/findings/${encodeURIComponent(f.id)}/status`, { status: st, note });
          else if (note) await api.post(`/api/findings/${encodeURIComponent(f.id)}/notes`, { note });
          else { msg.textContent = 'Nothing to save.'; return; }
          await refresh(); openDetail(f.id);
        } catch (err) { msg.innerHTML = `<span class="err">${e(err.message)}</span>`; }
      };
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function loadList() {
      const qs = new URLSearchParams(Object.entries(state.filters).filter(([, v]) => v)).toString();
      try { state.list = (await api.get(`/api/findings${qs ? '?' + qs : ''}`)).findings; renderList(); }
      catch (err) { $('[data-list]').innerHTML = `<p class="err">${e(err.message)}</p>`; }
    }

    async function refresh() {
      try {
        const [sum, all, src, ver] = await Promise.all([api.get('/api/findings/summary'), api.get('/api/findings'), api.get('/api/findings/sources'), api.get('/api/findings/verify')]);
        state.summary = sum;
        renderTiles(sum); renderFilters(); renderFeatured(all.findings); renderSources(src);
        const c = $('[data-chain]');
        c.className = `badge ${ver.ok ? 'live' : 'bad'}`;
        c.textContent = ver.ok ? `CHAIN VERIFIED · ${ver.entries} ENTRIES` : `CHAIN FAILED · ${ver.problems.length} PROBLEM(S)`;
        c.title = `head ${ver.head?.hash || ''}`;
        await loadList();
      } catch (err) { $('[data-tiles]').innerHTML = `<p class="err">Findings unavailable: ${e(err.message)}</p>`; }
    }

    for (const b of el.querySelectorAll('[data-view]')) b.onclick = () => { state.view = b.dataset.view; for (const x of el.querySelectorAll('[data-view]')) x.setAttribute('aria-pressed', x === b); renderList(); };
    $('[data-refresh]').onclick = refresh;
    let t = null;
    api.on((ev) => { if (String(ev.type).startsWith('findings.')) { clearTimeout(t); t = setTimeout(refresh, 1200); } });
    await refresh();
  },
};
