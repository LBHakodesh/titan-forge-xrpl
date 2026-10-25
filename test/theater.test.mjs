// Titan Ghost Engine Theater: pure, deterministic tests (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateScenario, SCENARIO_IDS, scenarioCatalog, sweep } from '../lib/theater/scenarios.mjs';
import { loadCapture, parseAsciicast, parseFrameList, sanitize } from '../lib/theater/capture.mjs';
import { loadHistory, refreshHistory, parseAccounts, txToFill, attribute, AWAITING_MSG } from '../lib/theater/mainnet-history.mjs';
import { liveTelemetry, mainnetSummary } from '../lib/theater/telemetry.mjs';
import { TemporaryDemoAdapter } from '../lib/engine/index.mjs';
import { CREATURES } from '../public/creatures.js';
import theater, { VT } from '../public/modules/05-theater.js';

const HEX64 = /\b[0-9A-Fa-f]{64}\b/;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-theater-'));

test('scenario catalog: four creatures with thresholds from public/creatures.js', () => {
  assert.deepEqual(SCENARIO_IDS, ['DOLPHIN', 'SHARK', 'WHALE', 'KRAKEN']);
  for (const s of scenarioCatalog()) {
    const c = CREATURES.find((x) => x.id === s.id);
    assert.equal(s.minXrp, c.min);
    assert.equal(s.mode, 'SIMULATION');
  }
});

test('scenarios are seeded, pure and deterministic', () => {
  for (const id of SCENARIO_IDS) {
    const a = generateScenario(id, { seed: 7 }), b = generateScenario(id, { seed: 7 });
    assert.equal(JSON.stringify(a), JSON.stringify(b), id);
  }
  assert.notEqual(JSON.stringify(generateScenario('SHARK', { seed: 1 })), JSON.stringify(generateScenario('SHARK', { seed: 2 })));
});

test('SIMULATION output: labels present, no tx hashes, sizes inside the creature band', () => {
  for (const id of SCENARIO_IDS) {
    const s = generateScenario(id, { seed: 3 });
    assert.equal(s.mode, 'SIMULATION'); assert.equal(s.hypothetical, true); assert.equal(s.totals.mode, 'SIMULATION');
    assert.ok(!HEX64.test(JSON.stringify(s)), `${id} contains a 64-hex string`);
    for (const st of s.steps) {
      assert.equal(st.mode, 'SIMULATION'); assert.equal(st.hash, null); assert.equal(st.inventory.mode, 'SIMULATION');
      assert.ok(st.sizeXrp >= s.assumptions.sizeBandXrp[0] && st.sizeXrp <= s.assumptions.sizeBandXrp[1], `${id} size ${st.sizeXrp}`);
      assert.ok(st.rings.length >= 1, `${id} fill touched no ring`);
    }
    if (s.optimization) { assert.equal(s.optimization.mode, 'SIMULATION'); assert.equal(s.optimization.hash, null); assert.equal(s.optimization.executed, false); }
  }
});

test('KRAKEN sweeps more than one ring, shifts inventory and adds an optimization step; DOLPHIN stays in VELOCITY', () => {
  const k = generateScenario('KRAKEN', { seed: 1 });
  const last = k.steps.at(-1);
  assert.ok(last.rings.length > 1, `kraken swept ${last.rings}`);
  assert.ok(k.totals.ringsSwept.length > 1);
  assert.ok(last.inventory.xrp < k.startInventory.xrp && last.inventory.rlusd > k.startInventory.rlusd);
  assert.ok(k.optimization && k.optimization.rings.length === 6);
  assert.ok(k.optimization.ringsRefilled.length >= 1);
  const d = generateScenario('DOLPHIN', { seed: 1 });
  assert.deepEqual(d.totals.ringsSwept, ['VELOCITY']);
  assert.equal(d.optimization, null);
});

test('scenario uses the engine seam allocate() it is given', () => {
  const eng = new TemporaryDemoAdapter();
  let calls = 0;
  const s = generateScenario('WHALE', { seed: 1, allocate: (c, o) => { calls++; return eng.allocate(c, o); }, engineLabel: eng.info().label });
  assert.ok(calls >= 1);
  assert.match(s.assumptions.engine, /Temporary/);
  assert.throws(() => generateScenario('GODZILLA'), /Unknown scenario/);
});

