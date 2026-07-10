#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ensure_ollama() {
  if command -v ollama >/dev/null 2>&1; then
    return
  fi

  if [ "$(uname -s)" = "Darwin" ]; then
    if command -v brew >/dev/null 2>&1; then
      echo "Installing Ollama with Homebrew..."
      brew install --cask ollama
      return
    fi

    cat <<'EOF' >&2
Ollama is required for local image prompt generation, but it is not installed.
Install Homebrew and rerun ./start.sh, or install Ollama manually from:
https://ollama.com/download
EOF
    exit 1
  fi

  if command -v curl >/dev/null 2>&1; then
    echo "Installing Ollama with official installer..."
    curl -fsSL https://ollama.com/install.sh | sh
    return
  fi

  echo "Ollama is required, but curl is not available for automatic install." >&2
  exit 1
}

ensure_ollama
