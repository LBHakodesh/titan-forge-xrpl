// Pathfinder Flow: observe Mainnet pathfinding (read-only), replay its shape on Testnet as real pathfound
// Payments, and score which maker strategy the XRPL payment engine routes flow to.
const CSS = `
.pf { --pf-ours:#2a78d6; --pf-rival:#eb6834; --pf-other:#8a8f98; --pf-bar:#2a78d6; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .pf { --pf-ours:#3987e5; --pf-rival:#d95926; --pf-other:#6f7681; --pf-bar:#3987e5; } }
:root[data-theme="dark"] .pf { --pf-ours:#3987e5; --pf-rival:#d95926; --pf-other:#6f7681; --pf-bar:#3987e5; }
.pf .pf-sec { border-left:4px solid var(--line); padding-left:12px; margin:8px 0 18px; }
.pf .pf-sec.pf-main { border-color:var(--accent); }
.pf .pf-sec.pf-test { border-color:var(--live); }
.pf .pf-sec > h2 { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.pf .pf-stats { display:grid; gap:8px; grid-template-columns:repeat(auto-fit, minmax(130px,1fr)); margin:10px 0; }
.pf .pf-stat { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:8px 10px; }
.pf .pf-stat b { display:block; font-size:20px; font-variant-numeric:tabular-nums; }
.pf .pf-stat span { font-size:12px; color:var(--muted); }
.pf .pf-chart { width:100%; height:auto; display:block; }
.pf .pf-chart text { fill:var(--ink); font:12px system-ui, sans-serif; }
.pf .pf-chart text.pf-m { fill:var(--muted); }
.pf .pf-chart rect.pf-hit { fill:transparent; }
.pf .pf-chart g:hover rect.pf-v { opacity:.8; }
.pf .pf-row { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; }
.pf .pf-row > div { flex:1 1 160px; }
.pf .pf-learn { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px 12px; font-size:14px; }
.pf .pf-learn summary { cursor:pointer; font-weight:600; color:var(--accent); }
.pf .pf-feed { list-style:none; padding:0; margin:0; max-height:360px; overflow:auto; }
.pf .pf-feed li { padding:6px 0; border-bottom:1px solid var(--line); font-size:13px; }
.pf .pf-legend { display:flex; gap:12px; flex-wrap:wrap; font-size:12px; color:var(--muted); margin:4px 0; }
.pf .pf-legend i { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:4px; vertical-align:-1px; }
.pf .pf-cap { display:flex; height:16px; border-radius:4px; overflow:hidden; gap:2px; background:var(--panel); min-width:120px; }
.pf .pf-cap span { display:block; height:100%; }
.pf .pf-note { font-size:13px; color:var(--muted); }
.pf .pf-warn { background:var(--sim-bg); border-left:4px solid var(--sim); padding:8px 10px; border-radius:6px; font-size:13px; margin:8px 0; }
.pf .pf-tbl { overflow-x:auto; }
.pf label.pf-check { display:flex; gap:8px; align-items:flex-start; color:var(--ink); font-size:14px; }
.pf label.pf-check input { width:auto; margin-top:4px; }
.pf .pf-sec.pf-ev { border-color:var(--replay); }
.pf .pf-chips { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
.pf .pf-chips button { padding:4px 10px; font-size:13px; }
.pf .pf-chips button[aria-pressed="true"] { background:var(--accent); color:#fff; border-color:var(--accent); }
.pf .pf-head { display:grid; gap:10px; grid-template-columns:repeat(auto-fit, minmax(220px,1fr)); margin:10px 0; }
.pf .pf-head > div { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px 12px; min-width:0; }
.pf .pf-head h4 { margin:0 0 4px; font-size:13px; color:var(--muted); font-weight:600; }
.pf .pf-head b.pf-big { display:block; font-size:22px; font-variant-numeric:tabular-nums; }
.pf .pf-head p { margin:4px 0 0; font-size:13px; }
.pf .pf-mini { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
.pf .pf-mini span { font:600 11px var(--mono); padding:2px 5px; border-radius:4px; border:1px solid var(--line); }
.pf .pf-mini span.k-maker { color:var(--pf-ours); border-color:var(--pf-ours); }
.pf .pf-mini span.k-rival { color:var(--pf-rival); border-color:var(--pf-rival); }
.pf .pf-mini span.k-skip { color:var(--bad); border-color:var(--bad); }
.pf .pf-wrap { overflow-wrap:anywhere; word-break:break-word; }
.pf table.pf-ev td, .pf table.pf-ev th { vertical-align:top; }
.pf table.pf-ev button, .pf .pf-nw { white-space:nowrap; }
.pf ul.pf-cats { display:flex; flex-wrap:wrap; gap:6px; list-style:none; padding:0; margin:8px 0; font-size:13px; }
.pf ul.pf-cats li { border:1px solid var(--line); border-radius:6px; padding:3px 8px; }
.pf ul.pf-cats li b { font-variant-numeric:tabular-nums; }
.pf .pf-drill { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px 12px; margin:8px 0; font-size:13px; min-width:0; }
.pf .pf-drill pre { white-space:pre-wrap; overflow-wrap:anywhere; font:12px var(--mono); margin:4px 0; }
.pf .pf-drill h5 { margin:10px 0 4px; font-size:13px; }
.pf .pf-ok { color:var(--live); font-weight:600; } .pf .pf-no { color:var(--bad); font-weight:600; }
.pf .pf-cause { border-left:4px solid var(--bad); background:var(--bad-bg); padding:10px 12px; border-radius:6px; margin:8px 0; }
.pf ul.pf-checks { list-style:none; padding:0; margin:6px 0; font-size:13px; }
.pf ul.pf-checks li { padding:3px 0; border-bottom:1px solid var(--line); overflow-wrap:anywhere; }
.pf ol.pf-time { padding-left:18px; font-size:13px; margin:6px 0; }
.pf ol.pf-time li { overflow-wrap:anywhere; }
`;

