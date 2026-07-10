#!/usr/bin/env bash
set -u

cd "$(dirname "$0")"

if ! command -v git >/dev/null 2>&1; then
  echo "Git was not found. Install Git from https://git-scm.com/downloads and run update.command again."
  read -r -p "Press Enter to close this window..." _
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the current LTS version from https://nodejs.org/ and run update.command again."
  read -r -p "Press Enter to close this window..." _
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found with Node.js. Reinstall the current Node.js LTS version and run update.command again."
  read -r -p "Press Enter to close this window..." _
  exit 1
fi

echo "Updating the project..."
if ! git pull --ff-only; then
  echo "Project update failed. Resolve any Git changes, then run update.command again."
  read -r -p "Press Enter to close this window..." _
  exit 1
fi

echo "Installing project dependencies..."
if ! npm install; then
  echo "Dependency installation failed."
  read -r -p "Press Enter to close this window..." _
  exit 1
fi

echo "Starting the local project. Close this window to stop the server."
npm run dev
exit_code=$?
echo "Server stopped."
read -r -p "Press Enter to close this window..." _
exit "$exit_code"
