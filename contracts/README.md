# Titan Forge engine contract (v1.0.0, wire v1)

How the authentic Titan Ghost **Rust Quoter** and **Strategic Engine** plug into Titan Forge, replacing the
*temporary demo adapter* (`lib/engine/demo-adapter.mjs`) with no frontend changes.

Titan Forge contains **no proprietary trading logic**. It only defines message shapes, validates them, and labels
the results. Everything here is XRPL **Testnet** only.

## Files

| Path | What |
|---|---|
| `schemas/*.schema.json` | Normative JSON Schema 2020-12 contracts. Enums are derived from `public/domain.js`; `test/engine.test.mjs` fails on drift. |
| `examples/*.example.json` | One valid example per schema (also served at `GET /api/engine/examples/:name`). |
| `rust/src/types.rs` | Serde mirrors of the schemas. If they disagree with the schemas, the schemas win. |
| `rust/src/main.rs` | `tf-stub-engine`: **placeholder conformance stub, NOT the authentic engine** (zero allocation, price 1, "hold"). |
| `stub-engine.mjs` | The same stub in JS, for machines without cargo. |
| `conformance.mjs` | Conformance test runner (below). |

Schemas: `common` (Mode, RingId, StageId, MarketId, TierId, ProfileId, MarketRef, CurrencyCode, ClassicAddress),
`financial-event`, `token-ref`, `asset`, `tx-evidence`, `ring-metrics`, `allocation`, `corridor-state`,
`recommendation`, `quote-request`, `quote-response`, `strategy-request`, `strategy-response`, `engine-info`,
`rpc-request`, `rpc-response`.

## Transport

Pick one; Titan Forge selects it from the environment at startup.

* **stdio (preferred):** `TF_ENGINE_BIN=/path/to/engine` (optional `TF_ENGINE_ARGS="--a b"`, space-split).
  Titan Forge spawns the binary with a minimal environment (`PATH`, `TF_CONTRACT_VERSION`) and writes one
  `RpcRequest` JSON object per line to stdin. The engine writes one `RpcResponse` per line to stdout, in any order
  (matched by `id`). **stdout is protocol only** — logs go to stderr (Titan Forge forwards the first 500 chars).
* **HTTP:** `TF_ENGINE_URL=http://127.0.0.1:PORT/rpc`. Each request is `POST` with the `RpcRequest` as the JSON body;
  the response body is the `RpcResponse` (HTTP status is ignored; use the error model). Loopback only unless
  `TF_ENGINE_ALLOW_REMOTE=1`.

Other knobs: `TF_ENGINE_TIMEOUT_MS` (default 2000), `TF_ENGINE_HEALTH_MS` (default 15000).

## Message flow

```
Titan Forge                          Engine
  {"v":1,"id":"tf-1","method":"info","params":{}}         ->
                                     <- {"v":1,"id":"tf-1","ok":true,"result":<EngineInfo>}
  (adapter becomes active only if EngineInfo is valid and contractVersion major == 1)
  every 15 s: method "health" -> any ok:true result   (failure => fall back to demo adapter, re-handshake)
  method "strategy", params <StrategyRequest>  -> result <StrategyResponse>
  method "quote",    params <QuoteRequest>     -> result <QuoteResponse>
```

`RpcRequest = { v: 1, id, method: info|health|quote|strategy, params, deadlineMs? }`.
`RpcResponse = { v: 1, id, ok: true, result } | { v: 1, id, ok: false, error: { code, message, retryable? } }`.

Every request is validated before it is sent and every response is validated on receipt. A response that fails its
schema is treated as an engine error (`INTERNAL`) and never reaches the UI.

## Versioning

* `contractVersion` (semver, in `EngineInfo`): Titan Forge accepts any engine whose **major** matches (`1.x.y`).
  Minor = additive optional fields. Major = breaking.
* `v` (wire envelope): `1`. Engines must answer any other `v` with `UNSUPPORTED_VERSION`.
* Schemas set `additionalProperties: false` on engine outputs, so a new output field needs a contract minor bump
  on *both* sides.

