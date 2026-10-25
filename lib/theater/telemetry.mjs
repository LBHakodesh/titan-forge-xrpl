// Real telemetry for the Theater, derived (pure) from recorded data. No invented values:
//   liveTelemetry(runs)   <- Pathfinder runs (ctx.pathfinder.runs()): validated XRPL Testnet payments between OUR demo
//                            accounts (LIVE_TESTNET, organic:false). Every figure carries its tx hashes or counts.
//   mainnetSummary(prof)  <- data/mainnet-profile.json: third-party Mainnet sample (MAINNET_OBSERVED, never mixed in).
const r6 = (x) => Math.round(x * 1e6) / 1e6;

export function liveTelemetry(runs = []) {
  const pays = [];
  for (const r of runs || []) for (const p of r.payments || []) if (p.status === 'success' && p.hash) pays.push({ run: r, p });
  const routeMix = {}, byCode = {}, bySide = { bid: 0, ask: 0 };
  let edgeXrp = 0, makerFills = 0, makerXrp = 0, totalXrp = 0, bridged = 0, execBps = [], feeXrp = 0, rivalXrp = 0;
  const fills = [];
  for (const { run, p } of pays) {
    routeMix[p.route || 'unknown'] = (routeMix[p.route || 'unknown'] || 0) + 1;
    const a = p.attribution || {};
    if (a.bridged) bridged++;
    if (Number.isFinite(a.execBpsVsMid)) execBps.push(a.execBpsVsMid);
    totalXrp += a.totalXrp || 0; rivalXrp += a.capturedBy?.rival || 0;
    for (const f of a.fills || []) {
      if (f.role !== 'maker') continue;
      makerFills++; makerXrp += f.xrp || 0;
      if (Number.isFinite(f.edgeXrp)) { edgeXrp += f.edgeXrp; byCode[f.code] = (byCode[f.code] || 0) + f.edgeXrp; bySide[f.side] = (bySide[f.side] || 0) + f.edgeXrp; }
      fills.push({ mode: 'LIVE_TESTNET', hash: p.hash, at: p.at, code: f.code, side: String(f.side || '').toUpperCase(), xrp: r6(f.xrp || 0), priceXrp: f.priceXrp, edgeXrp: Number.isFinite(f.edgeXrp) ? r6(f.edgeXrp) : null, mid: run.mids?.[f.code] ?? null, explorer: p.explorer });
    }
  }
  // run.feeXrp is the per-transaction network fee the run observed; count every validated tx the run signed.
  let feeTxs = 0, makerFeeXrp = 0;
  for (const r of runs || []) {
    if (!Number.isFinite(r.feeXrp)) continue;
    const n = (r.payments || []).filter((p) => p.hash).length + (r.actions || []).filter((a) => a.hash).length;
    feeTxs += n; feeXrp += n * r.feeXrp;
    makerFeeXrp += (r.actions || []).filter((a) => a.hash && a.role === 'maker').length * r.feeXrp;
  }
  const recent = pays.slice(-8).reverse().map(({ p }) => ({ mode: 'LIVE_TESTNET', hash: p.hash, at: p.at, route: p.route, from: p.from, to: p.to, sizeXrp: p.sizeXrp, viaXrp: !!(p.attribution?.bridged || p.pathfind?.viaXrp), execBpsVsMid: p.attribution?.execBpsVsMid ?? null, winner: p.attribution?.winner ?? null, explorer: p.explorer }));
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  return {
    mode: 'LIVE_TESTNET', organic: false,
    note: 'Validated XRPL Testnet payments between Titan Forge demo accounts (organic:false). Real ledger results, not market demand.',
    payments: pays.length, runs: (runs || []).length,
    quoter: { makerFills, makerXrp: r6(makerXrp), makerShare: totalXrp ? r6(makerXrp / totalXrp) : null, rivalXrp: r6(rivalXrp), avgExecBpsVsMid: avg(execBps), source: 'temporary demo quoter on Testnet (not the authentic Rust Quoter)' },
    routing: { routeMix, bridgedViaXrp: bridged, recent },
    fees: { networkFeesXrp: r6(feeXrp), makerFeesXrp: r6(makerFeeXrp), txs: feeTxs, basis: 'validated demo transactions (payments + maker offers) × the per-tx network fee each run recorded' },
    pnl: { status: makerFills ? 'attributable_vs_mid' : 'not_attributable', spreadCaptureXrp: r6(edgeXrp), byCode: Object.fromEntries(Object.entries(byCode).map(([k, v]) => [k, r6(v)])), bySide: { BID: r6(bySide.bid || 0), ASK: r6(bySide.ask || 0) }, netAfterMakerFeesXrp: r6(edgeXrp - makerFeeXrp),
      basis: 'Maker edge vs the recorded mid at fill time (attribution.fills[].edgeXrp). Demo wallets trading each other: a mechanics check, not profit.' },
    fills: fills.slice(-20).reverse(),
  };
}

export function mainnetSummary(p) {
  if (!p || !p.totals) return { mode: 'MAINNET_OBSERVED', status: 'unavailable' };
  return { mode: 'MAINNET_OBSERVED', note: p.note, sampledAt: p.sampledAt, window: { ledgers: p.window?.ledgers, seconds: p.window?.seconds, fromLedger: p.window?.fromLedger, toLedger: p.window?.toLedger },
    totals: { txs: p.totals.txs, payments: p.totals.payments, pathfound: p.totals.pathfound, partial: p.totals.partial, pathfoundShareOfPayments: p.totals.pathfoundShareOfPayments },
    offerCreate: p.offerCreate || null, routeMix: p.pathfoundAll?.routeMix || null };
}
