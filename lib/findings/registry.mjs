// Titan Sentinel unified findings registry.
// Observes and recommends ONLY: nothing in lib/findings signs, submits, pays, moves liquidity, cancels offers,
// changes permissions or disables services. The registry holds no ledger handle at all.
//
// Integrity model
//  - Every mutation appends an entry to the finding's history[]. Entries form ONE global SHA-256 hash chain
//    (seq 1..N, prevHash -> hash) across all findings, so a deleted finding or entry leaves a gap.
//  - Each entry carries stateHash = SHA-256 of the finding (without history) right after the change, so an
//    edited field, a removed evidence item or a rewritten provenance is detected by verify().
//  - Limits: the chain head lives in the same file. Someone who rewrites the whole file and recomputes every
//    hash defeats it; anchor head.hash somewhere else (the findings.* bus events carry it) to detect that.
import crypto from 'node:crypto';
import fs from 'node:fs';

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
export const VERIFICATIONS = ['CONFIRMED', 'SUSPECTED', 'SIMULATED', 'INFORMATIONAL', 'UNVERIFIED_EXTERNAL'];
export const PROVENANCES = ['LIVE_TESTNET', 'MAINNET_OBSERVED_READ_ONLY', 'REPLAY', 'SIMULATION', 'UNAVAILABLE'];
export const STATUSES = ['open', 'investigating', 'mitigation-proposed', 'resolved', 'accepted'];
export const CLOSED_STATUSES = new Set(['resolved', 'accepted']);
export const REAL_PROVENANCES = new Set(['LIVE_TESTNET', 'MAINNET_OBSERVED_READ_ONLY']);
export const SIM_PROVENANCES = new Set(['SIMULATION', 'REPLAY']);
export const GENESIS = '0'.repeat(64);
const TESTNET_TX = 'https://testnet.xrpl.org/transactions/';
const TESTNET_ACCT = 'https://testnet.xrpl.org/accounts/';

// Fields an operator may change through update(). Identity, provenance, source and firstSeen are immutable.
const MUTABLE = new Set(['status', 'severity', 'owner', 'verification', 'confidence', 'impact', 'remediation', 'rootCause', 'facets', 'title', 'observed', 'expected', 'actual', 'affected', 'product', 'market', 'lastSeen']);

// ---------- Hashing ----------
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export function canonical(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
export const fingerprintOf = (key, provenance) => sha256(`${key}|${provenance}`).slice(0, 32);
export function stateHash(f) { const { history, ...rest } = f; return sha256(canonical(rest)); }
export function entryHash(e) { const { hash, ...rest } = e; return sha256(canonical(rest)); }

// ---------- Redaction ----------
// Anything resembling key material is removed before it is stored or hashed.
const SECRET_KEY = /seed|secret|mnemonic|passphrase|private.?key|signed.?tx.?blob|tx_?blob|signed.?payload|^blob$|^signature$/i;
const SEED_RE = /\bs[1-9A-HJ-NP-Za-km-z]{24,34}\b/g;               // XRPL family seeds (s…, sEd…)
const PRIVKEY_RE = /\b(?:00|ED)[0-9A-Fa-f]{64}\b/g;                   // 33-byte XRPL private keys (tx hashes are 32 bytes: kept)
const BLOB_RE = /\b[0-9A-Fa-f]{200,}\b/g;                              // signed transaction blobs
const INLINE_RE = /\b(secret|seed|private[ _-]?key|signedTxBlob|tx_blob|mnemonic)(\s*["']?\s*[:=]\s*["']?)([^\s"',}]+)/gi;
export function redactString(s) {
  return String(s).replace(INLINE_RE, (m, k, sep) => `${k}${sep}[redacted]`).replace(BLOB_RE, '[redacted-blob]').replace(PRIVKEY_RE, '[redacted-key]').replace(SEED_RE, '[redacted-seed]');
}
export function redact(v, depth = 0) {
  if (depth > 12) return '[truncated]';
  if (typeof v === 'string') return redactString(v);
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(x, depth + 1);
    return out;
  }
  return v;
}

