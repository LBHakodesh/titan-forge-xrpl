// Amazon Bedrock AgentCore adapter. Docs verified 2026-10-25 (devguide what-is-bedrock-agentcore, gateway, observability, payments):
//   Gateway turns APIs/Lambda into MCP tools; Observability uses OpenTelemetry (OTEL) data in CloudWatch;
//   Payments documents x402/MPP with Coinbase CDP and Stripe (Privy) wallets — NOT XRPL. We never assume AWS settles on XRPL.
// No AWS SDK, no AWS call. Credentials are detected from process env only (presence, never value).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAdapter, isSet } from './common.mjs';

export const MANIFEST_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'agentcore-tools.json');
export const CREDENTIAL_ENV = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_PROFILE', 'AWS_REGION', 'AGENTCORE_GATEWAY_URL'];
export const loadManifest = () => JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
export const hasAwsCreds = (env) => (isSet(env, 'AWS_ACCESS_KEY_ID') && isSet(env, 'AWS_SECRET_ACCESS_KEY')) || isSet(env, 'AWS_PROFILE');

// OpenTelemetry-shaped span for a Titan Forge bus event (the shape AgentCore Observability ingests via OTEL/CloudWatch).
// Pure mapping; nothing is exported to AWS.
export function otelSpanFor(ev = {}) {
  const t = Date.parse(ev.at || '') || 0;
  const attrs = { 'tf.event.type': ev.type, 'tf.mode': ev.mode, 'tf.organic': false };
  for (const k of ['code', 'vendor', 'status', 'resource', 'severity', 'findingId', 'launchId', 'sessionId']) if (ev[k] != null) attrs[`tf.${k}`] = String(ev[k]);
  return {
    resource: { attributes: { 'service.name': 'titan-forge', 'deployment.environment': 'london-staging', 'cloud.provider': 'none (not deployed to AWS)' } },
    scope: { name: 'titan-forge.bus', version: '1' },
    span: { name: ev.type || 'unknown', kind: 'SPAN_KIND_INTERNAL', startTimeUnixNano: String(BigInt(t) * 1_000_000n), endTimeUnixNano: String(BigInt(t) * 1_000_000n),
      status: { code: /failed|error|rejected/.test(String(ev.type)) ? 'STATUS_CODE_ERROR' : 'STATUS_CODE_OK' }, attributes: attrs },
  };
}
export const OTEL_MAPPING = [
  { event: 'vendors.probe', span: 'vendors.probe', attributes: ['tf.vendor', 'tf.status', 'tf.mode'], note: 'vendor read-only probe' },
  { event: 'x402.challenge / x402.rejected / x402.settled', span: 'x402.*', attributes: ['tf.resource', 'tf.mode'], note: 'paid-API flow; settlement only with owner approval' },
  { event: 'sentinel.finding / findings.recorded', span: 'sentinel.*', attributes: ['tf.severity', 'tf.findingId'], note: 'risk signal' },
  { event: 'launch.* / pathfinder.*', span: 'ledger.*', attributes: ['tf.code', 'tf.launchId'], note: 'Testnet ledger activity (LIVE_TESTNET)' },
];

export function agentcoreStatus({ env }) { return hasAwsCreds(env) ? 'DOCUMENTATION_ONLY' : 'CREDENTIALS_REQUIRED'; }

export function createAgentcoreAdapter({ env = process.env, samples = null, now = () => Date.now(), routeExists = null } = {}) {
  return makeAdapter({
    id: 'agentcore', name: 'AWS Bedrock AgentCore', env, samples, now,
    docs: ['https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/', 'https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway.html', 'https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability.html', 'https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments.html'],
    capability: 'Agent runtime/tool layer: Titan Forge read-only tools packaged as an MCP tool manifest for AgentCore Gateway, and bus events mapped to OpenTelemetry spans for AgentCore Observability. AWS payments rails are not XRPL.',
    credentialEnv: CREDENTIAL_ENV,
    computeStatus: agentcoreStatus,
    extra: () => ({ awsCredentialsDetected: hasAwsCreds(env), manifest: { file: 'lib/vendors/agentcore-tools.json', tools: loadManifest().tools.map((t) => ({ name: t.name, path: t['x-titanforge'].path })) }, otelMapping: OTEL_MAPPING,
      note: hasAwsCreds(env) ? 'AWS credentials detected in env, but no gateway is deployed and this node makes no AWS call: documentation only until the Commander deploys a Gateway.' : 'No AWS credentials in process env.' }),
    runProbe: async () => {
      // Local validation only: the manifest must be read-only and every tool must map to a GET route that exists here.
      const m = loadManifest();
      const problems = [];
      for (const t of m.tools) {
        if (t.annotations?.readOnlyHint !== true) problems.push(`${t.name}: not readOnlyHint`);
        if (t['x-titanforge']?.method !== 'GET') problems.push(`${t.name}: not GET`);
        const p = String(t['x-titanforge']?.path || '').replace(/\{(\w+)\}/g, ':$1');
        if (routeExists && !routeExists(p)) problems.push(`${t.name}: route ${p} not registered on this node`);
      }
      return { ok: problems.length === 0, mode: 'SIMULATION', countsAsVendorTest: false, error: problems.join('; ') || undefined,
        note: 'Local manifest validation. No AWS call was made.', result: { tools: m.tools.length, problems, otelExample: otelSpanFor({ type: 'vendors.probe', mode: 'SIMULATION', at: new Date(now()).toISOString(), vendor: 'agentcore', status: 'ok' }) } };
    },
  });
}

export default createAgentcoreAdapter();
