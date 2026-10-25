# Vendor Integration Matrix

Titan Forge, London staging, verified 2026-10-25. These are integrations that are part of the product, not a sponsor list. Each one is an adapter in `lib/vendors/<id>.mjs` with a status computed from env (whether a credential is set, never its value) and from real read-only probes. Samples in `data/vendor-samples.json` are written only by a successful real probe, with a timestamp. They are never fabricated or hand-edited.

**No vendor path executes a payment, signs for Mainnet, submits a transaction or charges a card.** Live x402 payments, including on Testnet, still need the Commander's explicit approval for each payment (see `docs/HACKATHON_AGENTIC_PAYMENT_SECURITY.md`).

## States

| State | Meaning |
|---|---|
| `CONNECTED_TESTED` (connected, tested) | A read-only probe against the vendor succeeded in this server process |
| `CONNECTED` (connected) | Credentials are configured, or a verified sample from an earlier real probe exists, but the vendor has not been probed again in this process |
| `CREDENTIALS_REQUIRED` (credentials-required) | The adapter is built, but its env variables are not set |
| `SANDBOX_ONLY` (sandbox-only) | Works only against a test environment or the visitor's browser or device |
| `DOCUMENTATION_ONLY` (documentation-only) | The capability is verified in public docs, but this node makes no API call to the vendor |
| `ERROR` | The last read-only probe failed. The adapter also emits a Sentinel signal |

## Matrix

