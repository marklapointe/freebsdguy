#!/usr/bin/env bash
# Build FreeBSD package on remote host, install, bootstrap, health-check.
set -euo pipefail

HOST="${MDWEB_FREEBSD_HOST:-172.16.176.133}"
USER="${MDWEB_FREEBSD_USER:-mlapointe}"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 "${USER}@${HOST}")
SCP=(scp -o BatchMode=yes -o ConnectTimeout=15)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=1.0.0
REMOTE_PORT_DIR=/usr/ports/www/mdweb
REMOTE_DIST=/usr/ports/distfiles
PORT=5173

echo "==> Create local distfile"
mkdir -p "${ROOT}/artifacts/distfiles"
bash "${ROOT}/scripts/make-port-distfile.sh" "${VERSION}" "${ROOT}/artifacts/distfiles"

echo "==> Ensure node/npm on remote"
"${SSH[@]}" 'sudo pkg install -y node22 npm-node22 ca_root_nss 2>/dev/null || sudo pkg install -y node npm ca_root_nss'

echo "==> Sync port skeleton + distfile"
"${SSH[@]}" "sudo mkdir -p ${REMOTE_PORT_DIR}/files ${REMOTE_DIST} && sudo chown -R ${USER} ${REMOTE_PORT_DIR} ${REMOTE_DIST} 2>/dev/null || true"
rsync -az -e "ssh -o BatchMode=yes" \
  "${ROOT}/ports/www/mdweb/" "${USER}@${HOST}:${REMOTE_PORT_DIR}/"
"${SCP[@]}" "${ROOT}/artifacts/distfiles/mdweb-${VERSION}.tar.gz" \
  "${USER}@${HOST}:${REMOTE_DIST}/mdweb-${VERSION}.tar.gz"

echo "==> make package on FreeBSD (this can take a while for npm)"
"${SSH[@]}" "cd ${REMOTE_PORT_DIR} && make clean DISTDIR=${REMOTE_DIST} && make package DISTDIR=${REMOTE_DIST} DISABLE_VULNERABILITIES=yes"

echo "==> Locate package"
PKG_PATH="$("${SSH[@]}" "ls ${REMOTE_PORT_DIR}/work/pkg/mdweb-*.pkg | head -1")"
echo "Package: ${PKG_PATH}"

echo "==> Install package"
"${SSH[@]}" "sudo pkg delete -y mdweb 2>/dev/null || true; sudo pkg install -y ${PKG_PATH}"

echo "==> Bootstrap config + JWT"
JWT="$("${SSH[@]}" 'openssl rand -hex 32')"
"${SSH[@]}" "sudo bash -s" <<REMOTE
set -e
install -d -m 0755 /usr/local/etc/mdweb /var/db/mdweb/posts/images /var/db/mdweb/themes
if [ ! -f /usr/local/etc/mdweb/config.json ]; then
  cp /usr/local/etc/mdweb/config.json.sample /usr/local/etc/mdweb/config.json
fi
if [ ! -f /usr/local/etc/mdweb/users.json ]; then
  cp /usr/local/etc/mdweb/users.json.sample /usr/local/etc/mdweb/users.json
fi
# seed themes if empty
if [ ! -f /var/db/mdweb/themes/dark.json ] && [ -f /usr/local/www/mdweb/server/themes/dark.json ]; then
  cp /usr/local/www/mdweb/server/themes/*.json /var/db/mdweb/themes/ 2>/dev/null || true
fi
printf 'JWT_SECRET=%s\n' '${JWT}' > /usr/local/etc/mdweb.env
chmod 0600 /usr/local/etc/mdweb.env
chown www:www /usr/local/etc/mdweb/users.json /var/db/mdweb -R 2>/dev/null || true
chown root:wheel /usr/local/etc/mdweb.env
sysrc mdweb_enable=YES >/dev/null
sysrc mdweb_port=${PORT} >/dev/null || true
service mdweb stop 2>/dev/null || true
service mdweb start
sleep 2
service mdweb status || true
REMOTE

echo "==> Health check"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if "${SSH[@]}" "curl -fsS http://127.0.0.1:${PORT}/api/health"; then
    echo
    echo "OK: MDWeb healthy on ${HOST}:${PORT}"
    echo "Public URL: http://${HOST}:${PORT}"
    exit 0
  fi
  sleep 2
done

echo "FAILED health check; recent logs:"
"${SSH[@]}" 'sudo cat /var/log/messages | tail -30; ls -la /usr/local/www/mdweb | head; ls -la /usr/local/etc/mdweb; cat /usr/local/etc/mdweb.env | sed "s/=.*/=***/"'
exit 1
