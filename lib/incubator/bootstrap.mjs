// TGLB Bootstrap studio (pure; no network, no ledger). Builds on model.mjs (stack + tiers), gates.mjs (legal gate)
// and lending.mjs (Tier 3). A visitor names a project, identifies its token or chooses XRP/RLUSD incubation, sets a
// funding target, chooses ANY non-empty combination of the three tiers, models commitments, reviews legal and
// economic readiness (independent gates) and simulates deploying liquidity into an eligible corridor.
//
// Capital categories REQUESTED / COMMITTED / FUNDED / EXECUTABLE are kept separate per tier and never summed across
// categories. Tier 1 / Tier 2 (TGLW = Titan Ghost Liquidity Wake) is participant-owned, self-custodial,
// liquidity-only capital: it is NEVER project-owned funds. Tier 3 is creditor financing: borrowed, restricted-use,
// a liability of the project, never "own funds" either.
import { priceImpactBps } from '../../public/domain.js';
import { getEngine } from '../engine/index.mjs';
import { guardCheck } from '../guardian.mjs';
import { SIM, TIER_SOURCES, validateStack, DEFAULT_T2_TERMS } from './model.mjs';
import { legalGate, decideOutcome, LEGAL_ITEMS, PERMISSIONED_DEX_NOTE } from './gates.mjs';
import { validateIntake } from './intake.mjs';
import { simulateLoan, LENDING_LABEL, DISCLOSURE as LENDING_DISCLOSURE } from './lending.mjs';

export const BOOTSTRAP_TITLE = 'TGLB Bootstrap';
export const CATEGORIES = ['REQUESTED', 'COMMITTED', 'FUNDED', 'EXECUTABLE'];
export const INCUBATION_ASSETS = ['XRP', 'RLUSD'];
export const TIER_INFO = {
  T1: { id: 'T1', label: 'Tier 1 · TGLW flexible', product: 'TGLW (Titan Ghost Liquidity Wake)', custody: 'Self-custodial', use: 'Liquidity only', projectFunds: false,
    disclosure: 'Participant-owned, self-custodial liquidity. Withdrawable at any time. Backs quotes only; never pays project expenses; never project funds.' },
  T2: { id: 'T2', label: 'Tier 2 · TGLW term-committed', product: 'TGLW (Titan Ghost Liquidity Wake)', custody: 'Self-custodial', use: 'Liquidity only', projectFunds: false,
    disclosure: 'Participant-owned, self-custodial liquidity committed for a term. Exit rules are CONTRACTUAL (disclosed separately below) and are not protocol-enforced wallet permissions. Never project funds.' },
  T3: { id: 'T3', label: 'Tier 3 · TGLB creditor financing', product: 'TGLB (Titan Ghost Liquidity Bootstrap)', custody: 'Loan disbursement', use: 'Permitted uses only', projectFunds: false,
    disclosure: `Formal creditor financing: underwriting, permitted uses and repayment obligations. Borrowed money is a liability, not own funds. ${LENDING_LABEL}.` },
};
export const ECON_RULES_BOOT = { commitCoverageMin: 0.6, executableShareMin: 0.5, tierConcentrationMax: 0.7, minParticipants: 15, minEvidence: 2, sampleOrderUsd: 10_000, dscrMin: 1.25 };
export const XDLC_ENDPOINT = '/api/xdlc/corridors';

const r2 = (x) => Math.round(x * 100) / 100;
const num = (v, d = 0) => { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : d; };
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const str = (v, n = 80) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const CUR_RE = /^([A-Za-z0-9]{3}|[0-9A-Fa-f]{40})$/;

// Commitment model per tier: rates applied in order, so the categories are monotone and separate.
// committed = requested × commitRate; funded = committed × fundRate; executable = funded × execRate.
// Explicit usd values (committedUsd/fundedUsd/executableUsd) override the rates, clipped to the previous category.
export function tierCapital(requestedUsd, m = {}) {
  const req = r2(Math.max(0, requestedUsd));
  const committed = r2(Math.min(req, m.committedUsd != null ? num(m.committedUsd) : req * clamp01(num(m.commitRate, 0))));
  const funded = r2(Math.min(committed, m.fundedUsd != null ? num(m.fundedUsd) : committed * clamp01(num(m.fundRate, 0))));
  const executable = r2(Math.min(funded, m.executableUsd != null ? num(m.executableUsd) : funded * clamp01(num(m.execRate, 0))));
  return { REQUESTED: req, COMMITTED: committed, FUNDED: funded, EXECUTABLE: executable };
}

