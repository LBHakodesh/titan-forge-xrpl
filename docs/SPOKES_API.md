# Spokes API — 26-spoke XRP hub network (GYW1313 13 + 13)

Data layer for the hub-and-spoke view. **XRP is the hub, not a spoke.** Group A = 13 established, screened XRPL issued
assets (Mainnet). Group B = 13 emerging / project-bootstrap assets: the Titan Forge Testnet project tokens (BBL, LDN) plus
emerging Mainnet assets. Every Spoke is identified by **(network, currency, issuer)**, never by ticker.

Read-only on every network. Nothing in `lib/spokes/**` signs or submits. Mainnet reads go through
`lib/spokes/mainnet-read.mjs` → `lib/mainnet-observer.mjs` (rule 5b), which checks `network_id === 0` before any read.

## Labels
| Label | Meaning |
|---|---|
| `MAINNET_OBSERVED` | Read-only XRPL Mainnet observation of third-party activity. Never Titan Forge activity, never claimed organic or pathfinder-originated. |
| `TESTNET_FUNDED` | Titan Forge project token issued and live on XRPL Testnet (demo accounts, `organic:false`). |
| `TESTNET_CANDIDATE` | A Testnet launch that is queued/running (not yet funded). |
| `LIVE_TESTNET` | (flows) a real Testnet transaction by our demo accounts. |
| `SIMULATION` | Corridor stage and engine recommendation (modeled; nothing allocated). Show `corridor.engineLabel`. |
| `REPLAY` | Deterministic replay of a recorded sequence. |
| `UNAVAILABLE` | No data this snapshot, or a clearly labeled placeholder slot (`placeholder:true`). |

