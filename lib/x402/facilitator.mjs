// Local x402 facilitators. This node acts as its OWN facilitator for the demo — no external facilitator,
// no production endpoint, no paid service is ever called.
//   SimFacilitator          SIMULATION: verifies spec-form XRPL blobs offline, "settles" as a labeled fixture. No ledger.
//   LiveTestnetFacilitator  LIVE_TESTNET: tightly budgeted demo payment router -> issuer. Spec form: router signs offline
//                           (ledger.signOffline under ledger.exclusive('router')), this node verifies and submits (ledger.submitSigned).
import crypto from 'node:crypto';
import { Wallet, decode, encode } from 'xrpl';
import { guardCheck } from '../guardian.mjs';
import { settlementResponse, paymentPayload, EXPLORER_TX, xrpToDropsStr } from './protocol.mjs';
import { verifySignedBlob, invoiceHash, DEFAULT_FEE_LIMIT_DROPS } from './xrpl-exact.mjs';

export const LIVE_LIMITS = { maxPriceDrops: 100_000, sessionBudgetDrops: 1_000_000 }; // 0.1 XRP / request, 1 XRP / process session

// Open 402 challenges. Each challenge has a unique invoiceId the payment must bind to (InvoiceID = sha256(invoiceId)).
export class InvoiceBook {
  constructor({ now = () => Date.now(), max = 2000 } = {}) { this.now = now; this.max = max; this.items = new Map(); }
  issue({ resource, amountDrops, ttlMs }) {
    this.gc();
    const id = `tf-${crypto.randomUUID()}`;
    this.items.set(id, { id, resource, amountDrops: String(amountDrops), expiresAt: this.now() + ttlMs, consumed: false });
    if (this.items.size > this.max) this.items.delete(this.items.keys().next().value);
    return id;
  }
  get(id) { return this.items.get(id) || null; }
  isOpen(id) { const i = this.items.get(id); return !!i && !i.consumed && i.expiresAt > this.now(); }
  consume(id) { const i = this.items.get(id); if (i) i.consumed = true; }
  gc() { const t = this.now(); for (const [k, v] of this.items) if (v.expiresAt + 600_000 < t) this.items.delete(k); }
}

// Replay cache keyed on canonical tx hash / intent id (spec: duplicate settlement mitigation).
export class ReplayCache {
  constructor(max = 5000) { this.max = max; this.set = new Set(); }
  has(k) { return this.set.has(k); }
  add(k) { if (this.set.has(k)) return false; this.set.add(k); if (this.set.size > this.max) this.set.delete(this.set.values().next().value); return true; }
}

// Simulated ledger clock so LastLedgerSequence windows are meaningful offline (~4 s per ledger).
export const simLedgerClock = (now = () => Date.now(), base = 9_000_000, t0 = now()) => () => base + Math.floor((now() - t0) / 4000);

// SIMULATION payer: an ephemeral, never-funded, in-memory keypair created at start-up. It signs fixture blobs
// that are verified offline and never submitted to any network. It is not a demo role and holds nothing.
export class SimPayer {
  constructor() { this.wallet = Wallet.generate(); this.seq = 1; }
  get address() { return this.wallet.address; }
  authorize(offered, { currentLedger, tamper = null, resource } = {}) {
    const accepted = JSON.parse(JSON.stringify(offered));
    if (tamper === 'network') accepted.network = 'eip155:8453';
    if (tamper === 'mainnet') accepted.network = 'xrpl:0';
    const tx = {
      TransactionType: 'Payment', Account: this.address, Destination: offered.payTo,
      Amount: tamper === 'underpay' ? String(Math.max(1, Number(offered.amount) - 1)) : String(offered.amount),
      Fee: '12', Sequence: this.seq++, LastLedgerSequence: currentLedger + 6,
      ...(offered.extra?.invoiceId ? { InvoiceID: invoiceHash(offered.extra.invoiceId) } : {}),
    };
    let blob = this.wallet.sign(tx).tx_blob;
    if (tamper === 'signature') {
      const d = decode(blob);
      const s = d.TxnSignature;
      d.TxnSignature = s.slice(0, -4) + (s.slice(-4) === '0000' ? '1111' : '0000');
      blob = encode(d);
    }
    return paymentPayload({ accepted, payload: { signedTxBlob: blob }, resource });
  }
}

