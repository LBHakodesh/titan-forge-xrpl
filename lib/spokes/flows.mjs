// Spokes: flow extraction.
//   MAINNET_OBSERVED: third-party Payment transactions read from validated Mainnet ledgers (read-only). Never ours, never
//     claimed as pathfinder-originated or organic; we only describe what the metadata shows.
//   LIVE_TESTNET: real Testnet payments from data/pathfinder-runs.json (demo-generated, organic:false), attributed with
//     the run scorecards (maker = titan, rival = rival).
import { getBalanceChanges } from 'xrpl';
import { assetKey, displayTicker, explorerUrl, ledgerCurrency } from './identity.mjs';

export const TF_PARTIAL_PAYMENT = 0x00020000;
const DROPS = 1_000_000;
const amtVal = (a) => (a == null ? null : typeof a === 'string' ? Number(a) / DROPS : Number(a.value));
const assetRef = (a) => (a == null ? null : typeof a === 'string' || (a.currency === 'XRP' && !a.issuer) ? { currency: 'XRP', issuer: null } : { currency: ledgerCurrency(a.currency), issuer: a.issuer ?? null });
const keyOf = (r) => (r.currency === 'XRP' ? 'XRP' : `${r.currency}.${r.issuer}`);
const r6 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e8) / 1e8);

// Consumed offers and AMM pools touched by a transaction (from metadata).
export function consumedLiquidity(meta, { balanceChanges = null } = {}) {
  const offers = [];
  const ammAccounts = new Set();
  for (const n of meta?.AffectedNodes || []) {
    const node = n.ModifiedNode || n.DeletedNode || n.CreatedNode;
    if (!node) continue;
    if (node.LedgerEntryType === 'Offer' && !n.CreatedNode) {
      const prev = node.PreviousFields || {};
      if (prev.TakerGets == null && prev.TakerPays == null) continue; // removed unfunded/expired, not consumed
      const ff = node.FinalFields || {};
      const gets = ff.TakerGets ?? prev.TakerGets, pays = ff.TakerPays ?? prev.TakerPays;
      offers.push({
        account: ff.Account, gets: keyOf(assetRef(gets)), pays: keyOf(assetRef(pays)),
        gotXrp: typeof gets === 'string' ? r6((Number(prev.TakerGets ?? gets) - Number(ff.TakerGets ?? 0)) / DROPS) : null,
      });
    }
    if (node.LedgerEntryType === 'AccountRoot' && (node.FinalFields?.AMMID || node.NewFields?.AMMID)) ammAccounts.add(node.FinalFields?.Account ?? node.NewFields?.Account);
    if (node.LedgerEntryType === 'AMM' && node.FinalFields?.Account) ammAccounts.add(node.FinalFields.Account);
  }
  // Which assets each AMM pool moved (XRP via AccountRoot balance, tokens via trustlines).
  const pools = [];
  if (ammAccounts.size) {
    const bc = balanceChanges ?? safeBalanceChanges(meta);
    for (const acct of ammAccounts) {
      const e = bc.find((x) => x.account === acct);
      const keys = (e?.balances || []).map((b) => (b.currency === 'XRP' ? 'XRP' : `${ledgerCurrency(b.currency)}.${b.issuer}`)).filter((k) => !k.startsWith('03'));
      pools.push({ account: acct, assets: [...new Set(keys)] });
    }
  }
  return { offers, pools };
}

function safeBalanceChanges(meta) { try { return getBalanceChanges(meta); } catch { return []; } }

// Was XRP used as a bridge between two non-XRP assets? true / false, or null when one side IS XRP (a hub leg).
export function inferXrpBridge(fromKey, toKey, liq) {
  if (fromKey === 'XRP' || toKey === 'XRP') return null;
  if (fromKey === toKey) return false;
  const legs = [...liq.offers.map((o) => [o.gets, o.pays]), ...liq.pools.map((p) => p.assets)];
  const touches = (k) => legs.some((l) => l.includes('XRP') && l.includes(k));
  return touches(fromKey) && touches(toKey);
}

export function roleOf(account, roles) {
  if (roles?.amm?.has?.(account)) return 'amm';
  if (roles?.titan?.has?.(account)) return 'titan';
  if (roles?.rival?.has?.(account)) return 'rival';
  return 'other';
}

