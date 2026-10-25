#!/usr/bin/env node
// Headless browser check for every Titan Forge tab.
//   node scripts/browser-check.mjs [PORT] [--out DIR] [--no-shots] [--tab NAME] [--slice PX]
// Loads http://127.0.0.1:PORT in headless Chromium at 1440x900 and 375x812, light and dark,
// clicks every tab, and checks: no horizontal overflow (scrollWidth <= innerWidth),
// no console errors / uncaught exceptions, no failed requests (network errors or HTTP >= 500; in offline replay
// mode the server's deliberate 503 'offline replay mode' refusals are expected). With TF_OFFLINE the REPLAY banner must show.
// Prints a pass/fail table; exit code 1 if any cell fails.
//
// Safety: never clicks anything inside a tab, and blocks any request to live-signing endpoints
// (POST /api/launch, /api/pathfinder/run, /api/x402/live/purchase) at the browser level.
// No dependencies: drives Chromium over the DevTools protocol with Node 22's built-in WebSocket.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const PORT = Number(args.find((a) => /^\d+$/.test(a)) || process.env.PORT || 4131);
const OUT = flag('--out') || path.join(os.tmpdir(), `claude-${process.getuid?.() ?? 'x'}`, 'stability-shots');
const SHOTS = !args.includes('--no-shots');
const ONLY_TAB = flag('--tab');
const SLICE = Number(flag('--slice') || 0);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = [{ name: '1440', width: 1440, height: 900, mobile: false }, { name: '375', width: 375, height: 812, mobile: true }];
const THEMES = ['light', 'dark'];
const SETTLE_MS = Number(process.env.TF_CHECK_SETTLE_MS || 2500);
const FORBIDDEN = [/\/api\/launch$/, /\/api\/pathfinder\/run$/, /\/api\/x402\/live\/purchase$/, /\/api\/loop\/start$/];

function findChrome() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const pw = path.join(os.homedir(), '.cache', 'ms-playwright');
  const cands = [];
  if (fs.existsSync(pw)) {
    for (const d of fs.readdirSync(pw).sort().reverse()) {
      cands.push(path.join(pw, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'), path.join(pw, d, 'chrome-linux64', 'chrome'));
    }
  }
  cands.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable');
  return cands.find((c) => fs.existsSync(c));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchChrome(bin) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-chrome-'));
  const proc = spawn(bin, ['--headless', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('Chromium did not start within 15s')), 15000);
    proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); resolve(m[1]); } });
    proc.on('exit', (c) => reject(new Error(`Chromium exited (${c}): ${buf.slice(-400)}`)));
  });
  return { proc, wsUrl, profile };
}

