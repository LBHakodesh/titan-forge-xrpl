# Titan Forge: 3-minute pitch script (London, Oct 25 2026)

**Bottom line:** the Why Not? track entry is **Titan Ghost**. The story is Titan Ghost plus three capabilities built *into* it this weekend: **lending** (TGLB, supported by the separate TGLW platform), **agentic payments** (TG Merchant, x402) and **XDLC**. The other 12 products appear only as "coming to market".

Press **▶ Present** in the app header (or open `http://127.0.0.1:4131/pitch.html`), then click **▶ Start presentation**.

**Default = presenter mode.** The Commander narrates live. The voice is **off** (press **M** to turn the pre-rendered voice on as a backup). Scenes do **not** auto-advance: each plays its animation, then holds on its final frame ("Press → for next" appears bottom right) until the presenter presses **→** or **Space**. At a held scene end Space advances; mid-scene Space pauses/resumes. **`?auto=1`** restores the old timed run: 3:00 total with voice, auto-advancing. **`?voice=1`** keeps presenter mode but starts with the voice on. The voice and visuals are local, so everything works offline.

Controls: **→** next scene (plays it) · **Space** start / pause, or next scene when held · **←** previous scene · **M** voice on/off · **N** presenter notes · **F** fullscreen · **Esc** back to the app. The progress dots can be clicked. The live slot shows a small countdown at bottom right.

URL options:
- `?talk=60` sets the live slot length (0–600 s; in presenter mode it is the countdown length). The other scenes keep their 140 s, so the timed total is **140 s + talk** (180 s at the default `talk=40`).
- `?siteLive=1` changes the end-card tag from **"Launching at"** to **"Live at"**. Use it only after the Commander has deployed gyw1313.com/titan-ghost. The default never claims the site is live.
- Rehearsal deep link: `/pitch.html?scene=6&autostart=1` (scene numbers start at 1; `&pause=1` freezes the scene, `&at=4` starts 4 s into it, `&auto=1` timed mode, `&mute=1` force voice off).
- Presenter card: edit `PRESENTER.name` and `PRESENTER.dissertation` at the top of `public/pitch.js` (one place; the page serves live, no restart).

Source of truth: `public/pitch.js` (`SCENE_DEFS`, `SHOWCASE`, `FEATURED`). Tests: `test/pitch.test.mjs`. Audio: `node scripts/render-pitch-audio.mjs` uses the self-hosted Kokoro TTS at 127.0.0.1:5131 with voice `af_heart`. It re-renders only lines that changed, fails if a line plus its lead-in would not fit its scene, and writes `public/pitch-audio/scene-NN.wav` and `manifest.json`.

Read-only: the page sends only two GET requests (`/api/theater/state` for the fill count and `/api/vendors` for the vendor status dots), plus requests for local audio and images. No signing, no POSTs, no records written. If a GET fails, that scene plays without its number. Numbers are never made up.

Branding follows the live gyw1313.com brand: near-black `#070a10`, gold `#e9c46a` / `#f3dda7`, cyan `#4cc4f0`, text `#e9eef6` / `#9ca3af`, the GYW + gold 1313 wordmark with the hex mark (top left on every scene, next to the "TITAN GHOST" lockup), and "Built on the XRP Ledger". The open uses `/gyw1313-hero.png`. The end card shows `/site/titan-ghost/preview-1440.png` from the website build in a browser frame, and falls back to the hero image if that screenshot is missing.

## Timeline and narration (verbatim, as spoken)

Times are for timed mode (`?auto=1`); in presenter mode each scene holds at its end. When the voice is on it starts 0.5 s into each scene (2.5 s on the open, so the wordmark lands first; 1 s on the end card).

