# Pathfinder NO_PATH: root cause from ledger evidence

Scope: the 12 token→token payments skipped as `No path: no funded liquidity connects these assets right now.` in LIVE_TESTNET runs 4 (`8c069811`, bridge_leg, k=6, 00:11:51–00:14:02 UTC 2026-10-24) and 5 (`f2ccaa8e`, one_sided, k=6, 00:14:07–00:15:45), compared with run 6 (`8342bff8`, bridge_leg, k=6, 00:17:27–00:19:44, 6/6 success). All payments are demo-generated (`organic:false`). Evidence: historical XRPL Testnet reads only (`tx`, `ledger`, `book_offers` / `account_lines` / `account_info` / `ripple_path_find` at a fixed `ledger_index`), collected 2026-10-24 ~03:05 UTC from `wss://s.altnet.rippletest.net:51233` (rippled 3.4.1, full history 13075065–21776199). Nothing was signed. Machine-readable copy: `data/pathfinder-evidence.json`, served at `GET /api/pathfinder/no-path` and `GET /api/pathfinder/evidence[/:runId]`.

## Bottom line

**Classification: other. The cause was rippled's path search, not liquidity.** At every pathfind ledger, the public Testnet server's `ripple_path_find` returned **0 alternatives** for BBL→LDN and LDN→BBL. It still returned 0 when re-run against those exact historical ledgers. At the same ledgers it **did** find each single-book leg (BBL→XRP and XRP→LDN), and every check of liquidity and setup passed:

- funded depth on both legs covered each payment at least 1.97×;
- the router's trustlines and balances were sufficient, and the taker had headroom;
- no offer was unfunded;
- every strategy quote was in a validated ledger before the first pathfind;
- the direct BBL/LDN books were empty, so XRP bridging was the only route.

The code that ran in runs 4–5 had no fallback. `replay.mjs` treated rippled's empty `alternatives` as "no funded liquidity". That wording was wrong: it was rippled's answer, not an application pre-check.

Run 6 had the same options, quotes, sizes, mids and depth. rippled again returned 0 alternatives (confirmed by historical re-run). Run 6 succeeded only because the code had changed at 00:17:13 UTC. It added an XRP-bridge fallback: path-find each leg on its own, build `Paths [[XRP, dest]]`, check with `simulate`, then send. Metadata confirms all 6 run-6 payments consumed offers in both the X/XRP and XRP/Y books.

The earlier "depletion" guess is contradicted by the books. Depth was unused (8.8 XRP of BBL bids and 1,784.8 LDN of asks in run 4), and the books were byte-identical across every ledger of the skip window.

| Check (each skipped payment) | Run 4 (ledgers 21773109–21773115) | Run 5 (ledgers 21773143–21773149) | Run 6 (same request) |
|---|---|---|---|
| Plain `ripple_path_find` BBL↔LDN, re-run at pathfind ledger L and L+1 | **0 / 0** alternatives (all 6) | **0 / 0** (all 6) | **0** (all 6, at ledgers 21773209–21773219) |
| Leg A `X→XRP` single-book pathfind at L | found (e.g. 180.8169 BBL → 1.624911 XRP, path `[XRP]`) | found | n/a |
| Leg B `XRP→Y` single-book pathfind at L | found (1.624911 XRP → 180.2752222 LDN, path `[LDN]`) | found | n/a |
| Funded leg A (source-token bids) vs largest need | 8.8 XRP vs 1.924 XRP | 3.8 XRP (rival 3 + seed 0.8, one_sided posts no bids) vs 1.929 | 8.8 XRP |
| Funded leg B (dest-token asks) vs largest need | 1,784.76 LDN vs 213.47 BBL-eq | 1,562.04 vs 213.47 | same as run 4 |
| Unfunded offers on either leg | 0 | 0 | 0 |
| Router trustline / balance | BBL 440.78, LDN 387.87, limit 1e9 | same | — |
| Taker trustline headroom | LDN 1,999,148; BBL 999,762 | same | — |
| Issuer | DefaultRipple set, no TransferRate | same | — |
| Strategy quotes validated before first pathfind | yes: ledgers 21773094–21773108 ≤ 21773109 | yes: 21773133–21773143 ≤ 21773143 | yes |
| Direct BBL/LDN book offers | 0 | 0 | 0 |
| Books changed during skip window | no (8 ledgers, identical) | no (8 ledgers, identical) | — |
| Code path | `ripple_path_find` only; empty alternatives became "No path…" | same | + `bridgeFallback()` + `simulate` |
| Outcome | 6 skipped | 6 skipped | 6/6 tesSUCCESS, bridged |

## How the decision was made (replay.mjs)

