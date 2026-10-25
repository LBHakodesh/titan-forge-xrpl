// Spokes service: read-only discovery + observation pipeline, cached snapshot, schedule and bus events.
//   ranking (xrpl.to) -> provider screening -> Mainnet reads (issuer, books, AMM) -> 13 + 13 selection
//   -> Testnet book read for project tokens -> Mainnet ledger scan for flows -> data/spokes-snapshot.json
// Submits nothing, on any network. If the provider or Mainnet is unreachable the previous snapshot keeps being served.
import fs from 'node:fs';
import path from 'node:path';
import { fetchRanking, fetchScamAddresses, ProviderError } from './provider.mjs';
import { SpokesMainnetReader } from './mainnet-read.mjs';
import { tickerCollisions } from './identity.mjs';
import { parseAsks, parseBids, parseAmm, issuerProfile } from './market.mjs';
import { providerChecks, isEligible, ageDays, RULES } from './eligibility.mjs';
import { buildMainnetSpoke, buildTestnetSpoke, spokeKeyMap, assembleResponse, GROUP_SIZE } from './build.mjs';
import { scanMainnetFlows, testnetFlowsFromRuns } from './flows.mjs';
import { recordReplay, buildReplay } from './replay.mjs';

export const SNAPSHOT_VERSION = 1;
const nowIso = () => new Date().toISOString();

export async function readMainnetMarket(reader, asset) {
  const at = nowIso();
  try {
    const cur = asset.ledgerCurrency || asset.currencyHex || asset.currency;
    let issuer;
    try { issuer = issuerProfile((await reader.request({ command: 'account_info', account: asset.issuer, ledger_index: 'validated', signer_lists: true })).result); }
    catch (e) { if (/actNotFound/i.test(e?.data?.error || e.message)) issuer = { exists: false }; else throw e; }
    if (!issuer.exists) return { ok: true, issuer, asks: [], bids: [], amm: { present: false, xrp: 0, token: 0 }, at };
    const tok = { currency: cur, issuer: asset.issuer };
    const asksR = await reader.request({ command: 'book_offers', taker_gets: tok, taker_pays: { currency: 'XRP' }, limit: 100, ledger_index: 'validated' });
    const bidsR = await reader.request({ command: 'book_offers', taker_gets: { currency: 'XRP' }, taker_pays: tok, limit: 100, ledger_index: 'validated' });
    let amm;
    try { amm = parseAmm((await reader.request({ command: 'amm_info', asset: { currency: 'XRP' }, asset2: tok, ledger_index: 'validated' })).result); }
    catch (e) { if (/actNotFound|ammNotFound|NotFound/i.test(e?.data?.error || e.message)) amm = { present: false, xrp: 0, token: 0 }; else throw e; }
    return { ok: true, issuer, asks: parseAsks(asksR.result.offers), bids: parseBids(bidsR.result.offers), amm, at };
  } catch (e) {
    return { ok: false, error: e.message, at };
  }
}

export async function readTestnetBook(request, code, issuer) {
  const at = nowIso();
  try {
    const tok = { currency: code, issuer };
    const a = await request({ command: 'book_offers', taker_gets: tok, taker_pays: { currency: 'XRP' }, limit: 50, ledger_index: 'validated' });
    const b = await request({ command: 'book_offers', taker_gets: { currency: 'XRP' }, taker_pays: tok, limit: 50, ledger_index: 'validated' });
    return { ok: true, asks: parseAsks(a.result.offers), bids: parseBids(b.result.offers), at };
  } catch (e) { return { ok: false, error: e.message, at }; }
}

