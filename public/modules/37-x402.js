// x402 Payments & Data: telemetry, 7-step flow visualizer, data showcase, agent purchase demo, Sentinel attack lab, event log.
// London (TA-LON) shows, visualizes and simulates x402. It is not an entitlement authority (COMMAND/C2 is).
const STEPS = ['REQUEST', '402', 'REQUIREMENTS', 'AUTHORIZATION', 'VERIFICATION', 'SETTLEMENT', 'DELIVERY'];
const STYLE = `
.x4 .x4-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.x4 .x4-tile { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; background: var(--bg); min-width: 0; }
.x4 .x4-tile b { display: block; font-size: 20px; font-variant-numeric: tabular-nums; }
.x4 .x4-tile span { font-size: 12px; color: var(--muted); }
.x4 .x4-seg { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 10px; }
.x4 .x4-seg button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
.x4 .x4-flow { list-style: none; padding: 0; margin: 10px 0; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.x4 .x4-flow li { border: 1px solid var(--line); border-radius: 8px; padding: 6px; font-size: 12px; text-align: center; background: var(--bg); min-width: 0; overflow-wrap: anywhere; }
.x4 .x4-flow li.ok { border-color: var(--live); color: var(--live); background: var(--live-bg); }
.x4 .x4-flow li.fail { border-color: var(--bad); color: var(--bad); background: var(--bad-bg); }
.x4 .x4-flow li.run { border-color: var(--accent); }
.x4 .x4-flow li i { display: block; font-style: normal; font-weight: 700; }
.x4 .x4-detail { font: 12px var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 260px; overflow: auto; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 8px; margin: 0; }
.x4 .x4-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.x4 .x4-row select, .x4 .x4-row input[type=number] { width: auto; min-width: 0; flex: 1 1 140px; }
.x4 .x4-check { display: flex; gap: 8px; align-items: flex-start; color: var(--ink); }
.x4 .x4-check input { width: auto; margin-top: 4px; }
.x4 .x4-cmp { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; }
.x4 .x4-cmp > div { border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
.x4 .x4-chart svg { width: 100%; max-width: 460px; height: auto; display: block; }
.x4 .x4-chart text { fill: var(--muted); font: 11px system-ui, sans-serif; }
.x4 .x4-chart .lbl { fill: var(--ink); }
.x4 .x4-chart rect.bar { fill: var(--accent); }
.x4 .x4-chart rect.bar:hover { opacity: .8; }
.x4 .x4-ok { color: var(--live); } .x4 .x4-no { color: var(--bad); }
.x4 table { table-layout: auto; }
.x4 td, .x4 a, .x4 li { overflow-wrap: anywhere; }
.x4 td .badge, .x4 li .badge { overflow-wrap: normal; white-space: normal; }
.x4 td:first-child, .x4 th:first-child { overflow-wrap: break-word; }
@media (max-width: 600px) { .x4 .x4-flow { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
`;

