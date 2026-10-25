// Demo loop (LIVE_TESTNET, demo-generated): repeats the full cycle on XRPL Testnet inside an operator-approved,
// capped session. One round = launch a new demo token (controlled direct fill) -> Pathfinder bridge_leg batch
// between that token and an anchor token (pathfound payments the payment engine routes through our quotes).
//
// Every transaction is from our own demo accounts to our own demo accounts: organic:false, never demand.
// Operator exception: docs/SPEC_EXCEPTION_DEMO_LOOP.md. Pressing Start (approved:true) approves one capped
// session only; a server restart never resumes a session.
//
// Dependencies are injected so the loop is unit-testable without a ledger:
//   launch(spec, extra) -> { status, body, done?: Promise<launchRecord> }       (ctx.launches.start)
//   pathfinder.start(body, { approved, loop }) -> run ; pathfinder.done(id) -> Promise<run>
//   pathfinder.liveTokens() -> ['BBL', ...] ; pathfinder.paymentsLastHour() -> n
//   isTaken(code) -> bool   (ticker already launched)
//   capital.inject(body) -> { ok, errors? }                                       (ctx.capital, SIMULATION)
//   corridor: { simulate(code, scenario, periods), promote(code, {approved, mode}), demote(code, {mode, to}), stage(code) }
//            (ctx.corridor, SIMULATION track only: demo fills never count as live corridor evidence)
//
// Round order: capital injection (SIM) -> launch + direct fill (LIVE) -> corridor stand-up (SIM) ->
//              Pathfinder fills while the corridor is up (LIVE) -> corridor teardown to standby (SIM).
import { CAPS as PF_CAPS } from './pathfinder/replay.mjs';

export const MODE = 'LIVE_TESTNET';
export const STATEMENT = 'Demo loop: our own demo wallets trade with each other on XRPL Testnet (organic:false). '
  + 'It shows the mechanism repeating, not market demand. What is real is that the Testnet payment engine picks which offers fill.';
export const LOOP_CAPS = {
  rounds: { min: 1, max: 20, def: 5 },
  minutes: { min: 1, max: 60, def: 20 },
  k: { min: 1, max: 10, def: 6 },
  gapSec: { min: 5, max: 120, def: 10 },
  maxVolumeXrp: { min: 1, max: 100, def: 100 },
  routers: { min: 1, max: 3, def: 3 }, // parallel Pathfinder payers (router, router2, router3)
  capitalUsd: { min: 100, max: 10_000_000, def: 1_000_000 },
  holdSec: { min: 0, max: 600, def: 90 }, // corridor window: Pathfinder keeps paying (all routers) while the corridor is up
  quoteXrp: { min: 1, max: 15 },
  launchFillXrp: 1, // QUOTE.fillQty × QUOTE.ask in lib/ledger.mjs
  pathfinderPerHour: PF_CAPS.perHour, // single source: lib/pathfinder/replay.mjs CAPS.perHour
};
const RESERVED = new Set(['XRP', 'USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH', 'SOL']);
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export class LoopError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

export function normalizeLoopConfig(body = {}, liveTokens = []) {
  const errors = [];
  const num = (key) => {
    const c = LOOP_CAPS[key];
    const v = body[key] == null || body[key] === '' ? c.def : Number(body[key]);
    if (!(Number.isFinite(v) && v >= c.min && v <= c.max)) errors.push(`${key} must be ${c.min}–${c.max}.`);
    return v;
  };
  const rounds = num('rounds'), minutes = num('minutes'), k = num('k'), gapSec = num('gapSec'), maxVolumeXrp = num('maxVolumeXrp'), capitalUsd = num('capitalUsd'), holdSec = num('holdSec'), routers = num('routers');
  if (!Number.isInteger(routers)) errors.push('routers must be a whole number.');
  const corridor = body.corridor !== false; // corridor stand-up / teardown on the SIMULATION track
  if (!Number.isInteger(rounds)) errors.push('rounds must be a whole number.');
  if (!Number.isInteger(k)) errors.push('k must be a whole number.');
  let quoteXrp = null;
  if (body.quoteXrp != null && body.quoteXrp !== '') {
    quoteXrp = Number(body.quoteXrp);
    if (!(quoteXrp >= LOOP_CAPS.quoteXrp.min && quoteXrp <= LOOP_CAPS.quoteXrp.max)) errors.push(`quoteXrp must be ${LOOP_CAPS.quoteXrp.min}–${LOOP_CAPS.quoteXrp.max} XRP per quote.`);
  }
  const anchor = String(body.anchor ?? (liveTokens.includes('LDN') ? 'LDN' : liveTokens[0] ?? '')).toUpperCase();
  if (!liveTokens.includes(anchor)) errors.push(`Anchor token ${anchor || '(none)'} is not a live launched token.`);
  if (errors.length) throw Object.assign(new LoopError(errors.join(' ')), { errors });
  return { rounds, minutes, k, gapSec, maxVolumeXrp, quoteXrp, anchor, capitalUsd, holdSec, routers, corridor, strategy: 'bridge_leg', rivalStrategy: 'static_wide' };
}

