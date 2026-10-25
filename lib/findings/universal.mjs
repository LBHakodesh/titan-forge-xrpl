// TG Sentinel universal observability: extra read-only collectors + the subsystem coverage model.
// Every collector here is a pure function over injected inputs (runs, launches, server_info, account balances,
// HTTP bodies from this node, a process snapshot). A finding is produced ONLY from observed state or a recorded
// report, always with at least one evidence item. Missing sources make the collector UNAVAILABLE (coverage map),
// never a finding. Sentinel records and recommends: nothing here signs, pays, moves capital or authorizes spending.
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { creatureFor } from '../../public/creatures.js';

export const SENTINEL_STATEMENT = 'TG Sentinel records and recommends. It does not authorize spending, sign transactions or move capital.';

export const THRESHOLDS = Object.freeze({
  ledgerStaleSec: 60, ledgerStaleHighSec: 300,
  loadFactor: 10, maxTxFeeXrp: 0.0001, pathCostBps: 200,
  minDepthXrp: 1, minSpendableXrp: 5,
  stuckRunMs: 2 * 3600_000,
  rssMb: 1024, heapRatio: 0.85, eventLoopP99Ms: 250, diskFreeRatio: 0.10, diskFreeHighRatio: 0.05, dataFileMb: 50,
});

const TX_RE = /^[0-9A-F]{64}$/i;
const hour = (at) => String(at).slice(0, 13);
const day = (at) => String(at).slice(0, 10);
const iso = (ms) => new Date(ms).toISOString();
const fmt = (n, d = 6) => Number(n).toFixed(d).replace(/\.?0+$/, '');

// ---------- Execution integrity ----------
// Cross-checks Pathfinder run records: success must carry a validated tesSUCCESS + hash + ledger, scorecards must
// match the payment rows, and no run may sit in "running" for hours. (Failed runs/payments: existing pathfinder collector.)
export function executionFindings(runs, { now = Date.now() } = {}) {
  const out = [];
  for (const r of runs || []) {
    const pays = r.payments || [];
    for (const p of pays) {
      if (p.status !== 'success') continue;
      const problems = [];
      if (!p.hash || !TX_RE.test(p.hash)) problems.push('no transaction hash');
      if (p.result !== 'tesSUCCESS') problems.push(`result ${p.result ?? 'missing'}`);
      if (!Number.isFinite(Number(p.ledger)) || !p.ledger) problems.push('no validated ledger index');
      if (!problems.length) continue;
      out.push({
        key: 'execution:success-without-validated-result', occurrence: `${r.id}:${p.i}`,
        title: 'Payment recorded as success without a validated tesSUCCESS result', category: 'execution-integrity', product: 'Pathfinder', market: [p.from, p.to].sort().join('/'),
        severity: 'high', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'execution', environment: 'XRPL Testnet (run records)', seenAt: p.at || r.createdAt,
        observed: `Run ${r.id} payment ${p.i} (${p.from}→${p.to} ${p.sizeXrp} XRP) status success but ${problems.join(', ')}.`,
        expected: 'Every success row carries a validated tesSUCCESS hash and ledger index.', actual: problems.join(', '),
        owner: 'Pathfinder owner', remediation: { status: 'proposed', summary: 'Re-verify the row against the ledger (tx lookup) before counting it in any scorecard.' },
        evidence: [{ kind: 'run', ref: r.id, detail: `payment ${p.i}` }, p.hash && { kind: 'tx', ref: p.hash, detail: String(p.result) }].filter(Boolean),
      });
    }
    const sc = r.scorecard?.payments;
    if (sc && r.status === 'done') {
      const actual = { succeeded: pays.filter((p) => p.status === 'success').length, skipped: pays.filter((p) => p.status === 'skipped').length, failed: pays.filter((p) => p.status === 'failed').length };
      const diffs = Object.entries(actual).filter(([k, v]) => Number.isFinite(sc[k]) && sc[k] !== v).map(([k, v]) => `${k} scorecard ${sc[k]} vs rows ${v}`);
      if (diffs.length) out.push({
        key: 'execution:scorecard-mismatch', occurrence: r.id, title: 'Run scorecard does not match its payment rows', category: 'execution-integrity', product: 'Pathfinder', market: (r.options?.tokens || []).join('/') || '—',
        severity: 'medium', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'execution', environment: 'XRPL Testnet (run records)', seenAt: r.finishedAt || r.createdAt,
        observed: `Run ${r.id}: ${diffs.join('; ')}.`, expected: 'Scorecard counts equal the recorded payment rows.', actual: diffs.join('; '),
        owner: 'Pathfinder owner', remediation: { status: 'proposed', summary: 'Recompute the scorecard from rows; never present the stored totals until they reconcile.' },
        evidence: [{ kind: 'run', ref: r.id, detail: 'scorecard.payments vs payments[]' }, { kind: 'metric', ref: `${r.id}:scorecard`, detail: JSON.stringify(sc) }],
      });
    }
    const started = Date.parse(r.startedAt || r.createdAt);
    if (r.status === 'running' && !r.finishedAt && Number.isFinite(started) && now - started > THRESHOLDS.stuckRunMs) out.push({
      key: 'execution:run-stuck', occurrence: r.id, title: `Pathfinder run running for ${Math.round((now - started) / 60000)} min without finishing`, category: 'execution-integrity', product: 'Pathfinder', market: (r.options?.tokens || []).join('/') || '—',
      severity: 'medium', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'execution', environment: 'XRPL Testnet (run records)', seenAt: iso(now),
      observed: `Run ${r.id} status running since ${r.startedAt || r.createdAt}.`, expected: `Runs finish or fail within ${THRESHOLDS.stuckRunMs / 3600_000}h.`, actual: 'still running',
      owner: 'Pathfinder owner', remediation: { status: 'proposed', summary: 'Inspect the run actions; an operator decides whether to stop it. Sentinel does not stop runs.' },
      evidence: [{ kind: 'run', ref: r.id, detail: `startedAt ${r.startedAt || r.createdAt}` }],
    });
  }
  return out;
}

// ---------- Validated fill classification ----------
// Same fill set as GET /api/loop/catches (launch fills + successful Pathfinder payments), re-checked: each fill must
// be validated, labeled organic:false (demo), classifiable by size, and attributed. Third-party capture is surfaced.
export function fillRecords(launches, runs) {
  const out = [];
  for (const l of launches || []) if (l.status === 'live' && l.fillHash) {
    const step = (l.steps || []).find((s) => s.key === 'fill');
    out.push({ kind: 'direct', code: l.code, xrp: 1, at: l.completedAt || l.createdAt, hash: l.fillHash, result: step?.result ?? 'tesSUCCESS', ledger: step?.ledger ?? null, organic: l.organic, ref: `launch:${l.id}` });
  }
  for (const r of runs || []) for (const p of r.payments || []) if (p.status === 'success' && p.hash) {
    out.push({ kind: 'pathfound', code: p.to === 'XRP' ? p.from : p.to, xrp: p.sizeXrp, at: p.at, hash: p.hash, result: p.result, ledger: p.ledger, organic: r.organic, attribution: p.attribution || null, ref: `run:${r.id}:${p.i}` });
  }
  return out;
}

