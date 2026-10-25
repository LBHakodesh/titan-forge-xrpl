#!/usr/bin/env node
// JS reference stub: JSON-lines engine mirroring contracts/rust/src/main.rs (usable without cargo). NOT the authentic engine.
// Returns schema-valid but obviously placeholder results. STUB_BEHAVIOUR=bad-result|bad-version|live-mode|silent alters it.
import readline from 'node:readline';
const B = process.env.STUB_BEHAVIOUR || '';
const RINGS = ['VELOCITY', 'BRIDGE', 'EARN', 'MONEY', 'DEEP', 'CEILING'];
const LABEL = 'PLACEHOLDER conformance stub (NOT the authentic Titan Ghost engine)';
function handle(req) {
  if (req.v !== 1) return { v: 1, id: String(req.id ?? 'unknown'), ok: false, error: { code: 'UNSUPPORTED_VERSION', message: 'wire v1 only' } };
  const ok = (result) => ({ v: 1, id: req.id, ok: true, result });
  const bad = (message) => ({ v: 1, id: req.id, ok: false, error: { code: 'BAD_REQUEST', message } });
  const p = req.params || {};
  if (req.method === 'strategy' && (!Array.isArray(p.markets) || !p.markets.length || !['SIMULATION', 'REPLAY'].includes(p.mode))) return bad('strategy needs markets[] and mode SIMULATION|REPLAY');
  if (req.method === 'quote' && (!['bid', 'ask'].includes(p.side) || !(p.size > 0) || !p.ring || !p.mode)) return bad('quote needs side, size, ring, mode');
  switch (req.method) {
    case 'info': return ok({ id: 'conformance-stub', label: LABEL, authentic: false, version: '0.0.0-stub', contractVersion: B === 'bad-version' ? '2.0.0' : '1.0.0', methods: ['info', 'health', 'quote', 'strategy'] });
    case 'health': return ok({ ok: true });
    case 'quote': {
      return ok({ source: LABEL, authentic: false, side: p.side, ring: p.ring, price: 1, size: p.size, expiry: new Date(Date.now() + 5000).toISOString(), mode: p.mode });
    }
    case 'strategy': {
      if (B === 'bad-result') return ok({ source: LABEL, mode: p.mode });
      const n = (m) => Math.min(6, m.ringsActive ?? 6);
      return ok({
        source: LABEL, authentic: false, mode: B === 'live-mode' ? 'LIVE_TESTNET' : p.mode,
        allocations: p.markets.map((m) => ({ marketId: m.marketId, allocation: {
          mode: p.mode, capitalUsd: m.capitalUsd, deployedUsd: 0, idleUsd: m.capitalUsd, dailyEarnUsd: 0, yieldBpsOnDeployed: 0, source: LABEL,
          rings: RINGS.slice(0, n(m)).map((id) => ({ id, allocUsd: 0, dailyEarnUsd: 0, marginalBps: 0, utilization: 0 })) } })),
        recommendations: [{ source: LABEL, action: 'hold', rationale: 'Placeholder: stub engine makes no recommendation.', mode: p.mode }],
      });
    }
    default: return { v: 1, id: req.id, ok: false, error: { code: 'UNKNOWN_METHOD', message: `unknown method ${req.method}` } };
  }
}
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim() || B === 'silent') return;
  let req; try { req = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ v: 1, id: 'unknown', ok: false, error: { code: 'BAD_REQUEST', message: 'invalid JSON' } }) + '\n'); return; }
  process.stdout.write(JSON.stringify(handle(req)) + '\n');
});
