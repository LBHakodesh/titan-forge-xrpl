// x402 protocol v2 shapes for Titan Forge (London / TA-LON demo node).
// Verified 2026-10-23 against:
//   - x402 v2 core spec       github.com/coinbase/x402 specs/x402-specification-v2.md
//   - x402 v2 HTTP transport  github.com/coinbase/x402 specs/transports-v2/http.md
//   - XRPL exact scheme       github.com/x402-foundation/x402 specs/schemes/exact/scheme_exact_xrpl.md (linked from docs.x402.org/schemes/exact)
// Headers (all base64-encoded JSON): PAYMENT-REQUIRED (server->client, with HTTP 402),
// PAYMENT-SIGNATURE (client->server, PaymentPayload), PAYMENT-RESPONSE (server->client, SettlementResponse).
// x402 is payment/entitlement only, never trading authority (master spec §U). Entitlement authority for
// production belongs to the COMMAND/C2 node; this node only demonstrates and visualizes.

export const X402_VERSION = 2;
export const HEADERS = { required: 'PAYMENT-REQUIRED', signature: 'PAYMENT-SIGNATURE', response: 'PAYMENT-RESPONSE' };
// Node lower-cases incoming header names.
export const HEADER_IN = { signature: 'payment-signature' };
export const SCHEME = 'exact';
// CAIP-2 for XRPL: xrpl:{NetworkID}. Only Testnet is ever accepted on this node.
export const NETWORKS = { 'xrpl:0': 'XRPL Mainnet', 'xrpl:1': 'XRPL Testnet', 'xrpl:2': 'XRPL Devnet' };
export const APPROVED_NETWORKS = ['xrpl:1'];
export const ASSET_XRP = 'XRP';
export const DROPS_PER_XRP = 1_000_000;

// Error reasons: generic ones from the v2 core spec, XRPL ones named in the same style
// (the XRPL scheme spec names only duplicate_settlement explicitly).
export const REASONS = {
  invalid_x402_version: 'x402Version must be 2.',
  invalid_scheme: 'Scheme must be exact.',
  invalid_network: 'Network not supported on this node (XRPL Testnet only).',
  invalid_payload: 'Payment payload could not be decoded.',
  invalid_payment_requirements: 'Accepted requirements do not match what the server offered.',
  invalid_exact_xrpl_payload_signature: 'XRPL transaction signature is invalid.',
  invalid_exact_xrpl_payload_transaction_type: 'Transaction must be an XRPL Payment.',
  invalid_exact_xrpl_payload_recipient_mismatch: 'Destination does not match payTo.',
  invalid_exact_xrpl_payload_amount_mismatch: 'Amount does not match the required drops.',
  invalid_exact_xrpl_payload_network_id: 'NetworkID must be omitted for networks with id <= 1024.',
  invalid_exact_xrpl_payload_last_ledger_sequence: 'LastLedgerSequence missing or beyond the allowed window.',
  invalid_exact_xrpl_payload_sequence: 'Sequence/TicketSequence does not match the transfer method.',
  invalid_exact_xrpl_payload_invoice: 'InvoiceID does not bind to an open, unexpired challenge.',
  invalid_exact_xrpl_payload_unsafe_field: 'Unsafe field present (Memos, Paths, SendMax, DeliverMin, Delegate, partial payment or fee above policy).',
  invalid_exact_xrpl_payload_expired: 'Payment authorization expired.',
  duplicate_settlement: 'This payment was already seen (replay). Seen does not mean settled.',
  invalid_transaction_state: 'Settlement did not reach validated tesSUCCESS.',
  unexpected_settle_error: 'Settlement failed unexpectedly.',
  insufficient_funds: 'Payer cannot cover the amount.',
};

export const b64encode = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
export function b64decode(s) {
  if (typeof s !== 'string' || !s.length || s.length > 16_384 || !/^[A-Za-z0-9+/=_-]+$/.test(s)) return null;
  try { const o = JSON.parse(Buffer.from(s, 'base64').toString('utf8')); return o && typeof o === 'object' ? o : null; } catch { return null; }
}

export const xrpToDropsStr = (xrp) => String(Math.round(Number(xrp) * DROPS_PER_XRP));
export const dropsToXrpNum = (drops) => Number(drops) / DROPS_PER_XRP;

// PaymentRequirements (one entry of accepts[]).
export function paymentRequirements({ network = 'xrpl:1', amountDrops, payTo, maxTimeoutSeconds = 60, invoiceId, transferMethod = 'sequence' }) {
  return {
    scheme: SCHEME, network, amount: String(amountDrops), asset: ASSET_XRP, payTo, maxTimeoutSeconds,
    extra: { areFeesSponsored: false, assetTransferMethod: transferMethod, ...(invoiceId ? { invoiceId } : {}) },
  };
}

// PaymentRequired (body of the PAYMENT-REQUIRED header).
export function paymentRequired({ url, description, mimeType = 'application/json', accepts, error }) {
  return { x402Version: X402_VERSION, ...(error ? { error } : {}), resource: { url, description, mimeType, serviceName: 'Titan Forge demo data (TA-LON)' }, accepts };
}

export function paymentPayload({ accepted, payload, resource }) {
  return { x402Version: X402_VERSION, ...(resource ? { resource } : {}), accepted, payload };
}

export const verifyResponse = (isValid, invalidReason, payer) => ({ isValid, ...(isValid ? {} : { invalidReason }), ...(payer ? { payer } : {}) });

export function settlementResponse({ success, errorReason, payer, transaction = '', network, amount }) {
  return { success: !!success, ...(success ? {} : { errorReason: errorReason || 'unexpected_settle_error' }), ...(payer ? { payer } : {}), transaction, network, ...(amount ? { amount } : {}) };
}

// Compare the accepted requirements against what we offered (spec envelope rule 1).
export function requirementsMatch(accepted, offered) {
  if (!accepted || typeof accepted !== 'object') return false;
  for (const k of ['scheme', 'network', 'asset', 'payTo', 'amount', 'maxTimeoutSeconds']) if (String(accepted[k]) !== String(offered[k])) return false;
  const a = accepted.extra || {}, o = offered.extra || {};
  if (a.areFeesSponsored !== false) return false;
  if ((a.assetTransferMethod || 'sequence') !== (o.assetTransferMethod || 'sequence')) return false;
  if (o.invoiceId && a.invoiceId !== o.invoiceId) return false;
  return true;
}

// Redaction helpers: addresses in short form, never payloads/blobs/secrets.
export const shortAddr = (a) => (typeof a === 'string' && a.length > 12 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a || null);
export const shortHash = (h) => (typeof h === 'string' && h.length > 16 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h || null);
export const EXPLORER_TX = 'https://testnet.xrpl.org/transactions/';
