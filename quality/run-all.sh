#!/usr/bin/env bash
# Local single command for the component-level suites (Quality P1): `npm run test:p1` from the root.
# Runs the logic tier (C2-C5) and the presentation tier (C6) with coverage, and the data tier (C1)
# when a PostgreSQL is reachable (DATABASE_URL or PGHOST set). Prints a verdict per test (each
# runner's own output), then a summary table, and exits non-zero if any suite failed.
# The official single command is the CI workflow .github/workflows/p1-component-tests.yml.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Fresh verdicts and coverage on every run (mutation reports are kept: they come from test:p1:mutation).
for c in c1 c2 c3 c4 c5 c6; do
  rm -rf "quality/reports/$c/junit.xml" "quality/reports/$c/coverage" "quality/reports/$c/verdicts.log"
done

declare -a TIERS=() RESULTS=()
run() { # run <label> <command...>
  local label="$1"; shift
  echo; echo "================ $label"
  if "$@"; then RESULTS+=("PASS"); else RESULTS+=("FAIL"); fi
  TIERS+=("$label")
}

echo "== building @aforo/common (C2 imports DomainError from its dist/)"
npm run build --workspace=@aforo/common --silent || { echo "build of @aforo/common failed" >&2; exit 1; }

run "logic  C2 (vitest)" npm run test:p1 --workspace=@aforo/inventory --silent
run "logic  C3 (vitest)" npm run test:p1 --workspace=@aforo/queue --silent
run "logic  C4 (jest)"   npm run test:p1:c4 --workspace=@aforo/orders --silent
run "logic  C5 (jest)"   npm run test:p1:c5 --workspace=@aforo/orders --silent
run "ui     C6 (vitest)" npm run test:p1 --workspace=@aforo/web --silent
if [ -n "${DATABASE_URL:-}" ] || [ -n "${PGHOST:-}" ]; then
  run "data   C1 (psql)" quality/db/run.sh
else
  echo; echo "================ data   C1 (psql): SKIPPED (set DATABASE_URL or PGHOST to run it; CI always runs it)"
  TIERS+=("data   C1 (psql)"); RESULTS+=("SKIPPED")
fi

echo; echo "================ summary"
node quality/summary.mjs | sed -n '/^| Component/,/^$/p'
echo
status=0
for i in "${!TIERS[@]}"; do
  printf '  %-22s %s\n' "${TIERS[$i]}" "${RESULTS[$i]}"
  [ "${RESULTS[$i]}" = "FAIL" ] && status=1
done
exit $status
