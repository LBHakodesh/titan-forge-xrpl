# Titan Forge — build contract

Isolated London hackathon staging app (Oct 24–25, 2026). Node 22, no framework, `xrpl@4.7.0`.
Server: `node server.mjs` on `127.0.0.1:4131`. Tests: `node --test test/*.test.mjs`.

**Spec exception:** Testnet-only demo keys on TA-LON are an operator-approved exception, see `docs/SPEC_EXCEPTION_TESTNET_KEYS.md`. Never extend it to Mainnet or production credentials.

## Hard rules
1. **XRPL Testnet only.** All signing goes through `Ledger.submit()` in `lib/ledger.mjs`, which asserts network_id 1. Never add another network URL. No Mainnet, nothing published to gyw1313.com.
2. **Modes are explicit.** Every number shown to a visitor carries `LIVE_TESTNET`, `SIMULATION` or `REPLAY` (`api.badge(mode)` in UI; `bus.publish(type, mode, …)` on the server). Hypothetical capital or fills never show as live.
3. **Demo activity ≠ organic demand.** All accounts we control are demo accounts. Launch records have `organic: false`.
4. **No secrets leave the server.** Seeds live in `data/wallets.json` (0600). Expose addresses only.
5. **No proprietary trading algorithms.** `allocateRings()` in `public/domain.js` is the clearly labeled *temporary demo adapter*. The authentic Rust Quoter / Strategic Engine replace it later via `lib/engine/` contracts.
5b. **Mainnet is read-only.** The only Mainnet access is `lib/mainnet-observer.mjs` (no wallet, read-command allowlist). Its data is labeled `MAINNET_OBSERVED` and never mixed with Testnet figures.
6. **No claims that XDLC is XRPL-native today.** Corridor lifecycle is Titan Ghost application logic; XRP auto-bridging is the existing XRPL feature.
7. **Don't edit files you don't own** (below). Need a shared change? Note it in your final report.

## Plugin layout
- **API:** `lib/routes/NN-name.mjs` exports `register(app, ctx)`. `app.get/post(pattern, (req, res, params, body, url) => …)`, patterns like `/api/x/:id`. `ctx = { ledger, store, bus, json, ledgerReady, ledgerError }`. Respond with `ctx.json(res, status, body)`. Namespace your routes: `/api/<your-area>/…`.
- **UI:** `public/modules/NN-name.js` exports `default { id, title, order, mount(el, api) }`. `api.get/post/on/badge/esc/show` (see `public/shell.js`). Use the CSS tokens/classes in `public/shell.css` (`.card .grid .badge .primary .ghost .mono .muted`); add module-specific styles inline or in a `<style>` you inject scoped to your module's root class. Must work at phone width and in light and dark modes.
- **Shared domain:** `public/domain.js` — MARKETS, RINGS, PROFILES, TIERS, STAGES, `allocateRings`, `priceImpactBps`. Import in Node via `../../public/domain.js`, in browser via `/domain.js`. Read-only for agents.

## Events (SSE at `/api/events`, `bus.publish(type, mode, payload)`)
Already emitted (LIVE_TESTNET): `launch.created {launchId, code, name, category}`, `launch.step {launchId, code, step}`, `launch.done {launchId, code, name, fillHash, book, issuer}`, `launch.failed {launchId, code, error}`.
New event types: `<area>.<verb>`, e.g. `capital.injected`, `corridor.stage_changed`, `sentinel.finding`, `arena.completed`. Document yours at the bottom of this file in your report (the lead merges).

## Existing endpoints
- `POST /api/launch {name, code, supply, category, description?, alias?, consent:true}` → `202 {id}` (live Testnet; serialized queue; rate-limited). **Agents: do not call this in automated tests.** One real token exists already: `BBL`.
- `GET /api/launches`, `GET /api/launches/:id` — records with `steps[]` (hash, result, ledger, explorer), `status` (queued|running|live|failed), `stage`, `book`, `fillHash`, `issuer`.
- `GET /api/book/:code` — live order book `{asks:[{account,qty,priceXrp}], bids:[…]}`.
- `GET /api/status` — accounts (issuer/maker/taker addresses, XRP, ownerCount), validated ledger, counts.
- `GET /api/health`, `GET /api/modules`.

