#!/usr/bin/env bash
# Full regression round against FreeBSD package install + local Playwright.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${MDWEB_FREEBSD_HOST:-172.16.176.133}"
MODE="${1:-smoke}" # smoke | package
export MDWEB_BASE_URL="${MDWEB_BASE_URL:-http://${HOST}:5173}"
export MDWEB_ADMIN_USER="${MDWEB_ADMIN_USER:-admin}"
export MDWEB_ADMIN_PASS="${MDWEB_ADMIN_PASS:-admin}"
TS="$(date +%Y%m%d-%H%M%S)"
ART="${ROOT}/artifacts/regression/${TS}"
mkdir -p "${ART}"

echo "=== Regression round ${TS} mode=${MODE} base=${MDWEB_BASE_URL} ===" | tee "${ART}/SUMMARY.md"

if [ "${MODE}" = "package" ]; then
  bash "${ROOT}/scripts/freebsd-package-round.sh" | tee "${ART}/package.log"
fi

echo "==> R0 local unit tests" | tee -a "${ART}/SUMMARY.md"
(cd "${ROOT}" && npm test) | tee "${ART}/unit.log"
echo "unit: PASS" >> "${ART}/SUMMARY.md"

echo "==> API smoke" | tee -a "${ART}/SUMMARY.md"
bash "${ROOT}/scripts/api-smoke.sh" | tee "${ART}/api-smoke.log"
echo "api-smoke: PASS" >> "${ART}/SUMMARY.md"

echo "==> FULL Playwright suite (all specs)" | tee -a "${ART}/SUMMARY.md"
(cd "${ROOT}" && npx playwright test --reporter=list) | tee "${ART}/playwright.log"
echo "playwright: PASS" >> "${ART}/SUMMARY.md"

echo "==> DONE ${ART}/SUMMARY.md"
cat "${ART}/SUMMARY.md"
