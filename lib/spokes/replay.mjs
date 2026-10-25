// Spokes: deterministic REPLAY. A recording is frozen once from a real snapshot (real spoke ids + real Mainnet and Testnet
// transaction hashes) and stored in data/spokes-snapshot.json. buildReplay(recording) is a pure function of the
// recording and the fixed seed, so every call returns the same output.
export const REPLAY_SEED = 1313;
export const REPLAY_MAX = 60;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (f) => ({
  hash: f.hash, ledger: f.ledger, network: f.network, originalKind: f.kind, at: f.at,
  from: f.from, to: f.to, viaXrp: f.viaXrp, delivered: f.delivered, rate: f.rate, partial: f.partial,
  offerOwners: f.offerOwners, depthAfter: null, explorer: f.explorer, spokeIds: f.spokeIds,
});

// Freeze a recording from real flows (newest first in, oldest-first stored). Mainnet and Testnet interleaved by time.
export function recordReplay({ mainnetFlows = [], testnetFlows = [], spokes = [], recordedAt = new Date().toISOString() } = {}) {
  const m = mainnetFlows.slice(0, Math.ceil(REPLAY_MAX * 0.7)).map(pick);
  const t = testnetFlows.slice(0, REPLAY_MAX - m.length).map(pick);
  const items = [...m, ...t].sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.hash).localeCompare(String(b.hash)));
  return JSON.parse(JSON.stringify({ recordedAt, seed: REPLAY_SEED, items, spokes: spokes.filter((s) => !s.placeholder).map((s) => ({ id: s.id, group: s.group, currency: s.currency, issuer: s.issuer, network: s.network })) }));
}

// Deterministic playback timeline: fixed seed jitters spacing (0.6–2.4 s) so the animation feels organic but repeats exactly.
export function buildReplay(recording) {
  if (!recording?.items?.length) return { mode: 'REPLAY', seed: REPLAY_SEED, recordedAt: recording?.recordedAt ?? null, durationMs: 0, frames: [], spokes: recording?.spokes ?? [], note: 'No recording available yet.' };
  const rnd = mulberry32(recording.seed ?? REPLAY_SEED);
  let t = 0;
  const frames = recording.items.map((it, i) => {
    t += Math.round(600 + rnd() * 1800);
    return { seq: i, tMs: t, ...it, kind: 'REPLAY' };
  });
  return {
    mode: 'REPLAY', seed: recording.seed ?? REPLAY_SEED, recordedAt: recording.recordedAt, durationMs: t, frames, spokes: recording.spokes,
    note: 'Deterministic replay of a recorded sequence of real transactions (hashes link to the explorers). Timing is synthetic (fixed seed); this is not live activity.',
  };
}