// Analyze one Payment from a Mainnet ledger (api_version 1 or 2 shapes). spokeKeys: Map(assetKey -> spokeId).
// Returns null if not a successful Payment touching any spoke asset.
export function analyzePayment(entry, spokeKeys, { network = 'mainnet', ledgerIndex = null, closeTime = null } = {}) {
  const tx = entry.tx_json || entry.tx || entry;
  const meta = entry.meta || entry.metaData || tx.meta || tx.metaData;
  if (tx.TransactionType !== 'Payment' || !meta || meta.TransactionResult !== 'tesSUCCESS') return null;
  const deliverMax = tx.DeliverMax ?? tx.Amount;
  const delivered = meta.delivered_amount ?? meta.DeliveredAmount ?? deliverMax;
  if (delivered === 'unavailable') return null;
  const toRef = assetRef(delivered), fromRef = assetRef(tx.SendMax ?? deliverMax);
  if (!toRef || !fromRef || toRef.currency.startsWith?.('03') || fromRef.currency.startsWith?.('03')) return null;
  const fromKey = keyOf(fromRef), toKey = keyOf(toRef);
  const spokeIds = [...new Set([spokeKeys.get(fromKey), spokeKeys.get(toKey)].filter(Boolean))];
  if (!spokeIds.length) return null;

  const bc = safeBalanceChanges(meta);
  const liq = consumedLiquidity(meta, { balanceChanges: bc });
  const roles = { amm: new Set(liq.pools.map((p) => p.account)) };
  const owners = new Map();
  for (const o of liq.offers) if (o.account && !owners.has(o.account)) owners.set(o.account, { account: o.account, role: roleOf(o.account, roles) });
  for (const p of liq.pools) owners.set(p.account, { account: p.account, role: 'amm' });

  // Spent by the source in the source asset (fee excluded for XRP).
  const src = bc.find((x) => x.account === tx.Account);
  let spent = null;
  if (src) {
    const b = src.balances.find((x) => (fromRef.currency === 'XRP' ? x.currency === 'XRP' : ledgerCurrency(x.currency) === fromRef.currency && x.issuer === fromRef.issuer));
    if (b) spent = -Number(b.value) - (fromRef.currency === 'XRP' ? Number(tx.Fee || 0) / DROPS : 0);
    // A self-payment of the same asset nets to ~0; leave rate null then.
    if (tx.Account === tx.Destination && fromKey === toKey) spent = null;
  }
  const dv = amtVal(delivered);
  const hash = entry.hash || tx.hash;
  const ledger = entry.ledger_index ?? tx.ledger_index ?? ledgerIndex;
  return {
    hash, ledger, network, kind: 'MAINNET_OBSERVED', at: entry.close_time_iso ?? closeTime,
    from: { currency: fromRef.currency === 'XRP' ? 'XRP' : displayTicker(fromRef.currency), issuer: fromRef.issuer },
    to: { currency: toRef.currency === 'XRP' ? 'XRP' : displayTicker(toRef.currency), issuer: toRef.issuer },
    fromKey, toKey,
    viaXrp: inferXrpBridge(fromKey, toKey, liq),
    delivered: { value: r6(dv), currency: toRef.currency === 'XRP' ? 'XRP' : displayTicker(toRef.currency), issuer: toRef.issuer },
    rate: spent && spent > 0 && dv ? r6(dv / spent) : null,
    partial: (Number(tx.Flags || 0) & TF_PARTIAL_PAYMENT) !== 0,
    circular: tx.Account === tx.Destination,
    offersConsumed: liq.offers.length,
    amm: liq.pools.length > 0,
    offerOwners: [...owners.values()],
    depthAfter: null,
    explorer: explorerUrl(network, hash),
    spokeIds,
  };
}

// Scan recent validated Mainnet ledgers with a read-only reader. Budgeted by ledger count and wall-clock deadline.
export async function scanMainnetFlows(reader, spokeKeys, { ledgers = 40, deadlineMs = 50_000, maxMatches = 600, log = () => {} } = {}) {
  const t0 = Date.now();
  const si = await reader.request({ command: 'server_info' });
  const top = si.result.info.validated_ledger?.seq;
  if (!top) throw new Error('No validated ledger reported');
  const flows = [];
  let scanned = 0, paymentsSeen = 0, from = null, to = null, fromTime = null, toTime = null, stopReason = 'window complete';
  for (let i = 0; i < ledgers; i++) {
    if (Date.now() - t0 > deadlineMs) { stopReason = `deadline ${deadlineMs} ms reached`; break; }
    const seq = top - i;
    let r;
    try { r = await reader.request({ command: 'ledger', ledger_index: seq, transactions: true, expand: true }); }
    catch (e) { stopReason = `stopped at ledger ${seq}: ${e.message}`; log(stopReason); break; }
    const L = r.result.ledger;
    if (!r.result.validated && L.validated === false) continue;
    scanned++;
    to = to ?? seq; from = seq;
    const ct = L.close_time_iso ?? null;
    toTime = toTime ?? ct; fromTime = ct;
    for (const e of L.transactions || []) {
      const tx = e.tx_json || e;
      if (tx.TransactionType !== 'Payment') continue;
      paymentsSeen++;
      const f = analyzePayment(e, spokeKeys, { ledgerIndex: seq, closeTime: ct });
      if (f && flows.length < maxMatches) flows.push(f);
    }
  }
  return {
    flows: flows.sort((a, b) => b.ledger - a.ledger),
    coverage: { mainnetLedgersScanned: scanned, mainnetPaymentsMatched: flows.length, mainnetPaymentsSeen: paymentsSeen, from, to, fromTime, toTime, ms: Date.now() - t0, stopReason, node: reader.node ?? null },
  };
}