export default {
  id: 'x402', title: 'x402 Payments & Data', order: 37,
  async mount(el, api) {
    const esc = api.esc;
    if (!document.getElementById('x4-style')) { const s = document.createElement('style'); s.id = 'x4-style'; s.textContent = STYLE; document.head.append(s); }
    el.innerHTML = `<div class="x4">
      <div class="card" id="x4-head"><h2>x402 Payments &amp; Data</h2><p class="muted">Loading…</p></div>
      <div class="card"><h2>Telemetry</h2>
        <div class="x4-seg" role="group" aria-label="Provenance">
          <button class="ghost" data-prov="OBSERVED" aria-pressed="true">OBSERVED</button>
          <button class="ghost" data-prov="SIMULATION" aria-pressed="false">SIMULATION</button>
          <button class="ghost" data-prov="REPLAY" aria-pressed="false">REPLAY</button>
        </div>
        <p class="muted" id="x4-provnote"></p>
        <div class="x4-tiles" id="x4-tiles"></div>
        <div class="grid" style="margin-top:12px">
          <div class="x4-chart"><h3>p95 latency by endpoint (ms)</h3><div id="x4-lat"></div></div>
          <div class="x4-chart"><h3>Rejections by control</h3><div id="x4-inc"></div></div>
        </div>
        <h3 style="margin-top:12px">Revenue (settlement evidence only)</h3><div id="x4-rev"></div>
      </div>
      <div class="card"><h2>Payment flow ${api.badge('SIMULATION')}</h2>
        <p class="muted">REQUEST → 402 → REQUIREMENTS → AUTHORIZATION → VERIFICATION → SETTLEMENT → DELIVERY. In SIMULATION this node is its own local facilitator: the payment is a real XRPL-encoded, signed Payment blob from a throwaway key, verified offline, and "settled" as a labeled fixture. Nothing is broadcast.</p>
        <div class="x4-row"><select id="x4-res" aria-label="Resource"></select><select id="x4-pid" aria-label="Participant"><option value="anonymous">anonymous visitor</option></select><button class="primary" id="x4-run">Run SIMULATION purchase</button></div>
        <ol class="x4-flow" id="x4-flow">${STEPS.map((s) => `<li data-s="${s}"><i>${s}</i><span>·</span></li>`).join('')}</ol>
        <pre class="x4-detail" id="x4-fdetail">Run a purchase to see each step.</pre>
        <details style="margin-top:10px"><summary>LIVE_TESTNET demonstration (operator only)</summary>
          <p class="muted">Payer: demo <b>router</b> role → payTo: demo <b>issuer</b>, on XRPL Testnet (xrpl:1, no monetary value). ≤ 0.1 XRP per request, ≤ 1 XRP per server session, Guardian-checked, explicit approval each run. Spec-form x402 exact payment: the router signs an XRPL Payment (<span class="mono">signedTxBlob</span>, InvoiceID-bound), this node verifies it exactly as in SIMULATION, then submits it. Data is delivered only after validated tesSUCCESS with the full amount delivered.</p>
          <div id="x4-livestate" class="muted"></div>
          <label class="x4-check"><input type="checkbox" id="x4-approve"> I approve one Testnet payment for this run.</label>
          <button class="ghost" id="x4-live">Run LIVE_TESTNET purchase</button>
        </details>
        <h3 style="margin-top:12px">Recorded runs ${api.badge('REPLAY')}</h3><div id="x4-runs" class="muted">No runs yet.</div>
      </div>
      <div class="card"><h2>Data endpoints: free sample vs premium</h2>
        <p class="muted">Free samples are never gated. Premium reports go through the entitlement check; only an <span class="mono">x402</span> decision gets a 402. Basic liquidity participation is never behind x402.</p>
        <div id="x4-cat">Loading…</div><pre class="x4-detail" id="x4-catout" hidden></pre>
      </div>
      <div class="card"><h2>Agentic data purchasing ${api.badge('SIMULATION')}</h2>
        <p class="muted">A scripted, deterministic agent evaluates a thin market (real_estate, $2.0M modeled capital) and may buy Wake and capital analytics under a spend policy. Guardian is consulted on each purchase.</p>
        <div class="grid">
          <div><h3>Spend policy</h3>
            <label for="x4-pmax">Max price per request (XRP)</label><input id="x4-pmax" type="number" min="0" max="0.1" step="0.01" value="0.06">
            <label for="x4-pbud">Session budget (XRP)</label><input id="x4-pbud" type="number" min="0" max="1" step="0.01" value="0.15">
            <label for="x4-prate">Max requests per minute</label><input id="x4-prate" type="number" min="0" max="30" step="1" value="3">
            <p class="muted" id="x4-pfixed"></p>
            <label class="x4-check"><input type="checkbox" id="x4-auth"> I authorize this agent session (no unattended spending).</label>
            <button class="primary" id="x4-agent">Run agent</button>
          </div>
          <div id="x4-agentout" class="muted">Run the agent to see what it buys and how its recommendation changes.</div>
        </div>
      </div>
      <div class="card"><h2>Sentinel attack lab ${api.badge('SIMULATION')}</h2>
        <p class="muted">Local, safe fixtures. Each must be rejected, with the reason and the control that caught it. No data is unlocked by a failed payment.</p>
        <div class="x4-row" id="x4-atk"></div>
        <div id="x4-atkout" style="margin-top:10px"></div>
      </div>
      <div class="card"><h2>Event log</h2>
        <p class="muted">Per event: provenance, payment mode, endpoint, network/asset, status, latency, settlement evidence. Addresses shortened; signed payloads are never shown.</p>
        <div id="x4-log">Loading…</div>
      </div>
    </div>`;
    const $ = (s) => el.querySelector(s);
    let prov = 'OBSERVED';
    const xrp = (d) => `${(Number(d) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 6 })} XRP`;
    const short = (h) => (h && h.length > 16 ? `${h.slice(0, 10)}…` : h || '');
    const provNote = { OBSERVED: "Real requests handled by this server's HTTP endpoints (curl, browsers). Payments on that path use the local SIMULATION facilitator unless the evidence says LIVE_TESTNET_VALIDATED.", SIMULATION: 'In-process demo runs: flow visualizer, agent demo, attack lab.', REPLAY: 'Replays of recorded runs. Never counted as payments or revenue.' };

    // ---- header / discovery
    async function head() {
      const s = await api.get('/api/x402/status');
      const live = s.modes.LIVE_TESTNET;
      $('#x4-head').innerHTML = `<h2>x402 Payments &amp; Data ${api.badge('SIMULATION')} ${live.available ? api.badge('LIVE_TESTNET') : ''}</h2>
        <p>${esc(s.doctrine)} ${esc(s.role)}</p>
        <table><thead><tr><th>Integration</th><th>Status</th><th>Note</th></tr></thead><tbody>${s.discovery.integrations.map((i) => `<tr><td>${esc(i.name)}</td><td><span class="badge bad">${esc(i.status.toUpperCase())}</span></td><td class="muted">${esc(i.note)}</td></tr>`).join('')}</tbody></table>
        <details style="margin-top:8px"><summary>Protocol version and sources (verified ${esc(s.discovery.checkedAt)})</summary>
          <p class="muted">x402 v${s.version}. Headers ${Object.values(s.headers).map((h) => `<span class="mono">${esc(h)}</span>`).join(', ')} (base64 JSON). Networks accepted here: ${s.networks.map((n) => `<span class="mono">${esc(n)}</span>`).join(', ')} only.</p>
          <ul>${s.discovery.spec.map((x) => `<li>${esc(x.what)}: <a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url)}</a></li>`).join('')}</ul></details>`;
      $('#x4-livestate').innerHTML = `${live.available ? 'Live path available.' : 'Live path unavailable here'}${live.readonly ? ' (read-only instance)' : ''}${!live.ledgerReady ? ' (Testnet not ready)' : ''}. Payer ${esc(live.payer || '–')} → ${esc(live.payTo || '–')}. Budget left ${xrp(live.budget.remainingDrops)} of ${xrp(live.budget.sessionBudgetDrops)}.`;
    }

    // ---- telemetry
    function bars(items, unit = '') {
      if (!items.length) return '<p class="muted">No data yet.</p>';
      const max = Math.max(1, ...items.map((i) => i.v));
      const rowH = 24, labelW = 120, w = 360;
      return `<svg viewBox="0 0 ${w} ${items.length * rowH + 4}" role="img" aria-label="bar chart">${items.map((it, k) => {
        const bw = Math.max(2, ((w - labelW - 60) * it.v) / max);
        return `<g transform="translate(0 ${k * rowH + 2})"><text x="0" y="15">${esc(it.k.length > 18 ? it.k.slice(0, 17) + '…' : it.k)}</text>
          <rect class="bar" x="${labelW}" y="5" width="${bw}" height="12" rx="3"><title>${esc(it.k)}: ${it.v}${unit}${it.t ? ' · ' + esc(it.t) : ''}</title></rect>
          <text class="lbl" x="${labelW + bw + 6}" y="15">${it.v}${unit}</text></g>`;
      }).join('')}</svg>`;
    }
    async function telemetry() {
      const t = await api.get('/api/x402/telemetry');
      const b = t.books[prov];
      $('#x4-provnote').textContent = provNote[prov];
      const tiles = [
        ['Total requests', b.requests], ['Requests / min', b.requestsPerMin], ['402 challenges', b.challenges], ['Verified paid', b.verifiedPaid],
        ['Verification failures', b.verificationFailures], ['Settlements confirmed', b.settlementConfirmations], ['Settlement failures', b.settlementFailures],
        ['Served by entitlement', b.freeServed], ['Denied (403)', b.denied], ['Availability', b.availability == null ? '–' : `${(b.availability * 100).toFixed(1)}%`],
        ['Agent runs / buys', `${b.agent.runs} / ${b.agent.purchases}`], ['Agent spend', xrp(b.agent.spentDrops)],
        ['Guardian allow / deny', `${b.guardian.allowed} / ${b.guardian.denied}`], ['Sentinel incidents', Object.values(b.incidents).reduce((x, y) => x + y, 0)],
      ];
      $('#x4-tiles').innerHTML = tiles.map(([k, v]) => `<div class="x4-tile"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
      $('#x4-lat').innerHTML = bars(Object.entries(b.latency).map(([k, v]) => ({ k, v: v.p95 ?? 0, t: `p50 ${v.p50} ms · n=${v.n}` })), ' ms') + (Object.keys(b.latency).length ? `<p class="muted mono">${Object.entries(b.latency).map(([k, v]) => `${esc(k)} p50 ${v.p50} / p95 ${v.p95} ms`).join(' · ')}</p>` : '');
      $('#x4-inc').innerHTML = bars(Object.entries(b.incidents).map(([k, v]) => ({ k, v })));
      $('#x4-rev').innerHTML = b.revenue.length ? `<table><thead><tr><th>Network</th><th>Asset</th><th>Evidence</th><th class="num">Amount</th></tr></thead><tbody>${b.revenue.map((r) => `<tr><td class="mono">${esc(r.network)}</td><td>${esc(r.asset)}</td><td>${r.evidenceKind === 'LIVE_TESTNET_VALIDATED' ? api.badge('LIVE_TESTNET') : api.badge('SIMULATION')} ${esc(r.evidenceKind)}</td><td class="num">${xrp(r.drops)}</td></tr>`).join('')}</tbody></table><p class="muted">${esc(t.note)} No real-value revenue exists.</p>` : `<p class="muted">None. ${esc(t.note)}</p>`;
    }
    el.querySelectorAll('[data-prov]').forEach((btn) => btn.onclick = () => { prov = btn.dataset.prov; el.querySelectorAll('[data-prov]').forEach((x) => x.setAttribute('aria-pressed', x === btn)); telemetry(); log(); });

    // ---- flow visualizer
    function paint(steps, mode) {
      const by = new Map(); for (const s of steps) by.set(s.step, s);
      el.querySelectorAll('#x4-flow li').forEach((li) => {
        const s = by.get(li.dataset.s);
        li.className = s ? (s.ok ? 'ok' : 'fail') : '';
        li.querySelector('span').textContent = s ? (s.ok ? '✓' : '✕') : '·';
      });
      $('#x4-fdetail').textContent = `${mode}\n` + steps.map((s) => `${s.ok ? '✓' : '✕'} ${s.step}  ${JSON.stringify(s.detail)}`).join('\n');
    }
    async function animate(steps, mode, extra = '') {
      for (let i = 1; i <= steps.length; i++) {
        paint(steps.slice(0, i), mode);
        const li = el.querySelector(`#x4-flow li[data-s="${steps[i - 1].step}"]`);
        li?.classList.add('run');
        await new Promise((r) => setTimeout(r, 260));
        li?.classList.remove('run');
      }
      if (extra) $('#x4-fdetail').textContent += `\n\n${extra}`;
    }
    function resultText(r) {
      if (r.refused) return `REFUSED: ${r.reasons.join(' | ')}`;
      if (r.result?.evidence) return `Delivered after settlement. Evidence ${r.result.evidence.kind} ${r.result.evidence.transaction}${r.result.evidence.explorer ? ' ' + r.result.evidence.explorer : ' (fixture, not broadcast)'}`;
      return `Not delivered: ${r.result?.reason || r.status}`;
    }
    $('#x4-run').onclick = async () => {
      $('#x4-run').disabled = true;
      try { const r = await api.post('/api/x402/sim/purchase', { resource: $('#x4-res').value, participantId: $('#x4-pid').value }); await animate(r.steps, 'SIMULATION', resultText(r)); }
      catch (e) { $('#x4-fdetail').textContent = e.message; } finally { $('#x4-run').disabled = false; refresh(); }
    };
    $('#x4-live').onclick = async () => {
      $('#x4-live').disabled = true;
      try {
        const r = await fetch('/api/x402/live/purchase', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: $('#x4-res').value, approval: $('#x4-approve').checked === true }) }).then((x) => x.json());
        $('#x4-approve').checked = false;
        await animate(r.steps || [], 'LIVE_TESTNET', resultText(r));
      } catch (e) { $('#x4-fdetail').textContent = e.message; } finally { $('#x4-live').disabled = false; refresh(); head(); }
    };
    async function runs() {
      const { runs: rs } = await api.get('/api/x402/runs');
      $('#x4-runs').innerHTML = rs.length ? `<table><thead><tr><th>When</th><th>Mode</th><th>Resource</th><th>Result</th><th></th></tr></thead><tbody>${rs.slice(0, 8).map((r) => `<tr><td class="mono">${esc(r.at.slice(11, 19))}</td><td>${api.badge(r.mode)}</td><td>${esc(r.resource)}</td><td>${r.ok ? 'delivered' : 'not delivered'}${r.evidence?.explorer ? ` <a class="mono" href="${esc(r.evidence.explorer)}" target="_blank" rel="noopener">${esc(short(r.evidence.transaction))}</a>` : ''}</td><td>${r.kind === 'agent' ? '' : `<button class="ghost" data-replay="${esc(r.id)}">Replay</button>`}</td></tr>`).join('')}</tbody></table>` : 'No runs yet.';
      $('#x4-runs').querySelectorAll('[data-replay]').forEach((b) => b.onclick = async () => { const r = await api.post(`/api/x402/replay/${b.dataset.replay}`, {}); await animate(r.steps || [], `REPLAY of ${r.originalMode} run ${r.replayOf}`, r.note); refresh(); });
    }

    // ---- catalog
    async function catalog() {
      const { resources } = await api.get('/api/x402/catalog');
      $('#x4-res').innerHTML = resources.filter((r) => !r.restricted).map((r) => `<option value="${esc(r.id)}">${esc(r.title)} · ${r.priceXrp} XRP</option>`).join('');
      $('#x4-cat').innerHTML = `<table><thead><tr><th>Resource</th><th>Free sample</th><th>Premium</th><th class="num">Price</th></tr></thead><tbody>${resources.map((r) => `<tr><td>${esc(r.title)}${r.needsLedger ? ' <span class="muted">(needs Testnet)</span>' : ''}</td>
        <td><button class="ghost" data-sample="${esc(r.id)}">View sample</button></td>
        <td>${r.restricted ? '<span class="badge bad">NEVER SOLD</span>' : `<button class="ghost" data-buy="${esc(r.id)}">Buy (SIMULATION)</button>`}</td>
        <td class="num">${r.restricted ? '–' : `${r.priceXrp} XRP`}</td></tr>`).join('')}</tbody></table>`;
      const out = $('#x4-catout');
      $('#x4-cat').querySelectorAll('[data-sample]').forEach((b) => b.onclick = async () => { out.hidden = false; try { const s = await api.get(`/api/x402/sample/${b.dataset.sample}`); out.textContent = `FREE SAMPLE · ${s.data?.mode || ''}\n` + JSON.stringify(s.data, null, 2); } catch (e) { out.textContent = e.message; } refresh(); });
      $('#x4-cat').querySelectorAll('[data-buy]').forEach((b) => b.onclick = async () => {
        out.hidden = false; out.textContent = 'Running SIMULATION purchase…';
        const r = await api.post('/api/x402/sim/purchase', { resource: b.dataset.buy, participantId: $('#x4-pid').value });
        out.textContent = r.ok ? `PREMIUM · paid via ${r.result.evidence.kind} ${r.result.evidence.transaction}\n` + JSON.stringify(r.result.data, null, 2) : `Not delivered: ${JSON.stringify(r.result)}`;
        paint(r.steps, 'SIMULATION'); refresh();
      });
    }

    // ---- participants (ids from the Access module; entitlement decides free / subscription / optional x402)
    async function participants() {
      let opts = [];
      try {
        const a = await api.get('/api/access/participants');
        opts = [...(a.live?.participants || []).map((p) => [p.id ?? p.participantId, `${p.id ?? p.participantId} (LIVE_TESTNET)`]), ...(a.simulated?.participants || []).map((p) => [p.id ?? p.participantId, `${p.id ?? p.participantId} (SIMULATION)`])];
      } catch {
        const x = await api.get('/api/x402/participants').catch(() => ({ live: [] }));
        opts = x.live.map((p) => [p.id, `${p.id} (LIVE_TESTNET)`]);
      }
      $('#x4-pid').innerHTML = '<option value="anonymous">anonymous visitor</option>' + opts.filter(([id]) => id).map(([id, l]) => `<option value="${esc(id)}">${esc(l)}</option>`).join('');
    }
    participants();

    // ---- agent
    const pol = await api.get('/api/x402/agent/policy').catch(() => null);
    if (pol) $('#x4-pfixed').textContent = `Allowed endpoints: ${pol.policy.allowedEndpoints.join(', ')} · approved networks: ${pol.policy.approvedNetworks.join(', ')} · explicit authorization: always required.`;
    $('#x4-agent').onclick = async () => {
      $('#x4-agent').disabled = true;
      try {
        const r = await api.post('/api/x402/agent/run', { authorized: $('#x4-auth').checked === true, policy: { maxPriceDrops: Math.round(Number($('#x4-pmax').value) * 1e6), sessionBudgetDrops: Math.round(Number($('#x4-pbud').value) * 1e6), maxRequestsPerMin: Number($('#x4-prate').value) } });
        const rec = (x) => x.action === 'hold' ? `Hold $${x.amountUsd.toLocaleString('en-US')} in ${esc(x.marketId)}` : `${esc(x.action)} $${x.amountUsd.toLocaleString('en-US')} ${esc(x.fromMarket)} → ${esc(x.toMarket)}`;
        $('#x4-agentout').innerHTML = `<div class="x4-cmp"><div><h3>Before (free samples)</h3><p>${rec(r.baseline)}</p><p class="muted">${esc(r.baseline.rationale)}</p></div>
          <div><h3>After (purchased data)</h3><p>${rec(r.updated)} ${r.updated.changed ? '' : '<span class="muted">(unchanged)</span>'}</p><p class="muted">${esc(r.updated.rationale)}</p>${r.updated.source ? `<p class="muted">Engine: ${esc(r.updated.source)}</p>` : ''}</div></div>
          <h3 style="margin-top:10px">Bought (${xrp(r.spentXrp * 1e6)} of ${xrp(r.budgetXrp * 1e6)} budget)</h3>
          ${r.bought.length ? `<ul>${r.bought.map((b) => `<li>${esc(b.title)} · ${b.priceXrp} XRP · ${api.badge('SIMULATION')} <span class="mono">${esc(short(b.transaction))}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing bought.</p>'}
          <h3>Policy decisions</h3>
          <table><thead><tr><th>Endpoint</th><th>Rule</th><th>Control</th><th>Result</th></tr></thead><tbody>${r.log.filter((l) => l.step === 'policy').flatMap((l) => l.checks.map((c) => `<tr><td>${esc(l.resource)}</td><td>${esc(c.rule)}</td><td>${esc(c.control)}</td><td class="${c.ok ? 'x4-ok' : 'x4-no'}">${c.ok ? '✓' : '✕'} ${esc(c.detail)}</td></tr>`)).join('')}</tbody></table>
          <p><b>${esc(r.disclaimer)}</b></p>`;
      } catch (e) { $('#x4-agentout').textContent = e.message; } finally { $('#x4-agent').disabled = false; refresh(); }
    };

    // ---- attacks
    const { attacks } = await api.get('/api/x402/attacks');
    $('#x4-atk').innerHTML = attacks.map((a) => `<button class="ghost" data-atk="${esc(a.id)}">${esc(a.title)}</button>`).join('') + '<button class="ghost" data-atk="__all">Run all</button>';
    const results = new Map();
    function renderAttacks() {
      const rows = [...results.values()];
      $('#x4-atkout').innerHTML = rows.length ? `<table><thead><tr><th>Fixture</th><th>Attempt</th><th>Status</th><th>Caught by</th><th>Reason</th></tr></thead><tbody>${rows.flatMap((r) => r.attempts.map((a) => `<tr><td>${esc(attacks.find((x) => x.id === r.id)?.title || r.id)}</td><td>${esc(a.label)}</td><td>${esc(a.status)}</td><td>${esc(a.control || '–')}</td><td>${esc(a.reason || (a.delivered ? 'delivered (legitimate)' : '402 challenge'))}</td></tr>`)).join('')}</tbody></table>
        <p>${rows.map((r) => `${r.rejected && !r.dataUnlocked ? '<span class="x4-ok">✓</span>' : '<span class="x4-no">✕</span>'} ${esc(r.id)}: rejected, data unlocked: ${r.dataUnlocked ? 'YES' : 'no'}`).join('<br>')}</p>` : '';
    }
    $('#x4-atk').querySelectorAll('[data-atk]').forEach((b) => b.onclick = async () => {
      const ids = b.dataset.atk === '__all' ? attacks.map((a) => a.id) : [b.dataset.atk];
      for (const id of ids) results.set(id, await api.post(`/api/x402/attacks/${id}`, {}));
      renderAttacks(); refresh();
    });

    // ---- event log
    async function log() {
      const { events } = await api.get(`/api/x402/events?provenance=${prov}`);
      const ev = events.slice(-40).reverse();
      $('#x4-log').innerHTML = ev.length ? `<table><thead><tr><th>Time</th><th>Provenance</th><th>Mode</th><th>Event</th><th>Endpoint</th><th>Network / asset</th><th>Status</th><th class="num">ms</th><th>Reason / control</th><th>Evidence</th></tr></thead><tbody>${ev.map((e) => `<tr>
        <td class="mono">${esc(e.at.slice(11, 19))}</td><td>${esc(e.provenance)}</td><td>${e.mode ? api.badge(e.mode) : '–'}</td><td>${esc(e.kind)}</td><td class="mono">${esc(e.endpoint || '')}</td>
        <td class="mono">${esc([e.network, e.asset].filter(Boolean).join(' '))}</td><td>${esc(e.status ?? '')}</td><td class="num">${esc(e.latencyMs ?? '')}</td>
        <td>${esc([e.reason, e.control].filter(Boolean).join(' · '))}</td>
        <td class="mono">${e.evidence ? (e.evidence.explorer ? `<a href="${esc(e.evidence.explorer)}" target="_blank" rel="noopener">${esc(short(e.evidence.transaction))}</a>` : `${esc(short(e.evidence.transaction))} (fixture)`) : ''}</td></tr>`).join('')}</tbody></table>` : `<p class="muted">No ${esc(prov)} events yet.</p>`;
    }

    let pending = null;
    function refresh() { clearTimeout(pending); pending = setTimeout(() => { telemetry().catch(() => {}); log().catch(() => {}); runs().catch(() => {}); }, 150); }
    api.on((ev) => { if (ev.type?.startsWith('x402.')) refresh(); });
    await Promise.all([head().catch((e) => { $('#x4-head').innerHTML += `<p class="err">${esc(e.message)}</p>`; }), catalog(), telemetry(), log(), runs()]);
    setInterval(() => { if (!el.hidden) telemetry().catch(() => {}); }, 15000);
  },
};
