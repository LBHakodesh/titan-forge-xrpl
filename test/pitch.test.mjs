// Simple full-screen pitch (public/pitch.html + public/pitch.js): Why Not? track = Titan Ghost. Timeline determinism,
// honest labels, the Commander's live slot, the coming-to-market showcase, TGLW/TGLB as two platforms, the website end
// card, read-only data use, and the pre-rendered narration audio fitting its scenes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCENES, SCENE_DEFS, DURATION, DEFAULT_TALK, NARRATED, MODE_TEXT, ERA, ENDPOINTS, SHOWCASE, SHOWCASE_PRODUCTS, FEATURED, MODULES,
  APPROVED_ACRONYMS, STAT, PRESENTER, playbackMode, holdPoint, SITE_URL, SITE_PREVIEW, HERO_IMG, SITE_LIVE_DEFAULT, siteTag, siteLiveFrom, showcaseBeats, leadOf,
  buildTimeline, totalOf, talkLength, sceneAt, nextStart, prevStart, validate, words, liveFor, renderArt, speechText, audioFile, fmt,
} from '../public/pitch.js';
import { wavDuration } from '../scripts/render-pitch-audio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const HASH = /\b[0-9A-Fa-f]{64}\b/;
const by = Object.fromEntries(SCENES.map((s) => [s.id, s]));
const both = (s, live = null) => [renderArt(s, live, false), renderArt(s, live, true)];

test('pitch: default timeline is contiguous and exactly 180 s with a 40 s live slot', () => {
  assert.equal(DURATION, 180); assert.equal(DEFAULT_TALK, 40); assert.equal(NARRATED, 140);
  assert.deepEqual(validate(), []);
  assert.equal(SCENES[0].start, 0); assert.equal(totalOf(SCENES), 180);
  for (let i = 1; i < SCENES.length; i++) assert.equal(SCENES[i].start, SCENES[i - 1].end);
  assert.deepEqual(SCENES.map((s) => s.id), ['open', 'presenter', 'problem', 'engine', 'proof', 'lending', 'agentic', 'xdlc', 'talk', 'site']);
  assert.deepEqual(SCENES.map((s) => [s.start, s.end]), [[0, 13], [13, 25], [25, 40], [40, 57], [57, 65], [65, 87], [87, 105], [105, 125], [125, 165], [165, 180]]);
  assert.deepEqual(JSON.stringify(buildTimeline()), JSON.stringify(buildTimeline(DEFAULT_TALK)));
});

test('pitch: live slot is second-to-last, silent, configurable via ?talk=', () => {
  const talk = SCENES.filter((s) => s.talk);
  assert.equal(talk.length, 1); assert.equal(SCENES.at(-2).id, 'talk'); assert.equal(SCENES.at(-1).id, 'site');
  assert.equal(talk[0].end - talk[0].start, 40);
  for (const t of [0, 30, 60, 90, 120]) {
    const tl = buildTimeline(t);
    assert.equal(totalOf(tl), NARRATED + t, `talk ${t}`);
    const slot = tl.find((s) => s.talk); assert.equal(slot.end - slot.start, t);
    for (const s of tl.filter((x) => !x.talk)) assert.equal(s.end - s.start, SCENE_DEFS.find((d) => d.id === s.id).dur, s.id);
    assert.deepEqual(validate(tl, NARRATED + t), []);
  }
  assert.equal(talkLength(null), 40); assert.equal(talkLength('abc'), 40); assert.equal(talkLength('60'), 60); assert.equal(talkLength(-5), 0); assert.equal(talkLength(1e6), 600);
});

test('pitch: navigation is deterministic', () => {
  const run = () => { const seq = []; let t = 0; while (t < totalOf(SCENES)) { seq.push(sceneAt(t)); t = nextStart(t); } return seq; };
  assert.deepEqual(run(), SCENES.map((_, i) => i));
  assert.equal(sceneAt(-1), 0); assert.equal(sceneAt(500), SCENES.length - 1);
  assert.equal(prevStart(45), 40); assert.equal(prevStart(41), 25); assert.equal(prevStart(1), 0);
  assert.equal(fmt(165), '02:45');
});

