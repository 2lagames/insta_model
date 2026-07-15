#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

npm install

./scripts/bootstrap-deps.sh

./scripts/free-local-ports.sh

npm run dev
