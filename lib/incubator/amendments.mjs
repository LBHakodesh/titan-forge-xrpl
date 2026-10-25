// Read-only XRPL Testnet amendment check for the Tier 3 path (Single Asset Vault / Lending Protocol) and the
// RLUSD Testnet issuer. Only read commands are ever sent; the recorded result below is what the UI shows until an
// operator triggers a read-only refresh (POST /api/incubator/amendments/refresh, localhost only).
export const READ_COMMANDS = new Set(['server_info', 'feature', 'account_info', 'gateway_balances']);
export const WATCHED_FEATURES = ['SingleAssetVault', 'LendingProtocol', 'LendingProtocolV1_1', 'PermissionedDEX', 'PermissionedDomains', 'Credentials', 'MPTokensV1'];
// RLUSD Testnet issuer as published in Ripple's RLUSD developer documentation; confirmed by account_info (Domain ripple.com).
export const RLUSD_TESTNET_ISSUER = 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV';
export const RLUSD_HEX = '524C555344000000000000000000000000000000';

// Recorded 2026-10-24 from wss://s.altnet.rippletest.net:51233 (network_id 1), read-only `feature`, `account_info`, `gateway_balances`.
export const RECORDED_CHECK = {
  mode: 'LIVE_TESTNET', readOnly: true, checkedAt: '2026-10-24T04:45:30Z', network: 'XRPL Testnet', networkId: 1, validatedLedger: 21778134, serverVersion: '3.4.1',
  features: {
    SingleAssetVault: { enabled: false, supported: true }, LendingProtocol: { enabled: false, supported: true }, LendingProtocolV1_1: { enabled: false, supported: true },
    PermissionedDEX: { enabled: true, supported: true }, PermissionedDomains: { enabled: true, supported: true }, Credentials: { enabled: true, supported: true }, MPTokensV1: { enabled: true, supported: true },
  },
  rlusd: { issuer: RLUSD_TESTNET_ISSUER, source: 'Ripple RLUSD developer documentation (Testnet issuer)', exists: true, domain: 'https://ripple.com/', obligationsRLUSD: '1254511280.909997', status: 'AVAILABLE' },
};

export function nativeLendingStatus(check = RECORDED_CHECK) {
  const f = check?.features || {};
  const on = f.SingleAssetVault?.enabled && f.LendingProtocol?.enabled;
  return on
    ? { status: 'ENABLED_ON_TESTNET_NOT_USED', note: 'Single Asset Vault and Lending Protocol are enabled on Testnet, but Tier 3 in this tab stays SIMULATION.' }
    : { status: 'UNAVAILABLE', note: 'Single Asset Vault / Lending Protocol amendments are not enabled on XRPL Testnet (supported by the server, not yet voted in). Native lending is UNAVAILABLE; Tier 3 is a SIMULATION of off-ledger creditor financing via an authorized lending partner.' };
}

const hexToAscii = (h) => { try { return Buffer.from(String(h || ''), 'hex').toString('utf8'); } catch { return null; } };

// request: async ({command,...}) -> {result}. Wrapped so only READ_COMMANDS can be sent.
export async function runAmendmentCheck(request, { now = () => new Date().toISOString() } = {}) {
  const read = (req) => { if (!READ_COMMANDS.has(req.command)) throw new Error(`incubator: ${req.command} is not a read command`); return request(req); };
  const si = (await read({ command: 'server_info' })).result.info;
  if (si.network_id !== 1) throw new Error(`Refusing: network_id ${si.network_id} is not XRPL Testnet`);
  const feats = (await read({ command: 'feature' })).result.features || {};
  const features = {};
  for (const v of Object.values(feats)) if (WATCHED_FEATURES.includes(v.name)) features[v.name] = { enabled: !!v.enabled, supported: !!v.supported };
  for (const n of WATCHED_FEATURES) features[n] ||= { enabled: false, supported: false, note: 'not reported by server' };
  let rlusd;
  try {
    const a = (await read({ command: 'account_info', account: RLUSD_TESTNET_ISSUER, ledger_index: 'validated' })).result.account_data;
    let obligations = null;
    try { obligations = (await read({ command: 'gateway_balances', account: RLUSD_TESTNET_ISSUER, ledger_index: 'validated' })).result.obligations?.[RLUSD_HEX] ?? null; } catch { /* optional */ }
    rlusd = { issuer: RLUSD_TESTNET_ISSUER, source: RECORDED_CHECK.rlusd.source, exists: true, domain: hexToAscii(a.Domain), obligationsRLUSD: obligations, status: 'AVAILABLE' };
  } catch (e) {
    rlusd = { issuer: RLUSD_TESTNET_ISSUER, source: RECORDED_CHECK.rlusd.source, exists: false, status: 'UNKNOWN', error: e?.data?.error || e.message };
  }
  return { mode: 'LIVE_TESTNET', readOnly: true, checkedAt: now(), network: 'XRPL Testnet', networkId: 1, validatedLedger: si.validated_ledger?.seq ?? null, serverVersion: si.build_version ?? null, features, rlusd };
}
