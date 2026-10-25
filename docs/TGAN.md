# TGAN — Titan Ghost Advisory Network

**Hackathon DEMONSTRATION** of a possible future compliant advisory model, attached to the Project Incubator workflow.
Every advisor, approval and fee is **HYPOTHETICAL** and fictional. Neither GYW1313 nor any advisor shown is represented
as a registered investment adviser. Nothing is billed, collected, signed, submitted or moved.

Files: `lib/tgan/**`, `lib/routes/34-tgan.mjs`, `public/modules/34-tgan.js` (tab "TGAN Advisory", order 34),
`test/tgan.test.mjs`, `data/tgan.json` (operator records; written only when the server is not `TF_READONLY=1`, or when `TF_TGAN_FILE` is set).

## Hard rules enforced in code
| Rule | Where |
|---|---|
| Advisors are UNVERIFIED unless an operator records `{source, reference, checkedAt, reviewer}` (e.g. SEC IAPD / CRD lookup). Even then the label says "operator-recorded; TGAN does not itself verify". Unverified advisors cannot act (proposals blocked). | `advisors.mjs`, `governance.mjs` |
| T1/T2 are participant-owned TGLW wallets: an advisor has **no** control unless that specific owner granted that specific advisor a specific action on that project and tier (unrevoked, unexpired). | `findOwnerAuthorization`, `evaluateAction` |
| T3 only for the loan agreement's permitted uses (`XRP_RLUSD_INCUBATION_LIQUIDITY`). PROPRIETARY (Titan Ghost) capital is never under advisor control. PROJECT treasury only within a signed agreement. | `evaluateAction` |
| XRP/RLUSD incubation proposals are separate from the project's own (unlaunched) token. | `PROJECT_TOKEN_SEPARATE` |
| Every proposed action carries a Guardian `guardCheck` verdict (`mode: SIMULATION, requiresApproval: true`). `executes: false` always. | `evaluateAction` |
| Advisor approval never satisfies a securities-offering or market-eligibility gate. TGAN reads incubator gates and returns them unchanged; requests that carry `gate`, `satisfiesLegalGate`, `legalGate`, … are refused (400). Blocked proposals cannot be approved (409). | `gatesAfterAdvisorApproval`, `gateOverrideAttempt` |
| Fee eligibility is `NOT ENABLED — requires legal review of entity, client, asset class, agreement and applicable federal/state rules` unless an operator records `{reference, date, reviewer}`. Even then `enabled:false`: there is no billing path. | `feeEligibility` |
| Fees are never based on volume, new contributions/deposits or RLUSD↔XRP conversion (`VOLUME`, `TRADING_VOLUME`, `NEW_CONTRIBUTIONS`, `DEPOSITS`, `RLUSD_XRP_CONVERSION`, `CONVERSION`, `GROSS_ASSETS_INFLOW`, `include*:true`) — rejected, and each attempt raises a Sentinel signal. | `validateFeeConfig` |
| No legal thresholds are hard-coded. "Qualified client" style criteria are operator-entered fields labeled "Verify with counsel; values change"; none ship by default. | `setClientCriteria` |

## Projects (consumes the Project Incubator)
`ProjectSource` reads `GET /api/incubator/projects` and `/:id` over loopback when that route is registered. Otherwise it
serves a local **FIXTURE** (`demo-aurora`, `demo-beacon`, same shape) badged FIXTURE, and switches automatically
(10 s cache). Normalization: `token {currency}` → currency code; source amounts `number | {usd}`; gates `string | {status} | boolean`;
`executableUsd` = Σ `capitalStates[*].EXECUTABLE`.