// Next free 3-character ticker: L + two base-36 characters (LA0, LA1, ...), skipping taken and reserved codes.
export function nextCode(isTaken, start = 0) {
  for (let n = start; n < 36 * 36; n++) {
    const code = 'L' + B36[Math.floor(n / 36)] + B36[n % 36];
    if (!RESERVED.has(code) && !isTaken(code)) return { code, n };
  }
  return null;
}

const defaultSleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

export class DemoLoop {
  constructor({ launch, pathfinder, isTaken, capital = null, corridor = null, stepPauseMs = 2500, bus = { publish() {} }, persist = { load: () => ({}), save() {} }, now = () => Date.now(), sleep = defaultSleep, readonly = () => process.env.TF_READONLY === '1', id = () => crypto.randomUUID() }) {
    Object.assign(this, { launch, pathfinder, isTaken, capital, corridor, stepPauseMs, bus, persist, now, sleep, readonly, newId: id });
    const saved = persist.load() || {};
    this.sessions = saved.sessions || [];
    // A session interrupted by a restart is never resumed: the operator must press Start again.
    for (const s of this.sessions) if (s.status === 'running' || s.status === 'stopping') { s.status = 'stopped'; s.stopReason = 'Interrupted by server restart (sessions never resume on their own).'; s.finishedAt ||= new Date(this.now()).toISOString(); }
    this.active = null;
    this.abort = null;
    this.codeCursor = 0;
    this.done = new Map();
  }

  save() { this.persist.save({ sessions: this.sessions.slice(-30) }); }
  get(id) { return this.sessions.find((s) => s.id === id) || null; }
  current() { return this.active ? this.get(this.active) : null; }

  status() {
    const s = this.current() || this.sessions.at(-1) || null;
    return { mode: MODE, organic: false, statement: STATEMENT, caps: LOOP_CAPS, running: !!this.active, session: s, history: this.sessions.slice(-10).reverse().map(summary) };
  }

  start(cfg, { approved } = {}) {
    if (this.readonly()) throw new LoopError('Read-only instance: the demo loop is disabled (TF_READONLY=1).', 403);
    if (approved !== true) throw new LoopError('Explicit operator approval required: press Start in the Demo Loop tab (approved:true).', 400);
    if (this.active) throw new LoopError('A demo loop session is already running. Stop it first.', 409);
    const t = this.now();
    const s = {
      id: this.newId(), mode: MODE, organic: false, statement: STATEMENT, status: 'running', approved: true,
      config: cfg, startedAt: new Date(t).toISOString(), deadline: new Date(t + cfg.minutes * 60_000).toISOString(),
      rounds: [], totals: { rounds: 0, directFills: 0, pathPayments: 0, pathPlanned: 0, skipped: 0, bridged: 0, volumeXrp: 0, makerCaptureXrp: 0, capturedXrp: 0, txs: 0 },
      phase: 'starting', stopReason: null,
    };
    this.sessions.push(s);
    this.active = s.id;
    this.abort = new AbortController();
    this.save();
    this.bus.publish('loop.started', MODE, { sessionId: s.id, config: cfg, deadline: s.deadline, organic: false });
    const done = this.#run(s).catch((e) => this.#finish(s, `Stopped on error: ${e.message}`));
    this.done.set(s.id, done);
    return s;
  }