| Vendor | Status now | Evidence | Mode labels | Where it acts in the liquidity loop |
|---|---|---|---|---|
| **XRPL / Ripple** | `CONNECTED_TESTED` after a probe (`CONNECTED` from the stored sample) | Probe at 2026-10-25T10:27:57Z via `lib/mainnet-observer.mjs` → `wss://xrplcluster.com`: rippled 3.4.1, validated ledger 107,891,414. `book_offers` RLUSD/XRP returned 5 offers, all funded. `amm_info` XRP/RLUSD: 2,378,228 RLUSD, fee 214. `account_offers`: 2 offers for the top offer owner. `tx` metadata for OfferCreate `341286F7…94DB` (tesSUCCESS, 10 affected nodes). `feature`: 97 of 107 amendments enabled (SingleAssetVault and LendingProtocol supported but not enabled). Testnet re-read of the x402 settlement `63DA6274…8270`: validated, tesSUCCESS, ledger 21,773,074 | `MAINNET_OBSERVED` (Mainnet), `LIVE_TESTNET` (recorded Testnet) | **make / route**: Titan Ghost maker offers and Pathfinder routing on Testnet; Mainnet read-only observation (Watch Titan Ghost, Pathfinder) |
| **t54 XRPL x402** | `CONNECTED_TESTED` after a probe (`CONNECTED` from the stored sample) | Probe at 2026-10-25T10:27:57Z: `GET https://xrpl-facilitator-testnet.t54.ai/supported` returned 200 with kinds exact, upto and batch-settlement on `xrpl:1`, x402 v2, extension `x402Secure`. This is the same wire format as TG Merchant (`lib/x402`). We probe only `/supported`: no `/verify` or `/settle` call, no Mainnet facilitator, no payment. t54 is **not** in the settlement path | `LIVE_TESTNET` (read-only discovery) | **paid data**: TG Merchant shows t54's `/supported` kinds next to its own facilitator (`GET /api/x402/supported`) as the drop-in option. Discovery only |
| **TG Merchant x402** (ours, frozen) | Built | `GET /api/x402/data/wake` with no payment header returns a real 402 with the PAYMENT-REQUIRED header (exact, xrpl:1, 50,000 drops, InvoiceID). The recorded receipt `run-44dd51e5` / tx `63DA…8270` is shown as REPLAY and labelled **settled but not authorized** | `SIMULATION` (challenge), `REPLAY` (receipt) | **paid data**: the facilitator in use (settlement only with per-payment owner approval) |
| **Ledger** | `SANDBOX_ONLY` | Probe at 2026-10-25T10:27:58Z: all three pinned ESM modules load from cdn.jsdelivr.net with the expected exports (`DeviceManagementKitBuilder`, `webHidTransportFactory`, `SignerXrpBuilder`). Detection, address and review run in the visitor's browser over WebHID. The review transaction is unsigned, Testnet only and 1 drop, and its `LastLedgerSequence` is already past, so it can never execute. Signing needs the owner checkbox **and** a press of the device button. The signature stays in the page. **Not tested with physical hardware on this node** | `SANDBOX_ONLY` | **self-custody funding**: TGLB Bootstrap Tier 1/2 "Commit from your own wallet with Ledger": unsigned, expired Testnet OfferCreate from the participant's own account, reviewed on device |
| **QuickNode** | `CREDENTIALS_REQUIRED` | Adapter built: WSS through MainnetObserver (read allowlist), HTTP JSON-RPC limited to read methods, Streams `GET /streams` only. Without credentials the probe checks the public fallback node, does not count it as a QuickNode test and stores no sample | `MAINNET_OBSERVED` / `LIVE_TESTNET` by `network_id` | **observe fills**: when `QUICKNODE_XRPL_WSS` is set and serves Testnet, Theater fill observation (`GET /api/theater/observe`) and Sentinel ledger freshness read through it and show "Data via QuickNode"; otherwise the public Testnet node, shown as such. Streams filter template (not deployed) |
| **AWS Bedrock AgentCore** | `CREDENTIALS_REQUIRED` (`DOCUMENTATION_ONLY` once AWS creds exist; no AWS call) | `lib/vendors/agentcore-tools.json`: 12 read-only GET tools in MCP shape (adds `tf_get_sentinel_coverage`, `tf_get_theater_state`; radar and corridor state tagged TG Intelligence) for a Gateway, each validated against registered routes. OpenTelemetry span mapping for bus events. AgentCore Payments documents Coinbase CDP and Stripe (Privy), not XRPL, so we do not assume XRPL settlement | `DOCUMENTATION_ONLY` | **agent tools / observability**: TG Intelligence / Sentinel read-only tools (XDLC radar, Sentinel coverage, corridor state, Theater state and more) + OTEL spans |
| **Mastercard Agent Pay (AP4M)** | `DOCUMENTATION_ONLY` | Local demo: intent → owner mandate → Titan Guardian (`guardCheck`, SIMULATION) → authorization concept → audit record (`executed:false`, `charged:false`). No Mastercard call is made even with `MASTERCARD_*` set. Mastercard has not announced XRPL settlement, and nothing here implies it | `DOCUMENTATION_ONLY`, `SIMULATION` | **not in the liquidity loop**: TG Merchant only, agentic-commerce concept, docs only |

### Public facts we rely on (docs checked 2026-10-25)

- **QuickNode:** The XRPL JSON-RPC API supports HTTP and WSS on Mainnet and Testnet (quicknode.com/docs/xrpl/api-overview). Streams REST lives at `https://api.quicknode.com/streams/rest/v1` with header `x-api-key` (docs/streams/rest-api). Streams supports XRP Ledger Mainnet and Testnet with the Block "(Ledger)" dataset (docs/streams/supported-chains). The `server_info`, `book_offers`, `account_offers`, `ledger` and `tx` pages exist. The `amm_info` and `feature` pages return 404, so we don't claim those methods are on QuickNode.
- **Ledger:** The developers.ledger.com XRP signer page documents `@ledgerhq/device-signer-kit-xrp`: `SignerXrpBuilder({dmk, sessionId}).build()`, `getAddress(path, {checkOnDevice})`, `signTransaction(path, Uint8Array)` and `getAppConfig()`. We pinned signer 0.2.0 (2026-09-02), which imports DMK 1.9.0, and web-hid 1.2.4. Signer 0.3.0 is less than two weeks old.
- **t54:** docs.t54.ai/docs/xrpl/overview describes a "Public facilitator for x402 payments over XRPL using presigned XRPL Payment transactions". xrpl-x402.t54.ai/docs/quickstart lists the testnet host `xrpl-facilitator-testnet.t54.ai` (xrpl:1) and the mainnet host `xrpl-facilitator-mainnet.t54.ai` (xrpl:0). The Verifiable Intent page describes a Mastercard-aligned SD-JWT chain (L1 → L2 → L3). `github.com/t54-labs/x402-xrpl` returned **404** today. Related org repos include `x402-secure` and `monid-x402-xrpl`.
- **AWS AgentCore:** The devguide lists Gateway (APIs and Lambda as MCP tools), Identity, Observability (OTEL and CloudWatch), Policy (Cedar-compatible) and Payments (x402 and MPP via Coinbase CDP or Stripe/Privy).
- **Mastercard:** mastercard.com press pages return HTTP 403 to automated fetches, so this summary comes from search-indexed copies of the June 2026 launch release and from coverage of the 2026-10-20 early-access opening:
  - AP4M offers credentialing, permissioning, transacting and settling, with programmatic spending limits.
  - It is x402-based, using a signed voucher.
  - Pilots settled via Base and BVNK.
  - It is still a pilot.
  - The developer API reference lists Sandbox, MTF and Production hosts, but the linked OpenAPI is a placeholder.
  - The October "in action" release itself could not be fetched. Treat it as unverified until the Commander opens it in a browser.