Performance source, in order: `project.performance.periods[]` → incubator `performance.interim` (daily realized spread
P&L + totals; split into 3 measurement periods, costs pro rata, inventory appreciation and unrealized marks reported
**separately** and not counted as gain — the incubator's rule) → fixture periods. Labeled SIMULATION/REPLAY as received.

## Performance math
Per period: gross gain = end − begin − deposits + withdrawals; net = gross − expenses. Next period begins net of expenses.
- **Time-weighted**: chain-linked Modified Dietz (flows mid-period) — strategy result independent of flow timing.
- **Money-weighted**: IRR over the horizon (flows mid-period) — participant's dollar experience.
- Capital efficiency: net P&L / average invested capital. HWM and unrecovered loss come from the fee engine at 0%.
- Misstatement check: advisor-reported net P&L / ending value vs recomputed (tolerance max($1, 0.5% of beginning value)); return within 0.5 pt.

## Hypothetical fee (high-water mark)
`P₀ = −priorLossCarryforward` (or the gap to `initialHighWaterMark`, larger wins), `HWM₀ = 0`.
`Pᵢ = Pᵢ₋₁ + netGainᵢ`; `feeBaseᵢ = max(0, Pᵢ − HWMᵢ₋₁)`; `HWMᵢ = max(HWMᵢ₋₁, Pᵢ)`; `feeᵢ = rate × feeBaseᵢ`.
Expense treatment `DEDUCT_FROM_GAIN` (default) or `ALREADY_NET`. Measurement period `MONTHLY|QUARTERLY|SEMI_ANNUAL|ANNUAL`.

**Worked example** (10%): $100,000 → $112,000 with $2,000 costs → net gain $10,000 → **$1,000** hypothetical fee; HWM becomes a
$110,000 net value. Falls to $105,000 → no fee. Recovers to $113,000 → only the $3,000 above $110,000 counts → $300.

## Endpoints (`/api/tgan`)
GETs are public read-only. POSTs marked **L** are SIMULATION records restricted to direct localhost callers
(`Content-Type: application/json`, no proxy headers, local Origin).

| Method | Path | Notes |
|---|---|---|
| GET | `/api/tgan` | notice, flow, project source, projects, eligibility, fee options |
| GET | `/api/tgan/advisors`, `/api/tgan/advisors/:id` | fictional profiles, verification, agreement, conflicts |
| POST L | `/api/tgan/advisors/:id/verification` | `{source, reference, checkedAt, reviewer}` or `{clear:true}` |
| GET | `/api/tgan/portfolios/:projectId` | governance, capital-source restrictions, authorizations, proposals with TGAN + Guardian verdicts, gates (unchanged) |
| POST L | `/api/tgan/portfolios/:projectId/assign` | `{advisorId, unassign?}` → `tgan.advisor_assigned` |
| POST L | `/api/tgan/portfolios/:projectId/authorizations` | owner grant `{ownerId, tier:T1|T2, advisorId, actions[], reference, expiresAt?}` |
| POST L | `/api/tgan/portfolios/:projectId/authorizations/:authId/revoke` | |
| POST L | `/api/tgan/portfolios/:projectId/proposals` | `{advisorId, actionType, asset, capitalSource, ownerId?, use?, amountUsd, rationale?}` → `tgan.recommendation` (recorded even if blocked) |
| POST L | `/api/tgan/portfolios/:projectId/proposals/:id/review` | `{decision: RECOMMENDED|APPROVED_HYPOTHETICAL|REJECTED|WITHDRAWN}` → `tgan.recommendation`; gate fields refused |
| POST L | `/api/tgan/portfolios/:projectId/fee-config` | stores a hypothetical fee configuration (prohibited bases rejected) |
| GET | `/api/tgan/performance/:projectId` | report + reported-vs-recomputed checks + hypothetical fee from the project's fee config |
| POST L | `/api/tgan/performance/:projectId/report` | advisor-reported figures for the misstatement check |
| GET | `/api/tgan/fee-calculator` | worked example + result, client criteria |
| POST | `/api/tgan/fee-calculator` | **pure** calculation → `tgan.fee_calculated`; 400 with `errors` for invalid/prohibited input |
| POST L | `/api/tgan/legal-review` | `{reference, date, reviewer, scope?}` or `{clear:true}` |
| GET / POST L | `/api/tgan/eligibility-criteria` | `{criteria:[{label, value, source?}]}` (operator values, no defaults) |
| GET | `/api/tgan/revenue` | three separate streams (infrastructure / x402 data / advisory), collected $0 each |
| GET | `/api/tgan/sentinel-signals` | concerns for the findings registry |
| POST L | `/api/tgan/reset` | restore the demo scenario |

Revenue stream 1 reads the Access module's live policy in-process (`publicPolicy(entitlements().policy)`, same as
`GET /api/access/policy`); the threshold is never duplicated. Stream 2 links to x402 (`/api/x402/catalog`, tab `x402`) without calling it.

