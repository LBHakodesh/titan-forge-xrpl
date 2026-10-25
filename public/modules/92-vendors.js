// Vendor Integrations: integrations that are part of the product, each with verifiable status and evidence.
// Read-only probes only. The Ledger panel runs in the visitor's browser (WebHID); signing is gated behind an owner
// checkbox AND the device button, and the transaction is unsigned, Testnet-only and non-executable by construction.
// Nothing on this tab can pay, submit, or charge.
import { LEDGER_PATH, hasWebHid, isNonExecutable, createLedgerSession, shortSig } from '/vendors-ledger.js';

const STYLE = `
.vn { overflow-wrap:anywhere; }
.vn .vn-grid { display:grid; gap:12px; grid-template-columns:repeat(auto-fit, minmax(min(100%, 320px), 1fr)); }
.vn .vn-card { border:1px solid var(--line); border-radius:10px; padding:12px; background:var(--panel); min-width:0; display:flex; flex-direction:column; gap:8px; }
.vn .vn-head { display:flex; flex-wrap:wrap; gap:8px; justify-content:space-between; align-items:center; }
.vn .vn-head h3 { margin:0; font-size:16px; }
.vn .vn-st { display:inline-block; font:600 11px var(--mono); padding:3px 7px; border-radius:4px; letter-spacing:.03em; border:1px solid transparent; }
.vn .vn-st.CONNECTED_TESTED { color:var(--live); background:var(--live-bg); border-color:var(--live); }
.vn .vn-st.CONNECTED { color:var(--live); background:var(--live-bg); }
.vn .vn-st.CREDENTIALS_REQUIRED { color:var(--sim); background:var(--sim-bg); border:1px dashed var(--sim); }
.vn .vn-st.SANDBOX_ONLY { color:var(--replay); background:var(--replay-bg); }
.vn .vn-st.DOCUMENTATION_ONLY { color:var(--muted); background:var(--bg); border-color:var(--line); }
.vn .vn-st.ERROR { color:var(--bad); background:var(--bad-bg); border-color:var(--bad); }
.vn .vn-cap { font-size:14px; margin:0; }
.vn .vn-kv { display:grid; grid-template-columns:minmax(80px,max-content) 1fr; gap:3px 10px; font-size:13px; margin:0; }
.vn .vn-kv dt { color:var(--muted); } .vn .vn-kv dd { margin:0; min-width:0; }
.vn .vn-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.vn .vn-pre { font:12px var(--mono); white-space:pre-wrap; overflow-wrap:anywhere; max-height:240px; overflow:auto; background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:8px; margin:0; }
.vn details summary { cursor:pointer; font-size:13px; color:var(--accent); }
.vn .vn-docs { font-size:12px; margin:0; padding-left:18px; }
.vn .vn-cred { font:12px var(--mono); }
.vn .vn-cred .on { color:var(--live); } .vn .vn-cred .off { color:var(--sim); }
.vn .vn-legend { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0 12px; }
.vn .vn-warn { border-left:3px solid var(--bad); padding:6px 10px; background:var(--bad-bg); border-radius:0 6px 6px 0; font-size:14px; }
.vn .vn-note { border-left:3px solid var(--accent); padding:6px 10px; font-size:14px; }
.vn .vn-check { display:flex; gap:8px; align-items:flex-start; font-size:14px; }
.vn .vn-check input { width:auto; margin-top:4px; }
.vn .vn-tiles { display:grid; gap:8px; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); }
.vn .vn-tile { border:1px solid var(--line); border-radius:8px; padding:8px 10px; background:var(--bg); min-width:0; }
.vn .vn-tile b { display:block; font-size:18px; font-variant-numeric:tabular-nums; }
.vn .vn-tile span { font-size:12px; color:var(--muted); }
.vn .vn-loop { list-style:none; margin:10px 0 0; padding:0; display:grid; gap:6px; grid-template-columns:repeat(auto-fit, minmax(min(100%, 210px), 1fr)); }
.vn .vn-loop li { border:1px solid var(--line); border-radius:8px; padding:6px 9px; background:var(--bg); min-width:0; display:flex; flex-direction:column; gap:3px; }
.vn .vn-loop li.out { border-style:dashed; opacity:.85; }
.vn .vn-loop .vn-step { font:600 12px var(--mono); color:var(--accent); }
.vn .vn-loop .vn-lw { display:flex; flex-wrap:wrap; gap:6px; align-items:center; justify-content:space-between; }
.vn .vn-loop small { font-size:12px; color:var(--muted); }
`;
const STATUS_ORDER = ['CONNECTED_TESTED', 'CONNECTED', 'CREDENTIALS_REQUIRED', 'SANDBOX_ONLY', 'DOCUMENTATION_ONLY', 'ERROR'];