test('sweep walks rings innermost first and reports unfilled remainder', () => {
  const book = [{ id: 'A', spreadBps: 5, askUsd: 10, bidUsd: 0 }, { id: 'B', spreadBps: 15, askUsd: 10, bidUsd: 0 }];
  const r = sweep(book, 'ask', 25);
  assert.deepEqual(r.hits.map((h) => h.ring), ['A', 'B']);
  assert.equal(r.unfilledUsd, 5);
});

test('history loader: awaiting when TG_MAINNET_ACCOUNTS missing; secrets and junk rejected', async () => {
  const h = loadHistory({ env: {}, file: path.join(tmp(), 'h.json') });
  assert.equal(h.status, 'awaiting'); assert.equal(h.message, AWAITING_MSG); assert.equal(h.mode, 'HISTORICAL_MAINNET');
  assert.deepEqual(h.fills, []); assert.equal(h.pnl.status, 'not_attributable');
  const r = await refreshHistory({ env: {}, makeObserver: () => { throw new Error('must not connect'); } });
  assert.equal(r.status, 'awaiting');
  const p = parseAccounts({ TG_MAINNET_ACCOUNTS: 'snoPBrXtMeMyMHUVTgbuqAfg1SUTb, nope, rLXCWBHdR489cqwtcwai6QHEdFSkhFoFGP' });
  assert.deepEqual(p.accounts, ['rLXCWBHdR489cqwtcwai6QHEdFSkhFoFGP']);
  assert.equal(p.rejected.length, 2);
  assert.ok(!JSON.stringify(p).includes('snoPBrXtMeMyMHUVTgbuqAfg1SUTb'), 'secret echoed back');
});

test('history refresh goes through the observer, reports allowlist blocks honestly, caches', async () => {
  const file = path.join(tmp(), 'h.json');
  const acct = 'rLXCWBHdR489cqwtcwai6QHEdFSkhFoFGP';
  const seen = [];
  const fake = () => ({
    async request(req) {
      seen.push(req.command);
      if (req.command === 'account_info') return { result: { account_data: { Balance: '25000000' } } };
      if (req.command === 'account_lines') return { result: { lines: [{ currency: 'RLUSD', account: 'rIssuer', balance: '12.5' }] } };
      throw new Error(`Mainnet observer: ${req.command} is not an allowed read command`);
    },
    async disconnect() {},
  });
  const r = await refreshHistory({ env: { TG_MAINNET_ACCOUNTS: acct }, file, makeObserver: fake });
  assert.deepEqual(seen, ['account_info', 'account_lines', 'account_offers', 'account_tx']);
  assert.equal(r.inventory[0].xrp, 25); assert.equal(r.inventory[0].lines[0].currency, 'RLUSD');
  assert.deepEqual(r.blocked.map((b) => b.command).sort(), ['account_offers', 'account_tx']);
  assert.deepEqual(r.fills, []); assert.equal(r.pnl.status, 'not_attributable');
  const cached = loadHistory({ env: { TG_MAINNET_ACCOUNTS: acct }, file });
  assert.equal(cached.status, 'loaded'); assert.equal(cached.cached, true);
});

test('txToFill keeps only real successful balance-changing trades; P&L is never invented', () => {
  const acct = 'rLXCWBHdR489cqwtcwai6QHEdFSkhFoFGP';
  const entry = {
    hash: 'A'.repeat(64), ledger_index: 5, close_time_iso: '2026-01-01T00:00:00Z',
    tx_json: { TransactionType: 'OfferCreate', Account: acct, Fee: '12' },
    meta: { TransactionResult: 'tesSUCCESS', AffectedNodes: [
      { ModifiedNode: { LedgerEntryType: 'AccountRoot', FinalFields: { Account: acct, Balance: '89999988' }, PreviousFields: { Balance: '100000000' } } },
      { ModifiedNode: { LedgerEntryType: 'RippleState', FinalFields: { Balance: { currency: 'USD', issuer: 'rrrrrrrrrrrrrrrrrrrrBZbvji', value: '-20' }, HighLimit: { currency: 'USD', issuer: 'rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX', value: '0' }, LowLimit: { currency: 'USD', issuer: acct, value: '1000' } }, PreviousFields: { Balance: { currency: 'USD', issuer: 'rrrrrrrrrrrrrrrrrrrrBZbvji', value: '0' } } } },
    ] },
  };
  const f = txToFill(entry, acct);
  assert.ok(f); assert.equal(f.mode, 'HISTORICAL_MAINNET'); assert.equal(f.hash, 'A'.repeat(64));
  assert.ok(Math.abs(f.deltas.XRP + 10) < 1e-9, JSON.stringify(f.deltas));
  assert.equal(txToFill({ ...entry, meta: { ...entry.meta, TransactionResult: 'tecUNFUNDED_OFFER' } }, acct), null);
  assert.equal(attribute([]).status, 'not_attributable');
  assert.equal(attribute([f]).status, 'flows_only');
  assert.match(attribute([f]).reason, /not attributable/);
});

