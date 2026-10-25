// LIVE_TESTNET qualification for the demo participants. READ-ONLY: only account_info, account_lines,
// book_offers and server_info at the validated ledger, via ctx.ledger. Nothing is signed or submitted.
// Demo accounts are controlled by Titan Forge: labeled demo, organic:false.
import { dropsToXrp } from 'xrpl';

export const LIVE_PARTICIPANTS = [
  { id: 'live-maker', role: 'maker', label: 'Demo maker account', category: 'pro_mm' },
  { id: 'live-rival', role: 'rival', label: 'Demo rival maker account', category: 'retail' },
];

const assetKey = (amt) => (typeof amt === 'string' ? 'XRP' : `${amt.currency}.${amt.issuer}`);
const amtValue = (amt) => (typeof amt === 'string' ? Number(dropsToXrp(amt)) : Number(amt.value));

// Pure: turn raw ledger responses into wallet snapshots + independent prices (USD per unit).
// offersByBook: [{ base: {currency, issuer}, asks: [rawOffer], bids: [rawOffer] }]  (asks sell base for XRP, bids buy base with XRP)
export function buildLiveSnapshot({ accounts, lines, offersByBook, reserveBaseXrp, reserveIncXrp, xrpUsd, linked }) {
  const linkedSet = new Set(linked);
  const wallets = accounts.map((a) => {
    const locked = reserveBaseXrp + a.ownerCount * reserveIncXrp;
    const balances = { XRP: Math.max(0, a.xrp - locked) };
    const other = {};
    for (const l of lines[a.address] || []) {
      const bal = Number(l.balance);
      if (bal > 0) balances[`${l.currency}.${l.account}`] = bal;
      else if (bal < 0) other[`${l.currency}.${l.account} (issued obligation)`] = -bal;
    }
    const offers = [];
    for (const b of offersByBook) for (const o of [...b.asks, ...b.bids]) {
      if (o.Account !== a.address) continue;
      const gets = o.taker_gets_funded ?? o.TakerGets; // what the account gives (funded by the server's view of this book)
      offers.push({ asset: assetKey(gets), amount: amtValue(gets), sequence: o.Sequence });
    }
    return { address: a.address, balances, offers, other, reserveLockedXrp: locked, xrpTotal: a.xrp };
  });
  // Prices: XRP at the illustrative rate; a token only at the best bid from an account outside the linked set.
  const prices = { XRP: xrpUsd };
  const valuation = {};
  for (const b of offersByBook) {
    const key = `${b.base.currency}.${b.base.issuer}`;
    let best = 0, by = null;
    for (const o of b.bids) {
      if (linkedSet.has(o.Account)) continue;
      const xrp = amtValue(o.taker_gets_funded ?? o.TakerGets), tok = amtValue(o.taker_pays_funded ?? o.TakerPays);
      if (tok > 0 && xrp > 0 && xrp / tok > best) { best = xrp / tok; by = o.Account; }
    }
    prices[key] = best > 0 ? best * xrpUsd : null;
    valuation[key] = best > 0 ? { bidXrp: best, by } : { bidXrp: null, by: null, note: 'No independent bid — only own quotes, so it counts at $0.' };
  }
  return { wallets, prices, valuation };
}

export async function measureLive(ledger, { roles, xrpUsd, codes = [] }) {
  await ledger.connect(); // asserts Testnet network_id
  const c = ledger.client;
  const info = (await c.request({ command: 'server_info' })).result.info;
  const vl = info.validated_ledger || {};
  const addresses = roles.map((r) => ledger.wallets[r]?.address).filter(Boolean);
  const accounts = [];
  const lines = {};
  for (const address of addresses) {
    const r = await c.request({ command: 'account_info', account: address, ledger_index: 'validated' }).catch(() => null);
    const d = r?.result.account_data;
    accounts.push({ address, xrp: d ? Number(dropsToXrp(d.Balance)) : 0, ownerCount: d?.OwnerCount ?? 0, unfunded: !d });
    lines[address] = d ? (await c.request({ command: 'account_lines', account: address, ledger_index: 'validated' })).result.lines : [];
  }
  const bases = new Map();
  const issuer = ledger.wallets.issuer?.address;
  for (const code of codes) if (issuer) bases.set(`${code}.${issuer}`, { currency: code, issuer });
  for (const ls of Object.values(lines)) for (const l of ls) bases.set(`${l.currency}.${l.account}`, { currency: l.currency, issuer: l.account });
  const offersByBook = [];
  for (const base of bases.values()) {
    const [asks, bids] = await Promise.all([
      c.request({ command: 'book_offers', taker_gets: base, taker_pays: { currency: 'XRP' }, ledger_index: 'validated', limit: 100 }),
      c.request({ command: 'book_offers', taker_gets: { currency: 'XRP' }, taker_pays: base, ledger_index: 'validated', limit: 100 }),
    ]);
    offersByBook.push({ base, asks: asks.result.offers, bids: bids.result.offers });
  }
  const snap = buildLiveSnapshot({ accounts, lines, offersByBook, reserveBaseXrp: Number(vl.reserve_base_xrp), reserveIncXrp: Number(vl.reserve_inc_xrp), xrpUsd, linked: addresses });
  return { ...snap, validatedLedger: vl.seq, networkId: info.network_id, reserveBaseXrp: Number(vl.reserve_base_xrp), reserveIncXrp: Number(vl.reserve_inc_xrp), books: offersByBook.map((b) => `${b.base.currency}`) };
}