// Per-category totals across tiers. Each category stays its own number; categories are never added together.
export const categoryTotals = (capital) => Object.fromEntries(CATEGORIES.map((k) => [k, r2(TIER_SOURCES.reduce((s, t) => s + (capital[t]?.[k] || 0), 0))]));

// Project funds view: only the project's own capital is project-owned. TGLW (T1/T2) contributes zero, by construction.
export function projectFunds(capital, ownUsd = 0) {
  return { projectOwnedUsd: r2(Math.max(0, ownUsd)), tglwParticipantUsd: { T1: capital.T1?.FUNDED || 0, T2: capital.T2?.FUNDED || 0 }, tglwCountedAsProjectFundsUsd: 0,
    borrowedT3Usd: capital.T3?.FUNDED || 0, borrowedIsLiability: true,
    note: 'Tier 1 / Tier 2 TGLW capital belongs to participants and is never project funds. Tier 3 proceeds are borrowed, restricted-use and repayable.' };
}

function normalizeTiers(input, targetUsd) {
  const sel = input.tiers || {};
  const enabled = TIER_SOURCES.filter((t) => sel[t] && (sel[t].enabled ?? true) && (sel[t].enabled !== false));
  const sources = { T1: 0, T2: 0, T3: 0 };
  const given = enabled.filter((t) => sel[t].usd != null && num(sel[t].usd) > 0);
  if (enabled.length && given.length === enabled.length) for (const t of enabled) sources[t] = num(sel[t].usd);
  else if (enabled.length) { // equal split of the target across enabled tiers (last tier absorbs rounding)
    const each = Math.floor(targetUsd / enabled.length);
    enabled.forEach((t, i) => { sources[t] = i === enabled.length - 1 ? r2(targetUsd - each * (enabled.length - 1)) : each; });
  }
  return { enabled, sources };
}

// Economic readiness: uses ONLY economic inputs (never legal ones), so the two gates are independent.
export function bootstrapEconomicGate({ targetUsd, capital, economics = {}, deploy, loan }) {
  const tot = categoryTotals(capital);
  const items = [];
  const it = (id, label, status, value, threshold) => items.push({ id, label, status, value, threshold, provenance: SIM });
  const runway = num(economics.runwayMonths), months = num(economics.operatingMonths, 12);
  it('operating_sustainability', 'Operating sustainability', runway >= months && months > 0 ? 'PASS' : runway > 0 ? 'OPEN' : 'FAIL', `${runway} mo runway`, `≥ ${months} mo operating period`);
  const cov = targetUsd > 0 ? tot.COMMITTED / targetUsd : 0;
  it('commitment_coverage', 'Commitment coverage', cov >= ECON_RULES_BOOT.commitCoverageMin ? 'PASS' : 'OPEN', `${(cov * 100).toFixed(0)}% of target committed`, `≥ ${ECON_RULES_BOOT.commitCoverageMin * 100}%`);
  const ex = tot.REQUESTED > 0 ? tot.EXECUTABLE / tot.REQUESTED : 0;
  it('executable_share', 'Executable capital', ex >= ECON_RULES_BOOT.executableShareMin ? 'PASS' : 'OPEN', `${(ex * 100).toFixed(0)}% of requested executable`, `≥ ${ECON_RULES_BOOT.executableShareMin * 100}%`);
  const exec = TIER_SOURCES.map((t) => ({ t, usd: capital[t]?.EXECUTABLE || 0 })).sort((a, b) => b.usd - a.usd);
  const share = tot.EXECUTABLE > 0 ? exec[0].usd / tot.EXECUTABLE : 0;
  const multi = exec.filter((x) => x.usd > 0).length;
  it('tier_concentration', 'Tier concentration', tot.EXECUTABLE === 0 ? 'OPEN' : multi === 1 || share <= ECON_RULES_BOOT.tierConcentrationMax ? 'PASS' : 'OPEN',
    tot.EXECUTABLE ? `${exec[0].t} = ${(share * 100).toFixed(0)}% of executable` : 'no executable capital', `no tier > ${ECON_RULES_BOOT.tierConcentrationMax * 100}% when mixing tiers`);
  const parts = num(economics.independentParticipants), evid = num(economics.verifiedEvidence);
  it('verified_demand', 'Verified demand evidence', parts >= ECON_RULES_BOOT.minParticipants && evid >= ECON_RULES_BOOT.minEvidence ? 'PASS' : 'OPEN', `${evid} evidence refs · ${parts} participants`, `≥ ${ECON_RULES_BOOT.minEvidence} refs, ≥ ${ECON_RULES_BOOT.minParticipants} participants`);
  const maxBps = num(economics.targetSpreadBps, 50);
  it('price_impact', 'Liquidity depth / price impact', !deploy || deploy.deployUsd <= 0 ? 'OPEN' : Number.isFinite(deploy.impactBps) && deploy.impactBps <= maxBps ? 'PASS' : 'FAIL',
    deploy && deploy.deployUsd > 0 ? `${Number.isFinite(deploy.impactBps) ? deploy.impactBps + ' bps' : 'exceeds depth'} for a $${ECON_RULES_BOOT.sampleOrderUsd.toLocaleString('en-US')} order` : 'nothing executable', `≤ ${maxBps} bps`);
  if (loan) {
    const uw = loan.underwriting;
    it('t3_debt_service', 'Tier 3 debt service', !uw ? 'OPEN' : uw.decision === 'DECLINED' ? (uw.dscr < 1 ? 'FAIL' : 'OPEN') : uw.dscr >= ECON_RULES_BOOT.dscrMin ? 'PASS' : 'OPEN',
      uw ? `${uw.decision} · DSCR ${uw.dscr.toFixed(2)}×` : 'no application', `approved and DSCR ≥ ${ECON_RULES_BOOT.dscrMin}×`);
  }
  const status = items.some((i) => i.status === 'FAIL') ? 'FAIL' : items.every((i) => i.status === 'PASS') ? 'PASS' : 'OPEN';
  return { status, items, mode: SIM, note: 'Economic readiness is computed from capital and operating inputs only; legal inputs never change it.' };
}

