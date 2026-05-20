#!/usr/bin/env bash
# Quick Electron dev launch - starts only the Electron shell pointing at the frontend dev server.
# Backend services must be started separately (or will show as unhealthy in the UI).
#
# Usage: cd desktop && bash scripts/dev-electron.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"

cd "$DESKTOP_DIR"

if [ ! -d "node_modules" ]; then
  echo "Installing desktop dependencies..."
  npm install
fi

echo "Building TypeScript..."
npm run build

echo "Starting Electron (pointing at frontend dev server on localhost:5173)..."
VITE_DEV_SERVER_URL="http://localhost:5173" \
LAZYMIND_DEV_MODE=true \
npx electron .
