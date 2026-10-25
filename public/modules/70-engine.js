// Engine Contracts: which engine is active, the JSON contracts the Rust Quoter / Strategic Engine speak, and a live validator.
const CSS = `
.eng-root .eng-hero { border-width: 2px; }
.eng-root .eng-hero.demo { border-color: var(--sim); background: var(--sim-bg); }
.eng-root .eng-hero.auth { border-color: var(--live); background: var(--live-bg); }
.eng-root .eng-big { font: 800 clamp(20px, 6vw, 34px)/1.1 system-ui, sans-serif; letter-spacing: .04em; margin: 4px 0 8px; }
.eng-root .eng-hero.demo .eng-big { color: var(--sim); } .eng-root .eng-hero.auth .eng-big { color: var(--live); }
.eng-root .eng-kv { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; font-size: 13px; }
.eng-root .eng-kv dt { color: var(--muted); } .eng-root .eng-kv dd { margin: 0; word-break: break-word; }
.eng-root .eng-list { list-style: none; padding: 0; margin: 0; }
.eng-root .eng-list li { padding: 8px 0; border-bottom: 1px solid var(--line); display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; justify-content: space-between; }
.eng-root .eng-list .eng-desc { flex-basis: 100%; font-size: 12px; }
.eng-root textarea.eng-ta { font: 12px/1.45 var(--mono); min-height: 220px; resize: vertical; }
.eng-root .eng-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.eng-root .eng-row > * { flex: 1 1 140px; }
.eng-root .eng-ok { color: var(--live); font-weight: 600; } .eng-root .eng-bad { color: var(--bad); font-weight: 600; }
.eng-root pre.eng-pre { background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 10px; overflow: auto; max-height: 320px; font: 12px/1.4 var(--mono); margin: 8px 0 0; }
.eng-root .eng-errs { margin: 8px 0 0; padding-left: 18px; font-size: 13px; }
.eng-root .eng-errs code { font-family: var(--mono); font-size: 12px; }
`;

