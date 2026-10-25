# TGLB Bootstrap + Project Liquidity Incubator (tab "TGLB Bootstrap", module id `incubator`, order 32)

TGLB Liquidity Incubation & Graduation Program. One integrated tab joining Titan Ghost Intelligence discovery, TGLB
(Titan Ghost Liquidity Bootstrap) funding, TGLW (Titan Ghost Liquidity Wake) participation, Titan Ghost execution and the
application-level XDLC corridor lifecycle. XDLC is a *proposed* open protocol framework, not live on XRPL.

**Nothing in `lib/incubator/**` signs, submits or moves funds.** The service holds no ledger handle. Every change is an
explicit operator action (POST, localhost only) recorded as `SIMULATION` with an actor and a timestamp. The only
network access is the optional read-only amendment refresh (allowlist: `server_info`, `feature`, `account_info`,
`gateway_balances`; asserts `network_id === 1`).

Files: `lib/incubator/{model,intake,gates,program,intelligence,amendments,demo,lending,bootstrap,service,index}.mjs`,
`lib/routes/32-incubator.mjs`, `public/modules/32-incubator.js`, `test/incubator.test.mjs`, `test/lending.test.mjs`, `data/incubator.json` (seed).
Read-only instances (`TF_READONLY=1`) seed from `data/incubator.json` and write `data/incubator.readonly-<PORT>.json`.
Override with `TF_INCUBATOR_FILE`.

## Model
- **Opportunity sources:** `RADAR_DISCOVERED` (thin-liquidity spokes from `lib/spokes`: low ±2% funded depth < 2,000 XRP,
  spread > 150 bps or not two-sided, failed `two_sided_liquidity`, 24h volume < 20,000 XRP; spokes failing other blocking
  screens are shown but are never candidates) and `PROJECT_REQUESTED` (intake form). Both feed the same intake, gates and lifecycle.
- **Five capital sources, kept separate:** `T1` TGLW flexible (participant-owned, withdrawable, liquidity-only), `T2` TGLW
  committed (participant-owned; term + early exit are a CONTRACTUAL model, separate from protocol-enforced wallet
  permissions), `T3` creditor financing via an authorized lending partner (underwriting, loan agreement, disbursement,
  permitted use, repayment, credit risk; SIMULATION), `PROJECT` (the only project money), `PROPRIETARY` (GYW1313).
- **Stack:** `targetUsd` = T1 + T2 + T3 (must match); any of the 7 nonempty tier combinations; zero allowed for unused
  tiers; all-zero rejected. PROJECT and PROPRIETARY are separate lines outside the target.
- **Capital states per source:** `REQUESTED ≥ MATCHED ≥ COMMITTED ≥ FUNDED ≥ EXECUTABLE ≥ 0`, each a separate number.
  T3 cannot be COMMITTED before underwriting is APPROVED nor FUNDED before disbursement; a DECLINED T3 stays at zero past
  REQUESTED. PROPRIETARY moves past REQUESTED only through Commander decisions. Shortfalls are listed as funding gaps.
- **Custody invariants:** T1/T2 never count as project-owned; no transfer of any source without its owner's authorization;
  T1/T2 can never go to a project treasury even with authorization; T3 only to its permitted use. Refused attempts are
  recorded and raised as Sentinel signals.
- **Interim XRP/RLUSD program:** provisional market making in XRP/RLUSD for projects whose own token market is not yet
  legally eligible or economically justified. It **does not create a market or price for the project's unlaunched token.**
  Spread and depth context comes from the real Mainnet RLUSD spoke (`MAINNET_OBSERVED`, read-only). Performance is a
  deterministic SIMULATION per source: position, fees, inventory, realized, unrealized, inventory appreciation, unrecovered
  costs. Net MM return = realized − costs (incl. T3 interest); inventory appreciation and unrealized marks are excluded.
