// Ledger hardware wallet adapter (browser-side, WebHID via the Ledger Device Management Kit).
// Docs verified 2026-10-25: developers.ledger.com/docs/device-interaction/dmk-ts/references/signers/xrp
//   packages @ledgerhq/device-management-kit + @ledgerhq/device-signer-kit-xrp; SignerXrpBuilder({dmk, sessionId}).build();
//   getAddress(derivationPath, {checkOnDevice}), signTransaction(derivationPath, transaction), getAppConfig(); each returns {observable, cancel}.
// Transport: @ledgerhq/device-transport-kit-web-hid exports webHidTransportFactory (checked in the jsDelivr ESM build).
// The server has no device: status is SANDBOX_ONLY. The server only builds an UNSIGNED Testnet Payment for review
// that is non-executable by construction (LastLedgerSequence already in the past). It never receives or submits a signature.
import { encode, isValidClassicAddress } from 'xrpl';
import { makeAdapter, withTimeout, safeMessage } from './common.mjs';

// Pinned versions (>= 2 weeks old where possible). The signer's ESM build imports DMK 1.9.0, so the page uses the same.
export const CDN = Object.freeze({
  dmk: 'https://cdn.jsdelivr.net/npm/@ledgerhq/device-management-kit@1.9.0/+esm',
  webHid: 'https://cdn.jsdelivr.net/npm/@ledgerhq/device-transport-kit-web-hid@1.2.4/+esm',
  signerXrp: 'https://cdn.jsdelivr.net/npm/@ledgerhq/device-signer-kit-xrp@0.2.0/+esm',
});
export const DERIVATION_PATH = "44'/144'/0'/0/0";
const EXPECT = { dmk: 'DeviceManagementKitBuilder', webHid: 'webHidTransportFactory', signerXrp: 'SignerXrpBuilder' };

// The XRP app may return a 65-byte uncompressed secp256k1 key (04|X|Y); XRPL SigningPubKey wants the 33-byte form.
export function compressPublicKey(k) {
  const h = String(k || '').trim();
  if (/^04[0-9A-Fa-f]{128}$/.test(h)) return ((parseInt(h.slice(-1), 16) % 2) ? '03' : '02') + h.slice(2, 66).toUpperCase();
  return h;
}

function validateDeviceInput(account, publicKey) {
  if (!isValidClassicAddress(String(account || ''))) throw Object.assign(new Error('account must be a classic XRPL address (from the device)'), { status: 400 });
  publicKey = compressPublicKey(publicKey);
  if (!/^(02|03|ED)[0-9A-Fa-f]{64}$/.test(String(publicKey || ''))) throw Object.assign(new Error('publicKey must be a 33-byte hex public key from the device'), { status: 400 });
  return String(publicKey).toUpperCase();
}

// Read-only Testnet context for an unsigned review tx: current validated ledger + the account's Sequence.
async function accountContext({ account, ledger, ledgerReady, timeoutMs }) {
  let sequence = 1, validated = null, sequenceSource = 'placeholder (account not read)';
  if (ledger?.client && ledgerReady()) {
    try {
      if (!ledger.client.isConnected()) await ledger.connect();
      const vi = (await withTimeout(ledger.client.request({ command: 'ledger', ledger_index: 'validated' }), timeoutMs, 'ledger')).result;
      validated = Number(vi.ledger_index ?? vi.ledger?.ledger_index);
      const ai = await withTimeout(ledger.client.request({ command: 'account_info', account, ledger_index: 'validated' }), timeoutMs, 'account_info').catch((e) => ({ error: e }));
      if (ai?.result?.account_data) { sequence = ai.result.account_data.Sequence; sequenceSource = 'Testnet account_info (read-only)'; }
      else sequenceSource = 'placeholder (account not found on Testnet)';
    } catch (e) { sequenceSource = `placeholder (${safeMessage(e)})`; }
  }
  // Already in the past: a signed copy would be rejected with tefMAX_LEDGER, so it can never be applied.
  return { sequence, validated, sequenceSource, lastLedgerSequence: validated ? Math.max(1, validated - 10) : 1 };
}