## Error model

| code | meaning | retryable |
|---|---|---|
| `BAD_REQUEST` | params failed validation | no |
| `UNSUPPORTED_VERSION` | wire `v` not supported | no |
| `UNKNOWN_METHOD` | method not implemented | no |
| `NOT_READY` | warming up / no data | yes |
| `MODE_VIOLATION` | request would mislabel a mode | no |
| `TIMEOUT` | internal deadline exceeded (`deadlineMs`) | yes |
| `INTERNAL` | anything else | maybe |

Titan Forge also raises `TIMEOUT` locally when no answer arrives within `TF_ENGINE_TIMEOUT_MS`.

## Mode rules (hard)

* Every output carries `mode`: `LIVE_TESTNET`, `SIMULATION` or `REPLAY`.
* `Allocation`, `Recommendation`, `StrategyResponse` describe **hypothetical capital** and may only be `SIMULATION`
  or `REPLAY` (schema-enforced). Echo the request mode.
* `QuoteResponse.mode` must equal `QuoteRequest.mode` (adapter-enforced). A `LIVE_TESTNET` quote is only a proposal;
  signing happens in Titan Forge's `Ledger.submit()` (Testnet-only, Guardian-checked), never in the engine.
* `TxEvidence` is `LIVE_TESTNET` only and must link to `https://testnet.xrpl.org/transactions/<HASH>`.
* `EngineInfo.authentic` must be `false` for anything other than the real Titan Ghost engines, and a non-authentic
  engine's `label` must say so. The UI prints `label` next to every engine output.

## How synchronous callers are bridged (no breaking change)

Existing callers use `getEngine().allocate()` / `.recommend()` **synchronously**. Those signatures are frozen.

* The `RustEngineAdapter` answers them from a short-TTL cache (15 s) of `strategy` responses keyed by the request.
* On a cache miss it returns the demo adapter's result **tagged** `source: "temporary-demo-adapter (Rust cache miss)"`
  and fetches from the engine in the background (max 4 in flight); the next identical call gets the engine result.
* To avoid misses, warm the cache: `await getEngine().prefetchAllocate?.(capitalUsd, opts)` /
  `prefetchRecommend?.(markets)`.
* New code should use the **v2 async** methods present on every adapter: `await engine.strategyAsync(StrategyRequest)`
  and `await engine.quoteAsync(QuoteRequest)` (the demo adapter rejects `quoteAsync` with `NOT_READY`: it has no quoter).

`allocate(capitalUsd, opts)` maps to a one-market `StrategyRequest` (`opts.marketId` or `currencies`);
`recommend(markets)` maps to a multi-market `StrategyRequest` and returns `recommendations`.

## Conformance test

```
# JS reference stub (no cargo needed)
node contracts/conformance.mjs --bin node --args contracts/stub-engine.mjs
# your engine over stdio
cd contracts/rust && cargo build --release && cd ../..
node contracts/conformance.mjs --bin contracts/rust/target/release/tf-stub-engine
# your engine over HTTP
node contracts/conformance.mjs --url http://127.0.0.1:9000/rpc
```

It checks the handshake, health, strategy (multi-market, single spoke, REPLAY echo), quotes (bid/ask), the three
error codes, and the authentic/label rule. Exit code 0 means conformant. Full Titan Forge tests:
`node --test test/engine.test.mjs`.

## Running Titan Forge against an engine

```
TF_ENGINE_BIN=/path/to/engine node server.mjs
curl -s http://127.0.0.1:4131/api/engine/info      # active adapter, label, authentic, status, schemas
curl -s http://127.0.0.1:4131/api/engine/selftest  # validates live adapter outputs + recorded TxEvidence
```

If the engine is missing, unhealthy or on the wrong major version, Titan Forge keeps the temporary demo adapter and
`info().note` / the Engine Contracts tab say why.