export function fillFindings(fills) {
  const out = [];
  const byCreature = {};
  let bridged = 0, thirdParty = 0;
  const bad = { unvalidated: [], organic: [], unclassified: [], unattributed: [] };
  for (const f of fills || []) {
    const c = Number(f.xrp) > 0 ? creatureFor(f.xrp) : null;
    if (c) byCreature[c.id] = (byCreature[c.id] || 0) + 1; else bad.unclassified.push(f);
    if (f.result !== 'tesSUCCESS' || !TX_RE.test(String(f.hash))) bad.unvalidated.push(f);
    if (f.organic !== false) bad.organic.push(f);
    if (f.kind === 'pathfound') {
      if (!f.attribution) bad.unattributed.push(f);
      else { if (f.attribution.bridged) bridged++; if ((f.attribution.capturedBy?.other || 0) > 0) thirdParty++; }
    }
  }
  const mk = (key, list, severity, title, expected) => list.length && out.push({
    key, occurrence: list.map((f) => f.hash).sort().join(',').slice(0, 400), title: `${title} (${list.length} fill${list.length === 1 ? '' : 's'})`,
    category: 'fill-classification', product: 'Fill classification (demo fills)', market: [...new Set(list.map((f) => f.code))].join('/'),
    severity, verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'fills', environment: 'XRPL Testnet (validated fills)', seenAt: list.map((f) => f.at).sort().pop(),
    observed: list.slice(0, 6).map((f) => `${f.kind} ${f.code} ${f.xrp} XRP ${String(f.hash).slice(0, 10)}… result ${f.result ?? '?'} organic ${f.organic}`).join('; '),
    expected, actual: `${list.length} of ${fills.length} fills`, owner: 'Fill classification / Pathfinder owner',
    remediation: { status: 'proposed', summary: 'Correct the record at its source; classification figures exclude these fills until fixed.' },
    evidence: list.slice(0, 10).map((f) => (TX_RE.test(String(f.hash)) ? { kind: 'tx', ref: f.hash, detail: `${f.kind} ${f.ref}` } : { kind: 'run', ref: f.ref, detail: 'fill row' })),
  });
  mk('fills:not-validated', bad.unvalidated, 'high', 'Fill counted without a validated tesSUCCESS', 'Every counted fill is a validated tesSUCCESS transaction.');
  mk('fills:organic-flag-missing', bad.organic, 'high', 'Demo fill not labeled organic:false', 'All fills between our own demo accounts carry organic:false (contract rule 3).');
  mk('fills:unclassifiable-size', bad.unclassified, 'low', 'Fill size not classifiable', 'Every fill has a positive XRP size.');
  mk('fills:unattributed', bad.unattributed, 'low', 'Pathfound fill without capture attribution', 'Each pathfound payment records which offers filled it.');
  return { findings: out, detail: { fills: (fills || []).length, classified: (fills || []).length - bad.unclassified.length, byCreature, bridged, thirdPartyCapture: thirdParty, anomalies: Object.fromEntries(Object.entries(bad).map(([k, v]) => [k, v.length])) } };
}

// ---------- Ledger freshness + fees (server_info is a read) ----------
export function ledgerFindings(info, { ledgerReady = false, ledgerError = null, offline = false, at = iso(Date.now()) } = {}) {
  if (offline) return { findings: [], detail: { note: 'Offline replay mode: no live ledger by design; nothing to check.' } };
  if (!ledgerReady || !info) {
    if (!ledgerError && !ledgerReady) return { findings: [], detail: { note: 'Ledger still bootstrapping.' } };
    return { findings: [{
      key: 'ledger:testnet-unavailable', occurrence: `${ledgerError}|${hour(at)}`, title: 'XRPL Testnet connection unavailable on this node', category: 'ledger-freshness', product: 'XRPL connectivity', market: '—',
      severity: 'medium', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'ledger', environment: 'London node', seenAt: at,
      observed: `ledgerReady=false: ${ledgerError || 'no server_info'}`, expected: 'A connected Testnet client with a recent validated ledger.', actual: String(ledgerError || 'unavailable'),
      owner: 'Ops / lead', remediation: { status: 'proposed', summary: 'Check connectivity; live figures fall back to REPLAY labels until reconnected.' },
      evidence: [{ kind: 'endpoint', ref: 'GET /api/health', detail: `ledgerError: ${ledgerError}`, at }],
    }], detail: { ledgerReady, ledgerError } };
  }
  const vl = info.validated_ledger || {};
  const age = Number(vl.age);
  const detail = { seq: vl.seq ?? null, ageSec: Number.isFinite(age) ? age : null, serverState: info.server_state ?? null, networkId: info.network_id ?? null, loadFactor: info.load_factor ?? null };
  const findings = [];
  if (info.network_id != null && Number(info.network_id) !== 1) findings.push({
    key: 'ledger:wrong-network', occurrence: String(info.network_id), title: `Connected server reports network_id ${info.network_id}, not Testnet (1)`, category: 'ledger-freshness', product: 'XRPL connectivity', market: '—',
    severity: 'critical', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'ledger', environment: 'London node', seenAt: at,
    observed: `server_info.network_id=${info.network_id}`, expected: 'network_id 1 (Testnet only, contract rule 1).', actual: String(info.network_id), owner: 'Lead',
    remediation: { status: 'proposed', summary: 'Stop signing paths immediately (Ledger.assertTestnet refuses already) and investigate the endpoint.' },
    evidence: [{ kind: 'metric', ref: 'server_info.network_id', detail: String(info.network_id), at }],
  });
  if (!vl.seq) findings.push({
    key: 'ledger:no-validated-ledger', occurrence: hour(at), title: 'Testnet server reports no validated ledger', category: 'ledger-freshness', product: 'XRPL connectivity', market: '—',
    severity: 'high', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'ledger', environment: 'XRPL Testnet', seenAt: at,
    observed: `server_state ${info.server_state}; validated_ledger missing`, expected: 'A validated ledger is available.', actual: 'none', owner: 'Ops / lead',
    remediation: { status: 'proposed', summary: 'Treat every live read as stale until a validated ledger is reported.' },
    evidence: [{ kind: 'metric', ref: 'server_info.server_state', detail: String(info.server_state), at }],
  });
  else if (Number.isFinite(age) && age > THRESHOLDS.ledgerStaleSec) findings.push({
    key: 'ledger:stale-validated-ledger', occurrence: hour(at), title: `Validated ledger is ${age}s old (stale)`, category: 'ledger-freshness', product: 'XRPL connectivity', market: '—',
    severity: age > THRESHOLDS.ledgerStaleHighSec ? 'high' : 'medium', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'ledger', environment: 'XRPL Testnet', seenAt: at,
    observed: `server_info validated_ledger seq ${vl.seq}, age ${age}s, server_state ${info.server_state}.`, expected: `Validated ledger age under ${THRESHOLDS.ledgerStaleSec}s (~4s close interval).`, actual: `${age}s`,
    owner: 'Ops / lead', remediation: { status: 'proposed', summary: 'Label live numbers as stale; do not quote or plan against an old ledger.' },
    evidence: [{ kind: 'ledger', ref: String(vl.seq), detail: `age ${age}s`, at }, { kind: 'metric', ref: 'server_info.validated_ledger.age', detail: String(age), at }],
  });
  return { findings, detail };
}