- **Gates:** LEGAL (operator-entered, document reference + reviewer + date required, else held OPEN): token and offering
  analysis, permitted market and participants, issuer/trading requirements, approval documentation, plus the
  regulatory review status. ECONOMIC: operating sustainability, verified demand evidence, funded liquidity and price
  impact (engine seam, label shown), expected net MM returns, inventory/concentration, capital requirements, consistency.
- **Outcomes:** legal FAIL → `DECLINE`; legal OPEN → `REMAIN_IN_INCUBATION` (always, whatever the economics);
  legal RESTRICTED + econ PASS → `RESTRICTED_MARKET_PATHWAY` (XRPL Permissioned DEX is a technical option; credentials
  alone do not establish compliance); legal PASS + econ PASS → `GRADUATE_TO_TOKEN_CORRIDOR`. A recorded outcome the gates
  no longer allow is reverted (`revoked`). **Profitability never overrides the legal gate** (enforced in `decideOutcome`,
  `outcomeAllowed` and the decision endpoint; tested).
- **Titan Ghost Intelligence recommendations:** INTERIM_RLUSD_SUPPORT, ADDITIONAL_FUNDING, CONTINUE_OBSERVATION,
  TOKEN_CORRIDOR_ELIGIBILITY_REVIEW, RING_REINFORCEMENT, REDUCE_PROPRIETARY, REDEPLOY_CAPITAL, SUSPEND_OR_REJECT. Each has
  evidence with provenance, a corridor transition validated against `nextStage`/`demoteTargets` (lib/corridor.mjs, STAGES),
  and a Guardian `guardCheck` verdict. `executes:false` always.
- **Tier 3 / native lending:** read-only Testnet check (2026-10-24, ledger 21778134, rippled 3.4.1): `SingleAssetVault`,
  `LendingProtocol`, `LendingProtocolV1_1` supported but **not enabled** → native lending `UNAVAILABLE`. `PermissionedDEX`,
  `PermissionedDomains`, `Credentials`, `MPTokensV1` enabled. RLUSD Testnet issuer `rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV`
  (Ripple RLUSD docs) exists, Domain `https://ripple.com/`.

## Demo (fictional)
- `demo-aurora` Aurora Grid Co-op: legal review IN_REVIEW, T2 under-matched, T3 declined → stays in XRP/RLUSD incubation.
- `demo-beacon` Beacon Freight Ledger: counsel opinion + all legal items documented, economics pass → eligible to graduate
  to a project-token corridor for Testnet demo token BCN (not issued; issuance would go through the Launch tab). Its token
  fills are shown only as labeled REPLAY illustrations from the existing funded Testnet spokes (BBL, LDN).
- Proprietary budget $150,000. Recommendation: support Beacon. The Commander may select either.
- Walkthrough: SELECT_SUPPORT (Beacon) → BOOTSTRAP → RECORD_OUTCOME GRADUATE (Aurora refused: legal OPEN) →
  ADVANCE_MATURITY ×4 (spoke → growing_spoke → corridor → corridor → mature; independent share 15% → 75%; proprietary need
  = initial × max(0.2, 1 − share)) → REDEPLOY to Aurora ($112,500 freed; $50,000 to Aurora as MATCHED/COMMITTED, $62,500 back to the pool).
- `POST /api/incubator/reset` reseeds.

## TGLB Bootstrap studio (`lib/incubator/bootstrap.mjs`, default view of the tab)
A visitor: names a project; identifies its token (currency, optional issuer) **or** chooses XRP/RLUSD incubation
(`incubationAsset` XRP|RLUSD); sets a funding target; picks **any** non-empty combination of Tier 1 / Tier 2 / Tier 3
(toggling re-splits the target evenly; allocations must sum to the target, validated by `validateStack`); models
commitments; reviews legal and economic readiness; simulates deploying liquidity into an eligible corridor; hands off to XDLC.
- **Tiers.** T1 = TGLW (Titan Ghost Liquidity Wake) flexible, self-custodial, liquidity-only. T2 = TGLW term-committed,
  self-custodial, liquidity-only, with *separately disclosed contractual* exit rules (term, notice, early-exit bps; not
  protocol-enforced wallet permissions). T3 = formal creditor financing (underwriting, permitted uses, repayment).