// True only for a review object that can never execute: unsigned, not submitted, flagged non-executable, and its
// LastLedgerSequence strictly below the validated ledger at build time (or the minimum 1 when no ledger was read).
export function isNonExecutableReview(r) {
  if (!r || r.unsigned !== true || r.submitted !== false || r.executable !== false || r.mode !== 'LIVE_TESTNET') return false;
  const tx = r.tx || {};
  if (tx.TxnSignature || tx.Signers || tx.NetworkID !== undefined) return false;
  const lls = Number(tx.LastLedgerSequence);
  if (!Number.isFinite(lls)) return false;
  return r.validatedLedgerAtBuild ? lls < r.validatedLedgerAtBuild : lls <= 1;
}

const NETWORK_NOTE = 'XRPL Testnet (network_id 1; NetworkID field omitted as required for id <= 1024)';

// Unsigned Testnet Payment for on-device review. Amount 1 drop to a project demo account.
// LastLedgerSequence is set BELOW the current validated ledger, so even a signed copy can never be applied (tefMAX_LEDGER).
export async function buildReviewTx({ account, publicKey, destination, ledger = null, ledgerReady = () => false, timeoutMs = 8000 }) {
  publicKey = validateDeviceInput(account, publicKey);
  if (!isValidClassicAddress(String(destination || ''))) throw Object.assign(new Error('no demo destination available'), { status: 503 });
  const c = await accountContext({ account, ledger, ledgerReady, timeoutMs });
  const tx = { TransactionType: 'Payment', Account: account, Destination: destination, Amount: '1', Fee: '12', Sequence: c.sequence, Flags: 0,
    LastLedgerSequence: c.lastLedgerSequence, SigningPubKey: publicKey };
  return {
    mode: 'LIVE_TESTNET', network: NETWORK_NOTE, unsigned: true, submitted: false, executable: false,
    tx, encoded: encode(tx), derivationPath: DERIVATION_PATH, sequenceSource: c.sequenceSource, validatedLedgerAtBuild: c.validated,
    safety: [
      'Unsigned. The server never receives a signature and has no submit path for this transaction.',
      `LastLedgerSequence ${tx.LastLedgerSequence} is below the validated ledger${c.validated ? ` ${c.validated}` : ''}: a signed copy would be rejected (tefMAX_LEDGER), so it can never execute.`,
      'Amount is 1 drop of Testnet XRP to a project demo account. Testnet only.',
      'Signing on the device requires the owner confirmation checkbox AND a physical button press on the Ledger.',
    ],
  };
}

// TGLW self-custody commitment illustration (TGLB Tier 1 / Tier 2): the OfferCreate a participant would place FROM
// THEIR OWN ACCOUNT to add bid-side depth to a demo book. Funds never leave the participant's wallet until their own
// offer is crossed, and Titan Ghost never holds their keys. Unsigned, Testnet only, non-executable by construction
// (LastLedgerSequence already expired), passive (never takes liquidity). The server has no submit path for it.
export const COMMIT_TIERS = Object.freeze({
  T1: { label: 'Tier 1 (flexible)', note: 'Flexible: the participant can cancel their own offer at any time (OfferCancel from their wallet).' },
  T2: { label: 'Tier 2 (term-committed)', note: 'Term-committed: the term is a contractual commitment (see Tier 2 exit rules). The XRPL itself cannot lock an offer for a term; the participant still holds the keys.' },
});
const hex = (t) => Buffer.from(String(t), 'utf8').toString('hex').toUpperCase();
export async function buildCommitmentTx({ account, publicKey, tier = 'T1', amountXrp = 1, termDays = null, token, priceXrp, ledger = null, ledgerReady = () => false, timeoutMs = 8000 }) {
  publicKey = validateDeviceInput(account, publicKey);
  if (!COMMIT_TIERS[tier]) throw Object.assign(new Error('tier must be T1 or T2 (Tier 3 is underwritten lending, not a self-custody commitment)'), { status: 400 });
  if (!token || !/^[A-Z0-9]{3}$/.test(String(token.currency || '')) || !isValidClassicAddress(String(token.issuer || ''))) throw Object.assign(new Error('no demo token available for the illustration'), { status: 503 });
  if (account === token.issuer) throw Object.assign(new Error('account must be the participant\'s own wallet, not the demo issuer'), { status: 400 });
  const xrp = Math.min(10, Math.max(0.000001, Number(amountXrp) || 1));
  const price = Number(priceXrp);
  if (!(price > 0)) throw Object.assign(new Error('priceXrp must be positive'), { status: 400 });
  const drops = String(Math.round(xrp * 1e6));
  const qty = String(Math.round((xrp / price) * 1e6) / 1e6);
  const c = await accountContext({ account, ledger, ledgerReady, timeoutMs });
  const memo = { product: 'TGLW', tier, illustration: true, ...(tier === 'T2' && Number(termDays) > 0 ? { termDays: Math.round(Number(termDays)) } : {}) };
  const tx = { TransactionType: 'OfferCreate', Account: account, TakerGets: drops, TakerPays: { currency: token.currency, issuer: token.issuer, value: qty },
    Fee: '12', Sequence: c.sequence, Flags: 0x00010000 /* tfPassive: adds depth, never takes */, LastLedgerSequence: c.lastLedgerSequence, SigningPubKey: publicKey,
    Memos: [{ Memo: { MemoType: hex('tglw/commitment-illustration'), MemoData: hex(JSON.stringify(memo)) } }] };
  return {
    mode: 'LIVE_TESTNET', network: NETWORK_NOTE, unsigned: true, submitted: false, executable: false, product: 'TGLW', tier, tierLabel: COMMIT_TIERS[tier].label,
    custody: 'Your funds stay in your wallet; Titan Ghost never holds your keys.',
    tx, encoded: encode(tx), derivationPath: DERIVATION_PATH, sequenceSource: c.sequenceSource, validatedLedgerAtBuild: c.validated,
    summary: `Offer ${xrp} Testnet XRP for ${qty} ${token.currency} at ${price} XRP/${token.currency} (the demo bid price), placed from ${account}.`,
    safety: [
      'Unsigned. The server never receives a signature and has no submit path for this transaction.',
      `LastLedgerSequence ${tx.LastLedgerSequence} is below the validated ledger${c.validated ? ` ${c.validated}` : ''}: a signed copy would be rejected (tefMAX_LEDGER), so it can never execute.`,
      'Self-custody: the offer would sit in the participant\'s own account. Titan Ghost cannot move it, cancel it or withdraw from it.',
      'tfPassive: the offer only adds depth; it never crosses (takes) an existing offer.',
      COMMIT_TIERS[tier].note,
      'Testnet only, illustration only. Signing on the device needs the owner checkbox AND a physical button press.',
    ],
  };
}