## Events (bus mode `SIMULATION`, payload always `hypothetical:true`)
| Event | Payload |
|---|---|
| `tgan.advisor_assigned` | `{projectId, advisorId, firm, verification, assigned, projectSource}` |
| `tgan.recommendation` | `{projectId, proposalId, advisorId, actionType, asset, capitalSource, amountUsd, status, allowed, codes[], guardian, legalGate?}` |
| `tgan.fee_calculated` | `{projectId, ratePct, measurementPeriod, periods, totalHypotheticalFeeUsd, endingHighWaterMarkUsd, eligibility, billed:false}` |

## Sentinel signals (`GET /api/tgan/sentinel-signals`)
`{ mode, product:'TGAN', projectSource, count, signals:[{ key, code, severity, title, detail, category:'advisory-governance', product:'TGAN', mode:'SIMULATION', provenance:'SIMULATION', verification:'SIMULATED', advisorId?, projectId?, recommendation }] }`

| code | severity | raised when |
|---|---|---|
| `UNVERIFIED_ADVISOR_ACTING` | high | an UNVERIFIED advisor has a proposal, report or fee config (one per advisor × project) |
| `WALLET_ACTION_WITHOUT_OWNER_AUTH` | high | a T1/T2 proposal lacks that owner's specific authorization |
| `CONFLICT_UNDISCLOSED` | high | an assigned/acting advisor has a conflict with `disclosed:false` |
| `PERFORMANCE_MISSTATEMENT` | high | advisor-reported vs recomputed mismatch |
| `FEE_CONFIGURED_NOT_ENABLED` | medium | a fee config exists while eligibility is NOT ENABLED |
| `PROHIBITED_FEE_BASIS` | high | a prohibited basis was configured or attempted |

`key` is stable (`tgan:<code>:<subject>`), suitable as a findings de-duplication key.

## Demo walkthrough (tab "TGAN Advisory")
1. Pick `demo-aurora`. Badge shows FIXTURE or SIMULATION "from Project Incubator".
2. **Demo flow** cards: project request → advisor review → TGLB funding structure (incubator capital stack) → XRP/RLUSD incubation → execution (SIMULATION/REPLAY) → performance → XDLC evaluation (proposed amendment, not live) → potential graduation (incubator state, read-only).
3. **Advisors**: all UNVERIFIED; Firm B's agreement unsigned; Firm C's market-making conflict undisclosed.
4. **Governance**: every seeded proposal is BLOCKED (unverified); prop-seed-2 additionally lacks the T2 owner's authorization. Guardian verdict shown per row.
5. Record a verification reference for Firm A (operator, localhost) → prop-seed-1 (owner-authorized T1) and prop-seed-3 (T3 permitted use) pass → "Approve (hyp.)" → the incubator legal gate stays as it was.
6. **Performance**: incubator interim program as 3 periods; TWR vs MWR; inventory appreciation shown separately; Firm B's overstated report flagged MISMATCH.
7. **Fee calculator**: worked example ($1,000 / $0 / $300 with the HWM chart); try basis `VOLUME` → rejected + signal. Eligibility stays NOT ENABLED.
8. **Revenue**: three separate streams, collected $0. **Sentinel signals** list. "Restore demo scenario" resets.