- **Capital categories** `REQUESTED ≥ COMMITTED ≥ FUNDED ≥ EXECUTABLE` per tier (`tierCapital`: committed = requested ×
  commitRate, funded = committed × fundRate, executable = funded × execRate; explicit USD values clip to the previous
  category). `categoryTotals` sums **within** a category across tiers only; categories are never added together.
  T3 categories come from underwriting (requested = application, committed = approved principal, funded = disbursed,
  executable = proceeds in permitted market-making inventory).
- **Project funds.** `projectFunds()`: project-owned = the project's own line only; `tglwCountedAsProjectFundsUsd` is
  always 0; T3 proceeds are shown as borrowed (a liability, restricted use).
- **Readiness.** Legal = `legalGate()` (operator input; doc ref + reviewer + date or held OPEN). Economic =
  `bootstrapEconomicGate()` using only economic inputs: operating sustainability (runway ≥ operating period), commitment
  coverage ≥ 60%, executable ≥ 50% of requested, no tier > 70% of executable when mixing, verified demand (≥ 2 refs, ≥ 15
  participants), price impact of a $10k order ≤ target spread (engine seam), T3 debt service (approved and DSCR ≥ 1.25).
  Outcome = `decideOutcome()` (legal first; profitability never overrides legal). Gates are independent (tested both ways).
- **Corridors.** `TOKEN/XRP`, `TOKEN/RLUSD` need a token + legal PASS (RESTRICTED → permissioned pathway) + economic PASS.
  The interim `XRP/RLUSD` incubation corridor is eligible unless legal FAIL and needs executable > 0; it creates no market
  or price for the project token. Deploy = `engine.allocate(executable)` across the rings, $10k price impact, Guardian
  `guardCheck` verdict, `executes:false`.
- **XDLC handoff.** `plan.handoff = {endpoint:'/api/xdlc/corridors', method:'POST', body:{marketId:'tglb:<slug>:<pair>', label,
  origin:'PROJECT_REQUESTED', pair, base, quote, corridorKind, tierCombination, executableUsd, requestedUsd, committedUsd,
  fundedUsd, rings, engine, mode:'SIMULATION', organic:false, hypothetical:true}}`. The UI button posts it to Workstream B's
  service; 404/405 shows "not available on this server yet" with the payload; 403 = localhost only.
- **Demo walkthrough** (`demoWalkthrough()`, deterministic, fictional "Demo Harbor Co-op", token DHC not issued):
  10 steps — name → target $400k → T1 $120k + T2 $180k + T3 $100k → commitments → underwriting (68/100, conditional,
  $75k at 11.20%) → late payment → default stress (month 3, collateral −60%: first loss $15k, reserve $5k, senior lenders
  ≈ $9.6k) → readiness (econ PASS, legal OPEN → remain in incubation) → deploy into XRP/RLUSD → legal documented →
  DHC/XRP eligible. "▶ Run demo walkthrough" plays it (Back/Play/Next/Exit); `window` event
  `CustomEvent('tf:present',{detail:{scene:'tglb'}})` auto-plays it at 1.4 s per step and (localhost) calls
  `POST /bootstrap/demo/run`, which records loan `loan-demo-dhc` and emits the `incubator.loan_*` events.

## Tier 3 lending: "XLS-65/66-style simulation" (`lib/incubator/lending.mjs`)
XLS-65 (Single Asset Vault) / XLS-66 (Lending Protocol) are **not enabled** on Testnet (recorded check) and **not
authorized** here. `nativeLendingDecision(check, {authorized})` returns `useNative:true` only when both hold; everywhere in
this app it is called with `authorized:false`, so every loan is application-level SIMULATION. Nothing is lent or moved.
- **Application** (`validateLoanApplication`): borrower, principal, term 1–120 months, AMORTIZING | INTEREST_ONLY_BULLET,
  requested APR, collateral, monthly revenue/opex, existing debt, runway, operating history, uses, legal status.
