# TG Sentinel: universal observability

**TG Sentinel records and recommends. It does not authorize spending, sign transactions or move capital.**
No collector or route can submit a transaction, pay, place or cancel an offer, or change permissions.
Every finding comes from observed state or a recorded report, and carries its evidence and provenance.

## Where it lives
| Part | File |
|---|---|
| Registry (append-only, SHA-256 hash chain) | `lib/findings/registry.mjs` |
| Original collectors (x402 runs, Pathfinder, launches, Mainnet profile, Sentinel scans, spokes, incubator, TGAN, seeds) | `lib/findings/collectors.mjs` |
| Universal collectors, coverage model, audit trail | `lib/findings/universal.mjs` |
| Service (collect every 10 min, plus bus ingestion) | `lib/findings/index.mjs`, wired in `lib/routes/55-findings.mjs` |
| Universal endpoints | `lib/routes/50-sentinel.mjs` |
| UI | `public/modules/50-sentinel.js` (TG Sentinel tab, top section); full records in `55-findings.js` |

## Endpoints (read-only GETs)
- `GET /api/sentinel/coverage`: `{statement, lastRun, totals{findings, open, byProvenance, openBySeverity, observed, reported, unavailable}, subsystems[{id, label, owner, observed, lastCheck, sources[], open{critical..info}, openByProvenance, top[], reason}], topFindings[]}`
- `GET /api/sentinel/findings[?subsystem=&provenance=&severity=&status=&q=]`: universal records (below).
- `GET /api/sentinel/audit[?kind=changes|status|all&limit=&subsystem=]`: newest-first entries from the registry history (`seq, at, findingId, action, actor, status{from,to}, severity, note, hash`).
- Existing: `/api/findings[/:id|/summary|/sources|/verify|/report]`. `/api/findings` rows now also carry `provenanceClass` and `subsystem`.

## Universal finding record
`id, severity, timestamp (lastSeen), evidence (count + first 3), affectedSystem, provenance, owner, remediationStatus`, plus `verification, status, firstSeen, count, product, market`.
Provenance classes: `MAINNET_OBSERVED`, `LIVE_TESTNET`, `SIMULATION`, `REPLAY`, `REPORTED` (plus `UNAVAILABLE`).
Stored provenance is never rewritten, because it is part of the fingerprint and hash chain. `REPORTED` is a display class: a stored `UNAVAILABLE` finding from an operator report, directive or code review. `MAINNET_OBSERVED_READ_ONLY` shows as `MAINNET_OBSERVED`.
Evidence rule: every collector-produced finding has at least one evidence item (tests enforce this). Recorded reports with no on-node artifacts, such as BC-07, show `evidenceCount 0` and an explicit note.

## Coverage map (subsystem → collectors)
| Subsystem | Collectors | Source |
|---|---|---|
| Execution integrity | execution, submission | Pathfinder run rows (success needs validated tesSUCCESS, hash and ledger; scorecard = rows; no run stuck > 2h); launch step results |
| Validated fill classification | fills | launch fills and Pathfinder payments (same set as `/api/loop/catches`): validated, `organic:false`, classifiable size, attributed |
| Historical BC-07 | seeds | operator report: **reported, not reproduced** (`UNVERIFIED_EXTERNAL`, no evidence on London) |
| Inventory & capital concentration | inventory, tokenization, spokes | demo account XRP vs reserve (`account_info`, via Sentinel's 30 s read cache); maker share of supply; spoke funding |
| NO_PATH routing | pathfinder | `data/pathfinder-runs.json` skipped payments |
| Stale ledger info | ledger | `server_info` validated_ledger.age (> 60 s medium, > 300 s high); Testnet unavailable (not in offline mode or while bootstrapping) |
| Excessive fees | fees | `server_info` load_factor / open-ledger fee; per-run `feeXrp`; path cost > 200 bps over mid |
| Market depth depletion | depth, sentinel | funded depth per side from complete Sentinel book scans (side empty = medium, total < 1 XRP = low) |
| Unfunded / stale offers | sentinel | token scan `book.unfunded` / `book.stale` (low severity now imported) |
| Funding-tier restrictions | funding-tiers, access | `GET /api/access/participants` (Tier 3 not permitted; above free threshold without a plan) |
| Unauthorized payment requests | x402, x402-telemetry | settled x402 payment with only a client-supplied approval flag (TS-0001); code-review finding about the client-supplied participant id (kept as a REPORTED finding); refused requests and settlement failures from `GET /api/x402/telemetry`. x402 code is not changed. |
| Delegation & key control | sentinel, tgan | Delegate objects and RegularKey (token scans); TGAN advisor authorization (SIMULATION) |
| Lending risks | incubator | `GET /api/incubator/sentinel-signals` (SIMULATION) |
| API errors | api, x402-telemetry | same-origin GET probes (5 s timeout, 5xx or timeout); `/api/health` skippedRoutes; x402 server errors |
| Vendor failures | vendors | `GET /api/vendors/sentinel-signals` (shown as unavailable until the route exists) |
| Infrastructure health | infra | this process: RSS, heap ratio, event-loop p99, disk free, data-file size |
| Capital-redeployment risks | xdlc | `GET /api/xdlc/sentinel-signals` |
| Token configuration, TGAN advisory, Mainnet flow, operator reports | sentinel, tgan, mainnet-profile, seeds | existing |

Status per subsystem: `observed` (a collector connected), `reported` (seeds only), `unavailable` (with the reason), `pending` (not run yet).

## Rules for collectors
- Pure functions over injected inputs (`executionFindings(runs)`, `ledgerFindings(info, …)`, `depthFindings(reports)` and so on), unit-tested in `test/sentinel-coverage.test.mjs`.
- A missing or slow source throws inside its collector. `runCollectors` records it as UNAVAILABLE in the coverage map, never as a finding (no spam). Other collectors keep running.
- Live-state findings use an hour or day bucket as the occurrence. A persistent condition recurs at most once per bucket, and the same state never counts again.
- Sentinel never auto-resolves a finding. Status changes go through `POST /api/findings/:id/status` (localhost only) and are hash-chained into history.
- External signal feeds (vendors, XDLC): the provenance is taken from the signal (`MAINNET_OBSERVED`, `LIVE_TESTNET`, `SIMULATION`, `REPLAY`), defaulting to SIMULATION. SIMULATION is never CONFIRMED. The source endpoint is always attached as evidence.
- Thresholds: `THRESHOLDS` in `lib/findings/universal.mjs`.

## Presentation
`window.dispatchEvent(new CustomEvent('tf:present', {detail:{scene:'sentinel'}}))`, or `api.present('sentinel','sentinel')`, scrolls to the coverage map and highlights it and the top findings.
