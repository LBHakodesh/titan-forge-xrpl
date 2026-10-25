# Titan Forge demo runbook (London, Oct 24–25 2026)

**Bottom line:** the demo is `http://127.0.0.1:4131` on the London node (`LON-Node`), viewed from your laptop through an SSH tunnel. It is XRPL **Testnet only**. If venue networking fails, switch to **offline replay mode** (`scripts/demo-offline.sh`): it needs no network, can't sign, and labels everything `REPLAY`. Anything that signs a transaction needs the Commander's approval first.

---

## 1. Staging URL and access

The server binds to `127.0.0.1:4131` only and is never exposed publicly. View it through a tunnel:

```bash
# from your laptop
ssh -L 4131:127.0.0.1:4131 <user>@<london-node-host>
# then open http://127.0.0.1:4131 in the laptop browser
```

Keep the tunnel in its own terminal. If it drops, run the same command again. The server keeps running (see §3).

## 2. Start, stop, restart

On the London node, from `~/titan-forge`:

| Action | Command |
|---|---|
| Start, or restart if already running | `./start.sh` |
| Start in offline replay mode | `./start.sh --offline` or `scripts/demo-offline.sh` |
| Stop | `./start.sh stop` |
| Status and health | `./start.sh status` |
| Logs | `tail -f data/server.log` |

`./start.sh` waits until `/api/health` answers before it returns. With `PORT=41xx` it writes its own `data/server-41xx.pid` and log, so private test instances never touch the 4131 pid file. Always run test instances with `TF_READONLY=1`.

## 3. Surviving SSH drops and crashes

- `start.sh` starts the server with `setsid nohup`, in its own session with no terminal. Closing SSH does not stop it, and the server already survived an SSH drop on the night of Oct 23.
- **Run your shell work in tmux** so a dropped SSH session doesn't lose your terminal either:
  ```bash
  tmux new -A -s demo          # attach, or create the session
  # Ctrl-b d to detach; after reconnecting: tmux attach -t demo
  ```
- **Watchdog (user-level supervisor, no sudo).** It polls `/api/health` every 10 s and runs `./start.sh` after 3 failures in a row. Only one watchdog can run per port.
  ```bash
  # either, detached:
  setsid nohup scripts/watchdog.sh >> data/watchdog.log 2>&1 < /dev/null &
  # or, in tmux:
  tmux new -d -s tf-watchdog 'scripts/watchdog.sh 2>&1 | tee -a data/watchdog.log'
  # restarts go into offline mode instead:   scripts/watchdog.sh --offline
  # stop it:                                 kill "$(cat data/watchdog-4131.pid)"
  ```
  Tuning variables: `INTERVAL` (s), `FAILS`, `COOLDOWN` (s).
- **After a reboot**, add this line to the user crontab (`crontab -e`). It is not installed automatically:
  ```
  @reboot cd /home/lb_hak/titan-forge && ./start.sh && setsid nohup scripts/watchdog.sh >> data/watchdog.log 2>&1 < /dev/null &
  ```
- A route plugin that fails to load is skipped and logged (`[routes] SKIPPED <file> - <error>`), and the rest of the demo keeps serving. `GET /api/health` lists the skipped plugins in `skippedRoutes`.
- If Testnet can't be reached at startup, the server keeps serving and retries the ledger bootstrap in the background (every 30 s, backing off; `TF_BOOTSTRAP_RETRY_MS=0` disables the retry).

## 4. Offline replay mode (fallback when there is no network)

```bash
scripts/demo-offline.sh          # restarts 4131 in offline replay mode
./start.sh                       # back to live Testnet
PORT=4150 scripts/demo-offline.sh   # optional: a second, offline-only instance on 4150 (tunnel 4150 too)
```

What offline mode does (`TF_OFFLINE=1`, which also sets `TF_READONLY=1`):

