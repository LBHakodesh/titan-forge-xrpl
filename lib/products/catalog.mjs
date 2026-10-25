// Titan Ghost (TG) product registry: canonical data for Commander review.
// "TG" = Titan Ghost. Full names are used formally; acronyms in dashboards, APIs and telemetry.
// Nothing here renames an existing route, tab, file, API identifier, data field or service: the registry
// only POINTS AT what already exists (tab ids, /api namespaces) and says "not built" otherwise.
// Operational status is derived from the code on the London node (see `basis`), and index.mjs downgrades
// any entry whose API namespace has no route file to NOT_BUILT.

export const APPROVAL = Object.freeze(['APPROVED', 'PROPOSED', 'EXCLUDED']);
export const OPS = Object.freeze(['LIVE_TESTNET', 'SIMULATION', 'DEMO_ADAPTER', 'NOT_CONNECTED', 'NOT_BUILT']);

// The Commander's stated size of the established ecosystem. It is a CLAIM, not a reconciled list:
// no enumerated sixteen-product list was found in any readable source (see RECONCILIATION).
export const ESTABLISHED_CLAIM = Object.freeze({
  count: 16,
  // New products the Commander has explicitly added on top of the established count (decision 2026-10-24: TGAN = product 17).
  commanderAdded: Object.freeze(['TGAN']),
  source: "Commander's directive (\"existing sixteen-product GYW1313 ecosystem\", \"existing 16-product service marketplace\")",
  enumeratedListFound: false,
});

const FREE_CORE = 'TGLW is free for every participant up to one configurable FREE_LIQUIDITY_THRESHOLD_USD (demo default $50,000, NOT an approved threshold); paid service/capacity plans apply above it (demo prices, not live offers); essential functions are never gated; x402 is optional pay-per-request data, never a participation cost. [as described in lib/entitlement/policy.mjs:1-8,34 and lib/entitlement/index.mjs:4-5]';

