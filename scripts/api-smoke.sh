#!/usr/bin/env bash
# API smoke against a running MDWeb instance (INV-SEC-1 checks included).
set -euo pipefail
BASE="${MDWEB_BASE_URL:-http://127.0.0.1:5173}"
BASE="${BASE%/}"

echo "==> Health ${BASE}/api/health"
health=$(curl -fsS "${BASE}/api/health")
echo "${health}" | grep -q '"ok":true'

echo "==> Public config (no secrets)"
cfg=$(curl -fsS "${BASE}/api/config")
echo "${cfg}" | grep -Eqv '"apiKey"[[:space:]]*:' || { echo "FAIL: apiKey leaked"; exit 1; }
echo "${cfg}" | grep -Eqv '"jwtSecret"[[:space:]]*:' || { echo "FAIL: jwtSecret leaked"; exit 1; }

echo "==> Posts list"
curl -fsS "${BASE}/api/posts" | grep -q '\['

echo "==> Theme unauth write must fail"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/theme" \
  -H 'Content-Type: application/json' \
  -d '{"currentTheme":"light"}')
test "${code}" = "401" || { echo "FAIL: theme POST expected 401 got ${code}"; exit 1; }

echo "API smoke OK against ${BASE}"