test('pitch: narration is the Commander script verbatim; headlines ≤9 words; honest badges', () => {
  assert.deepEqual(SCENE_DEFS.filter((d) => !d.talk && !d.silent).map((d) => d.say), [
    'This is Titan Ghost, from GYW1313. Our answer to the Why Not track: why should any XRP Ledger market go without liquidity?',
    'Thin markets lose trades. In our Mainnet sample, more cross-currency payments failed than succeeded, and a handful of providers supplied almost all the liquidity.',
    'Titan Ghost is our existing market-making engine. It places liquidity in six rings: tight inner rings for everyday payments, and deep reserves behind them. The XRP Ledger routes payments through it.',
    'On Testnet, real payments have already filled our offers, bridged through XRP.',
    "This weekend we built three capabilities into Titan Ghost. First, lending. TGLB funds new markets in three tiers, and TGLW, our self-custody liquidity platform, supplies tiers one and two straight from participants' own wallets.",
    "Second, agentic payments. Through TG Merchant, AI agents buy Titan Ghost market data over x402 on the XRP Ledger, and every payment needs a person's approval.",
    "Third, XDLC: a neutral protocol. Its corridor quotes a better price than the XRP Ledger's AMM at every depth, and anyone can provide liquidity: Titan Ghost, TGLW participants, or other firms. We propose it as an open amendment, a draft not yet submitted.",
    'XDLC: liquidity for every market. Titan Ghost, from GYW1313. Learn more at G Y W thirteen thirteen dot com.',
  ]);
  for (const s of SCENES) {
    assert.ok(words(s.headline) >= 1 && words(s.headline) <= 9, s.headline);
    assert.ok(s.modes.length && s.modes.every((m) => MODE_TEXT[m]), s.id);
    assert.ok(s.badge && s.badge.length < 80, s.id);
    if (s.era) assert.ok(ERA[s.era]);
  }
  assert.match(by.open.badge, /WHY NOT\? TRACK/);
  assert.ok(by.problem.modes.includes('MAINNET_OBSERVED')); assert.match(by.problem.badge, /MAINNET OBSERVED · SAMPLE/);
  assert.match(by.engine.badge, /PRE-HACKATHON ENGINE/); assert.equal(by.engine.era, 'pre');
  assert.ok(by.proof.modes.includes('LIVE_TESTNET')); assert.match(by.proof.badge, /DEMO ACCOUNTS/);
  assert.ok(by.lending.modes.includes('SIMULATION')); assert.match(by.lending.badge, /^NEW · SIMULATION/);
  assert.match(by.agentic.badge, /x402/); assert.match(by.agentic.badge, /APPROVAL REQUIRED/);
  assert.ok(by.xdlc.modes.includes('SIMULATION') && by.xdlc.modes.includes('PROPOSED'));
  assert.match(by.xdlc.say, /a draft not yet submitted/);
  assert.equal(by.xdlc.headline, 'XDLC: a neutral corridor that beats the AMM.'); assert.equal(by.xdlc.badge, 'NEW · SIMULATION + PROPOSED');
  assert.equal(by.xdlc.sub, 'Proposed open XRPL amendment · draft · simulated today');
  for (const svg of both(by.xdlc)) {
    assert.match(svg, />AMM</); assert.match(svg, /XDLC corridor( · |<\/text>.*?>)≥1 bp better/); assert.match(svg, /class="ladder"/);
    for (const p of ['Titan Ghost', 'TGLW participants', 'Other firms']) assert.ok(svg.includes(`>${p}</text>`), p);
    assert.match(svg, /tenure/); assert.match(svg, /neutral protocol/);
  }
  assert.equal(by.talk.headline, 'More from GYW1313 · coming to market');
  assert.equal(by.site.headline, 'XDLC: Liquidity for every market.');
  assert.deepEqual(STAT, { failed: 133, succeeded: 79, top5Share: 97 });
  const p = renderArt(by.problem, null, false); assert.match(p, />133</); assert.match(p, />79</); assert.match(p, />97%</); assert.match(p, /Mainnet sample/);
  // Presenter talking points stay short.
  assert.ok(words(by.talk.say) <= 120);
});

test('pitch: branded open uses the GYW1313 hero and the Titan Ghost wordmark', () => {
  for (const svg of both(by.open)) {
    assert.ok(svg.includes(`href="${HERO_IMG}"`)); assert.match(svg, /PRESENTS/); assert.match(svg, />TITAN</); assert.match(svg, />GHOST</);
    assert.match(svg, /BUILT ON THE XRP LEDGER/);
  }
  const html = read('public/pitch.html');
  for (const c of ['#070a10', '#e9c46a', '#f3dda7', '#4cc4f0', '#e9eef6', '#9ca3af']) assert.ok(html.includes(c), c);
  assert.match(html, /<span class="wm">GYW<b>1313<\/b><\/span>/); assert.match(html, /TITAN GHOST/); assert.match(html, /BUILT ON THE XRP LEDGER/);
});

