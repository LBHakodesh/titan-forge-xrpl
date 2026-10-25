// TGAN — Titan Ghost Advisory Network (hackathon DEMONSTRATION; every advisor, approval and fee is HYPOTHETICAL).
export * from './fee.mjs';
export * from './performance.mjs';
export * from './advisors.mjs';
export * from './governance.mjs';
export * from './signals.mjs';
export * from './revenue.mjs';
export * from './projects.mjs';
export { TganService, seedState, NOTICE, REVIEW_DECISIONS } from './service.mjs';

const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
// State-changing TGAN POSTs: direct loopback caller, JSON content type, no proxy headers, local Origin only.
export function isLocalRequest(req) {
  if (!LOCAL.has(req.socket?.remoteAddress)) return false;
  if (req.headers['x-forwarded-for'] || req.headers['forwarded']) return false;
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return false;
  const origin = req.headers.origin;
  if (origin) { try { if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) return false; } catch { return false; } }
  return true;
}
