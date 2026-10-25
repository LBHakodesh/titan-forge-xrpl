// XDLC proposed-amendment draft (read-only).
//   GET /api/xdlc-spec/summary     lib/xdlc-spec/summary.json (or {available:false} while the draft is being written)
//   GET /api/xdlc-spec/doc/:name   one of at most FOUR whitelisted docs/XDLC_*.md files, served as text/markdown
// XDLC is a PROPOSED open XRPL amendment: not submitted, not reviewed, not implemented in xrpld, not activated.
// Nothing here signs, submits or touches the network. Doc names are matched against a strict pattern and a
// whitelist built from the docs/ directory listing (never joined from user input), so no path traversal is possible.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SUMMARY_FILE = path.join(ROOT, 'lib', 'xdlc-spec', 'summary.json');
export const DOCS_DIR = path.join(ROOT, 'docs');
export const DOC_PATTERN = /^XDLC_[A-Z0-9_]{1,48}\.md$/;
export const MAX_DOCS = 4;
// The four draft documents (also declared in summary.json "docs"); used when the summary is missing.
export const PREFERRED = ['XDLC_AMENDMENT_PROPOSAL.md', 'XDLC_PROTOCOL_GAP_ANALYSIS.md', 'XDLC_SECURITY_INVARIANTS.md', 'XDLC_DETERMINISTIC_TESTS.md'];
export const STATUS = Object.freeze({
  label: 'PROPOSED',
  text: 'Draft — not submitted, not reviewed, not implemented in xrpld, not activated',
  submitted: false, reviewed: false, implementedInXrpld: false, activated: false,
});

export function normalizeName(name) {
  const n = String(name ?? '').trim();
  return n.endsWith('.md') ? n : `${n}.md`;
}

export function readSummary(file = SUMMARY_FILE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// Names the summary declares (strings or {file|name|path}), validated against DOC_PATTERN.
export function declaredDocs(summary) {
  const list = Array.isArray(summary?.docs) ? summary.docs : [];
  return list.map((d) => (typeof d === 'string' ? d : d?.file || d?.name || d?.path || ''))
    .map((s) => path.basename(String(s))).filter((s) => DOC_PATTERN.test(s));
}

// The whitelist: at most MAX_DOCS names that match DOC_PATTERN and exist in docs/.
// Summary-declared names first, then PREFERRED, then remaining XDLC_*.md files alphabetically.
export function allowedDocs({ summary = readSummary(), present = listPresent() } = {}) {
  const have = new Set(present.filter((f) => DOC_PATTERN.test(f)));
  const order = [...declaredDocs(summary), ...PREFERRED, ...[...have].sort()];
  const out = [];
  for (const n of order) if (have.has(n) && !out.includes(n) && out.length < MAX_DOCS) out.push(n);
  return out;
}

export function listPresent(dir = DOCS_DIR) {
  try { return fs.readdirSync(dir).filter((f) => DOC_PATTERN.test(f)); } catch { return []; }
}

export function isAllowedDoc(name, allowed) {
  const n = normalizeName(name);
  return DOC_PATTERN.test(n) && allowed.includes(n);
}

export function register(app, ctx) {
  const { json } = ctx;

  app.get('/api/xdlc-spec/summary', (req, res) => {
    const summary = readSummary();
    const docs = allowedDocs({ summary }).map((name) => {
      let bytes = 0; try { bytes = fs.statSync(path.join(DOCS_DIR, name)).size; } catch {}
      return { name, bytes, url: `/api/xdlc-spec/doc/${encodeURIComponent(name)}` };
    });
    json(res, 200, {
      available: !!summary, draftInProgress: !summary || docs.length === 0,
      status: STATUS, summary, docs, readOnly: true,
      note: summary ? null : 'Draft in progress: lib/xdlc-spec/summary.json has not been written yet.',
    });
  });

  app.get('/api/xdlc-spec/doc/:name', (req, res, { name }) => {
    const allowed = allowedDocs();
    if (!isAllowedDoc(name, allowed)) return json(res, 404, { error: 'Not a whitelisted XDLC draft document', allowed });
    const file = path.join(DOCS_DIR, normalizeName(name));
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return json(res, 404, { error: 'Draft in progress: document not written yet', allowed }); }
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(text);
  });
}
