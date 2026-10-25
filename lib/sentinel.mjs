// Titan Sentinel: read-only security inspection of launched demo tokens on XRPL Testnet.
// Every ledger call here is a read (account_info, account_lines, account_objects, gateway_balances,
// book_offers, account_tx, tx). Nothing is signed or submitted.
// Findings: { id, severity: info|low|medium|high, title, evidence, whatItProtects, limits, mode, links? }
import { validateLaunch } from './validate.mjs';
import { guardCheck } from './guardian.mjs';

export const MODE = 'LIVE_TESTNET';
export const SEVERITIES = ['high', 'medium', 'low', 'info'];
const TX_URL = 'https://testnet.xrpl.org/transactions/';
const ACCT_URL = 'https://testnet.xrpl.org/accounts/';
const SECONDS_PER_LEDGER = 3.9; // approximate Testnet close interval, used only for offer age estimates
export const STALE_OFFER_HOURS = 24;

// ---------- Pure helpers (unit-tested) ----------

// AccountRoot flags (lsf*). Values from the XRPL protocol definitions.
export const ACCOUNT_FLAGS = {
  RequireDestTag: 0x00020000,
  RequireAuth: 0x00040000,
  DisallowXRP: 0x00080000,
  DisableMaster: 0x00100000,
  NoFreeze: 0x00200000,
  GlobalFreeze: 0x00400000,
  DefaultRipple: 0x00800000,
  DepositAuth: 0x01000000,
  AllowTrustLineClawback: 0x80000000,
};

export function decodeAccountFlags(flags = 0) {
  const n = Number(flags) >>> 0;
  return Object.fromEntries(Object.entries(ACCOUNT_FLAGS).map(([k, bit]) => [k, (n & bit) >>> 0 === bit]));
}

// XRP drops string or issued-currency object -> number of units.
export function amountValue(a) {
  if (a == null) return 0;
  if (typeof a === 'string') return Number(a) / 1e6;
  return Number(a.value);
}

// Herfindahl–Hirschman index on 0..10000 scale from raw quantities.
export function hhi(quantities) {
  const vals = quantities.map(Number).filter((v) => v > 0);
  const total = vals.reduce((s, v) => s + v, 0);
  if (!total) return 0;
  return Math.round(vals.reduce((s, v) => s + ((v / total) * 100) ** 2, 0));
}

export function shares(entries) { // [{key, qty}] -> sorted [{key, qty, share}]
  const total = entries.reduce((s, e) => s + e.qty, 0);
  return entries.filter((e) => e.qty > 0).map((e) => ({ ...e, share: total ? e.qty / total : 0 })).sort((a, b) => b.qty - a.qty);
}

export function levenshtein(a, b) {
  a = String(a); b = String(b);
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

// Visually confusable characters folded to a canonical Latin letter.
const HOMOGLYPHS = {
  '0': 'o', '1': 'l', 'i': 'l', '|': 'l', '!': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '2': 'z', '6': 'g', '9': 'g', '$': 's', '@': 'a',
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'к': 'k', 'м': 'm', 'т': 't', 'в': 'b', 'н': 'h', 'і': 'l', 'ј': 'j', 'ѕ': 's',
  'α': 'a', 'ο': 'o', 'ρ': 'p', 'ε': 'e', 'ι': 'l', 'κ': 'k', 'ν': 'v', 'τ': 't', 'υ': 'u', 'χ': 'x',
};
export function skeleton(s) {
  const base = String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let out = '';
  for (const ch of base) out += HOMOGLYPHS[ch] ?? ch;
  return out.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/[^a-z0-9]/g, '');
}

// Compare two launches' identities. Returns null if not similar.
export function identityCollision(a, b) {
  const reasons = [];
  let severity = null;
  const bump = (s) => { if (!severity || SEVERITIES.indexOf(s) < SEVERITIES.indexOf(severity)) severity = s; };
  const ca = String(a.code), cb = String(b.code);
  if (ca.toUpperCase() === cb.toUpperCase()) { reasons.push(`Ticker ${ca} matches ${cb} (case-insensitive)`); bump('high'); }
  else if (skeleton(ca) === skeleton(cb)) { reasons.push(`Ticker ${ca} is a homoglyph of ${cb}`); bump('high'); }
  else if (levenshtein(ca.toUpperCase(), cb.toUpperCase()) === 1) { reasons.push(`Ticker ${ca} is one character from ${cb}`); bump('low'); }
  const na = String(a.name ?? ''), nb = String(b.name ?? '');
  if (na && nb) {
    const sa = skeleton(na), sb = skeleton(nb);
    if (na.toLowerCase() === nb.toLowerCase()) { reasons.push(`Name "${na}" matches "${nb}" (case-insensitive)`); bump('high'); }
    else if (sa && sa === sb) { reasons.push(`Name "${na}" is visually confusable with "${nb}"`); bump('high'); }
    else {
      const d = levenshtein(sa, sb), ratio = d / Math.max(sa.length, sb.length, 1);
      if (d <= 2 && ratio <= 0.25) { reasons.push(`Name "${na}" is ${d} edit(s) from "${nb}"`); bump('medium'); }
    }
  }
  return reasons.length ? { other: b.code, otherName: b.name, severity, reasons } : null;
}

