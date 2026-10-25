#!/usr/bin/env bash
# User-level supervisor for Titan Forge (no sudo, no systemd). Polls /api/health and restarts the server
# with ./start.sh after FAILS consecutive failures. Only one watchdog per port (flock).
#
#   scripts/watchdog.sh                       watch 127.0.0.1:4131 (main demo server)
#   scripts/watchdog.sh --offline             restarts go into offline replay mode
#   PORT=4144 TF_READONLY=1 scripts/watchdog.sh   watch a private instance (env is passed to start.sh)
#
# Keep it alive across SSH drops (pick one):
#   setsid nohup scripts/watchdog.sh >> data/watchdog.log 2>&1 < /dev/null &
#   tmux new -d -s tf-watchdog 'scripts/watchdog.sh 2>&1 | tee -a data/watchdog.log'
# Survive a machine reboot (user crontab, `crontab -e`; NOT installed automatically):
#   @reboot cd /home/lb_hak/titan-forge && ./start.sh && setsid nohup scripts/watchdog.sh >> data/watchdog.log 2>&1 < /dev/null &
# Stop it: kill "$(cat data/watchdog-4131.pid)"
#
# Env: INTERVAL (s, default 10), FAILS (default 3), COOLDOWN (s after a restart, default 30).
cd "$(dirname "$0")/.."
PORT="${PORT:-4131}"; export PORT
INTERVAL="${INTERVAL:-10}"; FAILS="${FAILS:-3}"; COOLDOWN="${COOLDOWN:-30}"
START_ARGS=()
for a in "$@"; do case "$a" in --offline) START_ARGS+=(--offline) ;; *) echo "unknown argument: $a"; exit 2 ;; esac; done
mkdir -p data
LOCK="data/watchdog-$PORT.lock"
exec 9>"$LOCK"
if ! flock -n 9; then echo "watchdog for port $PORT already running"; exit 1; fi
echo $$ > "data/watchdog-$PORT.pid"
trap 'rm -f "data/watchdog-$PORT.pid"' EXIT
log() { echo "$(date -u +%FT%TZ) [watchdog:$PORT] $*"; }
log "watching http://127.0.0.1:$PORT/api/health every ${INTERVAL}s (restart after $FAILS failures)"
bad=0
while true; do
  if curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1; then
    [ "$bad" -gt 0 ] && log "healthy again"
    bad=0
  else
    bad=$((bad + 1)); log "health check failed ($bad/$FAILS)"
    if [ "$bad" -ge "$FAILS" ]; then
      log "restarting: ./start.sh ${START_ARGS[*]}"
      ./start.sh "${START_ARGS[@]}" 2>&1 | while read -r l; do log "$l"; done
      bad=0; sleep "$COOLDOWN"; continue
    fi
  fi
  sleep "$INTERVAL"
done