- **Underwriting scorecard** (max 100; factor points always sum to the score): DSCR at stress rate (requested APR + 500
  bps) 25 · collateral coverage 20 · runway vs term 15 · legal readiness 15 · operating history 10 · use of proceeds 10 ·
  leverage 5. Knockouts: legal FAIL, DSCR < 1.0, any restricted use. ≥ 70 APPROVED, 55–69 APPROVED_WITH_CONDITIONS
  (75% principal, +200 bps), < 55 DECLINED. APR = 600 bps + (100 − score) × 10 bps. Grades A ≥ 85, B ≥ 70, C ≥ 55, D.
- **Interest** (simple, 30/360, no compounding): `I = P × APR × days / 360`; monthly `I_m = opening balance × APR / 12`.
  Amortizing = straight-line principal; bullet = principal in the last month.
- **Scenarios**: CURRENT; LATE (one instalment `lateDays` late: fee = overdue × 200 bps, penalty = overdue × (APR + 400
  bps) × days/360); DEFAULT (payments stop at `missFromPeriod`; default at 90 DPD; EAD = outstanding principal + contract
  interest since the last paid period + penalty interest on overdue instalments); RESTRICTED_USE_BREACH (20% drawn to
  PROJECT_OPEX; breached proceeds are not executable).
- **Loss waterfall**: collateral recovery = min(EAD, collateral × (1 − haircut 30%)); unsecured recovery = remainder ×
  20%; workout cost = 5% of EAD; net loss absorbed by 1) sponsor first-loss tranche, 2) TGLB reserve, 3) senior vault
  lenders pro rata. Lender risk: expected loss = PD(grade: A 2%, B 5%, C 10%, D 25%, illustrative) × default-case lender loss.
- **Sentinel lending risks** (`lendingSignals`): `loan_default`, `loan_restricted_use`, `loan_concentration:lender:<id>`
  (one lender > 50% of vault deposits) / `loan_concentration:loan` (one loan > 40% of deposits).

### Bootstrap / lending API (`/api/incubator`)
```
GET  /bootstrap/meta            tiers, combinations, categories, legal items, lending scorecard/scenarios/uses/pricing, native decision, demo project
GET  /bootstrap/demo            deterministic walkthrough {steps:[{id,title,narration,input,plan}]}
POST /bootstrap/plan            planBootstrap(input) → plan | 400 {errors}      (pure compute, any client, no events)
POST /loans/simulate            simulateLoan({application, vault, scenario, scenarioOpts, terms}) (pure compute, no events)
POST /bootstrap/demo/run        {actor?} records loan-demo-dhc + default stress; returns walkthrough + loan   (localhost)
GET  /loans  /loans/:id
POST /loans                     {actor, application, vault, terms?, projectId?, id?} → loan record           (localhost)
POST /loans/:id/scenario        {scenario: CURRENT|LATE|DEFAULT|RESTRICTED_USE_BREACH, scenarioOpts?, terms?} (localhost)
```
Loans persist in the incubator state (`loans`), cleared by `POST /reset`. `/sentinel-signals` keeps its shape and adds
`incubator:<projectId|loanId>:<kind>:<loanId>` items for each recorded loan's lending risks.

