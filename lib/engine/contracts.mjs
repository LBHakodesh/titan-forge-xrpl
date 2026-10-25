// Contract helpers: version, enum-drift check against public/domain.js, and mappers from existing records to contract shapes.
import { MODES, RINGS, STAGES, MARKETS, TIERS, PROFILES } from '../../public/domain.js';
import { getSchema, schemaNames } from './validate.mjs';

export const CONTRACT_VERSION = '1.0.0';
export const WIRE_VERSION = 1; // RpcRequest/RpcResponse "v"; bumps only on breaking change (major).

// Returns [] when every enum in common.schema.json matches domain.js; otherwise a list of human-readable drift messages.
export function enumDrift() {
  const defs = getSchema('common').$defs;
  const expect = {
    Mode: Object.values(MODES), RingId: RINGS.map((r) => r.id), StageId: STAGES.map((s) => s.id),
    MarketId: MARKETS.map((m) => m.id), TierId: TIERS.map((t) => t.id), ProfileId: PROFILES.map((p) => p.id),
  };
  const out = [];
  for (const [k, want] of Object.entries(expect)) {
    const have = defs[k]?.enum || [];
    if (JSON.stringify(have) !== JSON.stringify(want)) out.push(`${k}: schema ${JSON.stringify(have)} != domain.js ${JSON.stringify(want)}`);
  }
  for (const m of MARKETS) if (!new RegExp(defs.MarketRef.pattern).test(m.id)) out.push(`MarketRef pattern rejects ${m.id}`);
  return out;
}

// A launch step (data/launches.json) -> TxEvidence, or null when the step carries no transaction.
// Steps are recorded only after Ledger.submit() -> submitAndWait() returned a validated result, so `validated`
// is inferred true when hash+ledger are present unless the step explicitly says otherwise.
export function txEvidenceFromStep(step) {
  if (!step?.hash) return null;
  return {
    hash: step.hash, result: step.result, ledger: step.ledger,
    validated: step.validated ?? (Number.isInteger(step.ledger) && step.status === 'done'),
    explorer: step.explorer, mode: 'LIVE_TESTNET', step: step.key,
  };
}

export function tokenRefFromLaunch(l) {
  return l?.issuer ? { currency: l.code, issuer: l.issuer, launchId: l.id, network: 'testnet' } : null;
}

export function schemaList() {
  return schemaNames().map((name) => { const s = getSchema(name); return { name, title: s.title, description: s.description || '', url: `/api/engine/schemas/${name}` }; });
}
