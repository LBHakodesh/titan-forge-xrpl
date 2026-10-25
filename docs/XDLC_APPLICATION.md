# XDLC application lifecycle, Opportunity Radar and capital redeployment

**XDLC is a proposed XRPL amendment. It is not live.** Everything in this module is Titan Ghost *application logic*
running in the Titan Forge staging app. XRP auto-bridging, which the conversion step relies on, is an existing XRPL feature.
Nothing here signs, submits or moves funds on any network. The amendment drafts are separate (`docs/XDLC_AMENDMENT_*.md`, owned by another workstream).

| Piece | File | Mode |
|---|---|---|
| Opportunity Radar (demo adapter) | `lib/xdlc/radar.mjs` | inputs MAINNET_OBSERVED / LIVE_TESTNET, forecasts SIMULATION |
| Corridor state machine + hash-chained log | `lib/xdlc/lifecycle.mjs` | SIMULATION (LIVE_TESTNET only when a real recorded Testnet hash is cited) |
| Capital redeployment walk-through | `lib/xdlc/redeploy.mjs` | SIMULATION |
| API | `lib/routes/42-xdlc.mjs` | |
| UI | `public/modules/42-xdlc.js` (XDLC Lifecycle), `public/modules/44-redeploy.js` (Watch Capital Move) | |
| State | `data/xdlc.json` (`TF_XDLC_FILE`) | read-only instances keep changes in memory |

## 1. TG Intelligence Opportunity Radar

This is a **temporary demo adapter**, not proprietary TG Intelligence, and it does not run on Mainnet. Every response carries
`engine.label` from `getEngine().info()` (today: *Temporary Testnet demonstration adapter*).

Candidates:
- `RADAR_DISCOVERED`: every non-placeholder spoke in `lib/spokes` (Mainnet spokes are read-only third-party observations; Testnet spokes are our demo tokens, `organic:false`).
- `PROJECT_REQUESTED`: the fictional incubator intakes (`lib/incubator/demo.mjs`). The tokens are not issued, so these candidates are never fundable here.

Factors. Each one has a weight, a value in [0,1] and a provenance, and contribution = 100 × weight × value. The score is the sum of the contributions.

| Factor | Weight | Source |
|---|---|---|
| thin liquidity, funded-depth gap, wide spread, price impact, underfunded XRP bridge leg (CLOB) | + | spoke order book / AMM (MAINNET_OBSERVED or LIVE_TESTNET) |
| missing payment paths | + | NO_PATH diagnoses in `data/pathfinder-evidence.json` (LIVE_TESTNET, demo) |
| maker concentration | + | per-market maker offers (HHI lower bound) + `mainnet-profile.json` pathfound `makerCapture.hhi` |
| market demand | + | 24h volume |
| AMM competition, issuer risk | − | AMM share of ±2% depth, eligibility checks |
| net economic benefit, capital fit, deployment cost | ± | model `TG-RADAR-NETBENEFIT-v1 (demo)` (SIMULATION) |

The model is named, and its assumptions are returned in full by `/api/xdlc/radar`: a 30-day horizon, a 50% volume haircut, an AMM flow take of 50%, a spread cap of 200 bps,
40% half-spread realization, $1,500 setup, $750/month operations, a 5% annual capital cost, an inventory-risk term, and fees.
It gives low, base and high net benefit, and any of them can be negative. Owner reserves are reported as *locked*, never as cost or profit.

Ranking order: fundable candidates first, then markets with a **positive base-case net benefit**, then score. A thin market
with a negative net benefit therefore always ranks below a profitable one ("thin is not automatically profitable").
Each entry returns its `contributions[]` and a plain-language `rationale[]`.

## 2. Corridor lifecycle (application logic)

The lifecycle has 14 states and is strictly sequential:
`DISCOVERY → OPPORTUNITY_EVALUATION → PROJECT_REQUEST → CAPITAL_STRUCTURE → APPROVAL_PENDING → BOOTSTRAPPING → ACTIVE → REINFORCED → MATURE → SUPPORT_REDUCTION → CAPITAL_AVAILABLE → REDEPLOYMENT_RECOMMENDED → APPROVED_REDEPLOYMENT → NEW_CORRIDOR_ACTIVE`.

`transition(corridor, {to, evidence, funding, approved}, {now, knownHashes})` is a pure function and never mutates its input. It rejects a move with reasons when:
- `to` is not the next state (all 183 illegal pairs are rejected);
- the guard fails: radar evidence is missing; the modeled base net benefit is ≤ 0; requested, committed, funded or executable capital is missing; T1, T2 or T3 is marked reallocatable; independent share or persistence is below threshold; there is no releasable capital, no balance verification, no destination, or no destination funding;
- an approval state (`BOOTSTRAPPING`, `SUPPORT_REDUCTION`, `APPROVED_REDEPLOYMENT`) is requested without `approved === true` from the operator's request. The server never self-approves. `guardCheck()` runs on every transition and its verdict is recorded;
- the request cites a ledger hash that is not one of our recorded Testnet transactions (`data/launches.json` steps, pathfinder evidence payments).

