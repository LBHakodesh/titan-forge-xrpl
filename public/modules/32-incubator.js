// TGLB Bootstrap (module id 'incubator'): the Bootstrap studio (name a project, token or XRP/RLUSD incubation,
// funding target, any tier combination, commitments, legal + economic readiness, Tier 3 XLS-65/66-style lending
// simulation, corridor deployment and XDLC handoff) plus the Project Liquidity Incubator: one integrated tab joining Titan Ghost Intelligence discovery, TGLB funding,
// TGLW participation, Titan Ghost execution and the application-level XDLC corridor lifecycle.
// Every figure carries a provenance badge. Nothing here signs, submits or moves funds: every action is an explicit
// operator SIMULATION record (POSTs are accepted from localhost only).
// TGLW self-custody (Tier 1/2): "Commit from your own wallet with Ledger" builds an UNSIGNED, already-expired Testnet
// OfferCreate from the participant's own account for on-device review. Nothing is submitted.
import { LEDGER_PATH, hasWebHid, isNonExecutable, createLedgerSession, shortSig } from '/vendors-ledger.js';

const STYLE = `
.inc .inc-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.inc .inc-row > select,.inc .inc-row > input{width:auto;flex:1 1 140px;min-width:0}
.inc .inc-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))}
.inc .inc-badges .badge,.inc .inc-n .badge{font-size:9px;padding:1px 4px;margin-left:3px;vertical-align:1px}
.inc .inc-n{font-family:var(--mono);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.inc .inc-tabs{display:flex;flex-wrap:wrap;gap:6px}
.inc .inc-tabs button{border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:16px;padding:5px 12px;font:inherit;font-size:13px;cursor:pointer}
.inc .inc-tabs button[aria-pressed="true"]{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.inc .inc-steps{display:grid;gap:6px;grid-template-columns:repeat(auto-fit,minmax(min(100%,140px),1fr));counter-reset:st;margin:0;padding:0;list-style:none}
.inc .inc-steps li{border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-size:12px;color:var(--muted);counter-increment:st}
.inc .inc-steps li b{display:block;color:var(--ink);font-size:13px}
.inc .inc-steps li b::before{content:counter(st) ". "}
.inc .inc-steps li.done{border-color:var(--live)} .inc .inc-steps li.current{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.inc .inc-steps li.blocked{border-style:dashed;border-color:var(--bad)}
.inc .inc-st{font:600 10px var(--mono);letter-spacing:.04em}
.inc .inc-slider{display:grid;grid-template-columns:minmax(0,1fr) 120px;gap:8px;align-items:center;margin:4px 0}
.inc .inc-slider input[type=range]{padding:0;border:0;background:none}
.inc .inc-slider input[type=number]{padding:5px 6px}
.inc .inc-total{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;margin:8px 0;padding:8px;border-radius:6px;background:var(--bg)}
.inc .inc-total .bad{color:var(--bad);font-weight:600} .inc .inc-total .ok{color:var(--live);font-weight:600}
.inc .inc-src{border-top:1px solid var(--line);padding-top:6px;margin-top:6px}
.inc .inc-src h4{margin:0;font-size:13px;display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.inc details{font-size:12px;color:var(--muted)} .inc details ul{margin:4px 0;padding-left:16px}
.inc .inc-bars{display:grid;gap:3px;margin:4px 0 8px}
.inc .inc-bar{display:grid;grid-template-columns:86px minmax(0,1fr) auto;gap:6px;align-items:center;font-size:11px}
.inc .inc-bar .trk{height:9px;border-radius:5px;background:var(--line);overflow:hidden}
.inc .inc-bar .trk i{display:block;height:100%;background:var(--sim)}
.inc .inc-bar.REQUESTED .trk i{background:var(--muted)} .inc .inc-bar.EXECUTABLE .trk i{background:var(--accent)}
.inc .inc-flag{border-left:3px solid var(--bad);background:var(--bad-bg);padding:6px 10px;border-radius:4px;margin:6px 0;font-size:13px}
.inc .inc-okn{border-left:3px solid var(--live);background:var(--live-bg);padding:6px 10px;border-radius:4px;margin:6px 0;font-size:13px}
.inc .inc-note{border-left:3px solid var(--sim);padding:4px 10px;margin:8px 0;font-size:13px}
.inc .inc-gate{list-style:none;margin:0;padding:0}
.inc .inc-gate li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;padding:5px 0;border-bottom:1px solid var(--line);font-size:13px}
.inc .inc-gate small{display:block;color:var(--muted);font-size:11px}
.inc .s-PASS{color:var(--live)} .inc .s-FAIL{color:var(--bad)} .inc .s-OPEN{color:var(--sim)} .inc .s-RESTRICTED{color:var(--replay)}
.inc .inc-rec{border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:8px 0}
.inc .inc-rec h4{margin:0 0 4px;font-size:14px}
.inc .inc-rec ul{margin:4px 0;padding-left:18px;font-size:12px}
.inc .inc-verdict{font-size:12px;padding:6px 8px;border-radius:6px;background:var(--bg);margin-top:6px}
.inc .inc-narr{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))}
.inc .inc-narr div{border:1px solid var(--line);border-radius:8px;padding:8px;font-size:12px}
.inc .inc-narr b{display:block;font-size:13px}
.inc .inc-scroll{overflow-x:auto;max-width:100%}
.inc table td,.inc table th{vertical-align:top}
.inc .inc-hist{max-height:220px;overflow:auto;font-size:12px}
.inc .inc-btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.inc .inc-btns button{font-size:13px}
.inc .inc-msg{font-size:13px;min-height:18px;margin-top:6px}
.inc .inc-budget{display:flex;height:14px;border-radius:7px;overflow:hidden;border:1px solid var(--line);margin:6px 0}
.inc .inc-budget i{display:block;height:100%}
.inc .badge.inc-op{color:var(--ink);background:var(--bg);border:1px solid var(--muted)}
.inc .bs-layout{display:grid;gap:16px;grid-template-columns:minmax(0,420px) minmax(0,1fr);align-items:start}
@media (max-width:960px){.inc .bs-layout{grid-template-columns:minmax(0,1fr)}}
.inc .bs-fs{display:grid;gap:6px 10px;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));margin:6px 0}
.inc .bs-f{display:flex;flex-direction:column;gap:2px;margin:0;font-size:12px;color:var(--muted)}
.inc .bs-f input,.inc .bs-f select{width:100%;min-width:0;box-sizing:border-box}
.inc .bs-small{font-size:12px}
.inc .bs-h4{margin:10px 0 4px;font-size:13px}
.inc .bs-radio{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px;margin:6px 0}
.inc .bs-radio label{display:flex;gap:6px;align-items:center;margin:0}
.inc .bs-tier{border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:8px 0}
.inc .bs-tier.on{border-color:var(--accent);box-shadow:inset 3px 0 0 var(--accent)}
.inc .bs-tog{display:flex;gap:8px;align-items:center;margin:0;font-size:14px}
.inc .bs-radio input,.inc .bs-tog input{width:auto;flex:0 0 auto;margin:0;padding:0}
.inc .bs-li{border-top:1px dashed var(--line);padding-top:4px}
.inc .bs-sum{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(min(100%,120px),1fr))}
.inc .bs-sum small,.inc .bs-pf small{display:block;color:var(--muted);font-size:11px}
.inc .bs-sum b{font-size:14px;overflow-wrap:anywhere}
.inc .bs-pf{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(min(100%,140px),1fr));padding:8px;border-radius:6px;background:var(--bg);margin:8px 0}
.inc .bs-wf{display:grid;gap:3px}
.inc .bs-wfr{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto;gap:6px;align-items:center;font-size:11px}
.inc .bs-wfr .trk{height:9px;border-radius:5px;background:var(--line);overflow:hidden}
.inc .bs-wfr .trk i{display:block;height:100%;background:var(--bad)} .inc .bs-wfr.neg .trk i{background:var(--live)}
.inc .bs-lw .bs-lw-st{display:inline-block;font:600 11px var(--mono);padding:3px 7px;border-radius:4px;color:var(--replay);background:var(--replay-bg)}
.inc .bs-lw .bs-lw-cust{border-left:3px solid var(--live);background:var(--live-bg);padding:6px 10px;border-radius:0 6px 6px 0;font-size:14px;margin:6px 0}
.inc .bs-lw ol{margin:6px 0;padding-left:20px;font-size:13px}
.inc .bs-lw .bs-lw-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0}
.inc .bs-lw .bs-lw-row input[type=number]{width:110px}
.inc .bs-lw label.bs-lw-ck{display:flex;gap:8px;align-items:flex-start;font-size:13px}
.inc .bs-lw label.bs-lw-ck input{width:auto;margin-top:3px}
.inc .bs-pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;max-height:240px;overflow:auto;background:var(--bg);padding:6px;border-radius:6px}
.inc .bs-demo{border:1px solid var(--accent);border-radius:8px;padding:8px 10px;margin-top:10px;background:var(--bg)}
.inc .bs-demo p{margin:4px 0;font-size:13px}
.inc .bs-prog{height:4px;background:var(--line);border-radius:2px;overflow:hidden;margin-bottom:6px}
.inc .bs-prog i{display:block;height:100%;background:var(--accent);transition:width .3s}
.inc .bs-hl{outline:2px solid var(--accent);outline-offset:2px;transition:outline-color .3s}
.inc .inc-form{display:grid;gap:0 12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))}
`;

const STATES = ['REQUESTED', 'MATCHED', 'COMMITTED', 'FUNDED', 'EXECUTABLE'];
const SOURCES = ['T1', 'T2', 'T3', 'PROJECT', 'PROPRIETARY'];
const SRC_COLOR = { T1: 'var(--accent)', T2: 'var(--replay)', T3: 'var(--sim)', PROJECT: 'var(--live)', PROPRIETARY: 'var(--bad)' };
const usd = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US'));
const OUT_LABEL = { REMAIN_IN_INCUBATION: 'Remain in incubation', GRADUATE_TO_TOKEN_CORRIDOR: 'Graduate to token corridor', RESTRICTED_MARKET_PATHWAY: 'Restricted market pathway', DECLINE: 'Decline' };
const PROG_LABEL = { XRP_RLUSD_INTERIM: 'XRP/RLUSD interim program', PROJECT_TOKEN_CORRIDOR: 'Project-token corridor', NONE: 'No program yet' };

