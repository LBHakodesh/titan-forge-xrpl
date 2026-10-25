// Spokes: assemble spoke records, 13 + 13 grouping and the GET /api/spokes response. Pure (no network).
import { spokeId, currencyFields, assetKey } from './identity.mjs';
import { bookSummary, round } from './market.mjs';
import { providerChecks, ledgerChecks, isEligible, check, ageDays, RULES } from './eligibility.mjs';
import { flowStats } from './flows.mjs';
import { corridorFor } from './corridor.mjs';
import { ATTRIBUTION, ATTRIBUTION_URL, ATTRIBUTION_HTML, PROVIDER } from './provider.mjs';

export const GROUP_SIZE = 13;
export const STATUSES = ['MAINNET_OBSERVED', 'TESTNET_FUNDED', 'TESTNET_CANDIDATE', 'SIMULATION', 'REPLAY', 'UNAVAILABLE'];
export const GROUP_TITLES = { A: 'Established', B: 'Emerging & project' };

const alertsFrom = (checks) => checks.filter((c) => !c.ok).map((c) => ({ severity: c.blocking ? 'high' : c.id === 'ticker_collision' ? 'info' : 'warn', text: c.detail, check: c.id }));

// market block for a Mainnet spoke from its reads ({issuer, asks, bids, amm}).
export function marketBlock(summary, amm, asset, observedAt, mode = 'MAINNET_OBSERVED') {
  return {
    mode,
    vol24hXrp: asset?.vol24hXrp ?? null,
    bid: summary?.bid != null ? round(summary.bid, 10) : null,
    ask: summary?.ask != null ? round(summary.ask, 10) : null,
    spreadBps: summary?.spreadBps ?? null,
    depthXrp: summary?.depthXrp ?? { bids: [], asks: [] },
    refPrice: summary?.refPrice != null ? round(summary.refPrice, 10) : null, refBasis: summary?.refBasis ?? null,
    offers: summary?.offers ?? null, makers: summary?.makers ?? null,
    amm: amm ? (amm.present ? { present: true, xrp: amm.xrp, token: amm.token, priceXrp: amm.priceXrp != null ? round(amm.priceXrp, 10) : null, account: amm.account, tradingFeeBps: amm.tradingFeeBps } : { present: false, xrp: 0, token: 0 }) : null,
    observedAt,
  };
}

// asset: parsed ranking record. read: { ok, error?, issuer, asks, bids, amm, at } or null (not read).
export function buildMainnetSpoke(asset, group, read, { scamSet = null, collisions = null, now = Date.now(), reason = null } = {}) {
  const checks = providerChecks(asset, { scamSet, collisions, now });
  let market = null, status = 'MAINNET_OBSERVED', issuer = null;
  if (!read) {
    checks.push(check('mainnet_read', false, 'Not read on Mainnet this snapshot (screened out earlier or read budget exhausted).'));
    status = 'UNAVAILABLE';
  } else if (!read.ok) {
    checks.push(check('mainnet_read', false, `Mainnet read failed: ${read.error}`));
    status = 'UNAVAILABLE';
  } else {
    issuer = read.issuer;
    const summary = bookSummary(read.asks, read.bids, read.amm);
    market = marketBlock(summary, read.amm, asset, read.at);
    checks.push(...ledgerChecks(read.issuer, summary, group));
    if (summary.uncrossableDropped) checks.push(check('book_consistency', false, `${summary.uncrossableDropped} crossed (uncrossable) CLOB offer(s) excluded from top of book and depth.`, false));
    if (summary.crossed) checks.push(check('book_consistency', false, `CLOB top of book is crossed (bid ${summary.bid} > ask ${summary.ask}); likely stale/unfunded offers. Spread withheld.`, false));
    if (summary.offers.asks === 0 || summary.offers.bids === 0) checks.push(check('clob_two_sided', false, `Order book is ${summary.offers.asks || summary.offers.bids ? 'one-sided' : 'empty'} on the CLOB (asks ${summary.offers.asks}, bids ${summary.offers.bids}); spread unavailable.`, false));
  }
  const age = ageDays(asset.listedAt, now);
  return {
    id: asset.id, group, rank: asset.rank, network: 'mainnet',
    currency: asset.currency, currencyHex: asset.currencyHex, issuer: asset.issuer, name: asset.name,
    status,
    eligibility: { eligible: status !== 'UNAVAILABLE' && isEligible(checks), checks },
    market: market ?? marketBlock(null, null, asset, null),
    testnet: null,
    corridor: null, flows: null,
    alerts: alertsFrom(checks),
    reason: reason ?? `Rank #${asset.rank} by 24h XRP volume on ${PROVIDER}; listed ${age ?? '?'} days ago.`,
    provider: { rank: asset.rank, rankedAt: asset.rankedAt, vol24hXrp: asset.vol24hXrp, vol24hTx: asset.vol24hTx, uniqueTraders24h: asset.uniqueTraders24h, tvlXrp: asset.tvlXrp, vol24hAmmXrp: asset.vol24hAmmXrp, vol24hOrderbookXrp: asset.vol24hOrderbookXrp, listedAt: asset.listedAt, verified: asset.verified, kyc: asset.kyc, issuerName: asset.issuerName, providerUpdatedAt: asset.providerUpdatedAt },
    issuerProfile: issuer,
  };
}