- **No network at all.** The ledger bootstrap is skipped. Every xrpl client (Testnet, Mainnet observer, spokes) refuses to connect, and outbound `fetch` is limited to loopback.
- **Signing is impossible.** All ledger submit and sign methods throw, the in-memory wallets hold public addresses only, and `Wallet.sign` is disabled.
- **Live-only actions are refused** with HTTP 503 `"Offline replay mode (TF_OFFLINE=1): …"`. This covers launch, Pathfinder live run, Mainnet profile refresh, x402 live purchase, spokes refresh, the live order book, and LIVE_TESTNET corridor promote/demote.
- **Recorded data is served as REPLAY:** launches, Pathfinder runs, x402 runs, the spokes snapshot and findings. Every `mode: LIVE_TESTNET` field is relabeled `REPLAY`, and any LIVE TESTNET badge on screen is relabeled REPLAY. A purple **REPLAY banner** shows on every tab.
- **Deterministic:** the replay comes only from the recorded files, in recorded order with recorded timestamps. Arena games go to a scratch file (`data/arena.offline-<port>.json`).
- SIMULATION features (Capital Injection, x402 SIMULATION purchase and attack lab, Access, Arena, Engine) work as normal.

To rehearse a dropped network without unplugging anything: `node --import ./scripts/no-network.mjs server.mjs`. This blocks all non-loopback connections for that process only.

## 5. Rollback

```bash
cd ~/titan-forge
cp data/wallets.json /tmp/wallets.json.bak     # untracked, 0600, holds the demo seeds. Never commit or print it
git stash -u                                   # or commit / copy the current work elsewhere first
git checkout baseline-122                      # code and tracked data back to the 122-test baseline
./start.sh
```

- Tracked files in `data/` are `corridor.json`, `launches.json`, `mainnet-profile.json`, `pathfinder-runs.json` and `x402-runs.json`. To restore only the data and keep the current code, run `git checkout baseline-122 -- data/launches.json data/x402-runs.json data/pathfinder-runs.json data/corridor.json data/mainnet-profile.json`.
- `data/wallets.json` is untracked and ignored, so `git checkout` and `git stash` leave it alone. **Never run `git clean -x`, `git clean -fdx` or `rm -rf data/`.** If it is lost anyway, restore it with `cp /tmp/wallets.json.bak data/wallets.json && chmod 600 data/wallets.json`. Without it the bootstrap would generate new demo accounts, and the recorded launches would no longer match them.
- To return to the latest work afterwards: `git checkout -` (then `git stash pop` if you stashed).

## 6. Pre-demo checklist (about 15 minutes before)

1. `./start.sh status`: running, `"ok":true`, `"ledgerReady":true`, `skippedRoutes: []`.
2. `npm test`: 0 failing.
3. `npm run check -- 4131` (or `node scripts/browser-check.mjs 4131`): every tab passes at 1440×900 and 375×812 in light and dark, with no horizontal overflow, console errors or failed requests. Screenshots go to `/tmp/claude-<uid>/stability-shots/` (`--out DIR`, `--slice 1400` for long pages). The check never clicks inside a tab and blocks the signing endpoints at the browser level.
4. Ledger reachability: the header shows `LIVE TESTNET ledger <n>` and the number goes up on refresh. Also check `curl -s 127.0.0.1:4131/api/status | head -c 300`.
5. The watchdog is running: `cat data/watchdog-4131.pid` and `tail data/watchdog.log`.
6. The SSH tunnel is up, and the laptop browser is at `http://127.0.0.1:4131` and zoomed for the projector.
7. Fallback ready: you know the `scripts/demo-offline.sh` command (§4).

## 6b. Presentation mode (3-minute pitch)

- **Route:** `http://127.0.0.1:4131/#present/start` auto-starts the pitch once every tab has mounted. You can also press **▶ Present** in the header, or open the **▶ 3-Minute Pitch** tab and click Start. `/#<tab-id>` (for example `/#xdlc-protocol`) opens any tab directly.
- **Keys:** Space pause/resume · → next cue · ← previous · Esc exit · F fullscreen · S presenter script. Narration, timing table and judge Q&A are in **docs/PITCH_SCRIPT.md**.
- The pitch only switches tabs and sends scene events. It never signs and never calls a live-signing endpoint. Scene hooks in the incubator, TGAN and redeploy tabs write SIMULATION records only.
- A missing tab falls back (theater → Titan View, xdlc-app → Demand & Corridor, redeploy → Capital Injection, vendors → merchant → x402). If nothing is loaded, the caption says "coming online".
- Rehearse once on the projector before going on, ideally in fullscreen (F). It works offline too (`scripts/demo-offline.sh`).

## 6c. Navigation (GYW1313 layout)

