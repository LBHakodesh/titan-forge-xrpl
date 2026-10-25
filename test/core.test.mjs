import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLaunch } from '../lib/validate.mjs';
import { guardCheck } from '../lib/guardian.mjs';
import { Ledger } from '../lib/ledger.mjs';
import { allocateRings, PROFILES } from '../public/domain.js';

const ok = { name: 'Brooklyn Bullies', code: 'bbl', supply: 1_000_000, category: 'community', consent: true };

test('valid launch normalizes ticker', () => {
  const v = validateLaunch(ok);
  assert.equal(v.ok, true);
  assert.equal(v.value.code, 'BBL');
});

test('rejects reserved tickers, brands, backing claims, missing consent', () => {
  assert.equal(validateLaunch({ ...ok, code: 'USD' }).ok, false);
  assert.equal(validateLaunch({ ...ok, code: 'XRP' }).ok, false);
  assert.equal(validateLaunch({ ...ok, name: 'Coinbase Coin' }).ok, false);
  assert.equal(validateLaunch({ ...ok, description: 'Fully gold backed' }).ok, false);
  assert.equal(validateLaunch({ ...ok, consent: 'yes' }).ok, false);
  assert.equal(validateLaunch({ ...ok, supply: 10 }).ok, false);
  assert.equal(validateLaunch({ ...ok, name: '<script>' }).ok, false);
});

test('guardian blocks unauthorized live actions', () => {
  assert.equal(guardCheck({ mode: 'LIVE_TESTNET', txType: 'OfferCreate', role: 'maker', amountXrp: 1 }).allowed, true);
  assert.equal(guardCheck({ mode: 'LIVE_TESTNET', txType: 'AMMDelete', role: 'maker' }).allowed, false);
  assert.equal(guardCheck({ mode: 'LIVE_TESTNET', txType: 'Payment', role: 'visitor' }).allowed, false);
  assert.equal(guardCheck({ mode: 'LIVE_TESTNET', txType: 'Payment', role: 'maker', amountXrp: 50 }).allowed, false);
  assert.equal(guardCheck({ mode: 'REPLAY', txType: 'Payment' }).allowed, false);
});

test('read-only instance cannot submit', async () => {
  process.env.TF_READONLY = '1';
  const l = new Ledger('/nonexistent');
  await assert.rejects(() => l.submit('maker', { TransactionType: 'Payment' }), /Read-only/);
  delete process.env.TF_READONLY;
});

test('allocator: conserves capital and yield diminishes with scale', () => {
  let prev = Infinity;
  for (const p of PROFILES) {
    const a = allocateRings(p.capitalUsd);
    const sum = a.rings.reduce((s, r) => s + r.allocUsd, 0) + a.idleUsd;
    assert.ok(Math.abs(sum - p.capitalUsd) < 1e-6 * p.capitalUsd);
    assert.ok(a.yieldBpsOnDeployed <= prev + 1e-9);
    prev = a.yieldBpsOnDeployed;
  }
  assert.ok(allocateRings(1e6, { flowScale: 0.01 }).idleUsd > 0, 'weak demand leaves capital idle');
});