export class SimFacilitator {
  constructor({ invoices, replay = new ReplayCache(), currentLedger, feeLimitDrops = DEFAULT_FEE_LIMIT_DROPS } = {}) {
    this.mode = 'SIMULATION'; this.invoices = invoices; this.replay = replay; this.currentLedger = currentLedger; this.feeLimitDrops = feeLimitDrops;
  }
  supported() { return { kinds: [{ x402Version: 2, scheme: 'exact', network: 'xrpl:1', extra: { facilitator: 'local SIMULATION fixture (this node)' } }], extensions: [], signers: {} }; }
  verify(pp, offered) {
    return verifySignedBlob(pp, offered, { currentLedger: this.currentLedger(), isSeen: (h) => this.replay.has(h), invoiceOpen: (i) => this.invoices.isOpen(i), feeLimitDrops: this.feeLimitDrops });
  }
  // Re-verifies, records the hash atomically, consumes the invoice. Nothing is broadcast: evidence kind is SIMULATED_FIXTURE.
  settle(pp, offered) {
    const v = this.verify(pp, offered);
    if (!v.isValid) return { verify: v, settlement: settlementResponse({ success: false, errorReason: v.invalidReason, network: offered.network, transaction: '' }), evidence: null };
    if (!this.replay.add(v.txHash)) return { verify: { isValid: false, invalidReason: 'duplicate_settlement' }, settlement: settlementResponse({ success: false, errorReason: 'duplicate_settlement', network: offered.network }), evidence: null };
    if (offered.extra?.invoiceId) this.invoices.consume(offered.extra.invoiceId);
    return {
      verify: v,
      settlement: settlementResponse({ success: true, payer: v.payer, transaction: v.txHash, network: offered.network, amount: offered.amount }),
      evidence: { kind: 'SIMULATED_FIXTURE', mode: 'SIMULATION', transaction: v.txHash, validated: false, simulated: true, explorer: null, network: offered.network, asset: offered.asset, amountDrops: offered.amount },
    };
  }
}

export class LiveTestnetFacilitator {
  constructor({ ledger, isReady = () => false, invoices, replay = new ReplayCache(), now = () => Date.now(), env = process.env, limits = LIVE_LIMITS, feeLimitDrops = DEFAULT_FEE_LIMIT_DROPS } = {}) {
    Object.assign(this, { ledger, isReady, invoices, replay, now, env, limits, feeLimitDrops });
    this.mode = 'LIVE_TESTNET'; this.spentDrops = 0; this.reservedDrops = 0;
  }
  payerAddress() { return this.ledger?.wallets?.router?.address || null; }
  payTo() { return this.ledger?.wallets?.issuer?.address || null; }
  budget() { return { sessionBudgetDrops: this.limits.sessionBudgetDrops, spentDrops: this.spentDrops, reservedDrops: this.reservedDrops, remainingDrops: this.limits.sessionBudgetDrops - this.spentDrops - this.reservedDrops, maxPriceDrops: this.limits.maxPriceDrops }; }
  async currentLedger() { return this.ledger.client.getLedgerIndex(); }

  // Every precondition for a live settlement; returns all failing reasons. Pure (no ledger calls).
  preflight({ amountDrops, approval }) {
    const reasons = [];
    const amountXrp = Number(amountDrops) / 1e6;
    const guardian = guardCheck({ mode: 'LIVE_TESTNET', txType: 'Payment', role: 'router', amountXrp, requiresApproval: true, approved: approval === true });
    if (this.env.TF_READONLY === '1') reasons.push('Read-only instance: live settlement refused (TF_READONLY=1).');
    if (!this.isReady()) reasons.push('Testnet ledger not ready.');
    if (!this.payerAddress() || !this.payTo()) reasons.push('Demo router/issuer wallets not loaded.');
    if (approval !== true) reasons.push('Explicit approval:true is required for each live run.');
    if (!(Number(amountDrops) > 0 && Number(amountDrops) <= this.limits.maxPriceDrops)) reasons.push(`Price must be > 0 and <= ${this.limits.maxPriceDrops / 1e6} XRP per request.`);
    if (Number(amountDrops) > this.budget().remainingDrops) reasons.push(`Exceeds remaining session budget (${this.budget().remainingDrops / 1e6} XRP left of ${this.limits.sessionBudgetDrops / 1e6} XRP).`);
    for (const r of guardian.reasons) reasons.push(`Guardian: ${r}`);
    return { allowed: reasons.length === 0, reasons, guardian };
  }

