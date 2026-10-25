// Read-only collectors for the findings registry. Each collector reads one source and returns finding inputs;
// runCollectors() isolates failures so one broken source records UNAVAILABLE and never blocks the others.
// No collector signs, submits, pays or changes any ledger, wallet, offer, permission or service.
import fs from 'node:fs';
import path from 'node:path';
import { X402_KNOWN, X402_REMEDIATION, X402_DOC, STATIC_SEEDS } from './seeds.mjs';

export const PATHFINDER_NO_PATH_KEY = (route, pair) => `pathfinder:no_path:${route}:${pair}`;
export const X402_UNAPPROVED_KEY = 'x402:live-settlement-without-independent-approval';
const pct = (x) => `${(x * 100).toFixed(x > 0.999 && x < 1 ? 3 : x > 0.99 && x < 1 ? 2 : 1)}%`;
const DEMO_ADDR = { router: 'rno84rguzSP8uPD1JhCi2tKRc2P1b4TdBH', issuer: 'rLXCWBHdR489cqwtcwai6QHEdFSkhFoFGP' };

// ---------- Ecosystem telemetry sources (from the directive). Honest status: unwired systems are UNAVAILABLE. ----------
export const SYSTEMS = [
  { id: 'sentinel-token', system: 'Titan Sentinel (token risk)', collector: 'sentinel' },
  { id: 'merchant-x402', system: 'Titan Merchant / x402', collector: 'x402' },
  { id: 'pathfinder', system: 'Pathfinder (Testnet runs)', collector: 'pathfinder' },
  { id: 'pathfinder-mainnet', system: 'Pathfinder Mainnet profile (read-only)', collector: 'mainnet-profile' },
  { id: 'xrpl-submission', system: 'XRPL submission / reconciliation', collector: 'submission' },
  { id: 'tokenization', system: 'Titan Tokenization (launch pipeline)', collector: 'tokenization' },
  { id: 'api-subscriptions', system: 'API endpoints / subscriptions (Access)', collector: 'access' },
  { id: 'corridors', system: 'Six-ring corridors', collector: 'corridor' },
  { id: 'spokes-26', system: '26 spokes (inventory / funding)', collector: 'spokes' },
  { id: 'bus', system: 'Event bus (sentinel.finding, access.*, pathfinder.*)', collector: 'bus' },
  { id: 'operator-reports', system: 'Operator reports / directive (manual)', collector: 'seeds' },
  { id: 'quoter-strategic', system: 'Quoter / Strategic engines', collector: 'engine' },
  { id: 'ring-allocation', system: 'Dynamic Ring Allocation', unavailable: 'Ring allocation runs as the temporary demo adapter (allocateRings / capital SIMULATION) and emits no risk telemetry for Sentinel on this node.' },
  { id: 'guardian-authority', system: 'Guardian / Authority', unavailable: 'Guardian is a stateless check (lib/guardian.mjs) with no decision log; Authority (independent approval records) is not implemented on this node. That gap is what the x402 finding records.' },
  { id: 'tglw-tglb', system: 'TGLW / TGLB', unavailable: 'Not deployed on the London node; no wallet-tier or lending telemetry exists here.' },
  { id: 'intelligence', system: 'Titan Intelligence / Wake / CFIE / DMSIE', unavailable: 'Not connected. The x402 "wake" resource serves demo-adapter output, not the Wake engine.' },
  { id: 'arena-view', system: 'Titan Arena / View', unavailable: 'Educational SIMULATION and a client-side visualizer; they emit no risk telemetry.' },
  { id: 'c2-infra', system: 'Infrastructure (this process: uptime, memory, event loop, disk)', collector: 'infra' },
];