export default {
  id: 'vendors', title: 'Vendor Integrations', order: 92,
  async mount(el, api) {
    const { esc } = api;
    if (!document.getElementById('vn-style')) { const s = document.createElement('style'); s.id = 'vn-style'; s.textContent = STYLE; document.head.append(s); }
    el.classList.add('vn');
    el.innerHTML = `
      <div class="card">
        <div class="vn-head"><h2 style="margin:0">Vendor Integrations</h2><span class="muted">integrations, not a sponsor list</span></div>
        <p class="muted" style="margin:6px 0 0">Each vendor is an adapter in <span class="mono">lib/vendors/</span> with a computed status, real read-only probes, a sample captured only from a real probe, and call telemetry. No payment, signing or card charge happens on this tab.</p>
        <div class="vn-legend" id="vn-legend"></div>
        <div class="vn-tiles" id="vn-tiles"></div>
      </div>
      <div class="card" id="vn-loop-card">
        <div class="vn-head"><h3 style="margin:0">Vendors in the liquidity loop</h3><span class="muted" style="font-size:13px">make → route → observe → fund → paid data → agents</span></div>
        <ol class="vn-loop" id="vn-loop"><li class="muted">Loading…</li></ol>
      </div>
      <div class="vn-grid" id="vn-grid"><div class="card muted">Loading vendors…</div></div>
      <div class="card" id="vn-xrpl"></div>
      <div class="card" id="vn-ledger"></div>`;
    const $ = (s) => el.querySelector(s);
    const st = (s) => `<span class="vn-st ${esc(s)}" title="${esc(s)}">${esc(String(s).replace(/_/g, ' '))}</span>`;
    let data = null;

    const card = (v) => {
      const lp = v.lastProbe;
      const tel = v.telemetry || {};
      const sample = v.sample;
      return `<article class="vn-card" data-id="${esc(v.id)}">
        <div class="vn-head"><h3>${esc(v.name)}</h3>${st(v.status)}</div>
        <p class="vn-cap">${esc(v.capability)}</p>
        <p class="muted" style="margin:0;font-size:13px">${esc(v.statusText)}</p>
        <dl class="vn-kv">
          <dt>Credentials</dt><dd class="vn-cred">${v.credentials.length ? v.credentials.map((c) => `<span class="${c.set ? 'on' : 'off'}">${esc(c.name)} ${c.set ? 'set' : 'unset'}</span>`).join('<br>') : 'none needed'}</dd>
          <dt>Last probe</dt><dd>${lp ? `${lp.ok ? '<span style="color:var(--live)">ok</span>' : '<span style="color:var(--bad)">failed</span>'} ${esc(lp.at)}${lp.fallback ? ' (public fallback, not a vendor test)' : ''}${lp.error ? `<br><span class="muted">${esc(lp.error)}</span>` : ''}` : '<span class="muted">not probed in this server process</span>'}</dd>
          <dt>Telemetry</dt><dd class="mono" style="font-size:12px">${tel.calls ?? 0} calls · ${tel.errors ?? 0} errors${tel.latencyMs ? ` · last ${tel.latencyMs.last} ms · avg ${tel.latencyMs.avg} ms` : ''}</dd>
          <dt>Sample</dt><dd>${sample ? `verified, captured ${esc(sample.capturedAt)} <span class="muted">(${esc(sample.source)})</span>` : '<span class="muted">none (never fabricated)</span>'}</dd>
        </dl>
        ${sample ? `<details><summary>Verified sample output</summary><pre class="vn-pre">${esc(JSON.stringify(sample.result ?? sample, null, 2))}</pre></details>` : ''}
        ${v.note || v.serverNote || v.settlementPath ? `<p class="muted" style="margin:0;font-size:13px">${esc(v.note || v.serverNote || v.settlementPath)}</p>` : ''}
        <details><summary>Docs checked</summary><ul class="vn-docs">${v.docs.map((d) => `<li><a href="${esc(d)}" target="_blank" rel="noopener">${esc(d)}</a></li>`).join('')}</ul></details>
        <div class="vn-row"><button class="ghost" data-probe="${esc(v.id)}">Run read-only probe</button><span class="muted" data-out="${esc(v.id)}" style="font-size:13px"></span></div>
        <pre class="vn-pre" data-res="${esc(v.id)}" hidden></pre>
      </article>`;
    };

    const renderXrpl = (v) => {
      const s = v?.sample?.result; const tn = v?.testnet;
      if (!s) { $('#vn-xrpl').innerHTML = `<h3 style="margin-top:0">XRPL evidence</h3><p class="muted">No verified Mainnet sample yet. Run the XRPL probe (localhost).</p>`; return; }
      const w = s.amendments?.watched || {};
      $('#vn-xrpl').innerHTML = `<div class="vn-head"><h3 style="margin:0">XRPL evidence</h3><span>${api.badge('MAINNET_OBSERVED')} read-only · captured ${esc(v.sample.capturedAt)}</span></div>
        <div class="vn-tiles" style="margin-top:8px">
          <div class="vn-tile"><b>${esc(s.validatedLedger?.index?.toLocaleString?.('en-US') ?? s.validatedLedger?.index)}</b><span>validated ledger</span></div>
          <div class="vn-tile"><b>${esc(s.bookOffers?.count ?? '—')}</b><span>RLUSD/XRP offers read (all funded: ${esc(String(s.bookOffers?.top?.every((o) => o.fullyFunded) ?? '—'))})</span></div>
          <div class="vn-tile"><b>${s.ammInfo ? esc(Number(s.ammInfo.rlusd).toLocaleString('en-US', { maximumFractionDigits: 0 })) : '—'}</b><span>RLUSD in XRP/RLUSD AMM (fee ${esc(s.ammInfo?.tradingFee ?? '—')})</span></div>
          <div class="vn-tile"><b>${esc(s.amendments?.enabled ?? '—')}/${esc(s.amendments?.total ?? '—')}</b><span>amendments enabled</span></div>
        </div>
        <dl class="vn-kv" style="margin-top:8px">
          <dt>tx metadata</dt><dd>${s.txMetadata ? `<a href="${esc(s.txMetadata.explorer)}" target="_blank" rel="noopener" class="mono">${esc(s.txMetadata.hash.slice(0, 12))}…</a> ${esc(s.txMetadata.type)} ${esc(s.txMetadata.result)} · ${esc(s.txMetadata.affectedNodes)} affected nodes` : '—'}</dd>
          <dt>account_offers</dt><dd>${s.accountOffers ? `${esc(s.accountOffers.count)} open offers for <span class="mono">${esc(s.accountOffers.account)}</span>` : '—'}</dd>
          <dt>Watched</dt><dd style="font-size:13px">${Object.entries(w).map(([k, x]) => `${esc(k)}: <span class="${x === 'enabled' ? '' : 'muted'}">${esc(x)}</span>`).join(' · ')}</dd>
          <dt>Testnet</dt><dd>${api.badge('LIVE_TESTNET')} ${esc(tn?.validatedTxCount ?? 0)} recorded validated tx across ${esc((tn?.tokens || []).join(', ') || '—')}${v.sample.testnetCheck?.validated ? ` · re-read x402 settlement <a class="mono" href="${esc(v.sample.testnetCheck.explorer)}" target="_blank" rel="noopener">${esc(v.sample.testnetCheck.hash.slice(0, 10))}…</a> ${esc(v.sample.testnetCheck.result)}` : ''}</dd>
        </dl>
        <p class="muted" style="font-size:13px;margin:4px 0 0">Mainnet figures are observed third-party data and are never mixed with Testnet demo figures.</p>`;
    };

    const renderLedger = () => {
      $('#vn-ledger').innerHTML = `<div class="vn-head"><h3 style="margin:0">Ledger hardware wallet — owner-held signing</h3>${st('SANDBOX_ONLY')}</div>
        <p class="muted" style="margin:6px 0">Runs in this browser over WebHID (Chrome/Edge, desktop). The agent can only <b>propose</b>; signing needs the owner's device. Untested with physical hardware on this node. The same device flow funds TGLW from your own wallet in the TGLB Bootstrap tab.</p>
        <div class="vn-row"><button class="ghost" id="vn-l-detect">1 · Detect device &amp; read address</button><span id="vn-l-status" class="muted" style="font-size:13px">${hasWebHid() ? 'WebHID available in this browser.' : 'WebHID is not available in this browser.'}</span></div>
        <div id="vn-l-addr" class="mono" style="font-size:13px;margin:6px 0"></div>
        <div class="vn-row"><button class="ghost" id="vn-l-review" disabled>2 · Build unsigned Testnet tx for review</button></div>
        <pre class="vn-pre" id="vn-l-tx" hidden></pre>
        <label class="vn-check"><input type="checkbox" id="vn-l-ok" disabled> <span>I am the owner. I want my Ledger to display and sign this <b>Testnet-only, 1-drop, already-expired</b> transaction for review. I understand it is never submitted.</span></label>
        <div class="vn-row" style="margin-top:6px"><button id="vn-l-sign" disabled>3 · Review &amp; sign on device</button></div>
        <div id="vn-l-sig" class="mono" style="font-size:12px;margin-top:6px"></div>`;
      let review = null;
      const status = (m) => { $('#vn-l-status').textContent = m; };
      const session = createLedgerSession({ getCdn: async () => data?.vendors?.find((x) => x.id === 'ledger')?.cdn, onStatus: status });
      $('#vn-l-detect').onclick = async () => {
        try {
          const acct = await session.connect();
          $('#vn-l-addr').textContent = `Address ${acct.address} (path ${LEDGER_PATH})`;
          $('#vn-l-review').disabled = false; status('Device connected. Address read (no signing).');
        } catch (e) { status(`Not connected: ${e.message}`); }
      };
      $('#vn-l-review').onclick = async () => {
        try {
          review = await api.post('/api/vendors/ledger/review', { account: session.account.address, publicKey: session.account.publicKey });
          const pre = $('#vn-l-tx'); pre.hidden = false; pre.textContent = `${JSON.stringify(review.tx, null, 2)}\n\n${review.safety.join('\n')}`;
          $('#vn-l-ok').disabled = !isNonExecutable(review);
        } catch (e) { status(`Review build failed: ${e.message}`); }
      };
      $('#vn-l-ok').onchange = (e) => { $('#vn-l-sign').disabled = !(e.target.checked && isNonExecutable(review)); };
      $('#vn-l-sign').onclick = async () => {
        if (!$('#vn-l-ok').checked || !isNonExecutable(review)) return;
        try {
          const hex = await session.review(review);
          // The signature stays in this page. It is never sent to the server, and the tx is already expired.
          $('#vn-l-sig').textContent = `Signed on device (kept in this page only, not submitted): ${shortSig(hex)}`;
          $('#vn-l-ok').checked = false; $('#vn-l-sign').disabled = true; status('Done. Nothing was submitted.');
        } catch (e) { status(`Signing cancelled or failed: ${e.message}`); }
      };
    };

    const TAB_TITLE = { theater: 'Watch Titan Ghost', pathfinder: 'Pathfinder', sentinel: 'Sentinel', incubator: 'TGLB Bootstrap', merchant: 'TG Merchant', 'xdlc-app': 'XDLC' };
    const renderLoop = (loop = []) => {
      $('#vn-loop').innerHTML = loop.map((x) => `<li class="${x.inLoop ? '' : 'out'}" data-loop="${esc(x.vendor)}">
        <div class="vn-lw"><span class="vn-step">${esc(x.step)}</span>${st(x.status || 'ERROR')}</div>
        <b style="font-size:14px">${esc(x.name || x.vendor)}</b>
        <small>${esc(x.where)}</small>
        <small>${x.inLoop ? 'Acts in: ' : 'Shown in: '}${x.tabs.map((t) => `<a href="#${esc(t)}" data-goto="${esc(t)}">${esc(TAB_TITLE[t] || t)}</a>`).join(' · ')}</small></li>`).join('') || '<li class="muted">No loop map.</li>';
    };

    const load = async () => {
      try { data = await api.get('/api/vendors'); }
      catch (e) { $('#vn-grid').innerHTML = `<div class="card err">Vendors unavailable: ${esc(e.message)}</div>`; return; }
      const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, data.vendors.filter((v) => v.status === s).length]));
      $('#vn-legend').innerHTML = STATUS_ORDER.map((s) => st(s)).join('');
      $('#vn-tiles').innerHTML = STATUS_ORDER.filter((s) => counts[s]).map((s) => `<div class="vn-tile"><b>${counts[s]}</b><span>${esc(s.replace(/_/g, ' ').toLowerCase())}</span></div>`).join('');
      $('#vn-grid').innerHTML = data.vendors.map(card).join('');
      renderLoop(data.loop);
      renderXrpl(data.vendors.find((v) => v.id === 'xrpl'));
    };

    el.addEventListener('click', async (e) => {
      const go = e.target?.closest?.('[data-goto]');
      if (go && api.show) { e.preventDefault(); api.show(go.dataset.goto); return; }
      const id = e.target?.dataset?.probe; if (!id) return;
      const out = el.querySelector(`[data-out="${CSS.escape(id)}"]`); const res = el.querySelector(`[data-res="${CSS.escape(id)}"]`);
      e.target.disabled = true; out.textContent = 'Probing (read-only)…';
      try {
        const r = await api.post(`/api/vendors/${encodeURIComponent(id)}/probe`, {});
        out.textContent = `${r.ok ? 'ok' : 'failed'} · ${r.latencyMs} ms · status ${r.status}${r.sampleStored ? ' · sample stored' : ''}`;
        res.hidden = false; res.textContent = JSON.stringify(r.result ?? r.error ?? r, null, 2);
        setTimeout(load, 300);
      } catch (err) { out.textContent = err.message; }
      finally { e.target.disabled = false; }
    });
    api.on((ev) => { if (ev.type === 'vendors.probe') load(); });
    window.addEventListener('tf:present', (ev) => { if (ev.detail?.scene === 'vendors') { api.show?.('vendors'); el.scrollIntoView({ block: 'start' }); } });
    renderLedger();
    await load();
  },
};