// Corridor eligibility. Token corridors need a token + legal PASS (or RESTRICTED → permissioned pathway) + economics PASS.
// The interim XRP/RLUSD incubation corridor creates no market or price for the project token.
export function corridorOptions({ token, incubationAsset, legal, economic, executableUsd }) {
  const out = [];
  if (token) for (const q of ['XRP', 'RLUSD']) {
    const reasons = [];
    if (!['PASS', 'RESTRICTED'].includes(legal.status)) reasons.push(`Legal readiness ${legal.status}: own-token market not legally eligible yet.`);
    if (economic.status !== 'PASS') reasons.push(`Economic readiness ${economic.status}: own-token market not economically justified yet.`);
    out.push({ id: `${token.currency}/${q}`, pair: `${token.currency}/${q}`, base: token.currency, quote: q, kind: 'PROJECT_TOKEN', eligible: reasons.length === 0, restricted: legal.status === 'RESTRICTED',
      reasons: reasons.length ? reasons : [legal.status === 'RESTRICTED' ? `Restricted pathway. ${PERMISSIONED_DEX_NOTE}` : 'Both readiness gates PASS.'] });
  }
  const iReasons = [];
  if (legal.status === 'FAIL') iReasons.push('Legal readiness FAIL: the project is declined; no incubation corridor.');
  if (!(executableUsd > 0)) iReasons.push('No executable liquidity yet.');
  out.push({ id: 'XRP/RLUSD', pair: 'XRP/RLUSD', base: 'XRP', quote: 'RLUSD', kind: 'INTERIM_INCUBATION', incubationAsset: incubationAsset || 'RLUSD', eligible: iReasons.length === 0, restricted: false,
    reasons: iReasons.length ? iReasons : ['Interim XRP/RLUSD incubation corridor: liquidity-only market making that creates no market or price for the project token.'] });
  return out;
}

export function simulateDeploy(deployUsd, { engine = getEngine() } = {}) {
  if (!(deployUsd > 0)) return { deployUsd: 0, rings: [], impactBps: Infinity, engine: engine.info(), guardian: null, executes: false, mode: SIM };
  const alloc = engine.allocate(deployUsd, { flowScale: 1, ringsActive: 6 });
  const rings = (alloc.rings || []).map((r) => ({ id: r.id, allocUsd: r2(r.allocUsd) }));
  const g = guardCheck({ mode: SIM, amountUsd: deployUsd, requiresApproval: true, approved: false });
  return { deployUsd: r2(deployUsd), rings, deployedUsd: r2(alloc.deployedUsd ?? rings.reduce((s, r) => s + r.allocUsd, 0)), idleUsd: r2(alloc.idleUsd ?? 0),
    impactBps: priceImpactBps(ECON_RULES_BOOT.sampleOrderUsd, alloc.rings || []), engine: engine.info(),
    guardian: { ...g, executes: false, note: g.allowed ? 'Guardian: permissible as a SIMULATION. Nothing is signed or moved.' : 'Guardian refused.' }, executes: false, mode: SIM };
}

