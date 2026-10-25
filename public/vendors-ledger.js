// Shared browser Ledger module (WebHID via the Ledger Device Management Kit). Used by the Vendor Integrations tab
// (owner-held signing review) and the TGLB Bootstrap tab (TGLW self-custody commitment from your own wallet).
// The kit is loaded on demand from the pinned CDN URLs the server reports (GET /api/vendors -> ledger.cdn).
// Nothing here submits anything: a signature (if the owner presses the device button) stays in the page, and every
// transaction offered for signing must pass isNonExecutable() first (unsigned, not submitted, already expired).
export const LEDGER_PATH = "44'/144'/0'/0/0";
export const hasWebHid = () => typeof navigator !== 'undefined' && 'hid' in navigator;

// Mirrors lib/vendors/ledger.mjs isNonExecutableReview(): the browser refuses to ask the device to sign anything else.
export function isNonExecutable(r) {
  if (!r || r.unsigned !== true || r.submitted !== false || r.executable !== false || r.mode !== 'LIVE_TESTNET') return false;
  const tx = r.tx || {};
  if (tx.TxnSignature || tx.Signers || tx.NetworkID !== undefined) return false;
  const lls = Number(tx.LastLedgerSequence);
  if (!Number.isFinite(lls)) return false;
  return r.validatedLedgerAtBuild ? lls < r.validatedLedgerAtBuild : lls <= 1;
}

const hexToBytes = (h) => Uint8Array.from(String(h).match(/../g) || [], (x) => parseInt(x, 16));
const bytesToHex = (b) => Array.from(b || [], (x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();

// One device session per page. `getCdn()` returns {dmk, webHid, signerXrp} URLs; `onStatus(msg)` receives progress.
export function createLedgerSession({ getCdn, onStatus = () => {} }) {
  let dmk = null, sessionId = null, signer = null, account = null;
  const run = (obs) => new Promise((resolve, reject) => {
    obs.subscribe({ next: (s) => {
      if (s.status === 'completed') resolve(s.output);
      else if (s.status === 'error') reject(new Error(s.error?.message || s.error?._tag || 'device error'));
      else if (s.intermediateValue?.requiredUserInteraction && s.intermediateValue.requiredUserInteraction !== 'none') onStatus(`Device: ${s.intermediateValue.requiredUserInteraction}`);
    }, error: reject });
  });
  return {
    get account() { return account; },
    get connected() { return !!signer; },
    // Detect the device and read its address (no signing).
    async connect() {
      if (!hasWebHid()) throw new Error('WebHID not supported here. Use desktop Chrome or Edge.');
      const cdn = await getCdn();
      if (!cdn?.dmk || !cdn?.webHid || !cdn?.signerXrp) throw new Error('Ledger kit CDN list unavailable');
      onStatus('Loading Ledger Device Management Kit from cdn.jsdelivr.net…');
      const [D, H, X] = await Promise.all([import(cdn.dmk), import(cdn.webHid), import(cdn.signerXrp)]);
      dmk ||= new D.DeviceManagementKitBuilder().addTransport(H.webHidTransportFactory).build();
      onStatus('Select your Ledger in the browser prompt (unlock it and open the XRP app)…');
      const device = await new Promise((resolve, reject) => { const sub = dmk.startDiscovering({}).subscribe({ next: (d) => { sub.unsubscribe(); resolve(d); }, error: reject }); });
      sessionId = await dmk.connect({ device });
      signer = new X.SignerXrpBuilder({ dmk, sessionId }).build();
      const out = await run(signer.getAddress(LEDGER_PATH, { checkOnDevice: false }).observable);
      account = { address: out.address, publicKey: out.publicKey };
      return account;
    },
    // On-device review of an unsigned, non-executable transaction. Returns the signature hex; it is never sent anywhere.
    async review(r) {
      if (!signer) throw new Error('Connect the device first.');
      if (!isNonExecutable(r)) throw new Error('Refused: only unsigned, already-expired Testnet transactions are sent to the device.');
      onStatus('Check the transaction on your Ledger screen and approve or reject it there…');
      return bytesToHex(await run(signer.signTransaction(LEDGER_PATH, hexToBytes(r.encoded)).observable));
    },
  };
}

export const shortSig = (hex) => `${hex.slice(0, 16)}…${hex.slice(-8)} (${hex.length / 2} bytes)`;