// approval: APPROVED | PROPOSED | EXCLUDED. Excluded brands carry acronym:null (never a TG acronym).
// ops.status is the status ON THE LONDON NODE; ops.basis says which code it was derived from.
// namespaces: /api/<ns> prefixes this product uses (verified against lib/routes at runtime; missing => "not built").
// tab: existing Titan Forge tab id (verified against public/modules at runtime; missing => "not built").
export const ENTRIES = [
  // ---------------- APPROVED ----------------
  {
    acronym: 'TG', name: 'Titan Ghost', formalName: 'Titan Ghost (market maker)', approval: 'APPROVED',
    category: 'market-making', aliases: ['Titan Ghost', 'Titan Ghost market maker', 'Market Maker'],
    tab: 'capital', namespaces: ['/api/engine', '/api/capital', '/api/book'],
    commercial: 'No pricing defined in this app. Tier 2 (TGLW term-committed) delegates quoting to Titan Ghost within Guardian limits [lib/capital.mjs:23].',
    dependencies: ['TGG (Guardian limits)', 'Engine seam lib/engine (authentic Rust Quoter / Strategic Engine not connected)', 'XRPL Testnet (lib/ledger.mjs)'],
    ops: { status: 'DEMO_ADAPTER', basis: 'getEngine().info().authentic === false: ring allocation and quoting come from the TemporaryDemoAdapter (lib/engine/index.mjs; CONTRACT rule 5). Maker offers placed during token launches are real Testnet offers (LIVE_TESTNET, demo accounts, organic:false).' },
    sources: ['CONTRACT.md:61', '/opt/titan-arena/spec/TITAN_ARENA_V0.1_MASTER_BUILD_SPEC.md:79'],
    domain: 'tg-marketmaker.com',
  },
  {
    acronym: 'TGLW', name: 'Titan Ghost Liquidity Wake', formalName: 'Titan Ghost Liquidity Wake', approval: 'APPROVED',
    category: 'liquidity', aliases: ['Liquidity Wake', 'Titan Liquidity Wake', 'TGLW wallet'],
    tab: 'access', namespaces: ['/api/access', '/api/capital'],
    commercial: FREE_CORE,
    dependencies: ['TG (delegated quoting, Tier 2)', 'TGG (Guardian limits)', 'Access & Free Threshold (lib/entitlement)', 'TGLW x402 on another node (not connected) [lib/x402/service.mjs:30]'],
    ops: { status: 'SIMULATION', basis: 'TGLW itself is not deployed on London [lib/findings/collectors.mjs:29]. Its tiers (T1/T2) and the free-threshold policy are modeled: capital injection is SIMULATION; access decisions use demo settings (live demo participants are read-only).' },
    sources: ['CONTRACT.md:61', '/opt/titan-arena/spec/TITAN_ARENA_V0.1_MASTER_BUILD_SPEC.md:89', 'public/domain.js:37-38'],
    domain: 'tg-liquiditywake.com',
  },
  {
    acronym: 'TGLB', name: 'Titan Ghost Liquidity Bootstrap', formalName: 'Titan Ghost Liquidity Bootstrap', approval: 'APPROVED',
    category: 'liquidity-bootstrap-lending', aliases: ['Liquidity Bootstrap', 'Titan Liquidity Bootstrap', 'TGLB incubation program'],
    tab: 'capital', namespaces: ['/api/capital', '/api/incubator'],
    commercial: 'No pricing defined in this app. Tier 3 is a separate underwritten credit / lending-vault pathway [lib/capital.mjs:24].',
    dependencies: ['TGLW (Tier 1/2)', 'TG (execution)', 'TGG (Guardian approval)', 'TGAN (advisor oversight, proposed integration)', 'Project incubation (/api/incubator, being added by another agent)'],
    ops: { status: 'SIMULATION', basis: 'Tier coordination (T1/T2/T3) is modeled in capital SIMULATION [lib/capital.mjs:22-24]; no lending vault exists on London [lib/findings/seeds.mjs:65, collectors.mjs:29].' },
    sources: ['CONTRACT.md:61', 'public/domain.js:39'],
    domain: 'tg-liquiditybootstrap.com',
  },
  {
    acronym: 'TGAN', name: 'Titan Ghost Advisory Network', formalName: 'Titan Ghost Advisory Network', approval: 'APPROVED',
    category: 'advisory', aliases: ['Titan Advisory Network', 'Advisory Network'],
    tab: 'tgan', namespaces: ['/api/tgan'],
    commercial: 'HYPOTHETICAL: advisory compensation (e.g. a share of eligible portfolio profits) would require an appropriate regulatory structure; nothing is offered, billed or collected.',
    dependencies: ['TGLB (incubation workflow)', 'TGI (Titan Intelligence)', 'TG (Titan Ghost)', 'TGS (Titan Sentinel)', 'Project incubation (/api/incubator)'],
    ops: { status: 'SIMULATION', basis: 'New product served by /api/tgan (another agent\'s module, lib/routes/34-tgan.mjs): HYPOTHETICAL advisors, approvals and fees; SIMULATION records only; nothing billed or collected. Shown as NOT_BUILT whenever no lib/routes file serves /api/tgan.' },
    newProduct: true,
    sources: ["Commander's directive 2026-10-24 (new; not part of the claimed sixteen)", 'Commander decision 2026-10-24: TGAN is product 17'],
    domain: 'tg-advisorynetwork.com',
  },
  // ---------------- PROPOSED (provisional until confirmed) ----------------
  {
    acronym: 'TGS', name: 'Titan Ghost Sentinel', formalName: 'Titan Ghost Sentinel', approval: 'PROPOSED',
    category: 'security-risk', aliases: ['Titan Sentinel', 'Sentinel', 'Sentinel Findings'],
    tab: 'sentinel', namespaces: ['/api/sentinel', '/api/findings'],
    commercial: 'Security warnings are essential functions and are never gated [lib/entitlement/index.mjs:4]. No pricing defined.',
    dependencies: ['XRPL Testnet (read-only validated ledger)', 'TGG (Guardian demo)', 'Mainnet observer (read-only, MAINNET_OBSERVED)'],
    ops: { status: 'LIVE_TESTNET', basis: 'Read-only inspection of launched tokens on the validated XRPL Testnet ledger (lib/sentinel.mjs, public/modules/50-sentinel.js); findings registry with provenance labels. Never signs.' },
    sources: ['CONTRACT.md:61', 'public/modules/50-sentinel.js:1', '/opt/1313verse/src/core/avatars/staff.ts:137'],
    domain: 'tg-sentinel.com',
  },
  {
    acronym: 'TGG', name: 'Titan Ghost Guardian', formalName: 'Titan Ghost Guardian', approval: 'PROPOSED',
    category: 'authorization', aliases: ['Guardian', 'Titan Guardian'],
    tab: null, namespaces: [],
    commercial: 'Not a priced product in this app.',
    dependencies: ['Used by Sentinel, Capital, Corridor, Arena, Access, Pathfinder and x402 policy (lib/guardian.mjs guardCheck)'],
    ops: { status: 'SIMULATION', basis: 'Stateless guardCheck() in lib/guardian.mjs evaluates proposed actions; shown via the Sentinel tab Guardian demo (SIMULATION). No decision log and no /api namespace of its own [lib/findings/collectors.mjs:28].' },
    sources: ['CONTRACT.md:61', 'docs/HACKATHON_AGENTIC_PAYMENT_SECURITY.md:30'],
    domain: 'tg-guardian.com',
  },
  {
    acronym: 'TGAT', name: 'Titan Ghost Authority', formalName: 'Titan Ghost Authority', approval: 'PROPOSED',
    category: 'authorization', aliases: ['Authority', 'Titan Authority'],
    tab: null, namespaces: [],
    commercial: 'Not a priced product in this app.',
    dependencies: ['COMMAND/C2 node (authority / intelligence domain)', 'TGM (x402 exact-scope approval)', 'TGG'],
    ops: { status: 'NOT_CONNECTED', basis: 'Authority belongs to COMMAND/C2 [spec:87]; independent approval records are not implemented on London [lib/findings/collectors.mjs:28]; the C2 x402 entitlement authority is not connected [lib/x402/service.mjs:31].' },
    sources: ['docs/HACKATHON_AGENTIC_PAYMENT_SECURITY.md:30,33', 'lib/findings/collectors.mjs:28', '/opt/titan-arena/spec/TITAN_ARENA_V0.1_MASTER_BUILD_SPEC.md:87'],
    domain: 'tg-authority.com',
  },
  {
    acronym: 'TGI', name: 'Titan Ghost Intelligence', formalName: 'Titan Ghost Intelligence', approval: 'PROPOSED',
    category: 'intelligence', aliases: ['Titan Intelligence', 'Wake Intelligence', 'Intelligence'],
    components: ['CFIE', 'DMSIE'],
    tab: 'engine', namespaces: ['/api/engine'],
    commercial: 'Optional x402 data: the x402 "wake" resource serves demo-adapter output, not the Wake engine [lib/findings/collectors.mjs:30].',
    dependencies: ['COMMAND/C2 (CFIE, DMSIE)', 'Engine seam lib/engine', 'TG'],
    ops: { status: 'DEMO_ADAPTER', basis: 'Recommendations come from getEngine().recommend() = TemporaryDemoAdapter; Titan Intelligence / Wake / CFIE / DMSIE are not connected to London [lib/findings/collectors.mjs:30]. Advisory only [spec:150].' },
    sources: ['CONTRACT.md:61', '/opt/titan-arena/spec/TITAN_ARENA_V0.1_MASTER_BUILD_SPEC.md:110', 'lib/findings/collectors.mjs:30'],
    domain: 'tg-intelligence.com',
  },
  {
    acronym: 'TGM', name: 'Titan Ghost Merchant', formalName: 'Titan Ghost Merchant', approval: 'PROPOSED',
    category: 'payments-agentic-finance', aliases: ['Titan Merchant', 'Merchant', 'Titan Merchant x402'],
    tab: 'x402', namespaces: ['/api/x402'],
    commercial: 'Optional x402 pay-per-request data (SIMULATION by default). A live Testnet purchase needs the Commander\'s explicit per-payment approval [CONTRACT.md, x402 frozen as built].',
    dependencies: ['x402 v2 (XRPL exact scheme)', 'TGAT (exact-scope approval, not implemented)', 'COMMAND/C2 entitlement authority (not connected)', 'Access & Free Threshold'],
    ops: { status: 'SIMULATION', basis: 'London shows/simulates x402 (lib/x402/service.mjs:81); the Titan Merchant x402 service runs on another node (Tokyo) and is not connected [lib/x402/service.mjs:29].' },
    sources: ['lib/x402/service.mjs:29', 'lib/findings/collectors.mjs:16', 'lib/findings/seeds.mjs:77'],
    domain: 'tg-merchant.com',
  },
  {
    acronym: 'TGT', name: 'Titan Ghost Tokenization', formalName: 'Titan Ghost Tokenization', approval: 'PROPOSED',
    category: 'tokenization', aliases: ['Titan Tokenization', 'Tokenization'],
    tab: 'launch', namespaces: ['/api/launch', '/api/launches'],
    commercial: 'No pricing defined in this app (Testnet demonstration).',
    dependencies: ['XRPL Testnet (Ledger.submit, network_id 1)', 'TGS (post-launch inspection)', 'TG (maker offers)'],
    ops: { status: 'LIVE_TESTNET', basis: 'POST /api/launch issues real XRPL Testnet tokens through Ledger.submit() (lib/ledger.mjs); demo accounts, organic:false. Disabled on TF_READONLY instances.' },
    sources: ['CONTRACT.md:61', 'lib/findings/collectors.mjs:20'],
    domain: 'tg-tokenization.com',
  },
  {
    acronym: 'TGV', name: 'Titan Ghost View', formalName: 'Titan Ghost View', approval: 'PROPOSED',
    category: 'visualization', aliases: ['Titan View', 'View'],
    tab: 'view', namespaces: ['/api/book', '/api/launches', '/api/status'],
    commercial: 'No pricing defined in this app.',
    dependencies: ['XRPL Testnet order books (/api/book)', 'Event bus (/api/events)'],
    ops: { status: 'LIVE_TESTNET', basis: 'Client-side visualizer of live Testnet order books and launches (public/modules/20-view.js); emits no telemetry [lib/findings/collectors.mjs:31].' },
    sources: ['CONTRACT.md:61', 'public/modules/20-view.js:340'],
    domain: 'tg-view.com',
  },
  {
    acronym: 'TGAR', name: 'Titan Ghost Arena', formalName: 'Titan Ghost Arena', approval: 'APPROVED',
    category: 'education-game', aliases: ['Titan Arena', 'Arena'],
    tab: 'arena', namespaces: ['/api/arena'],
    commercial: 'No pricing defined in this app.',
    dependencies: ['TGV', 'Titan event model (spec §J)', 'Replay data'],
    ops: { status: 'SIMULATION', basis: 'Educational game; arena.step / arena.completed are SIMULATION events (lib/arena.mjs). The full Titan Arena build is specified separately (/opt/titan-arena spec).' },
    sources: ['CONTRACT.md:61', '/opt/titan-arena/spec/TITAN_ARENA_V0.1_MASTER_BUILD_SPEC.md:1', 'public/modules/60-arena.js:67', 'Commander decision 2026-10-24: TGAR (replaces proposed TGA)'],
    domain: 'tg-arena.com',
  },
  {
    acronym: 'TGPA', name: 'Titan Ghost Play Analysis', formalName: 'Titan Ghost Play Analysis', approval: 'PROPOSED',
    category: 'analytics', aliases: ['Play Analysis'],
    tab: null, namespaces: [],
    commercial: 'Not defined.',
    dependencies: ['TGAR (presumed; not specified in any readable source)'],
    ops: { status: 'NOT_BUILT', basis: 'No code, tab or route on London; name not found in any readable source.' },
    sources: ["Commander's directive 2026-10-24 only"],
    domain: 'tg-playanalysis.com',
  },
  {
    acronym: 'TGDP', name: 'Titan Ghost Developer Platform', formalName: 'Titan Ghost Developer Platform', approval: 'PROPOSED',
    category: 'developer', aliases: ['Developer Platform'],
    tab: null, namespaces: [],
    commercial: 'Not defined.',
    dependencies: ['Related existing surfaces (not the product): /api/engine/schemas contracts, docs/SPOKES_API.md'],
    ops: { status: 'NOT_BUILT', basis: 'No developer-platform code on London; name not found in any readable source.' },
    sources: ["Commander's directive 2026-10-24 only"],
    domain: 'tg-developerplatform.com',
  },
  {
    acronym: 'TGSEO', name: 'Titan Ghost SEO Intelligence', formalName: 'Titan Ghost SEO Intelligence', approval: 'PROPOSED',
    category: 'marketing-analytics', aliases: ['SEO Intelligence'],
    tab: null, namespaces: [],
    commercial: 'Not defined.',
    dependencies: [],
    ops: { status: 'NOT_BUILT', basis: 'No code on London; name not found in any readable source.' },
    sources: ["Commander's directive 2026-10-24 only"],
    domain: 'tg-seointelligence.com',
  },
  // ---------------- EXCLUDED from TG branding (own identities) ----------------
  {
    acronym: null, name: 'GYW1313', formalName: 'GYW1313 (parent company and integrated platform)', approval: 'EXCLUDED',
    category: 'parent-platform', aliases: ['GYW', 'GYW 1313'],
    tab: null, namespaces: [],
    commercial: 'Integrated platform; product pricing is per product.',
    dependencies: [],
    ops: { status: 'NOT_CONNECTED', basis: 'Titan Forge publishes nothing to gyw1313.com (CONTRACT rule 1; operator rule).' },
    sources: ['CONTRACT.md:9'], domain: 'gyw1313.com', platformDomain: true,
  },
  {
    acronym: null, name: 'XDLC', formalName: 'XRPL Dynamic Liquidity Corridors (XDLC), a proposed open protocol framework', approval: 'EXCLUDED',
    category: 'protocol-framework', aliases: ['XRPL Dynamic Liquidity Corridors', 'Dynamic Liquidity Corridors'],
    tab: 'corridor', namespaces: ['/api/corridor'],
    commercial: 'Proposed open protocol framework; not a priced product.',
    dependencies: ['TG (application-level corridor lifecycle)', 'XRPL auto-bridging (existing XRPL feature)'],
    ops: { status: 'SIMULATION', basis: 'Corridor lifecycle is Titan Ghost application logic, not XRPL-native (CONTRACT rule 6); rings are always modeled. Demand readings may be LIVE_TESTNET.' },
    sources: ['CONTRACT.md:61', 'CONTRACT.md:15'], domain: null,
  },
  {
    acronym: null, name: '1313VERSE', formalName: '1313VERSE Adaptive Command Chamber', approval: 'EXCLUDED',
    category: 'platform-app', aliases: ['1313 VERSE', 'Command Chamber'],
    tab: null, namespaces: [],
    commercial: 'Not applicable.', dependencies: [],
    ops: { status: 'NOT_CONNECTED', basis: 'Separate application (/opt/1313verse, systemd verse-chamber, 127.0.0.1:3131); no integration with Titan Forge.' },
    sources: ['/opt/1313verse/README.md'], domain: null,
  },
  {
    acronym: null, name: 'Brooklyn Bullies', formalName: 'Brooklyn Bullies', approval: 'EXCLUDED',
    category: 'brand-project', aliases: ['BBL'],
    tab: null, namespaces: [],
    commercial: 'Not applicable.', dependencies: ['TGT (launched through Titan Forge)'],
    ops: { status: 'NOT_CONNECTED', basis: 'Brand. Its Testnet demo token BBL is checked at runtime against the launch store (LIVE_TESTNET when live, demo, organic:false).' },
    liveTokenCode: 'BBL',
    sources: ['public/modules/10-launch.js:9', 'CONTRACT.md:28'], domain: null,
  },
  {
    acronym: null, name: 'KINSMER', formalName: 'KINSMER', approval: 'EXCLUDED',
    category: 'brand', aliases: [], tab: null, namespaces: [],
    commercial: 'Not applicable.', dependencies: [],
    ops: { status: 'NOT_CONNECTED', basis: 'Established brand per Commander; no reference in Titan Forge or readable sources.' },
    sources: ["Commander's directive 2026-10-24 only"], domain: null,
  },
  {
    acronym: null, name: 'BDIU', formalName: 'BDIU', approval: 'EXCLUDED',
    category: 'brand', aliases: [], tab: null, namespaces: [],
    commercial: 'Not applicable.', dependencies: [],
    ops: { status: 'NOT_CONNECTED', basis: 'Established brand per Commander; no reference in Titan Forge or readable sources.' },
    sources: ["Commander's directive 2026-10-24 only"], domain: null,
  },
];