// Main entry. input: { name, token:{currency, issuer?}|null, incubationAsset:'XRP'|'RLUSD', targetUsd, tiers:{T1:{enabled,usd,commitRate,fundRate,execRate}, T2:{..., termDays, earlyExit}, T3:{..., application, vault, scenario}},
//   projectOwnUsd, legal:{regulatoryReview, items}, economics:{runwayMonths, operatingMonths, independentParticipants, verifiedEvidence, targetSpreadBps} }
export function planBootstrap(input = {}) {
  const errors = [];
  const name = str(input.name);
  if (name.length < 3) errors.push('Project name is required (3–80 chars).');
  let token = null;
  if (input.token && str(input.token.currency, 40)) {
    const c = str(input.token.currency, 40).toUpperCase();
    if (!CUR_RE.test(c) || c === 'XRP') errors.push('Token currency must be a 3-character code (not XRP) or 40-hex code.');
    else token = { currency: c, issuer: str(input.token.issuer, 40) || null, issued: /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(str(input.token.issuer, 40)) };
  }
  const incubationAsset = INCUBATION_ASSETS.includes(input.incubationAsset) ? input.incubationAsset : 'RLUSD';
  const targetUsd = num(input.targetUsd);
  if (!(targetUsd > 0 && targetUsd <= 1_000_000_000)) errors.push('Funding target must be > 0 and ≤ 1,000,000,000.');
  const { enabled, sources } = normalizeTiers(input, targetUsd > 0 ? targetUsd : 0);
  if (!enabled.length) errors.push('Choose at least one tier (any combination of Tier 1, Tier 2, Tier 3).');
  const t2 = input.tiers?.T2 || {};
  const terms = {};
  if (enabled.includes('T2')) terms.T2 = { termDays: num(t2.termDays, DEFAULT_T2_TERMS.termDays), earlyExit: { noticeDays: num(t2.earlyExit?.noticeDays, DEFAULT_T2_TERMS.earlyExit.noticeDays), penaltyBps: num(t2.earlyExit?.penaltyBps, DEFAULT_T2_TERMS.earlyExit.penaltyBps) } };
  let stack = null;
  if (!errors.length) {
    const v = validateStack({ targetUsd, sources: { ...sources, PROJECT: num(input.projectOwnUsd), PROPRIETARY: 0 }, terms });
    if (!v.ok) errors.push(...v.errors); else stack = v.stack;
  }
  if (errors.length) return { ok: false, errors, mode: SIM };

  // Tier 3 loan (lending module). Its categories come from underwriting, never from the commitment sliders.
  let loan = null;
  if (enabled.includes('T3')) {
    const t3 = input.tiers.T3 || {};
    loan = simulateLoan({ application: { borrower: name, principalUsd: stack.sources.T3.usd, legalStatus: legalGate(input.legal?.regulatoryReview || {}, input.legal?.items || {}).status, ...(t3.application || {}) },
      vault: t3.vault || { lenders: [{ id: 'lender-a', usd: stack.sources.T3.usd * 1.5 }, { id: 'lender-b', usd: stack.sources.T3.usd * 1.5 }], firstLossUsd: stack.sources.T3.usd * 0.1, reserveUsd: stack.sources.T3.usd * 0.05 },
      scenario: t3.scenario || 'CURRENT', scenarioOpts: t3.scenarioOpts, terms: t3.terms });
    if (!loan.ok) return { ok: false, errors: loan.errors.map((e) => `Tier 3: ${e}`), mode: SIM };
  }

  const capital = {};
  for (const t of TIER_SOURCES) {
    if (!enabled.includes(t)) { capital[t] = { REQUESTED: 0, COMMITTED: 0, FUNDED: 0, EXECUTABLE: 0 }; continue; }
    if (t === 'T3') { const c = loan.capital; capital.T3 = { REQUESTED: r2(c.requestedUsd), COMMITTED: r2(c.committedUsd), FUNDED: r2(c.fundedUsd), EXECUTABLE: r2(c.executableUsd) }; continue; }
    capital[t] = tierCapital(stack.sources[t].usd, input.tiers[t]);
  }
  const totals = categoryTotals(capital);
  const legal = legalGate(input.legal?.regulatoryReview || {}, input.legal?.items || {});
  const deploy = simulateDeploy(totals.EXECUTABLE);
  const economic = bootstrapEconomicGate({ targetUsd, capital, economics: input.economics, deploy, loan });
  const outcome = decideOutcome(legal, economic);
  const corridors = corridorOptions({ token, incubationAsset, legal, economic, executableUsd: totals.EXECUTABLE });
  const selected = corridors.find((c) => c.kind === 'PROJECT_TOKEN' && c.eligible) || corridors.find((c) => c.kind === 'INTERIM_INCUBATION' && c.eligible) || null;
  const plan = {
    ok: true, title: BOOTSTRAP_TITLE, mode: SIM, name, token, tokenIdentified: !!token, incubationAsset, targetUsd: r2(targetUsd),
    combination: stack.combination, tiers: enabled, allocation: Object.fromEntries(TIER_SOURCES.map((t) => [t, { usd: stack.sources[t].usd, pct: stack.sources[t].pct }])),
    tierInfo: TIER_INFO, t2Terms: stack.terms.T2 ? { ...stack.terms.T2, disclosure: `Contractual exit rules (separate from custody): ${stack.terms.T2.termDays}-day term; early exit with ${stack.terms.T2.earlyExit.noticeDays} days notice and a ${stack.terms.T2.earlyExit.penaltyBps} bps early-exit charge. Assets stay in the participant's own TGLW position throughout.` } : null,
    capital, categoryTotals: totals, projectFunds: projectFunds(capital, num(input.projectOwnUsd)),
    gaps: TIER_SOURCES.filter((t) => capital[t].REQUESTED > 0).flatMap((t) => CATEGORIES.slice(1).map((k, i) => ({ tier: t, from: CATEGORIES[i], to: k, shortfallUsd: r2(capital[t][CATEGORIES[i]] - capital[t][k]) })).filter((g) => g.shortfallUsd > 0)),
    readiness: { legal: { status: legal.status, items: legal.items, reasons: legal.reasons, note: legal.note }, economic, outcome, independent: true },
    loan, corridors, selectedCorridor: selected, deploy: selected ? { ...deploy, corridor: selected.pair } : { ...deploy, corridor: null, note: 'No eligible corridor: nothing to deploy.' },
    handoff: selected && deploy.deployUsd > 0 ? xdlcHandoff({ name, selected, deploy, combination: stack.combination, totals }) : null,
    disclaimer: `SIMULATION. Requested, committed, funded and executable capital are separate numbers. TGLW (Tier 1/2) is participant-owned and never project funds. ${LENDING_DISCLOSURE}`,
  };
  return plan;
}

