// XRPL `exact` scheme verification (x402 v2, specs/schemes/exact/scheme_exact_xrpl.md).
// One payload form for every mode: payload.signedTxBlob (spec form), decoded with the XRPL binary codec, every spec
// rule checked, signature verified offline. SIMULATION fixtures are never submitted; LIVE_TESTNET blobs (signed by the
// `router` demo role via ledger.signOffline) are submitted via ledger.submitSigned only after this verification.
import crypto from 'node:crypto';
import { decode, verifySignature, hashes } from 'xrpl';
import { X402_VERSION, SCHEME, APPROVED_NETWORKS, requirementsMatch, verifyResponse } from './protocol.mjs';

const TF_PARTIAL_PAYMENT = 0x00020000;
export const DEFAULT_FEE_LIMIT_DROPS = 1000;
const UNSAFE = ['Memos', 'Paths', 'SendMax', 'DeliverMin', 'Delegate'];

export const invoiceHash = (invoiceId) => crypto.createHash('sha256').update(String(invoiceId), 'utf8').digest('hex').toUpperCase();
export const maxLastLedger = (currentLedger, maxTimeoutSeconds) => currentLedger + Math.ceil(maxTimeoutSeconds / 5) + 2;

// Envelope checks shared by both payload forms.
function envelope(pp, offered) {
  if (!pp || typeof pp !== 'object') return 'invalid_payload';
  if (pp.x402Version !== X402_VERSION) return 'invalid_x402_version';
  if (pp.accepted?.scheme !== SCHEME) return 'invalid_scheme';
  if (!APPROVED_NETWORKS.includes(pp.accepted?.network) || offered.network !== pp.accepted.network) return 'invalid_network';
  if (!requirementsMatch(pp.accepted, offered)) return 'invalid_payment_requirements';
  if (!pp.payload || typeof pp.payload !== 'object') return 'invalid_payload';
  return null;
}

// Verify a spec-form payload. ctx: { currentLedger, isSeen(hash), invoiceOpen(invoiceId) -> bool, feeLimitDrops, accountSequence?(addr) }
// Returns VerifyResponse + { txHash } (internal; the decoded tx is never returned to clients).
export function verifySignedBlob(pp, offered, ctx = {}) {
  const fail = (reason, extra = {}) => ({ ...verifyResponse(false, reason), ...extra });
  const env = envelope(pp, offered);
  if (env) return fail(env);
  const blob = pp.payload.signedTxBlob;
  if (typeof blob !== 'string' || !/^[0-9A-Fa-f]+$/.test(blob) || blob.length > 4096) return fail('invalid_payload');
  let tx, txHash;
  try { tx = decode(blob); txHash = hashes.hashSignedTx(blob); } catch { return fail('invalid_payload'); }
  const payer = tx.Account;
  if (ctx.isSeen?.(txHash)) return fail('duplicate_settlement', { txHash, payer });
  if (tx.TransactionType !== 'Payment') return fail('invalid_exact_xrpl_payload_transaction_type', { txHash });
  if (tx.Destination !== offered.payTo) return fail('invalid_exact_xrpl_payload_recipient_mismatch', { txHash });
  if (offered.extra?.destinationTag != null && tx.DestinationTag !== offered.extra.destinationTag) return fail('invalid_exact_xrpl_payload_recipient_mismatch', { txHash });
  const netId = Number(offered.network.split(':')[1]);
  if (netId <= 1024 ? tx.NetworkID != null : tx.NetworkID !== netId) return fail('invalid_exact_xrpl_payload_network_id', { txHash });
  const hasAmt = tx.Amount != null, hasDM = tx.DeliverMax != null;
  if (hasAmt === hasDM) return fail('invalid_exact_xrpl_payload_amount_mismatch', { txHash });
  const amt = hasDM ? tx.DeliverMax : tx.Amount;
  if (typeof amt !== 'string' || !/^\d+$/.test(amt) || amt !== String(offered.amount)) return fail('invalid_exact_xrpl_payload_amount_mismatch', { txHash });
  if (UNSAFE.some((k) => tx[k] != null) || ((tx.Flags ?? 0) & TF_PARTIAL_PAYMENT) || Number(tx.Fee) > (ctx.feeLimitDrops ?? DEFAULT_FEE_LIMIT_DROPS)) return fail('invalid_exact_xrpl_payload_unsafe_field', { txHash });
  const cur = ctx.currentLedger;
  if (!Number.isInteger(tx.LastLedgerSequence) || cur == null || tx.LastLedgerSequence > maxLastLedger(cur, offered.maxTimeoutSeconds) || tx.LastLedgerSequence < cur) return fail('invalid_exact_xrpl_payload_last_ledger_sequence', { txHash });
  const method = offered.extra?.assetTransferMethod || 'sequence';
  if (method === 'sequence' ? (tx.TicketSequence != null || !(tx.Sequence > 0)) : (tx.Sequence !== 0 || !(tx.TicketSequence > 0))) return fail('invalid_exact_xrpl_payload_sequence', { txHash });
  if (method === 'sequence' && ctx.accountSequence && ctx.accountSequence(payer) !== tx.Sequence) return fail('invalid_exact_xrpl_payload_sequence', { txHash });
  const inv = offered.extra?.invoiceId;
  if (inv && (String(tx.InvoiceID || '').toUpperCase() !== invoiceHash(inv) || (ctx.invoiceOpen && !ctx.invoiceOpen(inv)))) return fail('invalid_exact_xrpl_payload_invoice', { txHash });
  let sigOk = false;
  try { sigOk = verifySignature(blob); } catch { sigOk = false; }
  if (!sigOk) return fail('invalid_exact_xrpl_payload_signature', { txHash });
  return { ...verifyResponse(true, null, payer), txHash, amountDrops: amt };
}
