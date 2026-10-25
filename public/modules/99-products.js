// TG Products: canonical Titan Ghost product registry + naming/alias matrix for Commander review (read-only).
const STYLE = `
.tgp .tgp-st { display:inline-block; white-space:nowrap; font:600 11px var(--mono); padding:2px 6px; border-radius:4px; letter-spacing:.04em; }
.tgp .tgp-st.approved { color:var(--live); background:var(--live-bg); }
.tgp .tgp-st.proposed { color:var(--sim); background:var(--sim-bg); }
.tgp .tgp-st.excluded { color:var(--muted); background:var(--bg); border:1px solid var(--line); }
.tgp .tgp-ops { display:inline-block; white-space:nowrap; font:600 11px var(--mono); padding:2px 6px; border-radius:4px; color:var(--muted); background:var(--bg); border:1px dashed var(--line); }
.tgp .tgp-ops.demo { color:var(--replay); border-color:var(--replay); }
.tgp .tgp-ops.nb { color:var(--bad); border-color:var(--bad); }
.tgp table { width:100%; border-collapse:collapse; font-size:13px; }
.tgp th, .tgp td { text-align:left; vertical-align:top; padding:6px 8px; border-bottom:1px solid var(--line); overflow-wrap:anywhere; }
.tgp th { color:var(--muted); font-weight:600; font-size:12px; }
.tgp .tgp-filters { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:10px; }
.tgp .tgp-filters select { width:auto; min-width:140px; flex:1 1 160px; max-width:260px; }
.tgp .tgp-ac { font:700 13px var(--mono); }
.tgp .tgp-nb { color:var(--muted); font-style:italic; }
.tgp details.tgp-d { border:1px solid var(--line); border-radius:8px; padding:8px 10px; margin-bottom:8px; background:var(--bg); }
.tgp details.tgp-d summary { cursor:pointer; display:flex; flex-wrap:wrap; gap:6px 8px; align-items:baseline; }
.tgp details.tgp-d dl { margin:8px 0 0; display:grid; grid-template-columns:minmax(110px,max-content) minmax(0,1fr); gap:4px 12px; font-size:13px; }
.tgp details.tgp-d dt { color:var(--muted); } .tgp details.tgp-d dd { margin:0; min-width:0; overflow-wrap:anywhere; }
.tgp ul.tgp-l { margin:4px 0; padding-left:18px; } .tgp ul.tgp-l li { margin:2px 0; overflow-wrap:anywhere; }
.tgp .tgp-note { border-left:3px solid var(--sim); padding:6px 10px; margin:8px 0; background:var(--bg); font-size:13px; }
.tgp .tgp-note.high { border-color:var(--bad); }
.tgp .tgp-count { font:700 28px var(--mono); }
.tgp .tgp-prio { font:600 10px var(--mono); color:var(--accent); border:1px solid var(--accent); border-radius:4px; padding:1px 4px; white-space:nowrap; }
.tgp .tgp-era { display:inline-block; white-space:nowrap; font:700 10px var(--mono); padding:2px 6px; border-radius:4px; border:1px solid var(--gold); color:var(--gold); }
.tgp .tgp-era.new { border-color:var(--accent); color:var(--accent); }
.tgp .tgp-era.mixed { border-style:dashed; }
.tgp .tgp-areas { display:grid; gap:12px; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); }
.tgp .tgp-area { border:1px solid var(--line); border-top:3px solid var(--accent); border-radius:10px; padding:12px; background:var(--bg); min-width:0; }
.tgp .tgp-area h3 { margin:0 0 6px; }
.tgp .tgp-area ul { margin:6px 0 0; padding-left:18px; font-size:13px; } .tgp .tgp-area li { margin:3px 0; overflow-wrap:anywhere; }
.tgp .tgp-area button.ghost { padding:3px 8px; font-size:12px; margin:2px 4px 2px 0; }
.tgp .tgp-opsum { display:flex; flex-wrap:wrap; gap:8px 14px; align-items:center; margin:8px 0; font-size:13px; }
@media (max-width:600px) { .tgp details.tgp-d dl { grid-template-columns:minmax(0,1fr); } .tgp details.tgp-d dt { margin-top:6px; } }
`;