// ---------- Helpers ----------
export function readJsonFile(file) {
  if (!fs.existsSync(file)) throw new Error(`${path.basename(file)} not found`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ---------- Collectors (pure over their injected env) ----------
// env: { dataDir, readJson(file), ledgerReady(), sentinel, entitlements(), engineStatus(), routeExists(path), fetchJson(path), approvals(txHash) }

export function x402Findings(runs, { approvals = () => null } = {}) {
  const out = [];
  for (const r of runs || []) {
    const settle = r.steps?.find((s) => s.step === 'SETTLEMENT')?.detail || {};
    const tx = settle.transaction || r.result?.evidence?.transaction;
    if (r.mode !== 'LIVE_TESTNET' || !settle.success || !tx) continue;
    const approval = approvals(tx);
    if (approval) continue; // an independent approval record exists: nothing to flag
    const known = X402_KNOWN[tx] || {};
    const amountDrops = Number(r.challenge?.accepts?.[0]?.amount || r.result?.settlement?.amount || 0);
    const payTo = r.challenge?.accepts?.[0]?.payTo || DEMO_ADDR.issuer;
    out.push({
      key: X402_UNAPPROVED_KEY, occurrence: tx,
      title: 'x402 live payment settled on a client-supplied approval flag (no independent human approval)',
      category: 'authorization', product: 'Titan Merchant / x402', market: `x402:${r.resource}`,
      severity: 'high', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'x402-runs', environment: 'XRPL Testnet (London node TA-LON)',
      firstSeen: known.submittedUtc || r.at, seenAt: r.at,
      observed: `Validated Testnet payment of ${amountDrops / 1e6} XRP (${amountDrops} drops) for resource "${r.resource}" from demo router to demo issuer. ${known.initiator ? known.initiator + '. ' : ''}${known.approvalClaim ? known.approvalClaim + '. ' : ''}The server's only human-approval control is body.approval === true (lib/routes/90-x402.mjs:39), checked in facilitator preflight (lib/x402/facilitator.mjs:99-106).`,
      expected: 'A live payment settles only after an independently verifiable owner approval (approver identity, exact scope, single use) that the requesting agent cannot produce itself.',
      actual: `Settlement CONFIRMED on ledger ${settle.ledger}; authorization MISSING: ${known.ownerApproval || 'no approval record exists for this transaction'}. Any process able to reach the endpoint, including an AI agent, can assert approval:true.`,
      facets: [
        { facet: 'settlement', verification: 'CONFIRMED', status: 'CONFIRMED', detail: `Validated tesSUCCESS, ledger ${settle.ledger}, tx ${tx}.` },
        { facet: 'authorization', verification: 'CONFIRMED', status: 'MISSING', detail: known.ownerApproval || 'No approval record found for this settlement.' },
        { facet: 'humanApproval', verification: 'CONFIRMED', status: 'NOT_INDEPENDENTLY_VERIFIED', detail: 'No independently verified human payment approval exists in the system: approval is a caller-supplied boolean. Folded into this finding (not counted separately).' },
        { facet: 'recurrence', verification: known.recurrence ? 'INFORMATIONAL' : 'SUSPECTED', detail: known.recurrence || 'Not assessed.' },
      ],
      affected: { accounts: [DEMO_ADDR.router, payTo], endpoints: ['POST /api/x402/live/purchase'], components: ['lib/routes/90-x402.mjs', 'lib/x402/facilitator.mjs (preflight)', 'Guardian (approved flag passed through)'] },
      confidence: 'high (ledger-validated settlement; code path read; no approval record exists)',
      impact: 'Real Testnet value moved (0.05 XRP, project-controlled accounts). The same pattern on Mainnet would let an agent spend without owner consent; a settled transaction cannot show whether it was authorized.',
      remediation: X402_REMEDIATION, owner: 'x402 / Guardian owners (lead to assign)', status: 'mitigation-proposed',
      evidence: [
        { kind: 'tx', ref: tx, detail: `Validated payment, ${amountDrops} drops`, at: r.at },
        { kind: 'ledger', ref: String(settle.ledger), detail: 'Validated ledger index of the settlement' },
        { kind: 'account', ref: DEMO_ADDR.router, detail: 'Payer (demo router)' },
        { kind: 'account', ref: payTo, detail: 'Payee (demo issuer)' },
        { kind: 'run', ref: r.id, detail: 'data/x402-runs.json run record (signed payload already redacted at source)' },
        { kind: 'file', ref: 'lib/routes/90-x402.mjs:39', detail: 'approval: body.approval === true (client-supplied)' },
        { kind: 'file', ref: 'lib/x402/facilitator.mjs:99-106', detail: 'preflight(): approval !== true is the only human-approval check' },
        { kind: 'report', ref: X402_DOC, detail: 'Security write-up; mitigation proposed, not implemented' },
      ],
      educational: { title: 'Capability is not permission', lesson: 'Every technical control passed (Testnet-only, caps, Guardian, InvoiceID, signature, replay). The missing control was human authority: a boolean the caller sets cannot prove a human said yes. Settled and authorized are separate facts; the ledger can only prove the first.' },
    });
  }
  return out;
}

export function pathfinderFindings(doc) {
  const runs = doc?.runs || [];
  const groups = new Map();
  for (const r of runs) {
    for (const p of r.payments || []) {
      if (p.status !== 'skipped' || !/^No path/i.test(p.reason || p.pathfind?.reason || '')) continue;
      const pair = [p.from, p.to].sort().join('/');
      const g = groups.get(`${p.route}|${pair}`) || { route: p.route, pair, runs: new Map(), total: 0, dirs: {}, reason: p.reason || p.pathfind?.reason };
      const rr = g.runs.get(r.id) || { run: r, payments: [] };
      rr.payments.push(p); g.runs.set(r.id, rr); g.total++;
      const d = `${p.from}→${p.to}`; g.dirs[d] = (g.dirs[d] || 0) + 1;
      groups.set(`${p.route}|${pair}`, g);
    }
  }
  const out = [];
  for (const g of groups.values()) {
    const runList = [...g.runs.values()];
    const first = runList.flatMap((x) => x.payments.map((p) => p.at)).sort()[0];
    const last = runList.flatMap((x) => x.payments.map((p) => p.at)).sort().pop();
    const lastRunAt = runList.map((x) => x.run.createdAt).sort().pop();
    // Context: later runs on the same route/pair that did find paths (real data, helps the diagnosis).
    const later = runs.filter((r) => r.createdAt > lastRunAt && (r.payments || []).some((p) => p.route === g.route && [p.from, p.to].sort().join('/') === g.pair && p.status === 'success'));
    const dirs = Object.entries(g.dirs).map(([d, n]) => `${n} ${d}`).join(', ');
    const observed = `${g.total} ${g.route} payment(s) skipped across ${runList.length} Pathfinder run(s) (${dirs}) between ${first} and ${last}: "${g.reason}". Runs: ${runList.map((x) => `${x.run.id.slice(0, 8)} ${x.run.options?.strategy} k=${x.run.options?.k}`).join('; ')}.`;
    for (const { run, payments } of runList) {
      const ats = payments.map((p) => p.at).sort();
      out.push({
        key: PATHFINDER_NO_PATH_KEY(g.route, g.pair), occurrence: run.id,
        title: `Pathfinder NO_PATH: ${g.route} ${g.pair} payments skipped (no funded liquidity path)`,
        category: 'liquidity-path', product: 'Pathfinder', market: g.pair, severity: 'medium', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET',
        source: 'pathfinder-runs', environment: 'XRPL Testnet (London node TA-LON)', firstSeen: first, seenAt: ats[ats.length - 1],
        observed,
        expected: `Testnet path finding returns at least one funded path ${g.pair.replace('/', '↔')} (auto-bridged through XRP) while the demo maker quotes both tokens.`,
        actual: `${g.total} payment(s) not sent; scorecard sent=0 for the affected runs.${later.length ? ` A later run (${later.map((r) => `${r.id.slice(0, 8)} ${r.options?.strategy} k=${r.options?.k} at ${r.createdAt}`).join('; ')}) found paths for the same route.` : ''}`,
        facets: [
          { facet: 'occurrence', verification: 'CONFIRMED', detail: `${g.total} skipped payments recorded in data/pathfinder-runs.json.` },
          { facet: 'rootCause', verification: 'SUSPECTED', detail: 'Not yet diagnosed (diagnosis in progress by another agent). Unverified candidates: no offer on one leg of the XRP bridge was funded/resting at those moments (bridge_leg and one_sided strategies quote fewer sides), or offers were consumed/cancelled between quote and pathfind. Update via setRootCause / POST /api/findings/:id/root-cause.' },
        ],
        affected: { markets: g.pair.split('/'), runs: runList.map((x) => x.run.id), components: ['lib/pathfinder/replay.mjs', 'ripple_path_find (Testnet, read)'] },
        confidence: 'high for the occurrence; low for any root cause until diagnosed',
        impact: 'Token-to-token demand shaped like the Mainnet profile could not be served by our liquidity at those moments; the run produced no capture data. Demo-only flow (organic:false).',
        remediation: { status: 'proposed', summary: 'Diagnose before changing anything: log both bridge legs (BBL/XRP and XRP/LDN book_offers with funded amounts) at each skipped pathfind. Candidate mitigations once confirmed: keep both legs quoted during token_to_token runs, or pre-check leg funding before planning.' },
        owner: 'Pathfinder owner', status: 'investigating',
        evidence: [
          { kind: 'run', ref: run.id, detail: `strategy ${run.options?.strategy}, k=${run.options?.k}, ${payments.length} skipped (${payments.map((p) => `${p.from}→${p.to} ${p.sizeXrp} XRP`).join(', ')}); ${ats[0]}–${ats[ats.length - 1]}`, at: run.createdAt },
          { kind: 'file', ref: 'data/pathfinder-runs.json', detail: 'Run and payment records (status skipped, pathfind.ok false)' },
          ...later.map((r) => ({ kind: 'context', ref: `run:${r.id}`, detail: `Later run ${r.options?.strategy} k=${r.options?.k} at ${r.createdAt}: ${(r.payments || []).filter((p) => p.status === 'success').length}/${(r.payments || []).length} payments found paths (context for diagnosis, not a resolution).` })),
        ],
      });
    }
  }
  for (const r of runs) {
    if (r.status === 'failed') out.push({ key: `pathfinder:run_failed:${r.options?.strategy || 'unknown'}`, occurrence: r.id, title: `Pathfinder run failed (${r.options?.strategy || 'unknown'})`, category: 'execution', product: 'Pathfinder', market: (r.options?.tokens || []).join('/') || '—', severity: 'medium', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'pathfinder-runs', environment: 'XRPL Testnet', seenAt: r.finishedAt || r.createdAt, observed: `Run ${r.id} ended with status failed${r.error ? `: ${r.error}` : ''}.`, expected: 'Run completes or refuses cleanly.', actual: r.error || 'failed', evidence: [{ kind: 'run', ref: r.id, detail: 'data/pathfinder-runs.json' }], remediation: { status: 'proposed', summary: 'Inspect the run actions and error before re-running.' } });
    for (const p of r.payments || []) if (p.status === 'failed') out.push({ key: `pathfinder:payment_failed:${p.route}`, occurrence: `${r.id}:${p.i}`, title: `Pathfinder payment failed on ledger (${p.route})`, category: 'execution', product: 'Pathfinder', market: [p.from, p.to].sort().join('/'), severity: 'low', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'pathfinder-runs', environment: 'XRPL Testnet', seenAt: p.at, observed: `${p.from}→${p.to} ${p.sizeXrp} XRP: ${p.result || p.reason || 'failed'}`, expected: 'tesSUCCESS', actual: p.result || 'failed', evidence: [p.hash ? { kind: 'tx', ref: p.hash, detail: p.result } : { kind: 'run', ref: r.id, detail: `payment ${p.i}` }] });
  }
  return out;
}

export function launchFindings(launches, { part = 'all' } = {}) {
  const out = [];
  for (const l of launches || []) {
    if (part !== 'tokenization') {
      if (l.status === 'failed') out.push({ key: `submission:launch_failed:${l.code}`, occurrence: l.id, title: `Launch ${l.code} failed`, category: 'submission', product: 'XRPL submission / reconciliation', market: l.code, severity: 'medium', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'launches', environment: 'XRPL Testnet', seenAt: l.createdAt, observed: `Launch ${l.id} status failed: ${l.error || 'see steps'}.`, expected: 'Launch completes and is verified.', actual: 'failed', evidence: [{ kind: 'run', ref: l.id, detail: 'data/launches.json' }] });
      for (const s of l.steps || []) if (s.hash && s.result && s.result !== 'tesSUCCESS') out.push({ key: `submission:step_not_success:${l.code}:${s.key}`, occurrence: s.hash, title: `${l.code} launch step "${s.key}" recorded ${s.result}`, category: 'submission', product: 'XRPL submission / reconciliation', market: l.code, severity: 'high', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'launches', environment: 'XRPL Testnet', seenAt: s.startedAt, observed: `${s.label}: ${s.result}`, expected: 'tesSUCCESS', actual: s.result, evidence: [{ kind: 'tx', ref: s.hash }, { kind: 'ledger', ref: String(s.ledger) }] });
    }
    if (part !== 'submission' && l.status === 'live') {
      const v = l.steps?.find((s) => s.key === 'verify')?.detail;
      if (!v || !(l.supply > 0)) continue;
      const share = Number(v.makerTokens) / Number(l.supply);
      if (!(share > 0.5)) continue;
      const fill = l.steps.find((s) => s.key === 'fill'); const issue = l.steps.find((s) => s.key === 'issue');
      const providers = new Set([...(v.book?.asks || []), ...(v.book?.bids || [])].map((o) => o.account));
      const maker = [...providers][0] || null;
      out.push({
        key: `token:${l.code}:supply.concentration`, occurrence: `launch:${l.id}:verify`,
        title: `${l.code}: demo maker holds ${pct(share)} of supply (concentrated inventory)`,
        category: 'liquidity-concentration', product: 'Tokenization (Titan Forge launch)', market: l.code,
        severity: 'high', verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'launches', environment: 'XRPL Testnet (London node TA-LON)',
        firstSeen: v && fill?.startedAt, seenAt: l.steps.find((s) => s.key === 'verify')?.startedAt,
        observed: `At launch verification (ledger ${fill?.ledger}), the maker held ${v.makerTokens} of ${l.supply} ${l.code} (${pct(share)}); the taker held ${v.takerTokens}. ${providers.size === 1 ? 'The only order-book provider was the same maker account.' : `${providers.size} book providers.`} Snapshot from data/launches.json; Sentinel live scans update it.`,
        expected: 'No single account can move the price or dump most of the supply on holders (Sentinel rule: top holder > 50% = high).',
        actual: `Top holder ${pct(share)} (maker, a project-controlled demo account). Launch record organic=${l.organic}.`,
        affected: { accounts: maker ? [maker, v.issuer || l.issuer].filter(Boolean) : [l.issuer], markets: [l.code] },
        confidence: 'high (validated ledger balances at launch); current share may differ after Pathfinder demo trades',
        impact: 'By design for a fresh demo launch (maker inventory), but any holder faces a single account that controls price and supply. Must not be read as distributed ownership or organic demand.',
        remediation: { status: 'proposed', summary: 'Disclose maker inventory on every market view; for any non-demo launch, distribute or lock inventory and add independent liquidity providers before claiming market depth.' },
        owner: 'Tokenization / Sentinel', status: 'open',
        evidence: [
          issue?.hash && { kind: 'tx', ref: issue.hash, detail: `Issue ${l.supply} ${l.code} to maker (ledger ${issue.ledger})` },
          fill?.hash && { kind: 'tx', ref: fill.hash, detail: `Controlled demo fill (ledger ${fill.ledger})` },
          fill?.ledger && { kind: 'ledger', ref: String(fill.ledger), detail: 'Ledger of the verified snapshot' },
          maker && { kind: 'account', ref: maker, detail: 'Maker (holder of the inventory, only book provider)' },
          { kind: 'metric', ref: `${l.code}:makerShare`, detail: `${v.makerTokens}/${l.supply} = ${pct(share)}` },
          { kind: 'file', ref: 'data/launches.json', detail: `launch ${l.id} verify step` },
        ].filter(Boolean),
      });
    }
  }
  return out;
}

export function mainnetProfileFindings(p) {
  const all = p?.pathfoundAll, partial = p?.partial;
  if (!all || !partial) throw new Error('mainnet-profile.json has no pathfoundAll/partial aggregates');
  const endUser = p.endUser?.count ?? 0;
  const amm = all.ammInvolved?.share ?? 0, top5 = all.makerCapture?.top5Share ?? 0;
  const w = p.window || {};
  return [{
    key: 'mainnet:pathfinder:flow-composition', occurrence: p.sampledAt,
    title: `Mainnet pathfound flow: ${partial.count} of ${all.count} were partial payments, ${endUser} full third-party deliveries`,
    category: 'market-structure', product: 'Pathfinder', market: 'XRPL Mainnet (all pairs sampled)',
    severity: 'info', verification: 'CONFIRMED', provenance: 'MAINNET_OBSERVED_READ_ONLY', source: 'mainnet-profile', environment: 'XRPL Mainnet (read-only observer, no wallet)',
    firstSeen: p.sampledAt, seenAt: p.sampledAt,
    observed: `Sample of ledgers ${w.fromLedger}–${w.toLedger} (${w.fromTime} to ${w.toTime}${w.truncated ? ', truncated' : ''}): ${all.count} pathfound cross-currency payments; ${partial.count} used tfPartialPayment (automated/bot-style flow), ${p.circular?.count ?? 0} circular, ${endUser} full deliveries to a third party. ${pct(amm)} touched an AMM; top 5 liquidity providers captured ${pct(top5)} of filled value (HHI ${all.makerCapture?.hhi}).`,
    expected: 'Context only: shows what Mainnet path-finding demand looks like before sizing any strategy against it.',
    actual: `Flow is dominated by partial-payment bots and concentrated providers, not end-user payments. ${p.totals?.pathfoundShareOfPayments != null ? `Pathfound share of all payments: ${pct(p.totals.pathfoundShareOfPayments)}.` : ''}`,
    confidence: 'medium (single ~2-minute sample; truncated window)', impact: 'Do not present Mainnet pathfinding volume as organic payment demand; capture would compete with a few incumbent bots and AMMs.',
    remediation: { status: 'proposed', summary: 'Keep Mainnet figures labeled MAINNET_OBSERVED and never mixed with Testnet; take more samples before relying on the shape.' },
    owner: 'Pathfinder owner', status: 'open',
    evidence: [
      { kind: 'file', ref: 'data/mainnet-profile.json', detail: `sampledAt ${p.sampledAt}` },
      { kind: 'ledger', ref: `${w.fromLedger}-${w.toLedger}`, detail: 'Mainnet ledger range sampled (read-only)' },
      { kind: 'metric', ref: 'pathfoundAll.count', detail: String(all.count) },
      { kind: 'metric', ref: 'partial.count', detail: String(partial.count) },
      { kind: 'metric', ref: 'endUser.count', detail: String(endUser) },
      { kind: 'metric', ref: 'pathfoundAll.ammInvolved.share', detail: String(amm) },
      { kind: 'metric', ref: 'pathfoundAll.makerCapture.top5Share', detail: String(top5) },
    ],
  }];
}

const SENTINEL_CAT = (id) => ({ issuer: 'token-config', keys: 'key-control', delegate: 'key-control', supply: 'liquidity-concentration', book: 'liquidity-concentration', activity: 'demo-activity', identity: 'identity', ledger: 'reconciliation', trustlines: 'trustlines' })[id.split('.')[0]] || 'token-risk';
export function sentinelFindings(report) {
  // High/medium always; low only for the offer-funding, offer-age and delegation checks the coverage map tracks.
  return (report.findings || []).filter((x) => x.severity === 'high' || x.severity === 'medium' || (x.severity === 'low' && /^(book\.(unfunded|stale)|delegate\.)/.test(x.id))).map((x) => ({
    key: `token:${report.code}:${x.id}`, occurrence: `${x.severity}|${x.title}`,
    title: `${report.code}: ${x.title}`, category: SENTINEL_CAT(x.id),
    product: x.id.startsWith('ledger.') ? 'XRPL submission / reconciliation' : 'Tokenization (Titan Forge launch)', market: report.code,
    severity: x.severity, verification: 'CONFIRMED', provenance: 'LIVE_TESTNET', source: 'sentinel', environment: 'XRPL Testnet (validated ledger reads)',
    seenAt: report.scannedAt, observed: x.evidence, expected: x.whatItProtects, actual: x.title, impact: x.limits ? `Limits: ${x.limits}` : '',
    confidence: 'high (validated ledger read)', owner: 'Sentinel',
    remediation: { status: 'proposed', summary: 'Review with the token owner; Sentinel only reports and never changes the account or the book.' },
    evidence: [
      { kind: 'ledger', ref: String(report.validatedLedger), detail: `Sentinel scan ${report.scannedAt}` },
      { kind: 'endpoint', ref: `GET /api/sentinel/${report.code}`, detail: `finding ${x.id}` },
      ...(x.links || []).map((l) => ({ kind: /transactions/.test(l.href) ? 'tx' : 'account', ref: l.href.split('/').pop(), detail: l.label, url: l.href })),
    ],
  }));
}

const SPOKE_PROV = { MAINNET_OBSERVED: 'MAINNET_OBSERVED_READ_ONLY', TESTNET_FUNDED: 'LIVE_TESTNET', TESTNET_CANDIDATE: 'LIVE_TESTNET', LIVE_TESTNET: 'LIVE_TESTNET', SIMULATION: 'SIMULATION', REPLAY: 'REPLAY' };
// Placeholder 26-spoke monitor over GET /api/spokes (shape owned by the spokes agent: { groups:{A:{spokes:[]},…} } or { spokes:[] }).
// Never guesses provenance: values without a recognized mode label produce no findings.
export function spokesFindings(body) {
  const list = Array.isArray(body) ? body : Array.isArray(body?.spokes) ? body.spokes
    : body?.groups && typeof body.groups === 'object' ? Object.values(body.groups).flatMap((g) => (Array.isArray(g?.spokes) ? g.spokes : [])) : null;
  if (!list) throw new Error('GET /api/spokes returned no spokes[] array');
  const real = list.filter((x) => x && !x.placeholder);
  const statusCounts = list.reduce((m, x) => { const k = x?.status || 'unknown'; m[k] = (m[k] || 0) + 1; return m; }, {});
  const detail = { spokes: list.length, withData: real.length, statuses: Object.entries(statusCounts).map(([k, v]) => `${k} ${v}`).join(', ') };
  const findings = [];
  // Per-spoke alerts are eligibility screening of (mostly third-party) assets, not Titan risk: counted, not imported.
  detail.alertsMediumPlus = real.reduce((n, sp) => n + (sp.alerts || []).filter((a) => ['critical', 'high', 'medium'].includes(a?.severity)).length, 0);
  // 2) Funding concentration across spokes.
  const field = ['fundedXrp', 'fundingXrp', 'inventoryXrp', 'balanceXrp', 'valueXrp', 'xrp', 'fundedUsd', 'inventoryUsd', 'usd'].find((k) => real.some((x) => Number.isFinite(Number(x?.[k]))));
  let vals, provenance, label;
  if (field) { vals = real.map((x) => ({ id: x.id ?? x.code ?? x.name ?? '?', v: Math.max(0, Number(x[field]) || 0) })); provenance = SPOKE_PROV[body?.mode]; label = field; }
  else if (real.some((x) => Number.isFinite(Number(x?.corridor?.modeledNotionalUsd)))) {
    const modes = new Set(real.map((x) => x.corridor?.mode).filter(Boolean));
    provenance = modes.size === 1 ? SPOKE_PROV[[...modes][0]] : undefined; label = 'corridor.modeledNotionalUsd';
    vals = real.map((x) => ({ id: x.id ?? x.name ?? '?', v: Math.max(0, Number(x.corridor?.modeledNotionalUsd) || 0) }));
  }
  detail.field = label || null;
  if (!vals) { detail.note = 'No recognized funding field; no concentration finding derived.'; return { findings, detail }; }
  if (!provenance) { detail.note = 'Funding values have no single recognized mode label; no concentration finding derived (never guess provenance).'; return { findings, detail }; }
  const total = vals.reduce((a, b) => a + b.v, 0);
  if (!total || list.length < 2) { detail.note = 'No funded spokes with values; no concentration finding derived.'; return { findings, detail }; }
  vals.sort((a, b) => b.v - a.v);
  const top = vals[0], share = top.v / total, funded = vals.filter((x) => x.v > 0).length;
  detail.topShare = Number(share.toFixed(4)); detail.funded = funded;
  if (share > 0.5) findings.push({
    key: `spokes:funding-concentration:${label}`, occurrence: `${top.id}|${share.toFixed(3)}|${funded}`,
    title: `Spoke funding concentrated: ${top.id} holds ${pct(share)} of ${label} (${funded} of ${list.length} spokes funded)`, category: 'liquidity-concentration', product: '26 spokes', market: String(top.id),
    severity: share > 0.8 ? 'high' : 'medium', verification: provenance === 'SIMULATION' || provenance === 'REPLAY' ? 'SIMULATED' : 'CONFIRMED', provenance, source: 'spokes', environment: 'GET /api/spokes',
    observed: `${funded} of ${list.length} spokes funded; top ${top.id} ${top.v} of ${total} (${pct(share)}).`, expected: 'Funding spread across spokes.', actual: `${pct(share)} in one spoke.`,
    evidence: [{ kind: 'endpoint', ref: 'GET /api/spokes', detail: `${label} by spoke` }], remediation: { status: 'proposed', summary: 'Review spoke funding plan; Sentinel does not move funds.' },
  });
  return { findings, detail };
}

export function accessFindings(ent) {
  const p = ent?.policy;
  if (!p) throw new Error('Entitlements policy not available');
  const out = [];
  out.push({
    key: 'access:threshold-not-approved', occurrence: `${p.thresholdSource}|${p.thresholdUsd}`,
    title: `Free-liquidity threshold is a demo setting (${p.thresholdUsd} USD, source ${p.thresholdSource}), not an approved value`,
    category: 'policy', product: 'API endpoints / subscriptions (Access)', market: '—', severity: 'info', verification: 'INFORMATIONAL', provenance: 'SIMULATION',
    source: 'access', environment: 'this node (entitlement policy in memory)',
    observed: `Access policy thresholdUsd=${p.thresholdUsd} from ${p.thresholdSource}; grace ${p.graceHours}h; XRP/USD ${p.xrpUsd} (illustrative).`,
    expected: 'Commercial thresholds approved and sourced before any participant is billed.', actual: 'Demonstration settings; no billing provider connected.',
    confidence: 'high (read from the running policy)', impact: 'Threshold and plan outcomes in the demo are illustrative only.',
    remediation: { status: 'proposed', summary: 'Keep labeling the threshold as an example until approved.' },
    evidence: [{ kind: 'file', ref: 'lib/entitlement/policy.mjs:8', detail: 'DEMO_THRESHOLD_USD (example, not approved)' }, { kind: 'endpoint', ref: 'GET /api/access/policy', detail: 'live policy view' }],
  });
  return out;
}

// Bus event -> finding input (or null). Events the registry itself emits (findings.*) are ignored by the caller.
export function findingFromEvent(ev) {
  const prov = { LIVE_TESTNET: 'LIVE_TESTNET', SIMULATION: 'SIMULATION', REPLAY: 'REPLAY', MAINNET_OBSERVED: 'MAINNET_OBSERVED_READ_ONLY' }[ev?.mode];
  if (!prov) return null;
  const sim = prov === 'SIMULATION' || prov === 'REPLAY';
  const verification = sim ? 'SIMULATED' : 'CONFIRMED';
  if (ev.type === 'sentinel.finding' && ev.code && ev.findingId) return {
    key: `token:${ev.code}:${ev.findingId}`, occurrence: `${ev.severity}|${ev.title}`, title: `${ev.code}: ${ev.title}`, category: SENTINEL_CAT(ev.findingId),
    product: ev.findingId.startsWith('ledger.') ? 'XRPL submission / reconciliation' : 'Tokenization (Titan Forge launch)', market: ev.code,
    severity: ['high', 'medium', 'low', 'info', 'critical'].includes(ev.severity) ? ev.severity : 'info', verification, provenance: prov, source: 'bus:sentinel.finding', environment: 'XRPL Testnet', seenAt: ev.at,
    observed: ev.title, evidence: [{ kind: 'endpoint', ref: `GET /api/sentinel/${ev.code}`, detail: `sentinel.finding ${ev.findingId}` }],
  };
  if (ev.type === 'access.decision' && ev.decision === 'deny') return {
    key: `access:deny:${ev.resource}`, occurrence: `${ev.participantId}@${ev.at}`, title: `Access denied for resource ${ev.resource}`, category: 'access', product: 'API endpoints / subscriptions (Access)', market: '—',
    severity: 'low', verification, provenance: prov, source: 'bus:access.decision', environment: 'this node', seenAt: ev.at,
    observed: `Participant ${ev.participantId} denied ${ev.resource}: ${ev.reason}`, expected: 'Denials are rare and explained.', actual: ev.reason,
    evidence: [{ kind: 'endpoint', ref: 'access.decision', detail: `${ev.participantId} ${ev.resource} at ${ev.at}`, at: ev.at }],
  };
  if (ev.type === 'access.threshold_crossed') return {
    key: `access:threshold_crossed:${ev.participantId}`, occurrence: `${ev.from}->${ev.to}@${ev.at}`, title: `Participant ${ev.participantId} crossed the free-liquidity threshold (${ev.from} → ${ev.to})`, category: 'access', product: 'API endpoints / subscriptions (Access)', market: '—',
    severity: 'info', verification, provenance: prov, source: 'bus:access.threshold_crossed', environment: 'this node', seenAt: ev.at,
    observed: `qualifying ${ev.qualifyingUsd} USD vs threshold ${ev.thresholdUsd} USD`, evidence: [{ kind: 'endpoint', ref: 'access.threshold_crossed', detail: `${ev.participantId} at ${ev.at}`, at: ev.at }],
  };
  if (ev.type === 'access.policy_changed') return {
    key: 'access:policy_changed', occurrence: ev.at, title: 'Access policy changed at runtime', category: 'policy', product: 'API endpoints / subscriptions (Access)', market: '—',
    severity: 'info', verification, provenance: prov, source: 'bus:access.policy_changed', environment: 'this node', seenAt: ev.at,
    observed: `threshold ${ev.thresholdUsd} USD (${ev.thresholdSource}), grace ${ev.graceHours}h`, evidence: [{ kind: 'endpoint', ref: 'access.policy_changed', detail: `at ${ev.at}`, at: ev.at }],
  };
  if (ev.type === 'pathfinder.run_failed') return {
    key: 'pathfinder:run_failed:bus', occurrence: ev.runId, title: 'Pathfinder run failed', category: 'execution', product: 'Pathfinder', market: '—',
    severity: 'medium', verification, provenance: prov, source: 'bus:pathfinder.run_failed', environment: 'XRPL Testnet', seenAt: ev.at,
    observed: String(ev.error || 'failed'), evidence: [{ kind: 'run', ref: String(ev.runId), detail: 'pathfinder.run_failed event' }],
  };
  return null;
}


// ---------- Incubator / TGAN SIMULATION signals (wired by lead) ----------
const asEvidence = (ev) => (Array.isArray(ev) ? ev : ev == null ? [] : [ev]).slice(0, 10).map((e) =>
  e && typeof e === 'object' && e.kind ? e : { kind: 'note', ref: typeof e === 'string' ? e.slice(0, 200) : JSON.stringify(e).slice(0, 200), detail: 'signal evidence' });
export function signalFindings(list, { source, environment = 'London staging (SIMULATION)' } = {}) {
  return (list || []).filter((s) => s && s.key && s.title).map((s) => ({
    key: s.key, title: s.title, category: s.category || 'simulation', product: s.product || 'unknown', market: s.market || '—',
    severity: ['critical', 'high', 'medium', 'low', 'info'].includes(s.severity) ? s.severity : 'info',
    verification: 'SIMULATED', provenance: 'SIMULATION', source, environment, occurrence: 'current',
    observed: typeof s.detail === 'string' ? s.detail : s.detail ? JSON.stringify(s.detail).slice(0, 600) : s.title,
    evidence: asEvidence(s.evidence), remediation: s.remediation || (s.recommendation ? { status: 'proposed', summary: String(s.recommendation) } : undefined),
  }));
}

// ---------- Collector registry ----------
export function defaultCollectors() {
  return [
    { id: 'x402', label: 'data/x402-runs.json', run: async (env) => ({ findings: x402Findings(env.readJson(path.join(env.dataDir, 'x402-runs.json')), env), detail: { file: 'data/x402-runs.json' } }) },
    { id: 'pathfinder', label: 'data/pathfinder-runs.json', run: async (env) => { const d = env.readJson(path.join(env.dataDir, 'pathfinder-runs.json')); return { findings: pathfinderFindings(d), detail: { file: 'data/pathfinder-runs.json', runs: d.runs?.length ?? 0 } }; } },
    { id: 'mainnet-profile', label: 'data/mainnet-profile.json', run: async (env) => ({ findings: mainnetProfileFindings(env.readJson(path.join(env.dataDir, 'mainnet-profile.json'))), detail: { file: 'data/mainnet-profile.json' } }) },
    { id: 'submission', label: 'data/launches.json (step results)', run: async (env) => { const l = env.readJson(path.join(env.dataDir, 'launches.json')); return { findings: launchFindings(l, { part: 'submission' }), detail: { launches: l.length, steps: l.reduce((s, x) => s + (x.steps || []).filter((st) => st.hash).length, 0) } }; } },
    { id: 'tokenization', label: 'data/launches.json (verify snapshot)', run: async (env) => { const l = env.readJson(path.join(env.dataDir, 'launches.json')); return { findings: launchFindings(l, { part: 'tokenization' }), detail: { live: l.filter((x) => x.status === 'live').map((x) => x.code) } }; } },
    { id: 'seeds', label: 'lib/findings/seeds.mjs (operator reports)', run: async () => ({ findings: STATIC_SEEDS, detail: { seeds: STATIC_SEEDS.length } }) },
    { id: 'access', label: 'Access entitlement module (in-process, read-only)', run: async (env) => { const ent = env.entitlements(); return { findings: accessFindings(ent), detail: { participants: ent.participants?.size ?? 0, thresholdSource: ent.policy?.thresholdSource } }; } },
    { id: 'corridor', label: 'data/corridor.json', run: async (env) => { const d = env.readJson(path.join(env.dataDir, 'corridor.json')); return { findings: [], detail: { tokens: Object.keys(d.tokens || {}).length, note: 'Read-only; no corridor risk rules defined yet, so no findings are derived.' } }; } },
    { id: 'engine', label: 'lib/engine (engine seam)', run: async (env) => { const s = env.engineStatus(); throw new Error(`No risk telemetry feed from the Quoter/Strategic engines on this node. Active engine: ${s?.active || 'unknown'}${s?.rust ? '' : ' (temporary demo adapter; Rust engines not connected)'}.`); } },
    { id: 'sentinel', label: 'lib/sentinel.mjs (validated Testnet reads)', timeoutMs: 60_000, run: async (env) => {
      if (!env.ledgerReady()) throw new Error('Testnet ledger not ready; Sentinel token scan unavailable.');
      const live = env.launches().filter((l) => l.status === 'live');
      const findings = []; const scanned = []; const skipped = [];
      for (const l of live) {
        const r = await env.sentinel.report(l.code);
        if (!r) continue;
        // Partial reads would produce false findings (e.g. an "empty" book); import only complete scans.
        if (r.fetchErrors?.length || r.verification?.some((v) => v.error)) { skipped.push({ code: r.code, errors: (r.fetchErrors || []).slice(0, 3) }); continue; }
        findings.push(...sentinelFindings(r)); scanned.push({ code: r.code, ledger: r.validatedLedger, cached: !!r.cached });
      }
      if (live.length && !scanned.length) throw new Error(`Sentinel scans incomplete for every token (${skipped.map((x) => `${x.code}: ${x.errors.join('; ') || 'tx re-verification failed'}`).join(' | ')}); nothing imported.`);
      return { findings, detail: { scanned, skipped } };
    } },
    { id: 'spokes', label: 'GET /api/spokes', run: async (env) => {
      if (!env.routeExists('/api/spokes')) throw new Error('GET /api/spokes is not present on this node yet (another agent is building it).');
      const r = spokesFindings(await env.fetchJson('/api/spokes'));
      return { findings: r.findings, detail: r.detail };
    } },
    { id: 'incubator', label: 'GET /api/incubator/sentinel-signals', run: async (env) => {
      if (!env.routeExists('/api/incubator/sentinel-signals')) throw new Error('Project Incubator route not present on this node.');
      const r = await env.fetchJson('/api/incubator/sentinel-signals');
      return { findings: signalFindings(r.signals, { source: 'incubator' }), detail: { signals: r.signals?.length ?? 0, mode: r.mode } };
    } },
    { id: 'tgan', label: 'GET /api/tgan/sentinel-signals', run: async (env) => {
      if (!env.routeExists('/api/tgan/sentinel-signals')) throw new Error('TGAN route not present on this node.');
      const r = await env.fetchJson('/api/tgan/sentinel-signals');
      return { findings: signalFindings(r.signals, { source: 'tgan' }), detail: { signals: r.signals?.length ?? 0, mode: r.mode } };
    } },
  ];
}

function withTimeout(p, ms, id) {
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${id} timed out after ${ms} ms`)), ms); });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
}

// Runs every collector; a throwing/slow collector becomes { status: 'unavailable', provenance: 'UNAVAILABLE' }.
export async function runCollectors(registry, collectors, env, { only = null, now = () => Date.now() } = {}) {
  const statuses = {};
  for (const c of collectors) {
    if (only && !only.includes(c.id)) continue;
    const at = new Date(now()).toISOString();
    try {
      const r = await withTimeout(Promise.resolve().then(() => c.run(env)), c.timeoutMs || 15_000, c.id);
      let created = 0, updated = 0, rejected = 0; const errors = [];
      for (const input of r.findings || []) {
        try { const o = registry.record(input, { actor: `collector:${c.id}` }); if (o.created) created++; else if (o.changed) updated++; }
        catch (e) { rejected++; errors.push(e.message); }
      }
      statuses[c.id] = { id: c.id, label: c.label, status: 'connected', lastRunAt: at, observed: (r.findings || []).length, created, updated, rejected, errors: errors.slice(0, 5), detail: r.detail || null };
    } catch (e) {
      statuses[c.id] = { id: c.id, label: c.label, status: 'unavailable', provenance: 'UNAVAILABLE', lastRunAt: at, reason: String(e?.message || e).slice(0, 400) };
    }
  }
  return statuses;
}

export function systemsView(statuses, { bus = null } = {}) {
  return SYSTEMS.map((s) => {
    if (s.unavailable) return { id: s.id, system: s.system, status: 'unavailable', provenance: 'UNAVAILABLE', reason: s.unavailable };
    if (s.collector === 'bus') return bus ? { id: s.id, system: s.system, status: bus.attached ? 'connected' : 'unavailable', detail: { seen: bus.seen, ingested: bus.ingested, errors: bus.errors }, reason: bus.attached ? null : 'not attached' } : { id: s.id, system: s.system, status: 'unavailable', reason: 'not attached' };
    const st = statuses[s.collector];
    if (!st) return { id: s.id, system: s.system, status: 'unavailable', provenance: 'UNAVAILABLE', reason: 'Collector has not run yet.' };
    return { ...st, id: s.id, system: s.system, collector: s.collector };
  });
}