export function xdlcHandoff({ name, selected, deploy, combination, totals }) {
  return { endpoint: XDLC_ENDPOINT, method: 'POST',
    body: { marketId: `tglb:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}:${selected.pair}`, label: `${selected.pair} · ${name} (TGLB Bootstrap)`.slice(0, 120), origin: 'PROJECT_REQUESTED',
      source: 'tglb-bootstrap', mode: SIM, projectName: name, pair: selected.pair, base: selected.base, quote: selected.quote, corridorKind: selected.kind,
      tierCombination: combination, executableUsd: deploy.deployUsd, requestedUsd: totals.REQUESTED, committedUsd: totals.COMMITTED, fundedUsd: totals.FUNDED,
      rings: deploy.rings, engine: deploy.engine?.label, organic: false, hypothetical: true },
    note: 'Handoff to the XDLC corridor service (application logic; XDLC is a proposed XRPL amendment, not live).' };
}

// Deterministic demo project for the pitch.
export const DEMO_PROJECT = {
  name: 'Demo Harbor Co-op (fictional)', token: { currency: 'DHC', issuer: 'NOT_YET_ISSUED' }, incubationAsset: 'RLUSD', targetUsd: 400_000, projectOwnUsd: 60_000,
  tiers: {
    T1: { enabled: true, usd: 120_000, commitRate: 0.9, fundRate: 0.85, execRate: 0.9 },
    T2: { enabled: true, usd: 180_000, commitRate: 0.8, fundRate: 1, execRate: 0.95, termDays: 180, earlyExit: { noticeDays: 30, penaltyBps: 75 } },
    T3: { enabled: true, usd: 100_000, application: { termMonths: 12, structure: 'AMORTIZING', requestedAprBps: 900, collateralUsd: 80_000, monthlyRevenueUsd: 38_000, monthlyOpexUsd: 24_000, existingDebtUsd: 40_000, runwayMonths: 18, operatingHistoryMonths: 30, permittedUses: ['MARKET_MAKING_INVENTORY'] },
      vault: { lenders: [{ id: 'lender-a', usd: 150_000 }, { id: 'lender-b', usd: 100_000 }, { id: 'lender-c', usd: 50_000 }], firstLossUsd: 15_000, reserveUsd: 5_000, firstLossProvider: 'Project sponsor (subordinated)' } },
  },
  legal: { regulatoryReview: { status: 'IN_REVIEW', reviewer: 'Demo reviewer (fictional counsel)', date: '2026-10-22' },
    items: { issuer_trading_requirements: { status: 'PASS', docRef: 'DEMO-DHC-L3 (fictional)', reviewer: 'Demo reviewer (fictional counsel)', date: '2026-10-22' } } },
  economics: { runwayMonths: 18, operatingMonths: 12, independentParticipants: 24, verifiedEvidence: 3, targetSpreadBps: 50 },
};
const FULL_LEGAL = { regulatoryReview: { status: 'COUNSEL_OPINION_RECEIVED', reviewer: 'Demo reviewer (fictional counsel)', date: '2026-10-24' },
  items: Object.fromEntries(LEGAL_ITEMS.map((i, n) => [i.id, { status: 'PASS', docRef: `DEMO-DHC-L${n + 1} (fictional)`, reviewer: 'Demo reviewer (fictional counsel)', date: '2026-10-24' }])) };

