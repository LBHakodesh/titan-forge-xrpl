// Summary counts and the markdown technical risk report. Pure functions over registry data.
import { SEVERITIES, CLOSED_STATUSES, REAL_PROVENANCES, SIM_PROVENANCES, PROVENANCES } from './registry.mjs';

const countBy = (list, fn) => list.reduce((m, f) => { const k = fn(f); m[k] = (m[k] || 0) + 1; return m; }, {});
// Every count is split by provenance so no number is shown without its label.
const byProv = (list, fn) => list.reduce((m, f) => { const k = fn(f); (m[k] ||= Object.fromEntries(PROVENANCES.map((p) => [p, 0])))[f.provenance]++; m[k].total = (m[k].total || 0) + 1; return m; }, {});
export const realClass = (f) => (REAL_PROVENANCES.has(f.provenance) ? 'real' : SIM_PROVENANCES.has(f.provenance) || f.verification === 'SIMULATED' ? 'simulated' : 'unverified_or_unavailable');

export function summarize(findings) {
  const sev = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const f of findings) sev[f.severity]++;
  return {
    total: findings.length,
    bySeverity: sev,
    bySeverityProvenance: byProv(findings, (f) => f.severity),
    byProduct: byProv(findings, (f) => f.product),
    byMarket: byProv(findings, (f) => f.market),
    byCategory: countBy(findings, (f) => f.category),
    byStatus: countBy(findings, (f) => f.status),
    byVerification: countBy(findings, (f) => f.verification),
    byProvenance: Object.fromEntries(PROVENANCES.map((p) => [p, findings.filter((f) => f.provenance === p).length])),
    openVsResolved: { open: findings.filter((f) => !CLOSED_STATUSES.has(f.status)).length, closed: findings.filter((f) => CLOSED_STATUSES.has(f.status)).length, resolved: findings.filter((f) => f.status === 'resolved').length, accepted: findings.filter((f) => f.status === 'accepted').length },
    realVsSimulated: countBy(findings, realClass),
    occurrences: findings.reduce((s, f) => s + (f.count || 0), 0),
    note: 'real = LIVE_TESTNET or MAINNET_OBSERVED_READ_ONLY evidence; simulated = SIMULATION/REPLAY; unverified_or_unavailable = no on-node evidence (e.g. external reports, stated limitations).',
  };
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
export function markdownReport(findings, { verify, sources = [], generatedAt = new Date().toISOString(), node = 'London (TA-LON)' } = {}) {
  const s = summarize(findings);
  const L = [];
  L.push('# Titan Sentinel: technical risk report', '');
  L.push(`Generated ${generatedAt} on ${node}. Titan Sentinel observes and recommends only: it never signs, pays, moves liquidity, cancels offers, changes permissions or disables services.`, '');
  L.push('Every finding states its **verification** (CONFIRMED, SUSPECTED, SIMULATED, INFORMATIONAL, UNVERIFIED_EXTERNAL) and **provenance** (LIVE_TESTNET, MAINNET_OBSERVED_READ_ONLY, REPLAY, SIMULATION, UNAVAILABLE). Testnet and Mainnet figures are never mixed.', '');
  L.push('## Summary', '');
  L.push(`- Findings: ${s.total} (${s.occurrences} occurrences). Open ${s.openVsResolved.open}, closed ${s.openVsResolved.closed}.`);
  L.push(`- Severity: ${SEVERITIES.map((k) => `${k} ${s.bySeverity[k]}`).join(', ')}.`);
  L.push(`- Evidence class: real ${s.realVsSimulated.real || 0}, simulated ${s.realVsSimulated.simulated || 0}, unverified/unavailable ${s.realVsSimulated.unverified_or_unavailable || 0}.`);
  L.push(`- Provenance: ${Object.entries(s.byProvenance).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  if (verify) L.push(`- Evidence integrity: hash chain ${verify.ok ? 'VERIFIED' : 'FAILED'} (${verify.entries} entries, head ${String(verify.head?.hash).slice(0, 16)}…)${verify.ok ? '' : `: ${verify.problems.map((p) => p.problem).join('; ')}`}.`);
  L.push('');
  L.push('| ID | Severity | Verification | Provenance | Status | Product | Market | Title |', '|---|---|---|---|---|---|---|---|');
  for (const f of findings) L.push(`| ${f.id} | ${f.severity} | ${f.verification} | ${f.provenance} | ${f.status} | ${esc(f.product)} | ${esc(f.market)} | ${esc(f.title)} |`);
  L.push('');
  for (const f of findings) {
    L.push(`## ${f.id}: ${f.title}`, '');
    L.push(`**${f.severity.toUpperCase()}**${f.severityBasis === 'as-reported' ? ' (as reported)' : ''} · ${f.verification} · ${f.provenance} · status ${f.status} · owner ${f.owner} · seen ${f.count}× (${f.firstSeen} → ${f.lastSeen})`, '');
    L.push(`- Source: ${f.sources.join(', ')}; environment: ${f.environment}; category ${f.category}; product ${f.product}; market ${f.market}`);
    if (f.observed) L.push(`- Observed: ${f.observed}`);
    if (f.expected) L.push(`- Expected: ${f.expected}`);
    if (f.actual) L.push(`- Actual: ${f.actual}`);
    for (const x of f.facets || []) L.push(`- Facet ${x.facet}: ${x.status ? x.status + ' / ' : ''}${x.verification}. ${x.detail || ''}`);
    if (f.impact) L.push(`- Impact: ${f.impact}`);
    L.push(`- Confidence: ${f.confidence}`);
    if (f.remediation) L.push(`- Remediation (${f.remediation.status || 'proposed'}, not implemented by Sentinel): ${f.remediation.summary || ''}${f.remediation.reference ? ` See ${f.remediation.reference}.` : ''}`);
    if (f.evidence.length) { L.push('- Evidence:'); for (const e of f.evidence) L.push(`  - ${e.kind} \`${e.ref}\`${e.detail ? ` (${esc(e.detail)})` : ''}${e.url ? ` [explorer](${e.url})` : ''} [${e.provenance}]`); }
    else L.push(`- Evidence: none on this node. ${f.evidenceNote || ''}`);
    L.push(`- History: ${f.history.length} hashed entr${f.history.length === 1 ? 'y' : 'ies'}, last ${f.history.at(-1)?.action} at ${f.history.at(-1)?.at} (${String(f.history.at(-1)?.hash).slice(0, 12)}…)`, '');
  }
  if (sources.length) {
    L.push('## Telemetry sources', '', '| System | Status | Detail |', '|---|---|---|');
    for (const x of sources) L.push(`| ${esc(x.system)} | ${x.status} | ${esc(x.reason || (x.detail ? JSON.stringify(x.detail) : ''))} |`);
    L.push('');
  }
  return L.join('\n');
}
