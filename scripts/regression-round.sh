#!/usr/bin/env bash
# Full regression round against FreeBSD package install + local Playwright.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-smoke}" # smoke | package
# Live target: explicit URL, or FreeBSD host env, or localhost (local npm start / dev).
if [ -z "${MDWEB_BASE_URL:-}" ]; then
  if [ -n "${MDWEB_FREEBSD_HOST:-}" ]; then
    export MDWEB_BASE_URL="http://${MDWEB_FREEBSD_HOST}:5173"
  else
    export MDWEB_BASE_URL="http://127.0.0.1:5173"
  fi
fi
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

echo "==> FULL Playwright suite (all specs, including every theme × light/dark)" | tee -a "${ART}/SUMMARY.md"
# Serial-friendly full suite; theme-modes-all is intentionally exhaustive and deterministic
(cd "${ROOT}" && npx playwright test --reporter=list) | tee "${ART}/playwright.log"
echo "playwright: PASS" >> "${ART}/SUMMARY.md"

echo "==> DONE ${ART}/SUMMARY.md"
{
  echo ""
  echo "Repeatable command:"
  echo "  bash scripts/regression-round.sh smoke"
  echo "Theme-only (browser exhaustive against default live host):"
  echo "  npx playwright test e2e/11-theme-modes-all.spec.ts --reporter=list"
  echo "  npm test -- --run tests/theme-modes-all.test.ts"
  echo "Override host if needed: MDWEB_FREEBSD_HOST=… or MDWEB_BASE_URL=http://host:5173"
} | tee -a "${ART}/SUMMARY.md"
cat "${ART}/SUMMARY.md"
