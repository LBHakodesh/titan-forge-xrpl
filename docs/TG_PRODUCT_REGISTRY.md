# TG Product Registry: naming and alias matrix (for Commander review)

Status: DRAFT for review, 2026-10-24. Source of truth: `lib/products/catalog.mjs`. Live view: tab **TG Products**; API `GET /api/products`, `/api/products/matrix`, `/api/products/:acronym`.
Standard: **TG = Titan Ghost.** Full name in formal text; acronym in dashboards, APIs and telemetry. No existing route, tab id, file, API identifier, data field or service is renamed. The registry only points at what exists.

## Decisions needed

1. ~~**Sixteen-product list.**~~ **Resolved 2026-10-25 (Commander):** the official 17 = the 15 TG products (TG, TGLW, TGLB, TGAN, TGS, TGG, TGAT, TGI, TGM, TGT, TGV, TGAR, TGPA, TGDP, TGSEO) + XDLC + 1313VERSE. XDLC and 1313VERSE keep their own names (no TG prefix).
1b. **Resolved 2026-10-25 (Commander): TGLW and TGLB are two distinct platforms.** TGLW (Liquidity Wake) supports TGLB (Liquidity Bootstrap) by supplying self-custodial Tier 1/2 liquidity from participants' own wallets. Never describe TGLW as a component or layer of TGLB.
2. ~~**TGAN and the count.**~~ **Resolved 2026-10-24:** TGAN is product 17 (16 established + TGAN).
3. **The 10 PROPOSED acronyms.** Confirm or replace them. (Arena resolved 2026-10-24: **TGAR**, replacing TGA.)
4. ~~**TGLW expansion.**~~ **Resolved 2026-10-24:** the Commander confirmed TGLW = Titan Ghost Liquidity **Wake**. The CONTRACT glossary was updated; code identifiers are unchanged.
5. **Unmapped surfaces.** Map or exclude: Pathfinder, Liquidity Observatory, 26 spokes, and the Strategic, Arbitrage and Meme engines.
6. **Domains with no product.** Define or drop tg-c2.com, tg-browsergateway.com and tg-agencynetwork.com.
7. **Before any purchase.** Verify the domains at GoDaddy or the registrar and start trademark clearance. Nothing has been purchased.

## Sixteen-product reconciliation: NOT RECONCILED

| Searched | Result |
|---|---|
| `/opt/titan-arena/spec/TITAN_ARENA_V0.1_MASTER_BUILD_SPEC.md` | No product list. Line 685 says "~16–17 **venues**", which means trading venues, not products |
| `/opt/gyw1313-docs`, `/opt/gyw-knowledge` | Permission denied; not read |
| `/opt/1313verse` | Staff avatars only (Titan Ghost Analyst, Titan Sentinel) |
| CONTRACT.md glossary (line 61) | 10 names |
| `public/modules` tab titles | 12 tabs; 4 carry product names |

Product names found in sources (12):

| # | Name | TG | Source |
|---|---|---|---|
| 1 | Titan Ghost | TG | CONTRACT.md:61 |
| 2 | TGLW | TGLW | CONTRACT.md:61; spec:89 |
| 3 | TGLB | TGLB | CONTRACT.md:61 |
| 4 | Wake Intelligence / Titan Intelligence (CFIE, DMSIE) | TGI | CONTRACT.md:61; spec:110; lib/findings/collectors.mjs:30 |
| 5 | Guardian / Titan Guardian | TGG | CONTRACT.md:61; docs/HACKATHON_AGENTIC_PAYMENT_SECURITY.md:30 |
| 6 | Sentinel / Titan Sentinel | TGS | CONTRACT.md:61; public/modules/50-sentinel.js:1 |
| 7 | Titan View | TGV | CONTRACT.md:61; public/modules/20-view.js:340 |
| 8 | Titan Arena | TGAR | CONTRACT.md:61; spec:1 |
| 9 | Titan Tokenization | TGT | CONTRACT.md:61; lib/findings/collectors.mjs:20 |
| 10 | Titan Merchant | TGM | lib/x402/service.mjs:29; lib/findings/seeds.mjs:77 |
| 11 | Authority | TGAT | docs/HACKATHON_AGENTIC_PAYMENT_SECURITY.md:30; lib/findings/collectors.mjs:28 |
| 12 | XDLC | (excluded) | CONTRACT.md:61 |

