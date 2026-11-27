# C1 — Reservation integrity rules (inventory DB) · Cristian

**Code under test:** `services/inventory/migrations/001_init.sql` (CHECKs of `sector_availability`
and `reservation`, partial unique index `reservation_one_active`, trigger `reservation_transition_guard`).
**Tests go in:** `quality/db/tests/c1_inventory.test.sql` (TC-C1-01..03 already there — copy their pattern).
**Branch:** `quality/c1-cristian`

## Missing cases
| ID | Condition | Inputs | Expected |
|---|---|---|---|
| TC-C1-06 | Valid transitions from ACTIVE | 3 ACTIVE reservations → CONFIRMED, EXPIRED, RELEASED | `qa.assert_lives` for each UPDATE |
| TC-C1-08 | Second ACTIVE reservation, same buyer and event | 2 INSERTs ACTIVE with the same (event_id, buyer_id) | second raises `23505` |
| TC-C1-12 | Reservation for a non-existent sector | sector_id with no row in sector_availability | raises `23503` |

Helpers (`quality/db/lib/assert.sql`): `qa.assert_lives(id, desc, sql)`, `qa.assert_raises(id, desc, sql, sqlstate)`,
`qa.assert_equals(id, desc, expected, actual)`. Each case: `SAVEPOINT tc; … ROLLBACK TO SAVEPOINT tc;`.
Literal UUIDs/dates only (reuse the `\set` variables; add new ones for a second buyer/reservation).

## Run
- CI (easiest): push the branch; job **data** runs the SQL against PostgreSQL 17 and prints `ok/not ok TC-C1-nn`.
- Local (needs `psql` + PostgreSQL 17): `DATABASE_URL=postgres://postgres@localhost:55432/postgres quality/db/run.sh`
  (throwaway cluster without Docker: see `quality/README.md`).

## Report (doc team-E-p1)
- **Section 8, row C1:** "Cobertura de reglas: n/m" = rules/transitions exercised (CHECK true/false, the 4 states
  of the trigger, the partial index) and what is not exercised and why. There is no branch-coverage tool for plpgsql.
- **Section 9:** anything unexpected (expected vs. observed). Known spec issue to mention: the trigger only guards
  UPDATE, so an INSERT can create a reservation directly in CONFIRMED.
