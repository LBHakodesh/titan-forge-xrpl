// TG Merchant — Agentic Finance: one agentic-commerce flow tying TG Merchant x402, a Mastercard-style payment intent,
// the owner mandate + Titan Guardian spending policy, and the AgentCore tool manifest. Every step carries a mode label.
// No payment executes from this tab.
const STYLE = `
.tm { overflow-wrap:anywhere; }
.tm .tm-banner { border-left:3px solid var(--bad); padding:8px 12px; background:var(--bad-bg); border-radius:0 6px 6px 0; font-size:14px; margin:8px 0 0; }
.tm ol.tm-steps { list-style:none; padding:0; margin:12px 0 0; display:grid; gap:10px; counter-reset:tm; }
.tm .tm-step { border:1px solid var(--line); border-radius:10px; padding:10px 12px; background:var(--panel); position:relative; min-width:0; }
.tm .tm-step h3 { margin:0; font-size:15px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.tm .tm-n { display:inline-grid; place-items:center; width:24px; height:24px; border-radius:50%; background:var(--accent); color:#fff; font:700 12px system-ui, sans-serif; flex:none; }
.tm .tm-step.ok { border-color:var(--live); } .tm .tm-step.no { border-color:var(--bad); }
.tm .tm-m { display:inline-block; font:600 11px var(--mono); padding:2px 6px; border-radius:4px; border:1px solid var(--line); color:var(--muted); background:var(--bg); }
.tm .tm-m.SANDBOX_ONLY { color:var(--replay); background:var(--replay-bg); border-color:transparent; }
.tm .tm-m.DOCUMENTATION_ONLY { border-style:dashed; }
.tm .tm-kv { display:grid; grid-template-columns:minmax(90px,max-content) 1fr; gap:3px 10px; font-size:13px; margin:8px 0 0; }
.tm .tm-kv dt { color:var(--muted); } .tm .tm-kv dd { margin:0; min-width:0; }
.tm .tm-pre { font:12px var(--mono); white-space:pre-wrap; overflow-wrap:anywhere; max-height:220px; overflow:auto; background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:8px; margin:6px 0 0; }
.tm details summary { cursor:pointer; font-size:13px; color:var(--accent); margin-top:6px; }
.tm .tm-yes { color:var(--live); font-weight:600; } .tm .tm-no { color:var(--bad); font-weight:600; }
.tm .tm-fac { display:grid; gap:10px; grid-template-columns:repeat(auto-fit, minmax(min(100%, 300px), 1fr)); margin-top:8px; }
.tm .tm-fac > div { border:1px solid var(--line); border-radius:8px; padding:8px 10px; background:var(--bg); min-width:0; }
.tm .tm-fac h4 { margin:0 0 4px; font-size:14px; display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
.tm .tm-kinds { display:flex; flex-wrap:wrap; gap:4px; margin:4px 0; }
.tm .tm-kinds span { font:11px var(--mono); border:1px solid var(--line); border-radius:4px; padding:1px 5px; }
`;
const BUS = new Set(['LIVE_TESTNET', 'SIMULATION', 'REPLAY', 'MAINNET_OBSERVED']);