export function feeFindings(info, runs, { at = iso(Date.now()) } = {}) {
  const findings = [];
  const vl = info?.validated_ledger || {};
  const lf = Number(info?.load_factor ?? 1);
  const openFee = Number(vl.base_fee_xrp ?? 0.00001) * (Number.isFinite(lf) ? lf : 1);
  if (info && (lf > THRESHOLDS.loadFactor || openFee > THRESHOLDS.maxTxFeeXrp)) findings.push({
    key: 'fees:network-load', occurrence: hour(at), title: `Testnet fee escalation: load factor ${lf} (≈${fmt(openFee)} XRP per tx)`, category: 'fees', product: 'XRPL connectivity', market: '—',
    severity: openFee > THRESHOLDS.maxTxFeeXrp * 10 ? 'high' : 'medium', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'fees', environment: 'XRPL Testnet', seenAt: at,
    observed: `server_info load_factor ${lf}, base_fee_xrp ${vl.base_fee_xrp}.`, expected: `Load factor ≤ ${THRESHOLDS.loadFactor}, fee ≤ ${THRESHOLDS.maxTxFeeXrp} XRP.`, actual: `${fmt(openFee)} XRP`,
    owner: 'Pathfinder / loop owners', remediation: { status: 'proposed', summary: 'Pause fee-heavy demo activity until load normalizes (operator decision; Sentinel pauses nothing).' },
    evidence: [{ kind: 'metric', ref: 'server_info.load_factor', detail: String(lf), at }, vl.seq && { kind: 'ledger', ref: String(vl.seq), detail: 'validated ledger at check', at }].filter(Boolean),
  });
  for (const r of runs || []) {
    if (Number(r.feeXrp) > THRESHOLDS.maxTxFeeXrp) findings.push({
      key: 'fees:run-tx-fee', occurrence: r.id, title: `Pathfinder run paid ${r.feeXrp} XRP per transaction (above ${THRESHOLDS.maxTxFeeXrp})`, category: 'fees', product: 'Pathfinder', market: (r.options?.tokens || []).join('/') || '—',
      severity: 'medium', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'fees', environment: 'XRPL Testnet (run records)', seenAt: r.createdAt,
      observed: `Run ${r.id} feeXrp ${r.feeXrp}.`, expected: `≤ ${THRESHOLDS.maxTxFeeXrp} XRP per tx.`, actual: String(r.feeXrp), owner: 'Pathfinder owner',
      remediation: { status: 'proposed', summary: 'Cap the per-tx fee in the planner.' }, evidence: [{ kind: 'run', ref: r.id, detail: `feeXrp ${r.feeXrp}` }],
    });
    const costly = (r.payments || []).filter((p) => p.status === 'success' && Number(p.pathfind?.vsMidBps) > THRESHOLDS.pathCostBps);
    if (costly.length) findings.push({
      key: 'fees:path-cost-over-mid', occurrence: r.id, title: `${costly.length} payment(s) cost more than ${THRESHOLDS.pathCostBps} bps over mid`, category: 'fees', product: 'Pathfinder', market: (r.options?.tokens || []).join('/') || '—',
      severity: 'low', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'fees', environment: 'XRPL Testnet (run records)', seenAt: costly.map((p) => p.at).sort().pop(),
      observed: costly.slice(0, 5).map((p) => `${p.from}→${p.to} ${p.sizeXrp} XRP at +${p.pathfind.vsMidBps} bps`).join('; '), expected: `Path cost within ${THRESHOLDS.pathCostBps} bps of mid.`, actual: `max +${Math.max(...costly.map((p) => p.pathfind.vsMidBps))} bps`,
      owner: 'Pathfinder owner', remediation: { status: 'proposed', summary: 'Review quote width and depth on the bridged legs.' },
      evidence: costly.slice(0, 10).map((p) => ({ kind: 'tx', ref: p.hash, detail: `+${p.pathfind.vsMidBps} bps vs mid` })),
    });
  }
  return { findings, detail: { loadFactor: info ? lf : null, openLedgerFeeXrp: info ? Number(fmt(openFee, 8)) : null, runsChecked: (runs || []).length } };
}

// ---------- Market depth depletion (from complete Sentinel book scans) ----------
export function depthFindings(reports, { at = iso(Date.now()) } = {}) {
  const findings = [];
  const detail = [];
  for (const r of reports || []) {
    const offers = r.book?.offers || [];
    const side = (s) => offers.filter((o) => o.side === s).reduce((a, o) => a + (Number(o.fundedXrp) || 0), 0);
    const asks = side('ask'), bids = side('bid'), total = asks + bids;
    detail.push({ code: r.code, ledger: r.validatedLedger, askXrp: Number(asks.toFixed(4)), bidXrp: Number(bids.toFixed(4)) });
    if (!offers.length) continue; // empty book: Sentinel's own book.depth finding covers it (no double counting)
    const ev = [{ kind: 'ledger', ref: String(r.validatedLedger), detail: `book_offers scan ${r.scannedAt}` }, { kind: 'endpoint', ref: `GET /api/sentinel/${r.code}`, detail: `asks ${asks.toFixed(4)} XRP funded, bids ${bids.toFixed(4)} XRP funded` }];
    for (const [s, v, other] of [['ask', asks, bids], ['bid', bids, asks]]) if (v <= 0 && other > 0) findings.push({
      key: `depth:${r.code}:${s}-side-depleted`, occurrence: day(at), title: `${r.code}: ${s} side has no funded depth`, category: 'market-depth', product: 'Order books (demo tokens)', market: r.code,
      severity: 'medium', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'depth', environment: 'XRPL Testnet (validated book_offers)', seenAt: r.scannedAt || at,
      observed: `At ledger ${r.validatedLedger}: ${s}s funded ${v.toFixed(4)} XRP, opposite side ${other.toFixed(4)} XRP.`, expected: 'Both sides quoted with funded depth.', actual: `${s} side depleted`,
      owner: 'Maker / Pathfinder owner', remediation: { status: 'proposed', summary: 'Re-quote the depleted side (operator action). Sentinel does not place offers.' }, evidence: ev,
    });
    if (total > 0 && total < THRESHOLDS.minDepthXrp) findings.push({
      key: `depth:${r.code}:thin-book`, occurrence: day(at), title: `${r.code}: total funded depth ${total.toFixed(4)} XRP (below ${THRESHOLDS.minDepthXrp} XRP)`, category: 'market-depth', product: 'Order books (demo tokens)', market: r.code,
      severity: 'low', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'depth', environment: 'XRPL Testnet (validated book_offers)', seenAt: r.scannedAt || at,
      observed: `At ledger ${r.validatedLedger}: asks ${asks.toFixed(4)} + bids ${bids.toFixed(4)} XRP funded.`, expected: `≥ ${THRESHOLDS.minDepthXrp} XRP funded depth.`, actual: `${total.toFixed(4)} XRP`,
      owner: 'Maker / Pathfinder owner', remediation: { status: 'proposed', summary: 'Replenish quotes before demo payments; thin books cause NO_PATH.' }, evidence: ev,
    });
  }
  return { findings, detail: { books: detail } };
}

