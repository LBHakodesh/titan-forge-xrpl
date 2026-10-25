// TGAN Advisory — Titan Ghost Advisory Network, attached to the Project Incubator workflow.
// Hackathon DEMONSTRATION of a possible future compliant model: every advisor, approval and fee is HYPOTHETICAL.
// Projects come from the Project Incubator (or a FIXTURE with the same shape until it responds). Nothing here signs,
// submits, bills or moves funds; state-changing buttons create SIMULATION records on localhost only.
const STYLE = `
.tg-root .tg-hero { border-left:4px solid var(--replay); }
.tg-root .tg-hypo { display:inline-block; font:600 11px var(--mono); padding:2px 6px; border-radius:4px; color:var(--replay); background:var(--replay-bg); border:1px dashed var(--replay); white-space:nowrap; }
.tg-root .tg-fixture { display:inline-block; font:600 11px var(--mono); padding:2px 6px; border-radius:4px; color:var(--sim); border:1px dashed var(--sim); white-space:nowrap; }
.tg-root .tg-ok { color:var(--live); font-weight:600; } .tg-root .tg-no { color:var(--bad); font-weight:600; }
.tg-root .tg-row { display:grid; gap:10px; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); align-items:end; }
.tg-root .tg-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; align-items:center; }
.tg-root .tg-note { font-size:12px; color:var(--muted); }
.tg-root .tg-warn { border-left:3px solid var(--sim); background:var(--sim-bg); padding:8px 10px; border-radius:4px; margin:8px 0; font-size:13px; }
.tg-root .tg-stop { border-left:3px solid var(--bad); background:var(--bad-bg); padding:8px 10px; border-radius:4px; margin:8px 0; font-size:13px; }
.tg-root .tg-flow { list-style:none; margin:0; padding:0; display:grid; gap:8px; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); counter-reset:tgstep; }
.tg-root .tg-flow li { border:1px solid var(--line); border-radius:8px; padding:10px; font-size:13px; position:relative; }
.tg-root .tg-flow li::before { counter-increment:tgstep; content:counter(tgstep); display:inline-grid; place-items:center; width:20px; height:20px; border-radius:50%; background:var(--bg); border:1px solid var(--line); font:600 11px var(--mono); margin-right:6px; }
.tg-root .tg-flow li.done { border-color:var(--live); } .tg-root .tg-flow li.blocked { border-color:var(--bad); } .tg-root .tg-flow li.info { border-style:dashed; }
.tg-root .tg-flow b { font-size:13px; }
.tg-root .tg-kpis { display:grid; gap:8px; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); }
.tg-root .tg-kpi { border:1px solid var(--line); border-radius:8px; padding:8px 10px; }
.tg-root .tg-kpi .v { font:600 17px var(--mono); } .tg-root .tg-kpi .k { font-size:12px; color:var(--muted); }
.tg-root .tg-adv { border:1px solid var(--line); border-radius:8px; padding:10px; font-size:13px; }
.tg-root .tg-advs { display:grid; gap:10px; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); }
.tg-root .tg-kv { display:grid; grid-template-columns:auto 1fr; gap:2px 10px; font-size:13px; } .tg-root .tg-kv b { color:var(--muted); font-weight:600; }
.tg-root details { font-size:13px; margin-top:6px; } .tg-root summary { cursor:pointer; color:var(--accent); }
.tg-root .tg-chart { max-width:760px; } .tg-root .tg-chart svg { display:block; max-width:100%; }
.tg-root .tg-chart .bar { fill:var(--accent); } .tg-root .tg-chart .base { fill:var(--sim); }
.tg-root .tg-chart .hwm { stroke:var(--ink); stroke-width:2; stroke-dasharray:5 4; fill:none; }
.tg-root .tg-chart text { fill:var(--muted); font:11px var(--mono); } .tg-root .tg-chart text.val { fill:var(--ink); }
.tg-root .tg-chart .grid { stroke:var(--line); stroke-width:1; }
.tg-root .tg-legend { display:flex; flex-wrap:wrap; gap:12px; font-size:12px; color:var(--muted); margin:4px 0; }
.tg-root .tg-sw { display:inline-block; width:12px; height:12px; border-radius:2px; vertical-align:-2px; margin-right:4px; }
.tg-root .tg-streams { display:grid; gap:10px; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); }
.tg-root .tg-stream { border:1px solid var(--line); border-radius:8px; padding:10px; font-size:13px; }
.tg-root .tg-sig { border-left:3px solid var(--sim); padding:6px 10px; margin:6px 0; font-size:13px; background:var(--bg); border-radius:4px; }
.tg-root .tg-sig.high { border-color:var(--bad); }
.tg-root table input { padding:4px 6px; min-width:0; }
.tg-root .tg-periods { display:grid; gap:6px; }
.tg-root .tg-period { display:grid; gap:6px; grid-template-columns:repeat(auto-fit,minmax(90px,1fr)); border:1px solid var(--line); border-radius:6px; padding:6px; }
.tg-root .tg-period label { margin:0 0 2px; font-size:11px; }
.tg-root button.ghost.sm, .tg-root button.primary.sm { padding:4px 8px; font-size:12px; }
`;