## Ownership
| Area | Owns |
|---|---|
| Lead | server.mjs, shell.*, domain.js, ledger.mjs, store.mjs, validate.mjs, guardian.mjs, 10-launch.*, CONTRACT.md |
| Titan View | `public/modules/20-view.js`, `test/view.*` |
| Capital Injection | `lib/routes/30-capital.mjs`, `lib/capital.mjs`, `public/modules/30-capital.js`, `test/capital.*` |
| Demand Proof + Corridor | `lib/routes/40-corridor.mjs`, `lib/demand.mjs`, `lib/corridor.mjs`, `public/modules/40-corridor.js`, `test/corridor.*` |
| Sentinel | `lib/routes/50-sentinel.mjs`, `lib/sentinel.mjs`, `public/modules/50-sentinel.js`, `test/sentinel.*` |
| Arena | `lib/routes/60-arena.mjs`, `lib/arena.mjs`, `public/modules/60-arena.js`, `test/arena.*` |
| x402 Payments & Data | `lib/x402/**`, `lib/routes/90-x402.mjs`, `public/modules/37-x402.js`, `test/x402.*` |
| Access & Free Threshold | `lib/entitlement/**`, `lib/routes/95-access.mjs`, `public/modules/38-access.js`, `test/access.*` |
| Sentinel Findings | `lib/findings/**`, `lib/routes/55-findings.mjs`, `public/modules/55-findings.js`, `test/findings.*`, `data/findings.json` |
| Spokes (26-spoke data) | `lib/spokes/**`, `lib/routes/85-spokes.mjs`, `test/spokes.*`, `data/spokes-snapshot.json`, `docs/SPOKES_API.md` |
| Liquidity Observatory | `public/modules/25-observatory.js`, `public/observatory-fixture.json`, `test/observatory.*` |
| Project Incubator (TGLB) | `lib/incubator/**`, `lib/routes/32-incubator.mjs`, `public/modules/32-incubator.js`, `test/incubator.*`, `docs/INCUBATOR.md`, `data/incubator.json` |
| TGAN Advisory | `lib/tgan/**`, `lib/routes/34-tgan.mjs`, `public/modules/34-tgan.js`, `test/tgan.*`, `docs/TGAN.md`, `data/tgan.json` |
| TG Product Registry | `lib/products/**`, `lib/routes/15-products.mjs`, `public/modules/99-products.js`, `test/products.*`, `docs/TG_PRODUCT_REGISTRY.md` |
| Stability / ops | `scripts/**`, `docs/DEMO_RUNBOOK.md`, `test/stability.*` (shell/server changes reviewed by Lead) |
| Engine contracts | `lib/engine/**` (keep `getEngine()` method signatures stable), `lib/routes/70-engine.mjs`, `public/modules/70-engine.js`, `contracts/**`, `test/engine.*` |

## Testing your work
- Unit tests with `node:test` in `test/` — pure logic, no network.
- Run a private server to check routes/UI: `TF_READONLY=1 PORT=<41xx> node server.mjs` (pick: view 4132, findings 4141, spokes 4142, observatory 4143, stability 4144–4148, incubator 4149, tgan 4150, products 4151, capital 4133, corridor 4134, sentinel 4135, arena 4136, engine 4137, pathfinder 4138, x402 4139, access 4140). It shares `data/` and wallets: `TF_READONLY=1` is mandatory: it makes `Ledger.submit()` throw. Stop it when done.
- `node --check` every file; load your tab in the page at least once via `curl` of the module file and a headless import check if possible.

