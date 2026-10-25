# Titan Ghost Engine Theater

Tab **Watch Titan Ghost** (`public/modules/05-theater.js`, order 5). A full-screen, trading-terminal-style view of the engine.

**It is a browser recreation of the Titan Ghost Rust TUI layout. The authentic TUI capture is still pending from NY-Node.** The screen says this. When a sanitized capture is added (see below), it is replayed in the AUTHENTIC TUI CAPTURE panel.

## Modes (every number carries one)
| Label | Meaning | Source |
|---|---|---|
| `LIVE_TESTNET` | Validated XRPL Testnet activity between our own demo accounts (`organic:false`) | `/api/status`, `/api/book/:code`, `/api/loop/catches`, Pathfinder runs (`ctx.pathfinder.runs()`), SSE |
| `MAINNET_OBSERVED` | Read-only sample of third-party Mainnet activity | `data/mainnet-profile.json` |
| `HISTORICAL_MAINNET` | Titan Ghost's own past Mainnet activity, read-only | `TG_MAINNET_ACCOUNTS` → `lib/theater/mainnet-history.mjs` → `lib/mainnet-observer.mjs` → `data/mainnet-history.json` |
| `SIMULATION` | Creature scenarios, modeled ring depth, engine allocation, shadow-only observations | `lib/theater/scenarios.mjs` + `getEngine()` |
| `REPLAY` | An authentic TUI capture, replayed | `data/tui-captures/` |

## Panels
These panels show real data: quoter metrics (maker fills, flow share, execution vs mid), XRP inventory of the demo accounts, resting BID/ASK offers, filled offers (with tx hashes), network fees, P&L attribution, Pathfinder routing, market depth, TG Sentinel findings (`/api/findings`) and the event tape (SSE).

P&L attribution is the maker edge against the mid recorded at fill time (`attribution.fills[].edgeXrp`). These are demo wallets trading with each other, so the figure checks the mechanics. It is not profit.

These panels show modeled data (`SIMULATION`): the six liquidity rings (engine allocation of $1M modeled capital), strategic observations (**shadow-only**, never executed), corridor capital efficiency, and the scenario inventory and fills.

RLUSD: the Testnet demo has no RLUSD (its books are TOKEN/XRP). The panel says so. RLUSD only appears as the modeled XRP/RLUSD book, or from Mainnet `account_lines` once addresses are configured.

## Scenarios (SIMULATION)
The scenarios are DOLPHIN, SHARK, WHALE and KRAKEN, with size bands taken from `public/creatures.js`. Each one is a seeded, pure replay of hypothetical taker fills against the modeled ring depth (`getEngine().allocate`), with ring sweeps from the innermost ring outward. Each fill makes the rings it touched glow.

KRAKEN is one block-size sweep across 4 rings. Inventory shifts, and then a **capital-optimization step** follows: the engine re-allocates, rings refill, and a rebalance is proposed. That step is a proposal only (`executed:false`).

Fake fills always have `hash: null`. Sound is optional, muted by default, and uses WebAudio blips.

## API (read-only)
- `GET /api/theater/state` returns telemetry plus model metadata (rings, creatures, scenarios, engine label, efficiency, strategic, capture/history status).
- `GET /api/theater/history[?refresh=1]` returns HISTORICAL_MAINNET data. `refresh=1` is localhost only, limited to one request per 60 s, and refused offline. It refreshes automatically in the background when addresses are set and the cache is older than 15 min.
- `GET /api/theater/scenario/:id[?seed=N]` returns a SIMULATION scenario and publishes `theater.scenario`.
- `GET /api/theater/capture[?file=name]` returns the capture replay, or `{status:'none'}`.

Event: `theater.scenario` | SIMULATION | `{scenario, seed, fills, ringsSwept, volumeUsd, hypothetical:true}`.

## Presentation hooks
- `window.TitanTheater.playScenario('kraken')`, `.reset()`, `.present(scene)`, `.ready()`
- `window.dispatchEvent(new CustomEvent('tf:present', {detail:{scene}}))`. Valid scenes are `evidence`, `fills`, `dolphin`, `shark`, `whale` and `kraken`. The event is ignored if `detail.id` is set to another module.
- Full screen: the buttons use `requestFullscreen`. Where that is unavailable, a fixed "focus mode" is used instead; Esc exits it.

## What the Commander must supply
1. **Titan Ghost Mainnet accounts:** `TG_MAINNET_ACCOUNTS=rAddr1,rAddr2`, public classic addresses only. Seeds are rejected and never echoed. Restart afterwards.
   Today the observer allowlist permits `account_info` and `account_lines`, which give real XRP and RLUSD balances. It does **not** permit `account_tx` or `account_offers`. Until the Lead adds those two read-only commands to `READ_COMMANDS` in `lib/mainnet-observer.mjs`, the history panel shows "blocked by observer allowlist" and no fills.
2. **Authentic TUI capture:** put it in `data/tui-captures/` (override with `TF_TUI_CAPTURE_DIR`). Accepted formats:
   - `*.cast`: asciicast v2 (`asciinema rec`). The header line is `{"version":2,"width":W,"height":H}`, followed by one `[seconds,"o","ansi text"]` per line.
   - `*.json`: `{"width":W,"height":H,"frames":[{"t":seconds,"text":"full screen, ANSI ok"}]}`.

   Limits: 8 MB and 20k frames. On load, input events are dropped and seeds or labeled private keys are redacted. Please still sanitize the capture before copying it here.