// Impersonation: reuse the launch policy in validate.mjs on the raw and homoglyph-folded identity.
export function impersonationIssues(launch) {
  const probe = (name, description, alias) => validateLaunch({ name, code: launch.code, supply: 1000, category: 'community', description, alias, consent: true });
  const issues = new Set();
  const keep = (e) => /reserved|isn't allowed/.test(e);
  for (const e of (probe(launch.name, launch.description ?? '', launch.alias ?? '').errors || [])) if (keep(e)) issues.add(e);
  // Folded variant catches look-alikes such as "R1pple" or "Coinbаse" (Cyrillic а).
  // '1', '|' and '!' are ambiguous (i or l), so try both readings; letters themselves are left alone.
  for (const one of ['i', 'l']) {
    const map = { ...HOMOGLYPHS, '1': one, '|': one, '!': one, i: 'i' };
    const fold = (s) => [...String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()].map((c) => map[c] ?? c).join('');
    const r = probe(fold(launch.name) || 'xx', fold(launch.description), '');
    for (const e of (r.errors || [])) if (/isn't allowed/.test(e)) issues.add(`Look-alike: ${e}`);
  }
  return [...issues];
}

// Book offer -> normalized {account, side, qtyToken, xrp, fundedRatio, ageLedgers, seq}
export function normalizeOffer(o, side, validatedLedger) {
  const gets = amountValue(o.TakerGets);
  const funded = o.taker_gets_funded != null ? amountValue(o.taker_gets_funded) : gets;
  const pays = amountValue(o.TakerPays);
  const fundedRatio = gets > 0 ? Math.min(1, funded / gets) : 0;
  const tokenQty = side === 'ask' ? gets : pays;
  const xrp = side === 'ask' ? pays : gets;
  const ageLedgers = validatedLedger && o.PreviousTxnLgrSeq ? Math.max(0, validatedLedger - o.PreviousTxnLgrSeq) : null;
  return { account: o.Account, side, seq: o.Sequence, tokenQty, xrp, fundedXrp: xrp * fundedRatio, fundedRatio, ownerFunds: o.owner_funds ?? null, ageLedgers, ageHours: ageLedgers == null ? null : (ageLedgers * SECONDS_PER_LEDGER) / 3600, prevTx: o.PreviousTxnID };
}

export function offerHealth(offers) {
  const unfunded = offers.filter((o) => o.fundedRatio < 0.999);
  const stale = offers.filter((o) => o.ageHours != null && o.ageHours > STALE_OFFER_HOURS);
  return { unfunded, stale };
}

// Depth concentration by account (funded XRP value) and the share lost if the top provider cancels.
export function bookConcentration(offers) {
  const by = new Map();
  for (const o of offers) by.set(o.account, (by.get(o.account) || 0) + o.fundedXrp);
  const list = shares([...by].map(([key, qty]) => ({ key, qty })));
  const total = list.reduce((s, e) => s + e.qty, 0);
  return { totalXrp: total, providers: list, hhi: hhi(list.map((e) => e.qty)), withdrawalExposure: list[0]?.share ?? 0, top: list[0]?.key ?? null };
}

// Trades from a tx's metadata: offers owned by someone else that were consumed for this currency.
export function tradesFromTx(txr, code, controlled) {
  const tx = txr.tx_json ?? txr.tx ?? txr;
  const meta = txr.meta ?? txr.metaData;
  const hash = txr.hash ?? tx.hash;
  if (!meta || typeof meta !== 'object' || meta.TransactionResult !== 'tesSUCCESS') return null;
  if (!['OfferCreate', 'Payment'].includes(tx.TransactionType)) return null;
  const makers = [];
  let tokenQty = 0;
  for (const n of meta.AffectedNodes || []) {
    const node = n.ModifiedNode || n.DeletedNode;
    if (!node || node.LedgerEntryType !== 'Offer') continue;
    const ff = node.FinalFields || {}, pf = node.PreviousFields || {};
    if (!ff.Account || ff.Account === tx.Account) continue;
    const cur = [ff.TakerGets, ff.TakerPays].find((a) => typeof a === 'object' && a?.currency === code);
    if (!cur) continue;
    const isAsk = typeof ff.TakerGets === 'object' && ff.TakerGets.currency === code;
    const before = pf[isAsk ? 'TakerGets' : 'TakerPays'];
    if (!before && n.ModifiedNode) continue; // offer touched but not consumed
    const after = ff[isAsk ? 'TakerGets' : 'TakerPays'];
    const qty = before ? amountValue(before) - amountValue(after) : 0;
    if (before && qty <= 0) continue;
    tokenQty += qty;
    makers.push(ff.Account);
  }
  if (!makers.length) return null;
  const parties = [tx.Account, ...makers];
  const isControlled = parties.every((a) => controlled.has(a));
  return { hash, taker: tx.Account, makers: [...new Set(makers)], tokenQty, controlled: isControlled, ledger: txr.ledger_index ?? tx.ledger_index, explorer: TX_URL + hash };
}

export function verifyStep(step, txr) {
  if (!txr) return { key: step.key, hash: step.hash, ok: false, validated: false, result: null, error: 'not found' };
  const result = txr.meta?.TransactionResult ?? null;
  const ledger = txr.ledger_index ?? null;
  const ok = txr.validated === true && result === 'tesSUCCESS' && (step.ledger == null || ledger === step.ledger);
  return { key: step.key, label: step.label, hash: step.hash, recordedResult: step.result, recordedLedger: step.ledger, validated: txr.validated === true, result, ledger, type: (txr.tx_json ?? txr).TransactionType, ok, explorer: TX_URL + step.hash };
}

const f = (id, severity, title, evidence, whatItProtects, limits, extra = {}) => ({ id, severity, title, evidence, whatItProtects, limits, mode: MODE, ...extra });
const pct = (x) => `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`;
const roleOf = (addr, roles) => Object.entries(roles).find(([, a]) => a === addr)?.[0] ?? 'external';

// ---------- Analysis from fetched data (pure; data comes from Sentinel.fetch or fixtures) ----------
export function analyze(d) {
  const { launch, launches = [], roles, controlled = new Set(Object.values(roles)) } = d;
  const code = launch.code;
  const findings = [];
  const issuer = d.accounts.issuer;
  const fl = decodeAccountFlags(issuer.account_data?.Flags);
  const issuerLink = [{ label: 'issuer', href: ACCT_URL + roles.issuer }];

  // Issuer configuration
  findings.push(fl.DefaultRipple
    ? f('issuer.default_ripple', 'info', 'DefaultRipple is on', `Issuer ${roles.issuer} Flags=0x${(issuer.account_data.Flags >>> 0).toString(16)}: lsfDefaultRipple set.`,
      'Holders can transfer and trade the token with each other through the issuer, which the order book needs.',
      'Rippling also lets balances move through the issuer on payment paths; holders who only want to hold can set NoRipple on their side.', { links: issuerLink })
    : f('issuer.default_ripple', 'medium', 'DefaultRipple is off', 'lsfDefaultRipple not set on issuer.',
      'Without it, holder-to-holder transfers and DEX trades of the token fail or need per-line ripple settings.', 'This is a usability issue, not a theft risk.', { links: issuerLink }));
  if (fl.GlobalFreeze) findings.push(f('issuer.global_freeze', 'high', 'Global freeze is active', 'lsfGlobalFreeze set on issuer.', 'Holders are warned that the token cannot currently be sent or traded except back to the issuer.', 'Sentinel only reports; it cannot lift a freeze.', { links: issuerLink }));
  findings.push(fl.NoFreeze
    ? f('issuer.freeze', 'info', 'Issuer permanently gave up freeze (NoFreeze)', 'lsfNoFreeze set.', 'Holders know the issuer can never freeze their trustlines or the whole token.', 'NoFreeze does not stop clawback (if enabled earlier) or a compromised issuer key issuing more supply.', { links: issuerLink })
    : f('issuer.freeze', 'low', 'Issuer can freeze holders', 'lsfNoFreeze not set: the issuer may freeze individual trustlines or enable GlobalFreeze at any time.', 'Freeze is a compliance tool; disclosing it tells holders their balance can be locked (still visible, not seizable by freeze alone).', 'Sentinel cannot prevent a future freeze; it can only detect one after it is validated.', { links: issuerLink }));
  findings.push(fl.AllowTrustLineClawback
    ? f('issuer.clawback', 'high', 'Issuer can claw back holder balances', 'lsfAllowTrustLineClawback set: the issuer may submit Clawback to pull tokens out of any holder line.', 'Holders are warned that balances are revocable by the issuer.', 'The flag is permanent once set; Sentinel cannot block a Clawback transaction.', { links: issuerLink })
    : f('issuer.clawback', 'info', 'Clawback is not enabled', 'lsfAllowTrustLineClawback not set. It can only be enabled while the issuer owns no ledger objects, so it cannot be turned on after holders exist.', 'Holder balances cannot be clawed back by the issuer.', 'Does not protect against freeze, unlimited further issuance or issuer key compromise.', { links: issuerLink }));
  findings.push(fl.RequireAuth
    ? f('issuer.require_auth', 'info', 'RequireAuth is on: holders need issuer approval', 'lsfRequireAuth set.', 'Only issuer-authorized trustlines can hold the token (allow-listing).', 'Authorization can be granted, but once granted it cannot be revoked by the issuer.', { links: issuerLink })
    : f('issuer.require_auth', 'info', 'RequireAuth is off: anyone can hold', 'lsfRequireAuth not set.', 'Open participation; no allow-list to manage.', 'Anyone, including impersonators or sanctioned parties, can open a trustline and receive the token.', { links: issuerLink }));

  // Key control and delegation for every account we control
  for (const [role, addr] of Object.entries(roles)) {
    const a = d.accounts[role];
    if (!a?.account_data) { findings.push(f(`keys.${role}`, 'low', `Could not read ${role} account`, a?.error || 'account_info failed', '—', 'Key-control checks skipped for this account.')); continue; }
    const af = decodeAccountFlags(a.account_data.Flags);
    const rk = a.account_data.RegularKey;
    const signerLists = a.signer_lists ?? a.account_data.signer_lists ?? [];
    const link = [{ label: role, href: ACCT_URL + addr }];
    const parts = [`master key ${af.DisableMaster ? 'disabled' : 'enabled'}`, rk ? `RegularKey ${rk}` : 'no RegularKey', signerLists.length ? `SignerList quorum ${signerLists[0].SignerQuorum} of ${(signerLists[0].SignerEntries || []).length} signers` : 'no SignerList'];
    let sev = 'low', title = `${role}: single-key control`;
    if (rk) { sev = 'medium'; title = `${role}: a RegularKey can also sign`; }
    else if (signerLists.length && af.DisableMaster) { sev = 'info'; title = `${role}: multi-signature only`; }
    else if (signerLists.length) { sev = 'low'; title = `${role}: SignerList present, master key still enabled`; }
    findings.push(f(`keys.${role}`, sev, title, parts.join('; ') + '.',
      rk ? 'A RegularKey lets the master key stay offline, but anyone holding the regular key can sign everything except master-only actions.' : 'Knowing exactly which keys can sign shows holders who controls the account.',
      `Sentinel sees key configuration, not key custody: it cannot tell whether a key is stored safely or already compromised.${role !== 'issuer' ? ' Demo account; seeds stay server-side.' : ''}`, { links: link }));
    const objs = a.objects || [];
    const types = {};
    for (const o of objs) types[o.LedgerEntryType] = (types[o.LedgerEntryType] || 0) + 1;
    const delegates = objs.filter((o) => o.LedgerEntryType === 'Delegate');
    const known = new Set(['RippleState', 'Offer', 'SignerList', 'Delegate', 'DirectoryNode', 'Ticket', 'NFTokenPage', 'NFTokenOffer', 'Check', 'Escrow', 'PayChannel', 'DepositPreauth', 'AMM', 'DID', 'Oracle', 'MPToken', 'MPTokenIssuance', 'Credential', 'PermissionedDomain', 'Vault', 'LoanBroker', 'Loan']);
    const unknown = Object.keys(types).filter((t) => !known.has(t));
    if (delegates.length) {
      findings.push(f(`delegate.${role}`, 'medium', `${role}: permissions delegated to another account`, delegates.map((o) => `Delegate to ${o.Authorize}: ${(o.Permissions || []).map((p) => p.Permission?.PermissionValue ?? JSON.stringify(p)).join(', ')}`).join('; '), 'Shows every outside account that can submit transactions on this account\'s behalf.', 'Sentinel lists delegations; it cannot judge whether the delegate is trustworthy.', { links: link }));
    } else if (a.objectsError) {
      findings.push(f(`delegate.${role}`, 'info', `${role}: delegation objects not readable`, a.objectsError, 'Would list delegated permissions.', 'Delegation status unknown for this account.', { links: link }));
    } else if (role === 'issuer' || unknown.length) {
      findings.push(f(`delegate.${role}`, 'info', `${role}: no delegated permissions found`, `account_objects: ${Object.entries(types).map(([t, n]) => `${t}×${n}`).join(', ') || 'none'}${unknown.length ? `; unrecognized types reported as-is: ${unknown.join(', ')}` : ''}.`, 'No Delegate entries let another account act for this one.', 'Only covers on-ledger delegation; off-ledger key sharing is invisible to Sentinel.', { links: link }));
    }
  }

  // Trustlines of holders (issuer's view)
  const lines = (d.issuerLines || []).filter((l) => l.currency === code);
  const holders = lines.map((l) => ({ account: l.account, role: roleOf(l.account, roles), balance: -Number(l.balance), limit: Number(l.limit_peer), frozen: !!l.freeze, holderFroze: !!l.freeze_peer, authorized: !!l.authorized, noRipplePeer: !!l.no_ripple_peer }));
  const frozen = holders.filter((h) => h.frozen || h.holderFroze);
  findings.push(frozen.length
    ? f('trustlines.freeze', 'high', `${frozen.length} holder trustline(s) frozen`, frozen.map((h) => `${h.account} (${h.role}) ${h.frozen ? 'frozen by issuer' : 'frozen by holder'}`).join('; '), 'Shows holders whose balance cannot move.', 'Sentinel cannot unfreeze.')
    : f('trustlines.freeze', 'info', `No frozen trustlines (${holders.length} lines)`, `Checked ${holders.length} ${code} trustline(s) on the issuer: none frozen.`, 'Confirms every holder can currently move their balance.', 'A freeze could be applied at any later ledger unless NoFreeze is set.'));
  const unauth = fl.RequireAuth ? holders.filter((h) => !h.authorized) : [];
  if (unauth.length) findings.push(f('trustlines.auth', 'low', `${unauth.length} trustline(s) not yet authorized`, unauth.map((h) => h.account).join(', '), 'With RequireAuth, unauthorized lines cannot receive the token.', 'Authorization status says nothing about holder identity.'));
  const nearLimit = holders.filter((h) => h.limit > 0 && h.balance / h.limit > 0.95);
  findings.push(f('trustlines.limits', nearLimit.length ? 'low' : 'info', nearLimit.length ? `${nearLimit.length} holder(s) near their trust limit` : 'Trust limits have headroom',
    holders.map((h) => `${h.role} ${h.balance} / limit ${h.limit}`).join('; ') || 'no holder lines',
    'A trust limit caps how much a holder can receive; near-limit lines will reject further incoming tokens or fills.', 'Limits are holder-chosen; they do not cap issuer issuance.'));

  // Supply concentration
  const outstanding = d.obligations != null ? Number(d.obligations) : holders.reduce((s, h) => s + Math.max(0, h.balance), 0);
  const hs = shares(holders.map((h) => ({ key: h.account, qty: Math.max(0, h.balance), role: h.role })));
  const supplyHhi = hhi(hs.map((h) => h.qty));
  const top = hs[0];
  if (top) {
    const sev = top.share > 0.5 ? 'high' : supplyHhi > 2500 ? 'medium' : supplyHhi > 1500 ? 'low' : 'info';
    findings.push(f('supply.concentration', sev, `Top holder controls ${pct(top.share)} of supply`, `${hs.length} holder(s); HHI ${supplyHhi}/10000; outstanding ${outstanding}. Top: ${top.key} (${top.role}) ${top.qty}. ${hs.slice(1, 4).map((h) => `${h.role} ${pct(h.share)}`).join(', ')}${top.role === 'maker' ? '. The top holder is our demo market-maker inventory account.' : ''}`,
      'Shows whether one account can move the price or dump supply on holders.', 'Concentration is measured per address; one person can hold many addresses, so true concentration can be higher. Issuer can also issue more at any time (no supply cap on XRPL issued tokens).'));
  } else findings.push(f('supply.concentration', 'info', 'No holders yet', 'No positive balances found.', '—', '—'));

  // Order book: depth concentration, withdrawal exposure, unfunded and stale offers
  const offers = [...(d.asks || []).map((o) => normalizeOffer(o, 'ask', d.validatedLedger)), ...(d.bids || []).map((o) => normalizeOffer(o, 'bid', d.validatedLedger))];
  const bc = bookConcentration(offers);
  if (!offers.length) findings.push(f('book.depth', 'medium', 'Order book is empty', 'book_offers returned no offers on either side.', 'Warns that holders currently have no exit liquidity on the DEX.', 'AMM pools, if any, are not inspected.'));
  else {
    const sev = bc.withdrawalExposure > 0.8 ? 'high' : bc.withdrawalExposure > 0.5 ? 'medium' : 'low';
    findings.push(f('book.concentration', sev, `${pct(bc.withdrawalExposure)} of book depth would vanish if the top provider cancels`,
      `${offers.length} offer(s), ${bc.totalXrp.toFixed(4)} XRP funded depth; providers: ${bc.providers.map((p) => `${roleOf(p.key, roles)} ${p.key.slice(0, 8)}… ${pct(p.share)}`).join(', ')}; depth HHI ${bc.hhi}.${roleOf(bc.top, roles) === 'maker' ? ' The only provider is our demo maker account.' : ''}`,
      'Shows how fragile liquidity is: market-making concentration and the depth lost in a single OfferCancel.', 'Depth is a snapshot of the validated ledger; offers can be cancelled in the next ledger (~4s). Only the top 50 offers per side are read.'));
  }
  const oh = offerHealth(offers);
  findings.push(oh.unfunded.length
    ? f('book.unfunded', oh.unfunded.some((o) => o.fundedRatio < 0.5) ? 'medium' : 'low', `${oh.unfunded.length} offer(s) not fully funded`, oh.unfunded.map((o) => `${o.side} #${o.seq} by ${o.account}: ${pct(o.fundedRatio)} funded`).join('; '), 'Displayed depth that cannot actually fill misleads takers about available liquidity.', 'Funding can change every ledger; the XRPL removes unfunded offers lazily when crossed.')
    : f('book.unfunded', 'info', 'All offers fully funded', `${offers.length} offer(s): taker_gets_funded equals TakerGets for each.`, 'Shown depth is backed by the owner\'s current balance.', 'Funding is checked at this ledger only.'));
  findings.push(oh.stale.length
    ? f('book.stale', 'low', `${oh.stale.length} offer(s) older than ${STALE_OFFER_HOURS}h`, oh.stale.map((o) => `${o.side} #${o.seq} ~${o.ageHours.toFixed(1)}h`).join('; '), 'Old quotes may no longer reflect the maker\'s intended price.', 'Age is estimated from ledger sequence (~3.9 s/ledger).')
    : f('book.stale', 'info', 'No stale offers', offers.length ? `Oldest offer ~${Math.max(...offers.map((o) => o.ageHours ?? 0)).toFixed(1)}h (estimated from ledger sequence).` : 'No offers.', 'Quotes are recent.', 'Age is estimated from ledger sequence (~3.9 s/ledger).'));

  // Demonstration activity / wash-trading indicator
  const trades = d.trades || [];
  const ctrl = trades.filter((t) => t.controlled);
  if (!trades.length) findings.push(f('activity.demo', 'info', 'No fills observed', 'No consumed offers found in recent maker history or recorded fill.', '—', 'Only the most recent maker transactions are scanned.'));
  else findings.push(f('activity.demo', ctrl.length === trades.length ? 'medium' : 'low',
    ctrl.length === trades.length ? `All ${trades.length} observed fill(s) are demo-generated (both sides are accounts we control)` : `${ctrl.length} of ${trades.length} fills are between our own accounts`,
    `${trades.map((t) => `${t.hash.slice(0, 10)}… ${t.tokenQty} ${code}: ${roleOf(t.taker, roles)} account took liquidity from ${t.makers.map((m) => roleOf(m, roles)).join(" + ")} account`).join('; ')}. Launch record organic=${launch.organic}.`,
    'Labels self-matched volume so it is never presented as organic demand (wash-trading indicator).',
    'Detection only knows the addresses we control. Outside wash traders using their own multiple addresses would look like independent fills.', { links: trades.slice(0, 5).map((t) => ({ label: t.hash.slice(0, 8), href: t.explorer })) }));

  // Token identity
  const others = launches.filter((l) => l.code !== code && l.status !== 'failed');
  const collisions = others.map((o) => identityCollision(launch, o)).filter(Boolean);
  if (collisions.length) {
    const worst = collisions.reduce((w, c) => (SEVERITIES.indexOf(c.severity) < SEVERITIES.indexOf(w) ? c.severity : w), 'info');
    findings.push(f('identity.collision', worst, `Name/ticker similar to ${collisions.length} other launch(es)`, collisions.map((c) => c.reasons.join('; ')).join(' | '), 'Warns holders about look-alike tokens that could be confused with this one.', 'Only compares launches in this demo; tokens from other issuers on the ledger are not scanned. Same ticker from a different issuer is a different asset on XRPL.'));
  } else findings.push(f('identity.collision', 'info', 'No look-alike launches', `Compared "${launch.name}" (${code}) with ${others.length} other launch(es): no case, homoglyph or near-edit matches.`, 'Reduces confusion between demo tokens.', 'Only compares launches in this demo, not the whole ledger.'));
  const imp = impersonationIssues(launch);
  findings.push(imp.length
    ? f('identity.impersonation', 'high', 'Possible impersonation', imp.join(' '), 'Blocks brand names, real-asset tickers and backing claims (launch policy rules).', 'Word lists cannot catch every brand or a convincing new name.')
    : f('identity.impersonation', 'info', 'Passes impersonation policy', `Name, ticker and description re-checked against launch policy (reserved tickers, brand and backing terms), including homoglyph-folded variants.`, 'Blocks brand names, real-asset tickers and backing claims.', 'Word lists cannot catch every brand or a convincing new name.'));

  // Ledger verification of recorded steps
  const verification = d.verification || [];
  const bad = verification.filter((v) => !v.ok);
  findings.push(bad.length
    ? f('ledger.verification', 'high', `${bad.length} recorded transaction(s) failed re-verification`, bad.map((v) => `${v.key} ${v.hash?.slice(0, 10)}…: validated=${v.validated} result=${v.result} ledger=${v.ledger}${v.error ? ' ' + v.error : ''}`).join('; '), 'Ensures every hash we show is real, validated and successful.', 'A temporary network error can also cause a failed lookup; re-scan before concluding.')
    : f('ledger.verification', 'info', `All ${verification.length} recorded transactions re-verified`, `Each step hash re-fetched with tx: validated, tesSUCCESS, same ledger as recorded.`, 'Proves the launch history shown in the UI matches the validated ledger.', 'Verifies what happened, not whether it was a good idea.', { links: verification.slice(0, 1).map((v) => ({ label: 'first tx', href: v.explorer })) }));

  findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((x) => x.severity === s).length]));
  return {
    mode: MODE, code, name: launch.name, launchId: launch.id, organic: launch.organic === true,
    issuer: roles.issuer, issuerFlags: fl, validatedLedger: d.validatedLedger, counts, findings, verification,
    holders: hs.map((h) => ({ account: h.key, role: h.role, qty: h.qty, share: h.share })), supplyHhi, outstanding,
    book: { offers, ...bc }, trades,
  };
}

