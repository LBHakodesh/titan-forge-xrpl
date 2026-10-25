// Read-only XRPL Mainnet client. Holds no wallet and exposes only an allowlist of read commands,
// so it is structurally unable to sign or submit. All output is labeled MAINNET_OBSERVED.
import { Client } from 'xrpl';

export const MAINNET_WSS = 'wss://xrplcluster.com';
const READ_COMMANDS = new Set(['server_info', 'ledger', 'tx', 'book_offers', 'account_info', 'account_lines', 'ripple_path_find', 'amm_info', 'ledger_closed', 'ledger_current',
  // Added 2026-10-25 (Workstream F, vendors): both read-only. `feature` only in its public query form (no `vetoed`).
  'account_offers', 'feature',
  // Added 2026-10-25 (lead, for Theater HISTORICAL_MAINNET): read-only account history.
  'account_tx']);

export class MainnetObserver {
  constructor(url = MAINNET_WSS) { this.client = new Client(url); }
  async request(req) {
    if (!READ_COMMANDS.has(req.command)) throw new Error(`Mainnet observer: ${req.command} is not an allowed read command`);
    if (req.command === 'feature' && 'vetoed' in req) throw new Error('Mainnet observer: feature vetoed (admin vote) is not a read command');
    if (!this.client.isConnected()) await this.client.connect();
    return this.client.request(req);
  }
  async disconnect() { if (this.client.isConnected()) await this.client.disconnect(); }
}
