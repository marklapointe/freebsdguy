#!/usr/bin/env bash
# Build an installable single-file flatpak bundle (org.cloudbsd.MDWeb.flatpak).
# Uses only the `flatpak build-*` CLI (no flatpak-builder): nothing is compiled — we
# bundle the official Node LTS binary, the vite build and production node_modules.
#
# Usage: scripts/build-flatpak.sh [out-dir]
# Requires: flatpak, org.freedesktop.Platform//${RUNTIME_BRANCH} installed, curl, npm.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-${ROOT}/artifacts/flatpak}"
APP_ID=org.cloudbsd.MDWeb
RUNTIME=org.freedesktop.Platform
RUNTIME_BRANCH="${RUNTIME_BRANCH:-25.08}"
NODE_VERSION="${NODE_VERSION:-22.23.2}"
WORK="${FLATPAK_WORK:-$(mktemp -d)}"
BUILD="${WORK}/build"
REPO="${WORK}/repo"
VERSION="$(node -p "require('${ROOT}/package.json').version")"

echo "==> Runtime check: ${RUNTIME}//${RUNTIME_BRANCH}"
flatpak info "${RUNTIME}//${RUNTIME_BRANCH}" >/dev/null 2>&1 || {
  echo "Install it first: flatpak install flathub ${RUNTIME}//${RUNTIME_BRANCH}" >&2; exit 1; }

echo "==> Frontend build"
( cd "${ROOT}" && npm run build >/dev/null )

echo "==> Node ${NODE_VERSION} (official linux-x64 tarball, checksum verified)"
mkdir -p "${WORK}/node"
if [ ! -x "${WORK}/node/bin/node" ]; then
  curl -fsSL -o "${WORK}/node.tar.xz" "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" \
    | grep "node-v${NODE_VERSION}-linux-x64.tar.xz" | awk -v f="${WORK}/node.tar.xz" '{print $1"  "f}' | sha256sum -c -
  tar -xJf "${WORK}/node.tar.xz" -C "${WORK}/node" --strip-components=1
fi

echo "==> Stage app + production node_modules"
APP="${WORK}/app"
rm -rf "${APP}"; mkdir -p "${APP}"
cp -r "${ROOT}/dist" "${ROOT}/server" "${ROOT}/package.json" "${ROOT}/package-lock.json" \
      "${ROOT}/LICENSE" "${ROOT}/mdweb.1" "${APP}/"
rm -f "${APP}/server/config/users.json"
( cd "${APP}" && PATH="${WORK}/node/bin:${PATH}" npm ci --omit=dev >/dev/null 2>&1 )

echo "==> flatpak build-init / populate"
rm -rf "${BUILD}" "${REPO}"
# No compilation needed, so the Platform doubles as the "SDK"
flatpak build-init "${BUILD}" "${APP_ID}" "${RUNTIME}" "${RUNTIME}" "${RUNTIME_BRANCH}"
install -d "${BUILD}/files/bin" "${BUILD}/files/lib" "${BUILD}/files/share/mdweb" \
           "${BUILD}/files/share/metainfo" "${BUILD}/files/share/man/man1"
cp -r "${WORK}/node" "${BUILD}/files/lib/node"
rm -rf "${BUILD}/files/lib/node/include" "${BUILD}/files/lib/node/share" "${BUILD}/files/lib/node/lib/node_modules/npm" "${BUILD}/files/lib/node/lib/node_modules/corepack"
cp -r "${APP}/." "${BUILD}/files/share/mdweb/"
install -m 0755 "${ROOT}/flatpak/mdweb-launcher.sh" "${BUILD}/files/bin/mdweb"
install -m 0644 "${ROOT}/flatpak/${APP_ID}.metainfo.xml" "${BUILD}/files/share/metainfo/"
install -m 0644 "${ROOT}/mdweb.1" "${BUILD}/files/share/man/man1/"

echo "==> flatpak build-finish"
flatpak build-finish "${BUILD}" \
  --command=mdweb \
  --share=network \
  --env=NODE_ENV=production

echo "==> export + bundle"
mkdir -p "${OUT}"
flatpak build-export "${REPO}" "${BUILD}" stable
flatpak build-bundle "${REPO}" "${OUT}/${APP_ID}-${VERSION}.flatpak" "${APP_ID}" stable \
  --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo
ls -lh "${OUT}/${APP_ID}-${VERSION}.flatpak"
echo
echo "Install:  flatpak install --user ${OUT}/${APP_ID}-${VERSION}.flatpak"
echo "Run:      flatpak run ${APP_ID}            # http://localhost:5173"
echo "Data:     ~/.var/app/${APP_ID}/data/mdweb"