- **Named in sources but not on the TG list:** Strategic engine (spec:90), Arbitrage engine (spec:91), Meme engine, future (spec:146), Pathfinder, Liquidity Observatory, 26 spokes, and the Titan Event Model/Stream (spec:106, 381).
- **On the TG list with no source found:** TGPA Play Analysis, TGDP Developer Platform, TGSEO SEO Intelligence.
- The Commander's TG list has 14 names before TGAN and 15 with it. No products were invented to reach 16. In code, `ecosystemCount()` returns the claimed 16 plus products the Commander explicitly added (TGAN → 17) and never derives it from the registry length; a test enforces this.

## Registry

London status values come from the code on this node: LIVE_TESTNET, SIMULATION, DEMO_ADAPTER, NOT_CONNECTED or NOT_BUILT. An entry whose API namespace has no route file is downgraded to NOT_BUILT automatically.

| Acronym | Full name | Approval | Aliases | Tab | API namespace | London status | Domain |
|---|---|---|---|---|---|---|---|
| TG | Titan Ghost (market maker) | APPROVED | Titan Ghost, Market Maker | capital | /api/engine, /api/capital, /api/book | DEMO_ADAPTER | tg-marketmaker.com ★ |
| TGLW | Titan Ghost Liquidity Wake | APPROVED | Liquidity Wake, TGLW wallet | access | /api/access, /api/capital | SIMULATION | tg-liquiditywake.com ★ |
| TGLB | Titan Ghost Liquidity Bootstrap | APPROVED | Liquidity Bootstrap, TGLB incubation program | capital | /api/capital, /api/incubator (not built) | SIMULATION | tg-liquiditybootstrap.com ★ |
| TGAN | Titan Ghost Advisory Network | APPROVED (product 17) | Titan Advisory Network, Advisory Network | not built | /api/tgan (lib/routes/34-tgan.mjs) | SIMULATION (HYPOTHETICAL fees) | tg-advisorynetwork.com ★ |
| TGS | Titan Ghost Sentinel | PROPOSED | Titan Sentinel, Sentinel, Sentinel Findings | sentinel | /api/sentinel, /api/findings | LIVE_TESTNET (read-only) | tg-sentinel.com ★ |
| TGG | Titan Ghost Guardian | PROPOSED | Guardian, Titan Guardian | not built (demo inside Sentinel) | not built (lib/guardian.mjs) | SIMULATION | tg-guardian.com |
| TGAT | Titan Ghost Authority | PROPOSED | Authority, Titan Authority | not built | not built | NOT_CONNECTED (C2) | tg-authority.com |
| TGI | Titan Ghost Intelligence | PROPOSED | Titan Intelligence, Wake Intelligence; components CFIE, DMSIE | engine | /api/engine | DEMO_ADAPTER | tg-intelligence.com |
| TGM | Titan Ghost Merchant | PROPOSED | Titan Merchant, Merchant | x402 | /api/x402 | SIMULATION (Tokyo service not connected) | tg-merchant.com ★ |
| TGT | Titan Ghost Tokenization | PROPOSED | Titan Tokenization, Tokenization | launch | /api/launch, /api/launches | LIVE_TESTNET | tg-tokenization.com |
| TGV | Titan Ghost View | PROPOSED | Titan View, View | view | /api/book, /api/launches, /api/status | LIVE_TESTNET | tg-view.com |
| TGAR | Titan Ghost Arena | APPROVED | Titan Arena, Arena | arena | /api/arena | SIMULATION | tg-arena.com |
| TGPA | Titan Ghost Play Analysis | PROPOSED | Play Analysis | not built | not built | NOT_BUILT | tg-playanalysis.com |
| TGDP | Titan Ghost Developer Platform | PROPOSED | Developer Platform | not built | not built | NOT_BUILT | tg-developerplatform.com |
| TGSEO | Titan Ghost SEO Intelligence | PROPOSED | SEO Intelligence | not built | not built | NOT_BUILT | tg-seointelligence.com |
| none | GYW1313 (parent and platform) | EXCLUDED | GYW | not built | not built | NOT_CONNECTED | gyw1313.com (platform) |
| none | XDLC, XRPL Dynamic Liquidity Corridors (proposed open protocol framework) | EXCLUDED | Dynamic Liquidity Corridors | corridor | /api/corridor | SIMULATION | none |
| none | 1313VERSE | EXCLUDED | Command Chamber | not built | not built | NOT_CONNECTED | none |
| none | Brooklyn Bullies | EXCLUDED | BBL | not built | not built | LIVE_TESTNET (demo token BBL, checked at runtime) | none |
| none | KINSMER | EXCLUDED | none | not built | not built | NOT_CONNECTED | none |
| none | BDIU | EXCLUDED | none | not built | not built | NOT_CONNECTED | none |

