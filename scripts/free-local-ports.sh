#!/usr/bin/env bash
set -u

listener_pids() {
  lsof -ti "TCP:$1" -sTCP:LISTEN 2>/dev/null || true
}

wait_until_free() {
  local port="$1"
  local attempt

  for attempt in 1 2 3 4 5; do
    [ -z "$(listener_pids "$port")" ] && return 0
    sleep 1
  done

  [ -z "$(listener_pids "$port")" ]
}

free_port() {
  local port="$1"
  local pids

  pids="$(listener_pids "$port")"
  [ -z "$pids" ] && return 0

  echo "Stopping old local process on port $port: $pids"
  kill $pids 2>/dev/null || true
  wait_until_free "$port" && return 0

  pids="$(listener_pids "$port")"
  if [ -n "$pids" ]; then
    echo "Force stopping old local process on port $port: $pids"
    kill -KILL $pids 2>/dev/null || true
  fi
  wait_until_free "$port" && return 0

  echo "Port $port is still in use. Close the process manually and try again." >&2
  return 1
}

main() {
  if ! command -v lsof >/dev/null 2>&1; then
    echo "lsof is required to start the local project." >&2
    return 1
  fi

  free_port 4317 || return 1
  free_port 5173
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
