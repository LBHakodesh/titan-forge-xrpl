#!/usr/bin/env bash
# Start Titan Forge detached on 127.0.0.1:4131 (logs: data/server.log, pid: data/server.pid).
# setsid + nohup: the server is in its own session, so it survives the SSH session (and its terminal) closing.
#
#   ./start.sh                 start, or restart if already running (unchanged default)
#   ./start.sh --offline       same, in offline replay mode (TF_OFFLINE=1: no network, no signing, REPLAY data)
#   ./start.sh stop            stop the server started by this script
#   ./start.sh status          print pid and /api/health
#
# PORT=41xx ./start.sh ... uses data/server-41xx.pid and data/server-41xx.log, so a private instance never
# touches the main 4131 server's pid file. Extra env (TF_READONLY, TF_OFFLINE, ...) is passed through.
cd "$(dirname "$0")"
PORT="${PORT:-4131}"
if [ "$PORT" = "4131" ]; then PIDFILE=data/server.pid; LOG=data/server.log; else PIDFILE="data/server-$PORT.pid"; LOG="data/server-$PORT.log"; fi
CMD=start
for a in "$@"; do
  case "$a" in
    --offline) export TF_OFFLINE=1 ;;
    stop|status|start|restart) CMD="$a" ;;
    *) echo "unknown argument: $a (use --offline, stop, status)"; exit 2 ;;
  esac
done
mkdir -p data
running() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }
health() { curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/health"; }

stop_server() {
  if running; then
    kill "$(cat "$PIDFILE")"
    for _ in 1 2 3 4 5 6 7 8 9 10; do running || break; sleep 0.5; done
    running && { echo "pid $(cat "$PIDFILE") did not exit on TERM; sending KILL"; kill -9 "$(cat "$PIDFILE")"; }
  fi
}

case "$CMD" in
  stop) stop_server; echo "stopped"; exit 0 ;;
  status)
    if running; then echo "pid $(cat "$PIDFILE") on port $PORT"; health; echo; exit 0; else echo "not running (port $PORT)"; exit 1; fi ;;
esac

stop_server
PORT="$PORT" setsid nohup node server.mjs >> "$LOG" 2>&1 < /dev/null &
echo $! > "$PIDFILE"
echo "started pid $(cat "$PIDFILE") on 127.0.0.1:$PORT${TF_OFFLINE:+ (OFFLINE REPLAY)}"
for _ in $(seq 1 20); do sleep 0.5; if h=$(health 2>/dev/null); then echo "health: $h"; exit 0; fi; done
echo "warning: /api/health not answering yet; see $LOG"