// ---------- Guided exercise (SIMULATION) ----------
export const EXERCISE = [
  { id: 'freeze-clawback', title: 'Issuer keeps freeze and clawback powers',
    config: { AccountRoot: { Flags: 'lsfAllowTrustLineClawback | lsfDefaultRipple', NoFreeze: false }, note: 'Issuer can freeze lines and pull balances back.' },
    question: 'What is the main risk to a holder?',
    choices: [{ t: 'The issuer can lock or take back my balance without my signature', ok: true }, { t: 'The token cannot be traded on the DEX', ok: false }, { t: 'Nothing: flags are cosmetic', ok: false }],
    catches: 'Sentinel decodes issuer flags (issuer.clawback = high, issuer.freeze = low) and states what each power means for holders.',
    control: 'Disclosure plus NoFreeze (permanent) for issuers that want to give up freeze; clawback can only be enabled before any trustlines exist.',
    limits: 'Sentinel cannot stop a freeze or Clawback transaction; it can only flag the capability and report it after it happens.' },
  { id: 'concentration', title: 'One wallet holds 92% of supply',
    config: { holders: [{ account: 'rWhale…', share: '92%' }, { account: '40 others', share: '8%' }], HHI: 8470 },
    question: 'Why does this matter?',
    choices: [{ t: 'One account can dump supply and crash the price for everyone else', ok: true }, { t: 'It makes the token more secure', ok: false }, { t: 'XRPL caps any holder at 50%', ok: false }],
    catches: 'supply.concentration computes per-address shares and the HHI (>2500 = concentrated, top >50% = high).',
    control: 'Disclosure before trading; Guardian-style limits on how much a single demo role can move per transaction.',
    limits: 'One person can split holdings across many addresses, so true concentration can be worse than measured.' },
  { id: 'wash', title: 'Volume chart shows 5,000 trades today',
    config: { fills: 5000, takers: ['rA…', 'rB…'], makers: ['rA…', 'rB…'], note: 'Same two accounts on both sides.' },
    question: 'What is going on?',
    choices: [{ t: 'Wash trading: self-matched fills inflate volume without real demand', ok: true }, { t: 'Strong organic demand', ok: false }, { t: 'An AMM rebalancing', ok: false }],
    catches: 'activity.demo matches both sides of every fill against the accounts we control. In Titan Forge every current fill is demo-generated and labeled organic=false.',
    control: 'Volume from controlled accounts is labeled demo, never organic demand.',
    limits: 'Only accounts we know are matched; outside wash traders using fresh addresses look like independent parties.' },
  { id: 'unfunded', title: 'A 1,000,000-token ask in the book',
    config: { offer: { TakerGets: '1000000 XYZ', taker_gets_funded: '120 XYZ', owner_funds: '120' } },
    question: 'What should a taker conclude about this depth?',
    choices: [{ t: 'Almost none of it is real: the owner can only deliver 120 tokens', ok: true }, { t: 'There is 1,000,000 of liquidity', ok: false }, { t: 'The ledger will force the owner to buy the rest', ok: false }],
    catches: 'book.unfunded compares taker_gets_funded with TakerGets for every offer (0.012% funded = medium).',
    control: 'Depth figures use funded amounts only.',
    limits: 'Funding changes every ledger; a funded offer can become unfunded seconds later.' },
  { id: 'impersonation', title: 'New launch named "R1pple Officia1 USD"',
    config: { name: 'R1pple Officia1 USD', code: 'U5D', description: 'backed 1:1' },
    question: 'What is the risk?',
    choices: [{ t: 'Impersonation: look-alike brand and fake backing claim to mislead buyers', ok: true }, { t: 'None, the ticker differs from USD', ok: false }, { t: 'Only a typo', ok: false }],
    catches: 'Launch policy blocks brand terms, reserved tickers and backing claims; Sentinel re-runs it on homoglyph-folded text (1→l, 5→s) and checks look-alikes among launches.',
    control: 'Launch is rejected before anything touches the ledger.',
    limits: 'Word lists and homoglyph tables cannot catch every new brand or a convincing original name.' },
  { id: 'delegated-key', title: 'Issuer has a RegularKey nobody recognizes',
    config: { AccountRoot: { RegularKey: 'rUnknown…', DisableMaster: false }, SignerList: null },
    question: 'What can the holder of that key do?',
    choices: [{ t: 'Sign as the issuer: issue more supply, freeze lines, change settings', ok: true }, { t: 'Only read balances', ok: false }, { t: 'Nothing unless the master key co-signs', ok: false }],
    catches: 'keys.issuer reports RegularKey / SignerList / master-key state (RegularKey = medium) and delegate.* lists Delegate permissions.',
    control: 'Guardian only lets our three isolated demo roles sign, and only whitelisted transaction types under per-tx XRP limits.',
    limits: 'Sentinel sees key configuration, not custody: it cannot tell if a key is already stolen.' },
];

