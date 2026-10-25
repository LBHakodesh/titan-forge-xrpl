# Titan Forge — Titan Ghost × XDLC

**GYW1313 · XRPL Commons AI & Fintech Hackathon, London (Oct 24–25, 2026) · Why Not? track**

> *XDLC: Liquidity for every market.*

Titan Forge is the hackathon platform around **Titan Ghost**, GYW1313's existing market-making engine on the XRP Ledger. It shows how thin XRPL markets get liquidity, and how three capabilities built this weekend plug into it:

| Capability | What it does | Status in this repo |
|---|---|---|
| **Titan Ghost** (pre-hackathon engine) | Six liquidity rings; XRPL routes payments through its offers, incl. XRP auto-bridging | Engine itself is proprietary and **not** in this repo; a clearly labeled demo adapter + Rust contract stubs stand in (`lib/engine`, `contracts/`) |
| **TGLB — Lending & Borrowing** | Project funding in three tiers; **TGLW** (a distinct self-custody liquidity platform) supplies Tiers 1–2 from participants' own wallets; Tier 3 underwritten loans | SIMULATION (XLS-65/66-style; native vault/lending not enabled on Mainnet) |
| **TG Merchant — Agentic payments** | AI agents buy market data over x402 on XRPL; every payment needs a person's approval | x402 rail on XRPL Testnet |
| **XDLC — XRPL Dynamic Liquidity Corridors** | A **neutral protocol**: a corridor of liquidity that quotes ≥ 1 bp better than the XRPL AMM at every depth, open to any provider; wallet-held commitments, prorated early-exit fee paid to providers who stay, tenure priority, no oracle | Application-level lifecycle + **proposed amendment draft** (`docs/XDLC_*.md`, executable reference model `lib/xdlc-spec/`, 80 test vectors). Draft only — not submitted, reviewed, implemented in xrpld or activated |

Also included: TG Sentinel (risk/observability across the platform), an opportunity radar, a corridor-vs-AMM simulation on the live Mainnet XRP/RLUSD AMM (read-only), vendor adapters (XRPL, t54 x402, Ledger, QuickNode, AWS AgentCore, Mastercard Agent Pay — each with honest status), and a presenter pitch (`public/pitch.html`).

## Honesty rules
Every number carries its mode: `LIVE_TESTNET` (validated XRPL Testnet, demo accounts, `organic:false`), `MAINNET_OBSERVED` (read-only Mainnet), `SIMULATION`, `REPLAY`, `PROPOSED`. No Mainnet signing; Mainnet access is a read-only allowlist (`lib/mainnet-observer.mjs`). See `CONTRACT.md`.

## Run
```bash
npm install
npm test                         # 460+ node:test tests, no network
TF_READONLY=1 PORT=4131 node server.mjs   # read-only: signing disabled
# open http://127.0.0.1:4131/  ·  pitch: /pitch.html  ·  site preview: /site/titan-ghost/index.html
```
Signing on Testnet requires your own Testnet wallets in `data/wallets.json` (not included). `TF_PUBLIC_MIRROR=1` serves a public read-only mirror (all non-GET requests refused).

## Layout
`server.mjs` (no framework) · `lib/routes/NN-*.mjs` API plugins · `public/modules/NN-*.js` UI tabs · `lib/xdlc`, `lib/xdlc-spec`, `lib/xdlc-amm` (XDLC app, amendment model, AMM simulation) · `lib/incubator` (TGLB) · `lib/findings` (Sentinel) · `lib/vendors` · `docs/`.

© 2026 GYW1313. All rights reserved. Source published for hackathon judging.