- **XRPL Commons sponsor ecosystem:** not reviewed (time). No APIs are claimed.

## Vendors in the liquidity loop (2026-10-25)

Single source: `LIQUIDITY_LOOP` in `lib/vendors/index.mjs`, returned as `loop` by `GET /api/vendors` with each vendor's live status and rendered as the "Vendors in the liquidity loop" strip on the Vendor Integrations tab.

- **QuickNode preference rule** (`lib/vendors/observation.mjs`): QuickNode is used only when `QUICKNODE_XRPL_WSS` is a `wss://` URL **and** its `server_info` reports `network_id` 1 (the checks are Testnet). A Mainnet endpoint, a failure or an unset variable falls back to the public Testnet client, and the result carries `source.label` plus `quicknodeSkipped` when relevant. All QuickNode traffic goes through `MainnetObserver` (read allowlist). The URL token never appears in any output.
- **QuickNode Streams filter** (`lib/vendors/quicknode-stream-filter.json`): ready to deploy, **not deployed**. A JS `main(stream)` filter that keeps XRPL transactions touching the maker / router / router2 / router3 accounts (as sender, destination or affected AccountRoot). Addresses are filled in at render time from `GET /api/status` (`GET /api/vendors/quicknode/stream-filter`), never hardcoded and never seeds. Confirm the input shape with QuickNode's "Test filter" on a real Testnet ledger before creating the stream (operator-approved step).
- **Ledger commitment** (`buildCommitmentTx`): passive OfferCreate offering up to 10 Testnet XRP for the demo token at the demo bid price, from the participant's own address, memo `tglw/commitment-illustration`, `LastLedgerSequence` already expired. The browser (`public/vendors-ledger.js`, shared by both tabs) refuses to send anything to the device that fails `isNonExecutable()`. Copy: "Your funds stay in your wallet; Titan Ghost never holds your keys." SANDBOX_ONLY: untested with hardware.
- **t54 in TG Merchant**: `GET /api/merchant/flow` adds `facilitators` (TG Merchant's own `/api/x402/supported` and t54's last verified `/supported` read). The flow never calls t54; the "Re-read t54 /supported" button uses the existing localhost probe. No `/verify` or `/settle`.
- **Mastercard** stays DOCUMENTATION_ONLY and appears only in TG Merchant (and in the strip, marked as outside the loop).

## Endpoints