// The four hackathon capability areas (London, Oct 24–25). products: registry acronyms (or names for excluded brands);
// tabs: module ids that demonstrate it; pre/new: what existed before the hackathon vs what was built during it.
export const AREAS = Object.freeze([
  { title: 'Titan Ghost Market Maker — Why Not?', products: ['TG', 'TGI', 'TGV'], tabs: ['theater', 'view', 'loop', 'pathfinder', 'observatory'],
    pre: 'Titan Ghost engine v11 and its recorded Mainnet history (HISTORICAL_MAINNET); the live engine is not connected to this node.',
    built: 'Theater (evidence, fills, Dolphin→Kraken scenarios), TG Intelligence radar, demo loop on XRPL Testnet.' },
  { title: 'TGLB — Lending & Borrowing', products: ['TGLB', 'TGLW'], tabs: ['incubator', 'capital', 'access'],
    pre: 'TGLW / TGLB product design (three tiers; Tier 3 underwritten lending vault).',
    built: 'TGLB lending studio and three-tier funding flows (SIMULATION).' },
  { title: 'XDLC — Protocol Innovation', products: ['XDLC'], tabs: ['xdlc-protocol', 'xdlc-app', 'corridor'],
    pre: 'XDLC corridor concept (Titan Ghost application logic).',
    built: 'XDLC application lifecycle and the proposed-amendment draft (not submitted, not reviewed, not implemented in xrpld, not activated).' },
  { title: 'TG Merchant — Agentic Finance', products: ['TGM', 'TGS'], tabs: ['merchant', 'vendors', 'x402', 'sentinel'],
    pre: 'TG Merchant and x402 pay-per-request design; Sentinel risk monitoring.',
    built: 'Vendor adapters, merchant flows and expanded Sentinel coverage (SIMULATION unless labeled).' },
]);
// Era: established ecosystem products predate the hackathon; products flagged newProduct were added during it.
export function eraOf(p) { if (p.newProduct) return 'new'; if (p.name === 'XDLC') return 'mixed'; return 'pre'; }
const ERA_LABEL = { pre: 'PRE-HACKATHON', new: 'NEW · OCT 24–25', mixed: 'CONCEPT PRE · APP+SPEC NEW' };

