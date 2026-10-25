// Qualifying supported liquidity — pure, no I/O, unit-tested.
// Measures funded, executable liquidity supported by TGLW (not wealth):
//  - per asset, offered amounts are capped by the funded (spendable) balance, so one inventory backing
//    several overlapping offers counts once;
//  - balances not backing any offer, nominal token supply, hypothetical balances and traded volume are excluded;
//  - an asset with no independent valuation (only the participant's own quotes) counts at 0;
//  - linked wallets are aggregated (and de-duplicated) at the participant level.

const HOUR = 3_600_000;
const pos = (x) => (Number.isFinite(x) && x > 0 ? x : 0);

// wallet: { address, balances: { [asset]: spendableAmount }, offers: [{ asset, amount }], other?: { [asset]: amount } }
// prices: { [asset]: usdPerUnit | null }   (null/undefined -> no independent valuation)
export function measureWallet(wallet, prices = {}) {
  const offered = {};
  for (const o of wallet.offers || []) offered[o.asset] = (offered[o.asset] || 0) + pos(Number(o.amount));
  const assets = [];
  const excluded = [];
  for (const [asset, amt] of Object.entries(offered)) {
    const balance = pos(Number(wallet.balances?.[asset]));
    const counted = Math.min(amt, balance);
    const price = prices[asset];
    const valued = Number.isFinite(price) && price > 0;
    assets.push({
      asset, offered: amt, balance, counted, overlapExcluded: Math.max(0, amt - balance),
      usdPerUnit: valued ? price : 0, usd: valued ? counted * price : 0,
      valuation: valued ? 'independent' : 'none (no independent bid; own quotes do not count)',
    });
  }
  for (const [asset, amt] of Object.entries(wallet.balances || {})) {
    if (offered[asset] == null && pos(Number(amt)) > 0) excluded.push({ asset, amount: Number(amt), reason: 'Balance not backing any executable offer (unrelated wallet asset).' });
    else if (offered[asset] != null && Number(amt) > offered[asset]) excluded.push({ asset, amount: Number(amt) - offered[asset], reason: 'Balance beyond what is offered (idle, not supported liquidity).' });
  }
  for (const [asset, amt] of Object.entries(wallet.other || {})) excluded.push({ asset, amount: Number(amt), reason: 'Not qualifying (nominal supply / hypothetical / volume).' });
  const usd = assets.reduce((s, a) => s + a.usd, 0);
  return { address: wallet.address, assets, excluded, usd };
}

export function measureParticipant(wallets = [], prices = {}) {
  const seen = new Set();
  const out = [];
  const duplicates = [];
  for (const w of wallets) {
    if (seen.has(w.address)) { duplicates.push(w.address); continue; }
    seen.add(w.address);
    out.push(measureWallet(w, prices));
  }
  const usd = out.reduce((s, w) => s + w.usd, 0);
  const naiveOfferedUsd = out.reduce((s, w) => s + w.assets.reduce((t, a) => t + a.offered * a.usdPerUnit, 0), 0);
  return { wallets: out, usd, naiveOfferedUsd, overlapExcludedUsd: Math.max(0, naiveOfferedUsd - usd), duplicateWalletsIgnored: duplicates };
}

// Step-function time-weighted average over [now - window, now]. samples: [{ at: ms, usd }] ascending.
export function timeWeightedUsd(samples = [], { now = Date.now(), windowHours = 24 } = {}) {
  const s = samples.filter((x) => x.at <= now).sort((a, b) => a.at - b.at);
  if (!s.length) return 0;
  const start = now - windowHours * HOUR;
  let area = 0, covered = 0;
  for (let i = 0; i < s.length; i++) {
    const from = Math.max(s[i].at, start);
    const to = i + 1 < s.length ? s[i + 1].at : now;
    if (to <= from) continue;
    area += s[i].usd * (to - from);
    covered += to - from;
  }
  if (covered === 0) return s[s.length - 1].usd; // single sample at "now"
  return area / covered;
}

// Threshold status with grace. "Free up to the threshold": exactly at the threshold is free.
// Above it, status is 'grace' until it has been above for graceHours, then 'over'.
// Falling back to (or below) the threshold returns to 'free' immediately — volatility can only flap in the participant's favour.
export function statusFor({ qualifyingUsd, thresholdUsd, aboveSince = null, now = Date.now(), graceHours = 72 }) {
  if (!(qualifyingUsd > thresholdUsd)) return { status: 'free', aboveSince: null, graceEndsAt: null };
  const since = aboveSince ?? now;
  const ends = since + graceHours * HOUR;
  return { status: now >= ends ? 'over' : 'grace', aboveSince: since, graceEndsAt: ends };
}

// Smallest demo plan whose capacity covers the qualifying liquidity.
export function planOffer(qualifyingUsd, policy) {
  const plans = policy.plans.map((p) => ({ ...p, capacityUsd: Number.isFinite(p.capacityMultiple) ? p.capacityMultiple * policy.thresholdUsd : Infinity }));
  const pick = plans.find((p) => p.capacityUsd >= qualifyingUsd) || plans[plans.length - 1];
  return { planId: pick.id, label: pick.label, capacityUsd: Number.isFinite(pick.capacityUsd) ? pick.capacityUsd : null, monthlyUsdDemo: pick.monthlyUsdDemo, requestQuotaDemo: pick.requestQuotaDemo, freeCoveredUsd: policy.thresholdUsd, demo: true };
}

// Simulated participant wallets for a capital amount (SIMULATION only).
//   linkedWallets: split the inventory evenly across N linked wallets.
//   overlappingOffers: each wallet posts K offers, each backed by the wallet's full inventory.
export function simulatedWallets({ capitalUsd, linkedWallets = 1, overlappingOffers = 1, idPrefix = 'sim' }) {
  const n = Math.max(1, Math.min(50, Math.floor(linkedWallets)));
  const k = Math.max(1, Math.min(50, Math.floor(overlappingOffers)));
  const per = capitalUsd / n;
  return Array.from({ length: n }, (_, i) => ({
    address: `${idPrefix}-wallet-${i + 1}`,
    balances: { USD_SIM: per },
    offers: Array.from({ length: k }, () => ({ asset: 'USD_SIM', amount: per })),
  }));
}