// Aliases deliberately NOT resolvable because they point at more than one product.
export const AMBIGUOUS_ALIASES = [
  { alias: 'Wake', candidates: ['TGLW', 'TGI'], why: '"Liquidity Wake" (TGLW) and "Wake Intelligence" (TGI) both use it.' },
  { alias: 'Ghost', candidates: ['TG'], why: 'Bare "Ghost" also names the family prefix (TG = Titan Ghost); resolve via "Titan Ghost" or "TG".' },
  { alias: 'Titan Ghost Analyst', candidates: [], why: '1313VERSE staff avatar (alias "tga") [/opt/1313verse/src/core/avatars/staff.ts:115-118], not a product.' },
];

// ---------------- Candidate domains ----------------
export const SNAPSHOT_LABEL = 'reported available (Namecheap snapshot via operator\'s assistant, 2026-10-24; not verified at GoDaddy; NOT purchased)';
export const UNAVAILABLE_LABEL = 'reported unavailable (Namecheap snapshot via operator\'s assistant, 2026-10-24)';
export const TRADEMARK_NOTE = 'Trademark clearance pending for every TG name and domain. No domain has been purchased, reserved or re-checked by Titan Forge.';
const PRIORITY = new Set(['tg-marketmaker.com', 'tg-liquiditywake.com', 'tg-liquiditybootstrap.com', 'tg-advisorynetwork.com', 'tg-sentinel.com', 'tg-merchant.com']);
const avail = (domain, acronym, note) => ({ domain, acronym, availability: 'REPORTED_AVAILABLE', label: SNAPSHOT_LABEL, priority: PRIORITY.has(domain), purchased: false, verifiedGoDaddy: false, trademark: 'clearance pending', ...(note ? { note } : {}) });
export const DOMAINS = [
  avail('tg-marketmaker.com', 'TG'), avail('tg-liquiditywake.com', 'TGLW'), avail('tg-liquiditybootstrap.com', 'TGLB'),
  avail('tg-advisorynetwork.com', 'TGAN'), avail('tg-sentinel.com', 'TGS'), avail('tg-guardian.com', 'TGG'),
  avail('tg-authority.com', 'TGAT'), avail('tg-intelligence.com', 'TGI'), avail('tg-merchant.com', 'TGM'),
  avail('tg-tokenization.com', 'TGT'), avail('tg-view.com', 'TGV'), avail('tg-arena.com', 'TGAR'),
  avail('tg-playanalysis.com', 'TGPA'), avail('tg-developerplatform.com', 'TGDP'), avail('tg-seointelligence.com', 'TGSEO'),
  avail('tg-c2.com', null, 'No registry product: C2/COMMAND is a node role in the spec (§C), not a product.'),
  avail('tg-browsergateway.com', null, 'No registry product: "Browser Gateway" is not defined in any readable source.'),
  avail('tg-agencynetwork.com', null, 'No registry product: "Agency Network" is not defined; easily confused with Advisory Network (TGAN).'),
  { domain: 'tg-seo.com', acronym: 'TGSEO', availability: 'REPORTED_UNAVAILABLE', label: UNAVAILABLE_LABEL, priority: false, purchased: false, verifiedGoDaddy: false, trademark: 'n/a' },
  { domain: 'tg-advisory.com', acronym: 'TGAN', availability: 'REPORTED_UNAVAILABLE', label: UNAVAILABLE_LABEL, priority: false, purchased: false, verifiedGoDaddy: false, trademark: 'n/a' },
  { domain: 'gyw1313.com', acronym: null, availability: 'PLATFORM_DOMAIN', label: 'Integrated GYW1313 platform domain (unchanged). Titan Forge publishes nothing to it.', priority: false, purchased: false, verifiedGoDaddy: false, trademark: 'n/a', platform: true },
];