★ = one of the six domains the Commander's assistant prioritized. The capabilities, commercial model, dependencies and status basis for each entry are available from `GET /api/products/:acronym`. Capabilities are concrete endpoints scanned from `lib/routes`. Live-signing endpoints (`POST /api/launch`, `/api/pathfinder/run`, `/api/x402/live/purchase`) are flagged "never call from automated agents".

**Commercial model, as described in the app.** These are demo settings, not approved offers:

- **TGLW:** free core for every participant up to one configurable `FREE_LIQUIDITY_THRESHOLD_USD` (demo default $50,000, not approved). Subscriptions and capacity plans apply above the threshold.
- **Essential functions and security warnings:** never gated.
- **x402:** optional pay-per-request data (TGM; TGI's "wake" resource is demo-adapter output).
- **TGAN:** advisory compensation is HYPOTHETICAL and requires an appropriate regulatory structure.

## Alias rules

- Lookup is case-insensitive and punctuation-insensitive. Acronyms, names, formal names and aliases all resolve, so `titan sentinel` → TGS.
- An alias claimed by two products is dropped instead of resolved arbitrarily. The test suite enforces this.
- **Deliberately unresolvable aliases:**
  - "Wake": used by both TGLW and TGI. Returns 409 with both candidates.
  - "Ghost": collides with the family prefix.
  - "Titan Ghost Analyst": a 1313VERSE staff avatar, not a product.

## Collision and ambiguity review notes

- **Resolved: TGAR for Arena** (replaces TGA, which was a strict prefix of TGAN/TGAT and clashed with 1313VERSE's `tga` alias). TGAR, TGAN and TGAT share a stem, so match acronyms exactly and never filter on `TGA*`. "TGA" does not resolve to any product.
- **Medium: TGS / TGSEO.** TGS is a prefix of TGSEO and can read as "TG Services/Security". Match acronyms exactly; never prefix-match.
- **Medium: TGT.** TGT is a common exchange ticker (Target Corp.) and can read as "Titan Ghost Token".
- **Resolved: TGLW = Liquidity Wake** (Decision 4). Still note: "Wake" overlaps with Wake Intelligence (TGI), so the bare alias "Wake" stays unresolvable.
- **Low: TG** is both the family prefix and the market maker's own acronym.
- **Low:** TGSEO is the only 5-letter code.
- **Low:** Authority is also a COMMAND/C2 node role (spec §C).
- **Low:** "Agency Network" (domain only) is easy to confuse with "Advisory Network".

## Candidate domains

Every domain marked available has the same status: reported available (Namecheap snapshot via operator's assistant, 2026-10-24; not verified at GoDaddy; NOT purchased). **Trademark clearance is pending.** Titan Forge made no registrar calls.

**Reported available:**

- **Priority (6):** tg-marketmaker.com, tg-liquiditywake.com, tg-liquiditybootstrap.com, tg-advisorynetwork.com, tg-sentinel.com, tg-merchant.com
- **Other product domains (9):** tg-guardian.com, tg-authority.com, tg-intelligence.com, tg-tokenization.com, tg-view.com, tg-arena.com, tg-playanalysis.com, tg-developerplatform.com, tg-seointelligence.com
- **No product defined (3):** tg-c2.com, tg-browsergateway.com, tg-agencynetwork.com

**Reported unavailable:** tg-seo.com, tg-advisory.com.

**gyw1313.com** remains the integrated platform domain.
