#!/usr/bin/env bash
# Manual mutation testing of the data tier (C1): runs the suite once per quality/db/mutants/*.sql
# (each one a full copy of 001_init.sql with ONE deliberate change, described in its header).
# A mutant is KILLED when at least one test fails against it. Prints the mutation score; exits
# non-zero if any mutant survived. Same connection settings as run.sh.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rm -rf "$HERE/../reports/c1/mutants"
total=0; killed=0
for m in "$HERE"/mutants/*.sql; do
  total=$((total + 1))
  if "$HERE/run.sh" --mutant "$m"; then killed=$((killed + 1)); fi
  echo
done
echo "C1 mutation score: $killed/$total killed"
[ "$killed" -eq "$total" ]
