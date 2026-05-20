#!/usr/bin/env bash
# Build a self-contained LazyMind Desktop dev directory at ~/LazyMind_dev/
# that can be launched by double-clicking LazyMind.bat.
#
# Usage: bash desktop/scripts/build-dev-exe.sh
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$DESKTOP_DIR")"
FRONTEND_DIR="$ROOT_DIR/frontend"
CORE_DIR="$ROOT_DIR/backend/core"

TARGET_DIR="$HOME/LazyMind_dev"

echo "=== Building LazyMind Desktop Dev Package ==="
echo "Source:  $ROOT_DIR"
echo "Target:  $TARGET_DIR"
echo ""

# Clean previous build
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR/bin" "$TARGET_DIR/app" "$TARGET_DIR/data"

# ---- 1. Build Go core ----
echo "[1/4] Building Go core..."
(cd "$CORE_DIR" && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o "$TARGET_DIR/bin/core.exe" .)
echo "      -> bin/core.exe"

# ---- 1b. Copy SQLite migrations ----
echo "      Copying SQLite migrations..."
mkdir -p "$TARGET_DIR/migrations/sqlite"
cp "$CORE_DIR"/migrations/sqlite/*.sql "$TARGET_DIR/migrations/sqlite/"
echo "      -> migrations/sqlite/"

# ---- 2. Build frontend ----
echo "[2/4] Building frontend (desktop mode)..."
(cd "$FRONTEND_DIR" && VITE_LAZYMIND_MODE=desktop npx vite build --outDir "$TARGET_DIR/renderer")
echo "      -> renderer/"

# ---- 3. Build Electron app ----
echo "[3/4] Building Electron app..."
(cd "$DESKTOP_DIR" && npm run build)

# Copy compiled JS
cp -r "$DESKTOP_DIR/dist/main" "$TARGET_DIR/app/main"
cp -r "$DESKTOP_DIR/dist/preload" "$TARGET_DIR/app/preload"

# Create minimal package.json for electron
cat > "$TARGET_DIR/app/package.json" << 'PKGJSON'
{
  "name": "lazymind-desktop",
  "version": "0.1.0",
  "main": "main/main/index.js",
  "dependencies": {}
}
PKGJSON

# Copy runtime dependencies
mkdir -p "$TARGET_DIR/app/node_modules"
for dep in http-proxy eventemitter3 requires-port follow-redirects archiver yaml \
           archiver-utils lazystream compress-commons zip-stream crc-32 crc32-stream \
           readable-stream buffer-crc32 tar-stream bl is-stream normalize-path glob \
           lodash graceful-fs async b4a streamx fast-fifo text-decoder queue-tick \
           bare-events; do
  if [ -d "$DESKTOP_DIR/node_modules/$dep" ]; then
    cp -r "$DESKTOP_DIR/node_modules/$dep" "$TARGET_DIR/app/node_modules/"
  fi
done

# Copy resources
cp -r "$DESKTOP_DIR/resources" "$TARGET_DIR/app/resources"
echo "      -> app/"

# ---- 4. Copy Electron binary ----
echo "[4/5] Copying Electron runtime..."
cp -r "$DESKTOP_DIR/node_modules/electron/dist" "$TARGET_DIR/electron"
echo "      -> electron/"

# ---- 5. Build launcher exe ----
echo "[5/5] Building launcher exe..."
LAUNCHER_DIR="$DESKTOP_DIR/cmd/launcher"

# Generate Windows resource (icon + version info)
(cd "$LAUNCHER_DIR" && goversioninfo -icon=../../resources/icons/icon.ico)

# Build the launcher (no console window, stripped)
(cd "$LAUNCHER_DIR" && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build \
  -ldflags "-H=windowsgui -s -w" \
  -o "$TARGET_DIR/LazyMind.exe" .)

# Clean up generated resource
rm -f "$LAUNCHER_DIR/resource.syso"

echo "      -> LazyMind.exe"

echo ""
echo "=== Done ==="
echo "Launch: double-click $TARGET_DIR/LazyMind.exe"
echo ""
echo "Directory layout:"
echo "  $TARGET_DIR/"
echo "    LazyMind.exe     <- Double-click to launch (no console window)"
echo "    bin/core.exe     <- Go backend"
echo "    electron/        <- Electron runtime"
echo "    app/             <- Electron app code"
echo "    renderer/        <- Frontend UI"
echo "    data/            <- SQLite databases (created on first run)"
