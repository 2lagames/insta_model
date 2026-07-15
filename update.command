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

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Tracked local changes were found. Commit or discard them before running update.command."
  read -r -p "Press Enter to close this window..." _
  exit 1
fi

echo "Downloading the latest application release..."
if ! git fetch --tags --force origin; then
  echo "Could not download application releases from GitHub."
  read -r -p "Press Enter to close this window..." _
  exit 1
fi

release_tag="$(git tag --list "v[0-9]*.[0-9]*.[0-9]*" --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1)"
if [ -z "$release_tag" ]; then
  echo "No stable application release tag was found."
  read -r -p "Press Enter to close this window..." _
  exit 1
fi

echo "Installing application release $release_tag..."
if ! git checkout --detach "$release_tag"; then
  echo "Could not check out application release $release_tag."
  read -r -p "Press Enter to close this window..." _
  exit 1
fi

echo "Installing project dependencies..."
if ! npm ci; then
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
