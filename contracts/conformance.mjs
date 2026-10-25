#!/usr/bin/env node
// Conformance test for an engine implementing the Titan Forge engine contract (contracts/README.md).
// Usage:
//   node contracts/conformance.mjs --bin ./target/release/titan-engine [--args "--flag x"]
//   node contracts/conformance.mjs --url http://127.0.0.1:9000/rpc
//   node contracts/conformance.mjs --bin node --args contracts/stub-engine.mjs      (JS reference stub)
// Exit code 0 = all checks pass. Sends only SIMULATION requests; never touches XRPL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RustEngineAdapter, StdioTransport, HttpTransport } from '../lib/engine/rust-adapter.mjs';
import { TemporaryDemoAdapter } from '../lib/engine/demo-adapter.mjs';
import { validate } from '../lib/engine/validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ex = (n) => JSON.parse(fs.readFileSync(path.join(HERE, 'examples', `${n}.example.json`), 'utf8'));

export async function runConformance(transport, { log = console.log } = {}) {
  const eng = new RustEngineAdapter(transport, { fallback: new TemporaryDemoAdapter(), timeoutMs: 5000 });
  const results = [];
  const t = async (name, fn) => {
    try { await fn(); results.push({ name, ok: true }); log(`  PASS ${name}`); }
    catch (e) { results.push({ name, ok: false, error: e.message }); log(`  FAIL ${name}: ${e.message}`); }
  };
  const expectErr = async (raw, code) => {
    const res = await transport.send(raw, 5000);
    const v = validate('rpc-response', res);
    if (!v.valid) throw new Error(`invalid envelope: ${JSON.stringify(v.errors)}`);
    if (res.ok || res.error.code !== code) throw new Error(`expected error ${code}, got ${JSON.stringify(res.error || res.result)}`);
  };
  let info;
  await t('info handshake (engine-info schema, contract major 1)', async () => { info = await eng.connect(); });
  await t('health', async () => { await eng.health(); });
  await t('strategy: example request', async () => { const r = await eng.strategyAsync(ex('strategy-request')); if (r.allocations.length !== 2) throw new Error('expected one allocation per market'); });
  await t('strategy: single spoke (ringsActive 1)', async () => {
    const r = await eng.strategyAsync({ markets: [{ marketId: 'token:BBL', capitalUsd: 100, ringsActive: 1 }], mode: 'SIMULATION' });
    if (r.allocations[0].allocation.rings.length > 1) throw new Error('returned more rings than ringsActive');
  });
  await t('strategy: REPLAY mode echoed', async () => { const r = await eng.strategyAsync({ markets: [{ marketId: 'currencies', capitalUsd: 1 }], mode: 'REPLAY' }); if (r.mode !== 'REPLAY') throw new Error(`mode ${r.mode}`); });
  if (info?.methods.includes('quote')) {
    for (const side of ['bid', 'ask']) await t(`quote: ${side}`, async () => { await eng.quoteAsync({ ...ex('quote-request'), side }); });
  }
  await t('error: unknown method -> UNKNOWN_METHOD', () => expectErr({ v: 1, id: 'c-unknown', method: 'nope', params: {} }, 'UNKNOWN_METHOD'));
  await t('error: wire v2 -> UNSUPPORTED_VERSION', () => expectErr({ v: 2, id: 'c-v2', method: 'info', params: {} }, 'UNSUPPORTED_VERSION'));
  await t('error: bad strategy params -> BAD_REQUEST', () => expectErr({ v: 1, id: 'c-bad', method: 'strategy', params: { markets: 'x' } }, 'BAD_REQUEST'));
  await t('label/authentic declared', async () => { if (!info) throw new Error('no info'); if (!info.authentic && !/not the authentic|placeholder|stub|demo/i.test(info.label)) throw new Error('non-authentic engine must say so in its label'); });
  eng.close();
  return { info, results, ok: results.every((r) => r.ok) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const bin = arg('--bin') || process.env.TF_ENGINE_BIN, url = arg('--url') || process.env.TF_ENGINE_URL;
  const args = (arg('--args') || process.env.TF_ENGINE_ARGS || '').split(' ').filter(Boolean);
  if (!bin && !url) { console.error('Usage: node contracts/conformance.mjs --bin <engine> [--args "..."] | --url <http://127.0.0.1:port/rpc>'); process.exit(2); }
  const transport = bin ? new StdioTransport(bin, args, { log: (m) => console.error(m) }) : new HttpTransport(url, { allowRemote: process.env.TF_ENGINE_ALLOW_REMOTE === '1' });
  console.log(`Titan Forge engine conformance (${bin ? `stdio ${bin} ${args.join(' ')}` : `http ${url}`})`);
  const r = await runConformance(transport);
  console.log(`${r.results.filter((x) => x.ok).length}/${r.results.length} passed${r.info ? ` · engine ${r.info.id} authentic=${r.info.authentic}` : ''}`);
  process.exit(r.ok ? 0 : 1);
}