`pathfind()` sends one `ripple_path_find` with these parameters:

- `source_account` = router `rno84rguzSP8uPD1JhCi2tKRc2P1b4TdBH`
- `destination_account` = taker `rEMtNB4An8wGnbdvW2DRFJJsYWJr7xf5Pi`
- `destination_amount` = `sizeXrp / mid` of the destination token (e.g. `{LDN, rLXCW…, "180.2752222"}` for 1.622477 XRP-eq)
- `source_currencies` = `[{currency: from, issuer: rLXCW…}]`
- no `send_max`

It then looks for an alternative whose `source_amount` is in the source token. There is no pre-check before this call. In the code that ran in runs 4–5, an empty match returned `{ok:false, reason:'No path: no funded liquidity…'}` immediately. The parameters are correct: they match the router's trustline, and each `destination_amount` was 0.3–12% of leg-B funded depth.

Variants re-run at ledger 21773110 also returned no BBL-sourced route:

- no `source_currencies`: returned XRP and LDN alternatives only;
- currency without issuer;
- a 1 LDN destination;
- other account pairs (taker→router, maker→taker, router→router);
- run 6's ledger 21773209 and the current ledger.

The limit is therefore general: this server's path search does not return the two-book XRP-bridged path (token→XRP→token). This is consistent with rippled's path-type table, where the bridged non-XRP→non-XRP type sits above the default search level. That last point is inferred; the server configuration was not checked. The 00:16:44 probe in the session transcript showed the payment engine itself handles the route. `simulate` of BBL→LDN gave:

- `tesSUCCESS` with explicit `Paths [[XRP, LDN]]`;
- `tecPATH_PARTIAL` with default paths only.

Ledger close times use a 10 s resolution. The pathfind ledger L is the last ledger whose close time ≤ the recorded `at`. For example, run 5 payment 1 maps to 21773143, whose rounded close time (00:14:50) is 1 s after `at`. The run's own step order proves that ledger was validated first. Every ledger in the window had identical books and the same 0-alternative answer, so the rounding does not affect the result.

## Code timeline (session transcript c0ecb8b4, treated as data; file times)

| UTC | Event |
|---|---|
| 00:11:37 | `routeMix` override added to replay.mjs (operator-forced token_to_token) |
| 00:11:42 | server restarted (pid 495009); runs 4 and 5 run this code (no fallback, no `simulate` in the read allowlist) |
| 00:15:47 | runs 4 and 5 report 12/12 skipped |
| 00:16:00 | probe: BBL→LDN `ripple_path_find` = none; XRP→LDN and BBL→XRP found |
| 00:16:44 | probe: `simulate` with explicit `[[XRP, LDN]]` = tesSUCCESS; default paths = tecPATH_PARTIAL |
| 00:17:13 | `bridgeFallback()` added to replay.mjs; `simulate` added to testnet-io.mjs allowlist |
| 00:17:24 | server restarted; run 6 created 00:17:27, 6/6 bridged |

## Changes made in this pass (owned files)

- `replay.mjs`: the run record now persists `pathfind.method` and `pathfind.alternatives`. In run 6 the method was only inferred, because the record dropped it. The no-path reason now says what happened: rippled returned no route and the XRP-bridge fallback did not verify one. It no longer claims "no funded liquidity".
- `lib/pathfinder/evidence.mjs`: the read-only collector, per-payment evidence builder, and `classifyNoPath()`. The classifier checks, in order: trustline/balance, validation timing, funding, depth, request parameters, application pre-check, then whether the rippled answer reproduces.

## Per-run summary (from metadata)

| Run | Strategy vs rival | Result | Flow captured (XRP of offers consumed) | Exec vs mid (spread / impact) | Notes |
|---|---|---|---|---|---|
| 1 `12367bad` | tight vs static_wide | 8/8 | Titan maker 100% (1.7233) | 5 bps (5 / 0) | single-book only |
| 2 `96a0fa7a` | wide vs static_wide | 8/8 | rival 99.7% (5.0979), Titan 0.3% (0.0131) | 100–103.1 bps (100 / 0–3.1) | the 2 XRP payment walked past the rival into Titan's wide ask |
| 3 `deb8ca8b` | bridge_leg vs static_wide | 8/8 | Titan maker 100% (5.0797) | 15 bps (15 / 0–0.2) | no token→token in the sampled mix |
| 4 `8c069811` | bridge_leg vs static_wide | 0/6 (6 skipped) | — | — | NO_PATH: other (rippled path search) |
| 5 `f2ccaa8e` | one_sided vs static_wide | 0/6 (6 skipped) | — | — | NO_PATH: other (rippled path search) |
| 6 `8342bff8` | bridge_leg vs static_wide | 6/6, 6 bridged (verified both legs) | Titan maker 100% (8.6029, both legs) | 30–30.2 bps (30 / 0–0.2) | method `xrp_bridge_fallback` (inferred: plain re-run = 0 alternatives) |

