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
ssh -o BatchMode=yes -o ConnectTimeout=15 "${USER}@${HOST}" "sudo bash -s" <<REMOTE
set -e
rsync -a --delete /tmp/mdweb-dist/ ${REMOTE_APP}/dist/
rsync -a /tmp/mdweb-server/ ${REMOTE_APP}/server/
chmod -R a+rX ${REMOTE_APP}/server ${REMOTE_APP}/dist

sed -e 's|%%WWWDIR%%|/usr/local/www/mdweb|g' -e 's|%%LOCALBASE%%|/usr/local|g' \
  /tmp/mdweb.rc.in > /tmp/mdweb.rc
install -o root -g wheel -m 0555 /tmp/mdweb.rc /usr/local/etc/rc.d/mdweb

install -d -o www -g www -m 0755 /var/run/mdweb /var/db/mdweb/themes
cp -f ${REMOTE_APP}/server/themes/*.json /var/db/mdweb/themes/ 2>/dev/null || true
chown -R www:www /var/db/mdweb

# Free port + kill app tree (pidfile alone is not enough for tsx children)
if [ -s /var/run/mdweb/mdweb.pid ]; then
  kill "\$(cat /var/run/mdweb/mdweb.pid)" 2>/dev/null || true
fi
for p in \$(sockstat -4 -l | awk '/\\*:5173/ {print \$3}' | sort -u); do
  kill "\$p" 2>/dev/null || true
done
for p in \$(ps -axo pid,command | awk '/\\/usr\\/local\\/www\\/mdweb\\/server\\/index\\.ts/ {print \$1}'); do
  kill "\$p" 2>/dev/null || true
done
sleep 1
for p in \$(sockstat -4 -l | awk '/\\*:5173/ {print \$3}' | sort -u); do
  kill -9 "\$p" 2>/dev/null || true
done
rm -f /var/run/mdweb/mdweb.pid
sleep 1

service mdweb start
sleep 2
service mdweb status
curl -fsS http://127.0.0.1:5173/api/health
echo
REMOTE

echo "==> external check"
curl -fsS --connect-timeout 5 "http://${HOST}:5173/api/health"
echo
echo "LIVE: http://${HOST}:5173"
