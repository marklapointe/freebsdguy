#!/usr/bin/env bash
# Create a source tarball for the FreeBSD port (www/mdweb).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-1.0.0}"
NAME="mdweb-${VERSION}"
OUT_DIR="${2:-${ROOT}/artifacts/distfiles}"
STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT

mkdir -p "${OUT_DIR}" "${STAGE}/${NAME}"

# Copy project tree without build artifacts / secrets
rsync -a \
  --exclude node_modules \
  --exclude dist \
  --exclude coverage \
  --exclude artifacts \
  --exclude .git \
  --exclude tests/tmp \
  --exclude 'server/config/users.json' \
  --exclude playwright-report \
  --exclude test-results \
  "${ROOT}/" "${STAGE}/${NAME}/"

# Ensure LICENSE exists
test -f "${STAGE}/${NAME}/LICENSE"

tar -C "${STAGE}" -czf "${OUT_DIR}/${NAME}.tar.gz" "${NAME}"
echo "Wrote ${OUT_DIR}/${NAME}.tar.gz"
ls -lh "${OUT_DIR}/${NAME}.tar.gz"