  // Facilitator side for a spec-form payload: verify the blob exactly as in SIMULATION (plus payer = router),
  // record its hash, submit it, and accept only validated tesSUCCESS with delivered_amount == price.
  async settleBlob(pp, offered, { approval, currentLedger } = {}) {
    const net = offered.network;
    const failed = (reason, extra = {}) => ({ settlement: settlementResponse({ success: false, errorReason: reason, network: net }), evidence: null, ...extra });
    const pre = this.preflight({ amountDrops: offered.amount, approval });
    if (!pre.allowed) return failed('unexpected_settle_error', { verify: { isValid: false, invalidReason: 'preflight_refused' }, refused: pre });
    const cur = currentLedger ?? await this.currentLedger();
    const v = verifySignedBlob(pp, offered, { currentLedger: cur, isSeen: (h) => this.replay.has(h), invoiceOpen: (i) => this.invoices.isOpen(i), feeLimitDrops: this.feeLimitDrops });
    if (v.isValid && v.payer !== this.payerAddress()) return failed('invalid_payload', { verify: { isValid: false, invalidReason: 'invalid_payload' } });
    if (!v.isValid) return failed(v.invalidReason, { verify: v, preflight: pre });
    if (!this.replay.add(v.txHash)) return failed('duplicate_settlement', { verify: { isValid: false, invalidReason: 'duplicate_settlement' } });
    if (offered.extra?.invoiceId) this.invoices.consume(offered.extra.invoiceId);
    const amt = String(offered.amount);
    this.reservedDrops += Number(amt);
    let out;
    try {
      out = await this.ledger.submitSigned(pp.payload.signedTxBlob);
    } catch (e) {
      this.reservedDrops -= Number(amt); this.spentDrops += Number(amt); // a signed blob may have been broadcast: count it against the budget
      return failed(e.tx ? 'invalid_transaction_state' : 'unexpected_settle_error', { verify: v, preflight: pre, error: e.message, txHash: e.tx?.hash || v.txHash });
    }
    this.reservedDrops -= Number(amt); this.spentDrops += Number(amt);
    const delivered = out.meta?.delivered_amount ?? out.meta?.DeliveredAmount;
    const ok = out.validated === true && out.result === 'tesSUCCESS' && String(delivered) === amt && out.hash === v.txHash;
    if (!ok) return failed('invalid_transaction_state', { verify: v, preflight: pre, txHash: out.hash });
    return {
      verify: v, preflight: pre,
      settlement: settlementResponse({ success: true, payer: v.payer, transaction: out.hash, network: net, amount: amt }),
      evidence: { kind: 'LIVE_TESTNET_VALIDATED', mode: 'LIVE_TESTNET', transaction: out.hash, ledger: out.ledger, validated: true, result: out.result, deliveredDrops: String(delivered), explorer: EXPLORER_TX + out.hash, network: net, asset: offered.asset, amountDrops: amt },
    };
  }

  // Full live purchase: under the router signing lock, the router role signs a spec-form XRPL Payment
  // (AUTHORIZATION), then this node verifies and submits it (VERIFICATION, SETTLEMENT). Never calls ledger.submit().
  async purchase(offered, { approval, resource } = {}) {
    const pre = this.preflight({ amountDrops: offered.amount, approval });
    if (!pre.allowed) return { settlement: settlementResponse({ success: false, errorReason: 'unexpected_settle_error', network: offered.network }), evidence: null, verify: { isValid: false, invalidReason: 'preflight_refused' }, refused: pre };
    return this.ledger.exclusive('router', async () => {
      let pp, cur;
      try {
        cur = await this.currentLedger();
        const tx = { TransactionType: 'Payment', Destination: offered.payTo, Amount: String(offered.amount), LastLedgerSequence: cur + Math.ceil(offered.maxTimeoutSeconds / 5),
          ...(offered.extra?.invoiceId ? { InvoiceID: invoiceHash(offered.extra.invoiceId) } : {}) };
        const { signedTxBlob } = await this.ledger.signOffline('router', tx);
        pp = paymentPayload({ accepted: JSON.parse(JSON.stringify(offered)), payload: { signedTxBlob }, resource });
      } catch (e) {
        return { settlement: settlementResponse({ success: false, errorReason: 'unexpected_settle_error', network: offered.network }), evidence: null, verify: { isValid: false, invalidReason: 'authorization_failed' }, error: e.message };
      }
      const s = await this.settleBlob(pp, offered, { approval, currentLedger: cur });
      return { ...s, payload: pp };
    });
  }
}

export { xrpToDropsStr };