test('capture loader: none without files; parses asciicast v2 and frame lists; redacts seeds', () => {
  const dir = tmp();
  const none = loadCapture(undefined, dir);
  assert.equal(none.status, 'none'); assert.match(none.message, /No authentic capture loaded/);
  const cast = [JSON.stringify({ version: 2, width: 80, height: 24 }), JSON.stringify([0.1, 'o', '\x1b[2J\x1b[1;1HTITAN seed snoPBrXtMeMyMHUVTgbuqAfg1SUTb']), JSON.stringify([0.2, 'i', 'typed secret']), JSON.stringify([0.5, 'o', 'more'])].join('\n');
  fs.writeFileSync(path.join(dir, 'a.cast'), cast);
  const c = loadCapture('a.cast', dir);
  assert.equal(c.status, 'loaded'); assert.equal(c.format, 'asciicast-v2'); assert.equal(c.frames.length, 2); assert.equal(c.mode, 'REPLAY');
  assert.ok(!JSON.stringify(c).includes('snoPBrXtMeMyMHUVTgbuqAfg1SUTb')); assert.ok(!JSON.stringify(c).includes('typed secret'));
  const j = parseFrameList({ width: 40, height: 10, frames: [{ t: 0, text: 'a' }, { t: 1, text: 'b' }] });
  assert.equal(j.kind, 'snapshots'); assert.equal(j.frames.length, 2);
  assert.throws(() => parseAsciicast('{"version":1}'), /version/);
  assert.equal(sanitize('private_key: ' + 'B'.repeat(64)), 'private_key: [REDACTED]');
  assert.equal(sanitize('tx ' + 'C'.repeat(64)), 'tx ' + 'C'.repeat(64)); // tx hashes stay
});

test('live telemetry is derived only from recorded runs; empty input -> not attributable', () => {
  const empty = liveTelemetry([]);
  assert.equal(empty.mode, 'LIVE_TESTNET'); assert.equal(empty.payments, 0); assert.equal(empty.pnl.status, 'not_attributable');
  const runs = [{ feeXrp: 0.00001, mids: { BBL: 0.009 }, actions: [{ role: 'maker', hash: 'H1' }], payments: [{ status: 'success', hash: 'H2', route: 'xrp_to_token', from: 'XRP', to: 'BBL', sizeXrp: 1, attribution: { totalXrp: 1, bridged: false, execBpsVsMid: 20, capturedBy: { rival: 0 }, fills: [{ role: 'maker', code: 'BBL', side: 'ask', xrp: 1, priceXrp: 0.0091, edgeXrp: 0.01 }] } }] }];
  const t = liveTelemetry(runs);
  assert.equal(t.payments, 1); assert.equal(t.pnl.spreadCaptureXrp, 0.01); assert.equal(t.fees.txs, 2);
  assert.equal(t.fills[0].hash, 'H2');
  assert.equal(mainnetSummary(null).status, 'unavailable');
});

test('UI module contract and VT screen', () => {
  assert.equal(theater.id, 'theater'); assert.equal(theater.order, 5); assert.equal(theater.title, 'Watch Titan Ghost');
  const vt = new VT(20, 4);
  vt.write('\x1b[2J\x1b[1;1H\x1b[32mOK\x1b[0m\r\nline2');
  const html = vt.html((s) => s);
  assert.match(html, /color:#0dbc79/); assert.match(html, /line2/);
  const src = fs.readFileSync(new URL('../public/modules/05-theater.js', import.meta.url), 'utf8');
  for (const s of ['Browser recreation of the Titan Ghost TUI layout', 'no authentic capture loaded', 'tf:present', 'requestFullscreen', 'TitanTheater', 'SHADOW-ONLY']) assert.ok(src.includes(s), s);
});