export function guardianDemo() {
  const cases = [
    { label: 'Maker posts a 5 XRP bid', p: { mode: 'LIVE_TESTNET', txType: 'OfferCreate', role: 'maker', amountXrp: 5 } },
    { label: 'Issuer claws back a holder balance', p: { mode: 'LIVE_TESTNET', txType: 'Clawback', role: 'issuer' } },
    { label: 'Visitor wallet signs a payment', p: { mode: 'LIVE_TESTNET', txType: 'Payment', role: 'visitor', amountXrp: 1 } },
    { label: 'Maker sends 500 XRP', p: { mode: 'LIVE_TESTNET', txType: 'Payment', role: 'maker', amountXrp: 500 } },
    { label: 'Issuer sets a RegularKey (needs operator approval)', p: { mode: 'LIVE_TESTNET', txType: 'SetRegularKey', role: 'issuer', requiresApproval: true } },
    { label: 'AccountSet without operator approval', p: { mode: 'LIVE_TESTNET', txType: 'AccountSet', role: 'issuer', requiresApproval: true, approved: false } },
    { label: 'Simulated $2M capital injection', p: { mode: 'SIMULATION', amountUsd: 2_000_000, marketId: 'currencies' } },
    { label: 'Replay tries to submit an OfferCreate', p: { mode: 'REPLAY', txType: 'OfferCreate' } },
  ];
  return cases.map((c) => ({ label: c.label, proposal: c.p, verdict: guardCheck(c.p) }));
}