// ---------- Inventory & capital (demo account XRP vs reserve) ----------
export function inventoryFindings(accounts, { reserveBase = 1, reserveInc = 0.2, ledger = null, at = iso(Date.now()) } = {}) {
  const findings = [];
  const rows = [];
  for (const [role, a] of Object.entries(accounts || {})) {
    if (!a) continue;
    const reserve = reserveBase + reserveInc * Number(a.ownerCount || 0);
    const spendable = Number(a.xrp) - reserve;
    rows.push({ role, xrp: a.xrp ?? null, ownerCount: a.ownerCount ?? null, spendable: Number.isFinite(spendable) ? Number(spendable.toFixed(6)) : null, unfunded: !!a.unfunded });
    if (!a.unfunded && !(spendable < THRESHOLDS.minSpendableXrp)) continue;
    findings.push({
      key: `inventory:${role}:low-xrp`, occurrence: `${day(at)}|${a.unfunded ? 'unfunded' : Math.floor(spendable)}`,
      title: a.unfunded ? `Demo ${role} account is unfunded / not found` : `Demo ${role} account has ${spendable.toFixed(2)} XRP spendable above reserve`, category: 'inventory', product: 'Demo account inventory', market: '—',
      severity: a.unfunded || spendable < 1 ? 'high' : 'medium', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'inventory', environment: 'XRPL Testnet (validated account_info)', seenAt: at,
      observed: a.unfunded ? `account_info for ${a.address} returned no account.` : `${a.address}: ${a.xrp} XRP, owner count ${a.ownerCount}, reserve ≈ ${reserve.toFixed(2)} XRP.`,
      expected: `≥ ${THRESHOLDS.minSpendableXrp} XRP spendable so quotes and payments do not fail.`, actual: a.unfunded ? 'unfunded' : `${spendable.toFixed(2)} XRP`,
      owner: 'Ops / lead', remediation: { status: 'proposed', summary: 'Top up from the Testnet faucet (operator action). Sentinel moves no funds.' },
      evidence: [{ kind: 'account', ref: a.address, detail: `${role}: ${a.xrp} XRP, ownerCount ${a.ownerCount}`, at }, ledger && { kind: 'ledger', ref: String(ledger), detail: 'validated ledger at check' }].filter(Boolean),
    });
  }
  return { findings, detail: { accounts: rows, reserveBase, reserveInc } };
}

// ---------- Funding-tier restrictions (Access participants) ----------
const MODE_PROV = { LIVE_TESTNET: 'LIVE_TESTNET', SIMULATION: 'SIMULATION', REPLAY: 'REPLAY', MAINNET_OBSERVED: 'MAINNET_OBSERVED_READ_ONLY' };
export function fundingTierFindings(body, { at = iso(Date.now()) } = {}) {
  const findings = [];
  const groups = [['live', body?.live?.participants], ['simulated', body?.simulated?.participants]];
  const detail = {};
  for (const [g, list] of groups) {
    if (!Array.isArray(list)) continue;
    detail[g] = list.length;
    const byMode = {};
    for (const p of list) { const prov = MODE_PROV[p.mode]; if (prov) (byMode[prov] ||= []).push(p); }
    for (const [prov, ps] of Object.entries(byMode)) {
      const sim = prov === 'SIMULATION' || prov === 'REPLAY';
      const noT3 = ps.filter((p) => Array.isArray(p.permittedTiers) && !p.permittedTiers.includes('T3'));
      if (noT3.length) findings.push({
        key: `tiers:${g}:tier3-restricted`, occurrence: noT3.map((p) => p.id).sort().join(','), title: `${noT3.length} ${g} participant(s) restricted to ${[...new Set(noT3.flatMap((p) => p.permittedTiers))].join('/')} (Tier 3 underwriting not approved)`,
        category: 'funding-tier', product: 'TGLW / TGLB tiers (Access)', market: '—', severity: 'info', verification: sim ? 'SIMULATED' : 'CONFIRMED', provenance: prov, source: 'funding-tiers', environment: 'Access entitlement engine', seenAt: at,
        observed: noT3.map((p) => `${p.id}: tiers ${p.permittedTiers.join('/')}, underwriting approved=${!!p.underwriting?.approved}`).join('; '), expected: 'Tier eligibility matches underwriting state.', actual: 'Tier 3 unavailable to these participants.',
        owner: 'TGLB / Access owners', remediation: { status: 'accepted-by-design', summary: 'Correct restriction: no underwriting approval exists. Tier 3 opens only after approval.' },
        evidence: [{ kind: 'endpoint', ref: 'GET /api/access/participants', detail: `${g} participants, permittedTiers`, at }],
      });
      const over = ps.filter((p) => p.status && p.status !== 'free' && !p.subscription);
      if (over.length) findings.push({
        key: `tiers:${g}:free-threshold-exceeded`, occurrence: over.map((p) => `${p.id}:${p.status}`).sort().join(','), title: `${over.length} ${g} participant(s) above the free-liquidity threshold without a plan`,
        category: 'funding-tier', product: 'API endpoints / subscriptions (Access)', market: '—', severity: sim ? 'info' : 'low', verification: sim ? 'SIMULATED' : 'CONFIRMED', provenance: prov, source: 'funding-tiers', environment: 'Access entitlement engine', seenAt: at,
        observed: over.map((p) => `${p.id}: ${p.status}, qualifying ${p.qualifyingUsd} USD vs ${p.thresholdUsd}`).join('; '), expected: 'Participants above the threshold hold a plan or are in grace.', actual: 'free access ends / ended',
        owner: 'Access owner', remediation: { status: 'proposed', summary: 'Offer the plan shown in the participant view (demo; no billing provider connected).' },
        evidence: [{ kind: 'endpoint', ref: 'GET /api/access/participants', detail: `${g} participants, status`, at }],
      });
    }
  }
  return { findings, detail };
}