| Time | Headline | Label on screen | Narration | Audio |
|---|---|---|---|---|
| 0:00–0:13 | Why should any XRPL market lack liquidity? (under the GYW1313 PRESENTS → TITAN GHOST wordmark and hero image) | WHY NOT? TRACK | This is Titan Ghost, from GYW1313. Our answer to the Why Not track: why should any XRP Ledger market go without liquidity? | 9.6 s |
| 0:13–0:25 | Built by a security-first operator. | PRESENTER | *(no audio: credential card — name; Enlisted Infantry → Commissioned Infantry Officer → Branch-transferred to the Signal Corps; CISSP; MS, Cybersecurity · BS, Information Systems Management · PhD candidate, Financial Cybersecurity (expected end of 2027); dissertation line)* | — |
| 0:25–0:40 | Thin markets lose trades. | MAINNET OBSERVED · SAMPLE (133 failed vs 79 succeeded; top 5 providers 97%) | Thin markets lose trades. In our Mainnet sample, more cross-currency payments failed than succeeded, and a handful of providers supplied almost all the liquidity. | 9.6 s |
| 0:40–0:57 | Titan Ghost: six rings of liquidity. | PRE-HACKATHON ENGINE | Titan Ghost is our existing market-making engine. It places liquidity in six rings: tight inner rings for everyday payments, and deep reserves behind them. The XRP Ledger routes payments through it. | 13.0 s |
| 0:57–1:05 | Real payments already fill our offers. | LIVE TESTNET · DEMO ACCOUNTS; live number from GET /api/theater/state | On Testnet, real payments have already filled our offers, bridged through XRP. | 4.9 s |
| 1:05–1:27 | Built into Titan Ghost: lending. | NEW · SIMULATION | This weekend we built three capabilities into Titan Ghost. First, lending. TGLB funds new markets in three tiers, and TGLW, our self-custody liquidity platform, supplies tiers one and two straight from participants' own wallets. | 16.1 s |
| 1:27–1:45 | Built into Titan Ghost: agentic payments. | NEW · LIVE TESTNET x402 RAIL · APPROVAL REQUIRED | Second, agentic payments. Through TG Merchant, AI agents buy Titan Ghost market data over x402 on the XRP Ledger, and every payment needs a person's approval. | 12.5 s |
| 1:45–2:05 | XDLC: a neutral corridor that beats the AMM. | NEW · SIMULATION + PROPOSED; sub "Proposed open XRPL amendment · draft · simulated today" | Third, XDLC: a neutral protocol. Its corridor quotes a better price than the XRP Ledger's AMM at every depth, and anyone can provide liquidity: Titan Ghost, TGLW participants, or other firms. We propose it as an open amendment, a draft not yet submitted. | 19.2 s |
| 2:05–2:45 | More from GYW1313 · coming to market | COMING TO MARKET · PRESENTER SPEAKS | *(no audio: the Commander speaks live, see below)* | — |
| 2:45–3:00 | XDLC: Liquidity for every market. | STATUS PER VENDOR; "Launching at" gyw1313.com/titan-ghost | XDLC: liquidity for every market. Titan Ghost, from GYW1313. Learn more at G Y W thirteen thirteen dot com. | 10.3 s |

Total narration audio: **95.2 s** over 8 clips (voice `af_heart`, speed 1). Every clip fits inside its scene. To fit the presenter scene (12 s) into 180 s: open 15→13 s, problem 18→15 s, engine 19→17 s, live slot 45→40 s. The XDLC line is the tightest: 0.5 s lead-in + 19.2 s audio + 0.3 s pad = exactly 20 s. The voice-only respellings are "G Y W thirteen thirteen", "T G L B", "T G L W", "T G", "X D L C", "X R P" and "x four oh two". The notes drawer shows the narration exactly as written above.

**One Titan Ghost, three modules.** From 1:05 to 2:05 a Titan Ghost core sits on the right (at the top on phones) with three modules: 1 Lending, 2 Agentic payments, 3 XDLC. Each scene lights its module, and earlier modules stay lit, so by 1:40 the audience sees one integrated Titan Ghost.