Primary entries sit along the top (on a phone, behind ☰ Menu). The sub-row lists the tabs inside the selected entry:

| Entry | Tabs |
|---|---|
| WATCH TITAN GHOST | theater (Watch Titan Ghost), view, loop |
| EXPLORE MAINNET | observatory, pathfinder |
| DOLPHIN / SHARK / WHALE / KRAKEN | theater + scenario chips (`tf:present` dolphin…kraken) |
| TGLB BOOTSTRAP | incubator, capital |
| XDLC PROTOCOL | xdlc-protocol (proposed amendment draft), xdlc-app, corridor |
| WATCH CAPITAL MOVE | redeploy |
| TG SENTINEL | sentinel, findings |
| VENDOR INTEGRATIONS | vendors, merchant, x402, access |
| ALL PRODUCTS | products |
| MORE | every other tab (launch, tgan, arena, engine, …) |

An entry whose tab isn't loaded shows as "coming online". It is never a broken tab. The header theme button cycles auto, light and dark.

## 7. Demo script by tab

| Tab | Show | Safe to click live |
|---|---|---|
| **Launch Your Token** | The recorded BBL and LDN launches: each step's validated Testnet tx and the explorer links. **Replay** steps through a recorded launch. | Replay, explorer links. **Not** "Launch on Testnet" (signs) |
| **Titan View** | XRP hub with token spokes, stage legend and the **Replay timeline**. Tap a token node for its order book and transactions. | Replay timeline, node taps |
| **Liquidity Observatory** | Hub-and-spoke view of observed liquidity; snapshot freshness and attribution. | Viewing, filters |
| **Pathfinder Flow** | Recorded runs: our strategy vs the rival demo maker, capture share, bridged payments, bps vs mid. **Plan** is a dry run. | Plan (dry run), viewing runs. **Not** "Run" (signs) |
| **Demo Loop** | The full cycle repeating on Testnet: launch → direct fill → Pathfinder batch, next to the real Mainnet rate. Capped session; red DEMO LOOP banner while running. | Viewing. **Start** signs: only the Commander presses it (docs/SPEC_EXCEPTION_DEMO_LOOP.md). Stop is always safe |
| **Sentinel** | Live findings on our tokens (concentration, demo-generated fills) and the Guardian exercise. | Everything (read-only) |
| **Sentinel Findings** | Findings registry: severity × provenance, sources, report. | Viewing, filters; status and notes edits are local records |
| **x402 Payments & Data** | Integration status, telemetry, a **SIMULATION** purchase (REQUEST → 402 → … → DELIVERY), the recorded LIVE_TESTNET run with **Replay**, the agent spend policy and the attack lab. | Run SIMULATION purchase, Replay, View sample, Buy (SIMULATION), Run agent, attacks. **Not** the "LIVE_TESTNET demonstration (operator only)" purchase |
| **Access & Free Threshold** | Same free threshold for every participant category, the category comparison table, demo plans above the threshold, and essential functions that are never gated. | Simulate, Check access, demo threshold control (SIMULATION; reset after) |
| **Titan Arena** | Educational game; leaderboard. | All (SIMULATION) |
| **XDLC Protocol** | The proposed-amendment draft: status strip (not submitted, not reviewed, not implemented in xrpld, not activated), summary and draft docs. | Everything (read-only) |
| Capital Injection / Demand & Corridor / Engine Contracts | Ring allocation (temporary demo adapter, labeled), corridor stages (SIMULATION), engine contracts. | SIMULATION actions only |

## 8. Do NOT click live without approval

- **Anything that signs a Testnet transaction needs Commander approval first:** *Launch on Testnet* (`POST /api/launch`), Pathfinder *Run* (`POST /api/pathfinder/run`), and a LIVE_TESTNET corridor promote.
- **The x402 LIVE_TESTNET purchase (`POST /api/x402/live/purchase`) is never run without explicit approval for that specific payment.** Use the SIMULATION purchase or Replay the recorded run instead.
- Don't run `git clean`, don't delete `data/`, and never print or share `data/wallets.json`.
- Don't bind the server to anything other than 127.0.0.1, and don't expose it publicly. Always use the SSH tunnel.
- No Mainnet: Mainnet is read-only observation (`MAINNET_OBSERVED`), and nothing is published to gyw1313.com.