const usd = (n) => n == null || !Number.isFinite(Number(n)) ? '—' : (Number(n) < 0 ? '−$' : '$') + Math.abs(Number(n)).toLocaleString('en-US', { maximumFractionDigits: 2 });
const pct = (n) => n == null || !Number.isFinite(Number(n)) ? '—' : `${Number(n).toFixed(2)}%`;
const PERIOD_FIELDS = [['label', 'Label', 'text'], ['beginValue', 'Begin $', 'number'], ['endValue', 'End $', 'number'], ['deposits', 'Deposits $', 'number'], ['withdrawals', 'Withdrawals $', 'number'], ['expenses', 'Expenses $', 'number']];

export default {
  id: 'tgan', title: 'TGAN Advisory', order: 34,
  async mount(el, api) {
    if (!document.getElementById('tg-style')) { const s = document.createElement('style'); s.id = 'tg-style'; s.textContent = STYLE; document.head.append(s); }
    const esc = api.esc, SIM = api.badge('SIMULATION');
    const HYPO = '<span class="tg-hypo" title="Fictional demo; not a real advisor, approval or fee">HYPOTHETICAL</span>';
    el.classList.add('tg-root');
    el.innerHTML = '<div class="card muted">Loading TGAN…</div>';
    let ov;
    try { ov = await api.get('/api/tgan'); } catch (e) { el.innerHTML = `<div class="card err">TGAN unavailable: ${esc(e.message)}</div>`; return; }
    let projectId = ov.projects[0]?.id;
    try { const s = localStorage.getItem('tg-project'); if (ov.projects.some((p) => p.id === s)) projectId = s; } catch {}
    const srcBadge = (o) => o === 'INCUBATOR' ? `${SIM} <span class="tg-note">from Project Incubator</span>` : '<span class="tg-fixture" title="Local stand-in with the incubator\'s shape">FIXTURE</span>';
    const modeBadge = (m) => api.badge(m || 'SIMULATION');

    el.innerHTML = `
      <div class="card tg-hero">
        <h2>TGAN — Titan Ghost Advisory Network ${HYPO} ${SIM}</h2>
        <p style="margin-top:0">${esc(ov.notice)}</p>
        <div class="tg-stop"><b>Gate rule:</b> ${esc(ov.legalGateRule)} TGAN reads the incubator's gates and graduation state; it cannot change them.</div>
        <div class="tg-row">
          <div><label for="tg-proj">Incubator project</label><select id="tg-proj">${ov.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.id)})</option>`).join('')}</select></div>
          <div><div class="tg-note">Project source</div><div id="tg-src">${srcBadge(ov.projectSource.origin)}</div></div>
        </div>
        <div class="tg-note" id="tg-srcnote">${esc(ov.projectSource.label)}</div>
        <div id="tg-msg" role="status"></div>
      </div>
      <div class="card"><h2>Demo flow</h2><ol class="tg-flow" id="tg-flow"></ol></div>
      <div class="card"><h2>Advisors ${HYPO}</h2><div id="tg-advisors"></div></div>
      <div class="card"><h2>Portfolio governance &amp; XRP/RLUSD proposals ${HYPO} ${SIM}</h2><div id="tg-gov"></div></div>
      <div class="card"><h2>Performance measurement</h2><div id="tg-perf"></div></div>
      <div class="card"><h2>Hypothetical performance-fee calculator ${HYPO} ${SIM}</h2><div id="tg-fee"></div></div>
      <div class="card"><h2>Revenue streams (reported separately) ${SIM}</h2><div id="tg-rev"></div></div>
      <div class="card"><h2>Sentinel signals ${SIM}</h2><div id="tg-sig"></div></div>`;
    const $ = (id) => el.querySelector('#' + id);
    $('tg-proj').value = projectId;
    $('tg-proj').onchange = () => { projectId = $('tg-proj').value; try { localStorage.setItem('tg-project', projectId); } catch {} refresh(); };

    const post = async (path, body, okMsg) => {
      try { const r = await api.post(path, body); if (okMsg) toast(okMsg); await refresh(); return r; }
      catch (e) { toast((e.body?.errors || [e.message]).join(' '), true); return null; }
    };
    const toast = (msg, bad) => { $('tg-msg').innerHTML = `<div class="${bad ? 'tg-stop' : 'tg-warn'}">${esc(msg)}</div>`; };

    // ---------- flow ----------
    function renderFlow(pf, perf) {
      const p = pf.project, cs = p.capitalStack;
      const verifiedAssigned = pf.advisors.filter((a) => a.verified).length;
      const allowed = pf.proposals.filter((x) => x.evaluation.allowed).length;
      const steps = [
        ['done', 'Project request', `${esc(p.name)} · token ${esc(p.token || '—')} · stage ${esc(p.stage || '—')} · program ${esc(p.program)}`],
        [verifiedAssigned ? 'done' : 'blocked', 'Advisor review ' + HYPO, `${pf.advisors.length} assigned, ${verifiedAssigned} with recorded verification. Unverified advisors cannot act.`],
        ['done', 'TGLB funding structure', `Target ${usd(cs.targetUsd)} · T1 ${usd(cs.sources.T1)} · T2 ${usd(cs.sources.T2)} · T3 ${usd(cs.sources.T3)} · Project ${usd(cs.sources.PROJECT)} · Proprietary ${usd(cs.sources.PROPRIETARY)}${p.executableUsd != null ? ` · executable ${usd(p.executableUsd)}` : ''} ${modeBadge(p.mode)}`],
        [allowed ? 'done' : 'blocked', 'XRP/RLUSD incubation', `${pf.proposals.length} proposals, ${allowed} pass TGAN rules + Guardian. Assets: ${pf.governance.authorizedAssets.join(', ')} (project token kept separate).`],
        ['info', 'Execution (replay / sim)', perf?.available ? `${modeBadge(perf.mode)} ${perf.periods.length} periods. Nothing executes from TGAN.` : 'No execution data.'],
        [perf?.available ? 'done' : 'info', 'Performance measurement', perf?.available ? `Net P&L ${usd(perf.netPnlUsd)} · TWR ${pct(perf.returns.timeWeightedPct)} · MWR ${pct(perf.returns.moneyWeightedPct)}` : 'Unavailable'],
        ['info', 'XDLC opportunity evaluation', 'XDLC is a <b>proposed</b> XRPL amendment, not live. Evaluation is informational only; corridor lifecycle is Titan Ghost application logic.'],
        [/GRADUAT/.test(String(p.outcome || p.stage).toUpperCase()) ? 'done' : 'info', 'Potential graduation', `Incubator state: <b>${esc(p.outcome || p.stage || '—')}</b> · legal gate <b>${esc(p.gates.legal)}</b> · economic gate <b>${esc(p.gates.economic)}</b>. Read-only here.`],
      ];
      $('tg-flow').innerHTML = steps.map(([cls, t, body]) => `<li class="${cls}"><b>${t}</b><div class="tg-note" style="margin-top:4px">${body}</div></li>`).join('');
    }

    // ---------- advisors ----------
    function renderAdvisors(all, pf) {
      const assigned = new Set(pf.advisors.map((a) => a.id));
      $('tg-advisors').innerHTML = `<p class="tg-note" style="margin-top:0">${esc(all[0]?.fictionalNote || '')}</p><div class="tg-advs">${all.map((a) => `
        <div class="tg-adv">
          <div><b>${esc(a.firm)}</b> ${HYPO} ${assigned.has(a.id) ? '<span class="badge sim">ASSIGNED</span>' : ''}</div>
          <div class="tg-kv" style="margin-top:6px">
            <b>Representative</b><span>${esc(a.representative)}</span>
            <b>Registration</b><span class="${a.verified ? 'tg-ok' : 'tg-no'}">${esc(a.verification.status)}</span>
            <b>Jurisdictions</b><span>${esc(a.jurisdictions.join('; '))}</span>
            <b>Scope</b><span>${esc(a.serviceScope.join('; '))}</span>
            <b>Agreement</b><span>${esc(a.agreement.reference)} · ${esc(a.agreement.date)} · ${esc(a.agreement.feeBasisType)} · <span class="${a.agreement.signed ? 'tg-ok' : 'tg-no'}">${a.agreement.signed ? 'signed' : 'NOT signed'}</span></span>
            <b>Conflicts</b><span>${a.conflicts.length ? a.conflicts.map((c) => `${esc(c.type)}: ${c.disclosed ? '<span class="tg-ok">disclosed</span>' : '<span class="tg-no">NOT disclosed</span>'}`).join('<br>') : 'none recorded'}</span>
          </div>
          <div class="tg-note" style="margin-top:6px">${esc(a.verification.label)}</div>
          <div class="tg-actions">
            <button class="ghost sm" data-assign="${esc(a.id)}" data-un="${assigned.has(a.id) ? 1 : 0}">${assigned.has(a.id) ? 'Unassign' : 'Assign'} to ${esc(projectId)}</button>
          </div>
          <details><summary>Operator: record verification reference</summary>
            <div class="tg-row">
              <div><label>Source</label><input data-v="source" placeholder="e.g. SEC IAPD / CRD lookup"></div>
              <div><label>Reference</label><input data-v="reference" placeholder="lookup reference"></div>
              <div><label>Checked (date)</label><input data-v="checkedAt" placeholder="YYYY-MM-DD"></div>
              <div><label>Reviewer</label><input data-v="reviewer"></div>
            </div>
            <div class="tg-actions"><button class="ghost sm" data-verify="${esc(a.id)}">Record</button>${a.verified ? `<button class="ghost sm" data-unverify="${esc(a.id)}">Clear</button>` : ''}<span class="tg-note">Demo firms are fictional: a recorded reference only demonstrates the workflow.</span></div>
          </details>
        </div>`).join('')}</div>`;
      for (const b of $('tg-advisors').querySelectorAll('[data-assign]')) b.onclick = () => post(`/api/tgan/portfolios/${encodeURIComponent(projectId)}/assign`, { advisorId: b.dataset.assign, unassign: b.dataset.un === '1' });
      for (const b of $('tg-advisors').querySelectorAll('[data-verify]')) b.onclick = () => {
        const box = b.closest('details'); const v = Object.fromEntries([...box.querySelectorAll('[data-v]')].map((i) => [i.dataset.v, i.value]));
        post(`/api/tgan/advisors/${encodeURIComponent(b.dataset.verify)}/verification`, v, 'Verification reference recorded (operator).');
      };
      for (const b of $('tg-advisors').querySelectorAll('[data-unverify]')) b.onclick = () => post(`/api/tgan/advisors/${encodeURIComponent(b.dataset.unverify)}/verification`, { clear: true });
    }

    // ---------- governance ----------
    function renderGov(pf, all) {
      const g = pf.governance;
      const verdict = (e) => `${e.allowed ? '<span class="tg-ok">PASS</span>' : '<span class="tg-no">BLOCKED</span>'} · Guardian ${e.guardian.allowed ? '<span class="tg-ok">allowed</span>' : `<span class="tg-no">refused</span>`}${e.reasons.length || e.guardian.reasons.length ? `<div class="tg-note">${[...e.reasons, ...e.guardian.reasons.map((r) => 'Guardian: ' + r)].map(esc).join('<br>')}</div>` : ''}`;
      $('tg-gov').innerHTML = `
        <div class="tg-kv">
          <b>Objectives</b><span>${g.objectives.map(esc).join('; ')}</span>
          <b>Risk tolerance</b><span>${esc(g.riskTolerance)}</span>
          <b>Authorized assets</b><span>${g.authorizedAssets.map(esc).join(', ')}${g.excludedAssets.map((x) => `<div class="tg-note">Excluded: ${esc(x.asset)} — ${esc(x.reason)}</div>`).join('')}</span>
        </div>
        <h3 style="margin-top:12px">Capital-source restrictions</h3>
        <table><thead><tr><th>Source</th><th class="num">USD ${modeBadge(pf.project.mode)}</th><th>Ownership</th><th>Advisor control</th></tr></thead><tbody>
          ${Object.entries(g.capitalSources).map(([k, s]) => `<tr><td><b>${esc(k)}</b> <span class="tg-note">${esc(s.label)}</span></td><td class="num">${usd(s.usd)}</td><td>${esc(s.ownership)}</td><td>${esc(s.advisorControl)}${s.loanAgreement ? `<div class="tg-note">Loan ${esc(s.loanAgreement.reference)}: ${s.loanAgreement.permittedUses.map(esc).join(', ')}</div>` : ''}</td></tr>`).join('')}
        </tbody></table>
        <h3 style="margin-top:12px">Owner authorizations (T1/T2) ${HYPO}</h3>
        ${pf.authorizations.length ? `<ul class="tg-note">${pf.authorizations.map((a) => `<li>${esc(a.ownerId)} → ${esc(a.advisorId)} · ${esc(a.tier)} · ${a.actions.map(esc).join(', ')} · ref ${esc(a.reference)} ${a.revokedAt ? '<span class="tg-no">revoked</span>' : `<button class="ghost sm" data-revoke="${esc(a.id)}">Revoke</button>`}</li>`).join('')}</ul>` : '<p class="tg-note">None. Advisors have no control over participant-owned wallets.</p>'}
        <h3 style="margin-top:12px">Proposals (XRP/RLUSD incubation strategy)</h3>
        <table><thead><tr><th>Proposal</th><th>Advisor</th><th>Action</th><th>Verdict (TGAN + Guardian)</th><th>Advisor review</th></tr></thead><tbody>
          ${pf.proposals.map((p) => `<tr><td class="mono">${esc(p.id)}</td><td>${esc(p.advisor)}</td><td>${esc(p.actionType)} ${esc(p.asset)} ${usd(p.amountUsd)} from ${esc(p.capitalSource)}${p.ownerId ? ` (owner ${esc(p.ownerId)})` : ''}${p.use ? ` · use ${esc(p.use)}` : ''}</td><td>${verdict(p.evaluation)}</td>
            <td>${esc(p.review.status)} ${HYPO}<div class="tg-actions">${p.evaluation.allowed ? `<button class="ghost sm" data-review="${esc(p.id)}" data-d="APPROVED_HYPOTHETICAL">Approve (hyp.)</button>` : ''}<button class="ghost sm" data-review="${esc(p.id)}" data-d="REJECTED">Reject</button></div></td></tr>`).join('')}
        </tbody></table>
        <p class="tg-note">Approval is a HYPOTHETICAL advisor review of a SIMULATION proposal. It executes nothing and leaves the incubator gates as they are: legal <b>${esc(pf.gates.legal)}</b>, economic <b>${esc(pf.gates.economic)}</b>.</p>
        <details><summary>New proposal (SIMULATION, localhost)</summary>
          <div class="tg-row">
            <div><label>Advisor</label><select id="tg-p-adv">${all.map((a) => `<option value="${esc(a.id)}">${esc(a.firm)}</option>`).join('')}</select></div>
            <div><label>Action</label><select id="tg-p-act">${['RECOMMEND', 'REBALANCE', 'DEPLOY'].map((x) => `<option>${x}</option>`).join('')}</select></div>
            <div><label>Asset</label><select id="tg-p-asset"><option>XRP</option><option>RLUSD</option>${pf.project.token ? `<option>${esc(pf.project.token)}</option>` : ''}</select></div>
            <div><label>Capital source</label><select id="tg-p-src">${['T1', 'T2', 'T3', 'PROJECT', 'PROPRIETARY'].map((x) => `<option>${x}</option>`).join('')}</select></div>
            <div><label>Owner id (T1/T2)</label><input id="tg-p-owner" placeholder="demo-owner-t1-01"></div>
            <div><label>Amount USD</label><input id="tg-p-amt" type="number" min="1" value="5000"></div>
          </div>
          <div class="tg-actions"><button class="primary sm" id="tg-p-go">Submit proposal</button><span class="tg-note">T3 uses ${esc(g.capitalSources.T3.loanAgreement.permittedUses[0])}.</span></div>
        </details>`;
      for (const b of $('tg-gov').querySelectorAll('[data-review]')) b.onclick = () => post(`/api/tgan/portfolios/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(b.dataset.review)}/review`, { decision: b.dataset.d }, `Review recorded (${b.dataset.d}); incubator gates unchanged.`);
      for (const b of $('tg-gov').querySelectorAll('[data-revoke]')) b.onclick = () => post(`/api/tgan/portfolios/${encodeURIComponent(projectId)}/authorizations/${encodeURIComponent(b.dataset.revoke)}/revoke`, {});
      $('tg-p-go').onclick = () => {
        const src = $('tg-p-src').value;
        post(`/api/tgan/portfolios/${encodeURIComponent(projectId)}/proposals`, { advisorId: $('tg-p-adv').value, actionType: $('tg-p-act').value, asset: $('tg-p-asset').value, capitalSource: src, ownerId: $('tg-p-owner').value || undefined, use: src === 'T3' ? g.capitalSources.T3.loanAgreement.permittedUses[0] : undefined, amountUsd: Number($('tg-p-amt').value) }, 'Proposal recorded (SIMULATION).');
      };
    }

    // ---------- performance ----------
    function renderPerf(perf) {
      if (!perf?.available) { $('tg-perf').innerHTML = `<p class="muted">${esc(perf?.note || 'No performance data.')}</p>`; return; }
      const k = (label, v) => `<div class="tg-kpi"><div class="k">${label}</div><div class="v">${v}</div></div>`;
      $('tg-perf').innerHTML = `
        <p style="margin-top:0">${modeBadge(perf.mode)} ${perf.source === 'FIXTURE' ? '<span class="tg-fixture">FIXTURE</span>' : ''} <span class="tg-note">${esc(perf.label)}. ${esc(perf.note)}</span></p>
        <div class="tg-kpis">
          ${k('Beginning value', usd(perf.beginningValueUsd))}${k('Ending value (net)', usd(perf.endingValueNetUsd))}
          ${k('Deposits', usd(perf.depositsUsd))}${k('Withdrawals', usd(perf.withdrawalsUsd))}
          ${k('Realized P&amp;L', usd(perf.realizedPnlUsd))}${k(perf.unrealizedNote ? 'Unrealized marks (separate)' : 'Unrealized P&amp;L', usd(perf.unrealizedPnlUsd))}
          ${k('Expenses', usd(perf.expensesUsd))}${k('Net P&amp;L', usd(perf.netPnlUsd))}
          ${k('High-water mark (cum. net)', usd(perf.highWaterMark?.endingHighWaterMarkUsd))}${k('Below HWM (to recover)', usd(perf.highWaterMark?.unrecoveredLossUsd))}
          ${k('Capital efficiency', pct(perf.capitalEfficiency.netPnlOnAverageCapitalPct))}${k('Time-weighted', pct(perf.returns.timeWeightedPct))}${k('Money-weighted', pct(perf.returns.moneyWeightedPct))}
        </div>
        ${perf.separate ? `<div class="tg-warn"><b>Reported separately, not counted as gain</b> (incubator rule): unrealized marks ${usd(perf.separate.unrealizedMarksUsd)} · inventory appreciation ${usd(perf.separate.inventoryAppreciationUsd)}${perf.separate.t3InterestUsd != null ? ` · T3 interest ${usd(perf.separate.t3InterestUsd)}` : ''} · incubator net MM return ${usd(perf.separate.incubatorNetMmReturnUsd)} (TGAN recomputed net ${usd(perf.netPnlUsd)})</div>` : ''}
        <p class="tg-note">${esc(perf.returns.note)} ${esc(perf.capitalEfficiency.note)}</p>
        <table><thead><tr><th>Period</th><th class="num">Begin</th><th class="num">End</th><th class="num">Deposits</th><th class="num">Withdrawals</th><th class="num">Expenses</th><th class="num">Net gain</th><th class="num">Return</th></tr></thead><tbody>
          ${perf.periods.map((p) => `<tr><td>${esc(p.label)}</td><td class="num">${usd(p.beginValue)}</td><td class="num">${usd(p.endValue)}</td><td class="num">${usd(p.deposits)}</td><td class="num">${usd(p.withdrawals)}</td><td class="num">${usd(p.expenses)}</td><td class="num">${usd(p.netGainUsd)}</td><td class="num">${pct(p.periodReturnPct)}</td></tr>`).join('')}
        </tbody></table>
        <h3 style="margin-top:12px">Advisor-reported vs recomputed ${HYPO}</h3>
        ${perf.reports.length ? perf.reports.map((r) => `<div class="${r.check?.matches ? 'tg-warn' : 'tg-stop'}">${esc(r.advisor)}: ${r.reportedNetPnlUsd != null ? `net P&amp;L ${usd(r.reportedNetPnlUsd)}` : ''} ${r.reportedReturnPct != null ? `return ${pct(r.reportedReturnPct)}` : ''} → ${r.check?.matches ? '<span class="tg-ok">matches recomputation</span>' : `<span class="tg-no">MISMATCH</span> ${esc((r.check?.diffs || []).map((d) => `${d.field}: reported ${d.reported}, recomputed ${d.recomputed}`).join('; '))}`}</div>`).join('') : '<p class="tg-note">No advisor reports.</p>'}`;
    }

    // ---------- fee calculator ----------
    let feeInput = null;
    function feeForm(example) {
      feeInput = feeInput || JSON.parse(JSON.stringify(example));
      const f = feeInput;
      $('tg-fee').innerHTML = `
        <div class="tg-stop"><b>Fee eligibility:</b> <span id="tg-elig"></span></div>
        <div class="tg-row">
          <div><label for="tg-f-rate">Rate (% of net gain)</label><input id="tg-f-rate" type="number" min="0" max="50" step="0.5" value="${esc(f.ratePct)}"></div>
          <div><label for="tg-f-mp">Measurement period</label><select id="tg-f-mp">${ov.feeOptions.measurementPeriods.map((x) => `<option ${x === f.measurementPeriod ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          <div><label for="tg-f-exp">Expense treatment</label><select id="tg-f-exp">${ov.feeOptions.expenseTreatments.map((x) => `<option ${x === f.expenseTreatment ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          <div><label for="tg-f-loss">Prior-loss carryforward $</label><input id="tg-f-loss" type="number" min="0" value="${esc(f.priorLossCarryforward || 0)}"></div>
          <div><label for="tg-f-hwm">Initial HWM value $ (optional)</label><input id="tg-f-hwm" type="number" min="0" value="${esc(f.initialHighWaterMark ?? '')}"></div>
          <div><label for="tg-f-basis">Fee basis</label><select id="tg-f-basis">${[...ov.feeOptions.allowedBases, ...ov.feeOptions.prohibitedBases].map((x) => `<option ${x === (f.feeBasis || 'NET_INVESTMENT_GAIN') ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        </div>
        <div class="tg-note" style="margin-top:4px">Deposits and withdrawals are always excluded from gains. Prohibited bases are listed so you can see them rejected.</div>
        <h3 style="margin-top:12px">Measurement periods</h3>
        <div class="tg-periods">${f.periods.map((p, i) => `<div class="tg-period">${PERIOD_FIELDS.map(([k, l, t]) => `<div><label>${l}</label><input data-pi="${i}" data-pk="${k}" type="${t}" value="${esc(p[k] ?? '')}"></div>`).join('')}</div>`).join('')}</div>
        <div class="tg-actions">
          <button class="primary sm" id="tg-f-calc">Calculate (hypothetical)</button>
          <button class="ghost sm" id="tg-f-add">Add period</button>
          <button class="ghost sm" id="tg-f-ex">Worked example</button>
          <button class="ghost sm" id="tg-f-proj">Use ${esc(projectId)} performance</button>
        </div>
        <div id="tg-f-out" style="margin-top:10px"></div>
        <details><summary>Client-eligibility criteria (operator-configurable)</summary>
          <p class="tg-note">"Qualified client" style criteria are entered by the operator. Verify with counsel; values change. TGAN ships no default values and makes no claim about any threshold.</p>
          <ul class="tg-note" id="tg-crit"></ul>
          <div class="tg-row"><div><label>Criterion</label><input id="tg-c-l"></div><div><label>Value</label><input id="tg-c-v"></div><div><label>Source (counsel ref.)</label><input id="tg-c-s"></div></div>
          <div class="tg-actions"><button class="ghost sm" id="tg-c-add">Add criterion</button><button class="ghost sm" id="tg-c-clear">Clear all</button></div>
        </details>
        <details><summary>Operator: record legal-review reference</summary>
          <div class="tg-row"><div><label>Reference</label><input id="tg-l-ref"></div><div><label>Date</label><input id="tg-l-date" placeholder="YYYY-MM-DD"></div><div><label>Reviewer</label><input id="tg-l-rev"></div></div>
          <div class="tg-actions"><button class="ghost sm" id="tg-l-go">Record</button><button class="ghost sm" id="tg-l-clear">Clear</button><span class="tg-note">Even with a reference recorded, fees stay hypothetical: TGAN has no billing path.</span></div>
        </details>`;
      const read = () => {
        f.ratePct = Number($('tg-f-rate').value); f.measurementPeriod = $('tg-f-mp').value; f.expenseTreatment = $('tg-f-exp').value;
        f.priorLossCarryforward = Number($('tg-f-loss').value) || 0; f.initialHighWaterMark = $('tg-f-hwm').value === '' ? null : Number($('tg-f-hwm').value); f.feeBasis = $('tg-f-basis').value;
        for (const i of $('tg-fee').querySelectorAll('[data-pi]')) f.periods[+i.dataset.pi][i.dataset.pk] = i.type === 'number' ? Number(i.value || 0) : i.value;
      };
      $('tg-f-calc').onclick = () => { read(); calc(); };
      $('tg-f-add').onclick = () => { read(); const last = f.periods.at(-1) || { endValue: 100000, expenses: 0 }; f.periods.push({ label: `Period ${f.periods.length + 1}`, beginValue: (last.endValue || 0) - (f.expenseTreatment === 'DEDUCT_FROM_GAIN' ? (last.expenses || 0) : 0), endValue: last.endValue || 0, deposits: 0, withdrawals: 0, expenses: 0 }); feeForm(example); };
      $('tg-f-ex').onclick = () => { feeInput = JSON.parse(JSON.stringify(example)); feeForm(example); calc(); };
      $('tg-f-proj').onclick = async () => {
        try { const perf = await api.get(`/api/tgan/performance/${encodeURIComponent(projectId)}`); read(); f.periods = perf.periods.map((p) => ({ label: p.label, beginValue: p.beginValue, endValue: p.endValue, deposits: p.deposits, withdrawals: p.withdrawals, expenses: p.expenses })); f.projectId = projectId; feeForm(example); calc(); }
        catch (e) { $('tg-f-out').innerHTML = `<div class="tg-stop">${esc(e.message)}</div>`; }
      };
      $('tg-c-add').onclick = () => post('/api/tgan/eligibility-criteria', { criteria: [...criteria, { label: $('tg-c-l').value, value: $('tg-c-v').value, source: $('tg-c-s').value }] });
      $('tg-c-clear').onclick = () => post('/api/tgan/eligibility-criteria', { criteria: [] });
      $('tg-l-go').onclick = () => post('/api/tgan/legal-review', { reference: $('tg-l-ref').value, date: $('tg-l-date').value, reviewer: $('tg-l-rev').value });
      $('tg-l-clear').onclick = () => post('/api/tgan/legal-review', { clear: true });
      renderCrit();
    }
    async function calc() {
      const out = $('tg-f-out');
      try {
        const r = await fetch('/api/tgan/fee-calculator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(feeInput) }).then((x) => x.json());
        $('tg-elig').textContent = r.eligibility?.label || '';
        if (!r.ok) { out.innerHTML = `<div class="tg-stop"><b>Rejected.</b> ${r.errors.map(esc).join('<br>')}</div>`; return; }
        out.innerHTML = `
          <div class="tg-kpis">
            <div class="tg-kpi"><div class="k">Total hypothetical fee ${HYPO}</div><div class="v">${usd(r.totalHypotheticalFeeUsd)}</div></div>
            <div class="tg-kpi"><div class="k">Ending high-water mark (cum. net gain)</div><div class="v">${usd(r.endingHighWaterMarkUsd)}</div></div>
            <div class="tg-kpi"><div class="k">Billed / collected</div><div class="v">$0</div></div>
          </div>
          <div class="tg-legend"><span><i class="tg-sw" style="background:var(--accent)"></i>Net value at period end</span><span><i class="tg-sw" style="background:var(--sim)"></i>Portion above HWM (fee base)</span><span><i class="tg-sw" style="border-top:2px dashed var(--ink);height:0;border-radius:0"></i>HWM value to beat</span></div>
          <div class="tg-chart" id="tg-chart"></div>
          <table><thead><tr><th>Period</th><th class="num">Net gain</th><th class="num">Cum. net</th><th class="num">HWM before</th><th class="num">Fee base</th><th class="num">Hyp. fee</th></tr></thead><tbody>
            ${r.periods.map((p) => `<tr><td>${esc(p.label)}</td><td class="num">${usd(p.netGainUsd)}</td><td class="num">${usd(p.cumulativeNetUsd)}</td><td class="num">${usd(p.highWaterMarkBeforeUsd)}</td><td class="num">${usd(p.feeBaseUsd)}</td><td class="num">${usd(p.hypotheticalFeeUsd)}</td></tr>`).join('')}
          </tbody></table>
          <ul class="tg-note">${r.periods.map((p) => `<li><b>${esc(p.label)}:</b> ${esc(p.explanation)}</li>`).join('')}</ul>
          ${r.warnings.length ? `<div class="tg-warn">${r.warnings.map(esc).join('<br>')}</div>` : ''}
          <p class="tg-note">${esc(r.method)} Excluded from gains: ${r.excludedFromGains.map(esc).join(', ')}. ${esc(r.billing.note)}</p>
          <p class="tg-note"><b>Worked example:</b> ${esc(example.explanation)}</p>`;
        lastPeriods = r.periods; drawnW = 0; drawChart(); ro?.observe($('tg-chart'));
      } catch (e) { out.innerHTML = `<div class="tg-stop">${esc(e.message)}</div>`; }
    }
    // Bars = net end value; stacked top segment = portion above the HWM value (fee base); dashed step = HWM value.
    let lastPeriods = null, rz = null;
    let drawnW = 0;
    function drawChart(force = true) {
      const c = $('tg-chart'); if (!c || !lastPeriods) return;
      const w = Math.min(760, c.clientWidth); if (!w) return; // hidden tab: the ResizeObserver draws once visible
      if (!force && w === drawnW) return;
      drawnW = w; c.innerHTML = chart(lastPeriods, Math.max(200, w));
    }
    // Redraw when the container gets its real width (tab shown, rotation, resize).
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => drawChart(false), 100); }) : null;
    // Rendered at the container's pixel width (no viewBox scaling) so text stays 11px on phones and desktops.
    function chart(periods, W) {
      const H = 220, L = 44, R = 6, T = 18, B = 26;
      const vals = periods.flatMap((p) => [p.netEndValue, p.hwmValueUsd]);
      const max = Math.max(...vals) * 1.05, min = Math.max(0, Math.min(...vals) * 0.9);
      const y = (v) => T + (H - T - B) * (1 - (v - min) / (max - min || 1));
      const bw = (W - L - R) / periods.length, gap = Math.min(16, bw * 0.25);
      const ticks = [min, (min + max) / 2, max];
      let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="High-water mark chart: net value per period against the high-water-mark value to beat">`;
      s += ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 4}" y="${y(t) + 4}" text-anchor="end">${Math.round(t / 1000)}k</text>`).join('');
      let path = '';
      periods.forEach((p, i) => {
        const x = L + i * bw + gap / 2, w = bw - gap;
        const above = Math.max(0, p.netEndValue - p.hwmValueUsd);
        const yTop = y(p.netEndValue), yCut = y(p.netEndValue - above);
        s += `<g><title>${esc(p.label)}: net value ${usd(p.netEndValue)}, HWM value ${usd(p.hwmValueUsd)}, fee base ${usd(p.feeBaseUsd)}, hypothetical fee ${usd(p.hypotheticalFeeUsd)}</title>`;
        s += `<rect class="bar" x="${x}" y="${yCut}" width="${w}" height="${Math.max(0, y(min) - yCut)}" rx="3"/>`;
        if (above > 0) s += `<rect class="base" x="${x}" y="${yTop}" width="${w}" height="${Math.max(1, yCut - yTop - 2)}" rx="3"/>`;
        s += `<text class="val" x="${x + w / 2}" y="${yTop - 4}" text-anchor="middle">${p.hypotheticalFeeUsd > 0 ? (w > 70 ? 'fee ' : '') + usd(p.hypotheticalFeeUsd) : (w > 50 ? 'no fee' : '$0')}</text>`;
        s += `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${esc(String(p.label).slice(0, Math.max(6, Math.floor(w / 7))))}</text></g>`;
        path += `${i ? 'L' : 'M'}${L + i * bw} ${y(p.hwmValueUsd)} L${L + (i + 1) * bw} ${y(p.hwmValueUsd)} `;
      });
      return s + `<path class="hwm" d="${path}"/></svg>`;
    }

    // ---------- revenue / signals ----------
    function renderRev(rev) {
      $('tg-rev').innerHTML = `<p class="tg-note" style="margin-top:0">${esc(rev.note)}</p><div class="tg-streams">${rev.streams.map((s) => `
        <div class="tg-stream"><b>${esc(s.title)}</b> ${s.hypothetical ? HYPO : ''} ${modeBadge(s.mode)}
          <div class="tg-kv" style="margin-top:6px"><b>Collected</b><span>${usd(s.collectedUsd)}</span>
          ${s.id === 'infrastructure' ? `<b>Free threshold</b><span>${usd(s.thresholdUsd)} <span class="tg-note">${esc(s.thresholdLabel || s.error || '')}</span></span><b>Demo plans</b><span>${s.plans.map((p) => `${esc(p.label)} ${usd(p.monthlyUsdDemo)}/mo`).join('<br>') || '—'}</span>` : ''}
          ${s.id === 'advisory' ? `<b>Hypothetical</b><span>${usd(s.hypotheticalUsd)}</span><b>Eligibility</b><span class="tg-no">${esc(s.eligibility.status)}</span>` : ''}
          </div>
          <div class="tg-note" style="margin-top:6px">${esc(s.status)}</div>
          <div class="tg-actions"><button class="ghost sm" data-tab="${esc(s.link.tab)}">${s.link.tab === 'tgan' ? 'Go to fee calculator' : `Open ${esc(s.link.tab)} tab`}</button><span class="mono">${esc(s.link.api)}</span></div>
        </div>`).join('')}</div>`;
      for (const b of $('tg-rev').querySelectorAll('[data-tab]')) b.onclick = () => b.dataset.tab === 'tgan' ? $('tg-fee').scrollIntoView({ behavior: 'smooth' }) : api.show(b.dataset.tab);
    }
    function renderSig(sg) {
      $('tg-sig').innerHTML = `<p class="tg-note" style="margin-top:0">${esc(sg.note)} <span class="mono">GET /api/tgan/sentinel-signals</span></p>
        ${sg.signals.length ? sg.signals.map((x) => `<div class="tg-sig ${esc(x.severity)}"><b>${esc(x.severity.toUpperCase())}</b> · ${esc(x.title)}<div class="tg-note">${esc(x.detail)}${x.recommendation ? ` <i>Recommended: ${esc(x.recommendation)}</i>` : ''}</div></div>`).join('') : '<p class="tg-ok">No concerns.</p>'}
        <div class="tg-actions"><button class="ghost sm" id="tg-reset">Restore demo scenario</button></div>`;
      $('tg-reset').onclick = () => post('/api/tgan/reset', {}, 'Demo scenario restored.');
    }

    let criteria = [], example = null, busy = false;
    async function refresh() {
      if (busy) return; busy = true;
      try {
        const enc = encodeURIComponent(projectId);
        const [pf, perf, advs, rev, sg, fc] = await Promise.all([api.get(`/api/tgan/portfolios/${enc}`), api.get(`/api/tgan/performance/${enc}`), api.get('/api/tgan/advisors'), api.get('/api/tgan/revenue'), api.get('/api/tgan/sentinel-signals'), api.get('/api/tgan/fee-calculator')]);
        $('tg-src').innerHTML = srcBadge(pf.projectSource.origin); $('tg-srcnote').textContent = pf.projectSource.label;
        renderFlow(pf, perf); renderAdvisors(advs.advisors, pf); renderGov(pf, advs.advisors); renderPerf(perf); renderRev(rev); renderSig(sg);
        criteria = fc.clientCriteria || [];
        if (!example) { example = fc.example; feeForm(example); calc(); } else { $('tg-elig').textContent = fc.result.eligibility.label; }
        renderCrit();
      } catch (e) { $('tg-flow').innerHTML = `<li class="blocked">${esc(e.message)}</li>`; }
      finally { busy = false; }
    }
    function renderCrit() {
      if (!$('tg-crit')) return;
      $('tg-crit').innerHTML = criteria.length ? criteria.map((c) => `<li>${esc(c.label)}: ${esc(c.value)} ${c.source ? `(${esc(c.source)})` : ''} — <i>${esc(c.note)}</i></li>`).join('') : '<li>No criteria configured.</li>';
    }
    api.on((ev) => { if (/^(tgan\.(advisor_assigned|recommendation)|incubator\.)/.test(ev.type)) refresh(); });
    await refresh();
  },
};
