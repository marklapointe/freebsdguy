#!/usr/bin/env bash
# Sync www/mdweb FreeBSD port from this repo into a local cloudbsd-ports checkout.
# Usage:
#   ./scripts/sync-cloudbsd-port.sh
#   CLOUDBSD_PORTS=/path/to/cloudbsd-ports ./scripts/sync-cloudbsd-port.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/ports/www/mdweb"
DST="${CLOUDBSD_PORTS:-${ROOT}/../cloudbsd-ports}/www/mdweb"

if [ ! -d "$SRC" ]; then
  echo "missing source port: $SRC" >&2
  exit 1
fi
if [ ! -d "$(dirname "$DST")" ]; then
  echo "missing cloudbsd-ports www/ at: $(dirname "$DST")" >&2
  echo "set CLOUDBSD_PORTS to your cloudbsd-ports tree" >&2
  exit 1
fi

mkdir -p "$DST"
rsync -a --delete \
  --exclude='.git' \
  "$SRC/" "$DST/"

echo "Synced $SRC -> $DST"
echo "PORTNAME=$(grep '^PORTNAME=' "$DST/Makefile" | head -1)"
echo "DISTVERSION=$(grep '^DISTVERSION=' "$DST/Makefile" | head -1)"
echo "Next: cd $(dirname "$DST")/../.. && git status www/mdweb"