// Full discovery. deps: { ranking(), scams(), reader, testnetRequest|null, launches[], roles, log, scan:{ledgers,deadlineMs} }
export async function discover(deps) {
  const { log = () => {}, now = Date.now() } = deps;
  const t0 = Date.now();
  const ranking = await deps.ranking();
  const scamSet = await (deps.scams?.() ?? null);
  const collisions = tickerCollisions(ranking.assets);
  const reader = deps.reader;

  // 1) Provider screen (no ledger reads).
  const pre = ranking.assets.map((a) => ({ a, checks: providerChecks(a, { scamSet, collisions, now }) }));
  const established = (a) => (ageDays(a.listedAt, now) ?? 0) >= RULES.establishedMinAgeDays;
  const passed = pre.filter((p) => isEligible(p.checks));

  // 2) Mainnet reads in rank order until each group is full of eligible spokes (bounded budget).
  const need = { A: GROUP_SIZE, B: GROUP_SIZE - (deps.launches || []).filter((l) => l.status === 'live' && l.issuer).length };
  const built = { A: [], B: [] };
  const maxReads = deps.maxReads ?? 60;
  let reads = 0, mainnetUp = false;
  for (const { a } of passed) {
    const g = established(a) ? 'A' : 'B';
    if (built[g].filter((s) => s.eligibility.eligible).length >= need[g]) continue;
    if (reads >= maxReads) break;
    reads++;
    const r = await readMainnetMarket(reader, a);
    if (r.ok) mainnetUp = true;
    else if (!mainnetUp && reads >= 3) throw new Error(`Mainnet unreachable: ${r.error}`);
    const age = ageDays(a.listedAt, now);
    const reason = g === 'A'
      ? `Established: listed ${age} days; rank #${a.rank} by 24h XRP volume (${Math.round(a.vol24hXrp || 0).toLocaleString('en-US')} XRP).`
      : `Emerging: listed ${age} days ago; rank #${a.rank} by 24h XRP volume (${Math.round(a.vol24hXrp || 0).toLocaleString('en-US')} XRP, ${a.uniqueTraders24h} traders).`;
    built[g].push(buildMainnetSpoke(a, g, r, { scamSet, collisions, now, reason }));
    log(`read ${a.name} (${g}) ${r.ok ? 'ok' : r.error}`);
  }
  if (!mainnetUp) throw new Error('Mainnet unreachable: no successful read');

  const pickGroup = (arr, n) => [...arr.filter((s) => s.eligibility.eligible), ...arr.filter((s) => !s.eligibility.eligible)].slice(0, n).sort((x, y) => x.rank - y.rank);
  const groupA = pickGroup(built.A, GROUP_SIZE);
  const mainB = pickGroup(built.B, need.B);

  // 3) Testnet project spokes (read-only book_offers via the Testnet ledger client).
  const testnet = [];
  for (const l of deps.launches || []) {
    if (!l.issuer || !['live', 'queued', 'running'].includes(l.status)) continue;
    const book = deps.testnetRequest ? await readTestnetBook(deps.testnetRequest, l.code, l.issuer) : { ok: false, error: 'Testnet client not ready' };
    testnet.push(buildTestnetSpoke(l, book, { roles: deps.roles }));
  }

  // 4) Everything else that ranked high but was screened out (displayable, flagged, never a funding candidate).
  const chosen = new Set([...groupA, ...mainB].map((s) => s.id));
  const screenedOut = [];
  for (const g of ['A', 'B']) for (const s of built[g]) if (!chosen.has(s.id)) screenedOut.push(brief(s, g));
  for (const p of pre) if (!isEligible(p.checks) && screenedOut.length < 40) screenedOut.push({ id: p.a.id, rank: p.a.rank, currency: p.a.currency, issuer: p.a.issuer, name: p.a.name, group: established(p.a) ? 'A' : 'B', stage: 'provider', failed: p.checks.filter((c) => c.blocking && !c.ok).map((c) => ({ id: c.id, detail: c.detail })) });

  // 5) Mainnet flow scan over the chosen Mainnet spokes.
  const spokesAll = [...groupA, ...testnet, ...mainB];
  let scan;
  try { scan = await scanMainnetFlows(reader, spokeKeyMap(spokesAll), { ...(deps.scan || {}), log }); }
  catch (e) { scan = { flows: [], coverage: { mainnetLedgersScanned: 0, mainnetPaymentsMatched: 0, from: null, to: null, stopReason: `scan failed: ${e.message}` } }; }

  const xrpUsdVals = ranking.assets.map((a) => a.xrpUsd).filter((x) => x > 0);
  return {
    version: SNAPSHOT_VERSION, source: 'xrpl.to', fetchedAt: nowIso(),
    provider: { total: ranking.total, sortBy: ranking.sortBy, fetchedAt: ranking.fetchedAt, assets: ranking.assets.length },
    xrpUsd: xrpUsdVals.length ? median(xrpUsdVals) : null,
    groups: { A: groupA, B: [...testnet, ...mainB] },
    screenedOut: screenedOut.sort((x, y) => (x.rank ?? 1e9) - (y.rank ?? 1e9)),
    coverage: scan.coverage,
    mainnetFlows: scan.flows,
    mainnetReads: { assets: reads, requests: reader.stats?.requests ?? null, node: reader.node ?? null },
    tookMs: Date.now() - t0,
    lastError: null,
  };
}

