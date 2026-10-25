// Demo Loop: the full cycle repeating on XRPL Testnet inside an operator-approved, capped session.
// Round = launch a new demo token (direct fill) -> Pathfinder bridge_leg batch (pathfound payments).
// Every fill is our own demo wallets trading with each other (organic:false), shown next to the real
// Mainnet rate (MAINNET_OBSERVED, read-only) and never mixed with it.
const CSS = `
.lp .lp-banner { background:var(--bad-bg); border-left:4px solid var(--bad); padding:10px 12px; border-radius:6px; margin:0 0 12px; font-size:14px; }
.lp .lp-cols { display:grid; gap:12px; grid-template-columns:repeat(auto-fit, minmax(280px,1fr)); }
.lp .lp-sec { border-left:4px solid var(--line); padding-left:12px; min-width:0; }
.lp .lp-sec.lp-test { border-color:var(--live); } .lp .lp-sec.lp-main { border-color:var(--accent); }
.lp .lp-sec h3 { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:0; }
.lp .lp-stats { display:grid; gap:8px; grid-template-columns:repeat(auto-fit, minmax(120px,1fr)); margin:8px 0; }
.lp .lp-stat { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:8px 10px; min-width:0; }
.lp .lp-stat b { display:block; font-size:20px; font-variant-numeric:tabular-nums; }
.lp .lp-stat span { font-size:12px; color:var(--muted); }
.lp .lp-row { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; }
.lp .lp-row > div { flex:1 1 140px; min-width:0; }
.lp .lp-note { font-size:13px; color:var(--muted); }
.lp .lp-phase { font-weight:600; }
.lp label.lp-check { display:flex; gap:8px; align-items:flex-start; font-size:14px; margin:10px 0; }
.lp label.lp-check input { width:auto; margin-top:4px; }
.lp .lp-tbl { overflow-x:auto; }
.lp .lp-feed { list-style:none; padding:0; margin:0; max-height:300px; overflow:auto; }
.lp .lp-feed li { padding:6px 0; border-bottom:1px solid var(--line); font-size:13px; overflow-wrap:anywhere; }
`;
const TX = 'https://testnet.xrpl.org/transactions/';
const fmt = (x, d = 2) => (x == null || !Number.isFinite(Number(x)) ? '—' : Number(x).toLocaleString(undefined, { maximumFractionDigits: d }));
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(0)}%`);
const PHASE = { starting: 'Starting', capital: 'Capital injection (SIMULATION)', corridor_up: 'Standing up the corridor (SIMULATION)', corridor_down: 'Tearing the corridor down (SIMULATION)', corridor_hold: 'Corridor up: six rings live (SIMULATION ocean)', launch: 'Launching a new token', launched: 'Direct fill done', pathfinder: 'Pathfinder batch running', round_done: 'Round done', waiting: 'Waiting for next round', stopped: 'Stopped' };

export default {
  id: 'loop', title: 'Demo Loop', order: 36,
  async mount(el, api) {
    const { esc, badge } = api;
    if (!document.getElementById('lp-style')) { const s = document.createElement('style'); s.id = 'lp-style'; s.textContent = CSS; document.head.append(s); }
    el.classList.add('lp');
    el.innerHTML = `
      <div id="lp-banner" class="lp-banner" hidden><b>DEMO LOOP RUNNING: our own wallets, not market demand.</b> Every fill below is between Titan Forge demo accounts on XRPL Testnet (organic:false).</div>
      <div class="card"><h2>Demo loop ${badge('LIVE_TESTNET')} <span class="badge bad">DEMO LOOP · organic:false</span></h2>
        <p class="lp-note">One round, the full cycle:
          <b>1 · Capital injection</b> ${badge('SIMULATION')} modeled capital pulses into the market →
          <b>2 · Launch</b> ${badge('LIVE_TESTNET')} new demo token, maker quotes, one direct fill →
          <b>3 · Corridor stand-up</b> ${badge('SIMULATION')} Growth scenario promotes spoke → growing spoke → corridor (six rings light up) →
          <b>4 · Corridor window</b> ${badge('LIVE_TESTNET')} up to 3 router accounts keep sending pathfound payments in parallel (one each per ~4 s) for as long as the corridor is up, bridged through XRP, routes and sizes from the observed Mainnet profile, our quotes re-posted after each fill; each fill swims across Titan View as a creature sized by its XRP, and the modeled ocean ${badge('SIMULATION')} adds the big ones (orca → kraken need the outer DEEP/CEILING rings) →
          <b>5 · Teardown</b> ${badge('SIMULATION')} demand fades, the corridor drops to standby and modeled capital is released.
          It repeats on its own until a cap is hit or you press Stop. Pressing Start approves this one capped session only; a server restart never resumes it.
          The corridor runs on the SIMULATION track because demo fills never count as live corridor evidence.</p>
        <p><button class="ghost" id="lp-view" type="button">Watch it in Titan View →</button></p>
        <div class="lp-row">
          <div><label for="lp-rounds">Rounds (1–20)</label><input id="lp-rounds" type="number" min="1" max="20" value="5"></div>
          <div><label for="lp-min">Time cap, minutes (1–60)</label><input id="lp-min" type="number" min="1" max="60" value="20"></div>
          <div><label for="lp-k">Minimum payments per round (1–10)</label><input id="lp-k" type="number" min="1" max="10" value="6"></div>
          <div><label for="lp-routers">Router accounts paying in parallel (1–3)</label><input id="lp-routers" type="number" min="1" max="3" value="3"></div>
          <div><label for="lp-q">Quote size, XRP per quote (1–15)</label><input id="lp-q" type="number" min="1" max="15" step="0.5" placeholder="default 5"></div>
          <div><label for="lp-vol">Volume cap, XRP (1–100)</label><input id="lp-vol" type="number" min="1" max="100" value="100"></div>
          <div><label for="lp-gap">Pause between rounds, s</label><input id="lp-gap" type="number" min="5" max="120" value="10"></div>
          <div><label for="lp-anchor">Anchor token</label><select id="lp-anchor"></select></div>
          <div><label for="lp-cap">Capital injected per round, USD (SIMULATION)</label><input id="lp-cap" type="number" min="100" max="10000000" step="1000" value="1000000"></div>
          <div><label for="lp-hold">Corridor window, s (0–600): routers keep paying while it is up</label><input id="lp-hold" type="number" min="0" max="600" value="90"></div>
          <div><label class="lp-check" style="margin:22px 0 0"><input type="checkbox" id="lp-corr" checked> Corridor stand-up and teardown</label></div>
        </div>
        <p id="lp-est" class="lp-note"></p>
        <label class="lp-check"><input type="checkbox" id="lp-ok"> I approve this capped session: Titan Forge demo accounts will sign XRPL Testnet transactions on their own until a cap is reached or I press Stop. The flow is demo-generated, not demand.</label>
        <div class="lp-row"><div><button class="primary" id="lp-start">Start loop</button> <button class="ghost" id="lp-stop" disabled>Stop</button></div></div>
        <p id="lp-err" class="err" role="alert"></p>
      </div>

      <div class="lp-cols">
        <section class="lp-sec lp-test card"><h3>Our loop ${badge('LIVE_TESTNET')} <span class="badge bad">organic:false</span></h3><div id="lp-live" class="muted">No session yet.</div></section>
        <section class="lp-sec lp-main card"><h3>Mainnet, observed ${badge('MAINNET_OBSERVED')}</h3><div id="lp-main" class="muted">Loading…</div></section>
      </div>

      <div class="card"><h3>Rounds ${badge('LIVE_TESTNET')}</h3><div id="lp-rounds-tbl" class="muted">No rounds yet.</div></div>
      <div class="card"><h3>Live fills ${badge('LIVE_TESTNET')}</h3><ul class="lp-feed" id="lp-feed"><li class="muted">Fills appear here as they validate.</li></ul></div>
      <div class="card"><h3>Past sessions</h3><div id="lp-hist" class="muted">None.</div></div>`;

    const $ = (s) => el.querySelector(s);
    const cfg = () => ({ rounds: Number($('#lp-rounds').value), minutes: Number($('#lp-min').value), k: Number($('#lp-k').value), maxVolumeXrp: Number($('#lp-vol').value), gapSec: Number($('#lp-gap').value), anchor: $('#lp-anchor').value, capitalUsd: Number($('#lp-cap').value), holdSec: Number($('#lp-hold').value), routers: Number($('#lp-routers').value), corridor: $('#lp-corr').checked, ...($('#lp-q').value ? { quoteXrp: Number($('#lp-q').value) } : {}) });
    const estimate = () => {
      const c = cfg();
      // Mirrors DemoLoop.plannedK: one payment per router every 4 s for the corridor window, at least k, max 120,
      // and never more than the volume cap allows at the 2 XRP worst case.
      const windowK = c.corridor && c.holdSec > 0 ? Math.floor(c.holdSec / 4) * c.routers : 0;
      const perRound = Math.max(0, Math.min(Math.max(c.k, windowK), 120, Math.floor((c.maxVolumeXrp - 1) / 2)));
      const worst = c.rounds * (1 + perRound * 2);
      const roundSec = 35 + 30 + Math.ceil(perRound / c.routers) * 4.5 + 40 + (c.corridor ? 12 : 0) + c.gapSec; // rough: launch, quotes, payment batches, cleanup, corridor steps, pause
      const perHour = Math.round(perRound * 3600 / roundSec);
      $('#lp-est').textContent = `About ${perRound} pathfound payments per round from ${c.routers} router(s), about ${perHour} per hour (cap 600), plus 1 direct fill per round. Up to ${c.rounds} round(s). Worst-case volume ${fmt(Math.min(worst, c.maxVolumeXrp), 1)} XRP (the volume cap stops it first if lower). Each new token also locks about 1.2 XRP of reserve in our demo accounts for its trustlines and resting offers. A round takes roughly ${Math.round(roundSec / 60 * 10) / 10} min, so ${c.rounds} round(s) need about ${Math.ceil(c.rounds * roundSec / 60)} min (time cap ${c.minutes} min).`;
    };
    el.addEventListener('input', (e) => { if (e.target.closest('.lp-row')) estimate(); });

    let st = null, poll = null;
    function render(d) {
      st = d;
      const s = d.session, running = d.running;
      $('#lp-banner').hidden = !running;
      $('#lp-start').disabled = running || !d.ledgerReady || d.readonlyInstance;
      $('#lp-stop').disabled = !running || s?.status === 'stopping';
      if (!$('#lp-anchor').options.length) {
        $('#lp-anchor').innerHTML = (d.anchors || []).map((t) => `<option ${t === 'LDN' ? 'selected' : ''}>${esc(t)}</option>`).join('') || '<option value="">no live token</option>';
      }
      if (d.readonlyInstance || !d.ledgerReady) $('#lp-err').textContent = d.readonlyInstance ? 'Read-only or offline instance: the loop cannot start here.' : 'Testnet not ready yet.';

      if (s) {
        const T = s.totals, mins = Math.max(((s.finishedAt ? Date.parse(s.finishedAt) : Date.now()) - Date.parse(s.startedAt)) / 60000, 1 / 60);
        const fills = T.directFills + T.pathPayments;
        $('#lp-live').innerHTML = `
          <p><span class="lp-phase">${esc(s.status === 'stopping' ? 'Stopping after the current step…' : PHASE[s.phase] || s.phase)}</span>${s.rounds.at(-1)?.code && running ? ` · round ${s.rounds.length} · <span class="mono">${esc(s.rounds.at(-1).code)}</span>` : ''}${s.stopReason && !running ? ` · ${esc(s.stopReason)}` : ''}</p>
          <div class="lp-stats">
            <div class="lp-stat"><b>${fmt(fills / mins, 1)}</b><span>fills per minute (ours)</span></div>
            <div class="lp-stat"><b>${T.rounds}/${s.config.rounds}</b><span>rounds</span></div>
            <div class="lp-stat"><b>${T.directFills}</b><span>direct fills (launch)</span></div>
            <div class="lp-stat"><b>${T.pathPayments}/${T.pathPlanned}</b><span>pathfound payments${T.bridged ? ` (${T.bridged} bridged)` : ''}</span></div>
            <div class="lp-stat"><b>${T.capturedXrp ? pct(T.makerCaptureXrp / T.capturedXrp) : '—'}</b><span>of routed flow filled by our maker</span></div>
            <div class="lp-stat"><b>${fmt(T.volumeXrp, 2)}</b><span>XRP moved (cap ${fmt(s.config.maxVolumeXrp, 0)})</span></div>
          </div>
          <p class="lp-note">${T.txs} validated Testnet transactions · started ${esc(new Date(s.startedAt).toLocaleTimeString())} · time cap ${esc(new Date(s.deadline).toLocaleTimeString())}${s.nextRoundAt && running ? ` · next round ${esc(new Date(s.nextRoundAt).toLocaleTimeString())}` : ''}. ${esc(d.statement)}</p>`;
        $('#lp-rounds-tbl').innerHTML = s.rounds.length ? `<div class="lp-tbl"><table><thead><tr><th>#</th><th>Token</th><th>Direct fill</th><th>Capital ${badge('SIMULATION')}</th><th>Corridor ${badge('SIMULATION')}</th><th class="num">Pathfound</th><th class="num">Our share</th><th class="num">XRP moved</th><th>Status</th></tr></thead><tbody>${s.rounds.map((r) => `<tr><td>${r.round}</td><td class="mono">${esc(r.code || '')}</td>
          <td>${r.fillHash ? `<a class="mono" href="${TX}${esc(r.fillHash)}" target="_blank" rel="noopener">${esc(r.fillHash.slice(0, 10))}…</a>` : '—'}</td>
          <td>${r.capital?.usd ? `$${fmt(r.capital.usd, 0)}` : '—'}</td>
          <td>${r.corridor ? (r.corridor.error ? `<span class="err">${esc(r.corridor.error)}</span>` : `${esc(r.corridor.peak || '…')}${r.corridor.down?.[0]?.to ? ` → ${esc(r.corridor.down[0].to)}${r.corridor.down[0].releasedUsd ? ` ($${fmt(r.corridor.down[0].releasedUsd, 0)} released)` : ''}` : ''}`) : '—'}</td>
          <td class="num">${r.payments ? `${r.payments.succeeded}/${r.payments.planned}` : '—'}</td><td class="num">${r.capture ? pct(r.capture.maker) : '—'}</td><td class="num">${fmt(r.volumeXrp, 3)}</td>
          <td>${esc(r.status)}${r.error ? `: <span class="err">${esc(r.error)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No rounds yet.</p>';
      }
      const m = d.mainnet;
      $('#lp-main').innerHTML = m ? `<div class="lp-stats">
          <div class="lp-stat"><b>${fmt(m.perMinute.payments, 0)}</b><span>payments per minute</span></div>
          <div class="lp-stat"><b>${fmt(m.perMinute.pathfound, 1)}</b><span>pathfound per minute (${(m.totals.pathfoundShareOfPayments * 100).toFixed(1)}%)</span></div>
          <div class="lp-stat"><b>${fmt(m.totals.endUser, 0)}</b><span>full deliveries to a third party</span></div>
          <div class="lp-stat"><b>${fmt(m.totals.partial, 0)}</b><span>partial payments in sample</span></div></div>
        <p class="lp-note">${esc(m.note)} Ledgers ${m.window.fromLedger}–${m.window.toLedger}, ${m.window.seconds} s, sampled ${esc(new Date(m.sampledAt).toLocaleString())}. Most of the constant Mainnet rate is direct issued-token payments; routed (pathfound) payments are the part our loop replays the shape of.</p>`
        : '<p class="muted">No Mainnet sample loaded. Sample it from the Pathfinder Flow tab.</p>';
      $('#lp-hist').innerHTML = d.history?.length ? `<div class="lp-tbl"><table><thead><tr><th>Started</th><th class="num">Rounds</th><th class="num">Fills</th><th class="num">XRP</th><th>Ended</th></tr></thead><tbody>${d.history.map((h) => `<tr><td>${esc(new Date(h.startedAt).toLocaleString())}</td><td class="num">${h.totals.rounds}</td><td class="num">${h.totals.directFills + h.totals.pathPayments}</td><td class="num">${fmt(h.totals.volumeXrp, 2)}</td><td>${esc(h.status === 'running' ? 'running' : h.stopReason || h.status)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">None.</p>';
      clearInterval(poll);
      if (running) poll = setInterval(load, 3000);
    }
    async function load() {
      try { render(await api.get('/api/loop/status')); }
      catch (e) { $('#lp-err').textContent = e.message; }
    }

    $('#lp-start').onclick = async () => {
      $('#lp-err').textContent = '';
      if (!$('#lp-ok').checked) { $('#lp-err').textContent = 'Tick the approval box first.'; return; }
      $('#lp-start').disabled = true;
      try { await api.post('/api/loop/start', { ...cfg(), approved: true }); $('#lp-ok').checked = false; $('#lp-feed').innerHTML = ''; await load(); }
      catch (e) { $('#lp-err').textContent = e.message; $('#lp-start').disabled = false; }
    };
    $('#lp-view').onclick = () => api.show('view');
    $('#lp-stop').onclick = async () => {
      $('#lp-stop').disabled = true;
      try { await api.post('/api/loop/stop', {}); await load(); } catch (e) { $('#lp-err').textContent = e.message; }
    };

    const feed = (html) => { const f = $('#lp-feed'); if (f.querySelector('.muted')) f.innerHTML = ''; f.insertAdjacentHTML('afterbegin', `<li>${html}</li>`); while (f.children.length > 60) f.lastChild.remove(); };
    api.on((ev) => {
      if (!st?.running && !ev.type.startsWith('loop.')) return;
      if (ev.type === 'launch.done') feed(`${badge(ev.mode)} <b>direct fill</b> · new token <span class="mono">${esc(ev.code)}</span> · <a class="mono" href="${TX}${esc(ev.fillHash)}" target="_blank" rel="noopener">${esc(String(ev.fillHash).slice(0, 14))}…</a>`);
      if (ev.type === 'pathfinder.payment') feed(`${badge(ev.mode)} <b>pathfound</b> ${esc(ev.from)}→${esc(ev.to)} ${fmt(ev.sizeXrp, 3)} XRP-eq${ev.bridged ? ' · bridged via XRP' : ''} · our maker ${fmt(ev.capturedBy?.maker, 4)} XRP · <a class="mono" href="${TX}${esc(ev.hash)}" target="_blank" rel="noopener">${esc(String(ev.hash).slice(0, 14))}…</a>`);
      if (ev.type.startsWith('loop.')) load();
    });

    await load();
    estimate();
  },
};