export default {
  id: 'incubator', title: 'TGLB Bootstrap', order: 32,
  async mount(el, api) {
    if (!document.getElementById('inc-style')) { const s = document.createElement('style'); s.id = 'inc-style'; s.textContent = STYLE; document.head.append(s); }
    el.classList.add('inc');
    const E = api.esc;
    const CUSTOM = { OPERATOR_INPUT: 'OPERATOR INPUT', APPLICATION_LOGIC: 'APP LOGIC', UNAVAILABLE: 'UNAVAILABLE' };
    const B = (m) => (CUSTOM[m] ? `<span class="badge inc-op" title="${m === 'OPERATOR_INPUT' ? 'Entered by an operator (reviewer input), not generated' : m === 'UNAVAILABLE' ? 'No data' : 'Application logic, not XRPL consensus'}">${CUSTOM[m]}</span>` : api.badge(m));
    const N = (v, mode = 'SIMULATION', fmt = usd) => `<span class="inc-n">${E(fmt(v))}${B(mode)}</span>`;
    const SIMB = api.badge('SIMULATION');
    let meta = null, list = [], sel = null, detail = null, cmp = null, radar = null, view = 'studio', actor = 'Commander', msg = '', draft = null;

    el.innerHTML = '<div class="card muted">Loading TGLB Bootstrap…</div>';
    const load = async () => {
      [meta, { projects: list }] = await Promise.all([api.get('/api/incubator/meta'), api.get('/api/incubator/projects')]);
      if (!sel || !list.some((p) => p.id === sel)) sel = list[0]?.id ?? null;
      detail = sel ? await api.get(`/api/incubator/projects/${encodeURIComponent(sel)}`) : null;
      draft = null;
    };
    try { await load(); } catch (e) { el.innerHTML = `<div class="card err">TGLB Bootstrap unavailable: ${E(e.message)}</div>`; return; }
    let bs = null; // bootstrap meta
    try { bs = await api.get('/api/incubator/bootstrap/meta'); } catch { bs = null; }

    const post = async (path, body, okMsg) => {
      try { const r = await api.post(path, { ...body, actor }); msg = okMsg ? `<span class="s-PASS">${E(okMsg(r))}</span>` : ''; return r; }
      catch (e) { const errs = e.body?.errors || e.body?.result?.reasons || []; msg = `<span class="err">${E(e.message)}${errs.length ? ': ' + E(errs.join(' ')) : ''}</span>`; return null; }
    };

    function header() {
      const nar = (meta.narratives || []).map((n) => `<div><b>${E(n.product)}</b><span class="muted">${E(n.track)}</span><br>${E(n.text)}${n.link ? ` <button class="ghost" data-x402>Open x402 tab</button>` : ''}</div>`).join('');
      if (view === 'studio') return '';
      return `<div class="card"><h2>Project Liquidity Incubator ${SIMB}</h2>
        <p class="muted" style="margin-top:0">TGLB Liquidity Incubation &amp; Graduation Program: Titan Ghost Intelligence discovery → TGLB capital stack → TGLW participation → Titan Ghost execution → application-level XDLC corridor lifecycle. XDLC is a <i>proposed</i> open protocol framework, not live on XRPL.</p>
        <div class="inc-flag" role="note"><b>Disclaimer.</b> ${E(meta.disclaimer)}</div>
        <div class="inc-narr">${nar}</div>
        <p class="muted" style="font-size:12px;margin:8px 0 0">Engine: ${E(meta.engine?.label)}</p></div>`;
    }

    function nav() {
      const ps = `<button data-view="studio" aria-pressed="${view === 'studio'}"><b>Bootstrap studio</b></button>` + list.map((p) => `<button data-proj="${E(p.id)}" aria-pressed="${view === 'project' && p.id === sel}">${E(p.name)}</button>`).join('');
      return `<div class="card"><div class="inc-row" style="justify-content:space-between"><div class="inc-tabs">${ps}
        <button data-view="compare" aria-pressed="${view === 'compare'}">Compare</button><button data-view="radar" aria-pressed="${view === 'radar'}">Radar</button><button data-view="intake" aria-pressed="${view === 'intake'}">New intake</button></div>
        <label style="margin:0;display:flex;gap:6px;align-items:center;flex:0 1 220px">Actor <input id="inc-actor" value="${E(actor)}" maxlength="80" style="flex:1"></label></div>
        <div class="inc-msg" id="inc-msg" aria-live="polite">${msg}</div></div>`;
    }

    function stepper(d) {
      return `<ol class="inc-steps" aria-label="Lifecycle">${d.steps.map((s) => `<li class="${E(s.status)}"><b>${E(s.label)}</b><span class="inc-st">${E(s.status.toUpperCase())}</span><br>${E(s.note)}</li>`).join('')}</ol>`;
    }

    function projectCard(d) {
      const t = d.token;
      const rr = d.regulatoryReview || {};
      return `<div class="card"><h3>${E(d.name)} ${d.fictional ? '<span class="badge bad">FICTIONAL</span>' : ''}</h3>
        <p style="margin:0 0 8px;font-size:13px">${E(d.description)}</p>
        <table><tbody>
          <tr><th>Source</th><td>${E(d.source)}</td></tr>
          <tr><th>Token</th><td>${t ? `${E(t.currency)} · ${E(t.network)} · <span class="mono">${E(t.issuer || 'not yet issued')}</span>` : 'none proposed'}</td></tr>
          <tr><th>Regulatory review</th><td><b>${E(rr.status)}</b> ${B('OPERATOR_INPUT')}<br><small class="muted">${E(rr.reviewer || '—')} · ${E(rr.date || '—')}</small></td></tr>
          <tr><th>Program</th><td>${E(PROG_LABEL[d.program] || d.program)}</td></tr>
          <tr><th>Corridor stage</th><td>${E((d.stages.find((s) => s.id === d.stage) || {}).label || d.stage)} <small class="muted">(application logic)</small></td></tr>
          <tr><th>Outcome</th><td><b>${E(OUT_LABEL[d.outcome] || d.outcome)}</b> ${SIMB}${d.gateDetail.outcome.revoked ? '<br><span class="err">Recorded outcome no longer permitted by the gates: reverted.</span>' : ''}</td></tr>
          <tr><th>Requested</th><td>${N(d.requestedUsd)} over ${E(d.targetOperatingPeriod?.months)} months</td></tr>
          <tr><th>Desired markets</th><td>${E((d.desiredMarkets || []).join(', '))}</td></tr>
        </tbody></table></div>`;
    }

    function designer(d) {
      const st = draft || { targetUsd: d.capitalStack.targetUsd, sources: Object.fromEntries(SOURCES.map((s) => [s, d.capitalStack.sources[s].usd])), t3uw: d.terms?.T3?.underwriting || 'NOT_STARTED' };
      draft = st;
      const max = Math.max(1_000_000, st.targetUsd * 1.5);
      const tierSum = st.sources.T1 + st.sources.T2 + st.sources.T3;
      const combo = ['T1', 'T2', 'T3'].filter((t) => st.sources[t] > 0).join('+') || 'none';
      const bad = tierSum <= 0 ? 'All tiers zero: rejected' : Math.abs(tierSum - st.targetUsd) > 0.5 ? `Tiers ${usd(tierSum)} ≠ target ${usd(st.targetUsd)}` : null;
      const info = meta.sources;
      const row = (s) => `<div class="inc-src"><h4><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${SRC_COLOR[s]}"></span>${E(info[s].label)} <span class="muted" style="font-weight:400">· owner ${E(info[s].owner)}${info[s].projectMoney ? ' · project money' : ' · not project money'}</span></h4>
        <div class="inc-slider"><input type="range" min="0" max="${max}" step="5000" value="${st.sources[s]}" data-src="${s}" aria-label="${E(info[s].label)} amount"><input type="number" min="0" step="1000" value="${st.sources[s]}" data-srcn="${s}" aria-label="${E(info[s].label)} USD"></div>
        <details><summary>Restrictions</summary><ul>${info[s].restrictions.map((r) => `<li>${E(r)}</li>`).join('')}</ul></details></div>`;
      const nl = d.tier3.nativeLending;
      return `<div class="card"><h3>TGLB Capital Stack Designer ${SIMB}</h3>
        <label for="inc-target">TGLB target (Tier 1 + Tier 2 + Tier 3)</label><input id="inc-target" type="number" min="1" step="1000" value="${st.targetUsd}">
        ${['T1', 'T2', 'T3'].map(row).join('')}
        <div class="inc-src"><label for="inc-t3uw" style="margin-top:0">Tier 3 underwriting (lending partner, SIMULATION)</label><select id="inc-t3uw">${['NOT_STARTED', 'IN_UNDERWRITING', 'APPROVED', 'DECLINED'].map((u) => `<option ${u === st.t3uw ? 'selected' : ''}>${u}</option>`).join('')}</select>
          <p style="font-size:12px;margin:4px 0" class="${nl.status === 'UNAVAILABLE' ? 'err' : ''}"><b>Native XRPL lending: ${E(nl.status)}</b> ${api.badge(d.tier3.amendmentCheck.mode)} ${E(nl.note)} <span class="muted">Checked ${E(d.tier3.amendmentCheck.checkedAt)} · RLUSD Testnet issuer <span class="mono">${E(d.tier3.amendmentCheck.rlusd?.issuer)}</span>: ${E(d.tier3.amendmentCheck.rlusd?.status)}</span></p></div>
        <p class="muted" style="font-size:12px;margin:10px 0 0">Separate lines (not part of the TGLB target):</p>
        ${['PROJECT', 'PROPRIETARY'].map(row).join('')}
        <div class="inc-total" aria-live="polite"><span>Tiers ${N(tierSum)}</span><span>Target ${N(st.targetUsd)}</span><span>Combination <b>${E(combo)}</b></span><span>+ Project ${N(st.sources.PROJECT)}</span><span>+ Proprietary ask ${N(st.sources.PROPRIETARY)}</span>
          <span class="${bad ? 'bad' : 'ok'}">${E(bad || 'Balanced')}</span></div>
        ${d.terms?.T2 ? `<p style="font-size:12px;margin:4px 0">Tier 2 contractual terms: ${E(d.terms.T2.termDays)} days, early exit ${E(d.terms.T2.earlyExit.noticeDays)} days notice / ${E(d.terms.T2.earlyExit.penaltyBps)} bps. ${E(d.terms.T2.walletPermissions)}</p>` : ''}
        <div class="inc-btns"><button class="primary" id="inc-save-stack" ${bad ? 'disabled' : ''}>Save stack (SIMULATION)</button><button class="ghost" id="inc-fit">Set target = tier total</button><button class="ghost" id="inc-revert">Revert</button></div>
        <p class="muted" style="font-size:12px">Saving changes REQUESTED only. Later states are clipped, never raised: MATCHED, COMMITTED, FUNDED and EXECUTABLE need their own evidence.</p></div>`;
    }

    function statesCard(d) {
      const cs = d.capitalStates;
      const blocks = SOURCES.map((s) => {
        const req = cs[s].REQUESTED || 0;
        const bars = STATES.map((k) => `<div class="inc-bar ${k}"><span>${k}</span><span class="trk"><i style="width:${req ? Math.min(100, (cs[s][k] / req) * 100) : 0}%"></i></span>${N(cs[s][k])}</div>`).join('');
        return `<div class="inc-src"><h4>${E(meta.sources[s].label)}</h4><div class="inc-bars">${bars}</div></div>`;
      }).join('');
      const gaps = d.fundingGaps.map((g) => `<div class="${g.kind === 'NOT_YET_EXECUTABLE' ? 'inc-note' : 'inc-flag'}">${E(g.text)} ${N(g.shortfallUsd)}</div>`).join('') || '<div class="inc-okn">No funding gaps.</div>';
      const o = d.ownership;
      return `<div class="card"><h3>Capital states by source ${SIMB}</h3>
        <p class="muted" style="font-size:12px;margin-top:0">REQUESTED → MATCHED → COMMITTED → FUNDED → EXECUTABLE, tracked separately per source. A requested target is not a commitment, an approved loan or deployed liquidity.</p>
        ${blocks}<h4 style="margin:10px 0 4px;font-size:13px">Unavailable or pending funding</h4>${gaps}
        <p style="font-size:12px">Participant-owned (T1+T2) ${N(o.participantOwnedUsd)} · creditor-financed ${N(o.creditorFinancedUsd)} · project-owned ${N(o.projectOwnedUsd)} · proprietary ${N(o.proprietaryUsd)}<br><span class="muted">${E(o.note)}</span></p></div>`;
    }

    function gatesCard(d) {
      const g = d.gateDetail;
      const li = (i, legal) => `<li><b class="s-${E(i.status)}">${E(i.status)}</b><span>${E(i.label)} ${legal ? B('OPERATOR_INPUT') : B(i.provenance)}<small>${legal ? `${E(i.docRef || 'no document reference')} · ${E(i.reviewer || '—')} · ${E(i.date || '—')}${i.note ? ' · ' + E(i.note) : ''}` : `${E(i.value)} · threshold ${E(i.threshold)}`}</small></span></li>`;
      return `<div class="card"><h3>Graduation gates</h3>
        <h4 style="margin:6px 0;font-size:13px">Legal gate: <span class="s-${E(g.legal.status)}">${E(g.legal.status)}</span> ${B('OPERATOR_INPUT')}</h4>
        <ul class="inc-gate">${g.legal.items.map((i) => li(i, true)).join('')}</ul>
        <p class="muted" style="font-size:12px">${E(g.legal.note)}</p>
        <h4 style="margin:10px 0 6px;font-size:13px">Economic gate: <span class="s-${E(g.economic.status)}">${E(g.economic.status)}</span> ${SIMB}</h4>
        <ul class="inc-gate">${g.economic.items.map((i) => li(i, false)).join('')}</ul>
        <div class="${g.outcome.computed === 'GRADUATE_TO_TOKEN_CORRIDOR' ? 'inc-okn' : 'inc-note'}" style="margin-top:10px"><b>Gate outcome: ${E(OUT_LABEL[g.outcome.computed])}</b><br>${g.outcome.reasons.map(E).join('<br>')}</div>
        ${g.outcome.legalOverride ? '<div class="inc-flag">Economics pass, but profitability never overrides the legal gate.</div>' : ''}
        <p class="muted" style="font-size:12px">${E(g.permissionedDexNote)}</p></div>`;
    }

    function perfCard(d) {
      const p = d.performance.interim, r = p.rlusdContext || {};
      const rows = SOURCES.map((s) => { const x = p.perSource[s]; return `<tr><td>${E(s)}</td><td class="num">${N(x.positionUsd)}</td><td class="num">${N(x.feesEarnedUsd)}</td><td class="num">${N(x.realizedUsd)}</td><td class="num">${N(x.unrealizedUsd)}</td><td class="num">${N(x.inventoryAppreciationUsd)}</td><td class="num">${N(x.unrecoveredCostsUsd)}</td><td class="num"><span class="inc-n">${E(Math.round(x.inventory.xrp).toLocaleString('en-US'))} XRP / ${E(Math.round(x.inventory.rlusd).toLocaleString('en-US'))} RLUSD${SIMB}</span></td></tr>`; }).join('');
      const ctx = r.mode === 'MAINNET_OBSERVED'
        ? `<p style="font-size:13px">XRP/RLUSD on Mainnet: spread ${N(r.spreadBps, 'MAINNET_OBSERVED', (v) => (v == null ? '—' : v.toFixed(2) + ' bps'))}, ±2% depth ${N(r.depth2pctXrp.total, 'MAINNET_OBSERVED', (v) => Math.round(v).toLocaleString('en-US') + ' XRP')}, 24h volume ${N(r.vol24hXrp, 'MAINNET_OBSERVED', (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US') + ' XRP'))}. <span class="muted">${E(r.note)}</span></p>`
        : `<p class="muted">${B('UNAVAILABLE')} XRP/RLUSD Mainnet context unavailable.</p>`;
      const t = p.totals;
      const replay = (d.performance.replay || []).map((x) => `<div class="inc-src"><h4>${api.badge('REPLAY')} ${E(x.name)} (${E(x.code)})</h4><p style="font-size:12px;margin:2px 0">${E(x.note)}</p>
        ${x.fills.length ? `<ul style="font-size:12px;margin:2px 0;padding-left:16px">${x.fills.map((f) => `<li><a href="${E(f.explorer)}" target="_blank" rel="noopener" class="mono">${E(String(f.hash).slice(0, 12))}…</a> ${E(f.at)} ${api.badge('REPLAY')}</li>`).join('')}</ul>` : `<p class="muted" style="font-size:12px">Recorded book: ${x.book.asks.length} asks / ${x.book.bids.length} bids ${api.badge('REPLAY')}</p>`}</div>`).join('');
      const rings = d.performance.corridorRings;
      const ringHtml = rings ? `<p style="font-size:12px">Corridor rings (${E(rings.ringsActive)} active): ${rings.rings.map((x) => `${E(x.id)} ${N(x.allocUsd)}`).join(' · ')}<br><span class="muted">Engine: ${E(rings.engine?.label)}</span></p>` : '';
      const mat = d.performance.maturity;
      return `<div class="card"><h3>${d.program === 'PROJECT_TOKEN_CORRIDOR' ? 'Bootstrap, fills and maturation' : 'Interim XRP/RLUSD program'} ${SIMB}</h3>
        <div class="inc-note">${E(p.disclaimer)}</div>
        ${ctx}
        <div class="inc-scroll"><table><thead><tr><th>Source</th><th class="num">Position</th><th class="num">Fees earned</th><th class="num">Realized</th><th class="num">Unrealized</th><th class="num">Inventory appreciation</th><th class="num">Unrecovered costs</th><th class="num">Inventory</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p style="font-size:13px">${E(p.days)} days · net market-making return ${N(t.netMmReturnUsd)} (realized ${N(t.realizedUsd)} − costs ${N(t.costsUsd)}, incl. Tier 3 interest ${N(t.t3InterestUsd)}). Inventory appreciation ${N(t.inventoryAppreciationUsd)} and unrealized ${N(t.unrealizedUsd)} are <b>not</b> counted as MM profit.</p>
        <p class="muted" style="font-size:12px">${E(p.priceBasis)}</p>
        ${mat ? `<p style="font-size:13px">Maturation week ${N(mat.week, 'SIMULATION', String)} of ${mat.path.length - 1} · independent share ${N(mat.indepShare, 'SIMULATION', (v) => Math.round(v * 100) + '%')} · proprietary need ${N(d.proprietary.needUsd)} of ${N(d.proprietary.allocatedUsd)} allocated</p>` : ''}
        ${ringHtml}${replay ? `<h4 style="font-size:13px;margin:8px 0 2px">Fills: REPLAY illustrations (not this project's fills)</h4>${replay}` : ''}</div>`;
    }

    function recsCard(d) {
      const recs = d.recommendations.map((r) => `<div class="inc-rec"><h4>${E(r.title)} ${SIMB}</h4><p style="margin:0;font-size:13px">${E(r.rationale)}</p>
        <ul>${r.evidence.map((e) => `<li>${E(e.label)}: ${E(e.value)} ${B(e.provenance)}</li>`).join('')}</ul>
        ${r.corridorTransition ? `<p style="font-size:12px;margin:2px 0">Lifecycle: ${E(r.corridorTransition.fromLabel)} → ${E(r.corridorTransition.toLabel)} (${E(r.corridorTransition.kind)})${r.corridorTransition.why ? ` · <span class="muted">${E(r.corridorTransition.why)}</span>` : ''}</p>` : ''}
        ${r.amountUsd ? `<p style="font-size:12px;margin:2px 0">Amount ${N(r.amountUsd)}</p>` : ''}
        <div class="inc-verdict"><b class="${r.guardian.allowed ? 's-PASS' : 's-FAIL'}">Guardian: ${r.guardian.allowed ? 'ALLOWED (proposal)' : 'REFUSED'}</b> · executes: false · ${E(r.guardian.note)}${r.guardian.reasons.length ? `<br>${r.guardian.reasons.map(E).join('<br>')}` : ''}</div>
        <div class="inc-btns"><button class="ghost" data-ack="${E(r.id)}">Acknowledge (record only)</button></div></div>`).join('') || '<p class="muted">No recommendations: nothing to change right now.</p>';
      return `<div class="card"><h3>Titan Ghost Intelligence recommendations</h3><p class="muted" style="font-size:12px;margin-top:0">Rule-based and explainable; every proposal lists its evidence and Guardian verdict. Nothing executes.</p>${recs}</div>`;
    }

    function decisionsCard(d) {
      const others = list.filter((p) => p.id !== d.id);
      const pr = d.proprietary;
      const hist = [...d.decisions].reverse().map((x) => `<li>${E(x.at)} · <b>${E(x.type)}</b> by ${E(x.actor)} · ${x.result?.ok ? '<span class="s-PASS">recorded</span>' : `<span class="s-FAIL">refused</span> ${E((x.result?.reasons || x.result?.violations || []).join(' '))}`} ${SIMB}</li>`).join('');
      return `<div class="card"><h3>Commander decisions ${SIMB}</h3>
        <p class="muted" style="font-size:12px;margin-top:0">Each button records a SIMULATION decision with the actor and a timestamp. Nothing is signed, submitted or moved.</p>
        <p style="font-size:13px">Proprietary budget ${N(pr.budgetUsd)} · available ${N(pr.availableUsd)} · this project: allocated ${N(pr.allocatedUsd)}, modeled need ${N(pr.needUsd)}, freed ${N(pr.freedUsd)}</p>
        <div class="inc-btns"><button class="primary" data-dec="SELECT_SUPPORT">Select for proprietary support</button><button class="ghost" data-dec="BOOTSTRAP">Bootstrap (mark proprietary executable)</button></div>
        <div class="inc-row" style="margin-top:8px"><select id="inc-outcome" aria-label="Outcome">${Object.entries(OUT_LABEL).map(([k, v]) => `<option value="${k}">${E(v)}</option>`).join('')}</select><button class="ghost" data-dec="RECORD_OUTCOME">Record outcome</button></div>
        <div class="inc-btns"><button class="ghost" data-dec="ADVANCE_MATURITY">Advance maturation one week</button></div>
        <div class="inc-row" style="margin-top:8px"><select id="inc-redeploy" aria-label="Redeploy target">${others.map((p) => `<option value="${E(p.id)}">${E(p.name)}</option>`).join('')}<option value="">Return to pool</option></select><button class="ghost" data-dec="REDEPLOY">Redeploy freed proprietary</button></div>
        <details style="margin-top:8px"><summary>Custody boundary test</summary><p>Attempts to move Tier 1 participant capital to the project treasury without owner authorization. Guardian and the custody check refuse it; the attempt becomes a Sentinel signal.</p><button class="ghost" data-custody>Attempt T1 → project treasury</button></details>
        <h4 style="font-size:13px;margin:10px 0 4px">Decision log</h4><ul class="inc-hist">${hist || '<li class="muted">No decisions yet.</li>'}</ul></div>`;
    }

    function compareView() {
      if (!cmp) return '<div class="card muted">Loading comparison…</div>';
      const a = cmp.a, b = cmp.b;
      const r = (label, f, mode = 'SIMULATION') => `<tr><th>${E(label)}</th><td>${f(a)}</td><td>${f(b)}</td></tr>`;
      const txt = (k) => (x) => E(x[k]);
      const total = cmp.proprietary.budgetUsd || 1;
      const segs = Object.entries(cmp.proprietary.allocations).map(([id, v], i) => `<i style="width:${(v / total) * 100}%;background:${['var(--accent)', 'var(--replay)', 'var(--sim)'][i % 3]}" title="${E(id)} ${usd(v)}"></i>`).join('');
      return `<div class="card"><h3>Side-by-side comparison ${SIMB}</h3><div class="inc-scroll"><table><thead><tr><th></th><th>${E(a.name)}</th><th>${E(b.name)}</th></tr></thead><tbody>
        ${r('Program', (x) => E(PROG_LABEL[x.program]))}${r('Stage', txt('stage'))}${r('Outcome', (x) => E(OUT_LABEL[x.outcome]))}
        ${r('Regulatory review', (x) => `${E(x.regulatoryStatus)} ${B('OPERATOR_INPUT')}`)}${r('Legal gate', (x) => `<span class="s-${E(x.legal)}">${E(x.legal)}</span>`)}${r('Economic gate', (x) => `<span class="s-${E(x.economic)}">${E(x.economic)}</span>`)}
        ${r('Tier combination', txt('combination'))}${r('TGLB target', (x) => N(x.targetUsd))}
        ${SOURCES.map((s) => r(`${s} executable / requested`, (x) => `${N(x.executableUsd[s])} / ${N(x.requestedUsd[s])}`)).join('')}
        ${r('Net MM return (interim)', (x) => N(x.netMmReturnUsd))}${r('Unrecovered costs', (x) => N(x.unrecoveredCostsUsd))}${r('Inventory appreciation (separate)', (x) => N(x.inventoryAppreciationUsd))}
        ${r('Proprietary ask / allocated', (x) => `${N(x.proprietaryAskUsd)} / ${N(x.proprietaryAllocatedUsd)}`)}${r('Funding gaps', (x) => N(x.fundingGaps, 'SIMULATION', String))}
        </tbody></table></div>
        <h4 style="font-size:13px;margin:12px 0 4px">Limited proprietary capital</h4><p style="font-size:13px;margin:0">Budget ${N(cmp.proprietary.budgetUsd)} · available ${N(cmp.proprietary.availableUsd)}</p><div class="inc-budget" aria-hidden="true">${segs}</div>
        <div class="inc-okn"><b>Titan Ghost Intelligence: support ${E((cmp.support.ranked.find((x) => x.projectId === cmp.support.recommended) || {}).name || '—')}</b><br>${E(cmp.support.rationale)}</div>
        <ul style="font-size:12px">${cmp.support.ranked.map((x) => `<li><b>${E(x.name)}</b> score ${N(x.score, 'SIMULATION', String)}: ${x.evidence.map(E).join('; ')}</li>`).join('')}</ul>
        <p class="muted" style="font-size:12px">${E(cmp.support.note)}</p>
        <div class="inc-btns">${[a, b].map((x) => `<button class="${x.id === cmp.support.recommended ? 'primary' : 'ghost'}" data-select="${E(x.id)}">Commander: support ${E(x.name)}</button>`).join('')}</div></div>`;
    }

    function radarView() {
      if (!radar) return '<div class="card muted">Loading radar…</div>';
      const rows = radar.items.slice(0, 25).map((x) => `<tr><td><b>${E(x.name)}</b> <span class="mono">${E(x.currency)}</span><br><small class="muted">${E(x.note)}</small></td><td>${api.badge(x.mode)}</td>
        <td>${x.signals.map((s) => `${E(s.label)}: ${E(s.value)}`).join('<br>')}</td><td class="num">${N(x.thinnessScore, x.mode, String)}</td>
        <td>${x.candidate ? (x.inIntake ? 'In intake' : `<button class="ghost" data-radar="${E(x.id)}">Start intake</button>`) : '<span class="muted">screened out</span>'}</td></tr>`).join('');
      const r = radar.rlusdContext;
      return `<div class="card"><h3>Opportunity radar ${api.badge('MAINNET_OBSERVED')}</h3><p class="muted" style="font-size:13px;margin-top:0">${E(radar.note)} ${radar.attributionHtml || ''}</p>
        ${r?.mode === 'MAINNET_OBSERVED' ? `<p style="font-size:12px">Interim quote market reference: XRP/RLUSD spread ${N(r.spreadBps, 'MAINNET_OBSERVED', (v) => v.toFixed(2) + ' bps')}.</p>` : ''}
        <div class="inc-scroll"><table><thead><tr><th>Spoke</th><th>Data</th><th>Thin-liquidity signals</th><th class="num">Score</th><th>Action</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">No thin-liquidity spokes in the snapshot.</td></tr>'}</tbody></table></div></div>`;
    }

    function intakeView(prefill = {}) {
      const f = (id, label, input) => `<div><label for="inc-f-${id}">${E(label)}</label>${input}</div>`;
      const i = (id, v = '', type = 'text', extra = '') => `<input id="inc-f-${id}" type="${type}" value="${E(v)}" ${extra}>`;
      return `<div class="card"><h3>Project intake ${SIMB}</h3><p class="muted" style="font-size:13px;margin-top:0">${prefill.radarId ? `Radar-discovered: ${E(prefill.name)}. ` : ''}Regulatory review status is entered by an operator with the reviewer and date. It is never generated.</p>
        <form id="inc-intake" class="inc-form">
          ${f('id', 'Project id (lowercase, hyphens)', i('id', prefill.id || '', 'text', 'required pattern="[a-z0-9][a-z0-9-]{2,40}"'))}
          ${f('name', 'Project name', i('name', prefill.name || ''))}
          <div style="grid-column:1/-1">${f('description', 'Business description', `<textarea id="inc-f-description" rows="3">${E(prefill.description || '')}</textarea>`)}</div>
          ${f('network', 'Token network', `<select id="inc-f-network"><option value="testnet">testnet</option><option value="mainnet" ${prefill.network === 'mainnet' ? 'selected' : ''}>mainnet (identity only)</option><option value="not_yet_selected">not yet selected</option></select>`)}
          ${f('currency', 'Token currency code', i('currency', prefill.currency || ''))}
          ${f('issuer', 'Issuer (r-address or NOT_YET_ISSUED)', i('issuer', prefill.issuer || 'NOT_YET_ISSUED'))}
          ${f('rstatus', 'Regulatory review status (operator input)', `<select id="inc-f-rstatus">${['NOT_STARTED', 'IN_REVIEW', 'COUNSEL_OPINION_RECEIVED', 'RESTRICTED_PATHWAY', 'NOT_ELIGIBLE'].map((s) => `<option>${s}</option>`).join('')}</select>`)}
          ${f('reviewer', 'Reviewer', i('reviewer'))}
          ${f('rdate', 'Review date', i('rdate', '', 'date'))}
          ${f('requested', 'Requested amount (USD)', i('requested', '100000', 'number', 'min="1"'))}
          ${f('months', 'Target operating period (months)', i('months', '12', 'number', 'min="1" max="60"'))}
          ${f('runway', 'Runway (months)', i('runway', '12', 'number', 'min="0"'))}
          ${f('spread', 'MM economics: target spread (bps)', i('spread', '50', 'number', 'min="1"'))}
          ${f('depth', 'MM economics: minimum depth (USD)', i('depth', '10000', 'number', 'min="0"'))}
          ${f('markets', 'Desired future markets (comma-separated)', i('markets', prefill.currency ? `${prefill.currency}/XRP` : ''))}
          <div style="grid-column:1/-1">${f('sustain', 'Business sustainability measures', `<textarea id="inc-f-sustain" rows="2"></textarea>`)}</div>
        </form><div class="inc-btns"><button class="primary" id="inc-submit">Submit intake (SIMULATION)</button></div></div>`;
    }

    // ===================== TGLB Bootstrap studio =====================
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const TIERS = ['T1', 'T2', 'T3'];
    const CATS = ['REQUESTED', 'COMMITTED', 'FUNDED', 'EXECUTABLE'];
    const LEGAL_ST = ['OPEN', 'PASS', 'RESTRICTED', 'FAIL'];
    const REG_ST = ['NOT_STARTED', 'IN_REVIEW', 'COUNSEL_OPINION_RECEIVED', 'RESTRICTED_PATHWAY', 'NOT_ELIGIBLE'];
    const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
    const fromDemo = () => { const d = clone(bs?.demoProject || {}); d._tokenMode = d.token ? 'token' : 'incubate'; return d; };
    let S = bs ? fromDemo() : null, plan = null, planErr = null, handoffMsg = '', recomputeT = null;
    const demo = { steps: null, i: -1, timer: null, playing: false, ms: 2600 };

    const getK = (o, k) => k.split('.').reduce((a, x) => (a == null ? undefined : a[x]), o);
    const setK = (o, k, v) => { const ks = k.split('.'); let a = o; for (const x of ks.slice(0, -1)) { if (a[x] == null || typeof a[x] !== 'object') a[x] = {}; a = a[x]; } a[ks.at(-1)] = v; };
    function requestBody() {
      const b = clone(S);
      if (b._tokenMode !== 'token') b.token = null;
      delete b._tokenMode;
      const rr = b.legal?.regulatoryReview || {};
      for (const it of Object.values(b.legal?.items || {})) { if (it.status !== 'OPEN') { it.reviewer ||= rr.reviewer; it.date ||= rr.date; } }
      return b;
    }
    async function recompute() {
      if (!S) return;
      try { plan = await api.post('/api/incubator/bootstrap/plan', requestBody()); planErr = null; }
      catch (e) { planErr = (e.body?.errors || [e.message]); }
      const out = el.querySelector('#bs-out'); if (out) out.innerHTML = studioResults();
      wireResults();
    }
    const later = () => { clearTimeout(recomputeT); recomputeT = setTimeout(recompute, 250); };

    const fld = (k, label, type = 'number', extra = '') => {
      const v = getK(S, k);
      const shown = type === 'pct' ? Math.round((Number(v) || 0) * 100) : (v ?? '');
      return `<label class="bs-f"><span>${E(label)}</span><input data-k="${k}" data-t="${type}" type="${type === 'text' || type === 'date' ? type : 'number'}" value="${E(shown)}" ${type === 'pct' ? 'min="0" max="100" step="1"' : type === 'number' ? 'min="0" step="any"' : ''} ${extra}></label>`;
    };
    const pick = (k, label, opts) => `<label class="bs-f"><span>${E(label)}</span><select data-k="${k}" data-t="text">${opts.map((o) => `<option ${getK(S, k) === o ? 'selected' : ''}>${E(o)}</option>`).join('')}</select></label>`;

    function studioForm() {
      const tm = S._tokenMode;
      const tiers = TIERS.map((t) => {
        const on = !!S.tiers?.[t]?.enabled;
        const info = bs.tiers[t];
        let body = '';
        if (on && t !== 'T3') body = `<div class="bs-fs">${fld(`tiers.${t}.usd`, 'Allocation (USD)')}${fld(`tiers.${t}.commitRate`, 'Committed % of requested', 'pct')}${fld(`tiers.${t}.fundRate`, 'Funded % of committed', 'pct')}${fld(`tiers.${t}.execRate`, 'Executable % of funded', 'pct')}</div>`
          + (t === 'T2' ? `<div class="bs-fs">${fld('tiers.T2.termDays', 'Term (days)')}${fld('tiers.T2.earlyExit.noticeDays', 'Early-exit notice (days)')}${fld('tiers.T2.earlyExit.penaltyBps', 'Early-exit charge (bps)')}</div>` : '');
        if (on && t === 'T3') body = `<div class="bs-fs">${fld('tiers.T3.usd', 'Loan request (USD)')}${fld('tiers.T3.application.termMonths', 'Term (months)', 'number', 'step="1" min="1"')}${pick('tiers.T3.application.structure', 'Structure', bs.lending.structures)}${fld('tiers.T3.application.requestedAprBps', 'Requested APR (bps)')}
          ${fld('tiers.T3.application.collateralUsd', 'Collateral (USD)')}${fld('tiers.T3.application.monthlyRevenueUsd', 'Monthly revenue (USD)')}${fld('tiers.T3.application.monthlyOpexUsd', 'Monthly opex (USD)')}${fld('tiers.T3.application.existingDebtUsd', 'Existing debt (USD)')}
          ${fld('tiers.T3.application.runwayMonths', 'Runway (months)')}${fld('tiers.T3.application.operatingHistoryMonths', 'Operating history (months)')}
          ${pick('tiers.T3.application.permittedUses.0', 'Use of proceeds', [...bs.lending.permittedUses, ...bs.lending.restrictedUses])}${pick('tiers.T3.scenario', 'Repayment scenario', bs.lending.scenarios)}
          ${S.tiers.T3.scenario === 'LATE' || S.tiers.T3.scenario === 'DEFAULT' ? fld('tiers.T3.scenarioOpts.missFromPeriod', 'Missed from month', 'number', 'step="1" min="1"') : ''}${S.tiers.T3.scenario === 'LATE' ? fld('tiers.T3.scenarioOpts.lateDays', 'Days late', 'number', 'step="1" min="1" max="89"') : ''}</div>`;
        return `<div class="bs-tier ${on ? 'on' : ''}"><label class="bs-tog"><input type="checkbox" data-tier="${t}" ${on ? 'checked' : ''}> <b>${E(info.label)}</b></label>
          <small class="muted">${E(info.custody)} · ${E(info.use)} · ${info.projectFunds ? 'project funds' : 'never project funds'}</small>${body}</div>`;
      }).join('');
      const items = (bs.legalItems || []).map((li) => `<div class="bs-fs bs-li">${pick(`legal.items.${li.id}.status`, li.label, LEGAL_ST)}${fld(`legal.items.${li.id}.docRef`, 'Document reference', 'text', 'maxlength="120"')}</div>`).join('');
      return `<div class="card" id="bs-card-project"><h3>1 · Project ${SIMB}</h3>
          <div class="bs-fs">${fld('name', 'Project name', 'text', 'maxlength="80"')}${fld('targetUsd', 'Funding target (USD, Tier 1+2+3)')}${fld('projectOwnUsd', 'Project-owned capital (separate line)')}</div>
          <div class="bs-radio" role="radiogroup" aria-label="Token or incubation">
            <label><input type="radio" name="bs-tm" value="token" ${tm === 'token' ? 'checked' : ''}> Identify project token</label>
            <label><input type="radio" name="bs-tm" value="incubate" ${tm !== 'token' ? 'checked' : ''}> No token yet: XRP/RLUSD incubation</label></div>
          <div class="bs-fs">${tm === 'token' ? `${fld('token.currency', 'Token currency code', 'text', 'maxlength="40"')}${fld('token.issuer', 'Issuer (r-address or NOT_YET_ISSUED)', 'text', 'maxlength="40"')}` : ''}${pick('incubationAsset', 'Interim incubation asset', bs.incubationAssets)}</div>
          <p class="muted bs-small">The interim XRP/RLUSD corridor supports projects whose own-token market is not yet legally eligible or economically justified. It creates no market or price for the project's token.</p></div>
        <div class="card" id="bs-card-tiers"><h3>2 · Tiers: any combination ${SIMB}</h3>
          <p class="muted bs-small">TGLW = Titan Ghost Liquidity Wake (self-custodial liquidity participation). Toggling a tier re-splits the target evenly; then adjust allocations so they add up to the target.</p>${tiers}
          <div class="inc-btns"><button class="ghost" id="bs-split">Split target evenly</button></div></div>
        <div class="card" id="bs-card-ready"><h3>3 · Readiness inputs</h3>
          <h4 class="bs-h4">Legal (operator-entered reviewer input) ${B('OPERATOR_INPUT')}</h4>
          <div class="bs-fs">${pick('legal.regulatoryReview.status', 'Regulatory review', REG_ST)}${fld('legal.regulatoryReview.reviewer', 'Reviewer', 'text', 'maxlength="120"')}${fld('legal.regulatoryReview.date', 'Review date', 'date')}</div>${items}
          <p class="muted bs-small">PASS / RESTRICTED / FAIL need a document reference, reviewer and date, otherwise the item stays OPEN.</p>
          <h4 class="bs-h4">Economic ${SIMB}</h4>
          <div class="bs-fs">${fld('economics.runwayMonths', 'Runway (months)')}${fld('economics.operatingMonths', 'Operating period (months)')}${fld('economics.independentParticipants', 'Independent participants')}${fld('economics.verifiedEvidence', 'Verified demand evidence refs')}${fld('economics.targetSpreadBps', 'Target spread (bps)')}</div></div>`;
    }

    const bar = (label, v, max, cls = '') => `<div class="inc-bar ${cls}"><span>${E(label)}</span><span class="trk"><i style="width:${max > 0 ? Math.min(100, (v / max) * 100) : 0}%"></i></span>${N(v)}</div>`;
    const st = (s) => `<b class="s-${E(s)}">${E(s)}</b>`;

    function studioResults() {
      if (planErr) return `<div class="card"><div class="inc-flag"><b>Plan not valid yet.</b><br>${planErr.map(E).join('<br>')}</div></div>`;
      if (!plan) return '<div class="card muted">Computing plan…</div>';
      const p = plan, o = p.readiness.outcome, t = p.categoryTotals;
      const summary = `<div class="card bs-sum" id="bs-sum"><div><small>Project</small><b>${E(p.name)}</b></div><div><small>Token</small><b>${p.token ? E(p.token.currency) + (p.token.issued ? '' : ' (not issued)') : 'none · ' + E(p.incubationAsset) + ' incubation'}</b></div>
        <div><small>Tiers</small><b>${E(p.combination)}</b></div><div><small>Target</small>${N(p.targetUsd)}</div><div><small>Executable</small>${N(t.EXECUTABLE)}</div>
        <div><small>Outcome</small><b>${E(OUT_LABEL[o.outcome] || o.outcome)}</b></div><div><small>Corridor</small><b>${E(p.selectedCorridor?.pair || 'none eligible')}</b></div></div>`;
      const rows = TIERS.map((k) => `<tr class="${p.tiers.includes(k) ? '' : 'muted'}"><th>${E(p.tierInfo[k].label)}</th>${CATS.map((c) => `<td class="num">${N(p.capital[k][c])}</td>`).join('')}</tr>`).join('');
      const pf = p.projectFunds;
      const capital = `<div class="card" id="bs-capital"><h3>Capital: requested · committed · funded · executable ${SIMB}</h3>
        <div class="inc-scroll"><table><thead><tr><th>Tier</th>${CATS.map((c) => `<th class="num">${c}</th>`).join('')}</tr></thead><tbody>${rows}</tbody>
        <tfoot><tr><th>Per-category total</th>${CATS.map((c) => `<td class="num"><b>${N(t[c])}</b></td>`).join('')}</tr></tfoot></table></div>
        <p class="muted bs-small">Each column is its own number. Categories are never added together: a request is not a commitment, a commitment is not funding, and funding is not executable liquidity.</p>
        <div class="bs-pf"><div><small>Project-owned funds</small>${N(pf.projectOwnedUsd)}</div><div><small>TGLW counted as project funds</small>${N(pf.tglwCountedAsProjectFundsUsd)}</div>
          <div><small>TGLW participant-owned (funded)</small>${N(pf.tglwParticipantUsd.T1 + pf.tglwParticipantUsd.T2)}</div><div><small>Tier 3 borrowed (liability)</small>${N(pf.borrowedT3Usd)}</div></div>
        <p class="bs-small">${E(pf.note)}</p>
        ${p.gaps.length ? `<details><summary>${p.gaps.length} availability gaps</summary><ul>${p.gaps.map((g) => `<li>${E(g.tier)}: ${E(g.from)} → ${E(g.to)} short ${E(usd(g.shortfallUsd))}</li>`).join('')}</ul></details>` : ''}
        ${p.t2Terms ? `<div class="inc-note"><b>Tier 2 exit rules (contractual disclosure).</b> ${E(p.t2Terms.disclosure)} ${E(p.t2Terms.walletPermissions || '')}</div>` : ''}
        <details><summary>Tier disclosures</summary><ul>${p.tiers.map((k) => `<li><b>${E(p.tierInfo[k].label)}</b>: ${E(p.tierInfo[k].disclosure)}</li>`).join('')}</ul></details></div>`;
      const L = p.readiness.legal, Ec = p.readiness.economic;
      const ready = `<div class="card" id="bs-ready"><h3>Legal &amp; economic readiness</h3><p class="muted bs-small">Two independent gates. Legal input never changes the economic result and vice versa. Profitability never overrides the legal gate.</p>
        <div class="inc-grid"><div><h4 class="bs-h4">Legal: ${st(L.status)} ${B('OPERATOR_INPUT')}</h4><ul class="inc-gate">${L.items.map((i) => `<li>${st(i.status)}<span>${E(i.label)}<small>${E(i.docRef || 'no document reference')}${i.note ? ' · ' + E(i.note) : ''}</small></span></li>`).join('')}</ul></div>
        <div><h4 class="bs-h4">Economic: ${st(Ec.status)} ${SIMB}</h4><ul class="inc-gate">${Ec.items.map((i) => `<li>${st(i.status)}<span>${E(i.label)}<small>${E(i.value)} · threshold ${E(i.threshold)}</small></span></li>`).join('')}</ul></div></div>
        <div class="${o.outcome === 'GRADUATE_TO_TOKEN_CORRIDOR' ? 'inc-okn' : 'inc-note'}"><b>${E(OUT_LABEL[o.outcome] || o.outcome)}</b><br>${o.reasons.map(E).join('<br>')}</div></div>`;
      return summary + capital + ready + lendingCard(p.loan) + corridorCard(p);
    }

    function lendingCard(l) {
      if (!l) return `<div class="card" id="bs-lending"><h3>Tier 3 lending</h3><p class="muted">Tier 3 is not selected. Enable it to model a loan application, underwriting, repayment, default and lender loss.</p></div>`;
      const u = l.underwriting;
      const fac = u.factors.map((f) => `<tr><td>${E(f.label)}<br><small class="muted">${E(f.rule)}</small></td><td>${E(f.value)}</td><td class="num"><b>${f.points}</b>/${f.max}</td></tr>`).join('');
      const sc = l.scenario, s = l.schedule, w = l.waterfall;
      const sched = s ? `<details><summary>Repayment schedule: ${s.termMonths} × monthly, ${E(s.structure)}, total interest ${E(usd(s.totalInterestUsd))}</summary><div class="inc-scroll"><table><thead><tr><th>Month</th><th class="num">Opening</th><th class="num">Interest</th><th class="num">Principal</th><th class="num">Payment</th><th class="num">Closing</th></tr></thead><tbody>${s.rows.map((r) => `<tr><td>${r.period}</td><td class="num">${E(usd(r.openingUsd))}</td><td class="num">${E(usd(r.interestUsd))}</td><td class="num">${E(usd(r.principalUsd))}</td><td class="num">${E(usd(r.paymentUsd))}</td><td class="num">${E(usd(r.closingUsd))}</td></tr>`).join('')}</tbody></table></div><p class="bs-small">${E(s.formula)}</p></details>` : '';
      const evs = sc ? sc.events.filter((e) => e.kind !== 'PAID').map((e) => `<li><b>${E(e.kind)}</b> day ${E(e.day)}${e.period ? ` (month ${e.period})` : ''}: ${E(usd(e.amountUsd))}${e.daysPastDue != null ? ` · ${e.daysPastDue} DPD` : ''}${e.lateFeeUsd ? ` · late fee ${E(usd(e.lateFeeUsd))}, penalty ${E(usd(e.penaltyInterestUsd))}` : ''}</li>`).join('') : '';
      const wmax = w ? w.eadUsd : 1;
      const wf = w ? `<h4 class="bs-h4">Loss waterfall ${SIMB}</h4><div class="bs-wf">${w.steps.map((x) => `<div class="bs-wfr ${x.usd < 0 ? 'neg' : ''}"><span>${E(x.step)}</span><span class="trk"><i style="width:${Math.min(100, Math.abs(x.usd) / wmax * 100)}%"></i></span>${N(x.usd)}</div>`).join('')}</div>
        <p class="bs-small">LGD ${E(w.lgdPct)}% · per lender: ${w.perLender.map((x) => `${E(x.id)} ${E(usd(x.lossUsd))}`).join(' · ')}</p>` : '';
      const lr = l.lenderRisk;
      return `<div class="card" id="bs-lending"><h3>Tier 3 lending <span class="badge sim">${E(l.label)}</span></h3>
        <p class="bs-small inc-flag">${E(l.native.reason)} Native XRPL vault/lending used: <b>no</b>.</p>
        <div class="bs-sum"><div><small>Decision</small><b class="${u.decision === 'DECLINED' ? 's-FAIL' : 's-PASS'}">${E(u.decision)}</b></div><div><small>Score / grade</small><b>${u.score}/100 · ${E(u.grade)}</b></div><div><small>APR</small><b>${u.aprBps != null ? (u.aprBps / 100).toFixed(2) + '%' : '—'}</b></div><div><small>Approved</small>${N(u.approvedPrincipalUsd)}</div><div><small>DSCR (stress)</small><b>${u.dscr.toFixed(2)}×</b></div></div>
        <details open><summary>Underwriting scorecard</summary><div class="inc-scroll"><table><thead><tr><th>Factor</th><th>Value</th><th class="num">Points</th></tr></thead><tbody>${fac}</tbody></table></div>
        <p class="bs-small">${E(u.thresholds)} · ${E(u.pricingRule)}</p>${u.knockouts.length ? `<div class="inc-flag">Knockouts: ${u.knockouts.map(E).join(' ')}</div>` : ''}${u.conditions.length ? `<div class="inc-note">Conditions: ${u.conditions.map(E).join(' ')}</div>` : ''}</details>
        ${sched}
        ${sc ? `<h4 class="bs-h4">Scenario: ${E(sc.scenario)} → <span class="${sc.defaulted ? 's-FAIL' : 's-PASS'}">${E(sc.status)}</span></h4><ul class="bs-small">${evs || '<li>All payments on time.</li>'}</ul>${sc.formula ? `<p class="bs-small muted">${E(sc.formula)}</p>` : ''}${sc.ead ? `<p class="bs-small">EAD ${N(sc.ead.totalUsd)} = principal ${E(usd(sc.ead.outstandingPrincipalUsd))} + interest ${E(usd(sc.ead.accruedInterestUsd))} + penalty ${E(usd(sc.ead.penaltyInterestUsd))}</p>` : ''}` : ''}
        ${wf}
        ${lr ? `<p class="bs-small">Lender risk: PD ${E(lr.pdPct)}% (grade) · LGD ${E(lr.lgdPct)}% · expected senior loss ${N(lr.expectedLossUsd)} · first-loss tranche ${N(lr.firstLossUsd)} · reserve ${N(lr.reserveUsd)}<br><span class="muted">${E(lr.note)}</span></p>` : ''}
        ${l.useOfProceeds && !l.useOfProceeds.ok ? `<div class="inc-flag"><b>Restricted-use breach:</b> ${l.useOfProceeds.breaches.map((b) => `${E(b.use)} ${E(usd(b.usd))}`).join(', ')}</div>` : ''}
        ${l.signals?.length ? `<p class="bs-small">Sentinel lending signals: ${l.signals.map((x) => `<span class="badge ${x.severity === 'high' ? 'bad' : 'sim'}">${E(x.kind)}</span>`).join(' ')}</p>` : ''}
        <p class="muted bs-small">${E(l.disclosure)}</p></div>`;
    }

    function corridorCard(p) {
      const d = p.deploy;
      const opts = p.corridors.map((c) => `<li>${c.eligible ? '<b class="s-PASS">ELIGIBLE</b>' : '<b class="s-OPEN">NOT YET</b>'}<span><b>${E(c.pair)}</b> <small>${E(c.kind === 'INTERIM_INCUBATION' ? 'interim incubation corridor' : 'project-token corridor')}${c.restricted ? ' · restricted pathway' : ''}</small><small>${c.reasons.map(E).join(' ')}</small></span></li>`).join('');
      const rmax = Math.max(1, ...d.rings.map((r) => r.allocUsd));
      return `<div class="card" id="bs-corridor"><h3>Corridor deployment ${SIMB}</h3><ul class="inc-gate">${opts}</ul>
        ${d.corridor ? `<h4 class="bs-h4">Simulated deployment into ${E(d.corridor)}: ${N(d.deployUsd)}</h4><div class="inc-bars">${d.rings.map((r) => bar(r.id, r.allocUsd, rmax)).join('')}</div>
        <p class="bs-small">Price impact for a $10,000 order: ${N(d.impactBps, 'SIMULATION', (v) => (Number.isFinite(v) ? v + ' bps' : 'exceeds depth'))} · idle ${N(d.idleUsd)} · Engine: ${E(d.engine?.label)}</p>
        <div class="inc-verdict"><b class="${d.guardian?.allowed ? 's-PASS' : 's-FAIL'}">Guardian: ${d.guardian?.allowed ? 'ALLOWED (simulation)' : 'REFUSED'}</b> · executes: false · ${E(d.guardian?.note || '')}</div>` : `<p class="muted">${E(d.note || 'Nothing to deploy.')}</p>`}
        ${p.handoff ? `<div class="inc-btns"><button class="primary" id="bs-xdlc">Deploy into XDLC corridor</button></div><div class="inc-msg" id="bs-xdlc-msg" aria-live="polite">${handoffMsg}</div>
        <details><summary>Handoff payload → POST ${E(p.handoff.endpoint)}</summary><pre class="mono bs-pre">${E(JSON.stringify(p.handoff.body, null, 1))}</pre></details><p class="muted bs-small">${E(p.handoff.note)}</p>` : ''}
        <p class="muted bs-small">${E(p.disclaimer)}</p></div>`;
    }

    function demoBar() {
      const n = demo.steps?.length || 0, s = demo.steps?.[demo.i];
      return `<div class="bs-demo" id="bs-demo" ${demo.i < 0 ? 'hidden' : ''}><div class="bs-prog" aria-hidden="true"><i style="width:${n ? ((demo.i + 1) / n) * 100 : 0}%"></i></div>
        <b>${E(s?.title || '')}</b> <span class="badge bad">FICTIONAL</span> ${SIMB}<p>${E(s?.narration || '')}</p>
        <div class="inc-btns"><button class="ghost" id="bs-prev" ${demo.i <= 0 ? 'disabled' : ''}>◀ Back</button><button class="ghost" id="bs-play">${demo.playing ? 'Pause' : 'Play'}</button><button class="ghost" id="bs-next" ${demo.i >= n - 1 ? 'disabled' : ''}>Next ▶</button><button class="ghost" id="bs-exit">Exit walkthrough</button></div></div>`;
    }

    // ---------- TGLW self-custody with Ledger (Tier 1 / Tier 2) ----------
    const lw = { session: null, account: null, review: null, sig: '', status: hasWebHid() ? 'WebHID available in this browser.' : 'WebHID is not available in this browser (desktop Chrome or Edge needed).', tier: 'T1', amountXrp: 1, cdn: null };
    const lwTiers = () => ['T1', 'T2'].filter((t) => S?.tiers?.[t]?.enabled);
    function ledgerCard() {
      const tiers = lwTiers();
      if (!tiers.length) return `<div class="card bs-lw" id="bs-card-ledger"><h3>Commit from your own wallet with Ledger <span class="bs-lw-st">SANDBOX ONLY</span></h3><p class="muted bs-small">Enable Tier 1 or Tier 2 (TGLW) above to see how a participant commits from their own wallet.</p></div>`;
      if (!tiers.includes(lw.tier)) lw.tier = tiers[0];
      const r = lw.review, ok = isNonExecutable(r);
      return `<div class="card bs-lw" id="bs-card-ledger"><h3>Commit from your own wallet with Ledger <span class="bs-lw-st" title="Untested with physical hardware on this node">SANDBOX ONLY</span></h3>
        <div class="bs-lw-cust" role="note"><b>Your funds stay in your wallet; Titan Ghost never holds your keys.</b></div>
        <p class="muted bs-small" style="margin:4px 0">TGLW is self-custodial: a Tier 1 or Tier 2 participant places their own passive offer from their own account. This shows that offer as an <b>unsigned, already-expired XRPL Testnet OfferCreate</b> and lets the owner review it on a Ledger device. Nothing is submitted. Untested with physical hardware on this node.</p>
        <ol><li>Detect the device and read its address (WebHID, no signing)</li><li>Build the unsigned commitment illustration from that address</li><li>Review it on the device (owner checkbox + device button)</li></ol>
        <div class="bs-lw-row"><span class="bs-small">Tier</span>${tiers.map((t) => `<label class="bs-small"><input type="radio" name="bs-lw-tier" value="${t}" ${lw.tier === t ? 'checked' : ''} style="width:auto"> ${t === 'T1' ? 'Tier 1 (flexible)' : `Tier 2 (term ${E(S.tiers.T2.termDays ?? '—')} days)`}</label>`).join(' ')}
          <label class="bs-small">XRP <input type="number" id="bs-lw-amt" min="0.000001" max="10" step="any" value="${E(lw.amountXrp)}"></label></div>
        <div class="bs-lw-row"><button class="ghost" id="bs-lw-detect">1 · Detect Ledger &amp; read address</button></div>
        <div class="mono bs-small" id="bs-lw-addr">${lw.account ? `Your address ${E(lw.account.address)} (path ${E(LEDGER_PATH)})` : ''}</div>
        <div class="bs-lw-row"><button class="ghost" id="bs-lw-build" ${lw.account ? '' : 'disabled'}>2 · Build unsigned commitment (Testnet)</button></div>
        ${r ? `<p class="bs-small" style="margin:4px 0">${E(r.summary)}</p><details><summary>Unsigned transaction and safety checks</summary><pre class="mono bs-pre">${E(JSON.stringify(r.tx, null, 1))}

${E(r.safety.join('\n'))}</pre></details>` : ''}
        <label class="bs-lw-ck"><input type="checkbox" id="bs-lw-ok" ${ok ? '' : 'disabled'}> <span>I am the owner. Show this <b>Testnet-only, already-expired</b> commitment on my Ledger for review. I understand it is never submitted.</span></label>
        <div class="bs-lw-row"><button id="bs-lw-sign" disabled>3 · Review on device</button></div>
        <div class="mono bs-small" id="bs-lw-sig">${E(lw.sig)}</div>
        <p class="muted bs-small" id="bs-lw-status" aria-live="polite">${E(lw.status)}</p></div>`;
    }
    function rerenderLedger() { const c = el.querySelector('#bs-ledger'); if (c) { c.innerHTML = ledgerCard(); wireLedger(); } }
    function wireLedger() {
      const $ = (q) => el.querySelector(q);
      const status = (m) => { lw.status = m; const n = $('#bs-lw-status'); if (n) n.textContent = m; };
      for (const r of el.querySelectorAll('input[name="bs-lw-tier"]')) r.onchange = () => { lw.tier = r.value; lw.review = null; lw.sig = ''; rerenderLedger(); };
      $('#bs-lw-amt') && ($('#bs-lw-amt').onchange = (e) => { lw.amountXrp = Math.min(10, Math.max(0.000001, Number(e.target.value) || 1)); lw.review = null; lw.sig = ''; rerenderLedger(); });
      $('#bs-lw-detect') && ($('#bs-lw-detect').onclick = async () => {
        lw.session ||= createLedgerSession({ getCdn: async () => (lw.cdn ||= (await api.get('/api/vendors/ledger')).cdn), onStatus: status });
        try { lw.account = await lw.session.connect(); lw.status = 'Device connected. Address read (no signing).'; }
        catch (e) { lw.status = `Not connected: ${e.message}`; }
        rerenderLedger();
      });
      $('#bs-lw-build') && ($('#bs-lw-build').onclick = async () => {
        try {
          lw.review = await api.post('/api/vendors/ledger/commitment', { account: lw.account.address, publicKey: lw.account.publicKey, tier: lw.tier, amountXrp: lw.amountXrp, termDays: S.tiers?.T2?.termDays });
          lw.sig = ''; lw.status = isNonExecutable(lw.review) ? 'Unsigned commitment built. It is already expired and can never execute.' : 'Refused: the transaction did not pass the non-executable check.';
        } catch (e) { lw.status = `Build failed: ${e.message}`; }
        rerenderLedger();
      });
      $('#bs-lw-ok') && ($('#bs-lw-ok').onchange = (e) => { $('#bs-lw-sign').disabled = !(e.target.checked && isNonExecutable(lw.review)); });
      $('#bs-lw-sign') && ($('#bs-lw-sign').onclick = async () => {
        if (!$('#bs-lw-ok').checked || !isNonExecutable(lw.review)) return;
        try { const hex = await lw.session.review(lw.review); lw.sig = `Reviewed and signed on device (kept in this page only, not submitted): ${shortSig(hex)}`; lw.status = 'Done. Nothing was submitted. Your funds never left your wallet.'; }
        catch (e) { lw.status = `Review cancelled or failed: ${e.message}`; }
        rerenderLedger();
      });
    }

    function studioShell() {
      if (!bs || !S) return '<div class="card err">TGLB Bootstrap meta unavailable.</div>';
      return `<div class="card bs-hero"><h2>TGLB Bootstrap ${SIMB}</h2>
        <p class="muted" style="margin-top:0">Titan Ghost Liquidity Bootstrap: name a project, pick its token or XRP/RLUSD incubation, set a target, combine Tier 1 / Tier 2 TGLW liquidity with Tier 3 creditor financing, check legal and economic readiness, and simulate liquidity into an eligible corridor.</p>
        <div class="inc-btns"><button class="primary" id="bs-demo-run">▶ Run demo walkthrough</button><button class="ghost" id="bs-reset">Reset to demo project</button></div>
        <div class="inc-flag" role="note">${E(meta.disclaimer)}</div>${demoBar()}</div>
        <div class="bs-layout"><div><div id="bs-form">${studioForm()}</div><div id="bs-ledger">${ledgerCard()}</div></div><div id="bs-out">${studioResults()}</div></div>`;
    }

    const SECTION = { name: 'bs-card-project', target: 'bs-card-project', tiers: 'bs-card-tiers', commitments: 'bs-capital', underwriting: 'bs-lending', late: 'bs-lending', default: 'bs-lending', readiness: 'bs-ready', deploy: 'bs-corridor', graduate: 'bs-corridor' };
    function showStep(i) {
      if (!demo.steps) return;
      demo.i = Math.max(0, Math.min(demo.steps.length - 1, i));
      const s = demo.steps[demo.i];
      S = clone(s.input); S._tokenMode = S.token ? 'token' : 'incubate';
      plan = s.plan.ok ? s.plan : null; planErr = s.plan.ok ? null : s.plan.errors; handoffMsg = '';
      if (view !== 'studio') view = 'studio';
      render();
      const target = el.querySelector('#' + SECTION[s.id]);
      if (target) { target.classList.add('bs-hl'); if (!el.closest('[hidden]') && !el.hidden) target.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }
    function stopDemo() { clearTimeout(demo.timer); demo.playing = false; }
    function tick() { clearTimeout(demo.timer); if (!demo.playing) return; demo.timer = setTimeout(() => { if (demo.i >= demo.steps.length - 1) { demo.playing = false; render(); return; } showStep(demo.i + 1); tick(); }, demo.ms); }
    async function runDemo({ fast = false } = {}) {
      stopDemo();
      try { demo.steps ||= (await api.get('/api/incubator/bootstrap/demo')).steps; } catch (e) { msg = `<span class="err">Demo unavailable: ${E(e.message)}</span>`; render(); return; }
      api.post('/api/incubator/bootstrap/demo/run', { actor }).catch(() => {}); // records the demo loan + incubator.loan_* events (localhost only)
      demo.ms = fast ? 1400 : 2600; demo.playing = true;
      showStep(0); tick();
    }

    // Re-split the target evenly across the enabled tiers (used when a tier is toggled, so the stack stays balanced).
    function split() { const on = TIERS.filter((t) => S.tiers?.[t]?.enabled); const tgt = Number(S.targetUsd) || 0; const each = Math.floor(tgt / (on.length || 1)); on.forEach((t, i) => setK(S, `tiers.${t}.usd`, i === on.length - 1 ? tgt - each * (on.length - 1) : each)); }
    function wireStudio() {
      const $ = (q) => el.querySelector(q);
      $('#bs-demo-run') && ($('#bs-demo-run').onclick = () => runDemo());
      $('#bs-reset') && ($('#bs-reset').onclick = () => { stopDemo(); demo.i = -1; S = fromDemo(); plan = null; handoffMsg = ''; render(); recompute(); });
      $('#bs-prev') && ($('#bs-prev').onclick = () => { stopDemo(); showStep(demo.i - 1); });
      $('#bs-next') && ($('#bs-next').onclick = () => { stopDemo(); showStep(demo.i + 1); });
      $('#bs-play') && ($('#bs-play').onclick = () => { if (demo.playing) { stopDemo(); render(); } else { demo.playing = true; render(); tick(); } });
      $('#bs-exit') && ($('#bs-exit').onclick = () => { stopDemo(); demo.i = -1; render(); });
      const form = $('#bs-form');
      if (!form) return;
      const touch = () => { if (demo.i >= 0) { stopDemo(); demo.i = -1; const d = $('#bs-demo'); if (d) d.hidden = true; } };
      form.addEventListener('input', (e) => {
        const k = e.target.dataset.k; if (!k) return;
        const ty = e.target.dataset.t; let v = e.target.value;
        if (ty === 'number') v = v === '' ? 0 : Number(v); else if (ty === 'pct') v = Math.max(0, Math.min(100, Number(v) || 0)) / 100;
        setK(S, k, v); touch(); later();
      });
      form.addEventListener('change', (e) => {
        const t = e.target;
        if (t.name === 'bs-tm') { S._tokenMode = t.value; if (t.value === 'token' && !S.token) S.token = { currency: '', issuer: 'NOT_YET_ISSUED' }; touch(); form.innerHTML = studioForm(); later(); return; }
        if (t.dataset.tier) { setK(S, `tiers.${t.dataset.tier}.enabled`, t.checked); split(); touch(); form.innerHTML = studioForm(); rerenderLedger(); later(); return; }
        if (t.dataset.k === 'tiers.T3.scenario') { form.innerHTML = studioForm(); }
      });
      $('#bs-split') && ($('#bs-split').onclick = () => { split(); touch(); form.innerHTML = studioForm(); later(); });
      wireLedger();
      wireResults();
      if (!plan && !planErr) recompute();
    }
    function wireResults() {
      const b = el.querySelector('#bs-xdlc');
      if (!b) return;
      b.onclick = async () => {
        const h = plan?.handoff; if (!h) return;
        const m = el.querySelector('#bs-xdlc-msg');
        b.disabled = true; if (m) m.textContent = 'Sending handoff…';
        try {
          const r = await api.post(h.endpoint, h.body);
          handoffMsg = `<span class="s-PASS">Handed off to XDLC corridor service${r?.id || r?.corridor?.id ? `: ${E(r.id || r.corridor.id)}` : ''} (SIMULATION).</span>`;
        } catch (e) {
          handoffMsg = e.status === 404 || e.status === 405
            ? '<span class="s-OPEN">XDLC corridor service (POST /api/xdlc/corridors) is not available on this server yet. The handoff payload is ready below; nothing was sent anywhere else.</span>'
            : e.status === 403 ? `<span class="s-OPEN">XDLC service refused: ${E(e.message)} (operator console only).</span>` : `<span class="err">XDLC handoff failed: ${E(e.message)}${e.body?.errors ? ': ' + E(e.body.errors.join(' ')) : ''}</span>`;
        }
        if (m) m.innerHTML = handoffMsg; b.disabled = false;
      };
    }

    // Presentation hook: CustomEvent('tf:present', {detail:{scene:'tglb'}}) auto-runs the walkthrough.
    if (window.__tfTglbPresent) window.removeEventListener('tf:present', window.__tfTglbPresent);
    window.__tfTglbPresent = (ev) => { if (ev?.detail?.scene === 'tglb') { view = 'studio'; runDemo({ fast: true }); } };
    window.addEventListener('tf:present', window.__tfTglbPresent);
    // ===================== end studio =====================

    let intakePrefill = {};
    function render() {
      let body = '';
      if (view === 'studio') { el.innerHTML = header() + nav() + studioShell(); wire(); wireStudio(); return; }
      if (view === 'compare') body = compareView();
      else if (view === 'radar') body = radarView();
      else if (view === 'intake') body = intakeView(intakePrefill);
      else if (detail) {
        body = `<div class="card"><h3>${E(detail.name)}: lifecycle</h3>${stepper(detail)}</div>
          <div class="inc-grid">${projectCard(detail)}${gatesCard(detail)}</div>
          <div class="inc-grid">${designer(detail)}${statesCard(detail)}</div>
          ${perfCard(detail)}
          <div class="inc-grid">${recsCard(detail)}${decisionsCard(detail)}</div>`;
      }
      el.innerHTML = header() + nav() + body;
      wire();
    }

    const refreshDetail = async () => { detail = sel ? await api.get(`/api/incubator/projects/${encodeURIComponent(sel)}`) : null; ({ projects: list } = await api.get('/api/incubator/projects')); meta = await api.get('/api/incubator/meta'); };

    function wire() {
      const $ = (q) => el.querySelector(q);
      $('#inc-actor')?.addEventListener('change', (e) => { actor = e.target.value.trim() || 'Commander'; });
      el.querySelector('[data-x402]')?.addEventListener('click', () => api.show('x402'));
      for (const b of el.querySelectorAll('[data-proj]')) b.onclick = async () => { sel = b.dataset.proj; view = 'project'; msg = ''; draft = null; await refreshDetail(); render(); };
      for (const b of el.querySelectorAll('[data-view]')) b.onclick = async () => {
        view = b.dataset.view; msg = '';
        if (view === 'compare') { cmp = null; render(); const ids = list.map((p) => p.id); cmp = await api.get(`/api/incubator/compare?a=${encodeURIComponent(ids.includes('demo-aurora') ? 'demo-aurora' : ids[0])}&b=${encodeURIComponent(ids.includes('demo-beacon') ? 'demo-beacon' : ids[1] || ids[0])}`).catch(() => null); }
        if (view === 'radar') { radar = null; render(); radar = await api.get('/api/incubator/radar').catch(() => ({ items: [], note: 'Radar unavailable.' })); }
        if (view === 'intake') intakePrefill = {};
        render();
      };
      // Stack designer
      const upd = () => { render(); };
      $('#inc-target')?.addEventListener('change', (e) => { draft.targetUsd = Math.max(0, Number(e.target.value) || 0); upd(); });
      for (const r of el.querySelectorAll('[data-src]')) {
        r.addEventListener('input', (e) => { draft.sources[r.dataset.src] = Number(e.target.value); const n = el.querySelector(`[data-srcn="${r.dataset.src}"]`); if (n) n.value = e.target.value; });
        r.addEventListener('change', upd);
      }
      for (const n of el.querySelectorAll('[data-srcn]')) n.addEventListener('change', (e) => { draft.sources[n.dataset.srcn] = Math.max(0, Number(e.target.value) || 0); upd(); });
      $('#inc-t3uw')?.addEventListener('change', (e) => { draft.t3uw = e.target.value; });
      $('#inc-fit') && ($('#inc-fit').onclick = () => { draft.targetUsd = draft.sources.T1 + draft.sources.T2 + draft.sources.T3; upd(); });
      $('#inc-revert') && ($('#inc-revert').onclick = () => { draft = null; render(); });
      $('#inc-save-stack') && ($('#inc-save-stack').onclick = async () => {
        const terms = { ...(detail.terms || {}) };
        if (draft.sources.T3 > 0) terms.T3 = { ...(terms.T3 || {}), underwriting: draft.t3uw, ...(draft.t3uw !== 'APPROVED' ? { disbursed: false } : {}) };
        const r = await post(`/api/incubator/projects/${encodeURIComponent(sel)}/stack`, { targetUsd: draft.targetUsd, sources: draft.sources, terms }, (x) => `Stack saved: ${x.capitalStack.combination}.`);
        if (r) { detail = r; draft = null; ({ projects: list } = await api.get('/api/incubator/projects')); }
        render();
      });
      // Decisions
      for (const b of el.querySelectorAll('[data-dec]')) b.onclick = async () => {
        const type = b.dataset.dec; const body = { type };
        if (type === 'RECORD_OUTCOME') body.outcome = $('#inc-outcome').value;
        if (type === 'REDEPLOY') { const t = $('#inc-redeploy').value; if (t) body.toProjectId = t; }
        const r = await post(`/api/incubator/projects/${encodeURIComponent(sel)}/decision`, body, (x) => `${type}: ${x.decision.result.ok ? 'recorded (SIMULATION)' : 'refused: ' + (x.decision.result.reasons || x.decision.result.violations || []).join(' ')}`);
        if (r) detail = r.project;
        await refreshDetail(); render();
      };
      for (const b of el.querySelectorAll('[data-ack]')) b.onclick = async () => {
        const r = await post(`/api/incubator/projects/${encodeURIComponent(sel)}/decision`, { type: 'APPLY_RECOMMENDATION', recommendationId: b.dataset.ack }, (x) => `Acknowledged ${x.decision.result.acknowledged || ''} (record only; nothing executes).`);
        if (r) detail = r.project; render();
      };
      el.querySelector('[data-custody]') && (el.querySelector('[data-custody]').onclick = async () => {
        await post(`/api/incubator/projects/${encodeURIComponent(sel)}/decision`, { type: 'TRANSFER_REQUEST', source: 'T1', to: 'PROJECT_TREASURY', amountUsd: 1000 }, (x) => `Custody check: ${x.decision.result.allowed ? 'allowed' : 'REFUSED: ' + x.decision.result.violations.join(' ')}`);
        await refreshDetail(); render();
      });
      for (const b of el.querySelectorAll('[data-select]')) b.onclick = async () => {
        const id = b.dataset.select;
        await post(`/api/incubator/projects/${encodeURIComponent(id)}/decision`, { type: 'SELECT_SUPPORT' }, (x) => `${x.project.name}: ${x.decision.result.ok ? `support recorded, ${usd(x.decision.result.addedUsd)} allocated${x.decision.result.shortfallUsd ? `, shortfall ${usd(x.decision.result.shortfallUsd)}` : ''}` : 'refused: ' + (x.decision.result.reasons || []).join(' ')}`);
        cmp = await api.get(`/api/incubator/compare?a=${encodeURIComponent(cmp.a.id)}&b=${encodeURIComponent(cmp.b.id)}`).catch(() => cmp); meta = await api.get('/api/incubator/meta'); render();
      };
      for (const b of el.querySelectorAll('[data-radar]')) b.onclick = () => {
        const x = radar.items.find((r) => r.id === b.dataset.radar);
        intakePrefill = { radarId: x.id, name: x.name, currency: x.currency, issuer: x.issuer, network: x.network, id: `radar-${String(x.currency).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`, description: `Radar-discovered thin-liquidity spoke ${x.name}. Business description to be completed by the operator after contacting the project.` };
        view = 'intake'; render();
      };
      $('#inc-submit') && ($('#inc-submit').onclick = async () => {
        const v = (id) => el.querySelector(`#inc-f-${id}`)?.value ?? '';
        const body = { id: v('id'), name: v('name'), description: v('description'), token: { network: v('network'), currency: v('currency'), issuer: v('issuer') },
          regulatoryReview: { status: v('rstatus'), reviewer: v('reviewer'), date: v('rdate') }, requestedUsd: Number(v('requested')), targetOperatingPeriod: { months: Number(v('months')) },
          runwayMonths: Number(v('runway')), mmEconomics: { targetSpreadBps: Number(v('spread')), minDepthUsd: Number(v('depth')) }, desiredMarkets: v('markets'), sustainabilityMeasures: v('sustain'),
          ...(intakePrefill.radarId ? { radarId: intakePrefill.radarId } : {}) };
        const r = await post('/api/incubator/projects', body, (x) => `Intake recorded: ${x.name}.`);
        if (r) { sel = r.id; view = 'project'; detail = r; ({ projects: list } = await api.get('/api/incubator/projects')); }
        render();
      });
    }

    render();
    let t = null;
    api.on((ev) => {
      if (!String(ev.type || '').startsWith('incubator.')) return;
      clearTimeout(t);
      t = setTimeout(async () => { if (view !== 'project' || draft?.dirty) return; try { await refreshDetail(); const active = document.activeElement; if (!el.contains(active) || active.tagName === 'BUTTON') render(); } catch {} }, 400);
    });
  },
};