- Depth never ran out in any run. The lowest executable route depth left before a next payment was 5.33 XRP (run 2).
- Every fee was 0.000012 XRP. No AMM pool and no unfunded or expired removals were touched.
- The pathfinding alternatives list was not recorded at run time. For token→token payments it was reconstructed by historical re-run.

## Corridor-continuity test plan

**Status: planned, `approved:false`. Nothing has been submitted.** Dry run: `GET /api/pathfinder/continuity-plan`. It reads `server_info`, the top of each book and balances, and never calls submit (a unit test with a throwing fake ledger enforces this). Executing it needs a separate Commander approval plus a runner for the phases, which is not built.

Titan ladder per book (ring spreads are the illustrative `public/domain.js` values): L1 VELOCITY ±5 bps, L2 BRIDGE ±15 bps, L3 EARN ±40 bps, 1 XRP notional each. The rival is static at MONEY ±100 bps unless stated. Mid is 0.009 XRP for both BBL and LDN. The launch seed offers (ask 0.01, bid 0.008, about ±1,111 bps) remain on the books.

| Phase | Route | Payments (XRP-eq) | Liquidity | Measures | Predicted (SIMULATION book walk) |
|---|---|---|---|---|---|
| A Level sweep | XRP→BBL | 0.25, 0.5, 0.75, 1.0, 1.5 | Titan BBL asks L1–L3; rival ask +100 bps, 3 XRP | levels swept per payment, impact bps, when VELOCITY is insufficient | VELOCITY insufficient from payment 3; payment 5 spills L3 + rival (Titan 33%) |
| B Titan vs rival pricing | XRP→LDN | 0.25, 0.5, 1.0, 1.5 | Titan LDN asks L1–L3; rival +4 bps, 0.5 XRP (inside Titan) | Titan's loss at the touch and recapture after the rival's size runs out | #1 rival 100%; #2 rival + Titan L1; #3–4 Titan |
| C Bridged corridor | BBL→XRP→LDN (fallback path) | 0.5, 1.0, 1.5, 2.0 | Titan BBL bids L1–L2 + LDN asks L1–L2; rival BBL bid and LDN ask +100 bps, 3 XRP each | both-leg depth, Titan vs rival per leg, when bridged depth runs out | VELOCITY insufficient from payment 2; #3 mixed; #4 rival |
| D Replenishment latency | XRP→BBL | 6 × 0.4, paced 4 s | Titan L1 ask 0.5 XRP with replenish; rival +100 bps, 3 XRP | fill ledger and time → replacement validated ledger and time; whether the next payment hits the replenished quote | Titan 100% if replenishment finishes within the 4 s pace |

Every payment records hash, delivered amount, owners and levels consumed (metadata), verified XRP bridge legs, depth before/after, exec/spread/impact in bps, fee, the pathfinding method and rippled's alternatives count.

**Exact budget** (dry run at validated ledger 21776423, fee 0.000012 XRP/tx, owner reserve 0.2 XRP):

| Item | Amount |
|---|---|
| Transactions | 58 = maker 28 (A 6, B 6, C 8 = OfferCreate + worst-case OfferCancel per quote; D 8 = 2 + 6 replenishes) · rival 10 · router 19 payments · issuer 1 (inventory) |
| **Fees (XRP actually consumed)** | **0.000696 XRP** (58 × 0.000012); 0.002088 XRP with ×3 safety |
| Owner reserve locked at peak (released on fill/cancel) | 1.2 XRP (maker 4 offers = 0.8, rival 2 = 0.4) |
| XRP resting in bids at peak | maker 2 XRP, rival 3 XRP |
| Router XRP SendMax, all XRP→token payments | 9.79475 XRP (goes to our demo makers for tokens; not lost) |
| Router BBL SendMax, phase C | 575.1667 BBL |
| Inventory setup | issuer issues 510 BBL to router (has 187.33, needs 575.17) |
| Largest single transaction | 3 XRP (Guardian cap 20) |
| Hourly cap | 19 payments of 120 |
| Upper bound needed at once across demo accounts | 15.996838 XRP |
| Guardian | 0/36 proposals allowed now (no approval); 36/36 once approved |

Net XRP cost to the demo set is fees only: **0.000696 XRP**. Every counterparty is a demo account, so all other XRP moves between our own accounts. Inventory setup is recomputed from live balances whenever the dry run is called.
