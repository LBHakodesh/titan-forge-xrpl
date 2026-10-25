// XRPL / Ripple adapter. Mainnet: read-only via MainnetObserver (no wallet, read allowlist), labeled MAINNET_OBSERVED.
// Testnet: reuses existing recorded Titan Forge records and re-reads one with the read-only `tx` command.
// Never signs or submits anything.
import fs from 'node:fs';
import { MainnetObserver } from '../mainnet-observer.mjs';
import { makeAdapter, probedStatus, withTimeout, safeMessage } from './common.mjs';

export const RLUSD = { currency: '524C555344000000000000000000000000000000', issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De', label: 'RLUSD' };
export const WATCHED_AMENDMENTS = ['AMM', 'AMMClawback', 'Clawback', 'DID', 'PriceOracle', 'PermissionedDomains', 'PermissionedDEX', 'TokenEscrow', 'SingleAssetVault', 'Batch', 'LendingProtocol', 'DynamicNFT', 'Credentials'];
const EXPLORER_TESTNET = 'https://testnet.xrpl.org/transactions/';
const EXPLORER_MAINNET = 'https://livenet.xrpl.org/transactions/';

export function testnetRecords({ store, x402RunsFile } = {}) {
  const launches = (store?.launches || []).filter((l) => l.status === 'live');
  const steps = launches.flatMap((l) => (l.steps || []).filter((s) => s.hash).map((s) => ({ code: l.code, step: s.key, hash: s.hash, ledger: s.ledger ?? null, result: s.result ?? null })));
  let x402 = [];
  try { if (x402RunsFile && fs.existsSync(x402RunsFile)) x402 = JSON.parse(fs.readFileSync(x402RunsFile, 'utf8')).filter((r) => r.mode === 'LIVE_TESTNET' && r.result?.evidence?.transaction).map((r) => ({ runId: r.id, at: r.at, hash: r.result.evidence.transaction, explorer: EXPLORER_TESTNET + r.result.evidence.transaction })); } catch { x402 = []; }
  return { mode: 'LIVE_TESTNET', recorded: true, tokens: launches.map((l) => l.code), validatedTxCount: steps.length,
    latest: steps.slice(-3).map((s) => ({ ...s, explorer: EXPLORER_TESTNET + s.hash })), x402Settlements: x402,
    note: 'Recorded Titan Forge demo transactions (project-controlled accounts, organic:false).' };
}

export function createXrplAdapter({ env = process.env, samples = null, now = () => Date.now(), observer = () => new MainnetObserver(), ledger = null, ledgerReady = () => false, store = null, x402RunsFile = null, offline = false, timeoutMs = 12_000 } = {}) {
  return makeAdapter({
    id: 'xrpl', name: 'XRPL / Ripple', env, samples, now,
    docs: ['https://xrpl.org/docs/references/http-websocket-apis/public-api-methods', 'https://xrpl.org/docs/references/http-websocket-apis/public-api-methods/path-and-order-book-methods/book_offers', 'https://xrpl.org/docs/references/http-websocket-apis/public-api-methods/path-and-order-book-methods/amm_info', 'https://xrpl.org/docs/references/http-websocket-apis/admin-api-methods/status-and-debugging-methods/feature'],
    capability: 'Read-only Mainnet observation (validated ledger, funded order book, AMM pool, account offers, tx metadata, amendment status) plus recorded Titan Forge Testnet evidence. The only network that signs is Testnet, and only via lib/ledger.mjs — never from this adapter.',
    credentialEnv: [],
    computeStatus: (s) => probedStatus(s, 'DOCUMENTATION_ONLY'),
    extra: () => ({ mode: 'MAINNET_OBSERVED', testnet: testnetRecords({ store, x402RunsFile }), allowlistNote: 'MainnetObserver allowlist gained read-only account_offers and feature (public form, vetoed refused) on 2026-10-25.' }),
    runProbe: async ({ telemetry }) => {
      if (offline) return { ok: false, error: 'Offline replay mode: no network. Showing the stored sample.', countAsError: false };
      const obs = observer();
      const steps = {};
      const req = async (label, r) => {
        try { const out = await withTimeout(obs.request(r), timeoutMs, label); steps[label] = { ok: true }; return out.result; }
        catch (e) { steps[label] = { ok: false, error: safeMessage(e) }; return null; }
      };
      try {
        const si = await req('server_info', { command: 'server_info' });
        const led = await req('ledger', { command: 'ledger', ledger_index: 'validated' });
        const book = await req('book_offers', { command: 'book_offers', taker_gets: { currency: RLUSD.currency, issuer: RLUSD.issuer }, taker_pays: { currency: 'XRP' }, limit: 5, ledger_index: 'validated' });
        const amm = await req('amm_info', { command: 'amm_info', asset: { currency: 'XRP' }, asset2: { currency: RLUSD.currency, issuer: RLUSD.issuer }, ledger_index: 'validated' });
        const top = book?.offers?.[0];
        const ao = top ? await req('account_offers', { command: 'account_offers', account: top.Account, limit: 5, ledger_index: 'validated' }) : null;
        const tx = top?.PreviousTxnID ? await req('tx', { command: 'tx', transaction: top.PreviousTxnID }) : null;
        const feat = await req('feature', { command: 'feature' });
        if (!si || !led) return { ok: false, error: `Mainnet read failed: ${steps.server_info?.error || steps.ledger?.error}`, steps };
        const L = led.ledger || {};
        const features = Object.values(feat?.features || {});
        const result = {
          network: { networkId: si.info?.network_id ?? 0, buildVersion: si.info?.build_version ?? null, serverState: si.info?.server_state ?? null },
          validatedLedger: { index: Number(L.ledger_index ?? led.ledger_index), hash: L.ledger_hash || led.ledger_hash || null, closeTime: L.close_time_iso || null },
          bookOffers: book ? { pair: 'RLUSD (taker gets) / XRP (taker pays)', count: book.offers?.length ?? 0,
            top: (book.offers || []).slice(0, 3).map((o) => ({ account: o.Account, quality: o.quality, takerGets: o.TakerGets?.value ?? o.TakerGets, takerGetsFunded: o.taker_gets_funded?.value ?? o.taker_gets_funded ?? null, ownerFunds: o.owner_funds ?? null, fullyFunded: o.taker_gets_funded == null })) } : null,
          ammInfo: amm?.amm ? { account: amm.amm.account, xrpDrops: amm.amm.amount, rlusd: amm.amm.amount2?.value ?? null, tradingFee: amm.amm.trading_fee, lpTokenSupply: amm.amm.lp_token?.value ?? null } : null,
          accountOffers: ao ? { account: ao.account, count: ao.offers?.length ?? 0 } : null,
          txMetadata: tx ? { hash: tx.hash, type: tx.tx_json?.TransactionType || tx.TransactionType || null, result: tx.meta?.TransactionResult || null, affectedNodes: tx.meta?.AffectedNodes?.length ?? null, validated: !!tx.validated, ledger: tx.ledger_index ?? null, explorer: EXPLORER_MAINNET + tx.hash } : null,
          amendments: feat ? { total: features.length, enabled: features.filter((f) => f.enabled).length,
            watched: Object.fromEntries(WATCHED_AMENDMENTS.map((n) => { const f = features.find((x) => x.name === n); return [n, f ? (f.enabled ? 'enabled' : f.supported ? 'supported, not enabled' : 'not supported') : 'not reported']; })) } : null,
        };
        let testnetCheck = null;
        const rec = testnetRecords({ store, x402RunsFile });
        const h = rec.x402Settlements[0]?.hash || rec.latest[rec.latest.length - 1]?.hash;
        if (h && ledger?.client && ledgerReady()) {
          try {
            if (!ledger.client.isConnected()) await ledger.connect();
            const t = (await withTimeout(ledger.client.request({ command: 'tx', transaction: h }), timeoutMs, 'testnet tx')).result;
            testnetCheck = { mode: 'LIVE_TESTNET', hash: h, validated: !!t.validated, result: t.meta?.TransactionResult || null, ledger: t.ledger_index ?? null, explorer: EXPLORER_TESTNET + h };
          } catch (e) { testnetCheck = { mode: 'LIVE_TESTNET', hash: h, error: safeMessage(e) }; }
        }
        return { ok: true, mode: 'MAINNET_OBSERVED', steps, result, testnetCheck,
          sample: { mode: 'MAINNET_OBSERVED', source: 'wss://xrplcluster.com via lib/mainnet-observer.mjs (read allowlist)', probe: 'server_info, ledger, book_offers, amm_info, account_offers, tx, feature', result, testnetCheck } };
      } finally { try { await obs.disconnect(); } catch { /* ignore */ } }
    },
  });
}

export default createXrplAdapter();
