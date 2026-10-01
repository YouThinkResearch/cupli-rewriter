#!/usr/bin/env bash
# Build and run s3explorer from a pinned revision. Idempotent: reruns only rebuild
# when the checked-out sha differs from the requested one.
set -euo pipefail

: "${REPO:?}" "${REF:?}" "${APP_DIR:?}" "${DATA_DIR:?}"

# better-sqlite3 and argon2 are native, so they must be compiled on the target - no
# cross-building from a mac. Node 20+ is required and Ubuntu ships 18.
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
  echo "installing node 20"
  curl -fsSL --retry 3 https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs >/dev/null 2>&1
fi
dpkg -s build-essential >/dev/null 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential python3 >/dev/null 2>&1
echo "node $(node -v)"

install -d -m 0755 "$DATA_DIR"

NEED_BUILD=0
if [ ! -d "$APP_DIR/.git" ]; then
  rm -rf "$APP_DIR"
  git clone -q "$REPO" "$APP_DIR"
  NEED_BUILD=1
fi
cd "$APP_DIR"
git fetch -q origin
CURRENT=$(git rev-parse HEAD)
if [ "$CURRENT" != "$REF" ]; then
  git checkout -q "$REF"
  NEED_BUILD=1
fi
# A half-finished previous build must not be mistaken for a good one.
[ -f "$APP_DIR/apps/server/dist/index.js" ] && [ -f "$APP_DIR/apps/server/public/index.html" ] || NEED_BUILD=1

if [ "$NEED_BUILD" = 1 ]; then
  echo "building client"
  ( cd apps/client && npm ci --no-audit --no-fund >/dev/null 2>&1 && npm run build >/dev/null 2>&1 )
  echo "building server"
  ( cd apps/server && npm ci --no-audit --no-fund >/dev/null 2>&1 && npm run build >/dev/null 2>&1 )
  # the server serves ../public relative to dist/
  rm -rf apps/server/public
  cp -r apps/client/dist apps/server/public
  echo "built $(git rev-parse --short HEAD)"
else
  echo "already at $REF, skipping build"
fi

install -m 0600 /tmp/s3explorer.env /etc/s3explorer.env
rm -f /tmp/s3explorer.env
install -m 0644 /tmp/s3explorer.service /etc/systemd/system/s3explorer.service

systemctl daemon-reload
systemctl enable --now s3explorer
sleep 3
systemctl is-active --quiet s3explorer || { echo "s3explorer failed to start"; journalctl -u s3explorer -n 25 --no-pager; exit 1; }
echo "s3explorer: $(systemctl is-active s3explorer)"