// launch: data/launches.json record. book: { ok, asks, bids, at } from a read-only Testnet book_offers, or null.
export function buildTestnetSpoke(launch, book, { roles = {} } = {}) {
  const funded = launch.status === 'live' && (launch.steps || []).some((s) => s.key === 'issue' && s.status === 'done' && s.result === 'tesSUCCESS');
  const status = funded ? 'TESTNET_FUNDED' : launch.status === 'failed' ? 'UNAVAILABLE' : 'TESTNET_CANDIDATE';
  const checks = [
    check('testnet_issuer', !!launch.issuer, launch.issuer ? `Issued on XRPL Testnet by the Titan Forge demo issuer ${launch.issuer}.` : 'No issuer recorded.'),
    check('launch_live', funded, funded ? 'Launch completed; supply issued (validated tesSUCCESS).' : `Launch status ${launch.status}.`),
    check('demo_only', true, 'Demo token: all controlled accounts are demo accounts (organic:false). Never mixed with Mainnet figures.', false),
  ];
  let market = marketBlock(null, null, null, null, 'LIVE_TESTNET');
  let tbook = null;
  if (book?.ok) {
    const summary = bookSummary(book.asks, book.bids, null);
    market = marketBlock(summary, null, null, book.at, 'LIVE_TESTNET');
    const role = (a) => (roles.titan?.has(a) ? 'titan' : roles.rival?.has(a) ? 'rival' : 'other');
    tbook = {
      source: 'testnet_book_offers', at: book.at,
      asks: book.asks.slice(0, 10).map((o) => ({ account: o.account, role: role(o.account), qty: round(o.token, 6), priceXrp: round(o.price, 10) })),
      bids: book.bids.slice(0, 10).map((o) => ({ account: o.account, role: role(o.account), qty: round(o.token, 6), priceXrp: round(o.price, 10) })),
    };
    checks.push(check('two_sided_book', summary.offers.asks > 0 && summary.offers.bids > 0, `Testnet book now: ${summary.offers.asks} funded asks, ${summary.offers.bids} funded bids.`, false));
  } else {
    tbook = launch.book ? { source: 'launch_record', at: launch.completedAt ?? null, ...launch.book } : null;
    checks.push(check('two_sided_book', false, `Live Testnet book not read${book?.error ? `: ${book.error}` : ''}; showing the launch record.`, false));
  }
  const cf = currencyFields(launch.code);
  return {
    id: spokeId('testnet', launch.code, launch.issuer), group: 'B', rank: null, network: 'testnet',
    currency: cf.currency, currencyHex: cf.currencyHex, issuer: launch.issuer, name: launch.name,
    status,
    eligibility: { eligible: isEligible(checks), checks },
    market,
    testnet: { code: launch.code, issuer: launch.issuer, funded, book: tbook, launchId: launch.id, organic: false },
    corridor: null, flows: null,
    alerts: alertsFrom(checks),
    reason: `Titan Forge project token live on XRPL Testnet (launch ${launch.createdAt?.slice(0, 10) ?? ''}); demo-funded, organic:false.`,
  };
}

export function placeholder(group, slot, why = 'Discovery yielded fewer eligible assets than slots.') {
  return {
    id: `placeholder:${group}:${slot}`, group, rank: null, network: 'mainnet', currency: null, currencyHex: null, issuer: null,
    name: 'Unfilled slot (placeholder)', status: 'UNAVAILABLE', placeholder: true,
    eligibility: { eligible: false, checks: [check('placeholder', false, why)] },
    market: marketBlock(null, null, null, null), testnet: null, corridor: null, flows: null,
    alerts: [{ severity: 'info', text: `Placeholder: ${why}` }], reason: why,
  };
}

