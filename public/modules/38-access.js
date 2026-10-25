// Access & Free Threshold. Policy: TGLW is free for every participant up to one configurable threshold,
// regardless of category. LIVE_TESTNET demo participants are measured read-only; everything else is SIMULATION.
const STYLE = `
.acc-root .acc-hero { border-left:4px solid var(--live); }
.acc-root .acc-hero h2 { font-size:20px; }
.acc-root .acc-row { display:grid; gap:10px; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); align-items:end; }
.acc-root .acc-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
.acc-root .acc-th { font:600 22px var(--mono); }
.acc-root .acc-note { font-size:12px; color:var(--muted); }
.acc-root .acc-meter { margin:10px 0 14px; }
.acc-root .acc-meter .top { display:flex; flex-wrap:wrap; justify-content:space-between; gap:6px; font-size:13px; }
.acc-root .acc-track { position:relative; height:12px; background:var(--bg); border:1px solid var(--line); border-radius:6px; overflow:hidden; margin-top:4px; }
.acc-root .acc-fill { position:absolute; inset:0 auto 0 0; background:var(--live); transition:width .4s ease; }
.acc-root .acc-fill.grace { background:var(--sim); } .acc-root .acc-fill.over { background:var(--accent); }
.acc-root .acc-mark { position:absolute; top:-2px; bottom:-2px; left:50%; width:2px; background:var(--ink); }
.acc-root .acc-pill { display:inline-block; font:600 11px var(--mono); padding:2px 6px; border-radius:10px; border:1px solid var(--line); }
.acc-root .acc-pill.free { color:var(--live); border-color:var(--live); } .acc-root .acc-pill.grace { color:var(--sim); border-color:var(--sim); }
.acc-root .acc-pill.over, .acc-root .acc-pill.subscription { color:var(--accent); border-color:var(--accent); }
.acc-root .acc-pill.essential { color:var(--live); border-color:var(--live); background:var(--live-bg); }
.acc-root .acc-pill.x402 { color:var(--replay); border-color:var(--replay); } .acc-root .acc-pill.deny { color:var(--bad); border-color:var(--bad); }
.acc-root .acc-live { border:2px dashed var(--live); }
.acc-root .acc-sim { border:2px dashed var(--sim); }
.acc-root .acc-ok { border-left:3px solid var(--live); background:var(--live-bg); padding:8px 10px; border-radius:4px; margin:8px 0; font-size:13px; }
.acc-root .acc-warn { border-left:3px solid var(--sim); background:var(--sim-bg); padding:8px 10px; border-radius:4px; margin:8px 0; font-size:13px; }
.acc-root ul.acc-list { margin:0; padding-left:18px; font-size:13px; } .acc-root ul.acc-list li { margin:4px 0; }
.acc-root .acc-scroll { overflow-x:auto; }
.acc-root details { font-size:13px; margin-top:6px; } .acc-root summary { cursor:pointer; color:var(--accent); }
.acc-root .acc-kv { display:grid; grid-template-columns:auto 1fr; gap:2px 10px; font-size:13px; }
.acc-root .acc-kv b { font-weight:600; color:var(--muted); }
.acc-root .acc-tiers { display:grid; gap:8px; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); }
.acc-root .acc-tier { border:1px solid var(--line); border-radius:8px; padding:10px; font-size:13px; }
.acc-root .acc-tier.t3 { border-style:dashed; }
`;