// ---------- Unauthorized / refused payment requests (x402 telemetry, read-only) ----------
const BOOK_PROV = { OBSERVED: 'LIVE_TESTNET', SIMULATION: 'SIMULATION', REPLAY: 'REPLAY' };
export function x402TelemetryFindings(tel, { at = iso(Date.now()) } = {}) {
  const findings = [];
  const detail = { uptimeSec: tel?.uptimeSec ?? null };
  for (const [book, b] of Object.entries(tel?.books || {})) {
    const prov = BOOK_PROV[book];
    if (!prov || !b) continue;
    const sim = prov !== 'LIVE_TESTNET';
    const refused = { denied: b.denied || 0, guardianDenied: b.guardian?.denied || 0, agentBlocked: b.agent?.blocked || 0, verificationFailures: b.verificationFailures || 0, rejectedEvidence: b.rejectedEvidence || 0 };
    const total = Object.values(refused).reduce((a, n) => a + n, 0);
    detail[book] = { requests: b.requests || 0, refused: total, settlementFailures: b.settlementFailures || 0, serverErrors: b.serverErrors || 0 };
    const ev = (what) => [{ kind: 'endpoint', ref: 'GET /api/x402/telemetry', detail: `${book} book: ${what}`, at }];
    if (total) findings.push({
      key: `payauth:x402:${book.toLowerCase()}:refused-requests`, occurrence: hour(at), title: `x402: ${total} payment request(s) refused (${book})`, category: 'payment-authorization', product: 'Titan Merchant / x402', market: 'x402',
      severity: 'low', verification: sim ? 'SIMULATED' : 'CONFIRMED', provenance: prov, source: 'x402-telemetry', environment: 'x402 telemetry (in-process, since restart)', seenAt: at,
      observed: `${Object.entries(refused).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ')}; incidents ${JSON.stringify(b.incidents || {})}.`, expected: 'Refusals are expected controls working; tracked so repeated attempts are visible.', actual: `${total} refused`,
      owner: 'x402 / Guardian owners', remediation: { status: 'monitoring', summary: 'Controls held. Review incidents for repeated unauthorized attempts.' }, evidence: ev(`refused ${total}`),
    });
    if (b.settlementFailures) findings.push({
      key: `payauth:x402:${book.toLowerCase()}:settlement-failures`, occurrence: hour(at), title: `x402: ${b.settlementFailures} settlement failure(s) (${book})`, category: 'payment-authorization', product: 'Titan Merchant / x402', market: 'x402',
      severity: 'medium', verification: sim ? 'SIMULATED' : 'CONFIRMED', provenance: prov, source: 'x402-telemetry', environment: 'x402 telemetry', seenAt: at,
      observed: `settlementFailures ${b.settlementFailures}, confirmations ${b.settlementConfirmations || 0}.`, expected: 'Verified payments settle.', actual: `${b.settlementFailures} failed`,
      owner: 'x402 owner', remediation: { status: 'proposed', summary: 'Inspect /api/x402/events for the failing settlements.' }, evidence: ev(`settlementFailures ${b.settlementFailures}`),
    });
    if (b.serverErrors) findings.push({
      key: `api:x402:${book.toLowerCase()}:server-errors`, occurrence: hour(at), title: `x402: ${b.serverErrors} server error response(s) (${book})`, category: 'api', product: 'Titan Merchant / x402', market: 'x402',
      severity: 'medium', verification: sim ? 'SIMULATED' : 'CONFIRMED', provenance: prov, source: 'x402-telemetry', environment: 'x402 telemetry', seenAt: at,
      observed: `serverErrors ${b.serverErrors} of ${b.responses || 0} responses.`, expected: 'No 5xx responses.', actual: `${b.serverErrors} errors`,
      owner: 'x402 owner', remediation: { status: 'proposed', summary: 'Check server log around the errors.' }, evidence: ev(`serverErrors ${b.serverErrors}`),
    });
  }
  return { findings, detail };
}

// ---------- API errors (same-origin probes of read-only GET endpoints + route plugin load failures) ----------
export const API_PROBES = ['/api/health', '/api/launches', '/api/products', '/api/capital/state', '/api/access/policy', '/api/x402/status', '/api/engine/info', '/api/pathfinder/runs', '/api/loop/status', '/api/spokes', '/api/incubator/meta', '/api/findings/summary', '/api/vendors', '/api/xdlc'];
export function apiFindings(probes, health, { at = iso(Date.now()), provenance = 'LIVE_TESTNET' } = {}) {
  const findings = [];
  for (const s of health?.skippedRoutes || []) {
    const file = typeof s === 'string' ? s : s.file || s.name || JSON.stringify(s);
    const err = typeof s === 'object' ? s.error || s.reason || '' : '';
    findings.push({
      key: `api:route-load-failed:${file}`, occurrence: String(err || 'skipped').slice(0, 200), title: `Route plugin ${file} failed to load (its API is offline)`, category: 'api', product: 'API platform', market: '—',
      severity: 'high', verification: 'CONFIRMED', provenance, source: 'api', environment: 'London node', seenAt: at,
      observed: `/api/health skippedRoutes: ${file}${err ? ` (${err})` : ''}`, expected: 'Every route plugin loads.', actual: 'skipped',
      owner: 'Plugin owner / lead', remediation: { status: 'proposed', summary: 'Fix the import/register error and restart (lead).' },
      evidence: [{ kind: 'endpoint', ref: 'GET /api/health', detail: `skippedRoutes includes ${file}`, at }],
    });
  }
  for (const p of probes || []) {
    if (!(p.status >= 500) && !p.error) continue;
    findings.push({
      key: `api:error:${p.path}`, occurrence: hour(at), title: `GET ${p.path} ${p.error ? `failed (${String(p.error).slice(0, 60)})` : `returned HTTP ${p.status}`}`, category: 'api', product: 'API platform', market: '—',
      severity: 'medium', verification: 'CONFIRMED', provenance, source: 'api', environment: 'London node (same-origin probe)', seenAt: at,
      observed: `Probe of GET ${p.path}: ${p.error || `HTTP ${p.status}`} after ${p.ms ?? '?'} ms.`, expected: 'HTTP 2xx within the probe timeout.', actual: p.error || `HTTP ${p.status}`,
      owner: 'Route owner', remediation: { status: 'proposed', summary: 'Inspect the route handler and server log.' },
      evidence: [{ kind: 'endpoint', ref: `GET ${p.path}`, detail: p.error || `HTTP ${p.status}`, at }],
    });
  }
  return { findings, detail: { probed: (probes || []).length, failing: findings.length, slowest: (probes || []).reduce((m, p) => (p.ms > (m?.ms ?? -1) ? p : m), null) } };
}

// ---------- External signal feeds (vendors, XDLC capital redeployment) ----------
const SIG_PROV = { LIVE_TESTNET: 'LIVE_TESTNET', MAINNET_OBSERVED: 'MAINNET_OBSERVED_READ_ONLY', MAINNET_OBSERVED_READ_ONLY: 'MAINNET_OBSERVED_READ_ONLY', SIMULATION: 'SIMULATION', REPLAY: 'REPLAY' };
const SEVS = ['critical', 'high', 'medium', 'low', 'info'];
const SIG_VER = new Set(['CONFIRMED', 'SUSPECTED', 'INFORMATIONAL', 'UNVERIFIED_EXTERNAL']);
export function externalSignalFindings(body, { source, endpoint, product, at = iso(Date.now()) } = {}) {
  const list = Array.isArray(body) ? body : Array.isArray(body?.signals) ? body.signals : Array.isArray(body?.findings) ? body.findings : null;
  if (!list) throw new Error(`${endpoint} returned no signals[] array`);
  const findings = [];
  for (const s of list) {
    if (!s || !s.key || !s.title) continue;
    const provenance = SIG_PROV[s.provenance] || SIG_PROV[s.mode] || SIG_PROV[body?.mode] || 'SIMULATION';
    const sim = provenance === 'SIMULATION' || provenance === 'REPLAY';
    const raw = (Array.isArray(s.evidence) ? s.evidence : s.evidence == null ? [] : [s.evidence]).slice(0, 10)
      .map((e) => (e && typeof e === 'object' && e.ref != null ? e
        : e && typeof e === 'object' && e.label != null ? { kind: 'metric', ref: String(e.label).slice(0, 120), detail: String(typeof e.value === 'string' ? e.value : JSON.stringify(e.value ?? null)).slice(0, 400) }
        : { kind: 'note', ref: (typeof e === 'string' ? e : JSON.stringify(e)).slice(0, 200), detail: 'signal evidence' }));
    const evidence = [...raw, { kind: 'endpoint', ref: endpoint, detail: `signal ${s.key}`, at }];
    findings.push({
      key: String(s.key).startsWith(`${source}:`) ? String(s.key) : `${source}:${s.key}`, occurrence: String(s.occurrence ?? 'current'), title: String(s.title),
      category: s.category || source, product: s.product || product, market: s.market || '—', severity: SEVS.includes(s.severity) ? s.severity : 'info',
      verification: sim || s.verification === 'SIMULATED' ? 'SIMULATED' : SIG_VER.has(s.verification) ? s.verification : raw.length ? 'CONFIRMED' : 'SUSPECTED', provenance, source, environment: s.environment || endpoint, seenAt: s.observedAt || s.at || at,
      observed: typeof s.detail === 'string' ? s.detail : s.detail ? JSON.stringify(s.detail).slice(0, 600) : String(s.title),
      owner: s.owner || undefined, evidence,
      remediation: typeof s.remediation === 'string' ? { status: 'proposed', summary: s.remediation } : s.remediation || (s.recommendation ? { status: 'proposed', summary: String(s.recommendation) } : undefined),
    });
  }
  return { findings, detail: { signals: list.length, mode: body?.mode ?? null } };
}