const fmt = (x, d = 2) => (x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toLocaleString(undefined, { maximumFractionDigits: d }));
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(x > 0 && x < 0.01 ? 2 : 1)}%`);
const TX = 'https://testnet.xrpl.org/transactions/';
const ROUTE = { xrp_to_token: 'XRP → token', token_to_xrp: 'token → XRP', token_to_token: 'token → token', xrp_to_xrp: 'XRP → XRP' };

// Horizontal bar chart, one series. rows: [{label, value, title}]
function bars(esc, rows, { fmtV = (v) => fmt(v, 0), w = 340 } = {}) {
  if (!rows.length) return '<p class="muted">No data in this sample.</p>';
  const max = Math.max(...rows.map((r) => r.value), 1e-12);
  const lw = 112, rh = 24, vw = 52, bw = w - lw - vw;
  const h = rows.length * rh + 4;
  return `<svg class="pf-chart" viewBox="0 0 ${w} ${h}" role="img">${rows.map((r, i) => {
    const y = i * rh + 2, len = Math.max(r.value > 0 ? 3 : 0, (r.value / max) * bw);
    return `<g><title>${esc(r.title ?? `${r.label}: ${fmtV(r.value)}`)}</title>
      <rect class="pf-hit" x="0" y="${y}" width="${w}" height="${rh}"></rect>
      <text x="${lw - 8}" y="${y + 16}" text-anchor="end">${esc(r.label)}</text>
      <rect class="pf-v" x="${lw}" y="${y + 5}" width="${len}" height="${rh - 10}" rx="3" fill="var(--pf-bar)"></rect>
      <text x="${lw + len + 6}" y="${y + 16}" class="pf-m">${esc(fmtV(r.value))}</text></g>`;
  }).join('')}</svg>`;
}

// Stacked ours / rival / other capture bar (HTML, 2px gaps).
function capBar(c) {
  const seg = (k, v) => (v > 0 ? `<span style="width:${v * 100}%;background:var(--pf-${k})" title="${k} ${pct(v)}"></span>` : '');
  return `<div class="pf-cap" role="img" aria-label="maker ${pct(c.maker)}, rival ${pct(c.rival)}, other ${pct(c.other)}">${seg('ours', c.maker)}${seg('rival', c.rival)}${seg('other', c.other)}</div>`;
}
const legend = '<div class="pf-legend"><span><i style="background:var(--pf-ours)"></i>our maker (strategy quotes)</span><span><i style="background:var(--pf-rival)"></i>rival demo maker</span><span><i style="background:var(--pf-other)"></i>other (pre-existing launch quotes / external)</span></div>';

export default {
  id: 'pathfinder', title: 'Pathfinder Flow', order: 35,
  async mount(el, api) {
    const { esc, badge } = api;
    if (!document.getElementById('pf-style')) { const s = document.createElement('style'); s.id = 'pf-style'; s.textContent = CSS; document.head.append(s); }
    el.classList.add('pf');
    el.innerHTML = `
      <div class="card pf-learn"><details><summary>New to pathfinding? What this tab shows</summary>
        <p><b>Pathfinding</b>: when someone pays in one currency and the receiver gets another, the XRPL payment engine searches the order books (and AMM pools) for the cheapest route and fills it automatically. The sender only says "deliver this, spend at most that".</p>
        <p><b>Why the tightest funded quote wins</b>: the engine always consumes the best-priced offers first, and only offers the owner can actually pay for count. A maker quoting closer to mid, with real balance behind it, gets the flow; wider quotes fill only after the better ones run out.</p>
        <p><b>Auto-bridging</b>: there is rarely a direct TOKEN-A/TOKEN-B book, so the engine routes A → XRP → B. That means anyone quoting the A/XRP or XRP/B books can capture token→token flow, without ever touching the other token.</p>
        <p class="muted">Three separate sections below: Mainnet numbers are <b>observed third-party activity</b>, the Testnet replay is <b>demo-generated by our own accounts</b>, and the scorecard compares our replay runs. They are never mixed.</p>
      </details></div>

      <section class="pf-sec pf-main"><h2>Mainnet pathfinding (observed, read-only) ${badge('MAINNET_OBSERVED')}</h2>
        <p class="pf-note">Read-only sample of recent validated XRPL Mainnet ledgers. This is other people's activity: it is not ours and not demand for any demo token. No Mainnet transaction is ever signed.</p>
        <div class="pf-row"><div><button class="ghost" id="pf-refresh">Sample Mainnet again</button> <button class="ghost" id="pf-cancel" hidden>Cancel</button></div><div id="pf-sampler" class="pf-note"></div></div>
        <div id="pf-profile" class="muted">Loading…</div>
      </section>

      <section class="pf-sec pf-test"><h2>Testnet replay ${badge('LIVE_TESTNET')} <span class="badge bad">DEMO FLOW · organic:false</span></h2>
        <p class="pf-note">Our demo router account sends real pathfound Payments on XRPL Testnet, drawn from the Mainnet flow shape above and scaled down to tiny sizes. Our maker and a rival demo maker quote the books. The payments are demo-generated, not demand; what is real is that the Testnet payment engine decides whose offers fill.</p>
        <div class="card">
          <div class="pf-row">
            <div><label for="pf-strat">Our maker strategy</label><select id="pf-strat"></select></div>
            <div><label for="pf-rival">Rival baseline</label><select id="pf-rival"></select></div>
            <div><label for="pf-k">Payments (1–20)</label><input id="pf-k" type="number" min="1" max="20" value="8"></div>
            <div><label for="pf-tokens">Tokens</label><select id="pf-tokens"></select></div>
            <div><label for="pf-qsize">Quote size, XRP per quote (1–15)</label><input id="pf-qsize" type="number" min="1" max="15" step="0.5" placeholder="strategy default"></div>
          </div>
          <p id="pf-explain" class="pf-note"></p>
          <div class="pf-row"><div><button class="ghost" id="pf-plan">Preview plan (dry run)</button></div></div>
          <p id="pf-err" class="err" role="alert"></p>
        </div>
        <div id="pf-planbox"></div>
        <div class="card"><h3>Live payment feed ${badge('LIVE_TESTNET')}</h3>${legend}<ul class="pf-feed" id="pf-feed"><li class="muted">No replay payments yet.</li></ul></div>
      </section>

      <section class="pf-sec"><h2>Strategy scorecard ${badge('LIVE_TESTNET')}</h2>
        <p class="pf-note">Flow capture share = XRP value of each maker's offers consumed by the replay payments. All runs are demo-generated (organic:false).</p>
        ${legend}<div id="pf-score" class="muted">Loading…</div>
      </section>

      <section class="pf-sec pf-ev"><h2>Replay evidence ${badge('LIVE_TESTNET')} <span class="badge bad">ALL PAYMENTS DEMO-GENERATED · organic:false</span></h2>
        <p class="pf-note">Every number here is read back from validated XRPL Testnet ledgers (transaction metadata, historical order books, historical ripple_path_find). All payments were sent by our own demo router to our own demo taker; none is organic demand. Mainnet observations above are read-only third-party activity and are never mixed into these figures.</p>
        <div id="pf-ev" class="muted">Loading evidence…</div>
      </section>

      <section class="pf-sec"><h2>Corridor-continuity test plan ${badge('LIVE_TESTNET')} <span class="badge sim">DRY RUN · approved:false</span></h2>
        <p class="pf-note">Design only. Computing the plan reads Testnet balances and books; nothing is signed or submitted. Running it needs a separate explicit Commander approval.</p>
        <p><button class="ghost" id="pf-cplan">Compute plan and XRP budget (dry run)</button></p>
        <div id="pf-cplanbox"></div>
      </section>`;

    const $ = (s) => el.querySelector(s);
    let strategies = null, lastPlan = null;

    // ---------- Mainnet ----------
    function renderProfile(d) {
      const p = d.profile;
      const s = d.sampler;
      $('#pf-sampler').textContent = s.status === 'sampling'
        ? `Sampling… ${s.progress?.done ?? 0}/${s.progress?.of ?? '?'} ledgers${s.progress?.waitingMs ? ` (server rate limit, waiting ${Math.round(s.progress.waitingMs / 1000)} s)` : ''}`
        : s.lastError ? `Last sample failed: ${s.lastError}` : d.nextRefreshAt && Date.parse(d.nextRefreshAt) > Date.now() ? `Next sample allowed after ${new Date(d.nextRefreshAt).toLocaleTimeString()}` : '';
      $('#pf-cancel').hidden = s.status !== 'sampling';
      if (!p) { $('#pf-profile').innerHTML = '<p class="muted">No Mainnet sample yet. Press "Sample Mainnet again" (takes a few minutes; public servers rate-limit).</p>'; return; }
      const e = { paths: {}, sizeXrp: {}, topPairs: [], makerCapture: { top: [] }, ...d.display.agg }, w = p.window, t = p.totals;
      const routeRows = Object.entries(e.routeMix).filter(([k]) => k !== 'xrp_to_xrp').map(([k, v]) => ({ label: ROUTE[k], value: v, title: `${ROUTE[k]}: ${v} payments (${pct(v / (e.count || 1))})` }));
      const sizeRows = e.sizeHist.map((b) => ({ label: `${b.bucket} XRP`, value: b.count }));
      const capRows = e.makerCapture.top.slice(0, 8).map((m) => ({ label: `${m.account}${m.amm ? ' (AMM)' : ''}`, value: m.share, title: `${m.account}${m.amm ? ' AMM pool' : ' offers'}: ${fmt(m.xrp, 4)} XRP, ${m.fills} fills, ${pct(m.share)}` }));
      $('#pf-profile').innerHTML = `
        <p class="pf-note">Ledgers <span class="mono">${w.fromLedger}–${w.toLedger}</span> (${w.ledgers} sampled${w.truncated ? ', truncated' : ''}${w.errors ? `, ${w.errors} unavailable` : ''}) · ${esc(w.fromTime || '')} → ${esc(w.toTime || '')} · sampled ${esc(new Date(p.sampledAt).toLocaleString())}</p>
        <div class="pf-stats">
          <div class="pf-stat"><b>${fmt(t.pathfound, 0)}</b><span>pathfound payments (${pct(t.pathfoundShareOfPayments)} of successful payments)</span></div>
          <div class="pf-stat"><b>${fmt(t.endUser, 0)}</b><span>full delivery to a third party</span></div>
          <div class="pf-stat"><b>${pct(e.xrpBridged.shareOfTokenToToken)}</b><span>of token→token routes XRP-bridged</span></div>
          <div class="pf-stat"><b>${pct(e.ammInvolved.share)}</b><span>touched an AMM pool</span></div>
          <div class="pf-stat"><b>${pct(e.makerCapture.top5Share ?? null)}</b><span>of routed XRP went to the top 5 liquidity providers</span></div>
          <div class="pf-stat"><b>${fmt(t.partial, 0)}</b><span>partial payments (reported separately)</span></div>
        </div>
        <p class="pf-note"><b>Charted set:</b> ${esc(d.display.label)} · ${fmt(e.count, 0)} payments. Replay shape: ${esc(d.shape.source)}</p>
        <div class="grid">
          <div><h3>Route mix</h3>${bars(esc, routeRows)}
            <p class="pf-note">Hops: ${fmt(e.hopMix.single_book, 0)} single book/pool · ${fmt(e.hopMix.multi_hop, 0)} multi-hop. Liquidity: ${fmt(e.liquidityMix.book, 0)} order book · ${fmt(e.liquidityMix.amm, 0)} AMM · ${fmt(e.liquidityMix['book+amm'], 0)} both. Explicit Paths on ${fmt(e.paths.withPaths, 0)} (max length ${e.paths.maxPathLen}).</p></div>
          <div><h3>Delivered size (XRP-equivalent)</h3>${bars(esc, sizeRows)}<p class="pf-note">Median ${fmt(e.sizeXrp.median, 4)} XRP · p90 ${fmt(e.sizeXrp.p90, 2)} XRP · ${e.unsized} unsized.</p></div>
          <div><h3>Maker capture concentration</h3>${bars(esc, capRows, { fmtV: pct })}
            <p class="pf-note">${fmt(e.makerCapture.providers, 0)} providers · HHI ${e.makerCapture.hhi} · top-1 ${pct(e.makerCapture.top1Share)} · AMM share ${pct(e.makerCapture.ammShareXrp)}.</p></div>
          <div><h3>Top currency pairs</h3><div class="pf-tbl"><table><thead><tr><th>Pair</th><th class="num">Payments</th></tr></thead><tbody>${e.topPairs.map((x) => `<tr><td class="mono">${esc(x.pair)}</td><td class="num">${x.count}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">none</td></tr>'}</tbody></table></div></div>
        </div>
        <div class="pf-warn"><b>Reported separately, not replayed:</b> ${fmt(t.partial, 0)} partial payments (${esc(p.partial.note)}) · ${fmt(t.circular, 0)} circular sender = receiver payments (${esc(p.circular.note)}) · ${fmt(t.dust ?? 0, 0)} dust payments. Offers the engine deleted as unfunded/expired while routing (never counted as fills): ${fmt(e.removals?.removed_unfunded, 0)} unfunded, ${fmt(e.removals?.expired, 0)} expired. OfferCreate: ${p.offerCreate.crossed}/${p.offerCreate.total} crossed resting liquidity (${p.offerCreate.bridged} auto-bridged).</div>`;
    }
    async function loadProfile() {
      try { const d = await api.get('/api/pathfinder/profile'); renderProfile(d); return d; }
      catch (e) { $('#pf-profile').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    }
    let poll = null;
    const pollSampler = () => { clearInterval(poll); poll = setInterval(async () => { const d = await loadProfile(); if (d?.sampler.status !== 'sampling') clearInterval(poll); }, 3000); };
    $('#pf-refresh').onclick = async () => {
      try { await api.post('/api/pathfinder/profile/refresh', {}); pollSampler(); loadProfile(); }
      catch (e) { $('#pf-sampler').textContent = e.message; }
    };
    $('#pf-cancel').onclick = () => api.post('/api/pathfinder/profile/cancel', {}).catch(() => {});

    // ---------- Testnet ----------
    const opts = () => ({ strategy: $('#pf-strat').value, rivalStrategy: $('#pf-rival').value, k: Number($('#pf-k').value), tokens: $('#pf-tokens').value.split(',').filter(Boolean), ...($('#pf-qsize').value ? { quoteXrp: Number($('#pf-qsize').value) } : {}) });
    const explain = () => {
      const o = strategies.ours.find((s) => s.id === $('#pf-strat').value), r = strategies.rival.find((s) => s.id === $('#pf-rival').value);
      $('#pf-explain').innerHTML = `<b>Ours:</b> ${esc(o.explain)} <span class="muted">(±${o.halfSpreadBps} bps, ${o.sides}, ${$('#pf-qsize').value || o.notionalXrp} XRP per quote${$('#pf-qsize').value ? ', set by you' : ''})</span><br><b>Rival:</b> ${esc(r.explain)} <span class="muted">${esc(strategies.note)}</span>`;
    };
    async function loadStrategies() {
      strategies = await api.get('/api/pathfinder/strategies');
      $('#pf-strat').innerHTML = strategies.ours.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('');
      $('#pf-rival').innerHTML = strategies.rival.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('');
      const t = strategies.liveTokens;
      const choices = [t.slice(0, 2).join(','), ...t.map((x) => x)].filter((v, i, a) => v && a.indexOf(v) === i);
      $('#pf-tokens').innerHTML = choices.map((c) => `<option value="${esc(c)}">${esc(c.replace(',', ' + '))}</option>`).join('') || '<option value="">no live token</option>';
      explain();
    }
    el.addEventListener('change', (e) => { if (e.target.id === 'pf-strat' || e.target.id === 'pf-rival' || e.target.id === 'pf-qsize') explain(); });

    function renderPlan(p) {
      const q = p.quotes.map((x) => `<tr><td>${esc(x.role)}</td><td>${esc(x.code)}</td><td>${esc(x.side)}</td><td class="num">${fmt(x.priceXrp, 7)}</td><td class="num">${fmt(x.tokenQty, 2)}</td><td class="num">${fmt(x.xrp, 2)}</td></tr>`).join('');
      const pays = p.payments.map((x) => `<tr><td>${x.i + 1}</td><td>${esc(ROUTE[x.route])} <span class="muted">${esc(x.from)}→${esc(x.to)}</span></td><td class="num">${fmt(x.sizeXrp, 4)}</td>
        <td>${x.pathfind.ok ? `path found · ${x.pathfind.pathCount} explicit path(s)${x.pathfind.viaXrp ? ' via XRP' : ''} · ${fmt(x.pathfind.vsMidBps, 0)} bps vs mid` : `<span class="muted">${esc(x.pathfind.reason)}</span>`}</td></tr>`).join('');
      const b = p.budget;
      const roles = Object.entries(b.roles).filter(([, r]) => r.txs || r.requiredXrp).map(([k, r]) => `<tr><td>${esc(k)}</td><td class="num">${fmt(r.spendableXrp, 4)}</td><td class="num">${fmt(r.requiredXrp, 4)}</td><td class="num">${r.newObjects}</td><td class="num">${r.txs}</td><td>${r.ok ? '✓ fits' : '✕ short'}</td></tr>`).join('');
      const refused = p.proposals.filter((x) => !x.allowedIfApproved);
      $('#pf-planbox').innerHTML = `<div class="card"><h3>Plan preview (dry run, nothing submitted) ${badge('LIVE_TESTNET')}</h3>
        <p class="pf-note">Flow shape: ${esc(p.shape.source)} · seed ${p.options.seed} · mids ${Object.entries(p.mids).map(([k, v]) => `${esc(k)} ${v} XRP`).join(', ')} · ${esc(p.statement)}</p>
        ${p.notes.map((n) => `<div class="pf-warn">${esc(n)}</div>`).join('')}
        <h3>Quotes to post</h3><div class="pf-tbl"><table><thead><tr><th>Maker</th><th>Token</th><th>Side</th><th class="num">Price XRP</th><th class="num">Qty</th><th class="num">XRP</th></tr></thead><tbody>${q}</tbody></table></div>
        <h3>Sampled payments + Testnet ripple_path_find</h3><p class="pf-note">${esc(p.pathfindNote)}</p>
        <div class="pf-tbl"><table><thead><tr><th>#</th><th>Route</th><th class="num">XRP-eq</th><th>Path (now)</th></tr></thead><tbody>${pays}</tbody></table></div>
        <h3>Setup (idempotent)</h3><p class="pf-note">${p.setup.length ? p.setup.map((s) => esc(s.step === 'trustline' ? `${s.role} trustline ${s.code}` : `issue ${s.code} to ${s.to}`)).join(' · ') : 'Nothing to set up.'}</p>
        <h3>Budget ${b.ok ? '<span class="badge live">OK</span>' : '<span class="badge bad">BLOCKED</span>'}</h3>
        <p class="pf-note">Reserve ${b.reserveBase} XRP + ${b.reserveInc} XRP per object · fee ≈ ${b.feePerTxXrp} XRP/tx (×3 safety). ${b.reasons.map(esc).join(' ')}</p>
        <div class="pf-tbl"><table><thead><tr><th>Account</th><th class="num">Spendable</th><th class="num">Needs</th><th class="num">New objects</th><th class="num">Txs</th><th></th></tr></thead><tbody>${roles}</tbody></table></div>
        <p class="pf-note">Guardian: ${p.proposals.length - refused.length}/${p.proposals.length} proposed transactions allowed once approved.${refused.length ? ' Refused: ' + refused.map((r) => esc(`${r.what} (${r.reasons.join(' ')})`)).join('; ') : ''}</p>
        ${p.readonlyInstance ? '<div class="pf-warn">This is a read-only instance: live runs are disabled here.</div>' : ''}
        <label class="pf-check"><input type="checkbox" id="pf-approve"> I approve submitting these demo transactions on XRPL Testnet (tiny amounts, demo accounts only; the flow is demo-generated, not organic demand).</label>
        <p><button class="primary" id="pf-run" ${!b.ok || p.readonlyInstance ? 'disabled' : ''}>Run on Testnet</button></p></div>`;
      $('#pf-run').onclick = async () => {
        $('#pf-err').textContent = '';
        if (!$('#pf-approve').checked) { $('#pf-err').textContent = 'Tick the approval box first.'; return; }
        $('#pf-run').disabled = true;
        try { const r = await api.post('/api/pathfinder/run', { ...opts(), seed: p.options.seed, approved: true }); $('#pf-feed').innerHTML = `<li>Run ${esc(r.id.slice(0, 8))} ${esc(r.status)}… setup and quotes first, then one payment every ≥4 s.</li>`; }
        catch (e) { $('#pf-err').textContent = e.message; $('#pf-run').disabled = false; }
      };
    }
    $('#pf-plan').onclick = async () => {
      $('#pf-err').textContent = ''; $('#pf-plan').disabled = true;
      $('#pf-planbox').innerHTML = '<div class="card muted">Reading Testnet balances and books, sampling flow, running ripple_path_find…</div>';
      try { lastPlan = await api.post('/api/pathfinder/plan', opts()); renderPlan(lastPlan); }
      catch (e) { $('#pf-planbox').innerHTML = ''; $('#pf-err').textContent = e.message; }
      finally { $('#pf-plan').disabled = false; }
    };

    // ---------- feed + scorecard ----------
    const feedItem = (ev) => {
      const c = ev.capturedBy || { maker: 0, rival: 0, other: 0 };
      const tot = c.maker + c.rival + c.other;
      const sh = tot ? { maker: c.maker / tot, rival: c.rival / tot, other: c.other / tot } : { maker: 0, rival: 0, other: 0 };
      return `<li>${badge(ev.mode)} ${esc(ROUTE[ev.route] || ev.route)} <span class="muted">${esc(ev.from || '')}→${esc(ev.to || '')} ${fmt(ev.sizeXrp, 4)} XRP-eq${ev.bridged ? ' · bridged via XRP' : ''}</span>
        <a class="mono" href="${TX}${esc(ev.hash)}" target="_blank" rel="noopener">${esc(String(ev.hash).slice(0, 14))}…</a>${capBar(sh)}</li>`;
    };
    async function loadRuns() {
      let d;
      try { d = await api.get('/api/pathfinder/runs'); } catch (e) { $('#pf-score').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
      const runs = d.runs.filter((r) => r.scorecard || r.status !== 'done');
      if (!runs.length) { $('#pf-score').innerHTML = '<p class="muted">No replay runs yet. Preview a plan, approve it and run to compare strategies.</p>'; return; }
      $('#pf-score').innerHTML = `<div class="pf-tbl"><table><thead><tr><th>Run</th><th>Ours vs rival</th><th>Capture</th><th class="num">Ours</th><th class="num">Rival</th><th class="num">Payments</th><th class="num">Spread earned (ours / rival XRP)</th><th class="num">Payer cost vs mid</th><th class="num">Fees est. (ours)</th></tr></thead><tbody>${runs.map((r) => {
        const s = r.scorecard;
        if (!s) return `<tr><td class="mono">${esc(r.id.slice(0, 8))}</td><td>${esc(r.options.strategy)} vs ${esc(r.options.rivalStrategy)}</td><td colspan="7">${esc(r.status)}${r.error ? `: <span class="err">${esc(r.error)}</span>` : ''}</td></tr>`;
        const c = { maker: s.capture.maker.share, rival: s.capture.rival.share, other: s.capture.other.share };
        return `<tr><td class="mono">${esc(r.id.slice(0, 8))}<br><span class="muted">${esc(new Date(r.createdAt).toLocaleTimeString())}</span></td><td>${esc(s.strategy)} vs ${esc(s.rivalStrategy)}<br><span class="muted">${esc(s.tokens.join(' + '))}${r.status === 'failed' ? ` · failed: ${esc(r.error)}` : ''}</span></td>
          <td>${capBar(c)}</td><td class="num">${pct(c.maker)}</td><td class="num">${pct(c.rival)}</td><td class="num">${s.payments.succeeded}/${s.payments.planned}${s.payments.bridged ? ` (${s.payments.bridged} bridged)` : ''}</td>
          <td class="num">${fmt(s.realizedSpreadXrp.maker, 5)} / ${fmt(s.realizedSpreadXrp.rival, 5)}</td><td class="num">${s.execution.avgBpsVsMid == null ? '—' : `${fmt(s.execution.avgBpsVsMid, 0)} bps`}</td><td class="num">${fmt(s.costs.maker.feesXrpEst, 5)}</td></tr>`;
      }).join('')}</tbody></table></div><p class="pf-note">${esc(d.statement)} Offers removed as unfunded/expired during routing are never counted as fills. Reserve is locked while quotes rest (${fmt(runs[0]?.scorecard?.costs?.maker?.reserveLockedXrp, 2)} XRP peak for our latest run) and released when they are cancelled.</p>`;
      const latest = d.runs[0];
      if (latest && $('#pf-feed').querySelector('.muted')) {
        const full = await api.get(`/api/pathfinder/runs/${latest.id}`).catch(() => null);
        const items = (full?.payments || []).filter((p) => p.hash && p.attribution).map((p) => feedItem({ mode: 'LIVE_TESTNET', route: p.route, from: p.from, to: p.to, sizeXrp: p.sizeXrp, hash: p.hash, capturedBy: p.attribution.capturedBy, bridged: p.attribution.bridged }));
        if (items.length) $('#pf-feed').innerHTML = items.reverse().join('');
      }
    }

    // ---------- evidence (headlines, per-payment table + drill-down, NO_PATH diagnosis) ----------
    const BK = { maker: 'Titan maker', maker_seed: 'maker seed offer', rival: 'rival', other: 'other', amm: 'AMM', none: '—' };
    const short = (h) => (h ? `${String(h).slice(0, 10)}…` : '—');
    const amtS = (a) => (a == null ? '—' : typeof a === 'string' ? `${fmt(Number(a) / 1e6, 6)} XRP` : `${fmt(Number(a.value), 6)} ${esc(a.currency)}`);
    const pathS = (paths) => (paths?.length ? paths.map((p) => '[' + p.map((st) => esc(st.currency || st.account || '?')).join(' → ') + ']').join(' ') : 'default (no Paths)');
    let evData = null, evRun = null;
    const evDetail = new Map();
    const td = (label, html, cls = '') => `<td data-label="${esc(label)}"${cls ? ` class="${cls}"` : ''}>${html}</td>`;

    function headlines(r) {
      const h = r.headlines, f = h.flowCaptured, c = h.continuity, k = h.capitalEfficiency;
      const winners = r.payments.map((p) => p.status === 'success' ? `<span class="k-${p.flowWinner === 'maker' ? 'maker' : p.flowWinner === 'rival' ? 'rival' : 'x'}" title="payment ${p.i + 1}: ${esc(BK[p.flowWinner])}">#${p.i + 1} ${esc(BK[p.flowWinner])}</span>` : `<span class="k-skip" title="${esc(p.reason || '')}">#${p.i + 1} ${esc(p.status)}</span>`).join('');
      const minNext = c.perPayment.filter((x) => x.remainingForNextXrp != null).reduce((m, x) => Math.min(m, x.remainingForNextXrp), Infinity);
      return `<div class="pf-head">
        <div><h4>1 · Flow captured</h4><b class="pf-big">${f.totalXrp ? pct(f.byBucket.maker.share) : '—'}</b>
          <p>to our maker's strategy quotes · rival ${pct(f.byBucket.rival.share)} · other ${pct(f.byBucket.other.share + f.byBucket.maker_seed.share)} · ${fmt(f.totalXrp, 4)} XRP of offers consumed${r.counts.bridgedVerified ? ' (bridged payments count both legs)' : ''}</p>
          <div class="pf-mini">${winners}</div></div>
        <div><h4>2 · Corridor continuity</h4><b class="pf-big">${c.ranOut ? 'Ran out' : r.counts.skipped ? 'Broken (no path)' : 'Held'}</b>
          <p>${esc(c.verdict)}${Number.isFinite(minNext) ? ` Lowest executable depth left for a next payment: ${fmt(minNext, 3)} XRP.` : ''}</p></div>
        <div><h4>3 · Capital efficiency</h4><b class="pf-big">${pct(k.turnover)}</b>
          <p>${fmt(k.capturedXrp, 4)} XRP captured vs ${fmt(k.deployedXrp, 3)} XRP deployed (bids ${fmt(k.bidsXrp, 2)} + asks ${fmt(k.asksXrpEq, 2)} XRP-eq + reserve ${fmt(k.reserveXrp, 2)} + fees ${fmt(k.makerFeesXrp, 6)}). Edge vs mid ${fmt(k.edgeVsMidXrp, 6)} XRP, net of fees ${fmt(k.netXrp, 6)} XRP.</p>
          <details><summary class="pf-note">Assumptions</summary><ul class="pf-note">${k.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></details></div>
      </div>`;
    }

    function payRow(r, p) {
      const fills = p.fills ? Object.entries(p.flowCaptured).filter(([, v]) => v > 0).map(([k, v]) => `${esc(BK[k])} ${fmt(v, 4)}`).join('<br>') || '—' : '—';
      const bridge = p.bridge?.applicable ? (p.bridge.verified ? `<span class="pf-ok">✓ both legs</span><br><span class="muted">${fmt(p.bridge.xrpBridged, 4)} XRP</span>` : '<span class="pf-no">not verified</span>') : p.status === 'skipped' ? '—' : '<span class="muted">n/a (XRP leg)</span>';
      const d = p.depth ? `${fmt(p.depth.before.routeXrp, 3)} → ${fmt(p.depth.after.routeXrp, 3)}` : p.diagnosis ? `${fmt(p.diagnosis.routeDepthXrp, 3)} (unused)` : '—';
      const px = p.pricing ? `${fmt(p.pricing.execBps, 1)} / ${fmt(p.pricing.spreadBps, 1)} / ${fmt(p.pricing.impactBps, 1)}` : '—';
      const status = p.status === 'success' ? `<span class="pf-ok pf-nw">success</span>` : `<span class="pf-no">${esc(p.status)}</span>${p.diagnosis ? `<br><span class="muted">${esc(p.diagnosis.classification.label)}</span>` : ''}`;
      return `<tr>${td('#', `${p.i + 1}`)}${td('Route', `${esc(p.from)}→${esc(p.to)}<br><span class="muted">${fmt(p.sizeXrp, 4)} XRP-eq</span>`)}${td('Status', status)}
        ${td('Pathfinding', `<span class="pf-wrap">${esc(p.pathfind?.method || (p.status === 'skipped' ? 'ripple_path_find (empty)' : '—'))}</span>`)}
        ${td('Filled by (XRP)', fills)}${td('XRP bridge', bridge)}${td('Depth XRP before → after', d, 'num')}${td('Exec / spread / impact bps', px, 'num')}
        ${td('Fee XRP', p.feeXrp != null ? fmt(p.feeXrp, 6) : '—', 'num')}
        ${td('Detail', `<button class="ghost" data-drill="${p.i}" aria-expanded="false">${p.hash ? 'Evidence' : 'Diagnosis'}</button>${p.hash ? `<br><a class="mono" href="${TX}${esc(p.hash)}" target="_blank" rel="noopener">${esc(short(p.hash))}</a>` : ''}`)}</tr>`;
    }

    const levelsTbl = (lv) => (lv?.length ? `<div class="pf-tbl"><table class="tf-stack"><thead><tr><th>Owner</th><th>Seq</th><th class="num">Price XRP</th><th class="num">Funded qty</th><th class="num">Funded XRP</th></tr></thead><tbody>${lv.map((l) => `<tr>${td('Owner', `${esc(BK[l.bucket])}${l.unfunded ? ' <span class="pf-no">unfunded</span>' : ''}`)}${td('Seq', `<span class="mono">${l.seq}</span>`)}${td('Price XRP', fmt(l.priceXrp, 7), 'num')}${td('Funded qty', fmt(l.tokenQty, 4), 'num')}${td('Funded XRP', fmt(l.xrp, 6), 'num')}</tr>`).join('')}</tbody></table></div>` : '<p class="muted">no offers</p>');

    function drill(p) {
      if (p.diagnosis) {
        const d = p.diagnosis, c = d.classification;
        return `<div class="pf-drill"><b>Payment ${p.i + 1}: ${esc(p.from)}→${esc(p.to)} skipped</b> · pathfind ≈ ${esc(p.at)} · ledger <span class="mono">${d.ledger}</span> (close ${esc(d.ledgerCloseTime)})
          <div class="pf-cause"><b>${esc(c.label)}</b>: ${esc(c.summary)}</div>
          <ul class="pf-checks">${c.checks.map((x) => `<li>${x.pass ? '<span class="pf-ok">✓</span>' : '<span class="pf-no">✕</span>'} <b>${esc(x.id)}</b>: ${esc(x.detail)}</li>`).join('')}</ul>
          <h5>Request rippled answered</h5><pre>${esc(JSON.stringify(d.request.sent, null, 1))}</pre>
          <h5>Leg A: ${esc(d.legA.book)} at ledger ${d.ledger}</h5>${levelsTbl(d.legA.levels)}
          <h5>Leg B: ${esc(d.legB.book)} at ledger ${d.ledger}</h5>${levelsTbl(d.legB.levels)}
          <p class="pf-note">Direct ${esc(p.from)}/${esc(p.to)} book offers: ${Object.values(d.direct).reduce((s, v) => s + v, 0)}. Strategy quotes validated in ledgers ${d.quotes.map((q) => q.ledger).join(', ')} (all ≤ ${d.ledger}).</p></div>`;
      }
      if (!p.fills) return `<div class="pf-drill muted">${esc(p.evidence || p.reason || 'No metadata collected.')}</div>`;
      return `<div class="pf-drill"><b>Payment ${p.i + 1}: ${esc(p.from)}→${esc(p.to)}</b> · ledger <span class="mono">${p.ledger}</span> · <a class="mono" href="${TX}${esc(p.hash)}" target="_blank" rel="noopener">${esc(short(p.hash))}</a>
        <h5>Submitted</h5><p class="pf-wrap">Amount ${amtS(p.submitted.Amount)} · SendMax ${amtS(p.submitted.SendMax)} · Paths ${pathS(p.submitted.Paths)} · partial payment ${p.submitted.partialPayment ? 'yes' : 'no'}</p>
        <p class="pf-wrap">Delivered ${amtS(p.delivered)} · spent ${p.spent ? `${fmt(p.spent.value, 6)} ${esc(p.spent.asset)}` : '—'} · fee ${fmt(p.feeXrp, 6)} XRP · pathfinding: ${esc(p.pathfind.method)}${p.pathfind.primaryRerun ? ` (historical re-run of the plain ripple_path_find at ledger ${p.pathfind.primaryRerun.ledger}: ${p.pathfind.primaryRerun.alternatives} alternatives)` : ''}. Alternatives list was not recorded at run time.</p>
        <h5>Offers consumed (metadata)</h5><div class="pf-tbl"><table class="tf-stack"><thead><tr><th>Owner</th><th>Book</th><th>Side</th><th class="num">Qty</th><th class="num">XRP</th><th class="num">Price</th></tr></thead><tbody>${p.fills.map((f) => `<tr>${td('Owner', `${esc(f.label)} <span class="mono muted">#${f.seq}</span>`)}${td('Book', esc(f.book))}${td('Side', esc(f.side))}${td('Qty', fmt(f.tokenQty, 4), 'num')}${td('XRP', fmt(f.xrp, 6), 'num')}${td('Price', fmt(f.priceXrp, 7), 'num')}</tr>`).join('')}</tbody></table></div>
        ${p.amm?.length ? `<p>AMM touched: ${p.amm.length}</p>` : '<p class="pf-note">No AMM pool touched.</p>'}
        <p class="pf-note">${esc(p.bridge.note || '')}</p>
        <h5>Pricing</h5><p>Effective ${fmt(p.pricing.effectiveRate, 8)} ${esc(p.pricing.rateUnit || '')} · exec ${fmt(p.pricing.execBps, 1)} bps vs mid · spread at touch ${fmt(p.pricing.spreadBps, 1)} bps · impact ${fmt(p.pricing.impactBps, 1)} bps. <span class="pf-note">${esc(p.pricing.note)}</span></p>
        <h5>Depth before (ledger ${p.depth.ledgerBefore})</h5>${p.depth.levelsBefore?.bids ? `<p class="pf-note">${esc(p.from)} bids</p>${levelsTbl(p.depth.levelsBefore.bids)}` : ''}${p.depth.levelsBefore?.asks ? `<p class="pf-note">${esc(p.to)} asks</p>${levelsTbl(p.depth.levelsBefore.asks)}` : ''}
        <p class="pf-note">After this payment: ${fmt(p.depth.after.routeXrp, 6)} XRP executable on this route. ${esc(p.depth.method)}</p></div>`;
    }

    function noPathPanel(e) {
      const np = e.noPath;
      if (!np.skipped) return '';
      const cmp = np.comparison?.[0];
      return `<div class="card"><h3>NO_PATH diagnosis · ${np.skipped} skipped payments ${badge('LIVE_TESTNET')}</h3>
        <div class="pf-cause"><b>Cause: ${esc(Object.keys(np.categories).map((k) => e.labels.noPathCategories[k]).join(', '))}: rippled's pathfinder, not liquidity.</b>
          Historical re-runs of the exact ripple_path_find request at each pathfind ledger return <b>0 alternatives</b> for BBL↔LDN, while the single-book legs (BBL→XRP and XRP→LDN) are each found at the same ledger, the funded depth covered every payment, trustlines and balances were sufficient, all quotes were validated before path-finding and the direct BBL/LDN books were empty. The code that ran in runs 4–5 had no XRP-bridge fallback and reported this as "no funded liquidity". Run 6 used the fallback added at 00:17 UTC and bridged 6/6.</div>
        <ul class="pf-cats" aria-label="Skipped payments by cause category">${Object.entries(e.labels.noPathCategories).map(([k, l]) => `<li>${esc(l)}: <b>${np.categories[k] || 0}</b></li>`).join('')}</ul>
        ${cmp ? `<h4>Run ${cmp.skippedRun} vs run ${cmp.succeededRun}</h4><p class="pf-note">${esc(cmp.conclusion)}</p>
        <ul class="pf-checks"><li>Options, quotes, payment sizes, mids identical: ${Object.values(cmp.identical).every(Boolean) ? '<span class="pf-ok">yes</span>' : '<span class="pf-no">no</span>'}</li>
          <li>Funded route depth at first payment: ${fmt(cmp.firstPaymentDepthXrp.skipped, 3)} XRP vs ${fmt(cmp.firstPaymentDepthXrp.succeeded, 3)} XRP</li>
          <li>Plain ripple_path_find alternatives (historical re-run): run ${cmp.skippedRun} [${cmp.primaryPathfindAlternatives.skipped.join(', ')}] · run ${cmp.succeededRun} [${cmp.primaryPathfindAlternatives.succeeded.join(', ')}]</li>
          <li>Method: run ${cmp.skippedRun} ${esc(cmp.method.skipped)} · run ${cmp.succeededRun} ${esc(cmp.method.succeeded)}</li></ul>` : ''}
        ${np.codeTimeline ? `<details><summary class="pf-note">Code timeline (from the session transcript and file times)</summary><ol class="pf-time">${np.codeTimeline.map((t) => `<li><span class="mono">${esc(t.at.slice(11, 19))}</span> ${esc(t.what)}</li>`).join('')}</ol></details>` : ''}
        <p class="pf-note">Open a skipped payment's "Diagnosis" for its ledger, books and checks. Full write-up: docs/PATHFINDER_NO_PATH.md.</p></div>`;
    }

    function renderEvidence() {
      const e = evData;
      if (!e?.runs?.length) { $('#pf-ev').innerHTML = '<p class="muted">No replay runs yet.</p>'; return; }
      const r = e.runs.find((x) => x.run === evRun) || e.runs.at(-1);
      evRun = r.run;
      $('#pf-ev').innerHTML = `
        ${noPathPanel(e)}
        <div class="card"><h3>Per-run results</h3>
          <div class="pf-chips" role="group" aria-label="Choose run">${e.runs.map((x) => `<button class="ghost" data-run="${x.run}" aria-pressed="${x.run === r.run}">Run ${x.run} · ${esc(x.options.strategy)}${x.counts.skipped ? ' · NO_PATH' : ''}</button>`).join('')}</div>
          <p class="pf-note">Run ${r.run} <span class="mono">${esc(r.runId.slice(0, 8))}</span> · ${esc(new Date(r.createdAt).toISOString().slice(11, 19))} UTC · ${esc(r.options.strategy)} vs ${esc(r.options.rivalStrategy)} · ${r.counts.success}/${r.counts.planned} success, ${r.counts.skipped} skipped, ${r.counts.bridgedVerified} XRP-bridged (verified)${r.options.routeMix ? ' · route mix forced to token→token by the operator' : ''} · code: ${esc(r.codeVersion?.id || 'unknown')}</p>
          ${headlines(r)}
          <h4>Per-payment evidence</h4>
          <p class="pf-note">Depth = funded XRP-equivalent executable on the payment's books (book_offers at ledger−1; after = minus this payment's consumption). Exec / spread / impact are payer bps vs the run mid.</p>
          <div class="pf-tbl"><table class="tf-stack pf-ev"><thead><tr><th>#</th><th>Route</th><th>Status</th><th>Pathfinding</th><th>Filled by (XRP)</th><th>XRP bridge</th><th class="num">Depth XRP before → after</th><th class="num">Exec / spread / impact bps</th><th class="num">Fee XRP</th><th>Detail</th></tr></thead>
          <tbody>${r.payments.map((p) => payRow(r, p)).join('')}</tbody></table></div>
          <div id="pf-drillbox"></div></div>
        <p class="pf-note">Evidence collected ${esc(e.collectedAt || 'never')} from ${esc(e.server?.network || 'Testnet')} (${esc(e.cacheFile)}). ${esc(e.separation)} <button class="ghost" id="pf-evrefresh" ${e.collecting ? 'disabled' : ''}>${e.collecting ? 'Re-reading…' : 'Re-read from Testnet (read-only)'}</button></p>`;
    }

    async function loadEvidence() {
      try { evData = await api.get('/api/pathfinder/evidence'); renderEvidence(); }
      catch (e) { $('#pf-ev').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    }
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b || !el.contains(b)) return;
      if (b.dataset.run) { evRun = Number(b.dataset.run); renderEvidence(); return; }
      if (b.dataset.drill != null) {
        const box = $('#pf-drillbox');
        const open = b.getAttribute('aria-expanded') === 'true';
        el.querySelectorAll('[data-drill]').forEach((x) => x.setAttribute('aria-expanded', 'false'));
        if (open) { box.innerHTML = ''; return; }
        b.setAttribute('aria-expanded', 'true');
        const r = evData.runs.find((x) => x.run === evRun);
        try {
          if (!evDetail.has(r.runId)) evDetail.set(r.runId, (await api.get(`/api/pathfinder/evidence/${r.runId}`)).run);
          const p = evDetail.get(r.runId).payments.find((x) => x.i === Number(b.dataset.drill));
          box.innerHTML = drill(p);
          box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } catch (err) { box.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
        return;
      }
      if (b.id === 'pf-evrefresh') {
        b.disabled = true; b.textContent = 'Re-reading…';
        try { await api.post('/api/pathfinder/evidence/refresh', {}); const t = setInterval(async () => { const d = await api.get('/api/pathfinder/evidence').catch(() => null); if (d && !d.collecting) { clearInterval(t); evDetail.clear(); evData = d; renderEvidence(); } }, 5000); }
        catch (err) { b.textContent = err.message; }
        return;
      }
      if (b.id === 'pf-cplan') {
        b.disabled = true;
        $('#pf-cplanbox').innerHTML = '<p class="muted">Reading Testnet books and balances…</p>';
        try { renderCPlan(await api.get('/api/pathfinder/continuity-plan')); }
        catch (err) { $('#pf-cplanbox').innerHTML = `<p class="err">${esc(err.message)}</p>`; }
        finally { b.disabled = false; }
      }
    });

    function renderCPlan(c) {
      const b = c.budget;
      $('#pf-cplanbox').innerHTML = `<div class="card"><p class="pf-note">${esc(c.statement)} State: ${esc(c.stateSource)}${c.validatedLedger ? ` · ledger ${c.validatedLedger}` : ''} · mids ${Object.entries(c.mids).map(([k, v]) => `${esc(k)} ${v}`).join(', ')}</p>
        <div class="pf-stats"><div class="pf-stat"><b>${fmt(b.feesXrp, 6)}</b><span>XRP fees (${b.txs.total} txs × ${b.feePerTxXrp}); ${fmt(b.feesXrpWithSafety, 6)} with ×3 safety</span></div>
          <div class="pf-stat"><b>${fmt(b.reservesLockedPeakXrp.total, 2)}</b><span>XRP reserve locked at peak (released)</span></div>
          <div class="pf-stat"><b>${fmt(b.routerXrpSendMaxTotal, 4)}</b><span>XRP router SendMax total (moves to demo makers)</span></div>
          <div class="pf-stat"><b>${fmt(b.upperBoundXrp, 4)}</b><span>XRP upper bound needed at once</span></div></div>
        ${c.phases.map((p) => `<h4>Phase ${esc(p.id)} · ${esc(p.title)}</h4><p class="pf-note">${esc(p.goal)}</p>
          <p class="pf-note">Payments ${p.payments.map((x) => fmt(x.sizeXrp, 2)).join(', ')} XRP-eq · ${p.quotes.length} quotes · txs maker ${p.txs.maker}, rival ${p.txs.rival}, router ${p.txs.router}. Prediction (SIMULATION): ${p.prediction.velocityInsufficientAt == null ? 'VELOCITY depth suffices for every payment' : `VELOCITY depth insufficient from payment ${p.prediction.velocityInsufficientAt + 1}`}; ${p.prediction.rows.map((r) => `#${r.i + 1} ${r.levelsTouched.join('+')}`).join(' · ')}</p>`).join('')}
        <p class="pf-note">Inventory setup: ${b.inventorySetup.length ? b.inventorySetup.map((s) => `issue ${s.qty} ${esc(s.code)} to ${esc(s.to)} (has ${fmt(s.have, 2)}, needs ${fmt(s.need, 2)})`).join('; ') : 'none'}. Guardian: ${c.guardian.allowedNow}/${c.guardian.total} allowed now (no approval), ${c.guardian.allowedIfApproved}/${c.guardian.total} once approved. ${esc(b.netNote)}</p></div>`;
    }

    api.on((ev) => {
      if (!ev.type.startsWith('pathfinder.')) return;
      if (ev.type === 'pathfinder.payment') {
        const f = $('#pf-feed'); if (f.querySelector('.muted') || /setup and quotes/.test(f.textContent)) f.innerHTML = '';
        f.insertAdjacentHTML('afterbegin', feedItem(ev));
      }
      if (ev.type === 'pathfinder.run_done' || ev.type === 'pathfinder.run_failed') { loadRuns(); loadEvidence(); }
      if (ev.type === 'pathfinder.profile') loadProfile();
    });

    const d = await loadProfile();
    if (d?.sampler.status === 'sampling') pollSampler();
    await loadStrategies().catch((e) => { $('#pf-err').textContent = e.message; });
    loadRuns();
    loadEvidence();
  },
};