// LIVE_TESTNET flows from pathfinder runs (real Testnet hashes). testnetSpokes: Map(code -> spoke {id, issuer}).
export function testnetFlowsFromRuns(runsDoc, testnetSpokes) {
  const out = [];
  for (const run of runsDoc?.runs || []) {
    for (const p of run.payments || []) {
      if (p.status !== 'success' || !p.hash) continue;
      const side = (code) => (code === 'XRP' ? { currency: 'XRP', issuer: null } : { currency: code, issuer: testnetSpokes.get(code)?.issuer ?? null });
      const spokeIds = [p.from, p.to].filter((c) => c !== 'XRP' && testnetSpokes.has(c)).map((c) => testnetSpokes.get(c).id);
      if (!spokeIds.length) continue;
      const fills = p.attribution?.fills || [];
      const owners = new Map();
      for (const f of fills) if (!owners.has(f.owner)) owners.set(f.owner, { account: f.owner, role: f.bucket === 'maker' ? 'titan' : f.bucket === 'rival' ? 'rival' : 'other' });
      const tokOut = fills.filter((f) => f.code === p.to && f.side === 'ask').reduce((s, f) => s + Number(f.tokenQty || 0), 0);
      const tokIn = fills.filter((f) => f.code === p.from && f.side === 'bid').reduce((s, f) => s + Number(f.tokenQty || 0), 0);
      const deliveredVal = p.to === 'XRP' ? p.attribution?.deliveredXrp ?? null : tokOut || null;
      const spentVal = p.from === 'XRP' ? p.attribution?.spentXrp ?? null : tokIn || null;
      const cap = p.attribution?.capturedBy || {};
      out.push({
        hash: p.hash, ledger: p.ledger ?? null, network: 'testnet', kind: 'LIVE_TESTNET', at: p.at ?? null,
        from: side(p.from), to: side(p.to),
        viaXrp: p.from === 'XRP' || p.to === 'XRP' ? null : (p.attribution?.bridged ?? p.pathfind?.viaXrp ?? null),
        delivered: { value: r6(deliveredVal), currency: p.to, issuer: side(p.to).issuer },
        rate: deliveredVal && spentVal ? r6(deliveredVal / spentVal) : null,
        partial: false,
        offerOwners: [...owners.values()],
        depthAfter: null,
        explorer: p.explorer ?? explorerUrl('testnet', p.hash),
        spokeIds,
        runId: run.id, strategy: run.options?.strategy ?? null, organic: false,
        captured: { titanXrp: cap.maker ?? 0, rivalXrp: cap.rival ?? 0, otherXrp: cap.other ?? 0 },
        winner: p.attribution?.winner ?? null,
      });
    }
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// Per-spoke flow stats.
export function flowStats(spokeId, mainnetFlows, testnetFlows) {
  const m = mainnetFlows.filter((f) => f.spokeIds.includes(spokeId));
  const t = testnetFlows.filter((f) => f.spokeIds.includes(spokeId));
  let titan = 0, rival = 0, other = 0;
  for (const f of t) { titan += f.captured?.titanXrp || 0; rival += f.captured?.rivalXrp || 0; other += f.captured?.otherXrp || 0; }
  const tot = titan + rival + other;
  return {
    validated: m.length + t.length, mainnetObserved: m.length, liveTestnet: t.length,
    titanShare: t.length && tot ? Math.round((titan / tot) * 1e4) / 1e4 : null,
    rivalShare: t.length && tot ? Math.round((rival / tot) * 1e4) / 1e4 : null,
    bridged: m.filter((f) => f.viaXrp === true).length + t.filter((f) => f.viaXrp === true).length,
    ammInvolved: m.filter((f) => f.amm).length,
    partial: m.filter((f) => f.partial).length,
  };
}

export { assetKey };