**TGLW and TGLB are two distinct platforms.** The lending scene draws them as two separate platform cards. TGLW (self-custody liquidity, in participants' own wallets) feeds Tier 1 (flexible) and Tier 2 (term) into TGLB. TGLB adds Tier 3 (underwritten loans) and funds Titan Ghost. TGLW is never drawn inside TGLB.

## Live slot (2:05–2:45): coming to market

The screen shows the 12 other products as cards in four groups of three. One group is highlighted per quarter of the slot (10 s each at the default 40 s). A note below reads "17 products · five featured today" with chips for **Titan Ghost, TGLB, TGLW, TG Merchant, XDLC**. 1313VERSE has no TG prefix and is drawn with a round marker. The countdown reads "Showcase · m:ss left".

Talking points (about 100 words, one line per highlighted group):

1. **Intelligence & protection:** TG Intelligence guides where capital goes, TG Sentinel watches risk, TG Guardian holds the spending limits.
2. **Authority, advice & assets:** TG Authority, the TG Advisory Network, and TG Tokenization for asset setup.
3. **Visualize & play:** TG View shows the market live, TG Arena teaches it as a game, TG Play Analysis reviews the play.
4. **Build & grow:** the TG Developer Platform, TG SEO Intelligence, and 1313VERSE, our community world.

Open with "Titan Ghost is one of 17 GYW1313 products; five are featured today." Close by handing over to the website card. If you run long, Space pauses the slot.

Commander, please confirm: the registry has no source for the TG Authority, TG Play Analysis, TG Developer Platform and TG SEO Intelligence one-liners, so they are kept generic.

## Honesty notes

- Titan Ghost (the engine, six rings) was built before the hackathon. The rings drawing is illustrative. The engine on this node is the labeled temporary demo adapter, not the Rust Quoter.
- The problem stat (133 failed vs 79 succeeded cross-currency payments; the top 5 providers supply 97% of liquidity) comes from our read-only Mainnet observer sample. It is labeled MAINNET OBSERVED · sample and is not Titan Ghost activity.
- The fill count is validated XRPL Testnet activity between our own demo accounts (`organic:false`). It is read live from `/api/theater/state` and is hidden if that request fails.
- Lending (TGLB tiers and TGLW supply) is SIMULATION. No participant funds exist.
- Agentic payments: the x402 rail runs on XRPL Testnet, and every payment needs a person's approval. The pitch never makes a payment. The registry still lists the Tokyo TG Merchant service as not connected to London.
- XDLC is drawn as a neutral protocol: an illustrative corridor ladder quoting at least 1 bp inside the AMM price (fee included) at every depth, open to any provider (Titan Ghost, TGLW participants, other firms), with fill priority by tenure; early exits pay a prorated fee to providers who stay. Today it is simulated in Titan Ghost application logic, not native XRPL. The XDLC amendment is a draft: not submitted, reviewed, implemented in xrpld, or activated.
- End card: "Launching at" by default. "Live at" only with `?siteLive=1`, after the Commander deploys the site himself. The vendor dots show each integration's real status from `GET /api/vendors` (connected, sandbox only, needs credentials, docs only).

---

## Detailed tour (the original tab-by-tab walkthrough)

Still available from the **▶ 3-Minute Pitch** tab (“▶ Start detailed tour”) or `/#present/start`. It is described below and is no longer what ▶ Present opens.


Open `http://127.0.0.1:4131/#present/start`. The app walks through the live staging tabs on a fixed 3:00 timeline with lower-third captions. Read the narration below. Every screen keeps its own mode badges, so the captions never claim more than the screen shows.

Controls: **Space** pause or resume · **→** skip to the next cue · **←** go back (restarts the current cue if you are more than 2 s in) · **Esc** exit · **F** fullscreen · **S** presenter script panel (click a line to jump to it). On-screen buttons do the same. The tab **▶ 3-Minute Pitch** lists the timeline and which tab each cue will show on this node.

Source of truth: `public/modules/01-present.js` (`CUES`). The table and narration below come from it; `test/present.test.mjs` checks the timing.

## Timing table

| Time | Cue | Tab (fallback if not loaded) | Scene (`tf:present`) | Labels on screen | Era |
|---|---|---|---|---|---|
| 00:00–00:30 | Titan Ghost engine v11: the evidence | `theater` (fallback `view`) | `evidence` | HISTORICAL_MAINNET, LIVE_TESTNET | PRE-HACKATHON ENGINE · NEW VIEW |
| 00:30–00:36 | Real fills | `theater` (fallback `view`) | `fills` | LIVE_TESTNET, HISTORICAL_MAINNET | PRE-HACKATHON ENGINE · NEW VIEW |
| 00:36–00:42 | Dolphin | `theater` (fallback `view`) | `dolphin` | SIMULATION | NEW · OCT 24–25 |
| 00:42–00:48 | Shark | `theater` (fallback `view`) | `shark` | SIMULATION | NEW · OCT 24–25 |
| 00:48–00:54 | Whale | `theater` (fallback `view`) | `whale` | SIMULATION | NEW · OCT 24–25 |
| 00:54–01:00 | Kraken | `theater` (fallback `view`) | `kraken` | SIMULATION | NEW · OCT 24–25 |
| 01:00–01:20 | TG Intelligence finds thin liquidity | `xdlc-app` (fallback `observatory`) | `radar` | SIMULATION, MAINNET_OBSERVED | NEW · OCT 24–25 |
| 01:20–01:35 | TGLB three-tier funding | `incubator` (fallback `capital`) | `tglb` | SIMULATION | NEW · OCT 24–25 |
| 01:35–02:10 | XDLC application lifecycle | `xdlc-app` (fallback `corridor`) | `lifecycle` | SIMULATION | NEW · OCT 24–25 |
| 02:10–02:25 | TG Sentinel flags risk | `sentinel` (fallback `findings`) | `sentinel` | LIVE_TESTNET, MAINNET_OBSERVED, SIMULATION | NEW · OCT 24–25 |
| 02:25–02:40 | Watch capital move | `redeploy` (fallback `capital`) | `redeploy` | SIMULATION | NEW · OCT 24–25 |
| 02:40–02:50 | XDLC: proposed open XRPL amendment | `xdlc-protocol` | `protocol` | PROPOSED | NEW · OCT 24–25 |
| 02:50–02:56 | Ecosystem and vendors | `vendors` (fallback `merchant`, `x402`) | `vendors` | SIMULATION | NEW · OCT 24–25 |
| 02:56–03:00 | One GYW1313 ecosystem | `products` | `products` | — | PRE-HACKATHON (TGAN new) |

How it works: for each cue the controller calls `api.show(tab)`, then `window.dispatchEvent(new CustomEvent('tf:present', {detail:{scene}}))`. Modules that support the scene jump to it: theater (evidence, fills, dolphin through kraken), xdlc-app (radar, lifecycle), incubator (tglb), sentinel, redeploy, xdlc-protocol. A cue whose tab is missing shows its fallback. If no fallback is loaded either, the caption carries on and says the screen is "coming online".

Side effects: no signing, and no live-signing endpoint is called. Some scene hooks in other modules write **SIMULATION** records: the incubator walkthrough posts `/api/incubator/bootstrap/plan` and `/demo/run`, TGAN posts `/api/tgan/fee-calculator`, and redeploy posts `/api/xdlc/redeploy/run`. Redeploy stops at the human approval step.

## Narration (≈420 words, about 140 wpm)

**00:00 · Titan Ghost engine v11: the evidence**  
This is Titan Ghost, the market-making engine behind GYW1313. Engine version 11 was built before this hackathon. The terminal is a browser recreation of the engine's own TUI layout, built this weekend. Titan Ghost's own Mainnet record appears read-only, labeled HISTORICAL MAINNET, whenever its public address is loaded. The fills, routing and Sentinel findings beside it are validated XRPL Testnet transactions between our demo accounts, labeled LIVE TESTNET. The live engine is not connected to this staging node.

**00:30 · Real fills**  
These fills are real: every row with a transaction hash is validated on the ledger. Simulated rows never carry one.

**00:36 · Dolphin**  
Now scale it up. The theater, new this weekend, sizes flow on a creature ladder. A Dolphin is a small taker.

**00:42 · Shark**  
A Shark is mid-size flow testing the book.

**00:48 · Whale**  
A Whale is large flow the six liquidity rings have to absorb.

**00:54 · Kraken**  
And a Kraken moves the book. These four are SIMULATION scenarios. Only the fills before them were real.

**01:00 · TG Intelligence finds thin liquidity**  
Where should liquidity go? The TG Intelligence opportunity radar, new this weekend, ranks thin markets from read-only Mainnet observations: wide spreads, shallow depth, and the modeled benefit after costs. The scoring is a labeled demo adapter, so its output is SIMULATION. It reads Mainnet and never trades there.

**01:20 · TGLB three-tier funding**  
Once a project qualifies, TGLB, Titan Ghost Liquidity Bootstrap, coordinates three funding tiers: flexible participation, term-committed liquidity, and a separate underwritten lending vault. The lending studio is new this weekend, and every dollar here is SIMULATION.

**01:35 · XDLC application lifecycle**  
This is the XDLC application, built this weekend. A corridor moves through its lifecycle stage by stage, and every advance is Titan Ghost application logic: an operator SIMULATION record with a human approval, never a signed transaction. XRP auto-bridging is the existing XRPL feature. XDLC itself is not native to XRPL today.

**02:10 · TG Sentinel flags risk**  
TG Sentinel watches the whole loop. It flags concentration, demo-generated fills and corridor risk, and labels each finding with its provenance, so a simulated finding never looks live. The expanded coverage is new this weekend.

**02:25 · Watch capital move**  
When risk rises, capital moves. This redeployment is modeled, SIMULATION: only authorized proprietary capital moves, participant Tier 1 and 2 and Tier 3 loan proceeds stay locked, and it stops at the human approval step.

**02:40 · XDLC: proposed open XRPL amendment**  
Where does this go next? We drafted XDLC as a proposed open XRPL amendment, so any market maker could run corridors natively. It is a draft: not submitted, not reviewed, not implemented in xrpld, and not activated.

**02:50 · Ecosystem and vendors**  
Vendor adapters and TG Merchant connect agentic payments to the ecosystem.

**02:56 · One GYW1313 ecosystem**  
Sixteen established products plus TGAN, one GYW1313 ecosystem. Thank you.

## Pre-hackathon vs new (say it if asked)

- **Pre-hackathon:** Titan Ghost engine v11, the Rust market maker with six liquidity rings. It is *not connected* to this node; ring allocation here is the labeled temporary demo adapter. Also the existing GYW1313 products: the sixteen-product ecosystem (count is the Commander's figure; the enumerated list isn't reconciled, see docs/TG_PRODUCT_REGISTRY.md).
- **New, Oct 24–25 (competition period):** the XDLC application and the draft amendment spec, the TG Intelligence opportunity radar, the TGLB lending studio, expanded TG Sentinel coverage, vendor adapters and TG Merchant flows, the engine theater (a browser recreation of the TUI), redeployment ("Watch Capital Move"), TGAN (product 17), and this presentation and navigation.

## Judge Q&A crib

**What's real?**
- XRPL **Testnet** transactions between our own demo accounts (`LIVE_TESTNET`, `organic:false`): token launches, offers, fills and Pathfinder payments. Every row with a tx hash links to the explorer.
- Read-only **Mainnet observation** (`MAINNET_OBSERVED`): a third-party order-book and pathfinding sample through an allowlisted read-only observer. No wallet, no Mainnet transactions.
- **Titan Ghost's own Mainnet history** (`HISTORICAL_MAINNET`) shows only once the Commander supplies its public address. Until then the theater says "awaiting address" rather than inventing data.
- Sentinel findings carry their own provenance (Testnet, Mainnet-observed or simulated).

**What's simulated?**
- All capital figures: rings, TGLB tiers, lending vault, redeployment, radar scores. All are `SIMULATION`.
- The Dolphin, Shark, Whale and Kraken scenarios are seeded hypothetical fills against modeled ring depth. They never have a tx hash.
- The engine on this node: `TemporaryDemoAdapter`, not the authentic Rust Quoter or Strategic Engine.
- The XDLC lifecycle: each stage advance is an operator SIMULATION record with a human approval.
- Vendor adapters run in SIMULATION unless a screen says otherwise. x402 live purchases need explicit per-payment approval and are not part of the pitch.

**What's proposed?**
- **XDLC** (XRPL Dynamic Liquidity Corridors) is a *proposed open XRPL amendment*. It is a draft: not submitted, not reviewed, not implemented in xrpld, and not activated. It is not native to XRPL today. The corridor lifecycle is Titan Ghost application logic, and XRP auto-bridging is the existing XRPL feature. XDLC is not a TG-branded product.
- The PROPOSED TG acronyms in the registry (TGS, TGI, TGM…) await the Commander's confirmation.

**Is this Mainnet trading?** No. Mainnet is read-only. All signing goes through `Ledger.submit()`, which asserts Testnet (network_id 1).

**Is the demand organic?** No. Every account we control is a demo account, and launch records are `organic:false`.

**Is this gyw1313.com?** No. It is the London staging app styled as the GYW1313 experience, and nothing is published to gyw1313.com.

**What if the network drops?** Run `scripts/demo-offline.sh`. Recorded data replays labeled `REPLAY` and the pitch still runs (see DEMO_RUNBOOK §4).