## API (`/api/incubator`)
```
GET  /projects → { mode, disclaimer, projects:[{ id, name, source:'RADAR_DISCOVERED'|'PROJECT_REQUESTED', token:{network,currency,issuer}|null,
       stage, program:'XRP_RLUSD_INTERIM'|'PROJECT_TOKEN_CORRIDOR'|'NONE',
       capitalStack:{ targetUsd, combination, sources:{ T1:{usd,pct}, T2:{usd,pct}, T3:{usd,pct}, PROJECT:{usd}, PROPRIETARY:{usd} } },
       capitalStates:{ T1|T2|T3|PROJECT|PROPRIETARY:{REQUESTED,MATCHED,COMMITTED,FUNDED,EXECUTABLE} },
       gates:{ legal:{status,items[]}, economic:{status,items[]} }, outcome, outcomeStatus:'GATE_COMPUTED'|'COMMANDER_RECORDED',
       mode:'SIMULATION'|'REPLAY'|'LIVE_TESTNET', fictional }] }
GET  /projects/:id   summary + performance{interim, replay[], corridorRings, maturity}, recommendations[], history[], decisions[],
                     fundingGaps[], ownership, gateDetail, proprietary, steps[], tier3, engine, narratives
POST /projects                 intake (localhost) → 400 {error, errors[]} if invalid
POST /projects/:id/stack       {targetUsd, sources, terms?, capitalStates?:{<source>:{MATCHED..EXECUTABLE}}, actor?} (localhost)
POST /projects/:id/gates       {actor, regulatoryReview?, legalItems?, runwayMonths?, demand?} (localhost)
POST /projects/:id/decision    {actor, type: SELECT_SUPPORT|BOOTSTRAP|RECORD_OUTCOME{outcome}|ADVANCE_MATURITY|REDEPLOY{toProjectId?}
                                |APPLY_RECOMMENDATION{recommendationId}|TRANSFER_REQUEST{source,to,amountUsd,ownerAuthorization?}}
                                → {decision:{id,type,actor,at,mode:'SIMULATION',executes:false,result}, project}  (localhost)
GET  /radar  /compare?a=&b=  /sentinel-signals  /meta  /amendments
POST /amendments/refresh (localhost, read-only)   POST /reset (localhost)
```
`outcome` is the gate-computed outcome until the Commander records one (`outcomeStatus`). Refused decisions return 200
with `result.ok:false` and reasons (they are recorded too). POSTs with `mode` other than SIMULATION are refused (409).

Sentinel signals: `{key:'incubator:<projectId>:<kind>', title, severity, category:'incubator', product, market, verification:'SIMULATED',
provenance:'SIMULATION', evidence[], remediation, observedAt}` for unfunded/declined tiers, legal gate not PASS, source
concentration > 50% of executable, T3 credit risk, custody-boundary violations attempted.

## Bus events (all mode SIMULATION)
| Event | Payload |
|---|---|
| `incubator.project_created` | `{projectId, name, source, requestedUsd, regulatoryStatus}` |
| `incubator.stack_changed` | `{projectId, combination, targetUsd, sources, capitalStates}` |
| `incubator.gate_changed` | `{projectId, gate:'legal'\|'economic'\|'outcome', from, to, outcome, revoked?, recordedBy?}` |
| `incubator.decision` | `{projectId, decisionId, decisionType, actor, ok, outcome, executes:false}` (reset: `decisionType:'RESET'`; demo run: `'BOOTSTRAP_DEMO'`) |
| `incubator.loan_applied` | `{loanId, projectId, borrower, principalUsd, actor, label}` |
| `incubator.loan_underwritten` | `{loanId, decision, score, grade, aprBps, approvedPrincipalUsd, knockouts, label}` |
| `incubator.loan_scenario` | `{loanId, scenario, status, label}` |
| `incubator.loan_repaid` | `{loanId, status, paidInterestUsd, feesUsd, penaltyInterestUsd, label}` |
| `incubator.loan_defaulted` | `{loanId, eadUsd, netLossUsd, firstLossAbsorbedUsd, reserveAbsorbedUsd, lenderLossUsd, label}` |
| `incubator.loan_breach` | `{loanId, breaches:[{use, usd}], label}` |

`label` is always `"XLS-65/66-style simulation"`. No payload has a key named `type`.

Scoring narratives shown in the tab: Titan Ghost ("Why Not"), TGLB (Lending), XDLC (Protocol Innovation),
Titan Ghost Merchant (Agentic Finance, links to the x402 tab, unchanged).
