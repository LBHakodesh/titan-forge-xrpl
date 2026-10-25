// Application-level XDLC corridor lifecycle (Titan Ghost APPLICATION LOGIC, not XRPL consensus).
// XDLC is a PROPOSED XRPL amendment and is not live; XRP auto-bridging is the existing XRPL feature. Nothing here signs,
// submits or moves funds. Every transition is a SIMULATION record unless it cites a real, already-recorded Testnet hash.
//
// Pure core: transition(corridor, request, opts) -> { ok, reasons[], record?, corridor? } (never mutates its inputs).
// Deterministic: same corridor + request + clock -> same record and hash. Records are hash-chained (sha256 over the
// canonical JSON of the record, which includes the previous record's hash).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MODES } from '../../public/domain.js';
import { guardCheck } from '../guardian.mjs';

export const STATES = Object.freeze([
  'DISCOVERY', 'OPPORTUNITY_EVALUATION', 'PROJECT_REQUEST', 'CAPITAL_STRUCTURE', 'APPROVAL_PENDING', 'BOOTSTRAPPING', 'ACTIVE',
  'REINFORCED', 'MATURE', 'SUPPORT_REDUCTION', 'CAPITAL_AVAILABLE', 'REDEPLOYMENT_RECOMMENDED', 'APPROVED_REDEPLOYMENT', 'NEW_CORRIDOR_ACTIVE',
]);
export const STATE_LABELS = Object.freeze({
  DISCOVERY: 'Discovery', OPPORTUNITY_EVALUATION: 'Opportunity evaluation', PROJECT_REQUEST: 'Project request', CAPITAL_STRUCTURE: 'Capital structure',
  APPROVAL_PENDING: 'Approval pending', BOOTSTRAPPING: 'Bootstrapping', ACTIVE: 'Active', REINFORCED: 'Reinforced', MATURE: 'Mature',
  SUPPORT_REDUCTION: 'Support reduction', CAPITAL_AVAILABLE: 'Capital available', REDEPLOYMENT_RECOMMENDED: 'Redeployment recommended',
  APPROVED_REDEPLOYMENT: 'Approved redeployment', NEW_CORRIDOR_ACTIVE: 'New corridor active',
});
// Strictly sequential: the only legal move is to the next state.
export const NEXT = Object.freeze(Object.fromEntries(STATES.map((s, i) => [s, STATES[i + 1] ?? null])));
// States whose entry requires an explicit human operator approval flag (never set by the server) + a Guardian verdict.
export const APPROVAL_REQUIRED = Object.freeze(['BOOTSTRAPPING', 'SUPPORT_REDUCTION', 'APPROVED_REDEPLOYMENT']);
export const FUNDING_KEYS = Object.freeze(['requestedUsd', 'committedUsd', 'fundedUsd', 'executableUsd']);
export const ORIGINS = Object.freeze(['RADAR_DISCOVERED', 'PROJECT_REQUESTED']);
export const GENESIS = '0'.repeat(64);
export const STATEMENT = 'Corridor lifecycle is Titan Ghost application logic. XDLC is a proposed XRPL amendment, not live. Records are SIMULATION unless a real recorded Testnet hash is cited.';