`GET /api/vendors`, `GET /api/vendors/:id`, `POST /api/vendors/:id/probe` (localhost only, at most one per vendor per 15 s and 12 per minute in total, read-only), `GET /api/vendors/sentinel-signals` (same shape as `/api/incubator/sentinel-signals`), `POST /api/vendors/ledger/review {account, publicKey}` (unsigned, non-executable Testnet transaction), `POST /api/vendors/ledger/commitment {account, publicKey, tier: T1|T2, amountXrp?, termDays?}` (unsigned, expired TGLW OfferCreate; shares the 10/min limit), `GET /api/vendors/quicknode/stream-filter` (rendered template, `deployed:false`), `GET /api/theater/observe` (fill re-read, cached 30 s, source labelled), `GET /api/merchant/flow` (cached 20 s, `paymentExecuted:false`).
Event: `vendors.probe` (mode `MAINNET_OBSERVED` / `LIVE_TESTNET` / `SIMULATION`, or `UNAVAILABLE` on failure) `{vendor, status, ok, latencyMs, sampleStored}`.
UI: tabs **Vendor Integrations** (`vendors`, order 92) and **TG Merchant** (`merchant`, order 93). Presentation: `CustomEvent('tf:present', {detail:{scene:'vendors'}})` (or `'merchant'`).
Allowlist change: `lib/mainnet-observer.mjs` now allows the read-only `account_offers` and `feature`. `feature` is accepted only without `vetoed`, which is the admin vote.

## Commander checklist: keys, approvals, scopes

None of these are needed for today's demo. Every adapter degrades honestly without them.

1. **QuickNode**
   - [ ] Create a QuickNode account and an **XRP Ledger** endpoint (Mainnet for observation, or Testnet).
   - [ ] Set `QUICKNODE_XRPL_WSS` (preferred, because it goes through the observer allowlist) and/or `QUICKNODE_XRPL_HTTP`. The token is part of the URL, so treat the whole URL as a secret.
   - [ ] Optional Streams: create a QuickNode API key with the **Streams** permission and set `QUICKNODE_STREAMS_KEY`. The adapter only lists streams. Creating a stream with an XRPL Block dataset and a webhook is a separate, operator-approved step.
   - [ ] Check plan limits (requests/sec, Streams pricing) before enabling it on stage.
2. **AWS Bedrock AgentCore**
   - [ ] An AWS account with Bedrock AgentCore available in the chosen `AWS_REGION`.
   - [ ] An IAM role or SSO profile (`AWS_PROFILE`) with AgentCore Gateway create/manage permissions (`bedrock-agentcore:*Gateway*`, `*GatewayTarget*`), AgentCore Identity (an OAuth/Cognito inbound authorizer) and CloudWatch Logs/X-Ray write access for Observability. Prefer SSO over static keys.
   - [ ] A public, authenticated HTTPS URL for Titan Forge, because the node binds 127.0.0.1 today, plus an outbound credential (API key or OAuth client) for the Gateway target.
   - [ ] Approve the 12 read-only tools in `lib/vendors/agentcore-tools.json`. No POST routes may be exposed.
3. **Mastercard Agent Pay / AP4M**
   - [ ] Apply for **AP4M early access** at developer.mastercard.com. Being a pilot, it needs Mastercard approval.
   - [ ] Create a developer project with the Agent Pay product in **Sandbox**, then download the consumer key and the `.p12` signing key (OAuth 1.0a request signing).
   - [ ] Set `MASTERCARD_CONSUMER_KEY`, `MASTERCARD_SIGNING_KEY_PATH` (outside the repo, chmod 600), `MASTERCARD_SIGNING_KEY_ALIAS`, `MASTERCARD_SIGNING_KEY_PASSWORD` and `MASTERCARD_ENV=sandbox`.
   - [ ] Get the real OpenAPI spec (the published one is a placeholder) and written confirmation of which settlement rails apply. Do not imply XRPL.
4. **t54**
   - [ ] No key is needed for `/supported`. Before using t54 for settlement: Commander approval, confirmation that it is Testnet only, and a per-payment approval flow. Today TG Merchant uses its own local facilitator.
5. **Ledger**
   - [ ] A Ledger device with the **XRP app** installed, and desktop Chrome or Edge (WebHID). Test detection, address and review once before the demo. Physical hardware has not been tested on this node.
6. **XRPL**
   - [ ] None. Public nodes only, read-only. Keep the observer allowlist read-only.