export default {
  id: 'merchant', title: 'TG Merchant', order: 93,
  async mount(el, api) {
    const { esc } = api;
    if (!document.getElementById('tm-style')) { const s = document.createElement('style'); s.id = 'tm-style'; s.textContent = STYLE; document.head.append(s); }
    el.classList.add('tm');
    el.innerHTML = `<div class="card"><h2 style="margin:0">TG Merchant — Agentic Finance</h2>
      <p class="muted" style="margin:6px 0 0">How an AI agent buys Titan Forge data: tool discovery (AgentCore manifest) → real HTTP 402 challenge (TG Merchant x402) → payment intent (Mastercard Agent Pay concept) → owner mandate + Titan Guardian → owner approval on a device → settlement → audit. Capability is not authority: the agent can propose, only the owner can approve.</p>
      <div class="tm-banner" id="tm-banner">No payment executes in this flow.</div>
      <div style="margin-top:8px"><button class="ghost" id="tm-refresh">Refresh flow</button> <span class="muted" id="tm-at" style="font-size:13px"></span></div></div>
      <div class="card" id="tm-fac-card"><h3 style="margin:0">x402 facilitator options</h3>
        <p class="muted" style="margin:4px 0 0;font-size:13px">TG Merchant's own facilitator settles today (only with per-payment owner approval). t54 is the drop-in hosted option on the same x402 v2 wire format. Discovery only: <span class="mono">GET /supported</span>; no <span class="mono">/verify</span> or <span class="mono">/settle</span> call is ever made.</p>
        <div class="tm-fac" id="tm-fac"><div class="muted">Loading…</div></div>
        <div style="margin-top:6px"><button class="ghost" id="tm-t54-probe">Re-read t54 /supported (read-only)</button> <span class="muted" id="tm-t54-out" style="font-size:13px"></span></div></div>
      <ol class="tm-steps" id="tm-steps"><li class="card muted">Loading…</li></ol>`;
    const $ = (s) => el.querySelector(s);
    const mode = (m) => (BUS.has(m) ? api.badge(m) : `<span class="tm-m ${esc(m)}">${esc(String(m || '?').replace(/_/g, ' '))}</span>`);
    const kv = (rows) => `<dl class="tm-kv">${rows.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;

    const body = (s) => {
      const d = s.detail || {};
      switch (s.id) {
        case 'discover': return kv([['Tools', `<span class="mono" style="font-size:12px">${(d.tools || []).map(esc).join(', ')}</span>`], ['Note', esc(d.note)]]);
        case 'challenge': {
          const a = d.paymentRequiredHeader?.accepts?.[0] || d.body?.accepts?.[0];
          return kv([['Request', `<span class="mono">${esc(d.request || '—')}</span>`], ['HTTP', `<b>${esc(d.httpStatus ?? '—')}</b>${d.httpStatus === 402 ? ' Payment Required (PAYMENT-REQUIRED header decoded below)' : ''}`],
            a && ['Requirements', `<span class="mono">${esc(a.scheme)} · ${esc(a.network)} · ${esc(a.amount)} drops ${esc(a.asset)} · payTo ${esc(a.payTo)} · ${esc(a.maxTimeoutSeconds)} s</span>`],
            a?.extra?.invoiceId && ['Invoice', `<span class="mono">${esc(a.extra.invoiceId)}</span>`], ['Paid', '<span class="tm-no">no</span>'], ['Note', esc(d.note || d.error || '')]])
            + (d.paymentRequiredHeader ? `<details><summary>PAYMENT-REQUIRED (decoded)</summary><pre class="tm-pre">${esc(JSON.stringify(d.paymentRequiredHeader, null, 2))}</pre></details>` : '');
        }
        case 'intent': return kv([['Agent', esc(d.intent?.agent)], ['Merchant', esc(d.intent?.merchant)], ['Amount', `≈ $${esc(d.intent?.amountUsd)} (${esc(d.intent?.category)})`], ['Rail', esc(d.intent?.rail)], ['Concept', esc(d.conceptNote)]]);
        case 'policy': {
          const v = d.verdict || {};
          return kv([['Mandate', `${esc(d.mandate?.owner)} → ${esc(d.mandate?.agent)} · ≤ $${esc(d.mandate?.perTxMaxUsd)}/tx · ≤ $${esc(d.mandate?.dailyMaxUsd)}/day · ${esc((d.mandate?.allowedCategories || []).join(', '))} · revocable`],
            ['Mandate check', v.mandateReasons?.length ? `<span class="tm-no">declined</span> ${v.mandateReasons.map(esc).join(' ')}` : '<span class="tm-yes">within mandate</span>'],
            ['Guardian', v.guardian?.allowed ? '<span class="tm-yes">allowed</span> (SIMULATION check)' : `<span class="tm-no">refused</span> ${(v.guardian?.reasons || []).map(esc).join(' ')}`],
            ['Authorization', `${esc(v.authorization?.status)} · owner approved: <span class="tm-no">no</span> · executed: <span class="tm-no">no</span>`]]);
        }
        case 'approval': return kv([['Required', '<span class="tm-yes">yes</span>'], ['Given', '<span class="tm-no">no</span>'], ['How', esc(d.how)]]);
        case 'settlement': return d.runId ? kv([['Recorded run', `<span class="mono">${esc(d.runId)}</span> · ${esc(d.at)}`],
            ['Settlement', d.settlement ? `<a class="mono" href="${esc(d.settlement.explorer)}" target="_blank" rel="noopener">${esc(String(d.settlement.transaction).slice(0, 12))}…</a> ${esc(d.settlement.kind)}` : '—'],
            ['Authorization', `<span class="tm-no">${esc(d.authorization)}</span>`], ['This flow', 'Nothing is settled now. This is the previously recorded receipt, shown as REPLAY.']]) : '<p class="muted">No recorded receipt.</p>';
        case 'audit': return kv([['Audit', `${esc(d.audit?.intentId)} · allowed by policy: ${d.audit?.policyAllowed ? 'yes' : 'no'} · executed: no · charged: no`], ['Label', esc(d.audit?.label)], ['Sentinel rule', esc(d.sentinelRule)]])
            + `<details><summary>OpenTelemetry span (AgentCore Observability shape)</summary><pre class="tm-pre">${esc(JSON.stringify(d.otelSpan, null, 2))}</pre></details>`;
        default: return `<pre class="tm-pre">${esc(JSON.stringify(d, null, 2))}</pre>`;
      }
    };

    const kinds = (k) => (k?.length ? `<div class="tm-kinds">${k.map((x) => `<span>v${esc(x.x402Version)} ${esc(x.scheme)} ${esc(x.network)}</span>`).join('')}</div>` : '<p class="muted" style="font-size:12px;margin:4px 0">No kinds read.</p>');
    const renderFac = (fa) => {
      if (!fa) { $('#tm-fac').innerHTML = '<div class="muted">Facilitator data unavailable.</div>'; return; }
      const o = fa.tgMerchant || {}, t = fa.t54 || {};
      $('#tm-fac').innerHTML = `<div data-fac="tg-merchant"><h4>${esc(o.name)} ${mode(o.mode)}</h4><span class="muted" style="font-size:12px">${esc(o.role)}</span>${kinds(o.kinds)}
          <dl class="tm-kv"><dt>Endpoint</dt><dd class="mono">${esc(o.endpoint)}</dd>${o.extensions?.length ? `<dt>Extensions</dt><dd class="mono">${o.extensions.map((x) => esc(typeof x === 'string' ? x : JSON.stringify(x))).join(', ')}</dd>` : ''}<dt>Note</dt><dd>${esc(o.note || '—')}</dd></dl></div>
        <div data-fac="t54"><h4>${esc(t.name)} ${mode(t.mode)}${t.vendorStatus ? ` <span class="tm-m">${esc(String(t.vendorStatus).replace(/_/g, ' '))}</span>` : ''}</h4><span class="muted" style="font-size:12px">${esc(t.role)}</span>${kinds(t.kinds)}
          <dl class="tm-kv"><dt>Endpoint</dt><dd class="mono">${esc(t.endpoint)}</dd>${t.extensions?.length ? `<dt>Extensions</dt><dd class="mono">${t.extensions.map((x) => esc(typeof x === 'string' ? x : JSON.stringify(x))).join(', ')}</dd>` : ''}<dt>Compatible</dt><dd>${esc(t.compatible || '—')}</dd><dt>Read</dt><dd>${esc(t.at || '—')} <span class="muted">(${esc(t.from)})</span></dd></dl></div>`;
    };
    $('#tm-t54-probe').onclick = async (e) => {
      const out = $('#tm-t54-out'); e.target.disabled = true; out.textContent = 'Reading t54 /supported…';
      try { const r = await api.post('/api/vendors/t54/probe', {}); out.textContent = `${r.ok ? 'ok' : 'failed'} · ${r.latencyMs} ms${r.sampleStored ? ' · stored' : ''}. Refresh the flow in ~20 s to see it (cache).`; }
      catch (err) { out.textContent = err.message; } finally { e.target.disabled = false; }
    };

    const load = async () => {
      let f;
      try { f = await api.get('/api/merchant/flow'); }
      catch (e) { $('#tm-steps').innerHTML = `<li class="card err">Flow unavailable: ${esc(e.message)}</li>`; return; }
      $('#tm-banner').textContent = f.banner;
      renderFac(f.facilitators);
      $('#tm-at').textContent = `built ${f.at}${f.cached ? ' (cached ≤ 20 s)' : ''} · paymentExecuted: ${f.paymentExecuted}`;
      $('#tm-steps').innerHTML = f.steps.map((s) => `<li class="tm-step">
        <h3><span class="tm-n">${esc(s.n)}</span>${esc(s.title)} ${mode(s.mode)}${s.vendorStatus ? ` <span class="muted" style="font-size:12px;font-weight:400">${esc(s.vendor)}: ${esc(String(s.vendorStatus).replace(/_/g, ' ').toLowerCase())}</span>` : ''}</h3>
        ${body(s)}</li>`).join('');
    };
    $('#tm-refresh').onclick = load;
    window.addEventListener('tf:present', (ev) => { if (ev.detail?.scene === 'merchant') { api.show?.('merchant'); el.scrollIntoView({ block: 'start' }); } });
    await load();
  },
};