// ---------------- Sixteen-product reconciliation ----------------
// What was searched, and every product-like name found with its source. NO list of sixteen was found.
export const RECONCILIATION = {
  verdict: 'NOT_RECONCILED',
  summary: 'No enumerated sixteen-product list exists in any readable source. 12 product names were found in sources (below); the Commander\'s TG list has 14 names before TGAN. The two most likely homes of the canonical list, /opt/gyw1313-docs and /opt/gyw-knowledge, are root-only (permission denied) and were not read. The count stays at the Commander\'s stated 16 (unverified); TGAN is listed as approved but is NOT added to that count.',
  searched: [
    { path: '/opt/titan-arena/spec/TITAN_ARENA_V0.1_MASTER_BUILD_SPEC.md', result: 'read; no product list. Line 685 mentions "~16-17 venues" (trading venues, not products).' },
    { path: '/opt/gyw1313-docs', result: 'permission denied (root-only); not read' },
    { path: '/opt/gyw-knowledge', result: 'permission denied (root-only); not read' },
    { path: '/opt/1313verse', result: 'read (src, README, deploy); staff avatars only (Titan Ghost Analyst, Titan Sentinel); no product list' },
    { path: 'CONTRACT.md product glossary (line 61)', result: '10 names: Titan Ghost, TGLW, TGLB, Wake Intelligence (CFIE/DMSIE), Guardian, Sentinel, Titan View, Titan Arena, Titan Tokenization, XDLC' },
    { path: 'public/modules/*.js tab titles', result: '12 tabs; product-named: Titan View, Sentinel, Sentinel Findings, Titan Arena; others are features (Launch, Observatory, Capital, Pathfinder, x402, Access, Corridor, Engine Contracts)' },
  ],
  found: [
    { name: 'Titan Ghost', acronym: 'TG', source: 'CONTRACT.md:61' },
    { name: 'TGLW', acronym: 'TGLW', source: 'CONTRACT.md:61; spec:89' },
    { name: 'TGLB', acronym: 'TGLB', source: 'CONTRACT.md:61' },
    { name: 'Wake Intelligence / Titan Intelligence (CFIE, DMSIE)', acronym: 'TGI', source: 'CONTRACT.md:61; spec:110; lib/findings/collectors.mjs:30' },
    { name: 'Guardian / Titan Guardian', acronym: 'TGG', source: 'CONTRACT.md:61; docs/HACKATHON_AGENTIC_PAYMENT_SECURITY.md:30' },
    { name: 'Sentinel / Titan Sentinel', acronym: 'TGS', source: 'CONTRACT.md:61; public/modules/50-sentinel.js:1' },
    { name: 'Titan View', acronym: 'TGV', source: 'CONTRACT.md:61; public/modules/20-view.js:340' },
    { name: 'Titan Arena', acronym: 'TGAR', source: 'CONTRACT.md:61; spec:1' },
    { name: 'Titan Tokenization', acronym: 'TGT', source: 'CONTRACT.md:61; lib/findings/collectors.mjs:20' },
    { name: 'Titan Merchant', acronym: 'TGM', source: 'lib/x402/service.mjs:29; lib/findings/seeds.mjs:77' },
    { name: 'Authority', acronym: 'TGAT', source: 'docs/HACKATHON_AGENTIC_PAYMENT_SECURITY.md:30; lib/findings/collectors.mjs:28' },
    { name: 'XDLC', acronym: null, source: 'CONTRACT.md:61 (EXCLUDED from TG branding)' },
  ],
  // Named in sources but NOT on the Commander's TG list. Engines/features, not asserted as products.
  unmapped: [
    { name: 'Strategic engine', source: 'spec:90,146' },
    { name: 'Arbitrage engine', source: 'spec:91,146' },
    { name: 'Meme engine (future)', source: 'spec:146' },
    { name: 'Pathfinder', source: 'lib/findings/collectors.mjs:17; tab "pathfinder"' },
    { name: 'Liquidity Observatory', source: 'public/modules/25-observatory.js:383' },
    { name: '26 spokes', source: 'lib/findings/collectors.mjs:23; /api/spokes' },
    { name: 'Titan Event Model / Event Stream', source: 'spec:106,381' },
  ],
  // On the Commander's TG list but found in NO readable source.
  noSource: ['TGPA Play Analysis', 'TGDP Developer Platform', 'TGSEO SEO Intelligence'],
};

