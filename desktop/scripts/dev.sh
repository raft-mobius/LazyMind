#!/usr/bin/env bash
# LazyMind Desktop - Development Launcher
# Starts all backend services + frontend dev server + Electron shell
#
# Prerequisites:
#   - Node.js 20+ with npm
#   - Go 1.24+
#   - Python 3.11+ with pip
#   - pnpm (for frontend)
#
# Usage:
#   cd desktop && bash scripts/dev.sh
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$(dirname "$DESKTOP_DIR")")"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
CORE_DIR="$BACKEND_DIR/core"
AUTH_DIR="$BACKEND_DIR/auth-service"

# Data directory for dev mode
DATA_DIR="$DESKTOP_DIR/.dev-data"
mkdir -p "$DATA_DIR/data" "$DATA_DIR/logs"

# Generate a local secret for this dev session
LOCAL_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 64)

echo "=== LazyMind Desktop Dev Mode ==="
echo "Data dir: $DATA_DIR"
echo ""

# Cleanup function
cleanup() {
  echo ""
  echo "Shutting down..."
  kill $AUTH_PID $CORE_PID $FRONTEND_PID 2>/dev/null || true
  wait $AUTH_PID $CORE_PID $FRONTEND_PID 2>/dev/null || true
  echo "All services stopped."
}
trap cleanup EXIT INT TERM

# 1. Start auth-service
echo "[1/4] Starting auth-service..."
(
  cd "$AUTH_DIR"
  if [ ! -d ".venv" ]; then
    echo "  Creating Python venv..."
    python -m venv .venv
    .venv/Scripts/pip install -r requirements.txt 2>/dev/null || .venv/bin/pip install -r requirements.txt
  fi
  PYTHON_BIN=".venv/Scripts/python"
  [ ! -f "$PYTHON_BIN" ] && PYTHON_BIN=".venv/bin/python"

  LAZYMIND_DATABASE_URL="sqlite:///$DATA_DIR/data/auth.db" \
  LAZYMIND_MODE=desktop \
  LAZYMIND_STATE_BACKEND=memory \
  LAZYMIND_JWT_SECRET="$LOCAL_SECRET" \
  LAZYMIND_LOCAL_SECRET="$LOCAL_SECRET" \
  $PYTHON_BIN -m uvicorn main:app --host 127.0.0.1 --port 8002 --log-level info
) &
AUTH_PID=$!

# Wait for auth-service health
echo "  Waiting for auth-service..."
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:8002/api/authservice/auth/health >/dev/null 2>&1; then
    echo "  auth-service healthy"
    break
  fi
  sleep 1
done

# Bootstrap desktop (create default assistant)
curl -s -X POST http://127.0.0.1:8002/api/authservice/desktop/bootstrap >/dev/null 2>&1 || true

# 2. Start Go core
echo "[2/4] Starting core..."
(
  cd "$CORE_DIR"
  ACL_DB_DRIVER=sqlite \
  ACL_DB_DSN="$DATA_DIR/data/main.db" \
  LAZYMIND_STATE_BACKEND=memory \
  LAZYMIND_MODE=desktop \
  LAZYMIND_JWT_SECRET="$LOCAL_SECRET" \
  LAZYMIND_LOCAL_SECRET="$LOCAL_SECRET" \
  SERVER_PORT=8001 \
  SERVER_HOST=127.0.0.1 \
  go run .
) &
CORE_PID=$!

# Wait for core health
echo "  Waiting for core..."
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:8001/health >/dev/null 2>&1; then
    echo "  core healthy"
    break
  fi
  sleep 1
done

# 3. Start frontend dev server
echo "[3/4] Starting frontend dev server..."
(
  cd "$FRONTEND_DIR"
  if [ ! -d "node_modules" ]; then
    pnpm install
  fi
  VITE_LAZYMIND_MODE=desktop pnpm dev
) &
FRONTEND_PID=$!

# Wait for frontend
echo "  Waiting for frontend dev server..."
for i in $(seq 1 15); do
  if curl -s http://127.0.0.1:5173 >/dev/null 2>&1; then
    echo "  frontend ready at http://localhost:5173"
    break
  fi
  sleep 1
done

# 4. Start Electron
echo "[4/4] Starting Electron..."
(
  cd "$DESKTOP_DIR"
  if [ ! -d "node_modules" ]; then
    npm install
  fi
  npm run build

  VITE_DEV_SERVER_URL="http://localhost:5173" \
  LAZYMIND_DEV_MODE=true \
  npx electron .
)

echo "Electron exited."
