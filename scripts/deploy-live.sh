#!/usr/bin/env bash
# Deploy current tree to FreeBSD live host and hard-restart mdweb.
# Usage: scripts/deploy-live.sh [--no-build]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${MDWEB_FREEBSD_HOST:-172.16.176.133}"
USER="${MDWEB_FREEBSD_USER:-mlapointe}"
REMOTE_APP=/usr/local/www/mdweb
BUILD=1
[[ "${1:-}" == "--no-build" ]] && BUILD=0

if [[ "${BUILD}" -eq 1 ]]; then
  echo "==> build"
  (cd "${ROOT}" && npm run build)
fi

echo "==> stage to ${USER}@${HOST}"
rsync -az --no-owner --no-group -e "ssh -o BatchMode=yes -o ConnectTimeout=15" \
  "${ROOT}/dist/" "${USER}@${HOST}:/tmp/mdweb-dist/"
rsync -az --no-owner --no-group -e "ssh -o BatchMode=yes -o ConnectTimeout=15" \
  "${ROOT}/server/" "${USER}@${HOST}:/tmp/mdweb-server/"
scp -o BatchMode=yes -o ConnectTimeout=15 \
  "${ROOT}/ports/www/mdweb/files/mdweb.in" "${USER}@${HOST}:/tmp/mdweb.rc.in"

echo "==> install + hard restart"
ssh -o BatchMode=yes -o ConnectTimeout=15 "${USER}@${HOST}" "sudo bash -s" <<'REMOTE'
set -e
REMOTE_APP=/usr/local/www/mdweb

rsync -a --delete /tmp/mdweb-dist/ "${REMOTE_APP}/dist/"
rsync -a /tmp/mdweb-server/ "${REMOTE_APP}/server/"
chmod -R a+rX "${REMOTE_APP}/server" "${REMOTE_APP}/dist"

sed -e 's|%%WWWDIR%%|/usr/local/www/mdweb|g' -e 's|%%LOCALBASE%%|/usr/local|g' \
  /tmp/mdweb.rc.in > /tmp/mdweb.rc
install -o root -g wheel -m 0555 /tmp/mdweb.rc /usr/local/etc/rc.d/mdweb

install -d -o www -g www -m 0755 /var/run/mdweb /var/db/mdweb/posts /var/db/mdweb/posts/images /var/db/mdweb/themes

# Durable data: NEVER force-overwrite runtime themes (admin color overrides live here).
# Seed only missing theme JSON files from the shipped catalog (same rule as ensureRuntimeThemeCatalog).
if [ -d "${REMOTE_APP}/server/themes" ]; then
  for f in "${REMOTE_APP}/server/themes/"*.json; do
    [ -f "$f" ] || continue
    base=$(basename "$f")
    dest="/var/db/mdweb/themes/${base}"
    if [ ! -f "$dest" ]; then
      cp "$f" "$dest"
    fi
  done
fi

# Optional safety snapshot of site config before restart (keep last 10)
if [ -f /usr/local/etc/mdweb/config.json ]; then
  install -d -m 0755 /var/backups/mdweb
  cp -a /usr/local/etc/mdweb/config.json \
    "/var/backups/mdweb/config.json.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
  ls -1t /var/backups/mdweb/config.json.* 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true
fi

chown -R www:www /var/db/mdweb
# Ownership only — never replace config.json / users.json content
chown www:www /usr/local/etc/mdweb 2>/dev/null || true
if [ -f /usr/local/etc/mdweb/config.json ]; then
  chown www:www /usr/local/etc/mdweb/config.json
  chmod 0640 /usr/local/etc/mdweb/config.json
fi
if [ -f /usr/local/etc/mdweb/users.json ]; then
  chown www:www /usr/local/etc/mdweb/users.json
  chmod 0640 /usr/local/etc/mdweb/users.json
fi

# Free port + kill app tree (tsx leaves children that outlive pidfile stops)
if [ -s /var/run/mdweb/mdweb.pid ]; then
  kill "$(cat /var/run/mdweb/mdweb.pid)" 2>/dev/null || true
fi
for p in $(sockstat -4 -l | awk '/\*:5173/ {print $3}' | sort -u); do
  kill -9 "$p" 2>/dev/null || true
done
for p in $(ps -axo pid,command | awk '/\/usr\/local\/www\/mdweb\/server\/index\.ts/ {print $1}'); do
  kill -9 "$p" 2>/dev/null || true
done
rm -f /var/run/mdweb/mdweb.pid
sleep 1

# Root daemon -u www is the reliable path (rc.subr su -m + -u was broken historically)
. /usr/local/etc/mdweb.env
/usr/sbin/daemon -f -p /var/run/mdweb/mdweb.pid -o /tmp/mdweb.out -u www \
  /usr/bin/env NODE_ENV=production CONFIG_DIR=/usr/local/etc/mdweb PORT=5173 JWT_SECRET="${JWT_SECRET}" \
  "${REMOTE_APP}/node_modules/.bin/tsx" "${REMOTE_APP}/server/index.ts" -p 5173
sleep 2
if ! curl -fsS http://127.0.0.1:5173/api/health; then
  echo
  echo "FAILED start; log:"
  cat /tmp/mdweb.out 2>/dev/null || true
  exit 1
fi
echo
echo "pid=$(cat /var/run/mdweb/mdweb.pid 2>/dev/null || echo none)"
service mdweb status 2>/dev/null || true
REMOTE

echo "==> external check"
curl -fsS --connect-timeout 5 "http://${HOST}:5173/api/health"
echo
echo "LIVE: http://${HOST}:5173"