export function createLedgerAdapter({ env = process.env, samples = null, now = () => Date.now(), fetchFn = (...a) => globalThis.fetch(...a), offline = false, timeoutMs = 10_000 } = {}) {
  return makeAdapter({
    id: 'ledger', name: 'Ledger (hardware wallet, WebHID)', env, samples, now,
    docs: ['https://developers.ledger.com/docs/device-interaction/dmk-ts/references/signers/xrp', 'https://www.npmjs.com/package/@ledgerhq/device-management-kit', 'https://www.npmjs.com/package/@ledgerhq/device-transport-kit-web-hid'],
    capability: 'Owner-held signing for agent proposals: wallet detection over WebHID, address retrieval (44\'/144\'/0\'/0/0), and on-device REVIEW of an unsigned, non-executable XRPL Testnet Payment. The agent can propose; only the owner\'s device can sign.',
    credentialEnv: [],
    computeStatus: () => 'SANDBOX_ONLY',
    extra: () => ({ cdn: CDN, derivationPath: DERIVATION_PATH, serverNote: 'No device is attached to this server. Detection, address and review run in the visitor\'s browser (Chrome/Edge with WebHID). Untested with physical hardware on this node.' }),
    runProbe: async () => {
      if (offline) return { ok: false, error: 'Offline replay mode: no network.', countAsError: false };
      const result = {};
      for (const [k, url] of Object.entries(CDN)) {
        const r = await withTimeout(fetchFn(url, { method: 'GET' }), timeoutMs, `CDN ${k}`);
        const text = r.ok ? await r.text() : '';
        result[k] = { url, http: r.status, bytes: text.length, exportFound: text.includes(EXPECT[k]) ? EXPECT[k] : null };
      }
      const ok = Object.values(result).every((x) => x.http === 200 && x.exportFound);
      if (!ok) return { ok: false, error: 'One or more Ledger DMK modules are not loadable from the CDN', result };
      return { ok: true, mode: 'SIMULATION', countsAsVendorTest: false, note: 'CDN availability of the Ledger DMK ES modules (no device on the server).', result,
        sample: { mode: 'SIMULATION', source: 'cdn.jsdelivr.net (Ledger DMK ESM builds)', probe: 'GET each pinned module, check its expected export', result } };
    },
  });
}

export default createLedgerAdapter();