const brief = (s, g) => ({ id: s.id, rank: s.rank, currency: s.currency, issuer: s.issuer, name: s.name, group: g, stage: 'ledger', failed: s.eligibility.checks.filter((c) => c.blocking && !c.ok).map((c) => ({ id: c.id, detail: c.detail })) });
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export class SpokesService {
  constructor({ file, runsFile, store = null, ledger = null, bus = null, env = process.env, deps = {}, log = (m) => console.log('[spokes]', m) } = {}) {
    Object.assign(this, { file, runsFile, store, ledger, bus, log, deps });
    this.refreshMin = Math.max(5, Number(env.TF_SPOKES_REFRESH_MIN) || 30);
    this.minGapMs = Math.max(30, Number(env.TF_SPOKES_MIN_GAP_SEC) || 300) * 1000;
    this.scanLedgers = Math.max(5, Math.min(120, Number(env.TF_SPOKES_LEDGERS) || 40));
    this.auto = env.TF_SPOKES_AUTO !== '0';
    this.snap = this.#load();
    this.state = { status: 'idle', lastStart: 0, lastOk: !!this.snap?.fetchedAt, // a persisted snapshot was a successful one
      lastError: this.snap?.lastError ?? null, nextAt: null };
    this.timer = null;
    this.runsMtime = 0; this.testnetFlows = []; this.seenTestnet = new Set();
    this.#reloadRuns(false);
  }

  #load() {
    try { return fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : null; }
    catch (e) { this.log(`snapshot unreadable: ${e.message}`); return null; }
  }
  #save(s) { fs.writeFileSync(this.file + '.tmp', JSON.stringify(s, null, 1)); fs.renameSync(this.file + '.tmp', this.file); }

  #reloadRuns(emit = true) {
    if (!this.runsFile) return;
    try {
      const st = fs.statSync(this.runsFile);
      if (st.mtimeMs === this.runsMtime) return;
      this.runsMtime = st.mtimeMs;
      const doc = JSON.parse(fs.readFileSync(this.runsFile, 'utf8'));
      const map = new Map();
      for (const s of this.snap?.groups?.B || []) if (s.network === 'testnet') map.set(s.testnet.code, { id: s.id, issuer: s.issuer });
      if (!map.size && this.store) for (const l of this.store.launches) if (l.issuer && l.status === 'live') map.set(l.code, { id: `testnet:${l.code}:${l.issuer}`, issuer: l.issuer });
      this.testnetFlows = testnetFlowsFromRuns(doc, map);
      for (const f of [...this.testnetFlows].reverse()) {
        if (this.seenTestnet.has(f.hash)) continue;
        this.seenTestnet.add(f.hash);
        if (emit) this.bus?.publish('spokes.flow', 'LIVE_TESTNET', { flow: f });
      }
    } catch { /* runs file optional */ }
  }

  start() {
    if (!this.auto) return;
    const age = this.snap?.fetchedAt ? Date.now() - Date.parse(this.snap.fetchedAt) : Infinity;
    const first = age >= this.refreshMin * 60_000 ? 5_000 : this.refreshMin * 60_000 - age;
    this.#schedule(first);
    this.runsTimer = setInterval(() => this.#reloadRuns(true), 60_000); this.runsTimer.unref?.();
  }
  stop() { clearTimeout(this.timer); clearInterval(this.runsTimer); }
  #schedule(ms) {
    clearTimeout(this.timer);
    this.state.nextAt = new Date(Date.now() + ms).toISOString();
    this.timer = setTimeout(() => this.refresh().catch(() => {}).finally(() => this.#schedule(this.state.retryAfterMs || this.refreshMin * 60_000)), ms);
    this.timer.unref?.();
  }

  // Manual trigger (POST /api/spokes/refresh). Rate-limited; returns {status, httpStatus, ...}.
  requestRefresh() {
    if (this.state.status === 'refreshing') return { httpStatus: 409, error: 'A refresh is already running.', startedAt: new Date(this.state.lastStart).toISOString() };
    const wait = this.state.lastStart + this.minGapMs - Date.now();
    if (wait > 0) return { httpStatus: 429, error: `Refresh is rate-limited; retry in ${Math.ceil(wait / 1000)} s.` };
    this.refresh().catch(() => {});
    return { httpStatus: 202, status: 'refreshing', mode: 'MAINNET_OBSERVED', note: 'Read-only rediscovery started (xrpl.to ranking + Mainnet reads + ledger scan).' };
  }

  async refresh() {
    if (this.state.status === 'refreshing') return null;
    Object.assign(this.state, { status: 'refreshing', lastStart: Date.now(), retryAfterMs: 0 });
    const reader = this.deps.reader ?? new SpokesMainnetReader();
    try {
      const roles = this.#roles();
      const testnetRequest = this.deps.testnetRequest ?? this.#testnetRequest();
      const snap = await discover({
        ranking: this.deps.ranking ?? (() => fetchRanking({ limit: 100 })),
        scams: this.deps.scams ?? (() => fetchScamAddresses()),
        reader, testnetRequest, roles,
        launches: this.store?.launches ?? this.deps.launches ?? [],
        scan: { ledgers: this.scanLedgers, deadlineMs: 50_000 },
        log: () => {},
      });
      const prevHashes = new Set((this.snap?.mainnetFlows || []).map((f) => f.hash));
      // Replay recording is frozen once and carried forward so /api/spokes/replay never changes between calls.
      this.#reloadRuns(false);
      snap.replay = this.snap?.replay?.items?.length ? this.snap.replay : recordReplay({ mainnetFlows: snap.mainnetFlows, testnetFlows: this.testnetFlows, spokes: [...snap.groups.A, ...snap.groups.B] });
      this.#save(snap);
      this.snap = snap;
      Object.assign(this.state, { lastOk: true, lastError: null });
      this.runsMtime = 0; this.#reloadRuns(false);
      const resp = this.response();
      this.bus?.publish('spokes.snapshot', 'MAINNET_OBSERVED', { fetchedAt: snap.fetchedAt, freshness: resp.snapshot.freshness, counts: resp.counts, coverage: resp.coverage, attribution: resp.snapshot.attribution });
      const fresh = snap.mainnetFlows.filter((f) => !prevHashes.has(f.hash)).slice(0, 25).reverse();
      for (const f of fresh) this.bus?.publish('spokes.flow', 'MAINNET_OBSERVED', { flow: f });
      this.log(`snapshot ok: ${resp.counts.displayed} spokes, ${snap.coverage.mainnetLedgersScanned} ledgers, ${snap.coverage.mainnetPaymentsMatched} payments, ${snap.tookMs} ms`);
      return snap;
    } catch (e) {
      const msg = e instanceof ProviderError ? e.message : `${e.message}`;
      Object.assign(this.state, { lastOk: false, lastError: msg, retryAfterMs: e.retryAfterSec ? Math.max(this.refreshMin * 60_000, e.retryAfterSec * 1000) : 0 });
      this.log(`refresh failed, serving cached snapshot: ${msg}`);
      return null;
    } finally {
      this.state.status = 'idle';
      if (!this.deps.reader) await reader.disconnect().catch(() => {});
    }
  }

  #roles() {
    const w = this.ledger?.wallets || {};
    const set = (...r) => new Set(r.map((k) => w[k]?.address).filter(Boolean));
    return { titan: set('maker'), rival: set('rival') };
  }
  #testnetRequest() {
    const l = this.ledger;
    if (!l?.client) return null;
    const READ = new Set(['book_offers']);
    return async (req) => {
      if (!READ.has(req.command)) throw new Error(`spokes: ${req.command} not allowed on Testnet`);
      if (!l.client.isConnected()) await l.connect();
      return l.client.request(req);
    };
  }

  response() {
    this.#reloadRuns(true);
    const r = assembleResponse(this.snap, { testnetFlows: this.testnetFlows, refreshMin: this.refreshMin, lastRefreshOk: this.state.lastOk });
    r.snapshot.lastError = this.state.lastError;
    r.snapshot.refreshing = this.state.status === 'refreshing';
    r.snapshot.nextRefreshAt = this.state.nextAt;
    return r;
  }

  allFlows() {
    const m = (this.snap?.mainnetFlows || []);
    return [...m, ...this.testnetFlows].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  detail(id) {
    const r = this.response();
    const spoke = [...r.groups.A.spokes, ...r.groups.B.spokes].find((s) => s.id === id);
    if (!spoke) return null;
    const transactions = this.allFlows().filter((f) => f.spokeIds.includes(id)).map(strip);
    return { spoke, transactions, snapshot: r.snapshot };
  }

  flows({ since = null, limit = 100 } = {}) {
    const n = Math.max(1, Math.min(500, Number(limit) || 100));
    const t = since ? Date.parse(since) : NaN;
    return this.allFlows().filter((f) => Number.isNaN(t) || Date.parse(f.at) > t).slice(0, n).map(strip);
  }

  replay() {
    if (this.snap?.replay) return buildReplay(this.snap.replay);
    return buildReplay(recordReplay({ mainnetFlows: [], testnetFlows: this.testnetFlows, spokes: [], recordedAt: null }));
  }
}

const strip = ({ fromKey, toKey, ...f }) => f;
