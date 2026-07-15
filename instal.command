#!/usr/bin/env bash
set -u

cd "$(cd -- "$(dirname -- "$0")" && pwd)"

fail() {
  echo "$1"
  read -r -p "Press Enter to close this window..." _
  exit 1
}

if [ -e .git ] || [ -e package.json ]; then
  fail "This folder already contains an application checkout. Run update.command instead."
fi

if ! command -v brew >/dev/null 2>&1; then
  if ! command -v curl >/dev/null 2>&1; then
    fail "curl is required to install Homebrew automatically. Install curl, then run instal.command again."
  fi

  echo "Installing Homebrew. macOS may ask for your administrator password..."
  if ! /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; then
    fail "Homebrew installation failed. Run instal.command again after resolving the message above."
  fi
fi

if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

if ! command -v brew >/dev/null 2>&1; then
  fail "Homebrew was not found after installation. Restart Terminal and run instal.command again."
fi

if ! command -v git >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  echo "Installing Git and Node.js LTS..."
  if ! brew install git node; then
    fail "Git and Node.js installation failed."
  fi
fi

if ! command -v git >/dev/null 2>&1; then
  fail "Git was not found after installation."
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  fail "Node.js and npm were not found after installation."
fi

echo "Downloading the latest application release..."
if ! git init; then
  fail "Could not initialise the application folder as a Git repository."
fi

if ! git remote add origin https://github.com/2lagames/insta_model.git; then
  fail "Could not configure the application repository."
fi

if ! git fetch --tags --force origin; then
  fail "Could not download application releases from GitHub."
fi

release_tag="$(git tag --list "v[0-9]*.[0-9]*.[0-9]*" --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1)"
if [ -z "$release_tag" ]; then
  fail "No stable application release tag was found."
fi

echo "Installing application release $release_tag..."
if ! git checkout --detach "$release_tag"; then
  fail "Could not check out application release $release_tag."
fi

echo "Installing application dependencies..."
if ! npm ci; then
  fail "Dependency installation failed."
fi

echo "Starting the local project. Close this window to stop the server."
npm run dev
exit_code=$?
echo "Server stopped."
read -r -p "Press Enter to close this window..." _
exit "$exit_code"