// ---------- Evidence ----------
// { kind: tx|ledger|file|run|account|endpoint|metric|context|report, ref, detail?, url?, provenance?, at? }
export function normalizeEvidence(e, provenance) {
  if (!e || typeof e !== 'object' || e.ref == null || String(e.ref).trim() === '') return null;
  const ev = redact({ kind: String(e.kind || 'context'), ref: String(e.ref), detail: e.detail ?? null, provenance: e.provenance || provenance, at: e.at ?? null, url: e.url ?? null });
  if (!ev.url && ev.provenance === 'LIVE_TESTNET' && ev.kind === 'tx' && /^[0-9A-F]{64}$/i.test(ev.ref)) ev.url = TESTNET_TX + ev.ref.toUpperCase();
  if (!ev.url && ev.provenance === 'LIVE_TESTNET' && ev.kind === 'account' && /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(ev.ref)) ev.url = TESTNET_ACCT + ev.ref;
  if (ev.url && !/^https:\/\//.test(ev.url)) ev.url = null;
  return ev;
}
const evKey = (e) => `${e.kind}|${e.ref}`;

function assertEnum(name, v, list) { if (!list.includes(v)) throw new Error(`${name} must be one of ${list.join(', ')} (got ${v})`); }

// ---------- Registry ----------
export class FindingsRegistry {
  // file: JSON path or null (memory only). bus: { publish(type, mode, payload) } or null. now: () => ms.
  constructor({ file = null, persist = !!file, bus = null, now = () => Date.now(), log = () => {} } = {}) {
    this.file = file; this.persist = persist; this.bus = bus; this.now = now; this.log = log;
    this.findings = new Map(); this.byFp = new Map();
    this.nextId = 1; this.head = { seq: 0, hash: GENESIS };
    this.eventsSuppressed = 0; this.loadError = null;
    if (file && fs.existsSync(file)) this.load();
  }

  load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const f of d.findings || []) { this.findings.set(f.id, f); this.byFp.set(f.fingerprint, f.id); }
      this.nextId = d.nextId || this.findings.size + 1;
      this.head = d.head || this.head;
    } catch (e) { this.loadError = e.message; this.log(`load failed: ${e.message}`); }
  }

  save() {
    if (!this.persist || !this.file) return;
    const body = { version: 1, note: 'Titan Sentinel findings registry. Append-only history with a SHA-256 hash chain; verify with GET /api/findings/verify. Observes and recommends only.', nextId: this.nextId, head: this.head, savedAt: new Date(this.now()).toISOString(), findings: [...this.findings.values()] };
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(body, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
  }

  iso() { return new Date(this.now()).toISOString(); }

  append(f, action, detail, actor) {
    const e = { seq: this.head.seq + 1, at: this.iso(), findingId: f.id, action, actor: String(actor || 'system').slice(0, 80), detail: redact(detail ?? null), stateHash: stateHash(f), prevHash: this.head.hash };
    e.hash = entryHash(e);
    f.history.push(e);
    this.head = { seq: e.seq, hash: e.hash };
    return e;
  }

  emit(type, f, extra = {}) {
    if (!this.bus) return;
    const mode = f.provenance === 'MAINNET_OBSERVED_READ_ONLY' ? 'MAINNET_OBSERVED' : f.provenance;
    try {
      this.bus.publish(type, mode, { findingId: f.id, title: f.title, severity: f.severity, category: f.category, product: f.product, market: f.market, verification: f.verification, provenance: f.provenance, status: f.status, count: f.count, head: this.head.hash, ...extra });
    } catch (e) { this.eventsSuppressed++; } // e.g. bus rejects mode UNAVAILABLE: the registry entry still exists
  }

  // Record an observation. Idempotent per (fingerprint, occurrence): re-collecting the same source is a no-op.
  // A new occurrence of a known fingerprint is a recurrence: count+1, lastSeen, evidence appended, history appended.
  record(input, { actor = 'collector' } = {}) {
    const x = redact(input || {});
    if (!x.key) throw new Error('finding key required');
    if (!x.title) throw new Error('finding title required');
    assertEnum('severity', x.severity, SEVERITIES);
    assertEnum('verification', x.verification, VERIFICATIONS);
    assertEnum('provenance', x.provenance, PROVENANCES);
    const fp = fingerprintOf(x.key, x.provenance);
    const occurrence = String(x.occurrence ?? 'default');
    const seenAt = x.seenAt || this.iso();
    const rawEv = Array.isArray(x.evidence) ? x.evidence : [];
    const evidence = rawEv.map((e) => normalizeEvidence(e, x.provenance)).filter(Boolean);
    const dropped = rawEv.length - evidence.length;
    const existingId = this.byFp.get(fp);

    if (!existingId) {
      let verification = x.verification; const notes = [];
      if (verification === 'CONFIRMED' && !evidence.length) { verification = 'SUSPECTED'; notes.push('CONFIRMED requires evidence; none supplied, recorded as SUSPECTED.'); }
      if (dropped) notes.push(`${dropped} malformed evidence item(s) without a ref were dropped.`);
      const f = {
        id: `TS-${String(this.nextId++).padStart(4, '0')}`, fingerprint: fp, key: x.key,
        title: x.title, category: x.category || 'general', product: x.product || 'Unassigned', market: x.market || '—',
        severity: x.severity, severityBasis: x.severityBasis || 'assessed', verification, provenance: x.provenance,
        source: x.source || 'unknown', sources: [x.source || 'unknown'], environment: x.environment || 'unknown',
        firstSeen: x.firstSeen || seenAt, lastSeen: seenAt, count: 1, occurrences: [occurrence],
        observed: x.observed || '', expected: x.expected || '', actual: x.actual || '',
        facets: Array.isArray(x.facets) ? x.facets : [], rootCause: x.rootCause || null,
        affected: x.affected || {}, confidence: x.confidence || 'medium', impact: x.impact || '',
        remediation: x.remediation || null, owner: x.owner || 'unassigned', status: x.status && STATUSES.includes(x.status) ? x.status : 'open',
        educational: x.educational || null, links: Array.isArray(x.links) ? x.links : [],
        evidenceStatus: evidence.length ? 'present' : 'missing', evidenceNote: x.evidenceNote || (evidence.length ? null : 'No evidence attached.'),
        evidence, notes: [], history: [],
      };
      this.findings.set(f.id, f); this.byFp.set(fp, f.id);
      this.append(f, 'recorded', { occurrence, source: f.source, evidenceAdded: evidence.map(evKey), notes }, actor);
      this.save(); this.emit('findings.recorded', f);
      return { finding: f, created: true, changed: true };
    }

    const f = this.findings.get(existingId);
    if (f.occurrences.includes(occurrence)) {
      // Same occurrence seen again: only add evidence that is genuinely new (never remove any).
      const fresh = evidence.filter((e) => !f.evidence.some((o) => evKey(o) === evKey(e)));
      if (!fresh.length) return { finding: f, created: false, changed: false };
      f.evidence.push(...fresh); f.evidenceStatus = 'present';
      this.append(f, 'evidence_added', { occurrence, source: x.source, evidenceAdded: fresh.map(evKey) }, actor);
      this.save(); this.emit('findings.updated', f, { change: 'evidence_added' });
      return { finding: f, created: false, changed: true };
    }
    // Recurrence
    const fresh = evidence.filter((e) => !f.evidence.some((o) => evKey(o) === evKey(e)));
    const changes = {};
    f.count += 1; f.occurrences.push(occurrence);
    if (!f.lastSeen || seenAt > f.lastSeen) f.lastSeen = seenAt;
    if (x.firstSeen && x.firstSeen < f.firstSeen) { changes.firstSeen = { from: f.firstSeen, to: x.firstSeen }; f.firstSeen = x.firstSeen; }
    if (x.source && !f.sources.includes(x.source)) f.sources.push(x.source);
    f.evidence.push(...fresh); if (f.evidence.length) f.evidenceStatus = 'present';
    // Descriptive fields follow the latest observation; severity escalates automatically but never silently drops.
    for (const k of ['observed', 'actual']) if (x[k] && x[k] !== f[k]) { changes[k] = { from: f[k], to: x[k] }; f[k] = x[k]; }
    if (SEVERITIES.indexOf(x.severity) < SEVERITIES.indexOf(f.severity)) { changes.severity = { from: f.severity, to: x.severity, reason: 'recurrence observed at higher severity' }; f.severity = x.severity; }
    if (CLOSED_STATUSES.has(f.status)) { changes.status = { from: f.status, to: 'open', reason: 'recurred after closure' }; f.status = 'open'; }
    this.append(f, 'recurred', { occurrence, source: x.source, count: f.count, evidenceAdded: fresh.map(evKey), changes }, actor);
    this.save(); this.emit('findings.updated', f, { change: 'recurred' });
    return { finding: f, created: false, changed: true };
  }

  // Operator/agent change. Never touches evidence, provenance, id, fingerprint, source or firstSeen.
  update(id, patch = {}, { actor = 'operator', note = '' } = {}) {
    const f = this.findings.get(id);
    if (!f) throw new Error(`Unknown finding ${id}`);
    const p = redact(patch);
    const bad = Object.keys(p).filter((k) => !MUTABLE.has(k));
    if (bad.length) throw new Error(`Immutable or unknown field(s): ${bad.join(', ')}`);
    if (p.status !== undefined) assertEnum('status', p.status, STATUSES);
    if (p.severity !== undefined) assertEnum('severity', p.severity, SEVERITIES);
    if (p.verification !== undefined) assertEnum('verification', p.verification, VERIFICATIONS);
    if ((p.severity !== undefined && p.severity !== f.severity) && !String(note).trim()) throw new Error('A note (reason) is required to change severity');
    if (p.verification === 'CONFIRMED' && !f.evidence.length) throw new Error('CONFIRMED requires at least one evidence item');
    const changes = {};
    for (const [k, v] of Object.entries(p)) if (canonical(f[k]) !== canonical(v)) { changes[k] = { from: f[k], to: v }; f[k] = v; }
    if (!Object.keys(changes).length) return { finding: f, changed: false };
    this.append(f, Object.keys(changes).length === 1 ? `${Object.keys(changes)[0]}_changed` : 'updated', { changes, note: redactString(String(note).slice(0, 2000)) }, actor);
    this.save(); this.emit('findings.updated', f, { change: Object.keys(changes).join(',') });
    return { finding: f, changed: true };
  }

  addNote(id, note, { actor = 'operator' } = {}) {
    const f = this.findings.get(id);
    if (!f) throw new Error(`Unknown finding ${id}`);
    const text = redactString(String(note || '').trim().slice(0, 2000));
    if (!text) throw new Error('Empty note');
    f.notes.push({ at: this.iso(), actor: String(actor).slice(0, 80), text });
    this.append(f, 'note_added', { text }, actor);
    this.save(); this.emit('findings.updated', f, { change: 'note_added' });
    return f;
  }

  addEvidence(id, items, { actor = 'operator' } = {}) {
    const f = this.findings.get(id);
    if (!f) throw new Error(`Unknown finding ${id}`);
    const fresh = (Array.isArray(items) ? items : [items]).map((e) => normalizeEvidence(e, f.provenance)).filter(Boolean).filter((e) => !f.evidence.some((o) => evKey(o) === evKey(e)));
    if (!fresh.length) return { finding: f, changed: false };
    f.evidence.push(...fresh); f.evidenceStatus = 'present';
    this.append(f, 'evidence_added', { evidenceAdded: fresh.map(evKey) }, actor);
    this.save(); this.emit('findings.updated', f, { change: 'evidence_added' });
    return { finding: f, changed: true };
  }

  // Root-cause hook (e.g. Pathfinder NO_PATH diagnosis). Updates the rootCause facet without touching occurrence facts.
  setRootCause(idOrKey, { summary, verification = 'SUSPECTED', evidence = [], actor = 'diagnosis' } = {}) {
    const f = this.get(idOrKey) || [...this.findings.values()].find((x) => x.key === idOrKey);
    if (!f) throw new Error(`Unknown finding ${idOrKey}`);
    assertEnum('verification', verification, VERIFICATIONS);
    if (evidence.length) this.addEvidence(f.id, evidence, { actor });
    if (verification === 'CONFIRMED' && !evidence.length) throw new Error('A CONFIRMED root cause needs evidence');
    const facets = (f.facets || []).filter((x) => x.facet !== 'rootCause').concat([{ facet: 'rootCause', verification, detail: redactString(String(summary || '').slice(0, 2000)) }]);
    return this.update(f.id, { rootCause: { summary: redactString(String(summary || '').slice(0, 2000)), verification, at: this.iso(), by: actor }, facets }, { actor, note: `Root cause set (${verification}).` });
  }

  get(id) { return this.findings.get(id) || null; }
  all() { return [...this.findings.values()]; }

  list(q = {}) {
    const eq = (a, b) => !b || String(a).toLowerCase() === String(b).toLowerCase();
    const text = String(q.q || '').toLowerCase();
    return this.all().filter((f) => eq(f.severity, q.severity) && eq(f.category, q.category) && eq(f.product, q.product) && eq(f.market, q.market)
      && eq(f.status, q.status) && eq(f.verification, q.verification) && eq(f.provenance, q.provenance)
      && (!text || `${f.id} ${f.title} ${f.observed} ${f.product} ${f.market}`.toLowerCase().includes(text)))
      .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.id.localeCompare(b.id));
  }

  verify() {
    const problems = [];
    const entries = this.all().flatMap((f) => f.history.map((e) => ({ e, f })));
    entries.sort((a, b) => a.e.seq - b.e.seq);
    let prev = GENESIS;
    entries.forEach(({ e, f }, i) => {
      if (e.seq !== i + 1) problems.push({ seq: e.seq, findingId: f.id, problem: `sequence gap: expected ${i + 1}` });
      if (e.findingId !== f.id) problems.push({ seq: e.seq, findingId: f.id, problem: 'entry filed under a different finding' });
      if (e.prevHash !== prev) problems.push({ seq: e.seq, findingId: f.id, problem: 'prevHash does not link to the previous entry' });
      if (entryHash(e) !== e.hash) problems.push({ seq: e.seq, findingId: f.id, problem: 'entry hash mismatch (entry edited)' });
      prev = e.hash;
    });
    for (const f of this.all()) {
      const last = f.history[f.history.length - 1];
      if (!last) { problems.push({ findingId: f.id, problem: 'finding has no history' }); continue; }
      if (last.stateHash !== stateHash(f)) problems.push({ findingId: f.id, problem: 'current state differs from the last hashed state (field or evidence edited outside the registry)' });
      if (f.fingerprint !== fingerprintOf(f.key, f.provenance)) problems.push({ findingId: f.id, problem: 'fingerprint does not match key/provenance (provenance rewritten?)' });
    }
    const lastSeq = entries.length ? entries[entries.length - 1].e.seq : 0;
    if (lastSeq !== this.head.seq || prev !== this.head.hash) problems.push({ problem: `chain head mismatch (head seq ${this.head.seq}, last entry ${lastSeq}): entries truncated or head edited` });
    return { ok: problems.length === 0, algorithm: 'SHA-256 over canonical JSON; global chain across all findings', entries: entries.length, findings: this.findings.size, head: this.head, problems, limits: 'Head is stored with the data. A full rewrite with recomputed hashes is only detectable against an external copy of head.hash (published on findings.* events).' };
  }
}