## Shared services (import, don't copy)
- **Guardian** `lib/guardian.mjs`: `guardCheck({mode, txType, role, amountXrp, amountUsd, marketId, requiresApproval, approved})` → `{allowed, reasons[]}`. Call before any proposed action and show the verdict.
- **Engine seam** `lib/engine/index.mjs`: `getEngine().info() / allocate(capitalUsd, opts) / recommend(markets[])`. Use this rather than calling `allocateRings` directly on the server, so the Rust engines can drop in. Every UI surface showing engine output must show `info().label` (it's a temporary adapter).

## Product glossary
Titan Ghost: authorized market-making infrastructure on XRPL with six liquidity rings. TGLW (Titan Ghost Liquidity Wake): a distinct self-custodial liquidity platform that supports TGLB by supplying Tier 1 (flexible) and Tier 2 (term-committed) liquidity. TGLB (Liquidity Bootstrap): the project-funding and lending platform; it coordinates the tiers plus a separate Tier 3 underwritten lending-vault path. Wake Intelligence / CFIE / DMSIE: intelligence engines recommending capital (re)allocation. Guardian: authorization boundaries. Sentinel: risk and security monitoring. Titan View: visualizer. Titan Arena: educational game. Titan Tokenization: asset setup. XDLC: a *proposed* XRPL amendment, not live.

## Event registry (as built)
| Event | Mode | Payload |
|---|---|---|
| `launch.created/step/done/failed` | LIVE_TESTNET | see above |
| `capital.injected` | SIMULATION | `{marketId, profileId, capitalUsd, tierId, allocation:{rings}, deployedUsd, idleUsd, totalUsd, sequence?:{index,total}}` |
| `capital.reset` | SIMULATION | `{marketId\|null}` |
| `corridor.stage_changed` | LIVE_TESTNET or SIMULATION | `{code, from, to, mode, reason, rings:[{id, allocUsd, utilization}]}` — rings are always modeled (SIMULATION) |
| `corridor.score` | LIVE_TESTNET or SIMULATION | `{code, live:{organic, demo}, sim, scenario?}` |
| `sentinel.finding` | LIVE_TESTNET | `{code, severity, title, findingId}` (medium/high, de-duplicated) |
| `arena.step` / `arena.completed` | SIMULATION | `{sessionId, step, alias}` / `{sessionId, alias, score, max, linkedToken, promoted}` |
| `access.decision` / `access.threshold_crossed` | participant's mode | `{participantId, resource, decision, reason, qualifyingUsd, thresholdUsd, status, demo, organic:false}` / `{participantId, orgId, from, to, qualifyingUsd, thresholdUsd, graceEndsAt}` |
| `access.policy_changed` | SIMULATION | `{thresholdUsd, thresholdSource, graceHours, xrpUsd}` |
| `pathfinder.*` | MAINNET_OBSERVED / LIVE_TESTNET | see lib/pathfinder |

Env: `FREE_LIQUIDITY_THRESHOLD_USD` (demo default 50,000, not approved), `TF_ACCESS_XRP_USD`, `TF_ACCESS_GRACE_HOURS`, `TF_READONLY`, `PORT`, `TF_ENGINE_BIN`/`TF_ENGINE_URL` (engine), `TF_ARENA_FILE`, `TF_CORRIDOR_FILE`. Start/restart: `./start.sh`.

### Added 2026-10-24 (hardening + 26-spoke pass)
| Event | Mode | Payload |
|---|---|---|
| `findings.recorded` / `findings.updated` | finding provenance (`MAINNET_OBSERVED_READ_ONLY` sent as `MAINNET_OBSERVED`; `UNAVAILABLE` allowed) | `{findingId, title, severity, category, product, market, verification, provenance, status, count, head, change?}` |
| `spokes.snapshot` | MAINNET_OBSERVED | `{fetchedAt, freshness, counts, coverage, attribution}` |
| `spokes.flow` | flow kind (MAINNET_OBSERVED / LIVE_TESTNET) | `{flow}` |

Bus modes now: `LIVE_TESTNET`, `SIMULATION`, `REPLAY`, `MAINNET_OBSERVED`, `UNAVAILABLE`.

Endpoints: `/api/findings[/:id|/summary|/sources|/verify|/report]` (POST status/notes/root-cause/collect: localhost only); `/api/spokes[/:id|/flows|/replay]`, `POST /api/spokes/refresh` (localhost, rate-limited); `/api/pathfinder/evidence[/:runId]`, `/api/pathfinder/no-path`, `/api/pathfinder/continuity-plan` (dry run, `approved:false`), `POST /api/pathfinder/evidence/refresh` (read-only). `/api/health` adds `offline, mode, routes, skippedRoutes`.

Env: `TF_OFFLINE=1` (offline replay: no network, no signing, recorded data relabeled REPLAY; `./start.sh --offline`), `TF_BOOTSTRAP_RETRY_MS`, `TF_FINDINGS_FILE`, `TF_SPOKES_REFRESH_MIN` (30), `TF_SPOKES_MIN_GAP_SEC`, `TF_SPOKES_LEDGERS`, `TF_SPOKES_AUTO` (0 disables auto refresh), `TF_SPOKES_FILE`.

XRPL.to data: show the clickable "Data by xrpl.to" link wherever rankings appear; written permission from xrpl.to is required before any public showing.
x402: frozen as built. Live purchase only with the Commander's explicit per-payment approval (see docs/HACKATHON_AGENTIC_PAYMENT_SECURITY.md).

### Added 2026-10-24 (incubator / TGAN / product registry)
| Event | Mode | Payload |
|---|---|---|
| `incubator.project_created` / `stack_changed` / `gate_changed` / `decision` | SIMULATION | see docs/INCUBATOR.md (decision uses `decisionType`) |
| `tgan.advisor_assigned` / `tgan.recommendation` / `tgan.fee_calculated` | SIMULATION | see docs/TGAN.md; every payload `hypothetical:true`, fee `billed:false` |

**Never put a key named `type` in a bus payload**: it overwrites the event type.
Endpoints: `/api/incubator/*` (docs/INCUBATOR.md), `/api/tgan/*` (docs/TGAN.md), `/api/products[?status=&category=]`, `/api/products/matrix`, `/api/products/:acronym` (read-only). Sentinel Findings collects `/api/incubator/sentinel-signals` and `/api/tgan/sentinel-signals` as SIMULATED findings.
Env: `TF_INCUBATOR_FILE`, `TF_TGAN_FILE`.
Naming: TG = Titan Ghost prefix (approved TG, TGLW, TGLB, TGAN = product 17, TGAR = Arena; others proposed). Never rename existing code identifiers for branding. Registry: docs/TG_PRODUCT_REGISTRY.md.

### Added 2026-10-24 (demo loop + quote size)
**Spec exception:** automated demo loop sessions, see `docs/SPEC_EXCEPTION_DEMO_LOOP.md`. Agents never call `POST /api/loop/start`.
| Event | Mode | Payload |
|---|---|---|
| `loop.started` / `loop.round` / `loop.stopping` / `loop.stopped` | LIVE_TESTNET | `{sessionId, config?, phase?, round?, code?, fillHash?, runId?, payments?, capture?, totals?, reason?, organic:false}` |

Endpoints: `GET /api/loop/status`, `POST /api/loop/start {rounds, minutes, k, quoteXrp?, maxVolumeXrp, gapSec, anchor, approved:true}` (operator only; refused offline and read-only), `POST /api/loop/stop`, `GET /api/loop/sessions/:id`. Shared services: `ctx.launches.start(spec, extra)` (10-launch) and `ctx.pathfinder` (80-pathfinder). Pathfinder plan/run accept `quoteXrp` (1–15 XRP per quote, our maker only). Env: `TF_LOOP_FILE`.

Loop rounds also publish `capital.injected` (SIMULATION, payload adds `loop:{sessionId, round}`) and `corridor.stage_changed` on the SIMULATION track. `GET /api/loop/catches[?session=id]`: every validated demo fill classed by `public/creatures.js` (size ladder, shared browser/Node). Titan View reacts to `pathfinder.payment` with a creature sprite and shows the catch board.

### Added 2026-10-25 (final build: theater, XDLC, TGLB lending, universal Sentinel, vendors, pitch)
| Event | Mode | Payload |
|---|---|---|
| `theater.scenario` | SIMULATION | `{scenario, seed, fills, ringsSwept, volumeUsd, hypothetical:true}` |
| `xdlc.transition` | SIMULATION (LIVE_TESTNET only when a recorded hash is cited) | `{corridorId, marketId, from, to, seq, hash, prevHash, funding{requested,committed,funded,executable}, approved, ledgerHash}` |
| `xdlc.radar` | SIMULATION | `{top, candidates, positive, model, engineLabel}` |
| `xdlc.redeploy_step` | SIMULATION | `{runId, index, total, step, title, status, approved}` |
| `incubator.loan_applied/underwritten/scenario/repaid/defaulted/breach` | SIMULATION | see docs/INCUBATOR.md; `label:"XLS-65/66-style simulation"` |
| `vendors.probe` | MAINNET_OBSERVED / LIVE_TESTNET / SIMULATION / UNAVAILABLE | `{vendor, status, ok, latencyMs, sampleStored}` |

New label: `HISTORICAL_MAINNET` (Titan Ghost's own Mainnet history, read-only via the observer; empty until `TG_MAINNET_ACCOUNTS` is set). Badge `PROPOSED` for XDLC amendment material.
Endpoints: `/api/theater/*` (docs/THEATER.md), `/api/xdlc/*` (docs/XDLC_APPLICATION.md), `/api/xdlc-spec/summary|doc/:name` (4 whitelisted docs), `/api/incubator/bootstrap/*`, `/api/incubator/loans*` (docs/INCUBATOR.md), `/api/sentinel/coverage|findings|audit` (docs/SENTINEL.md), `/api/vendors*`, `/api/merchant/flow` (docs/VENDOR_INTEGRATION_MATRIX.md).
Mainnet observer allowlist adds read-only `account_offers`, `feature` (no `vetoed`), `account_tx`.
Env: `TG_MAINNET_ACCOUNTS`, `TF_XDLC_FILE`, `TF_VENDOR_SAMPLES_FILE`, `QUICKNODE_*`, `AWS_*`, `AGENTCORE_GATEWAY_URL`, `MASTERCARD_*` (see .env.example).
Presentation: `/#present/start`; modules react to `window` `tf:present {scene}`. Pitch scenes write SIMULATION records (incubator plan/demo, TGAN fee calc, redeploy run) each time it plays.
XDLC amendment: docs/XDLC_*.md are a local draft (XLS number unassigned) — not submitted, reviewed, implemented in xrpld or activated. Publishing needs Commander approval.

### Added 2026-10-25 (vendors in the liquidity loop)
Endpoints: `GET /api/theater/observe` (re-reads recorded fill hashes, cached 30 s, source-labeled), `POST /api/vendors/ledger/commitment` (unsigned, expired, non-executable Testnet commitment for TGLW Tier 1/2 device review; never submitted), `GET /api/vendors/quicknode/stream-filter` (ready-to-deploy filter, not deployed). `/api/vendors` returns `loop` (vendor → liquidity-loop step).
QuickNode rule: used only when `QUICKNODE_XRPL_WSS` is a wss:// URL whose server reports network_id 1, read-only via the observer allowlist; otherwise the public Testnet node. The URL token is never echoed. Mastercard stays out of liquidity surfaces (TG Merchant only).

### Added 2026-10-25 (XDLC Corridor vs AMM simulation)
Endpoints (GET only, pure compute): `/api/xdlc-amm/reference[?refresh=1]` (real Mainnet XRP/RLUSD `amm_info`, read-only, cached, MAINNET_OBSERVED), `/api/xdlc-amm/simulate`, `/api/xdlc-amm/scenarios`. Env `TF_XDLC_AMM_FILE`. All outputs SIMULATION; provider amounts illustrative. No oracle in the protocol: MinRate is static on-ledger; provider-side MinRate updates are off-ledger software (e.g. Titan Ghost).
