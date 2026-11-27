#!/usr/bin/env bash
# Data tier (component C1): runs the SQL test files against a fresh PostgreSQL database.
#
#   quality/db/run.sh                      # migration under test: services/inventory/migrations/001_init.sql
#   quality/db/run.sh --mutant <file.sql>  # same suite against a mutated migration (manual mutation testing)
#
# Connection: DATABASE_URL (postgres://user:pass@host:port/db, any existing database; it is only used
# to create and drop the test database) or the libpq PG* variables (PGHOST, PGPORT, PGUSER, ...).
# The test database is P1_DB_NAME (default aforo_p1_c1); it is dropped and recreated on every run.
#
# Each tests/*.test.sql runs in one transaction that is rolled back (BEGIN ... ROLLBACK); every
# assertion prints "ok <id> ..." or "not ok <id> ...". Exit code: 0 when everything passed, 1
# otherwise. With --mutant the meaning flips: 0 when the mutant is KILLED (some test failed),
# 1 when it SURVIVED.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIGRATION="$ROOT/services/inventory/migrations/001_init.sql"
MUTANT=""
DB_NAME="${P1_DB_NAME:-aforo_p1_c1}"
REPORTS="${P1_REPORTS_DIR:-$ROOT/quality/reports/c1}"

while [ $# -gt 0 ]; do
  case "$1" in
    --mutant) MUTANT="$2"; MIGRATION="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -n "$MUTANT" ]; then
  MUTANT_NAME="$(basename "$MUTANT" .sql)"
  REPORTS="$ROOT/quality/reports/c1/mutants/$MUTANT_NAME"
fi

command -v psql >/dev/null || { echo "psql not found (install postgresql-client 17)" >&2; exit 2; }
[ -f "$MIGRATION" ] || { echo "migration not found: $MIGRATION" >&2; exit 2; }

# Admin connection (create/drop) and test-database connection.
if [ -n "${DATABASE_URL:-}" ]; then
  base="${DATABASE_URL%%\?*}"
  query=""; [ "$base" != "$DATABASE_URL" ] && query="?${DATABASE_URL#*\?}"
  ADMIN=("$DATABASE_URL")
  TARGET=("${base%/*}/$DB_NAME$query")
else
  ADMIN=(-d "${PGDATABASE:-postgres}")
  TARGET=(-d "$DB_NAME")
fi
PSQL=(psql -X -q -v ON_ERROR_STOP=1 --set VERBOSITY=terse)

echo "== C1 data tier: $(basename "$MIGRATION")${MUTANT:+ (MUTANT)}"
"${PSQL[@]}" "${ADMIN[@]}" -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS $DB_NAME" -c "CREATE DATABASE $DB_NAME" >/dev/null
trap '"${PSQL[@]}" "${ADMIN[@]}" -c "DROP DATABASE IF EXISTS $DB_NAME" >/dev/null 2>&1 || true' EXIT

"${PSQL[@]}" "${TARGET[@]}" -f "$MIGRATION" >/dev/null
"${PSQL[@]}" "${TARGET[@]}" -f "$HERE/lib/assert.sql" >/dev/null

mkdir -p "$REPORTS"
LOG="$REPORTS/verdicts.log"
: > "$LOG"
aborted=0
for file in "$HERE"/tests/*.test.sql; do
  echo "-- $(basename "$file")"
  set +e
  out="$("${PSQL[@]}" "${TARGET[@]}" -c 'BEGIN' -c 'SELECT qa.reset()' -f "$file" -c 'SELECT qa.summary()' -c 'ROLLBACK' 2>&1)"
  status=$?
  set -e
  # Keep the verdict lines, without psql's "psql:file:line: NOTICE:  " prefix.
  verdicts="$(printf '%s\n' "$out" | sed -n 's/^.*NOTICE:  //p' | grep -E '^(not )?ok ' || true)"
  [ -n "$verdicts" ] && printf '%s\n' "$verdicts" | tee -a "$LOG" | sed 's/^/  /'
  if [ $status -ne 0 ] && ! printf '%s\n' "$out" | grep -q 'summary: .* failed'; then
    # Not an assertion failure: the file itself broke (fixture error, syntax error, ...).
    aborted=$((aborted + 1))
    echo "not ok $(basename "$file") aborted -- $(printf '%s\n' "$out" | grep -E 'ERROR' | head -1)" | tee -a "$LOG" | sed 's/^/  /'
  fi
done

passed=$(grep -c '^ok ' "$LOG" || true)
failed=$(grep -c '^not ok ' "$LOG" || true)

# JUnit XML, one <testcase> per verdict line.
{
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo "<testsuites><testsuite name=\"C1 inventory integrity rules\" tests=\"$((passed + failed))\" failures=\"$failed\">"
  while IFS= read -r line; do
    name="$(printf '%s' "${line#ok }" | sed -e 's/^not ok //' -e 's/ -- .*//' -e 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g')"
    if [[ "$line" == "not ok "* ]]; then
      detail="$(printf '%s' "${line#* -- }" | sed -e 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g')"
      echo "  <testcase classname=\"C1\" name=\"$name\"><failure message=\"$detail\"/></testcase>"
    else
      echo "  <testcase classname=\"C1\" name=\"$name\"/>"
    fi
  done < "$LOG"
  echo '</testsuite></testsuites>'
} > "$REPORTS/junit.xml"

echo "C1: $passed passed, $failed failed"
if [ -n "$MUTANT" ]; then
  if [ "$failed" -gt 0 ] || [ "$aborted" -gt 0 ]; then
    echo "KILLED $MUTANT_NAME ($failed failed)" > "$REPORTS.result"
    echo "MUTANT KILLED: $MUTANT_NAME"; exit 0
  fi
  echo "SURVIVED $MUTANT_NAME" > "$REPORTS.result"
  echo "MUTANT SURVIVED: $MUTANT_NAME"; exit 1
fi
[ "$failed" -eq 0 ] && [ "$aborted" -eq 0 ]