export default {
  id: 'engine', title: 'Engine Contracts', order: 70,
  async mount(el, api) {
    if (!document.getElementById('eng-style')) { const s = document.createElement('style'); s.id = 'eng-style'; s.textContent = CSS; document.head.append(s); }
    el.classList.add('eng-root');
    el.innerHTML = `
      <div class="card eng-hero" id="eng-hero"><p class="muted">Loading engine status…</p></div>
      <div class="grid">
        <div class="card"><h2>Validator</h2>
          <p class="muted">Paste JSON and check it against a contract. Uses the same validator the server applies to every Rust engine request and response.</p>
          <label for="eng-schema">Contract</label><select id="eng-schema"></select>
          <label for="eng-input">JSON value</label><textarea id="eng-input" class="eng-ta" spellcheck="false"></textarea>
          <div class="eng-row"><button class="ghost" id="eng-ex">Load example</button><button class="primary" id="eng-go">Validate</button></div>
          <div id="eng-out" role="status" aria-live="polite"></div>
        </div>
        <div class="card"><h2>Contracts <span class="muted" id="eng-ver"></span></h2><ul class="eng-list" id="eng-list"></ul>
          <p class="muted" style="font-size:12px">Integration guide for the Rust team: <span class="mono">contracts/README.md</span>. Conformance: <span class="mono">node contracts/conformance.mjs --bin &lt;engine&gt;</span></p>
        </div>
      </div>
      <div class="card"><h2>Adapter self-test <span id="eng-st-badge"></span></h2>
        <p class="muted">Validates what the active adapter produces right now, plus every recorded Testnet launch step as TxEvidence.</p>
        <button class="ghost" id="eng-st-run">Run self-test</button><div id="eng-st"></div></div>`;

    const $ = (s) => el.querySelector(s);
    const hero = $('#eng-hero'), sel = $('#eng-schema'), input = $('#eng-input'), out = $('#eng-out');

    async function loadInfo() {
      let d;
      try { d = await api.get('/api/engine/info'); } catch (e) { hero.innerHTML = `<p class="err">Engine info unavailable: ${api.esc(e.message)}</p>`; return null; }
      const a = d.active, st = d.status;
      hero.className = `card eng-hero ${d.authentic ? 'auth' : 'demo'}`;
      hero.innerHTML = `
        <div class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.08em">Active engine ${api.badge('SIMULATION')}</div>
        <div class="eng-big">${d.authentic ? 'AUTHENTIC TITAN GHOST ENGINE' : a.id.startsWith('rust:') ? 'EXTERNAL ENGINE — NOT AUTHENTIC' : 'TEMPORARY DEMO ADAPTER'}</div>
        <p style="margin:0 0 10px">${api.esc(d.label)}</p>
        ${d.authentic ? '' : '<p class="muted" style="margin:0 0 10px">Allocations and recommendations shown anywhere in Titan Forge are illustrative outputs of this adapter, not the proprietary Rust Quoter or Strategic Engine. All of them are SIMULATION.</p>'}
        <dl class="eng-kv">
          <dt>Adapter id</dt><dd class="mono">${api.esc(a.id)}</dd>
          <dt>Transport</dt><dd>${api.esc(a.transport || 'in-process')}</dd>
          <dt>Rust engine</dt><dd>${api.esc(st.configured === 'none' ? 'not configured' : `${st.configured} · ${st.state}`)}</dd>
          <dt>Status</dt><dd>${api.esc(a.note || st.reason)}</dd>
          <dt>Contract</dt><dd>v${api.esc(d.contractVersion)} · wire v${api.esc(d.wireVersion)}</dd>
          <dt>Enum drift</dt><dd>${d.enumDrift.length ? `<span class="eng-bad">${api.esc(d.enumDrift.join('; '))}</span>` : '<span class="eng-ok">none — schemas match domain.js</span>'}</dd>
        </dl>`;
      $('#eng-ver').textContent = `v${d.contractVersion}`;
      $('#eng-list').innerHTML = d.schemas.map((s) => `<li><b>${api.esc(s.title)}</b>
        <span><a class="mono" href="${api.esc(s.url)}" target="_blank" rel="noopener">${api.esc(s.name)}.schema.json</a>
        <button class="ghost" style="padding:2px 8px;font-size:12px" data-try="${api.esc(s.name)}">Try</button></span>
        ${s.description ? `<span class="muted eng-desc">${api.esc(s.description)}</span>` : ''}</li>`).join('');
      $('#eng-list').querySelectorAll('[data-try]').forEach((b) => (b.onclick = () => { sel.value = b.dataset.try; loadExample(); sel.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
      if (!sel.options.length) {
        sel.innerHTML = d.schemas.filter((s) => s.name !== 'common').map((s) => `<option value="${api.esc(s.name)}">${api.esc(s.title)} (${api.esc(s.name)})</option>`).join('');
        sel.value = 'tx-evidence';
      }
      return d;
    }

    async function loadExample() {
      out.innerHTML = '';
      try { input.value = JSON.stringify(await api.get(`/api/engine/examples/${encodeURIComponent(sel.value)}`), null, 2); }
      catch { input.value = '{}'; }
    }

    async function run() {
      let value;
      try { value = JSON.parse(input.value); }
      catch (e) { out.innerHTML = `<p class="eng-bad">Not valid JSON: ${api.esc(e.message)}</p>`; return; }
      try {
        const r = await api.post('/api/engine/validate', { schema: sel.value, value });
        out.innerHTML = r.valid ? `<p class="eng-ok">✓ Valid ${api.esc(r.schema)}</p>`
          : `<p class="eng-bad">✕ ${r.errors.length} error${r.errors.length === 1 ? '' : 's'} against ${api.esc(r.schema)}</p>
             <ul class="eng-errs">${r.errors.map((e) => `<li><code>${api.esc(e.path || '/')}</code> ${api.esc(e.message)}</li>`).join('')}</ul>`;
      } catch (e) { out.innerHTML = `<p class="err">${api.esc(e.message)}</p>`; }
    }

    async function selftest() {
      const box = $('#eng-st');
      box.innerHTML = '<p class="muted">Running…</p>';
      try {
        const r = await api.get('/api/engine/selftest');
        $('#eng-st-badge').innerHTML = api.badge(r.mode);
        box.innerHTML = `<p class="${r.passed === r.total ? 'eng-ok' : 'eng-bad'}">${r.passed}/${r.total} outputs valid · engine: ${api.esc(r.engine.label)}</p>
          <table><thead><tr><th>Output</th><th>Contract</th><th>Result</th></tr></thead><tbody>${r.checks.map((c) => `
            <tr><td>${api.esc(c.name)}</td><td class="mono">${api.esc(c.schema)}</td>
            <td>${c.valid ? '<span class="eng-ok">valid</span>' : `<span class="eng-bad">${api.esc(c.errors.map((e) => `${e.path || '/'} ${e.message}`).join('; '))}</span>`}</td></tr>`).join('')}</tbody></table>
          <details><summary class="muted">Sample adapter output ${api.badge(r.mode)}</summary><pre class="eng-pre">${api.esc(JSON.stringify(r.sample, null, 2))}</pre></details>`;
      } catch (e) { box.innerHTML = `<p class="err">${api.esc(e.message)}</p>`; }
    }

    sel.onchange = loadExample;
    $('#eng-ex').onclick = loadExample;
    $('#eng-go').onclick = run;
    $('#eng-st-run').onclick = selftest;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); });

    if (await loadInfo()) await loadExample();
    setInterval(() => { if (!el.hidden) loadInfo(); }, 20000);
  },
};