// ---------- Live fetcher with caching ----------
export class Sentinel {
  constructor(ctx, { ttlMs = 30_000, now = () => Date.now() } = {}) {
    this.ctx = ctx; this.ttl = ttlMs; this.now = now;
    this.memo = new Map(); this.reports = new Map(); this.published = new Set(); this.inflight = new Map();
  }

  roles() {
    const w = this.ctx.ledger.wallets || {};
    return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v.address]));
  }

  async req(params, { permanent = false } = {}) {
    const key = JSON.stringify(params);
    const hit = this.memo.get(key);
    if (hit && (hit.permanent || this.now() - hit.at < this.ttl)) return hit.p;
    const p = this.ctx.ledger.client.request(params).then((r) => r.result);
    this.memo.set(key, { p, at: this.now(), permanent: false });
    p.then((r) => { if (permanent && r?.validated) this.memo.set(key, { p, at: this.now(), permanent: true }); }, () => this.memo.delete(key));
    return p;
  }

  async fetch(launch) {
    const roles = this.roles();
    const code = launch.code;
    const tok = { currency: code, issuer: roles.issuer };
    const safe = (p) => p.catch((e) => ({ __error: e.data?.error_message || e.data?.error || e.message }));
    const accounts = {};
    await Promise.all(Object.entries(roles).map(async ([role, addr]) => {
      const [info, objs] = await Promise.all([
        safe(this.req({ command: 'account_info', account: addr, signer_lists: true, ledger_index: 'validated' })),
        safe(this.req({ command: 'account_objects', account: addr, ledger_index: 'validated', limit: 200 })),
      ]);
      accounts[role] = info.__error ? { error: info.__error } : { account_data: info.account_data, signer_lists: info.signer_lists ?? info.account_data?.signer_lists ?? [] };
      if (objs.__error) accounts[role].objectsError = objs.__error; else accounts[role].objects = objs.account_objects || [];
    }));
    const [lines, gw, asks, bids, makerTx] = await Promise.all([
      safe(this.req({ command: 'account_lines', account: roles.issuer, ledger_index: 'validated', limit: 400 })),
      safe(this.req({ command: 'gateway_balances', account: roles.issuer, ledger_index: 'validated' })),
      safe(this.req({ command: 'book_offers', taker_gets: tok, taker_pays: { currency: 'XRP' }, ledger_index: 'validated', limit: 50 })),
      safe(this.req({ command: 'book_offers', taker_gets: { currency: 'XRP' }, taker_pays: tok, ledger_index: 'validated', limit: 50 })),
      safe(this.req({ command: 'account_tx', account: roles.maker, ledger_index_min: -1, ledger_index_max: -1, limit: 100 })),
    ]);
    const validatedLedger = asks.ledger_index ?? bids.ledger_index ?? lines.ledger_index ?? null;
    const steps = (launch.steps || []).filter((s) => s.hash);
    const txs = await Promise.all(steps.map((s) => safe(this.req({ command: 'tx', transaction: s.hash }, { permanent: true }))));
    const verification = steps.map((s, i) => (txs[i].__error ? { ...verifyStep(s, null), error: txs[i].__error, explorer: TX_URL + s.hash } : verifyStep(s, txs[i])));
    const controlled = new Set(Object.values(roles));
    const tradeMap = new Map();
    const consider = (r) => { const t = r && tradesFromTx(r, code, controlled); if (t && !tradeMap.has(t.hash)) tradeMap.set(t.hash, t); };
    if (!makerTx.__error) for (const t of makerTx.transactions || []) consider({ ...t, tx_json: t.tx_json ?? t.tx, meta: t.meta, hash: t.hash ?? t.tx?.hash, ledger_index: t.ledger_index ?? t.tx?.ledger_index });
    txs.forEach((r) => { if (!r.__error) consider(r); });
    const errors = [lines, gw, asks, bids, makerTx].filter((x) => x.__error).map((x) => x.__error);
    return {
      launch, launches: this.ctx.store.launches, roles, controlled, accounts, validatedLedger,
      issuerLines: lines.lines || [], obligations: gw.obligations?.[code] ?? null,
      asks: asks.offers || [], bids: bids.offers || [], trades: [...tradeMap.values()], verification, errors,
    };
  }

  async report(code, { force = false } = {}) {
    code = String(code).toUpperCase();
    const launch = this.ctx.store.byCode(code);
    if (!launch) return null;
    const c = this.reports.get(code);
    if (!force && c && this.now() - c.at < this.ttl) return { ...c.report, cached: true, ageMs: this.now() - c.at };
    if (this.inflight.has(code)) return this.inflight.get(code);
    const p = (async () => {
      const data = await this.fetch(launch);
      const report = { ...analyze(data), scannedAt: new Date(this.now()).toISOString(), fetchErrors: data.errors, cacheTtlMs: this.ttl };
      this.reports.set(code, { at: this.now(), report });
      this.publish(report);
      return { ...report, cached: false, ageMs: 0 };
    })().finally(() => this.inflight.delete(code));
    this.inflight.set(code, p);
    return p;
  }

  publish(report) {
    for (const x of report.findings) {
      if (x.severity !== 'medium' && x.severity !== 'high') continue;
      const key = `${report.code}|${x.id}|${x.severity}|${x.title}`;
      if (this.published.has(key)) continue;
      this.published.add(key);
      this.ctx.bus.publish('sentinel.finding', MODE, { code: report.code, severity: x.severity, title: x.title, findingId: x.id });
    }
  }

  async summary() {
    const live = this.ctx.store.launches.filter((l) => l.status === 'live');
    const out = [];
    for (const l of live) { // sequential to stay gentle on the public Testnet endpoint
      try {
        const r = await this.report(l.code);
        out.push({ code: r.code, name: r.name, mode: MODE, counts: r.counts, top: r.findings.filter((x) => x.severity === 'high' || x.severity === 'medium').map((x) => ({ id: x.id, severity: x.severity, title: x.title })), verified: r.verification.every((v) => v.ok), scannedAt: r.scannedAt, cached: r.cached });
      } catch (e) { out.push({ code: l.code, name: l.name, mode: MODE, error: e.message }); }
    }
    return out;
  }
}