const withT3 = (patch) => ({ ...DEMO_PROJECT, tiers: { ...DEMO_PROJECT.tiers, T3: { ...DEMO_PROJECT.tiers.T3, ...patch } } });
export function demoWalkthrough() {
  const S = (id, title, narration, input) => { const plan = planBootstrap(input); return { id, title, narration, input, plan }; };
  const base = DEMO_PROJECT;
  return { mode: SIM, project: base.name, fictional: true, label: LENDING_LABEL, steps: [
    S('name', '1 · Name the project', 'A fictional co-op names its project and identifies its token DHC (not issued). Its own-token market is not yet legally eligible, so it chooses RLUSD incubation.', base),
    S('target', '2 · Funding target', 'Target $400,000 across the TGLB tiers. The project keeps $60,000 of its own capital on a separate line.', base),
    S('tiers', '3 · Choose tiers', 'All three tiers: $120k Tier 1 (TGLW flexible), $180k Tier 2 (TGLW 180-day term), $100k Tier 3 (creditor financing). Any of the 7 combinations works.', base),
    S('commitments', '4 · Commitments and availability', 'Requested, committed, funded and executable stay separate per tier. TGLW stays in participants\' own positions and is never counted as project funds.', base),
    S('underwriting', '5 · Tier 3 underwriting', `Transparent scorecard prices the loan. ${LENDING_LABEL}: XLS-65/66 are not enabled on Testnet and not authorized here.`, base),
    S('late', '6 · Late payment scenario', 'Month 6 is paid 20 days late: late fee and penalty interest accrue by the documented formula.', withT3({ scenario: 'LATE', scenarioOpts: { missFromPeriod: 6, lateDays: 20 } })),
    S('default', '7 · Default and loss waterfall', 'Stress case: payments stop at month 3 and the collateral is marked down 60%. Default at 90 days past due. Recoveries, then the sponsor first-loss tranche, then the TGLB reserve absorb losses before senior lenders take the remainder pro rata.', withT3({ scenario: 'DEFAULT', scenarioOpts: { missFromPeriod: 3 }, terms: { collateralHaircut: 0.6 } })),
    S('readiness', '8 · Legal and economic readiness', 'Economics pass but legal review is open: profitability never overrides the legal gate. The project stays in XRP/RLUSD incubation.', base),
    S('deploy', '9 · Deploy into the XRP/RLUSD corridor', 'Executable liquidity is simulated into the interim XRP/RLUSD corridor through the six rings. Guardian verdict shown; nothing executes.', base),
    S('graduate', '10 · Legal documented: token corridor eligible', 'Once counsel documents every legal item, the same economics now make DHC/XRP eligible. The gates moved independently.', { ...base, legal: FULL_LEGAL }),
  ] };
}