// ---------- canonical hashing ----------
export function canonical(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export function recordHash(rec) { const { hash, ...rest } = rec; return sha256(canonical(rest)); }

export function verifyChain(log = []) {
  let prev = GENESIS;
  for (let i = 0; i < log.length; i++) {
    const r = log[i];
    if (r.prevHash !== prev) return { ok: false, at: i, reason: `record ${i} prevHash does not match previous hash` };
    if (recordHash(r) !== r.hash) return { ok: false, at: i, reason: `record ${i} hash mismatch (tampered)` };
    prev = r.hash;
  }
  return { ok: true, length: log.length, head: prev };
}

// ---------- funding (four categories, never merged) ----------
export const emptyFunding = () => ({ requestedUsd: 0, committedUsd: 0, fundedUsd: 0, executableUsd: 0 });
export function checkFunding(f) {
  const v = [];
  for (const k of Object.keys(f)) if (!FUNDING_KEYS.includes(k)) v.push(`Unknown funding category "${k}" (allowed: ${FUNDING_KEYS.join(', ')}; categories are never merged).`);
  for (const k of FUNDING_KEYS) if (!(Number.isFinite(f[k]) && f[k] >= 0)) v.push(`${k} must be a non-negative number.`);
  if (!v.length) {
    if (f.committedUsd > f.requestedUsd) v.push('committedUsd cannot exceed requestedUsd.');
    if (f.fundedUsd > f.committedUsd) v.push('fundedUsd cannot exceed committedUsd.');
    if (f.executableUsd > f.fundedUsd) v.push('executableUsd cannot exceed fundedUsd.');
  }
  return v;
}

// ---------- guards ----------
const ev = (r) => r.evidence || {};
const num = (x) => Number.isFinite(x);
export const GUARDS = Object.freeze({
  OPPORTUNITY_EVALUATION: (r) => (num(ev(r).radarScore) || ev(r).radarId ? [] : ['Evidence must cite a radar entry (radarId or radarScore).']),
  PROJECT_REQUEST: (r, c) => {
    const o = [];
    if (!ORIGINS.includes(ev(r).origin || c.origin)) o.push(`Origin must be one of ${ORIGINS.join(', ')}.`);
    const n = ev(r).netBenefitUsd;
    if (!n || !num(n.base)) o.push('Evidence must include the modeled net benefit range (netBenefitUsd {low, base, high}).');
    else if (n.base <= 0) o.push(`Modeled base-case net benefit is $${n.base} (≤ 0): a thin market is not automatically profitable.`);
    return o;
  },
  CAPITAL_STRUCTURE: (r, c, f) => (f.requestedUsd > 0 ? [] : ['A capital request (requestedUsd > 0) is required.']),
  APPROVAL_PENDING: (r, c, f) => {
    const o = [];
    if (!(f.committedUsd > 0)) o.push('Committed capital (committedUsd > 0) is required before requesting approval.');
    const src = ev(r).sources;
    if (!src || typeof src !== 'object') o.push('Evidence must list capital sources.');
    else for (const k of ['T1', 'T2', 'T3']) if (src[k]?.reallocatable) o.push(`${k} capital can never be marked reallocatable by Titan Ghost.`);
    return o;
  },
  BOOTSTRAPPING: (r, c, f) => (f.fundedUsd > 0 ? [] : ['Funded capital (fundedUsd > 0) is required to bootstrap.']),
  ACTIVE: (r, c, f) => (f.executableUsd > 0 ? (ev(r).offersPlaced > 0 || ev(r).ledgerHash ? [] : ['Evidence must show offers placed (offersPlaced) or cite a recorded ledger hash.']) : ['Executable capital (executableUsd > 0) is required.']),
  REINFORCED: (r) => (num(ev(r).independentShare) && ev(r).independentShare >= 0.3 ? [] : ['Independent (non-Titan) liquidity share ≥ 0.30 required.']),
  MATURE: (r) => (num(ev(r).independentShare) && ev(r).independentShare >= 0.6 && num(ev(r).persistence) && ev(r).persistence >= 0.75 ? [] : ['Independent share ≥ 0.60 and persistence ≥ 0.75 required.']),
  SUPPORT_REDUCTION: (r) => (num(ev(r).releasableUsd) && ev(r).releasableUsd > 0 ? [] : ['Estimated releasable proprietary capital (releasableUsd > 0) required.']),
  CAPITAL_AVAILABLE: (r) => (ev(r).availableBalanceVerified === true ? [] : ['Available-balance verification required (availableBalanceVerified: true).']),
  REDEPLOYMENT_RECOMMENDED: (r) => (ev(r).destinationMarketId ? [] : ['A destination market (destinationMarketId) from the radar is required.']),
  APPROVED_REDEPLOYMENT: () => [],
  NEW_CORRIDOR_ACTIVE: (r) => (num(ev(r).destinationFundedUsd) && ev(r).destinationFundedUsd > 0 ? [] : ['Destination funding (destinationFundedUsd > 0) required.']),
});

function riskAssessment(r) {
  const items = Array.isArray(ev(r).risks) ? ev(r).risks.map(String) : [];
  const level = ev(r).riskLevel || (items.length >= 3 ? 'elevated' : items.length ? 'moderate' : 'low');
  return { level, items, mode: MODES.SIM };
}

// The only evidence of a real ledger action is a hash already recorded by this app (launches / pathfinder evidence).
function ledgerRefFor(hash, knownHashes) {
  if (!hash) return { ref: null, reasons: [] };
  const k = knownHashes?.get?.(String(hash).toUpperCase());
  if (!k) return { ref: null, reasons: [`Ledger hash ${hash} is not in recorded Testnet evidence (data/launches.json, pathfinder evidence): refusing to cite it.`] };
  return { ref: { hash: String(hash).toUpperCase(), network: 'testnet', mode: MODES.LIVE, organic: false, ...k }, reasons: [] };
}

// Pure transition.
// request: { to, evidence?, funding?: partial {requestedUsd, committedUsd, fundedUsd, executableUsd}, approved?, approvedBy? }
// opts: { now: () => iso, guard = guardCheck, knownHashes: Map<HASH, {source, ledger?, explorer?}> }
export function transition(corridor, request = {}, { now = () => new Date().toISOString(), guard = guardCheck, knownHashes = new Map() } = {}) {
  const reasons = [];
  const from = corridor.state;
  const to = request.to;
  if (!STATES.includes(to)) return { ok: false, reasons: [`Unknown state ${to}.`] };
  if (NEXT[from] !== to) {
    reasons.push(NEXT[from] ? `Illegal transition ${from} → ${to}: the only legal next state is ${NEXT[from]}.` : `Illegal transition ${from} → ${to}: ${from} is terminal.`);
    return { ok: false, reasons };
  }
  const evidence = request.evidence && typeof request.evidence === 'object' ? request.evidence : {};
  if ('type' in evidence) reasons.push('Evidence may not carry a key named "type".');
  const before = { ...emptyFunding(), ...(corridor.funding || {}) };
  const patch = request.funding && typeof request.funding === 'object' ? request.funding : {};
  const after = { ...before, ...patch };
  reasons.push(...checkFunding(after));
  reasons.push(...(GUARDS[to]?.({ ...request, evidence }, corridor, after) || []));
  const needsApproval = APPROVAL_REQUIRED.includes(to);
  const approved = request.approved === true;
  if (needsApproval && !approved) reasons.push(`Entering ${to} requires explicit operator approval (approved: true set by a human in the operator console). The server never self-approves.`);
  const amountUsd = Math.max(1, ev({ evidence }).releasableUsd || after.fundedUsd || after.committedUsd || after.requestedUsd || 1);
  const verdict = guard({ mode: MODES.SIM, amountUsd, requiresApproval: needsApproval, approved });
  if (!verdict.allowed) reasons.push(...verdict.reasons.map((x) => `Guardian: ${x}`));
  const { ref, reasons: refReasons } = ledgerRefFor(evidence.ledgerHash, knownHashes);
  reasons.push(...refReasons);
  if (reasons.length) return { ok: false, reasons: [...new Set(reasons)], guardian: verdict };

  const log = corridor.log || [];
  const prevHash = log.length ? log[log.length - 1].hash : GENESIS;
  const changed = FUNDING_KEYS.filter((k) => after[k] !== before[k]);
  const rec = {
    seq: log.length, corridorId: corridor.id, marketId: corridor.marketId, at: now(), from, to,
    mode: ref ? MODES.LIVE : MODES.SIM,
    evidence,
    funding: { ...after, mode: MODES.SIM, note: 'requested / committed / funded / executable are tracked separately and never summed.' },
    authorization: { required: needsApproval, approved: needsApproval ? approved : null, approvedBy: needsApproval ? String(request.approvedBy || 'operator') : null, guardian: { allowed: verdict.allowed, reasons: verdict.reasons, input: { mode: MODES.SIM, amountUsd, requiresApproval: needsApproval } } },
    risk: riskAssessment({ evidence }),
    reconciliation: { fundingBefore: before, fundingAfter: after, changed, deltas: Object.fromEntries(changed.map((k) => [k, after[k] - before[k]])), invariantsOk: true },
    ledgerRef: ref, ledgerNote: ref ? 'Cites a real recorded Testnet transaction (organic:false demo account).' : 'No ledger transaction: SIMULATION record.',
    prevHash,
  };
  rec.hash = recordHash(rec);
  const next = { ...corridor, state: to, funding: after, log: [...log, rec], updatedAt: rec.at };
  return { ok: true, reasons: [], record: rec, corridor: next, guardian: verdict };
}

export function newCorridor({ id, marketId, label, origin = 'RADAR_DISCOVERED', pair = null, radarId = null, createdAt }) {
  if (!id || !marketId) throw new Error('id and marketId are required.');
  if (!ORIGINS.includes(origin)) throw new Error(`origin must be one of ${ORIGINS.join(', ')}.`);
  return { id, marketId, label: label || marketId, pair, origin, radarId, state: 'DISCOVERY', funding: emptyFunding(), log: [], createdAt, updatedAt: createdAt };
}

// Real Testnet hashes recorded by this app. Pure over the two documents.
export function knownHashesFrom({ launches = [], pathfinderEvidence = null } = {}) {
  const m = new Map();
  for (const l of launches) for (const s of l.steps || []) if (s.hash && s.result === 'tesSUCCESS') m.set(s.hash.toUpperCase(), { source: `launch ${l.code} step ${s.key}`, ledger: s.ledger ?? null, explorer: s.explorer ?? null });
  for (const r of pathfinderEvidence?.runs || []) for (const p of r.payments || []) if (p.hash && p.result === 'tesSUCCESS') m.set(p.hash.toUpperCase(), { source: `pathfinder run ${r.run} payment ${p.i} (${p.from}→${p.to})`, ledger: p.ledger ?? null, explorer: p.explorer ?? null });
  return m;
}

// ---------- scripted demo seed (deterministic; clearly labeled) ----------
export const SEED_AT = '2026-10-25T08:00:00.000Z';
const seedClock = (start = SEED_AT, stepMin = 7) => { let i = 0; return () => new Date(Date.parse(start) + (i++) * stepMin * 60_000).toISOString(); };
const SEED_APPROVER = 'Demo history (scripted, not a live approval)';

export function seedCorridors({ knownHashes = new Map(), bblFillHash = null } = {}) {
  const now = seedClock();
  const run = (c, steps) => { for (const s of steps) { const r = transition(c, s, { now, knownHashes }); if (!r.ok) throw new Error(`seed ${c.id} → ${s.to}: ${r.reasons.join(' ')}`); c = r.corridor; } return c; };
  const sources = { PROPRIETARY: { usd: 40_000, reallocatable: true }, T1: { usd: 25_000, reallocatable: false, custody: 'self-custodial TGLW' }, T2: { usd: 35_000, reallocatable: false, custody: 'self-custodial TGLW (term)' }, T3: { usd: 20_000, reallocatable: false, custody: 'TGLB lending-vault loan proceeds' } };
  let a = newCorridor({ id: 'xrp-rlusd', marketId: 'mainnet:RLUSD/XRP', label: 'XRP/RLUSD (initial corridor)', pair: 'XRP/RLUSD', origin: 'RADAR_DISCOVERED', createdAt: SEED_AT });
  a = run(a, [
    { to: 'OPPORTUNITY_EVALUATION', evidence: { radarId: 'radar:RLUSD', note: 'Scripted demo seed. Mainnet XRP/RLUSD observed read-only; Titan Forge holds no Mainnet accounts.' } },
    { to: 'PROJECT_REQUEST', evidence: { origin: 'RADAR_DISCOVERED', netBenefitUsd: { low: -400, base: 900, high: 2200 }, model: 'Historical seed assumption at entry (SIMULATION), before external makers deepened the book.' } },
    { to: 'CAPITAL_STRUCTURE', funding: { requestedUsd: 120_000 }, evidence: { note: 'Capital stack requested across sources.' } },
    { to: 'APPROVAL_PENDING', funding: { committedUsd: 100_000 }, evidence: { sources, note: 'Only PROPRIETARY capital is reallocatable by Titan Ghost.' } },
    { to: 'BOOTSTRAPPING', funding: { fundedUsd: 90_000 }, approved: true, approvedBy: SEED_APPROVER, evidence: { note: 'Demo history (scripted, not a live approval).' } },
    { to: 'ACTIVE', funding: { executableUsd: 85_000 }, evidence: { offersPlaced: 12, note: 'Modeled six-ring offers (SIMULATION; no Mainnet offers exist).' } },
    { to: 'REINFORCED', evidence: { independentShare: 0.42, risks: ['RLUSD issuer can claw back (AllowTrustLineClawback)'] } },
    { to: 'MATURE', evidence: { independentShare: 0.78, persistence: 0.9, note: 'External makers carry most of the book (modeled share vs observed Mainnet depth).' } },
  ]);
  let b = newCorridor({ id: 'tst-bbl', marketId: 'testnet:BBL', label: 'BBL/XRP (Testnet demo token)', pair: 'BBL/XRP', origin: 'PROJECT_REQUESTED', createdAt: SEED_AT });
  b = run(b, [
    { to: 'OPPORTUNITY_EVALUATION', evidence: { radarId: 'radar:testnet:BBL', note: 'Testnet demo token (organic:false). NO_PATH evidence on BBL→LDN.' } },
    { to: 'PROJECT_REQUEST', evidence: { origin: 'PROJECT_REQUESTED', netBenefitUsd: { low: 50, base: 120, high: 300 }, model: 'Demo-mechanics assumption (SIMULATION); not an economic forecast for a real market.' } },
    { to: 'CAPITAL_STRUCTURE', funding: { requestedUsd: 500 }, evidence: { note: 'Small Testnet demo stack.' } },
    { to: 'APPROVAL_PENDING', funding: { committedUsd: 500 }, evidence: { sources: { PROPRIETARY: { usd: 500, reallocatable: true } }, nextLedgerEvidence: bblFillHash || null, note: 'Awaiting operator approval in the console.' } },
  ]);
  return { a, b };
}

// ---------- persistent service ----------
export class XdlcStore {
  constructor({ file = null, seedFile = null, now = () => new Date().toISOString(), bus = null, knownHashes = new Map(), bblFillHash = null } = {}) {
    Object.assign(this, { file, now, bus, knownHashes });
    this.state = null;
    const src = file && fs.existsSync(file) ? file : seedFile && fs.existsSync(seedFile) ? seedFile : null;
    try { if (src) this.state = JSON.parse(fs.readFileSync(src, 'utf8')); } catch { this.state = null; }
    if (!this.state?.corridors) {
      const { a, b } = seedCorridors({ knownHashes, bblFillHash });
      this.state = { version: 1, statement: STATEMENT, seq: 0, corridors: { [a.id]: a, [b.id]: b } };
    }
    this.save();
  }
  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.state, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
  }
  summary(c) { const chain = verifyChain(c.log); return { id: c.id, marketId: c.marketId, label: c.label, pair: c.pair, origin: c.origin, state: c.state, stateIndex: STATES.indexOf(c.state), next: NEXT[c.state], nextRequiresApproval: APPROVAL_REQUIRED.includes(NEXT[c.state]), funding: c.funding, transitions: c.log.length, chain, updatedAt: c.updatedAt }; }
  list() { return { mode: MODES.SIM, statement: STATEMENT, states: STATES, labels: STATE_LABELS, approvalRequired: APPROVAL_REQUIRED, corridors: Object.values(this.state.corridors).map((c) => this.summary(c)) }; }
  get(id) { const c = this.state.corridors[id]; return c ? { ...this.summary(c), log: c.log, statement: STATEMENT } : null; }
  create(body = {}) {
    const base = String(body.marketId || '').trim();
    if (!base || base.length > 200) throw Object.assign(new Error('marketId is required (≤ 200 chars).'), { status: 400 });
    this.state.seq = (this.state.seq || 0) + 1;
    const id = `c${this.state.seq}-${base.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '')}`.toLowerCase();
    let c;
    try { c = newCorridor({ id, marketId: base, label: String(body.label || base).slice(0, 120), pair: body.pair ? String(body.pair).slice(0, 40) : null, origin: body.origin || 'RADAR_DISCOVERED', radarId: body.radarId || null, createdAt: this.now() }); }
    catch (e) { throw Object.assign(e, { status: 400 }); }
    this.state.corridors[id] = c; this.save();
    return this.get(id);
  }
  advance(id, body = {}) {
    const c = this.state.corridors[id];
    if (!c) throw Object.assign(new Error('Unknown corridor'), { status: 404 });
    const r = transition(c, { to: body.to, evidence: body.evidence, funding: body.funding, approved: body.approved === true, approvedBy: body.approvedBy }, { now: this.now, knownHashes: this.knownHashes });
    if (!r.ok) throw Object.assign(new Error(r.reasons.join(' ')), { status: 409, reasons: r.reasons, guardian: r.guardian });
    this.state.corridors[id] = r.corridor; this.save();
    const rec = r.record;
    this.bus?.publish('xdlc.transition', rec.mode, { corridorId: id, marketId: rec.marketId, from: rec.from, to: rec.to, seq: rec.seq, hash: rec.hash, prevHash: rec.prevHash, funding: { requestedUsd: rec.funding.requestedUsd, committedUsd: rec.funding.committedUsd, fundedUsd: rec.funding.fundedUsd, executableUsd: rec.funding.executableUsd }, approved: rec.authorization.approved, ledgerHash: rec.ledgerRef?.hash || null });
    return { ok: true, record: rec, corridor: this.summary(r.corridor) };
  }
}