// Pick spokes for a group: eligible first (rank order), then flagged ones, then placeholders. Always exactly `size`.
export function fillGroup(group, fixed, pool, size = GROUP_SIZE) {
  const out = [...fixed];
  const elig = pool.filter((s) => s.eligibility.eligible);
  const flagged = pool.filter((s) => !s.eligibility.eligible && s.status !== 'UNAVAILABLE');
  const add = [];
  for (const s of [...elig, ...flagged]) { if (out.length + add.length >= size) break; if (!out.some((x) => x.id === s.id) && !add.some((x) => x.id === s.id)) add.push(s); }
  out.push(...add.sort((x, y) => (x.rank ?? 1e9) - (y.rank ?? 1e9)));
  let slot = out.length;
  while (out.length < size) out.push(placeholder(group, ++slot));
  return out.slice(0, size).map((s) => ({ ...s, group }));
}

export const spokeKeyMap = (spokes) => {
  const m = new Map();
  for (const s of spokes) if (!s.placeholder && s.network === 'mainnet' && s.issuer) m.set(assetKey({ currency: s.currencyHex || s.currency, issuer: s.issuer }), s.id);
  return m;
};

export function countStatuses(spokes) {
  const c = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const s of spokes) c[s.status] = (c[s.status] || 0) + 1;
  return { displayed: spokes.filter((s) => !s.placeholder).length, ...c, eligible: spokes.filter((s) => s.eligibility.eligible).length };
}

export function freshnessOf(snap, { now = Date.now(), refreshMin = 30, lastRefreshOk = false } = {}) {
  if (!snap?.fetchedAt) return { freshness: 'unavailable', ageSec: null };
  const ageSec = Math.max(0, Math.round((now - Date.parse(snap.fetchedAt)) / 1000));
  return { freshness: lastRefreshOk && ageSec <= refreshMin * 120 ? 'live' : 'cached', ageSec };
}

// Final GET /api/spokes response from a persisted snapshot + live Testnet flows.
export function assembleResponse(snap, { testnetFlows = [], now = Date.now(), refreshMin = 30, lastRefreshOk = false, engine } = {}) {
  const fr = freshnessOf(snap, { now, refreshMin, lastRefreshOk });
  const mainnetFlows = snap?.mainnetFlows || [];
  const raw = { A: snap?.groups?.A || [], B: snap?.groups?.B || [] };
  const groups = { A: fillGroup('A', [], raw.A), B: fillGroup('B', raw.B.filter((s) => s.network === 'testnet'), raw.B.filter((s) => s.network !== 'testnet')) };
  const all = [...groups.A, ...groups.B];
  for (const s of all) s.flows = s.placeholder ? { validated: 0, mainnetObserved: 0, liveTestnet: 0, titanShare: null, rivalShare: null } : flowStats(s.id, mainnetFlows, testnetFlows);
  const cor = corridorFor(all, { xrpUsd: snap?.xrpUsd ?? null, engine });
  for (const s of all) {
    s.corridor = cor.get(s.id);
    if (fr.freshness !== 'live' && s.network === 'mainnet' && !s.placeholder) s.alerts = [...s.alerts, { severity: 'info', text: `Mainnet figures are from a ${fr.freshness} snapshot (${fr.ageSec ?? '?'} s old).` }];
  }
  const cov = snap?.coverage || {};
  return {
    hub: { currency: 'XRP' },
    snapshot: {
      source: PROVIDER, fetchedAt: snap?.fetchedAt ?? null, freshness: fr.freshness, ageSec: fr.ageSec,
      attribution: ATTRIBUTION, attributionUrl: ATTRIBUTION_URL, attributionHtml: ATTRIBUTION_HTML, refreshMin,
      rankingTotal: snap?.provider?.total ?? null, lastError: snap?.lastError ?? null,
    },
    groups: { A: { title: GROUP_TITLES.A, spokes: groups.A }, B: { title: GROUP_TITLES.B, spokes: groups.B } },
    counts: countStatuses(all),
    coverage: { mainnetLedgersScanned: cov.mainnetLedgersScanned ?? 0, mainnetPaymentsMatched: cov.mainnetPaymentsMatched ?? 0, from: cov.from ?? null, to: cov.to ?? null, fromTime: cov.fromTime ?? null, toTime: cov.toTime ?? null, mainnetPaymentsSeen: cov.mainnetPaymentsSeen ?? 0, stopReason: cov.stopReason ?? null, liveTestnetPayments: testnetFlows.length },
    screenedOut: snap?.screenedOut || [],
    rules: RULES,
    labels: { MAINNET_OBSERVED: 'Read-only XRPL Mainnet observation (third-party activity; not Titan Forge, not claimed organic or pathfinder-originated).', LIVE_TESTNET: 'Real XRPL Testnet transactions by Titan Forge demo accounts (organic:false).', SIMULATION: 'Modeled corridor stage and engine output; nothing allocated.', REPLAY: 'Deterministic replay of a recorded sequence.' },
  };
}