export default {
  id: 'products', title: 'TG Products', order: 99,
  async mount(el, api) {
    const e = api.esc;
    if (!document.getElementById('tgp-style')) { const s = document.createElement('style'); s.id = 'tgp-style'; s.textContent = STYLE; document.head.append(s); }
    el.classList.add('tgp');
    el.innerHTML = `
      <div class="card">
        <h2>TG Products: Titan Ghost product registry</h2>
        <p class="muted"><b>TG = Titan Ghost.</b> Full names are used formally; acronyms in dashboards, APIs and telemetry. This registry only points at existing tabs and API namespaces: nothing is renamed. Operational status is derived from the code on this London node. Read-only; for Commander review.</p>
        <div id="tgp-decisions">Loading…</div>
      </div>
      <div class="card"><h2>Hackathon capability areas</h2>
        <p class="muted"><span class="tgp-era">PRE-HACKATHON</span> = Titan Ghost engine v11 and the existing GYW1313 products. <span class="tgp-era new">NEW · OCT 24–25</span> = built during the London competition period. Status pills come live from <span class="mono">/api/products</span>; a tab marked "coming online" is not on this node yet.</p>
        <div id="tgp-areas" class="tgp-areas muted">Loading…</div></div>
      <div class="card"><h2>Ecosystem count and sixteen-product reconciliation</h2><div id="tgp-recon" class="muted">Loading…</div></div>
      <div class="card"><h2>Registry</h2>
        <div class="tgp-filters"><label for="tgp-status" style="margin:0">Approval</label><select id="tgp-status"><option value="">All</option><option>APPROVED</option><option>PROPOSED</option><option>EXCLUDED</option></select>
          <label for="tgp-cat" style="margin:0">Category</label><select id="tgp-cat"><option value="">All</option></select></div>
        <div id="tgp-table" class="muted">Loading…</div>
        <h3>Details</h3><div id="tgp-details"></div>
      </div>
      <div class="card"><h2>Naming and alias matrix</h2><div id="tgp-matrix" class="muted">Loading…</div></div>
      <div class="card"><h2>Collision and ambiguity review notes</h2><div id="tgp-notes" class="muted">Loading…</div></div>
      <div class="card"><h2>Candidate domains</h2><div id="tgp-domains" class="muted">Loading…</div></div>`;
    const $ = (s) => el.querySelector(s);

    const approval = (s) => `<span class="tgp-st ${e(String(s).toLowerCase())}">${e(s)}</span>`;
    const ops = (s) => (s === 'LIVE_TESTNET' || s === 'SIMULATION') ? api.badge(s)
      : `<span class="tgp-ops ${s === 'DEMO_ADAPTER' ? 'demo' : s === 'NOT_BUILT' ? 'nb' : ''}">${e(String(s).replace(/_/g, ' '))}</span>`;
    const ac = (p) => p.acronym ? `<span class="tgp-ac">${e(p.acronym)}</span>` : '<span class="tgp-nb">none (excluded)</span>';
    const tab = (p) => p.websiteRoute.status === 'exists' ? `<span class="mono">${e(p.websiteRoute.id)}</span> <span class="muted">(${e(p.websiteRoute.title)})</span>` : '<span class="tgp-nb">not built</span>';
    const nss = (p) => p.apiNamespaces.map((n) => n.namespace ? `<span class="mono">${e(n.namespace)}</span>${n.status === 'exists' ? '' : ' <span class="tgp-nb">not built</span>'}` : '<span class="tgp-nb">not built</span>').join('<br>');

    let data, matrix;
    try {
      [data, matrix] = await Promise.all([api.get('/api/products'), api.get('/api/products/matrix').catch(() => null)]);
    } catch (err) { $('#tgp-table').innerHTML = `<span class="err">${e(err.message)}</span>`; return; }
    const all = data.products;
    const find = (k) => all.find((p) => p.acronym === k || (!p.acronym && p.name === k));
    const era = (p) => `<span class="tgp-era ${eraOf(p)}">${e(ERA_LABEL[eraOf(p)])}</span>`;

    // Hackathon capability areas + operational summary
    const opsCount = {};
    for (const p of all) opsCount[p.operational.status] = (opsCount[p.operational.status] || 0) + 1;
    $('#tgp-areas').classList.remove('muted');
    $('#tgp-areas').innerHTML = AREAS.map((a) => `<div class="tgp-area"><h3>${e(a.title)}</h3>
      <ul>${a.products.map((k) => { const p = find(k); return p ? `<li>${ac(p)} ${e(p.name)} ${ops(p.operational.status)} ${era(p)}</li>` : `<li class="muted">${e(k)}: not in registry</li>`; }).join('')}</ul>
      <p style="margin:8px 0 4px;font-size:13px"><span class="tgp-era">PRE-HACKATHON</span> ${e(a.pre)}</p>
      <p style="margin:4px 0;font-size:13px"><span class="tgp-era new">NEW · OCT 24–25</span> ${e(a.built)}</p>
      <div>${a.tabs.map((t) => api.has?.(t) ? `<button type="button" class="ghost" data-show="${e(t)}">${e(t)}</button>` : `<span class="tgp-nb" style="font-size:12px;margin-right:6px">${e(t)}: coming online</span>`).join('')}</div></div>`).join('')
      + `<div class="tgp-opsum" style="grid-column:1/-1"><b>London operational status, all ${all.length} registry entries:</b> ${Object.entries(opsCount).map(([k, n]) => `${ops(k)} ×${n}`).join(' ')}</div>`;
    $('#tgp-areas').addEventListener('click', (ev) => { const b = ev.target.closest('[data-show]'); if (b) api.show(b.dataset.show); });
    // Tabs from other workstreams may mount after us: refresh the "coming online" markers once everything is loaded.
    window.addEventListener('tf:ready', () => { for (const s of el.querySelectorAll('.tgp-area .tgp-nb')) { const id = s.textContent.split(':')[0]; if (api.has?.(id)) s.outerHTML = `<button type="button" class="ghost" data-show="${e(id)}">${e(id)}</button>`; } }, { once: true });

    // Decisions
    $('#tgp-decisions').innerHTML = `<div class="tgp-note high"><b>Decisions needed from the Commander</b><ol class="tgp-l">${data.decisions.map((d) => `<li>${e(d)}</li>`).join('')}</ol></div>`;

    // Reconciliation + count
    const c = data.count, rec = data.reconciliation;
    $('#tgp-recon').innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:baseline"><span class="tgp-count">${e(c.total ?? c.established)}</span>
        <span>products: ${e(c.established)} established ${c.verified ? '<span class="badge live">RECONCILED</span>' : '<span class="badge bad">NOT RECONCILED</span>'} (Commander's figure)${c.commanderAdded?.length ? ` + <b class="mono">${e(c.commanderAdded.join(', '))}</b> (Commander decision)` : ''}. New, not counted: <b class="mono">${e(c.newNotCounted.join(', ') || 'none')}</b>.</span></div>
      <p>${e(c.note)}</p>
      <p>${e(rec.summary)}</p>
      <details class="tgp-d"><summary><b>Found in sources (${rec.found.length})</b></summary>
        <table><thead><tr><th>Name</th><th>TG acronym</th><th>Source (file:line)</th></tr></thead><tbody>${rec.found.map((f) => `<tr><td>${e(f.name)}</td><td class="mono">${e(f.acronym || '—')}</td><td class="mono">${e(f.source)}</td></tr>`).join('')}</tbody></table></details>
      <details class="tgp-d"><summary><b>Named in sources, not on the TG list (${rec.unmapped.length})</b></summary><ul class="tgp-l">${rec.unmapped.map((u) => `<li>${e(u.name)} <span class="mono muted">${e(u.source)}</span></li>`).join('')}</ul></details>
      <details class="tgp-d"><summary><b>On the TG list, no source found (${rec.noSource.length})</b></summary><ul class="tgp-l">${rec.noSource.map((u) => `<li>${e(u)}</li>`).join('')}</ul></details>
      <details class="tgp-d"><summary><b>Searched</b></summary><ul class="tgp-l">${rec.searched.map((s) => `<li><span class="mono">${e(s.path)}</span>: ${e(s.result)}</li>`).join('')}</ul></details>`;

    // Registry table + details
    const cat = $('#tgp-cat');
    for (const k of data.categories) cat.insertAdjacentHTML('beforeend', `<option>${e(k)}</option>`);
    function renderTable() {
      const st = $('#tgp-status').value, ca = cat.value;
      const rows = all.filter((p) => (!st || p.approval === st) && (!ca || p.category === ca));
      $('#tgp-table').innerHTML = rows.length ? `<table><thead><tr><th>Product</th><th>Acronym</th><th>Approval</th><th>London status</th><th>Era</th><th>Category</th><th>Tab</th><th>API</th><th>Domain</th></tr></thead><tbody>${rows.map((p) => `<tr>
        <td><b>${e(p.formalName)}</b>${p.newProduct ? ' <span class="tgp-prio">NEW</span>' : ''}</td><td>${ac(p)}</td><td>${approval(p.approval)}</td><td>${ops(p.operational.status)}</td><td>${era(p)}</td>
        <td class="mono">${e(p.category)}</td><td>${tab(p)}</td><td>${nss(p)}</td>
        <td>${p.candidateDomain ? `<span class="mono">${e(p.candidateDomain.domain)}</span>${p.candidateDomain.priority ? ' <span class="tgp-prio">PRIORITY</span>' : ''}` : '<span class="tgp-nb">—</span>'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No products match.</p>';
      $('#tgp-details').innerHTML = rows.map((p) => `<details class="tgp-d"><summary>${ac(p)} <b>${e(p.name)}</b> ${approval(p.approval)} ${ops(p.operational.status)}</summary><dl>
        <dt>Formal name</dt><dd>${e(p.formalName)}</dd>
        <dt>Aliases</dt><dd>${p.aliases.length ? p.aliases.map(e).join(', ') : '—'}${p.components ? `<br><span class="muted">Components: ${p.components.map(e).join(', ')}</span>` : ''}</dd>
        <dt>Status basis</dt><dd>${e(p.operational.basis)}${p.operational.engineLabel ? `<br><span class="muted">Engine: ${e(p.operational.engineLabel)}</span>` : ''}</dd>
        <dt>Agent capabilities</dt><dd>${p.capabilities.length ? `<ul class="tgp-l">${p.capabilities.map((x) => `<li><span class="mono">${e(x.method)} ${e(x.path)}</span> <span class="muted">${e(x.use)}</span></li>`).join('')}</ul>` : '<span class="tgp-nb">none (no endpoints on this node)</span>'}</dd>
        <dt>Commercial model</dt><dd>${e(p.commercial)}</dd>
        <dt>Dependencies</dt><dd>${p.dependencies.length ? p.dependencies.map(e).join('; ') : '—'}</dd>
        <dt>Sources</dt><dd class="mono">${p.sources.map(e).join('<br>')}</dd>
        <dt>Domain</dt><dd>${p.candidateDomain ? `<span class="mono">${e(p.candidateDomain.domain)}</span>${p.candidateDomain.label ? ` <span class="muted">${e(p.candidateDomain.label)}</span>` : ''}` : '—'}</dd>
      </dl></details>`).join('');
    }
    $('#tgp-status').onchange = renderTable; cat.onchange = renderTable;
    renderTable();

    // Alias matrix
    const m = matrix || {};
    $('#tgp-matrix').innerHTML = m.rows ? `<p class="muted">${e(m.standard)}</p>
      <table><thead><tr><th>Acronym</th><th>Full name</th><th>Approval</th><th>Resolves from (aliases)</th></tr></thead><tbody>${m.rows.map((r) => `<tr><td>${r.acronym ? `<span class="tgp-ac">${e(r.acronym)}</span>` : '<span class="tgp-nb">none</span>'}</td><td>${e(r.name)}</td><td>${approval(r.approval)}</td><td>${[...r.aliases, ...r.components.map((x) => `${x} (component)`)].map(e).join(', ') || '—'}</td></tr>`).join('')}</tbody></table>
      <p class="muted">Lookup: <span class="mono">GET /api/products/:acronym</span> is case-insensitive and accepts any name or alias above. Deliberately unresolvable:</p>
      <ul class="tgp-l">${m.ambiguousAliases.map((a) => `<li><b>${e(a.alias)}</b>: ${e(a.why)}</li>`).join('')}</ul>` : '<p class="err">Matrix unavailable.</p>';

    // Review notes
    $('#tgp-notes').innerHTML = data.reviewNotes.map((n) => `<div class="tgp-note ${n.severity === 'high' ? 'high' : ''}"><b>${e(n.acronyms.join(' / ') || 'Domains')}</b> <span class="muted">(${e(n.severity)})</span><br>${e(n.note)}</div>`).join('');

    // Domains
    const av = { REPORTED_AVAILABLE: 'reported available', REPORTED_UNAVAILABLE: 'reported unavailable', PLATFORM_DOMAIN: 'platform domain' };
    $('#tgp-domains').innerHTML = `<div class="tgp-note high"><b>Nothing purchased.</b> ${e(data.trademark)}</div>
      <p class="muted">Snapshot: ${e(data.domains.find((d) => d.availability === 'REPORTED_AVAILABLE')?.label || '')}</p>
      <table><thead><tr><th>Domain</th><th>Product</th><th>Snapshot</th><th>Purchased</th><th>Note</th></tr></thead><tbody>${data.domains.map((d) => `<tr>
        <td><span class="mono">${e(d.domain)}</span>${d.priority ? ' <span class="tgp-prio">PRIORITY</span>' : ''}</td><td class="mono">${e(d.acronym || '—')}</td>
        <td>${e(av[d.availability] || d.availability)}</td><td>${d.purchased ? 'yes' : 'no'}</td><td class="muted">${e(d.note || (d.platform ? d.label : d.availability === 'REPORTED_UNAVAILABLE' ? d.label : 'not verified at GoDaddy; trademark clearance pending'))}</td></tr>`).join('')}</tbody></table>`;
  },
};