class CDP {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.handlers = []; }
  open() {
    return new Promise((res, rej) => {
      this.ws.onopen = res; this.ws.onerror = (e) => rej(new Error('CDP socket error'));
      this.ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id && this.pending.has(msg.id)) { const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
        else if (msg.method) for (const h of this.handlers) h(msg);
      };
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(fn) { this.handlers.push(fn); }
}

async function main() {
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch((e) => ({ error: e.message }));
  if (health.error) { console.error(`Server on ${BASE} not reachable: ${health.error}`); process.exit(2); }
  const bin = findChrome();
  if (!bin) { console.error('No Chromium found. Set CHROME_BIN or install with: npx playwright install chromium-headless-shell'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`browser-check ${BASE} · ${path.basename(bin)} · health ${JSON.stringify(health)}${SHOTS ? ` · shots ${OUT}` : ''}`);

  const { proc, wsUrl, profile } = await launchChrome(bin);
  const cdp = new CDP(wsUrl); await cdp.open();
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: s } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => cdp.send(m, p, s);

  let issues = [];
  const reqs = new Map();
  cdp.on((msg) => {
    if (msg.sessionId !== s) return;
    const p = msg.params;
    switch (msg.method) {
      case 'Runtime.consoleAPICalled': if (p.type === 'error') issues.push(`console: ${p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`); break;
      case 'Runtime.exceptionThrown': issues.push(`exception: ${(p.exceptionDetails.exception?.description || p.exceptionDetails.text).split('\n')[0].slice(0, 200)}`); break;
      case 'Network.requestWillBeSent': reqs.set(p.requestId, { url: p.request.url, method: p.request.method, type: p.type }); break;
      case 'Network.responseReceived': if (p.response.status >= 500 && !(health.offline && p.response.status === 503)) issues.push(`HTTP ${p.response.status} ${p.response.url.replace(BASE, '')}`); break;
      case 'Network.loadingFailed': {
        const r = reqs.get(p.requestId) || {};
        if (p.canceled || r.type === 'EventSource' || /ERR_ABORTED/.test(p.errorText)) break;
        issues.push(`request failed: ${r.method || ''} ${(r.url || '').replace(BASE, '')} ${p.errorText}`); break;
      }
      case 'Fetch.requestPaused': {
        const blocked = p.request.method === 'POST' && FORBIDDEN.some((re) => re.test(new URL(p.request.url).pathname));
        if (blocked) { issues.push(`BLOCKED live-signing request ${p.request.url.replace(BASE, '')}`); send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }); }
        else send('Fetch.continueRequest', { requestId: p.requestId });
        break;
      }
    }
  });
  await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: `${BASE}/api/*`, requestStage: 'Request' }] });

  const expected = (await fetch(`${BASE}/api/modules`).then((r) => r.json()).catch(() => [])).length || 1;
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
  const results = [];
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      issues = [];
      await send('Page.navigate', { url: `${BASE}/` });
      // Wait for the shell to mount its tabs.
      // Modules mount one by one, so wait until every module has a tab (or the count stops growing for 15s: a module whose import failed never gets a tab).
      let tabs = [], stable = 0;
      for (let i = 0; i < 240 && tabs.length < expected && stable < 60; i++) {
        await sleep(250);
        const now = (await evalJs(`[...document.querySelectorAll('#tabs button')].map(b => b.textContent)`)) || [];
        stable = now.length && now.length === tabs.length ? stable + 1 : 0; tabs = now;
      }
      await sleep(SETTLE_MS);
      const bootIssues = issues; issues = [];
      if (!tabs.length) results.push({ tab: '(shell)', vp: vp.name, theme, ok: false, notes: ['no tabs mounted', ...bootIssues] });
      for (let i = 0; i < tabs.length; i++) {
        if (ONLY_TAB && !tabs[i].toLowerCase().includes(ONLY_TAB.toLowerCase())) continue;
        if (i === 0) issues.push(...bootIssues.map((x) => `boot ${x}`));
        await evalJs(`document.querySelectorAll('#tabs button')[${i}].click(); window.scrollTo(0,0)`);
        await sleep(SETTLE_MS);
        const m = await evalJs(`(() => {
          const iw = window.innerWidth, sw = document.documentElement.scrollWidth;
          const panel = [...document.querySelectorAll('#panels > section')].find(p => !p.hidden);
          const failed = panel ? [...panel.querySelectorAll('.card.err')].map(e => e.textContent.trim().slice(0, 120)) : [];
          const wide = [];
          if (sw > iw) for (const e of document.querySelectorAll('body *')) {
            const r = e.getBoundingClientRect();
            if (r.right > iw + 1 && r.width > 0 && getComputedStyle(e).position !== 'fixed') {
              const parentWide = e.parentElement && e.parentElement.getBoundingClientRect().right > iw + 1;
              if (!parentWide) wide.push((e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : '')) + ' ' + Math.round(r.right) + 'px');
            }
            if (wide.length >= 4) break;
          }
          return { iw, sw, failed, wide, h: Math.min(document.documentElement.scrollHeight, 16000), banner: !!document.getElementById('tf-replay-banner') };
        })()`);
        const notes = [...issues];
        if (health.offline && !m.banner) notes.push('offline replay mode but no REPLAY banner');
        if (m.sw > m.iw) notes.push(`overflow ${m.sw}>${m.iw}: ${m.wide.join(', ')}`);
        for (const f of m.failed) notes.push(`module error card: ${f}`);
        if (SHOTS) {
          const base = `${tabs[i].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${vp.name}-${theme}`;
          // --slice H: write the page as several H-px-tall images (easier to inspect a long phone page).
          const step = SLICE || m.h;
          for (let y = 0, n = 1; y < m.h; y += step, n++) {
            const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y, width: vp.width, height: Math.min(step, m.h - y), scale: 1 } });
            fs.writeFileSync(path.join(OUT, SLICE ? `${base}-${n}.png` : `${base}.png`), Buffer.from(shot.data, 'base64'));
          }
        }
        results.push({ tab: tabs[i], vp: vp.name, theme, ok: notes.length === 0, notes, scroll: `${m.sw}/${m.iw}` });
        issues = [];
      }
    }
  }
  await cdp.send('Browser.close').catch(() => {});
  setTimeout(() => proc.kill('SIGKILL'), 2000).unref();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}

  // Pass/fail table: one row per tab, one column per viewport x theme.
  const cols = VIEWPORTS.flatMap((v) => THEMES.map((t) => `${v.name}/${t}`));
  const rows = [...new Set(results.map((r) => r.tab))];
  const w = Math.max(12, ...rows.map((r) => r.length));
  console.log('\n' + 'TAB'.padEnd(w) + ' | ' + cols.map((c) => c.padEnd(10)).join(' | '));
  console.log('-'.repeat(w) + '-+-' + cols.map(() => '-'.repeat(10)).join('-+-'));
  for (const tab of rows) {
    console.log(tab.padEnd(w) + ' | ' + cols.map((c) => { const r = results.find((x) => x.tab === tab && `${x.vp}/${x.theme}` === c); return (r ? (r.ok ? 'PASS' : 'FAIL') : '-').padEnd(10); }).join(' | '));
  }
  const fails = results.filter((r) => !r.ok);
  if (fails.length) {
    console.log('\nFailures:');
    for (const f of fails) console.log(`- ${f.tab} @ ${f.vp}/${f.theme}:\n    ${[...new Set(f.notes)].join('\n    ')}`);
  }
  console.log(`\n${results.length - fails.length}/${results.length} passed${SHOTS ? ` · screenshots in ${OUT}` : ''}`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error('browser-check error:', e.message); process.exit(2); });
