// Adapter from the shared Testnet Ledger (lib/ledger.mjs) to the pathfinder `io` interface.
// Reads are limited to an allowlist; every submit goes through Ledger.submit() (Testnet assert, per-role lock,
// TF_READONLY refusal).
const READ = new Set(['server_info', 'account_info', 'account_lines', 'account_offers', 'book_offers', 'ripple_path_find', 'ledger', 'tx', 'simulate']); // simulate is a dry run: rippled never applies or broadcasts it

export function testnetIO(ledger) {
  return {
    addresses: () => Object.fromEntries(Object.entries(ledger.wallets || {}).map(([role, w]) => [role, w.address])),
    async request(req) {
      if (!READ.has(req.command)) throw new Error(`pathfinder: ${req.command} is not an allowed read command`);
      if (!ledger.client.isConnected()) await ledger.connect();
      return ledger.client.request(req);
    },
    submit: (role, tx) => ledger.submit(role, tx),
  };
}