const usd = (n) => n == null || !Number.isFinite(n) ? '—' : '$' + (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M' : Math.abs(n) >= 1e4 ? (n / 1e3).toFixed(n % 1000 ? 1 : 0) + 'k' : n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 2 : 0 }));
const usdExact = (n) => n == null || !Number.isFinite(n) ? '—' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const STATUS_TEXT = { free: 'Free', grace: 'Grace period (still free)', over: 'Above threshold — plan offered' };

export default {
  id: 'access', title: 'Access & Free Threshold', order: 38,
  async mount(el, api) {
    if (!document.getElementById('acc-style')) { const s = document.createElement('style'); s.id = 'acc-style'; s.textContent = STYLE; document.head.append(s); }
    const SIM = api.badge('SIMULATION'), LIVE = api.badge('LIVE_TESTNET');
    const esc = api.esc;
    el.classList.add('acc-root');
    el.innerHTML = '<div class="card muted">Loading access policy…</div>';
    let policy;
    try { policy = (await api.get('/api/access/policy')).policy; } catch (e) { el.innerHTML = `<div class="card err">Access policy unavailable: ${esc(e.message)}</div>`; return; }
    const catLabel = (id) => policy.categories.find((c) => c.id === id)?.label || id;
    const pill = (k, text) => `<span class="acc-pill ${esc(k)}">${esc(text || k)}</span>`;

    el.innerHTML = `
      <div class="card acc-hero">
        <h2>Liquidity provision is open to everyone — free up to the same threshold for every participant</h2>
        <p style="margin-top:0">${esc(policy.rule)} No minimum capital to onboard. Individuals, retail, professional market makers, family offices and institutions all get the <b>identical</b> free allowance; above it, an optional capacity plan is offered. Essential functions are never gated.</p>
        <div class="acc-row">
          <div><div class="acc-note">Free liquidity threshold ${SIM}</div><div class="acc-th" id="acc-th"></div><div class="acc-note" id="acc-thlabel"></div></div>
          <div><label for="acc-thin">Change threshold (demo control, USD)</label><input id="acc-thin" type="number" min="1" step="1000"></div>
          <div><label for="acc-grace">Grace period (hours)</label><input id="acc-grace" type="number" min="0" step="1"></div>
          <div><label for="acc-rate">XRP→USD (illustrative)</label><input id="acc-rate" type="number" min="0.0001" step="0.01"></div>
        </div>
        <div class="acc-actions"><button class="primary" id="acc-apply">Apply demo settings</button><button class="ghost" id="acc-reset">Reset to default</button></div>
        <p class="err" id="acc-perr" role="alert"></p>
        <p class="acc-note">Env var <span class="mono">FREE_LIQUIDITY_THRESHOLD_USD</span> sets the configured value; this control is a runtime demonstration only. No approved commercial threshold is shown here.</p>
      </div>

      <div class="card acc-live">
        <h3>Live demo participants ${LIVE}</h3>
        <p class="acc-note" style="margin-top:0">Read-only from validated <span class="mono">account_info</span>, <span class="mono">account_lines</span> and <span class="mono">book_offers</span>. These are Titan Forge demo accounts (organic: false), not organic participants. XRP is converted at the illustrative rate above; demo tokens count only at an independent bid.</p>
        <div id="acc-live"><p class="muted">Loading live figures…</p></div>
      </div>

      <div class="card acc-sim">
        <h3>Category comparison — identical treatment ${SIM}</h3>
        <p class="acc-note" style="margin-top:0">Each row injects the same simulated capital for all five participant categories. The free→plan transition happens at the same threshold for every category.</p>
        <div class="acc-scroll" id="acc-ladder"></div>
        <div id="acc-neutral"></div>
        <h3 style="margin-top:14px">Preset participants ${SIM}</h3>
        <div id="acc-presets"></div>
      </div>

      <div class="grid">
        <div class="card acc-sim">
          <h3>Simulate a participant ${SIM}</h3>
          <div class="acc-row">
            <div><label for="acc-cat">Category</label><select id="acc-cat">${policy.categories.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</select></div>
            <div><label for="acc-cap">Funded inventory (USD)</label><input id="acc-cap" type="number" min="0" step="1000" value="120000"></div>
            <div><label for="acc-wal">Linked wallets</label><input id="acc-wal" type="number" min="1" max="50" value="4"></div>
            <div><label for="acc-ovl">Overlapping offers per wallet</label><input id="acc-ovl" type="number" min="1" max="50" value="3"></div>
            <div><label for="acc-hrs">Hours above threshold</label><input id="acc-hrs" type="number" min="0" step="1" placeholder="steady state"></div>
            <div><label for="acc-plan">Demo plan</label><select id="acc-plan"><option value="">None</option>${policy.plans.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')}</select></div>
          </div>
          <div class="acc-actions"><button class="primary" id="acc-sim">Simulate</button></div>
          <p class="err" id="acc-serr" role="alert"></p>
          <div id="acc-simout"></div>
        </div>
        <div class="card">
          <h3>Access check</h3>
          <p class="acc-note" style="margin-top:0">Calls <span class="mono">checkAccess()</span> — the same seam the x402 layer uses. Order for premium data: free entitlement → subscription → optional x402 → deny with explanation.</p>
          <div class="acc-row">
            <div><label for="acc-cp">Participant</label><select id="acc-cp"></select></div>
            <div><label for="acc-cr">Resource</label><select id="acc-cr">${policy.resources.map((r) => `<option value="${esc(r.id)}">${esc(r.label)} · ${esc(r.cls)}</option>`).join('')}</select></div>
          </div>
          <div class="acc-actions"><button class="primary" id="acc-check">Check access</button></div>
          <div id="acc-cout"></div>
        </div>
      </div>

      <div class="grid">
        <div class="card"><h3>Always available — essential functions</h3>
          <div class="acc-ok">Regardless of threshold, plan, payment or x402 status, the account owner can always:</div>
          <ul class="acc-list">${policy.resources.filter((r) => r.cls === 'essential').map((r) => `<li>${pill('essential', 'essential')} ${esc(r.label)}</li>`).join('')}</ul>
          <p class="acc-note">Authorization still applies: only the owner or an authorized delegate, within Guardian transaction limits and confidential-data boundaries. Capital never overrides those.</p>
        </div>
        <div class="card"><h3>Above the threshold — demo plans ${SIM}</h3>
          <div class="acc-scroll" id="acc-plans"></div>
          <div class="acc-warn">${esc(policy.plans[0]?.disclaimer || '')}</div>
          <p class="acc-note"><b>x402 option:</b> premium data can also be bought per request via x402, optionally. It is never a cost of basic participation, and a request already covered by the free allowance or a plan is never also sent a 402 (no double charging).</p>
        </div>
      </div>

      <div class="card"><h3>Funding tiers are separate from billing</h3>
        <div class="acc-tiers">${policy.tiers.map((t) => `<div class="acc-tier ${t.id === 'T3' ? 't3' : ''}"><b>${esc(t.label)}</b><div class="acc-note">${esc(t.route)}</div><p style="margin:6px 0 0">${esc(t.billing)}</p></div>`).join('')}</div>
        <h3 style="margin-top:14px">How qualifying liquidity is measured</h3>
        <ul class="acc-list">${policy.measurement.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
      </div>`;

    const $ = (id) => el.querySelector('#' + id);
    let participants = { live: { participants: [] }, simulated: { participants: [] } };

    const meter = (p, th) => {
      const share = th ? p.qualifyingUsd / th : 0;
      const w = Math.max(0, Math.min(100, share * 50));
      return `<div class="acc-meter">
        <div class="top"><span><b>${esc(p.label)}</b> · <span class="muted">${esc(catLabel(p.category))}</span> ${api.badge(p.mode)}</span>
          <span>${pill(p.status, STATUS_TEXT[p.status])} <span class="mono">${usdExact(p.qualifyingUsd)}</span> <span class="muted">of ${usd(th)}</span></span></div>
        <div class="acc-track" role="img" aria-label="${esc(p.label)}: ${usdExact(p.qualifyingUsd)} qualifying of ${usd(th)} threshold"><div class="acc-fill ${esc(p.status)}" style="width:${w}%"></div><div class="acc-mark" title="threshold"></div></div>
        ${p.status === 'grace' ? `<div class="acc-note">Grace ends ${esc(new Date(p.graceEndsAt).toLocaleString())}; still free until then.</div>` : ''}
        ${p.offer ? `<div class="acc-note">Plan offered${p.offer.appliesAfterGrace ? ' (after grace)' : ''}: <b>${esc(p.offer.label)}</b> · demo $${esc(p.offer.monthlyUsdDemo)}/mo · first ${usd(p.offer.freeCoveredUsd)} stays free</div>` : ''}
      </div>`;
    };

    const liveDetail = (p) => {
      const m = p.measurement;
      if (!m) return '<p class="acc-note">No live measurement yet.</p>';
      const rows = m.wallets.flatMap((w) => w.assets.map((a) => `<tr><td class="mono">${esc(a.asset.split('.')[0])}</td><td class="num">${a.offered.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td><td class="num">${a.balance.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td><td class="num">${a.counted.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td><td class="num">${usdExact(a.usd)}</td><td>${esc(a.valuation)}</td></tr>`));
      const excl = m.wallets.flatMap((w) => w.excluded.map((x) => `<li><span class="mono">${esc(String(x.asset).split('.')[0])}</span> ${esc(Number(x.amount).toLocaleString('en-US', { maximumFractionDigits: 6 }))} — ${esc(x.reason)}</li>`));
      return `<details><summary>Breakdown · ledger ${esc(m.validatedLedger)} · <span class="mono">${esc(p.addresses.join(', '))}</span></summary>
        ${rows.length ? `<div class="acc-scroll"><table><thead><tr><th>Asset</th><th class="num">Offered (funded)</th><th class="num">Spendable balance</th><th class="num">Counted</th><th class="num">USD</th><th>Valuation</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<p class="acc-note">No resting executable offers — qualifying liquidity is $0 (the account balance itself is not counted).</p>'}
        ${excl.length ? `<p class="acc-note" style="margin-bottom:2px">Excluded:</p><ul class="acc-list">${excl.join('')}</ul>` : ''}
        <p class="acc-note">Double-count excluded: ${usdExact(m.overlapExcludedUsd)} · XRP reserve ${esc(m.reserveBaseXrp)} + ${esc(m.reserveIncXrp)}/object · rate ${esc(m.xrpUsd)} USD/XRP (illustrative) · ${esc(p.samples)} time-weighted samples</p>
      </details>`;
    };

    const renderPolicy = () => {
      $('acc-th').textContent = usdExact(policy.thresholdUsd);
      $('acc-thlabel').textContent = policy.thresholdLabel;
      $('acc-thin').value = policy.thresholdUsd; $('acc-grace').value = policy.graceHours; $('acc-rate').value = policy.xrpUsd;
      $('acc-plans').innerHTML = `<table><thead><tr><th>Plan</th><th class="num">Capacity</th><th class="num">Demo price</th><th>Premium data</th></tr></thead><tbody>${policy.plans.map((p) => `<tr><td>${esc(p.label)}</td><td class="num">${p.capacityUsd ? usd(p.capacityUsd) : 'Unlimited'}</td><td class="num">$${esc(p.monthlyUsdDemo)}/mo</td><td class="mono">${esc(p.premium.join(', '))}</td></tr>`).join('')}</tbody></table>`;
    };

    const renderParticipants = () => {
      const th = participants.thresholdUsd;
      const L = participants.live;
      $('acc-live').innerHTML = L.error && !L.participants.length ? `<p class="err">Live figures unavailable: ${esc(L.error)}</p>`
        : L.participants.map((p) => meter(p, th) + liveDetail(p)).join('') + (L.refreshedAt ? `<p class="acc-note">Validated ledger ${esc(L.validatedLedger)} · refreshed ${esc(new Date(L.refreshedAt).toLocaleTimeString())}${L.error ? ` · last refresh error: ${esc(L.error)}` : ''}</p>` : '');
      const presets = participants.simulated.participants.filter((p) => /^sim-(retail|adv_retail|pro_mm|family_office|institutional)$/.test(p.id));
      $('acc-presets').innerHTML = presets.map((p) => meter(p, th)).join('');
      const all = [...L.participants, ...participants.simulated.participants];
      const cur = $('acc-cp').value;
      $('acc-cp').innerHTML = `<option value="">(anonymous / unregistered)</option>` + all.map((p) => `<option value="${esc(p.id)}">${esc(p.label)} · ${esc(p.mode)}</option>`).join('');
      if (all.some((p) => p.id === cur)) $('acc-cp').value = cur; else if (L.participants[0]) $('acc-cp').value = L.participants[0].id;
    };

    const renderLadder = (l) => {
      $('acc-ladder').innerHTML = `<table><thead><tr><th class="num">Capital</th>${policy.categories.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${l.rows.map((r) => `<tr><td class="num mono">${usdExact(r.capitalUsd)}</td>${r.byCategory.map((c) => `<td>${pill(c.status === 'over' ? 'over' : 'free', c.status === 'over' ? 'plan offered' : 'free')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      $('acc-neutral').innerHTML = l.categoryNeutral ? `<div class="acc-ok">Every row is identical across categories: category never changes the rule. Threshold ${usdExact(l.thresholdUsd)} — exactly at it is still free.</div>` : '<div class="err">Category treatment differs — this should never happen.</div>';
    };

    const loadAll = async () => {
      try { participants = await api.get('/api/access/participants'); renderParticipants(); } catch (e) { $('acc-live').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
      try { renderLadder(await api.get('/api/access/ladder')); } catch (e) { $('acc-ladder').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    };

    const decisionCard = (d) => `<div style="margin-top:10px">${pill(d.decision, d.decision)} ${api.badge(d.mode)} <span class="muted mono">${esc(d.resource)}</span>
      <p style="margin:6px 0">${esc(d.reason)}</p>
      <div class="acc-kv">${d.qualifyingUsd != null ? `<b>Qualifying</b><span class="mono">${usdExact(d.qualifyingUsd)}</span>` : ''}<b>Threshold</b><span class="mono">${usdExact(d.thresholdUsd)}</span>
      <b>402 / pay-per-request</b><span>${d.charge?.x402 ? 'optional x402 offered (demo, not billed)' : 'no — not charged'}</span>
      ${d.offer ? `<b>Plan offer</b><span>${esc(d.offer.label)} · demo $${esc(d.offer.monthlyUsdDemo)}/mo</span>` : ''}</div></div>`;

    renderPolicy();
    await loadAll();

    $('acc-apply').onclick = async () => {
      $('acc-perr').textContent = '';
      try { policy = (await api.post('/api/access/policy', { thresholdUsd: Number($('acc-thin').value), graceHours: Number($('acc-grace').value), xrpUsd: Number($('acc-rate').value) })).policy; renderPolicy(); await loadAll(); }
      catch (e) { $('acc-perr').textContent = e.message; }
    };
    $('acc-reset').onclick = async () => {
      $('acc-perr').textContent = '';
      try { policy = (await api.post('/api/access/policy', { reset: true })).policy; renderPolicy(); await loadAll(); } catch (e) { $('acc-perr').textContent = e.message; }
    };

    $('acc-sim').onclick = async () => {
      $('acc-serr').textContent = '';
      const hrs = $('acc-hrs').value;
      try {
        const r = await api.post('/api/access/simulate', { category: $('acc-cat').value, capitalUsd: Number($('acc-cap').value), linkedWallets: Number($('acc-wal').value), overlappingOffers: Number($('acc-ovl').value), hoursAbove: hrs === '' ? null : Number(hrs), subscriptionPlanId: $('acc-plan').value || null });
        const L = r.demonstrations.linkedAccounts, O = r.demonstrations.overlappingOffers;
        $('acc-simout').innerHTML = meter(r.participant, r.participant.thresholdUsd) + `
          <div class="${L.everyWalletBelowThreshold && r.participant.status !== 'free' ? 'acc-warn' : 'acc-ok'}"><b>Linked accounts:</b> ${esc(L.wallets)} wallets at ${usd(L.perWalletUsd[0])} each${L.everyWalletBelowThreshold ? ' (each below the threshold)' : ''} → aggregated ${usdExact(L.aggregatedUsd)} → ${esc(STATUS_TEXT[L.status])}. ${esc(L.note)}</div>
          <div class="acc-ok"><b>Overlapping offers:</b> ${esc(O.offersPerWallet)} offers per wallet look like ${usdExact(O.naiveOfferedUsd)}; counted ${usdExact(O.countedUsd)}, excluded ${usdExact(O.excludedUsd)}. ${esc(O.note)}</div>
          ${Object.values(r.decisions).map(decisionCard).join('')}`;
        participants = await api.get('/api/access/participants'); renderParticipants();
        $('acc-cp').value = r.participant.id;
      } catch (e) { $('acc-serr').textContent = e.message; }
    };

    $('acc-check').onclick = async () => {
      try { $('acc-cout').innerHTML = decisionCard(await api.post('/api/access/check', { participantId: $('acc-cp').value || undefined, resource: $('acc-cr').value })); }
      catch (e) { $('acc-cout').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    };

    let pending = null;
    api.on((ev) => {
      if (ev.type !== 'access.threshold_crossed' && ev.type !== 'access.policy_changed') return;
      clearTimeout(pending); pending = setTimeout(async () => { try { policy = (await api.get('/api/access/policy')).policy; renderPolicy(); await loadAll(); } catch {} }, 600);
    });
  },
};