// ---------------- Collision / ambiguity review notes ----------------
export const REVIEW_NOTES = [
  { id: 'tga-family', acronyms: ['TGAR', 'TGAN', 'TGAT'], severity: 'low', note: 'RESOLVED 2026-10-24: Commander chose TGAR for Arena, replacing the proposed TGA, which was a strict prefix of TGAN and TGAT and clashed with 1313VERSE\'s "tga" alias (Titan Ghost Analyst, /opt/1313verse/src/core/avatars/staff.ts:118). TGAR, TGAN and TGAT share the "TGA" stem but none is a prefix of another; still exact-match acronyms and never filter on "TGA*". "TGA" is not an alias of TGAR.' },
  { id: 'tgs-prefix', acronyms: ['TGS', 'TGSEO'], severity: 'medium', note: 'TGS (Sentinel) is a prefix of TGSEO; "TGS" can also read as "TG Services/Security". Exact-match acronyms in APIs; never prefix-match.' },
  { id: 'tgt-ticker', acronyms: ['TGT'], severity: 'medium', note: 'TGT is a widely used exchange ticker symbol (Target Corporation, NYSE) and can read as "Titan Ghost Token". Risky in fintech dashboards that also show tickers.' },
  { id: 'tglw-expansion', acronyms: ['TGLW'], severity: 'low', note: 'RESOLVED 2026-10-24: Commander confirmed TGLW = Titan Ghost Liquidity Wake (not "wallet"). CONTRACT glossary copy updated; code identifiers unchanged. "TGLW wallet" remains only as a descriptive alias for a participant\'s self-custodial wallet used with TGLW.' },
  { id: 'wake-overlap', acronyms: ['TGLW', 'TGI'], severity: 'medium', note: '"Wake" appears in both "Liquidity Wake" (TGLW) and "Wake Intelligence" (TGI). The bare alias "Wake" is left unresolvable on purpose.' },
  { id: 'tg-dual-use', acronyms: ['TG'], severity: 'low', note: '"TG" is both the family prefix and the market maker\'s own acronym. Use "TG" alone only for the market maker; telemetry should carry the full acronym (e.g. product="TG").' },
  { id: 'acronym-length', acronyms: ['TGSEO'], severity: 'low', note: 'TGSEO is the only 5-letter code; fine for APIs, long for badges.' },
  { id: 'unmapped-domains', acronyms: [], severity: 'low', note: 'tg-c2.com, tg-browsergateway.com and tg-agencynetwork.com have no defined product. "Agency Network" vs "Advisory Network" is easy to confuse.' },
  { id: 'authority-node', acronyms: ['TGAT'], severity: 'low', note: 'Authority is a node role on COMMAND/C2 (spec §C) as much as a product; confirm it should be a TG product at all.' },
];

// Decisions needed from the Commander (top of docs/TG_PRODUCT_REGISTRY.md and the UI).
export const DECISIONS = [
  'Provide or confirm the canonical sixteen-product list (likely in /opt/gyw1313-docs or /opt/gyw-knowledge, unreadable from this account). The established 16 stays unverified until then; TGAN is product 17 (Commander decision).',
  'Confirm or replace the 10 remaining PROPOSED acronyms: TGS, TGG, TGAT, TGI, TGM, TGT, TGV, TGPA, TGDP, TGSEO.',
  'Map or exclude the unmapped surfaces: Pathfinder, Liquidity Observatory, 26 spokes, Strategic/Arbitrage/Meme engines.',
  'Define or drop tg-c2.com, tg-browsergateway.com, tg-agencynetwork.com (no product defined).',
  'Domains: verify availability at GoDaddy/registrar and start trademark clearance before any purchase (none purchased).',
];
