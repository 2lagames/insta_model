#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

free_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "Stopping old local process on port ${port}: ${pids}"
    kill $pids 2>/dev/null || true
    sleep 1
  fi
}

npm install

./scripts/bootstrap-deps.sh

free_port 4317
free_port 5173

npm run dev
