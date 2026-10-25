// XDLC Protocol: the PROPOSED open XRPL amendment draft (read-only).
// Reads GET /api/xdlc-spec/summary and the whitelisted docs (GET /api/xdlc-spec/doc/:name, text/markdown).
// XDLC is not TG-branded and is not live: draft, not submitted, not reviewed, not implemented in xrpld, not activated.
// Markdown is rendered by a tiny local renderer (headings, lists, tables, code, quotes, links); all text is escaped first.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inline(s) {
  // s is already escaped. Code spans first (protected from further formatting).
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const u = url.replace(/&amp;/g, '&');
    if (!/^(https?:\/\/|#|\.{0,2}\/)/i.test(u) && !/^[\w./-]+\.md(#[\w-]*)?$/.test(u)) return text;
    return /^https?:/i.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${text}</a>` : `<span class="xp-ref" title="${esc(u)}">${text}</span>`;
  });
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function renderMarkdown(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0, para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(esc(para.join(' ')))}</p>`); para = []; } };
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if ((m = line.match(/^\s*(```|~~~)\s*([\w+-]*)/))) {
      flush(); const fence = m[1]; const buf = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
      i++; out.push(`<pre class="xp-code"><code>${esc(buf.join('\n'))}</code></pre>`); continue;
    }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { flush(); const n = Math.min(6, m[1].length + 1); out.push(`<h${n} class="xp-h">${inline(esc(m[2].replace(/\s*#+\s*$/, '')))}</h${n}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush(); const head = cells(line); i += 2; const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<div class="xp-tw"><table><thead><tr>${head.map((h) => `<th>${inline(esc(h))}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, k) => `<td>${inline(esc(r[k] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flush(); const ordered = /^\s*\d/.test(line); const items = [];
      while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const l = lines[i++];
        if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) items.push(l.replace(/^\s*([-*+]|\d+[.)])\s+/, '').replace(/^\[( |x)\]\s+/i, (x) => (/x/i.test(x) ? '☑ ' : '☐ ')));
        else items[items.length - 1] += ' ' + l.trim();
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(esc(t))}</li>`).join('')}</${tag}>`); continue;
    }
    if (/^\s*>/.test(line)) {
      flush(); const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${inline(esc(buf.join(' ')))}</blockquote>`); continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    para.push(line.trim()); i++;
  }
  flush();
  return out.join('\n');
}

// Generic, depth-limited rendering of summary.json (its shape is owned by the spec workstream).
function renderValue(v, depth = 0) {
  if (v == null || v === '') return '<span class="muted">—</span>';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v !== 'object') return inline(esc(String(v)));
  if (depth > 3) return `<span class="mono">${esc(JSON.stringify(v).slice(0, 200))}</span>`;
  if (Array.isArray(v)) return v.length ? `<ul>${v.map((x) => `<li>${renderValue(x, depth + 1)}</li>`).join('')}</ul>` : '<span class="muted">none</span>';
  return `<dl class="xp-dl">${Object.entries(v).map(([k, x]) => `<dt>${esc(k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' '))}</dt><dd>${renderValue(x, depth + 1)}</dd>`).join('')}</dl>`;
}

const STYLE = `
.xp .xp-strip { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; padding: 14px 16px; border-radius: 10px; border: 2px dashed var(--sim); background: var(--sim-bg); margin-bottom: 16px; }
.xp .xp-strip b { font-size: 17px; }
.xp .xp-flags { display: flex; flex-wrap: wrap; gap: 6px; }
.xp .xp-flag { font: 600 12px var(--mono); padding: 3px 8px; border-radius: 999px; border: 1px solid var(--sim); color: var(--sim); background: var(--panel); white-space: nowrap; }
.xp .xp-docs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.xp .xp-docs button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
.xp .xp-md { overflow-wrap: anywhere; min-width: 0; }
.xp .xp-md .xp-h { margin: 18px 0 8px; } .xp .xp-md h2.xp-h { font-size: 20px; }
.xp .xp-md code { font-family: var(--mono); font-size: 12px; background: var(--bg); padding: 1px 4px; border-radius: 4px; }
.xp .xp-md pre.xp-code { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px; overflow-x: auto; max-width: 100%; }
.xp .xp-md pre.xp-code code { background: none; padding: 0; white-space: pre; }
.xp .xp-md blockquote { margin: 8px 0; padding: 6px 12px; border-left: 3px solid var(--accent); background: var(--bg); }
.xp .xp-md .xp-tw { max-width: 100%; overflow-x: auto; }
.xp .xp-ref { text-decoration: underline dotted; }
.xp .xp-dl { display: grid; grid-template-columns: minmax(120px, max-content) minmax(0, 1fr); gap: 4px 12px; margin: 4px 0; }
.xp .xp-dl dt { color: var(--muted); text-transform: capitalize; } .xp .xp-dl dd { margin: 0; min-width: 0; }
@media (max-width: 600px) { .xp .xp-dl { grid-template-columns: minmax(0, 1fr); } .xp .xp-dl dt { margin-top: 6px; } }
`;

export const STATUS_TEXT = 'Draft — not submitted, not reviewed, not implemented in xrpld, not activated';

export default {
  id: 'xdlc-protocol', title: 'XDLC Protocol', order: 45,
  async mount(el, api) {
    const e = api.esc;
    if (!document.getElementById('xp-style')) { const s = document.createElement('style'); s.id = 'xp-style'; s.textContent = STYLE; document.head.append(s); }
    el.classList.add('xp');
    el.innerHTML = `
      <div class="xp-strip" role="status"><span class="badge prop">PROPOSED</span><b>${e(STATUS_TEXT)}</b>
        <span class="xp-flags"><span class="xp-flag">submitted: no</span><span class="xp-flag">reviewed: no</span><span class="xp-flag">in xrpld: no</span><span class="xp-flag">activated: no</span></span></div>
      <div class="card">
        <h2>XDLC: XRPL Dynamic Liquidity Corridors (proposed open amendment)</h2>
        <p>XDLC is a <b>proposed</b> open XRPL amendment drafted during the Oct 24–25 hackathon. It is not XRPL-native today: the corridor lifecycle you see elsewhere in this app is Titan Ghost application logic, and XRP auto-bridging is the existing XRPL feature. XDLC is not a Titan Ghost (TG) product name.</p>
        <div id="xp-summary" class="muted">Loading draft summary…</div>
      </div>
      <div class="card"><h2>Draft documents</h2><div class="xp-docs" id="xp-docs"></div><div id="xp-doc" class="xp-md muted"></div></div>`;
    const $ = (s) => el.querySelector(s);
    let data;
    try { data = await api.get('/api/xdlc-spec/summary'); }
    catch (err) { $('#xp-summary').innerHTML = `<p><b>Draft in progress.</b> The spec service isn't answering yet (${e(err.message)}).</p>`; $('#xp-doc').textContent = 'Draft in progress.'; return; }
    if (data.status?.text) el.querySelector('.xp-strip b').textContent = data.status.text;
    $('#xp-summary').classList.remove('muted');
    const PRIMARY = ['title', 'xls', 'category', 'authors', 'status', 'modelVersion', 'amendmentNecessaryFor', 'candidateLedgerEntries', 'candidateTransactions', 'newResultCodes', 'stages'];
    const sm = data.summary || {};
    const pick = (keep) => Object.fromEntries(Object.entries(sm).filter(([k]) => keep === PRIMARY.includes(k) && k !== 'docs'));
    $('#xp-summary').innerHTML = data.summary ? `${renderValue(pick(true))}<details style="margin-top:8px"><summary>More of the draft model (caps, invariants, gap analysis, vectors, references)</summary>${renderValue(pick(false))}</details>` : '<p class="muted"><b>Draft in progress.</b> The summary (lib/xdlc-spec/summary.json) has not been written yet.</p>';
    const docs = data.docs || [];
    if (!docs.length) { $('#xp-doc').innerHTML = '<p><b>Draft in progress.</b> No XDLC draft documents are published on this node yet.</p>'; return; }
    $('#xp-docs').innerHTML = docs.map((d, k) => `<button type="button" class="ghost" data-doc="${e(d.name)}" aria-pressed="${k === 0}">${e(d.name.replace(/^XDLC_/, '').replace(/\.md$/, '').replace(/_/g, ' '))}</button>`).join('');
    const load = async (name) => {
      for (const b of el.querySelectorAll('[data-doc]')) b.setAttribute('aria-pressed', String(b.dataset.doc === name));
      $('#xp-doc').classList.add('muted'); $('#xp-doc').textContent = 'Loading…';
      try {
        const r = await fetch(`/api/xdlc-spec/doc/${encodeURIComponent(name)}`);
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
        $('#xp-doc').classList.remove('muted');
        $('#xp-doc').innerHTML = `<p class="muted mono">docs/${e(name)} · draft</p>${renderMarkdown(await r.text())}`;
      } catch (err) { $('#xp-doc').innerHTML = `<p><b>Draft in progress.</b> ${e(err.message)}</p>`; }
    };
    $('#xp-docs').addEventListener('click', (ev) => { const b = ev.target.closest('[data-doc]'); if (b) load(b.dataset.doc); });
    load(docs[0].name);
    window.addEventListener('tf:present', (ev) => { if (ev.detail?.scene === 'protocol') el.querySelector('.xp-strip')?.scrollIntoView({ block: 'start' }); });
  },
};