  stop(reason = 'Stopped by the operator.') {
    const s = this.current();
    if (!s) return null;
    if (s.status === 'running') { s.status = 'stopping'; s.stopReason = reason; this.save(); }
    this.abort?.abort();
    if (this.activeRun) this.pathfinder.stop?.(this.activeRun); // stop paying after the current batch; quotes still cleaned up
    this.bus.publish('loop.stopping', MODE, { sessionId: s.id, reason });
    return s;
  }

  #phase(s, phase, extra = {}) {
    s.phase = phase; this.save();
    this.bus.publish('loop.round', MODE, { sessionId: s.id, round: s.rounds.length, phase, ...extra, organic: false });
  }

  // Payments for this round. With the corridor on, Pathfinder keeps paying for the whole corridor window
  // (holdSec) on every router: one payment per router per paceMs. Clipped to the run, hourly and volume caps.
  plannedK(s, { launched = false } = {}) {
    const c = s.config, T = s.totals;
    const windowK = c.corridor && c.holdSec > 0 ? Math.floor(c.holdSec / (PF_CAPS.paceMs / 1000)) * c.routers : 0;
    const hourLeft = LOOP_CAPS.pathfinderPerHour - this.pathfinder.paymentsLastHour();
    // Worst case 2 XRP per payment; before the launch, also leave room for its 1 XRP fill (after it, it's already in T.volumeXrp).
    const volLeft = Math.floor((c.maxVolumeXrp - T.volumeXrp - (launched ? 0 : LOOP_CAPS.launchFillXrp)) / PF_CAPS.maxPaymentXrp);
    return Math.max(0, Math.min(Math.max(c.k, windowK), PF_CAPS.maxK, hourLeft, volLeft));
  }

  // Why the next round must not start (null = it may start).
  #blocker(s) {
    const c = s.config, T = s.totals;
    if (s.status !== 'running') return s.stopReason || 'Stopped by the operator.';
    if (T.rounds >= c.rounds) return `Finished: ${c.rounds} round${c.rounds === 1 ? '' : 's'} completed (session cap).`;
    if (this.now() >= Date.parse(s.deadline)) return `Time cap reached (${c.minutes} min).`;
    // Worst case for one more round: the launch fill + every payment at the 2 XRP per-payment cap.
    if (this.pathfinder.paymentsLastHour() >= LOOP_CAPS.pathfinderPerHour) return `Pathfinder hourly cap (${LOOP_CAPS.pathfinderPerHour} payments) reached.`;
    if (this.plannedK(s) < 1) return `Volume cap: ${round(T.volumeXrp, 4)} XRP moved; not enough room under the ${c.maxVolumeXrp} XRP cap for another round (launch fill + at least one payment at the 2 XRP worst case).`;
    return null;
  }

  async #run(s) {
    const c = s.config;
    while (true) {
      const why = this.#blocker(s);
      if (why) return this.#finish(s, why);
      const r = { round: s.rounds.length + 1, startedAt: new Date(this.now()).toISOString(), status: 'launching' };
      s.rounds.push(r);

      const pick = nextCode(this.isTaken, this.codeCursor);
      if (!pick) return this.#finish(s, 'No free ticker left in the L00–LZZ range.');
      this.codeCursor = pick.n + 1;
      r.code = pick.code;

      // 0. Capital injection (SIMULATION): modeled capital pulses into the currencies market the new token joins.
      if (this.capital) {
        const ci = this.capital.inject({ marketId: 'currencies', profileId: 'pro_mm', tierId: 'T1', capitalUsd: c.capitalUsd, loop: { sessionId: s.id, round: r.round } });
        r.capital = ci.ok ? { mode: 'SIMULATION', usd: c.capitalUsd, deployedUsd: ci.deployedUsd } : { mode: 'SIMULATION', error: (ci.errors || []).join(' ') };
        this.#phase(s, 'capital', { code: r.code, capitalUsd: c.capitalUsd, simulated: true });
        await this.#pause(s);
      }

      // 1. Launch a new token: trustlines, issue, maker ask/bid, controlled direct fill, verify.
      this.#phase(s, 'launch', { code: r.code });
      const spec = { name: `Loop Token ${r.code}`, code: r.code, supply: 1_000_000, category: 'currency', description: `Demo loop round ${r.round}. Demo-generated by our own accounts (organic:false).`, alias: 'Demo loop', consent: true };
      const L = this.launch(spec, { loop: { sessionId: s.id, round: r.round } });
      if (L.status !== 202) { r.status = 'failed'; r.error = L.body?.error || (L.body?.errors || []).join(' ') || `launch refused (${L.status})`; return this.#finish(s, `Launch refused: ${r.error}`); }
      r.launchId = L.body.id;
      const launched = await L.done;
      r.launchSteps = (launched?.steps || []).filter((x) => x.hash).length;
      s.totals.txs += r.launchSteps;
      if (launched?.status !== 'live') { r.status = 'failed'; r.error = launched?.error || 'launch failed'; return this.#finish(s, `Launch ${r.code} failed: ${r.error}`); }
      r.fillHash = launched.fillHash;
      s.totals.directFills++; s.totals.volumeXrp = round(s.totals.volumeXrp + LOOP_CAPS.launchFillXrp, 6);
      this.#phase(s, 'launched', { code: r.code, fillHash: r.fillHash });

      // The operator may stop between the launch and the Pathfinder batch.
      if (s.status !== 'running') { r.status = 'partial'; r.finishedAt = new Date(this.now()).toISOString(); s.totals.rounds++; return this.#finish(s, s.stopReason); }

      // 2. Corridor stand-up (SIMULATION): Growth scenario, then promote spoke -> growing spoke -> corridor (six rings).
      if (this.corridor && c.corridor) {
        r.corridor = { mode: 'SIMULATION', up: [], down: [] };
        this.#phase(s, 'corridor_up', { code: r.code, simulated: true });
        try { r.corridor.peak = await this.#standUp(s, r.code, r.corridor.up); }
        catch (e) { r.corridor.error = e.message; }
      }

      // Stop pressed during stand-up: skip the fills, still tear the corridor down so nothing is left standing.
      if (s.status !== 'running') {
        if (r.corridor && !r.corridor.error) { this.#phase(s, 'corridor_down', { code: r.code, simulated: true }); try { await this.#tearDown(r.code, r.corridor.down); } catch (e) { r.corridor.error = e.message; } }
        r.status = 'partial'; r.finishedAt = new Date(this.now()).toISOString(); s.totals.rounds++;
        return this.#finish(s, s.stopReason);
      }

      // 3. Pathfinder batch while the corridor is up: bridged token <-> anchor payments through our and the rival's quotes.
      r.status = 'pathfinding';
      this.#phase(s, 'pathfinder', { code: r.code, anchor: c.anchor });
      let run;
      try {
        r.k = this.plannedK(s, { launched: true });
        if (r.k < 1) { r.status = 'failed'; r.error = 'no payment room left under the caps'; return this.#finish(s, 'Volume or hourly cap reached before the Pathfinder batch.'); }
        r.windowStartedAt = this.now();
        run = this.pathfinder.start({ strategy: c.strategy, rivalStrategy: c.rivalStrategy, k: r.k, tokens: [r.code, c.anchor], routers: c.routers, replenish: true, quoteXrp: c.quoteXrp ?? undefined }, { approved: true, loop: { sessionId: s.id, round: r.round } });
        this.activeRun = run.id;
      } catch (e) { r.status = 'failed'; r.error = e.message; return this.#finish(s, `Pathfinder refused: ${e.message}`); }
      r.runId = run.id;
      const out = await this.pathfinder.done(run.id);
      this.activeRun = null;
      const sc = out?.scorecard;
      if (sc) {
        r.payments = sc.payments; r.capture = { maker: sc.capture.maker.share, rival: sc.capture.rival.share, other: sc.capture.other.share };
        const vol = (out.payments || []).filter((p) => p.status === 'success').reduce((x, p) => x + (p.sizeXrp || 0), 0);
        r.volumeXrp = round(vol + LOOP_CAPS.launchFillXrp, 6);
        Object.assign(s.totals, {
          pathPayments: s.totals.pathPayments + sc.payments.succeeded, pathPlanned: s.totals.pathPlanned + sc.payments.planned,
          skipped: s.totals.skipped + sc.payments.skipped, bridged: s.totals.bridged + sc.payments.bridged,
          volumeXrp: round(s.totals.volumeXrp + vol, 6),
          makerCaptureXrp: round(s.totals.makerCaptureXrp + sc.capture.maker.xrp, 6),
          capturedXrp: round(s.totals.capturedXrp + sc.capture.maker.xrp + sc.capture.rival.xrp + sc.capture.other.xrp, 6),
          txs: s.totals.txs + (out.actions || []).filter((a) => a.hash).length + sc.payments.sent,
        });
      }
      r.finishedAt = new Date(this.now()).toISOString();
      s.totals.rounds++;
      if (out?.status !== 'done') { r.status = 'failed'; r.error = out?.error || 'Pathfinder run failed'; return this.#finish(s, `Pathfinder run failed: ${r.error}`); }
      // 4. Corridor teardown (SIMULATION): hold the corridor up for holdSec, then demand fades, demote to standby,
      //    modeled capital released. Stop cuts the hold short; teardown still runs.
      if (this.corridor && c.corridor && r.corridor && !r.corridor.error) {
        // The payments already filled the window; hold only for whatever is left of it (e.g. a clipped run).
        const left = c.holdSec * 1000 - (this.now() - (r.windowStartedAt ?? this.now()));
        if (left > 1000 && s.status === 'running') { this.#phase(s, 'corridor_hold', { code: r.code, holdSec: Math.round(left / 1000), simulated: true }); s.holdUntil = new Date(this.now() + left).toISOString(); await this.sleep(left, this.abort?.signal); delete s.holdUntil; }
        this.#phase(s, 'corridor_down', { code: r.code, simulated: true });
        try { await this.#tearDown(r.code, r.corridor.down); } catch (e) { r.corridor.error = e.message; }
      }
      r.status = 'done';
      this.#phase(s, 'round_done', { code: r.code, runId: r.runId, payments: r.payments, capture: r.capture, totals: s.totals });

      // 3. Pause before the next round (Stop wakes it immediately).
      if (!this.#blocker(s)) { s.phase = 'waiting'; s.nextRoundAt = new Date(this.now() + c.gapSec * 1000).toISOString(); this.save(); await this.sleep(c.gapSec * 1000, this.abort.signal); }
    }
  }

  async #pause(s) { if (this.stepPauseMs > 0 && s.status === 'running') await this.sleep(this.stepPauseMs, this.abort?.signal); }

  // Promote on the SIMULATION track until corridor (or the scenario runs out). Returns the stage reached.
  async #standUp(s, code, log) {
    for (let week = 0; week < 4 && this.corridor.stage(code) !== 'corridor'; week++) {
      this.corridor.simulate(code, 'growth', 7);
      for (let i = 0; i < 3 && this.corridor.stage(code) !== 'corridor'; i++) {
        const p = await this.corridor.promote(code, { approved: true, mode: 'SIMULATION' });
        if (p.status !== 200) break;
        log.push({ from: p.body.from, to: p.body.to, score: p.body.score });
        await this.#pause(s);
      }
    }
    return this.corridor.stage(code);
  }

  async #tearDown(code, log) {
    this.corridor.simulate(code, 'fade', 14);
    const d = this.corridor.demote(code, { mode: 'SIMULATION', to: 'standby' });
    if (d.status === 200) log.push({ from: d.body.from, to: d.body.to, releasedUsd: d.body.releasedUsd });
    else log.push({ refused: d.body?.reasons?.join(' ') || d.body?.error });
  }

  #finish(s, reason) {
    if (s.finishedAt && !this.active) return s;
    s.status = 'stopped'; s.stopReason = s.stopReason && s.stopReason !== reason && /operator/.test(s.stopReason) ? s.stopReason : reason;
    s.phase = 'stopped'; s.finishedAt = new Date(this.now()).toISOString(); delete s.nextRoundAt;
    this.active = null; this.abort = null;
    this.save();
    this.bus.publish('loop.stopped', MODE, { sessionId: s.id, reason: s.stopReason, totals: s.totals, organic: false });
    return s;
  }
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const summary = (s) => ({ id: s.id, status: s.status, startedAt: s.startedAt, finishedAt: s.finishedAt || null, stopReason: s.stopReason, config: s.config, totals: s.totals });
