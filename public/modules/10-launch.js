// Launch Your Token: visitor form + live step tracker + recorded-launch replay.
export default {
  id: 'launch', title: 'Launch Your Token', order: 10,
  async mount(el, api) {
    el.innerHTML = `
      <div class="grid">
        <form class="card" id="lf">
          <h2>Launch a Testnet token ${api.badge('LIVE_TESTNET')}</h2>
          <label for="lf-name">Project display name</label><input id="lf-name" name="name" maxlength="40" value="Brooklyn Bullies" required>
          <label for="lf-code">Ticker (3 letters or digits)</label><input id="lf-code" name="code" maxlength="3" pattern="[A-Za-z0-9]{3}" required>
          <label for="lf-supply">Demo supply</label><input id="lf-supply" name="supply" type="number" min="1000" max="1000000000" step="1" value="1000000" required>
          <label for="lf-cat">Project category</label>
          <select id="lf-cat" name="category">
            <option value="community">Community / Gaming</option><option value="currency">Currency / Payments</option>
            <option value="securities">Illustrative Securities</option><option value="real_estate">Illustrative Real Estate</option>
            <option value="precious_metals">Illustrative Precious Metals</option>
          </select>
          <label for="lf-desc">Description (optional)</label><textarea id="lf-desc" name="description" maxlength="280" rows="2"></textarea>
          <label for="lf-alias">Your alias (optional)</label><input id="lf-alias" name="alias" maxlength="24">
          <label style="display:flex;gap:8px;align-items:flex-start;color:var(--ink)"><input type="checkbox" name="consent" style="width:auto;margin-top:4px">
            I understand this creates an unbacked XRPL Testnet token with no monetary value, traded by demo accounts.</label>
          <p id="lf-err" class="err" role="alert"></p>
          <button class="primary" id="lf-go">Launch on Testnet</button>
        </form>
        <div class="card" id="lf-track"><h2>Launch progress</h2><p class="muted">Submit the form to issue a real token on XRPL Testnet and watch each validated transaction.</p></div>
      </div>
      <div class="card"><h2>Launched tokens</h2><div id="lf-list" class="muted">Loading…</div></div>`;

    const form = el.querySelector('#lf'), err = el.querySelector('#lf-err'), track = el.querySelector('#lf-track'), list = el.querySelector('#lf-list');
    let current = null;

    const icon = { pending: '○', running: '◐', done: '●', failed: '✕' };
    function renderTrack(l, mode = 'LIVE_TESTNET') {
      track.innerHTML = `<h2>${api.esc(l.name)} · ${api.esc(l.code)} ${api.badge(mode)}</h2>
        <ol style="list-style:none;padding:0;margin:0">${l.steps.map((s) => `
          <li style="padding:6px 0;border-bottom:1px solid var(--line)">
            <span style="color:${s.status === 'done' ? 'var(--live)' : s.status === 'failed' ? 'var(--bad)' : 'var(--muted)'}">${icon[s.status]}</span> ${api.esc(s.label)}
            ${s.hash ? `<div class="mono"><a href="${api.esc(s.explorer)}" target="_blank" rel="noopener">${api.esc(s.hash.slice(0, 16))}…</a> ${api.esc(s.result)} · ledger ${s.ledger}</div>` : ''}
            ${s.error ? `<div class="err">${api.esc(s.error)}</div>` : ''}
          </li>`).join('')}</ol>
        ${l.status === 'live' ? `<p>Spoke online. ${api.badge(mode)} fill <a class="mono" href="https://testnet.xrpl.org/transactions/${api.esc(l.fillHash)}" target="_blank" rel="noopener">${api.esc(l.fillHash.slice(0, 16))}…</a></p>
          <p class="muted">This fill was made by a demo counterparty. It proves the mechanics, not organic demand.</p>
          <button class="ghost" data-goto="view">See it in Titan View →</button>` : ''}
        ${l.status === 'failed' ? `<p class="err">Launch failed: ${api.esc(l.error)}</p>` : ''}`;
      track.querySelector('[data-goto]')?.addEventListener('click', () => api.show('view'));
    }

    async function refreshList() {
      const all = await api.get('/api/launches').catch(() => []);
      list.innerHTML = all.length ? `<table><thead><tr><th>Token</th><th>Category</th><th>Status</th><th>Fill tx</th><th></th></tr></thead><tbody>${all.slice().reverse().map((l) => `
        <tr><td><b>${api.esc(l.code)}</b> ${api.esc(l.name)}</td><td>${api.esc(l.category)}</td><td>${api.esc(l.status)}</td>
        <td class="mono">${l.fillHash ? `<a href="https://testnet.xrpl.org/transactions/${api.esc(l.fillHash)}" target="_blank" rel="noopener">${api.esc(l.fillHash.slice(0, 12))}…</a>` : ''}</td>
        <td>${l.status === 'live' ? `<button class="ghost" data-replay="${api.esc(l.id)}">Replay</button>` : ''}</td></tr>`).join('')}</tbody></table>` : 'No tokens yet.';
      list.querySelectorAll('[data-replay]').forEach((b) => b.onclick = () => replay(all.find((l) => l.id === b.dataset.replay)));
    }

    // Replays a recorded launch step by step, clearly labeled REPLAY.
    async function replay(rec) {
      const l = { ...rec, status: 'running', steps: rec.steps.map((s) => ({ ...s, status: 'pending' })) };
      for (const s of l.steps) { s.status = 'running'; renderTrack(l, 'REPLAY'); await new Promise((r) => setTimeout(r, 450)); s.status = 'done'; }
      l.status = 'live'; renderTrack(l, 'REPLAY');
    }

    form.onsubmit = async (e) => {
      e.preventDefault(); err.textContent = '';
      const fd = new FormData(form);
      const body = { name: fd.get('name'), code: String(fd.get('code')).toUpperCase(), supply: Number(fd.get('supply')), category: fd.get('category'), description: fd.get('description'), alias: fd.get('alias'), consent: fd.get('consent') === 'on' };
      el.querySelector('#lf-go').disabled = true;
      try { const { id } = await api.post('/api/launch', body); current = id; renderTrack(await api.get(`/api/launches/${id}`)); }
      catch (e2) { err.textContent = (e2.body?.errors || [e2.message]).join(' ') + (e2.body?.replayAvailable ? ' Use Replay below.' : ''); }
      finally { el.querySelector('#lf-go').disabled = false; }
    };

    api.on(async (ev) => {
      if (!ev.type.startsWith('launch.')) return;
      if (ev.launchId === current) renderTrack(await api.get(`/api/launches/${current}`));
      if (ev.type !== 'launch.step') refreshList();
    });
    refreshList();
  },
};