// ---------- Infrastructure health (this process) ----------
let eld = null;
export function processSnapshot({ dataDir = null } = {}) {
  if (!eld) { try { eld = monitorEventLoopDelay({ resolution: 20 }); eld.enable(); } catch { eld = null; } }
  const mem = process.memoryUsage();
  const heap = v8.getHeapStatistics();
  const snap = { pid: process.pid, uptimeSec: Math.round(process.uptime()), rssMb: +(mem.rss / 1048576).toFixed(1), heapUsedMb: +(mem.heapUsed / 1048576).toFixed(1), heapLimitMb: +(heap.heap_size_limit / 1048576).toFixed(1), node: process.version };
  if (eld && eld.count > 0) { snap.eventLoopP99Ms = +(eld.percentile(99) / 1e6).toFixed(1); snap.eventLoopMaxMs = +(eld.max / 1e6).toFixed(1); eld.reset(); }
  if (dataDir) {
    try { const s = fs.statfsSync(dataDir); snap.disk = { freeRatio: +(Number(s.bavail) / Number(s.blocks)).toFixed(4), freeGb: +((Number(s.bavail) * Number(s.bsize)) / 1073741824).toFixed(2) }; } catch (e) { snap.diskError = e.message; }
    try { snap.dataFiles = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json') || f.endsWith('.log')).map((f) => ({ file: f, mb: +(fs.statSync(path.join(dataDir, f)).size / 1048576).toFixed(2) })).sort((a, b) => b.mb - a.mb).slice(0, 5); } catch {}
  }
  return snap;
}

export function infraFindings(snap, { at = iso(Date.now()), provenance = 'LIVE_TESTNET' } = {}) {
  const findings = [];
  if (!snap) throw new Error('No process snapshot');
  const base = (key, severity, title, observed, expected, metric, value, remediation) => findings.push({
    key, occurrence: hour(at), title, category: 'infrastructure', product: 'Node infrastructure', market: '—', severity, verification: 'CONFIRMED', provenance, source: 'infra',
    environment: `London node process pid ${snap.pid} (uptime ${snap.uptimeSec}s)`, seenAt: at, observed, expected, actual: String(value), owner: 'Ops / lead',
    remediation: { status: 'proposed', summary: remediation }, evidence: [{ kind: 'metric', ref: metric, detail: String(value), at }],
  });
  if (snap.rssMb > THRESHOLDS.rssMb) base('infra:memory-rss', snap.rssMb > THRESHOLDS.rssMb * 2 ? 'high' : 'medium', `Process memory ${snap.rssMb} MB RSS`, `rss ${snap.rssMb} MB, heap ${snap.heapUsedMb}/${snap.heapLimitMb} MB.`, `RSS under ${THRESHOLDS.rssMb} MB.`, 'process.memoryUsage().rss', `${snap.rssMb} MB`, 'Look for growing in-memory state; plan a restart window (lead).');
  if (snap.heapLimitMb && snap.heapUsedMb / snap.heapLimitMb > THRESHOLDS.heapRatio) base('infra:heap-pressure', 'high', `Heap at ${Math.round((snap.heapUsedMb / snap.heapLimitMb) * 100)}% of limit`, `heapUsed ${snap.heapUsedMb} MB of ${snap.heapLimitMb} MB.`, `Below ${THRESHOLDS.heapRatio * 100}% of the heap limit.`, 'v8 heap ratio', (snap.heapUsedMb / snap.heapLimitMb).toFixed(3), 'Risk of out-of-memory crash; restart before the demo window (lead).');
  if (snap.eventLoopP99Ms > THRESHOLDS.eventLoopP99Ms) base('infra:event-loop-lag', snap.eventLoopP99Ms > THRESHOLDS.eventLoopP99Ms * 4 ? 'high' : 'medium', `Event-loop lag p99 ${snap.eventLoopP99Ms} ms`, `p99 ${snap.eventLoopP99Ms} ms, max ${snap.eventLoopMaxMs} ms since the previous check.`, `p99 under ${THRESHOLDS.eventLoopP99Ms} ms.`, 'perf_hooks.monitorEventLoopDelay p99', `${snap.eventLoopP99Ms} ms`, 'Find the synchronous hot path (large JSON writes, scans).');
  if (snap.disk && snap.disk.freeRatio < THRESHOLDS.diskFreeRatio) base('infra:disk-free', snap.disk.freeRatio < THRESHOLDS.diskFreeHighRatio ? 'high' : 'medium', `Disk ${(snap.disk.freeRatio * 100).toFixed(1)}% free (${snap.disk.freeGb} GB)`, `statfs(data/): ${snap.disk.freeGb} GB free.`, `More than ${THRESHOLDS.diskFreeRatio * 100}% free.`, 'fs.statfs data/', `${(snap.disk.freeRatio * 100).toFixed(1)}%`, 'Free space before data files fail to write.');
  for (const f of snap.dataFiles || []) if (f.mb > THRESHOLDS.dataFileMb) base(`infra:data-file-size:${f.file}`, 'low', `data/${f.file} is ${f.mb} MB`, `data/${f.file} ${f.mb} MB.`, `Data files under ${THRESHOLDS.dataFileMb} MB (rewritten whole on save).`, `data/${f.file}`, `${f.mb} MB`, 'Rotate or compact the file (owner).');
  return { findings, detail: snap };
}

// ---------- Collector list (wired by index.mjs after the original collectors) ----------
export function universalCollectors() {
  const at = (env) => iso(env.now ? env.now() : Date.now());
  const runs = (env) => { const r = env.pathfinderRuns?.(); if (Array.isArray(r)) return r; return env.readJson(path.join(env.dataDir, 'pathfinder-runs.json')).runs || []; };
  const route = async (env, p, label) => { if (!env.routeExists(p)) throw new Error(`${label}: GET ${p} is not present on this node.`); return env.fetchJson(p); };
  return [
    { id: 'execution', label: 'Pathfinder run records (execution integrity)', run: async (env) => { const r = runs(env); return { findings: executionFindings(r, { now: env.now ? env.now() : Date.now() }), detail: { runs: r.length, payments: r.reduce((s, x) => s + (x.payments || []).length, 0) } }; } },
    { id: 'fills', label: 'Validated fills (launch fills + Pathfinder payments)', run: async (env) => fillFindings(fillRecords(env.launches(), runs(env))) },
    { id: 'ledger', label: 'server_info (validated ledger age)', timeoutMs: 10_000, run: async (env) => {
      if (env.offline) return ledgerFindings(null, { offline: true });
      const ready = env.ledgerReady();
      const info = ready ? await env.serverInfo() : null;
      const r = ledgerFindings(info, { ledgerReady: ready, ledgerError: env.ledgerError?.() ?? null, at: at(env) });
      // Which endpoint served server_info ("Data via QuickNode" when QUICKNODE_XRPL_WSS serves Testnet, else public).
      const source = env.serverInfoSource?.() || null;
      return source ? { ...r, detail: { ...r.detail, source } } : r;
    } },
    { id: 'fees', label: 'server_info load factor + run fees', timeoutMs: 10_000, run: async (env) => {
      const info = !env.offline && env.ledgerReady() ? await env.serverInfo().catch(() => null) : null;
      return feeFindings(info, runs(env), { at: at(env) });
    } },
    { id: 'depth', label: 'Sentinel book scans (funded depth per side)', timeoutMs: 60_000, run: async (env) => {
      if (!env.ledgerReady()) throw new Error('Testnet ledger not ready; book depth unavailable.');
      const reports = [];
      for (const l of env.launches().filter((x) => x.status === 'live')) { const r = await env.sentinel.report(l.code); if (r && !r.fetchErrors?.length) reports.push(r); }
      return depthFindings(reports, { at: at(env) });
    } },
    { id: 'inventory', label: 'Demo account balances (validated account_info)', timeoutMs: 20_000, run: async (env) => {
      if (!env.ledgerReady()) throw new Error('Testnet ledger not ready; balances unavailable.');
      const info = await env.serverInfo().catch(() => null);
      const vl = info?.validated_ledger || {};
      return inventoryFindings(await env.accounts(), { reserveBase: Number(vl.reserve_base_xrp ?? 1), reserveInc: Number(vl.reserve_inc_xrp ?? 0.2), ledger: vl.seq ?? null, at: at(env) });
    } },
    { id: 'funding-tiers', label: 'GET /api/access/participants', run: async (env) => fundingTierFindings(await route(env, '/api/access/participants', 'Access'), { at: at(env) }) },
    { id: 'x402-telemetry', label: 'GET /api/x402/telemetry (read-only)', run: async (env) => x402TelemetryFindings(await route(env, '/api/x402/telemetry', 'x402'), { at: at(env) }) },
    { id: 'api', label: 'Same-origin GET probes + /api/health', timeoutMs: 30_000, run: async (env) => {
      const paths = API_PROBES.filter((p) => env.routeExists(p));
      const probes = await Promise.all(paths.map((p) => env.probe(p)));
      const health = probes.length ? await env.fetchJson('/api/health').catch(() => null) : null;
      return apiFindings(probes, health, { at: at(env), provenance: env.offline ? 'REPLAY' : 'LIVE_TESTNET' });
    } },
    { id: 'vendors', label: 'GET /api/vendors/sentinel-signals', run: async (env) => externalSignalFindings(await route(env, '/api/vendors/sentinel-signals', 'Vendor integrations'), { source: 'vendors', endpoint: 'GET /api/vendors/sentinel-signals', product: 'Vendor integrations', at: at(env) }) },
    { id: 'xdlc', label: 'GET /api/xdlc/sentinel-signals', run: async (env) => externalSignalFindings(await route(env, '/api/xdlc/sentinel-signals', 'XDLC / capital redeployment'), { source: 'xdlc', endpoint: 'GET /api/xdlc/sentinel-signals', product: 'XDLC capital redeployment', at: at(env) }) },
    { id: 'infra', label: 'This process (uptime, memory, event loop, disk)', run: async (env) => infraFindings((env.infra || processSnapshot)({ dataDir: env.dataDir }), { at: at(env), provenance: env.offline ? 'REPLAY' : 'LIVE_TESTNET' }) },
  ];
}

// ---------- Coverage model ----------
export const SUBSYSTEMS = [
  { id: 'execution', label: 'Execution integrity', owner: 'Pathfinder owner', collectors: ['execution', 'submission'], match: (f) => /^(submission:|execution:|pathfinder:(run_failed|payment_failed))/.test(f.key) || /:ledger\.verification$/.test(f.key) },
  { id: 'fills', label: 'Validated fill classification', owner: 'Fill classification owner', collectors: ['fills'], match: (f) => /^fills:/.test(f.key) || /:activity\.demo$/.test(f.key) },
  { id: 'bc07', label: 'Historical BC-07 (reported)', owner: 'Reporting node owner', collectors: ['seeds'], match: (f) => f.key.startsWith('external:bc-07') },
  { id: 'inventory', label: 'Inventory & capital concentration', owner: 'Tokenization / Ops', collectors: ['inventory', 'tokenization', 'spokes'], match: (f) => /^inventory:|^spokes:funding/.test(f.key) || /:supply\.concentration$/.test(f.key) },
  { id: 'routing', label: 'NO_PATH routing', owner: 'Pathfinder owner', collectors: ['pathfinder'], match: (f) => /^pathfinder:no_path/.test(f.key) },
  { id: 'ledger', label: 'Stale ledger info', owner: 'Ops / lead', collectors: ['ledger'], match: (f) => /^ledger:/.test(f.key) },
  { id: 'fees', label: 'Excessive fees', owner: 'Pathfinder / loop owners', collectors: ['fees'], match: (f) => /^fees:/.test(f.key) },
  { id: 'depth', label: 'Market depth depletion', owner: 'Maker owner', collectors: ['depth', 'sentinel'], match: (f) => /^depth:/.test(f.key) || /:book\.(concentration|depth)$/.test(f.key) },
  { id: 'offers', label: 'Unfunded / stale offers', owner: 'Maker owner', collectors: ['sentinel'], match: (f) => /:book\.(unfunded|stale)$/.test(f.key) },
  { id: 'funding-tiers', label: 'Funding-tier restrictions', owner: 'TGLB / Access owners', collectors: ['funding-tiers', 'access'], match: (f) => /^(tiers:|access:)/.test(f.key) },
  { id: 'payments', label: 'Unauthorized payment requests (x402)', owner: 'x402 / Guardian owners', collectors: ['x402', 'x402-telemetry'], match: (f) => /^(x402:|code-review:x402|payauth:)/.test(f.key) },
  { id: 'delegation', label: 'Delegation & key control', owner: 'Sentinel / account owners', collectors: ['sentinel', 'tgan'], match: (f) => /:(delegate|keys)\.[\w-]+$/.test(f.key) || (f.source === 'tgan' && /authori[sz]|delegat/i.test(f.title)) },
  { id: 'lending', label: 'Lending risks (TGLB Tier 3)', owner: 'TGLB owner', collectors: ['incubator'], match: (f) => f.source === 'incubator' || /^(limitation:lending|lending:)/.test(f.key) },
  { id: 'api', label: 'API errors', owner: 'Route owners', collectors: ['api', 'x402-telemetry'], match: (f) => /^api:/.test(f.key) },
  { id: 'vendors', label: 'Vendor failures', owner: 'Vendor integrations owner', collectors: ['vendors'], match: (f) => f.source === 'vendors' || /^vendors?:/.test(f.key) },
  { id: 'infra', label: 'Infrastructure health', owner: 'Ops / lead', collectors: ['infra'], match: (f) => /^infra:/.test(f.key) },
  { id: 'redeployment', label: 'Capital-redeployment risks (XDLC)', owner: 'XDLC owner', collectors: ['xdlc'], match: (f) => f.source === 'xdlc' || /^(xdlc|redeploy)/.test(f.key) },
  { id: 'token-risk', label: 'Token configuration & identity', owner: 'Sentinel', collectors: ['sentinel'], match: (f) => /^token:/.test(f.key) },
  { id: 'advisory', label: 'TGAN advisory conduct', owner: 'TGAN owner', collectors: ['tgan'], match: (f) => f.source === 'tgan' },
  { id: 'market-structure', label: 'Mainnet flow observation', owner: 'Pathfinder owner', collectors: ['mainnet-profile'], match: (f) => /^mainnet:/.test(f.key) },
  { id: 'reports', label: 'Operator reports & stated limits', owner: 'Lead', collectors: ['seeds'], match: () => true },
];
export const SUBSYSTEM_BY_ID = Object.fromEntries(SUBSYSTEMS.map((s) => [s.id, s]));
export const classify = (f) => SUBSYSTEMS.find((s) => s.match(f)) || SUBSYSTEMS.at(-1);

export const PROVENANCE_CLASSES = ['MAINNET_OBSERVED', 'LIVE_TESTNET', 'SIMULATION', 'REPLAY', 'REPORTED', 'UNAVAILABLE'];
const REPORT_SOURCES = new Set(['operator-report', 'operator-directive', 'code-review']);
// Display provenance. Stored provenance is never rewritten (it is part of the fingerprint and hash chain):
// MAINNET_OBSERVED_READ_ONLY -> MAINNET_OBSERVED; UNAVAILABLE from a recorded report/review -> REPORTED.
export function provenanceClass(f) {
  if (f.provenance === 'MAINNET_OBSERVED_READ_ONLY') return 'MAINNET_OBSERVED';
  if (f.provenance === 'UNAVAILABLE') return REPORT_SOURCES.has(f.source) || f.verification === 'UNVERIFIED_EXTERNAL' ? 'REPORTED' : 'UNAVAILABLE';
  return f.provenance;
}

const CLOSED = new Set(['resolved', 'accepted']);
const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
const PROV_ORDER = { LIVE_TESTNET: 0, MAINNET_OBSERVED: 1, REPORTED: 2, REPLAY: 3, SIMULATION: 4, UNAVAILABLE: 5 };

// The universal record every view uses: id, severity, timestamp, evidence, affected system, provenance, owner, remediation status.
export function universalView(f) {
  const s = classify(f);
  return {
    id: f.id, key: f.key, title: f.title, severity: f.severity, timestamp: f.lastSeen || f.firstSeen, firstSeen: f.firstSeen, lastSeen: f.lastSeen, count: f.count,
    subsystem: s.id, affectedSystem: s.label, product: f.product, market: f.market,
    provenance: provenanceClass(f), provenanceRaw: f.provenance, verification: f.verification,
    owner: f.owner && f.owner !== 'unassigned' ? f.owner : s.owner, status: f.status,
    remediationStatus: (typeof f.remediation === 'string' ? 'proposed' : f.remediation?.status) || (f.status === 'open' ? 'none proposed' : f.status),
    evidenceCount: (f.evidence || []).length, evidence: (f.evidence || []).slice(0, 3).map((e) => ({ kind: e.kind, ref: e.ref, url: e.url || null })),
    evidenceNote: (f.evidence || []).length ? null : f.evidenceNote || 'Recorded report; no artifacts on this node.',
  };
}

const rank = (a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity) || PROV_ORDER[a.provenance] - PROV_ORDER[b.provenance] || String(b.timestamp).localeCompare(String(a.timestamp));

export function coverage(findings, statuses = {}, { now = Date.now(), lastRun = null } = {}) {
  const views = findings.map(universalView);
  const subsystems = SUBSYSTEMS.map((s) => {
    const mine = views.filter((v) => v.subsystem === s.id);
    const open = mine.filter((v) => !CLOSED.has(v.status));
    const sources = s.collectors.map((c) => { const st = statuses[c]; return st ? { collector: c, label: st.label, status: st.status, lastRunAt: st.lastRunAt, reason: st.reason || null, observed: st.observed ?? null, ...(st.detail?.source?.label ? { dataSource: st.detail.source.label } : {}) } : { collector: c, status: 'pending', reason: 'Collector has not run yet.' }; });
    const live = sources.filter((x) => x.status === 'connected');
    const reportedOnly = s.collectors.every((c) => c === 'seeds');
    const observed = reportedOnly ? (live.length ? 'reported' : 'pending') : live.length ? 'observed' : sources.every((x) => x.status === 'pending') ? 'pending' : 'unavailable';
    return {
      id: s.id, label: s.label, owner: s.owner, observed, lastCheck: sources.map((x) => x.lastRunAt).filter(Boolean).sort().pop() || null,
      sources, total: mine.length, openTotal: open.length,
      open: Object.fromEntries(SEV_ORDER.map((k) => [k, open.filter((v) => v.severity === k).length])),
      openByProvenance: Object.fromEntries(PROVENANCE_CLASSES.map((p) => [p, open.filter((v) => v.provenance === p).length]).filter(([, n]) => n)),
      top: open.sort(rank).slice(0, 3).map((v) => ({ id: v.id, severity: v.severity, title: v.title, provenance: v.provenance })),
      reason: observed === 'unavailable' ? sources.map((x) => x.reason).filter(Boolean).join(' | ').slice(0, 400) : null,
      dataSource: sources.map((x) => x.dataSource).find(Boolean) || null,
    };
  });
  const open = views.filter((v) => !CLOSED.has(v.status));
  return {
    statement: SENTINEL_STATEMENT, generatedAt: iso(now), lastRun,
    totals: {
      findings: views.length, open: open.length,
      byProvenance: Object.fromEntries(PROVENANCE_CLASSES.map((p) => [p, views.filter((v) => v.provenance === p).length])),
      openBySeverity: Object.fromEntries(SEV_ORDER.map((k) => [k, open.filter((v) => v.severity === k).length])),
      subsystems: subsystems.length, observed: subsystems.filter((s) => s.observed === 'observed').length, reported: subsystems.filter((s) => s.observed === 'reported').length, unavailable: subsystems.filter((s) => s.observed === 'unavailable').length,
    },
    subsystems,
    topFindings: open.sort(rank).slice(0, 6),
  };
}

// Audit history from the registry's hash-chained history (newest first). kind=status keeps status-bearing changes.
export function auditTrail(findings, { limit = 100, kind = 'all', subsystem = null } = {}) {
  const rows = [];
  for (const f of findings) {
    const s = classify(f);
    if (subsystem && s.id !== subsystem) continue;
    for (const h of f.history || []) {
      const ch = h.detail?.changes || {};
      const statusChange = ch.status ? { from: ch.status.from, to: ch.status.to } : h.action === 'recorded' ? { from: null, to: 'open' } : null;
      if (kind === 'status' && !statusChange) continue;
      if (kind === 'changes' && h.action === 'recurred' && !ch.status && !ch.severity) continue;
      rows.push({ seq: h.seq, at: h.at, findingId: f.id, title: f.title, subsystem: s.id, action: h.action, actor: h.actor, status: statusChange, severity: ch.severity ? { from: ch.severity.from, to: ch.severity.to } : null, note: h.detail?.note || null, hash: h.hash });
    }
  }
  rows.sort((a, b) => b.seq - a.seq);
  return { kind, total: rows.length, entries: rows.slice(0, Math.max(1, Math.min(500, limit))) };
}