**Attribution (required by XRPL.to's terms):** any screen showing ranking data must show a visible, clickable
`Data by xrpl.to` link to https://xrpl.to. Use `snapshot.attributionHtml` (or `attribution` + `attributionUrl`).

## GET /api/spokes
```
{ hub:{currency:'XRP'},
  snapshot:{ source:'xrpl.to', fetchedAt, freshness:'live'|'cached'|'unavailable', ageSec, attribution:'Rankings: XRPL.to',
             attributionUrl, attributionHtml, refreshMin, rankingTotal, lastError, refreshing, nextRefreshAt },
  groups:{ A:{title:'Established', spokes:[Spoke ×13]}, B:{title:'Emerging & project', spokes:[Spoke ×13]} },
  counts:{ displayed, MAINNET_OBSERVED, TESTNET_FUNDED, TESTNET_CANDIDATE, SIMULATION, REPLAY, UNAVAILABLE, eligible },
  coverage:{ mainnetLedgersScanned, mainnetPaymentsMatched, from, to, fromTime, toTime, mainnetPaymentsSeen, stopReason, liveTestnetPayments },
  screenedOut:[{id, rank, currency, issuer, name, group, stage:'provider'|'ledger', failed:[{id,detail}]}],
  rules:{…screening thresholds…}, labels:{…} }
```
Each group always has exactly 13 spokes; missing slots are `placeholder:true`, `status:'UNAVAILABLE'`, id `placeholder:<A|B>:<n>`.
`counts.displayed` excludes placeholders. Freshness: `live` = last refresh succeeded and the snapshot is ≤ 2× refreshMin old;
`cached` = served from `data/spokes-snapshot.json` (provider/Mainnet unreachable or stale); `unavailable` = no snapshot.

### Spoke
```
{ id:'<network>:<currency>:<issuer>',   // currency = on-ledger code: 3-char or 40-hex
  group:'A'|'B', rank (xrpl.to rank by 24h XRP volume; null for Testnet), network:'mainnet'|'testnet',
  currency (display ticker), currencyHex (40-hex or null), issuer, name,
  status, eligibility:{ eligible, checks:[{id, ok, detail, blocking}] },
  market:{ mode:'MAINNET_OBSERVED'|'LIVE_TESTNET', vol24hXrp|null, bid|null, ask|null, spreadBps|null,
           depthXrp:{ bids:[{band:'0.5%'|'1%'|'2%'|'5%', xrp, clobXrp, ammXrp}], asks:[…] },
           refPrice, refBasis:'clob_mid'|'best_ask'|'best_bid'|'amm'|null, offers:{asks,bids}, makers:{asks,bids},
           amm:{present, xrp, token, priceXrp, account, tradingFeeBps}|null, observedAt },
  testnet:{ code, issuer, funded, book:{source, at, asks:[{account, role, qty, priceXrp}], bids:[…]}, launchId, organic:false } | null,
  corridor:{ stage:'DISCOVERY'|'BOOTSTRAP'|'REINFORCED'|'MATURE'|'OPTIMIZED'|'STANDBY', stageReason, recommendation,
             mode:'SIMULATION', engineLabel, engineId, modeledNotionalUsd, autoAllocate:false },
  flows:{ validated, mainnetObserved, liveTestnet, titanShare|null, rivalShare|null, bridged, ammInvolved, partial },
  alerts:[{severity:'high'|'warn'|'info', text, check?}],
  reason,                     // why this asset qualified for its group
  provider:{…ranking fields…}, issuerProfile:{defaultRipple, requireAuth, globalFreeze, clawback, blackholed, transferFeePct, …} }
```
Prices are XRP per token. Depth = funded XRP within ±band of the reference price (CLOB mid; one-sided books use the best
price of the existing side), CLOB plus AMM (constant-product approximation, fee ignored). Prices in XRP; transfer fees not
applied to depth. `spreadBps` is null when the CLOB is one-sided, empty or crossed.

Eligibility checks (blocking unless noted): `token_type`, `name_integrity` (stablecoin/fiat/XRP/brand ticker from a
non-canonical, unverified issuer), `market_activity`, `activity_quality` (trades per trader), `scam_blocklist` (xrpl.to),
`issuer_exists`, `no_global_freeze`, `no_require_auth`, `default_ripple`, `transfer_fee`, `two_sided_liquidity`,
`mainnet_read`; informational: `market_age`, `concentration`, `ticker_collision`, `clawback`, `blackholed`,
`clob_two_sided`, `book_consistency`. Testnet: `testnet_issuer`, `launch_live` (blocking), `demo_only`, `two_sided_book`.
Ineligible spokes are displayed but are never funding candidates (`modeledNotionalUsd: 0`).

## GET /api/spokes/:id  (id URL-encoded)
`{ spoke, snapshot, transactions:[Tx] }`, transactions newest first.
```
Tx = { hash, ledger, network, kind:'MAINNET_OBSERVED'|'LIVE_TESTNET'|'REPLAY', at,
       from:{currency, issuer|null}, to:{currency, issuer|null}, viaXrp:true|false|null, delivered:{value, currency, issuer},
       rate|null, partial, offerOwners:[{account, role:'titan'|'rival'|'other'|'amm'}], depthAfter:null, explorer, spokeIds,
       // Mainnet extras: circular, offersConsumed, amm
       // Testnet extras: runId, strategy, organic:false, captured:{titanXrp, rivalXrp, otherXrp}, winner }
```
`viaXrp`: true = metadata shows liquidity consumed in both X/XRP and XRP/Y (offers or AMM pools); false = token→token
without that evidence; null = one side is XRP (a hub leg). Mainnet offer owners are never `titan` (we have no Mainnet accounts).

## GET /api/spokes/flows?since=<iso>&limit=<1..500, default 100>
`{ flows:[Tx…], note }` — Mainnet observed + Live Testnet, newest first, `at > since`.

## GET /api/spokes/replay
`{ mode:'REPLAY', seed:1313, recordedAt, durationMs, frames:[{seq, tMs, …Tx, kind:'REPLAY', originalKind}], spokes:[…], note }`.
The recording (real spoke ids and real hashes) is frozen in `data/spokes-snapshot.json` once and carried forward across
refreshes; output is identical on every call. Timing (`tMs`) is synthetic from the fixed seed.

## POST /api/spokes/refresh
Localhost only; rate-limited (one per `TF_SPOKES_MIN_GAP_SEC`, default 300 s). `202 {status:'refreshing'}`, `409` if running,
`429` if too soon, `403` if not localhost. Read-only rediscovery: 1 xrpl.to `/tokens` call + 1 `/scams/addresses` call,
~4 Mainnet reads per screened asset (≤60 assets), and a ledger scan.

## Bus events
| Event | Mode | Payload |
|---|---|---|
| `spokes.snapshot` | MAINNET_OBSERVED | `{fetchedAt, freshness, counts, coverage, attribution}` after each successful refresh |
| `spokes.flow` | = flow kind (`MAINNET_OBSERVED` or `LIVE_TESTNET`) | `{flow: Tx}`; new Mainnet matches per refresh (≤25), new Testnet pathfinder payments (checked every 60 s) |

## Env
`TF_SPOKES_REFRESH_MIN` (default 30, min 5), `TF_SPOKES_MIN_GAP_SEC` (300), `TF_SPOKES_LEDGERS` (Mainnet ledgers per scan,
default 40, max 120; scan deadline 50 s), `TF_SPOKES_AUTO=0` (disable schedule), `TF_SPOKES_FILE` (snapshot path).
On start, a refresh runs only if the snapshot is older than `TF_SPOKES_REFRESH_MIN`.
