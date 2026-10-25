#!/usr/bin/env bash
# Switch the demo to offline replay mode (no network needed): recorded launches, Pathfinder runs, x402 runs
# and the spokes snapshot are served as REPLAY, a REPLAY banner shows on every tab, and nothing can sign.
#   scripts/demo-offline.sh          restart the main server (4131) in offline replay mode
#   PORT=4150 scripts/demo-offline.sh   run a separate offline instance instead (leaves 4131 alone)
# Back to live:  ./start.sh            (restarts without TF_OFFLINE)
cd "$(dirname "$0")/.."
# Arena games played during an offline demo go to a scratch file, so recorded data stays as it was.
export TF_ARENA_FILE="${TF_ARENA_FILE:-data/arena.offline-${PORT:-4131}.json}"
exec ./start.sh --offline "$@"
