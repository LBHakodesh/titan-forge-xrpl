// Titan Sentinel findings service: registry + read-only collectors + bus ingestion.
// Observes and recommends only. The service passes no ledger handle to the registry; collectors only read files,
// in-process state and (via lib/sentinel.mjs) validated Testnet data.
import { FindingsRegistry } from './registry.mjs';
import { defaultCollectors, runCollectors, systemsView, findingFromEvent, readJsonFile } from './collectors.mjs';
import { summarize, markdownReport } from './report.mjs';
import { universalCollectors, coverage, auditTrail, universalView } from './universal.mjs';

export * from './registry.mjs';
export { PATHFINDER_NO_PATH_KEY, X402_UNAPPROVED_KEY, SYSTEMS } from './collectors.mjs';
export { summarize, markdownReport } from './report.mjs';
export { SUBSYSTEMS, PROVENANCE_CLASSES, SENTINEL_STATEMENT, THRESHOLDS, classify, provenanceClass, universalView, coverage, auditTrail, universalCollectors } from './universal.mjs';

export const allCollectors = () => [...defaultCollectors(), ...universalCollectors()];
const notWired = (what) => async () => { throw new Error(`${what} not wired on this node`); };

const INGEST = /^(sentinel\.finding|access\.|pathfinder\.)/;

export class FindingsService {
  constructor({ registry = new FindingsRegistry(), collectors = allCollectors(), env = {}, bus = null, now = () => Date.now(), log = () => {} } = {}) {
    this.registry = registry; this.collectors = collectors; this.now = now; this.log = log;
    this.env = { readJson: readJsonFile, ledgerReady: () => false, launches: () => [], entitlements: () => { throw new Error('Access module not wired'); }, engineStatus: () => null, routeExists: () => false, fetchJson: async () => { throw new Error('No HTTP access'); }, approvals: () => null,
      now, offline: false, ledgerError: () => null, pathfinderRuns: () => null, serverInfo: notWired('server_info'), accounts: notWired('Account balance reads'), probe: notWired('HTTP probe'), ...env };
    this.statuses = {}; this.lastRun = null; this.running = null;
    this.busState = { attached: false, seen: {}, ingested: 0, errors: 0 };
    if (bus) this.attach(bus);
  }

  attach(bus) {
    this.bus = bus;
    this.onEvent = (ev) => {
      try {
        if (!ev || !INGEST.test(ev.type || '')) return;
        this.busState.seen[ev.type] = (this.busState.seen[ev.type] || 0) + 1;
        const input = findingFromEvent(ev);
        if (input) { const r = this.registry.record(input, { actor: `bus:${ev.type}` }); if (r.changed) this.busState.ingested++; }
        if (ev.type === 'pathfinder.run_done' || ev.type === 'pathfinder.run_failed') this.schedule(['pathfinder']);
        if (ev.type === 'pathfinder.profile') this.schedule(['mainnet-profile']);
      } catch (e) { this.busState.errors++; this.log(`bus ingest error: ${e.message}`); }
    };
    bus.on('event', this.onEvent);
    this.busState.attached = true;
  }
  detach() { if (this.bus && this.onEvent) this.bus.off('event', this.onEvent); this.busState.attached = false; }

  schedule(only) {
    clearTimeout(this.pending);
    this.pending = setTimeout(() => this.collect({ only }).catch(() => {}), 2000);
    this.pending.unref?.();
  }

  async collect({ only = null } = {}) {
    if (this.running) return this.running; // one collection at a time
    this.running = (async () => {
      const st = await runCollectors(this.registry, this.collectors, this.env, { only, now: this.now });
      Object.assign(this.statuses, st);
      this.lastRun = new Date(this.now()).toISOString();
      return st;
    })().finally(() => { this.running = null; });
    return this.running;
  }

  sources() { return { lastRun: this.lastRun, systems: systemsView(this.statuses, { bus: this.busState }), collectors: this.statuses, eventsSuppressed: this.registry.eventsSuppressed }; }
  // TG Sentinel universal views (read-only projections of the registry + collector statuses).
  coverage() { return coverage(this.registry.all(), this.statuses, { now: this.now(), lastRun: this.lastRun }); }
  audit(opts) { return auditTrail(this.registry.all(), opts); }
  universal(q) { return (q ? this.registry.list(q) : this.registry.list()).map(universalView); }
  summary(q) { return summarize(q ? this.registry.list(q) : this.registry.all()); }
  report() {
    const list = this.registry.list();
    return markdownReport(list, { verify: this.registry.verify(), sources: this.sources().systems, generatedAt: new Date(this.now()).toISOString() });
  }
}
