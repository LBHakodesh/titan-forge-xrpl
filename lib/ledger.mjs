// XRPL Testnet adapter for the Titan Forge demo loop.
// Testnet only: every signing path goes through assertTestnet().
import { Client, Wallet, xrpToDrops, dropsToXrp, AccountSetAsfFlags, OfferCreateFlags } from 'xrpl';
import fs from 'node:fs';
import path from 'node:path';

export const TESTNET_WSS = 'wss://s.altnet.rippletest.net:51233';
const TESTNET_NETWORK_ID = 1;
const EXPLORER = 'https://testnet.xrpl.org/transactions/';
const TOPUP_BELOW_XRP = 25;
export const ROLES = ['issuer', 'maker', 'taker', 'rival', 'router', 'router2', 'router3']; // router2/3: parallel Pathfinder payers (operator decision 2026-10-25)

// Demo trade parameters (XRP per token). Deliberately tiny.
export const QUOTE = { ask: '0.01', bid: '0.008', askQty: 1000, bidQty: 100, fillQty: 100 };

export class Ledger {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.walletFile = path.join(dataDir, 'wallets.json');
    this.client = new Client(TESTNET_WSS);
    this.wallets = null;
  }

  async connect() {
    if (!this.client.isConnected()) await this.client.connect();
    await this.assertTestnet();
  }

  async assertTestnet() {
    if (this.client.url !== TESTNET_WSS) throw new Error('Refusing: client is not pointed at XRPL Testnet');
    const info = await this.client.request({ command: 'server_info' });
    const id = info.result.info.network_id;
    if (id !== TESTNET_NETWORK_ID) throw new Error(`Refusing: network_id ${id} is not Testnet`);
    return info.result.info;
  }

  // Load or create the demo roles. Seeds stay on disk (0600), never sent to clients.
  // rival: a second, competing demo maker. router: demo payer that sends pathfound cross-currency payments.
  async bootstrap(log = () => {}) {
    await this.connect();
    const readonly = process.env.TF_READONLY === '1';
    const raw = fs.existsSync(this.walletFile) ? JSON.parse(fs.readFileSync(this.walletFile, 'utf8')) : { network: 'testnet', roles: {} };
    let added = false;
    for (const role of ROLES) if (!raw.roles[role] && !readonly) { raw.roles[role] = Wallet.generate().seed; added = true; }
    if (added) fs.writeFileSync(this.walletFile, JSON.stringify(raw, null, 2), { mode: 0o600 });
    this.wallets = Object.fromEntries(Object.entries(raw.roles).map(([k, s]) => [k, Wallet.fromSeed(s)]));
    for (const [role, w] of Object.entries(this.wallets)) {
      const bal = await this.xrpBalance(w.address);
      if ((bal === null || bal < TOPUP_BELOW_XRP) && !readonly) {
        log(`Funding ${role} from Testnet faucet`);
        await this.client.fundWallet(w);
      }
    }
    // Issuer must ripple so holders can trade the token with each other.
    const issuerInfo = await this.client.request({ command: 'account_info', account: this.wallets.issuer.address });
    const defaultRipple = (issuerInfo.result.account_data.Flags & 0x00800000) !== 0;
    if (!defaultRipple && !readonly) {
      log('Enabling DefaultRipple on issuer');
      await this.submit('issuer', { TransactionType: 'AccountSet', SetFlag: AccountSetAsfFlags.asfDefaultRipple });
    }
  }

  async xrpBalance(address) {
    try {
      const r = await this.client.request({ command: 'account_info', account: address, ledger_index: 'validated' });
      return Number(dropsToXrp(r.result.account_data.Balance));
    } catch (e) {
      if (e.data?.error === 'actNotFound') return null;
      throw e;
    }
  }

  async status() {
    await this.connect();
    const info = await this.assertTestnet();
    const accounts = {};
    for (const [role, w] of Object.entries(this.wallets)) {
      const r = await this.client.request({ command: 'account_info', account: w.address, ledger_index: 'validated' }).catch(() => null);
      if (!r) { accounts[role] = { address: w.address, xrp: 0, ownerCount: 0, unfunded: true }; continue; }
      accounts[role] = {
        address: w.address,
        xrp: Number(dropsToXrp(r.result.account_data.Balance)),
        ownerCount: r.result.account_data.OwnerCount,
      };
    }
    return { network: 'XRPL Testnet', networkId: info.network_id, validatedLedger: info.validated_ledger?.seq, accounts };
  }

  // Serialized per signing account so concurrent features never race on Sequence numbers.
  submit(role, tx) {
    this.locks ??= new Map();
    const prev = this.locks.get(role) || Promise.resolve();
    const run = prev.catch(() => {}).then(() => this.#submit(role, tx));
    this.locks.set(role, run);
    return run;
  }

  // Run fn while holding the signing lock for `role` (e.g. sign offline -> verify -> submit blob, with no Sequence race).
  exclusive(role, fn) {
    this.locks ??= new Map();
    const prev = this.locks.get(role) || Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    this.locks.set(role, run);
    return run;
  }

  // x402 exact-XRPL payer side: autofill + sign without submitting. Testnet only. Call inside exclusive(role, ...).
  async signOffline(role, tx) {
    if (process.env.TF_READONLY === '1') throw new Error('Read-only instance: signing disabled');
    await this.assertTestnet();
    const wallet = this.wallets[role];
    if (!wallet) throw new Error(`Unknown demo role ${role}`);
    const prepared = await this.client.autofill({ ...tx, Account: wallet.address });
    const { tx_blob, hash } = wallet.sign(prepared);
    return { signedTxBlob: tx_blob, hash };
  }

  // Facilitator side: submit an already-signed blob and wait for validation. Testnet only.
  async submitSigned(signedTxBlob) {
    if (process.env.TF_READONLY === '1') throw new Error('Read-only instance: transaction submission disabled');
    await this.assertTestnet();
    const res = await this.client.submitAndWait(signedTxBlob);
    const result = res.result.meta?.TransactionResult;
    const out = { hash: res.result.hash, result, ledger: res.result.ledger_index, validated: res.result.validated, explorer: EXPLORER + res.result.hash, meta: res.result.meta };
    if (result !== 'tesSUCCESS') { const err = new Error(`Signed transaction failed: ${result}`); err.tx = out; throw err; }
    return out;
  }

  async #submit(role, tx) {
    if (process.env.TF_READONLY === '1') throw new Error('Read-only instance: transaction submission disabled');
    await this.assertTestnet();
    const wallet = this.wallets[role];
    if (!wallet) throw new Error(`Unknown demo role ${role}`);
    const res = await this.client.submitAndWait({ ...tx, Account: wallet.address }, { autofill: true, wallet });
    const result = res.result.meta?.TransactionResult;
    const out = { hash: res.result.hash, result, ledger: res.result.ledger_index, validated: res.result.validated, explorer: EXPLORER + res.result.hash, meta: res.result.meta };
    if (result !== 'tesSUCCESS') {
      const err = new Error(`${tx.TransactionType} failed: ${result}`);
      err.tx = out;
      throw err;
    }
    return out;
  }

  token(code, value) {
    return { currency: code, issuer: this.wallets.issuer.address, value: String(value) };
  }

  async tokenBalance(address, code) {
    const r = await this.client.request({ command: 'account_lines', account: address, peer: this.wallets.issuer.address, ledger_index: 'validated' });
    const line = r.result.lines.find((l) => l.currency === code);
    return line ? Number(line.balance) : 0;
  }

  async book(code) {
    const tok = { currency: code, issuer: this.wallets.issuer.address };
    const [asks, bids] = await Promise.all([
      this.client.request({ command: 'book_offers', taker_gets: tok, taker_pays: { currency: 'XRP' }, ledger_index: 'validated', limit: 10 }),
      this.client.request({ command: 'book_offers', taker_gets: { currency: 'XRP' }, taker_pays: tok, ledger_index: 'validated', limit: 10 }),
    ]);
    const side = (offers, isAsk) => offers.map((o) => {
      const gets = o.taker_gets_funded ?? o.TakerGets;
      const pays = o.taker_pays_funded ?? o.TakerPays;
      const tokenQty = Number(isAsk ? gets.value : pays.value);
      const xrp = Number(dropsToXrp(isAsk ? pays : gets));
      return { account: o.Account, qty: tokenQty, priceXrp: +(xrp / tokenQty).toPrecision(6) };
    });
    return { asks: side(asks.result.offers, true), bids: side(bids.result.offers, false) };
  }

  // The live demo loop. `step(key, fn)` records progress for the UI.
  async launch(spec, step) {
    const { code, supply } = spec;
    const { issuer, maker, taker } = this.wallets;
    const limit = String(supply);

    await step('trust_maker', () => this.submit('maker', { TransactionType: 'TrustSet', LimitAmount: this.token(code, limit) }));
    await step('trust_taker', () => this.submit('taker', { TransactionType: 'TrustSet', LimitAmount: this.token(code, limit) }));
    await step('issue', () => this.submit('issuer', { TransactionType: 'Payment', Destination: maker.address, Amount: this.token(code, supply) }));
    await step('ask', () => this.submit('maker', {
      TransactionType: 'OfferCreate',
      TakerGets: this.token(code, QUOTE.askQty),
      TakerPays: xrpToDrops((QUOTE.askQty * Number(QUOTE.ask)).toFixed(6)),
    }));
    await step('bid', () => this.submit('maker', {
      TransactionType: 'OfferCreate',
      TakerGets: xrpToDrops((QUOTE.bidQty * Number(QUOTE.bid)).toFixed(6)),
      TakerPays: this.token(code, QUOTE.bidQty),
    }));
    // Controlled counterparty: immediate-or-cancel so nothing rests if it doesn't cross.
    const fill = await step('fill', () => this.submit('taker', {
      TransactionType: 'OfferCreate',
      TakerGets: xrpToDrops((QUOTE.fillQty * Number(QUOTE.ask)).toFixed(6)),
      TakerPays: this.token(code, QUOTE.fillQty),
      Flags: OfferCreateFlags.tfImmediateOrCancel,
    }));
    return step('verify', async () => {
      const [takerTok, makerTok, book] = await Promise.all([
        this.tokenBalance(taker.address, code),
        this.tokenBalance(maker.address, code),
        this.book(code),
      ]);
      if (takerTok < QUOTE.fillQty) throw new Error(`Fill not reflected: taker holds ${takerTok} ${code}`);
      return { takerTokens: takerTok, makerTokens: makerTok, book, fillHash: fill.hash, issuer: issuer.address };
    });
  }

  async disconnect() {
    if (this.client.isConnected()) await this.client.disconnect();
  }
}
