#!/usr/bin/env bash
# Build FreeBSD package on remote host, install, bootstrap, health-check.
set -euo pipefail

HOST="${MDWEB_FREEBSD_HOST:-172.16.176.133}"
USER="${MDWEB_FREEBSD_USER:-mlapointe}"
# Keepalive: npm build on FreeBSD can take many minutes; idle SSH often drops.
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=30 -o ServerAliveCountMax=120 "${USER}@${HOST}")
SCP=(scp -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=30)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=1.0.0
REMOTE_PORT_DIR=/usr/ports/www/mdweb
REMOTE_DIST=/usr/ports/distfiles
PORT=5173

echo "==> Create local distfile + refresh distinfo"
mkdir -p "${ROOT}/artifacts/distfiles"
bash "${ROOT}/scripts/make-port-distfile.sh" "${VERSION}" "${ROOT}/artifacts/distfiles"
TAR="${ROOT}/artifacts/distfiles/mdweb-${VERSION}.tar.gz"
SHA=$(sha256sum "${TAR}" | awk '{print $1}')
SIZE=$(stat -c%s "${TAR}" 2>/dev/null || stat -f%z "${TAR}")
TS=$(date +%s)
cat > "${ROOT}/ports/www/mdweb/distinfo" <<EOF
TIMESTAMP = ${TS}
SHA256 (mdweb-${VERSION}.tar.gz) = ${SHA}
SIZE (mdweb-${VERSION}.tar.gz) = ${SIZE}
EOF
echo "Updated distinfo SHA256=${SHA} SIZE=${SIZE}"

echo "==> Ensure node/npm on remote"
"${SSH[@]}" 'sudo pkg install -y node22 npm-node22 ca_root_nss 2>/dev/null || sudo pkg install -y node npm ca_root_nss'

echo "==> Sync port skeleton + distfile"
"${SSH[@]}" "sudo mkdir -p ${REMOTE_PORT_DIR}/files ${REMOTE_DIST} && sudo chown -R ${USER} ${REMOTE_PORT_DIR} ${REMOTE_DIST} 2>/dev/null || true"
rsync -az -e "ssh -o BatchMode=yes" \
  "${ROOT}/ports/www/mdweb/" "${USER}@${HOST}:${REMOTE_PORT_DIR}/"
"${SCP[@]}" "${TAR}" \
  "${USER}@${HOST}:${REMOTE_DIST}/mdweb-${VERSION}.tar.gz"

echo "==> make stage + regenerate pkg-plist + package (npm build; can take a while)"
# node_modules + hashed vite assets change every build; plist must match stage.
"${SCP[@]}" "${ROOT}/scripts/gen-plist.sh" "${USER}@${HOST}:/tmp/gen-plist.sh"
"${SSH[@]}" "chmod +x /tmp/gen-plist.sh && cd ${REMOTE_PORT_DIR} && \
  make clean DISTDIR=${REMOTE_DIST} && \
  make stage DISTDIR=${REMOTE_DIST} DISABLE_VULNERABILITIES=yes && \
  /tmp/gen-plist.sh ${REMOTE_PORT_DIR} && \
  make package DISTDIR=${REMOTE_DIST} DISABLE_VULNERABILITIES=yes"

echo "==> Locate package"
PKG_PATH="$("${SSH[@]}" "ls ${REMOTE_PORT_DIR}/work/pkg/mdweb-*.pkg | head -1")"
echo "Package: ${PKG_PATH}"

echo "==> Install package"
"${SSH[@]}" "sudo pkg delete -y mdweb 2>/dev/null || true; sudo pkg install -y ${PKG_PATH}"

echo "==> Bootstrap config + JWT (preserve existing secret/users)"
"${SSH[@]}" "sudo bash -s" <<REMOTE
set -e
install -d -m 0755 /usr/local/etc/mdweb /var/db/mdweb/posts/images /var/db/mdweb/themes /var/run/mdweb
chown www:www /var/run/mdweb
if [ ! -f /usr/local/etc/mdweb/config.json ]; then
  cp /usr/local/etc/mdweb/config.json.sample /usr/local/etc/mdweb/config.json
fi
if [ ! -f /usr/local/etc/mdweb/users.json ]; then
  cp /usr/local/etc/mdweb/users.json.sample /usr/local/etc/mdweb/users.json
fi
# Seed missing themes only — never clobber admin color overrides in /var/db/mdweb/themes
if [ -d /usr/local/www/mdweb/server/themes ]; then
  for f in /usr/local/www/mdweb/server/themes/*.json; do
    [ -f "\$f" ] || continue
    base=\$(basename "\$f")
    dest=/var/db/mdweb/themes/\$base
    if [ ! -f "\$dest" ]; then
      cp "\$f" "\$dest"
    fi
  done
fi
if [ ! -f /usr/local/etc/mdweb.env ] || ! grep -q '^JWT_SECRET=.' /usr/local/etc/mdweb.env 2>/dev/null; then
  printf 'JWT_SECRET=%s\n' "\$(openssl rand -hex 32)" > /usr/local/etc/mdweb.env
fi
chmod 0600 /usr/local/etc/mdweb.env
chown www:www /usr/local/etc/mdweb/users.json
chown -R www:www /var/db/mdweb
chown root:wheel /usr/local/etc/mdweb.env
sysrc mdweb_enable=YES >/dev/null
sysrc mdweb_port=${PORT} >/dev/null || true

# Hard free port then start (tsx can leave children after service stop)
if [ -s /var/run/mdweb/mdweb.pid ]; then
  kill "\$(cat /var/run/mdweb/mdweb.pid)" 2>/dev/null || true
fi
for p in \$(sockstat -4 -l | awk '/\\*:${PORT}/ {print \$3}' | sort -u); do
  kill -9 "\$p" 2>/dev/null || true
done
for p in \$(ps -axo pid,command | awk '/\\/usr\\/local\\/www\\/mdweb\\/server\\/index\\.ts/ {print \$1}'); do
  kill -9 "\$p" 2>/dev/null || true
done
rm -f /var/run/mdweb/mdweb.pid
sleep 1

# Prefer service; fall back to root daemon -u www
service mdweb start || true
sleep 2
if ! curl -fsS http://127.0.0.1:${PORT}/api/health >/dev/null 2>&1; then
  . /usr/local/etc/mdweb.env
  /usr/sbin/daemon -f -p /var/run/mdweb/mdweb.pid -o /tmp/mdweb.out -u www \\
    /usr/bin/env NODE_ENV=production CONFIG_DIR=/usr/local/etc/mdweb PORT=${PORT} JWT_SECRET="\${JWT_SECRET}" \\
    /usr/local/www/mdweb/node_modules/.bin/tsx /usr/local/www/mdweb/server/index.ts -p ${PORT}
  sleep 2
fi
service mdweb status || true
curl -fsS http://127.0.0.1:${PORT}/api/health || { echo; cat /tmp/mdweb.out 2>/dev/null; exit 1; }
echo
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
"${SSH[@]}" 'sudo cat /var/log/messages | tail -30; ls -la /usr/local/www/mdweb | head; ls -la /usr/local/etc/mdweb; cat /usr/local/etc/mdweb.env | sed "s/=.*/=***/"; cat /tmp/mdweb.out 2>/dev/null || true'
exit 1
