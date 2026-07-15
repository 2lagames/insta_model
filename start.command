#!/usr/bin/env bash
set -u

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the current LTS version from https://nodejs.org/ and run start.command again."
  read -r -p "Press Enter to close this window..." _
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found with Node.js. Reinstall the current Node.js LTS version and run start.command again."
  read -r -p "Press Enter to close this window..." _
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installing project dependencies..."
  if ! npm install; then
    echo "Dependency installation failed."
    read -r -p "Press Enter to close this window..." _
    exit 1
  fi
fi

if ! ./scripts/free-local-ports.sh; then
  echo "Could not free the local application ports."
  read -r -p "Press Enter to close this window..." _
  exit 1
fi

echo "Starting the local project. Close this window to stop the server."
npm run dev
exit_code=$?
echo "Server stopped."
read -r -p "Press Enter to close this window..." _
exit "$exit_code"