test('pitch: Titan Ghost core with three modules lights one per scene and they stay lit', () => {
  assert.deepEqual(MODULES, ['Lending', 'Agentic payments', 'XDLC']);
  assert.deepEqual(['lending', 'agentic', 'xdlc'].map((id) => by[id].module), [1, 2, 3]);
  for (const [id, n] of [['lending', 1], ['agentic', 2], ['xdlc', 3]]) {
    for (const svg of both(by[id])) {
      assert.equal((svg.match(/class="mod lit/g) || []).length, n, id);
      assert.equal((svg.match(/class="mod lit cur"/g) || []).length, 1, id);
      assert.match(svg, />TITAN</);
    }
  }
});

test('pitch: TGLW and TGLB are two separate, linked platforms (never one inside the other)', () => {
  for (const svg of both(by.lending)) {
    const groups = [...svg.matchAll(/<g class="platform (\w+)" data-platform="(\w+)">/g)].map((m) => m[2]);
    assert.deepEqual(groups, ['TGLW', 'TGLB']);
    const iW = svg.indexOf('data-platform="TGLW"'), iB = svg.lastIndexOf('<g', svg.indexOf('data-platform="TGLB"'));
    // The TGLW group closes before the TGLB group opens (siblings, not nested).
    const tglw = svg.slice(iW, iB); const opens = (tglw.match(/<g[\s>]/g) || []).length, closes = (tglw.match(/<\/g>/g) || []).length;
    assert.equal(closes - opens, 1, 'TGLW group closed before TGLB');
    assert.match(tglw, /Tier 1|own wallets/);
    assert.match(svg, /Tier 1 · flexible/); assert.match(svg, /Tier 2 · term/); assert.match(svg, /Tier 3 · loans/);
    assert.equal((svg.match(/>PLATFORM</g) || []).length, 2);
  }
  assert.match(by.lending.sub, /TGLW supports TGLB/);
});

test('pitch: showcase = 12 coming-to-market products + 5 featured = the official 17', () => {
  assert.deepEqual(SHOWCASE_PRODUCTS, ['TG Intelligence', 'TG Sentinel', 'TG Guardian', 'TG Authority', 'TG Advisory Network (TGAN)', 'TG Tokenization',
    'TG View', 'TG Arena (TGAR)', 'TG Play Analysis', 'TG Developer Platform', 'TG SEO Intelligence', '1313VERSE']);
  assert.deepEqual(FEATURED, ['Titan Ghost', 'TGLB', 'TGLW', 'TG Merchant', 'XDLC']);
  assert.equal(SHOWCASE_PRODUCTS.length + FEATURED.length, 17);
  assert.equal(new Set([...SHOWCASE_PRODUCTS, ...FEATURED]).size, 17);
  assert.ok(!/^TG/.test('1313VERSE') && SHOWCASE_PRODUCTS.includes('1313VERSE'));
  for (const p of SHOWCASE_PRODUCTS) for (const m of p.matchAll(/\(([A-Z]+)\)/g)) assert.ok(APPROVED_ACRONYMS.includes(m[1]), m[1]);
  assert.equal(SHOWCASE.length, 4); for (const g of SHOWCASE) assert.equal(g.products.length, 3);
  const html = renderArt(by.talk, null);
  for (const p of SHOWCASE_PRODUCTS) assert.ok(html.includes(`>${p}</span>`), p);
  assert.equal((html.match(/class="pcard/g) || []).length, 12);
  assert.equal((html.match(/class="fchip"/g) || []).length, 5);
  assert.match(html, /17 products · five featured today/);
  // Groups highlight in turn across the slot, scaling with ?talk=.
  for (const t of [30, 45, 90]) {
    const slot = buildTimeline(t).find((s) => s.talk); const beats = showcaseBeats(slot);
    assert.equal(beats.length, 4); assert.equal(beats[0].start, slot.start); assert.equal(beats[3].end, slot.end);
    for (const b of beats) assert.ok(Math.abs(b.end - b.start - t / 4) < 0.02);
    assert.ok(renderArt(slot, null).includes(`--dl:${(3 * t / 4).toFixed(2)}s;--cyc:${t}s`), `talk ${t}`);
  }
});

test('pitch: website end card says "Launching at" by default and "Live at" only with ?siteLive=1', () => {
  assert.equal(SITE_LIVE_DEFAULT, false);
  assert.equal(siteTag(SITE_LIVE_DEFAULT), 'Launching at'); assert.equal(siteTag(true), 'Live at'); assert.equal(siteTag('1'), 'Launching at');
  assert.equal(siteLiveFrom(null), false); assert.equal(siteLiveFrom('0'), false); assert.equal(siteLiveFrom('1'), true);
  assert.equal(SITE_URL, 'gyw1313.com/titan-ghost');
  const def = renderArt({ ...by.site }, null); assert.match(def, />Launching at</); assert.ok(!/Live at/.test(def));
  assert.match(renderArt({ ...by.site, siteLive: true }, null), />Live at</);
  assert.ok(def.includes(`src="${SITE_PREVIEW}"`)); assert.ok(def.includes(`data-fallback="${HERO_IMG}"`));
  assert.ok(fs.existsSync(path.join(ROOT, 'public', HERO_IMG)));
  assert.match(read('public/pitch.js'), /siteLiveFrom\(q\.get\('siteLive'\)\)/);
});

test('pitch: no transaction-hash-looking strings in static text', () => {
  assert.ok(!HASH.test(JSON.stringify(SCENE_DEFS)));
  assert.ok(!HASH.test(read('public/pitch.js')));
  assert.ok(!HASH.test(read('public/pitch.html')));
  for (const s of SCENES) for (const a of both(s)) assert.ok(!HASH.test(a), s.id);
});

test('pitch: live numbers come only from GET data and are never invented', () => {
  for (const id of SCENES.map((s) => s.id)) { assert.equal(liveFor(id, {}), null, id); assert.equal(liveFor(id, null), null, id); }
  assert.deepEqual(Object.values(ENDPOINTS), ['/api/theater/state', '/api/vendors']);
  const src = read('public/pitch.js');
  assert.ok(!/method:\s*['"](POST|PUT|PATCH|DELETE)/.test(src));
  assert.ok(!/api\.post|\.submit\(|sign\(/.test(src));
  const data = {
    theater: { live: { mode: 'LIVE_TESTNET', organic: false, quoter: { makerFills: 29 } } },
    vendors: { vendors: [{ id: 'xrpl', status: 'CONNECTED' }, { id: 'mastercard', status: 'DOCUMENTATION_ONLY' }] },
  };
  assert.deepEqual(liveFor('proof', data), { big: '29', label: 'validated Testnet maker fills', mode: 'LIVE_TESTNET', note: 'demo accounts' });
  assert.equal(liveFor('proof', { theater: { live: { mode: 'SIMULATION', quoter: { makerFills: 5 } } } }), null);
  const v = liveFor('site', data).vendors;
  assert.deepEqual(v.map((x) => x.name), ['XRPL', 't54', 'Ledger', 'QuickNode', 'AWS', 'Mastercard']);
  assert.equal(v[0].tone, 'ok'); assert.equal(v[1].text, 'status unavailable'); assert.equal(v[5].text, 'docs only');
  const site = renderArt(by.site, liveFor('site', data)); assert.match(site, /sdot ok/); assert.match(site, />docs only</);
  for (const s of SCENES) for (const a of [renderArt(s, liveFor(s.id, data), false), renderArt(s, liveFor(s.id, data), true)]) assert.ok(/^<(svg|div)/.test(a), s.id);
});

test('pitch: narration audio exists for every narrated scene and fits it after its lead-in', () => {
  const man = JSON.parse(read('public/pitch-audio/manifest.json'));
  const narrated = SCENE_DEFS.filter((d) => !d.talk && !d.silent);
  assert.equal(man.scenes.length, narrated.length);
  assert.equal(man.voice, 'af_heart');
  for (const d of narrated) {
    const e = man.scenes.find((x) => x.id === d.id);
    assert.ok(e, d.id); assert.equal(e.file, audioFile(d.id));
    const buf = fs.readFileSync(path.join(ROOT, 'public/pitch-audio', e.file));
    const dur = wavDuration(buf);
    assert.ok(Math.abs(dur - e.duration) < 0.01, d.id);
    assert.ok(leadOf(d) + dur + 0.3 <= d.dur, `${d.id}: ${dur}s audio in a ${d.dur}s scene`);
  }
  assert.ok(!man.scenes.some((e) => e.id === 'talk' || e.id === 'presenter'), 'no narration in the live slot or presenter scene');
  assert.equal(speechText('GYW1313 on XRPL with t54 via TGLB and TGLW over x402, TG Merchant'),
    'G Y W thirteen thirteen on X R P L with T fifty-four via T G L B and T G L W over x four oh two, T G Merchant');
});

test('pitch: header ▶ Present opens /pitch.html; detailed tour stays in the 3-Minute Pitch tab', () => {
  assert.match(read('public/shell.js'), /pb\.onclick = \(\) => \{ closeMenu\(\); location\.href = '\/pitch\.html'; \}/);
  assert.match(read('public/index.html'), /id="present-btn"/);
  const p = read('public/modules/01-present.js');
  assert.match(p, /href="\/pitch\.html"/); assert.match(p, /Detailed tour/);
  assert.match(read('public/pitch.html'), /<script type="module" src="\/pitch\.js"><\/script>/);
});

test('pitch: presenter scene follows the open, is silent and shows the exact credentials', () => {
  assert.equal(SCENES[1].id, 'presenter'); const p = by.presenter;
  assert.equal(p.silent, true); assert.equal(p.end - p.start, 12); assert.equal(p.badge, 'PRESENTER');
  assert.equal(p.headline, 'Built by a security-first operator.'); assert.ok(words(p.headline) <= 9);
  assert.ok(Object.isFrozen(PRESENTER)); assert.equal(PRESENTER.name, 'Commander, GYW1313');
  assert.equal(PRESENTER.military.join(' → '), 'Enlisted Infantry → Commissioned Infantry Officer → Branch-transferred to the Signal Corps');
  assert.equal(PRESENTER.certification, 'CISSP');
  assert.deepEqual(PRESENTER.education, ['MS, Cybersecurity', 'BS, Information Systems Management', 'PhD candidate, Financial Cybersecurity (expected end of 2027)']);
  assert.equal(PRESENTER.dissertation, 'How to mitigate the threat of the rise of attacks across blockchain transactions related to the maturation of emerging technologies and their nefarious deployment');
  const html = renderArt(p, null);
  for (const t of [PRESENTER.name, ...PRESENTER.military, 'CISSP', ...PRESENTER.education, PRESENTER.dissertation]) assert.ok(html.includes(`>${t.replace(/&/g, '&amp;')}<`), t);
  assert.equal((html.match(/class="chev"/g) || []).length, 2);
  assert.ok(!JSON.parse(read('public/pitch-audio/manifest.json')).scenes.some((e) => e.id === 'presenter'));
});

test('pitch: presenter-narrated mode is the default; ?auto=1 restores timed auto-advance with voice', () => {
  const q = (o) => new URLSearchParams(o);
  assert.deepEqual(playbackMode(q({})), { auto: false, muted: true });
  assert.deepEqual(playbackMode(q({ voice: '1' })), { auto: false, muted: false });
  assert.deepEqual(playbackMode(q({ auto: '1' })), { auto: true, muted: false });
  assert.deepEqual(playbackMode(q({ auto: '1', mute: '1' })), { auto: true, muted: true });
  assert.deepEqual(playbackMode(null), { auto: false, muted: true });
  // Manual: hold on the scene's final frame; auto: never hold.
  const s = by.problem;
  assert.equal(holdPoint(s.start + 3, s, false), null);
  assert.ok(Math.abs(holdPoint(s.end + 0.2, s, false) - (s.end - 0.01)) < 1e-9);
  assert.equal(sceneAt(holdPoint(s.end + 0.2, s, false)), SCENES.indexOf(s), 'held frame stays in the same scene');
  assert.equal(holdPoint(s.end + 0.2, s, true), null);
  const src = read('public/pitch.js'); const html = read('public/pitch.html');
  assert.match(html, /▶ Start presentation/);
  assert.match(src, /if \(ctl\.held\) return advance\(\);/); // Space at a held end advances
  assert.match(src, /k === 'ArrowRight'\) advance\(\)/);
  assert.match(src, /playbackMode\(q\)/);
});