Each record contains `seq, corridorId, marketId, at` (injectable clock), `from, to, mode, evidence`, and `funding {requestedUsd, committedUsd, fundedUsd, executableUsd}`.
The four funding categories are always separate: there is never a total, unknown keys are rejected, and the invariant is executable ≤ funded ≤ committed ≤ requested.
Records also carry `authorization {required, approved, approvedBy, guardian}`, `risk`, `reconciliation {fundingBefore, fundingAfter, changed, deltas}`, `ledgerRef` (null for SIMULATION),
`prevHash`, and `hash = sha256(canonical JSON of the record without hash)`. `verifyChain(log)` detects tampering.

Seed (deterministic, scripted, labeled): `xrp-rlusd` is seeded at MATURE. Its seed approvals are recorded as "Demo history (scripted, not a live approval)". `tst-bbl` (the Testnet demo token BBL) is seeded at APPROVAL_PENDING and waits for a real operator click. Its ACTIVE step can cite the real BBL fill hash.

## 3. Capital redeployment walk-through (SIMULATION)

The INITIAL corridor is XRP/RLUSD. Its depth is MAINNET_OBSERVED, and the $40,000 proprietary deployment is modeled. The DESTINATION is the best fundable Mainnet XRP-connected
radar candidate with a positive base case (`pickDestination`). If no candidate qualifies, the walk-through stops with "not recommended".

The 16 steps are: opportunity identification, current proprietary deployment (engine seam), external funded liquidity, maturity and resilience,
economic value of existing support, comparative attractiveness, estimated releasable capital (incubator `proprietaryNeedUsd`, 20% floor),
Guardian approval, Sentinel risks, candidate offer cancellation (outermost funded rings first), available-balance verification,
asset conversion (RLUSD→XRP→token, with the cost deducted), destination funding, new offers, subsequent fills (7-day seeded model, shown as a range, which can be negative), and
before/after allocation.

- Only authorized **proprietary** capital moves. Tier 1 and Tier 2 TGLW (participant-owned, self-custodial) and Tier 3 TGLB loan proceeds are shown as locked, and their balances are identical before and after.
- Reserve release is reported, labeled **not profit**.
- Without `approved: true` from the operator button, the run halts at `guardian_approval` (`blocked: AWAITING_OPERATOR_APPROVAL`) and nothing moves, not even in simulation.
- The run is deterministic: fixed clock and seed, so the same `runId` and lifecycle hashes come back for the same inputs.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/xdlc/radar` | ranking, factors, model, engine label, xrpl.to attribution |
| GET | `/api/xdlc/corridors` | summaries + chain verification |
| GET | `/api/xdlc/corridors/:id` | + full log |
| POST | `/api/xdlc/corridors` | `{marketId, label?, pair?, origin?, radarId?}`, localhost only |
| POST | `/api/xdlc/corridors/:id/advance` | `{to, evidence?, funding?, approved?}`, localhost only; 409 + `reasons[]` on rejection |
| GET | `/api/xdlc/redeploy/plan` | preview, never approved |
| POST | `/api/xdlc/redeploy/run` | `{approved?}`, localhost only |
| GET | `/api/xdlc/sentinel-signals` | `{mode, signals:[{id, key, title, severity, market, evidence[], provenance, verification:'SIMULATED', category, product, remediation}]}` |

## Events

| Event | Mode | Payload |
|---|---|---|
| `xdlc.transition` | SIMULATION (LIVE_TESTNET when a recorded hash is cited) | `{corridorId, marketId, from, to, seq, hash, prevHash, funding:{requestedUsd, committedUsd, fundedUsd, executableUsd}, approved, ledgerHash}` |
| `xdlc.radar` | SIMULATION | `{top, candidates, positive, model, engineLabel}` (emitted when the top candidate changes) |
| `xdlc.redeploy_step` | SIMULATION | `{runId, index, total, step, title, status, approved}` |

None of these payloads has a key named `type`.

## Presenter hook

`window.dispatchEvent(new CustomEvent('tf:present', {detail: {scene}}))`:
- `radar` opens XDLC Lifecycle → Radar, animates the factor bars and highlights the top five rows.
- `lifecycle` steps the 14-state rail through the selected corridor's history.
- `redeploy` opens Watch Capital Move and plays the walk-through **up to the approval step**. Approval stays a human button press.
