# Quality P1 — component-level verification

Software Quality course, Project Delivery 1. Six Aforo components are tested **in isolation**: every
dependency is replaced by a test double, unless the dependency is the component itself (C1: the
database rules *are* the component). Version under test: tag `v1.0.0-p1` (commit `425cc70`).
This folder and the `test/p1/` folders are test-only: **no product code (`src/`, migrations) is
changed**, and defects found are reported, not fixed.

## Components

| ID | Tier | Owner | Component | Code under test | Tests go in | Runner |
|---|---|---|---|---|---|---|
| C1 | Data | Cristian | Reservation integrity rules (CHECKs of `sector_availability` and `reservation`, partial unique index `reservation_one_active`, trigger `reservation_transition_guard`) | `services/inventory/migrations/001_init.sql` | `quality/db/tests/*.test.sql` | SQL + `psql`, PostgreSQL 17 |
| C2 | Logic | Juan Esteban | Reservation request validation: `parseCreateReservation`, `uuidParam` | `services/inventory/src/reservations/validation.ts` | `services/inventory/test/p1/` | Vitest |
| C3 | Logic | David | Queue status: `waitingStatus`, `admittedStatus`, `passExpiryMs`, `scoreFor` | `services/queue/src/queue/queue-status.ts` | `services/queue/test/p1/` | Vitest + Stryker |
| C4 | Logic | Sergio | Payment webhook processing: `WebhookService.handle` (+ `verifySignature`) | `services/orders/src/payments/webhook.service.ts`, `webhook-signature.ts` | `services/orders/test/p1/c4-*.test.ts` | Jest + Stryker |
| C5 | Logic | Juan José | Gateway circuit breaker + retry: `buildResilience` | `services/orders/src/payments/resilience.ts` | `services/orders/test/p1/c5-*.test.ts` | Jest |
| C6 | Presentation | Daniel | Purchase button: `PurchaseAction` | `apps/web/src/components/purchase-action.tsx` | `apps/web/test/p1/` | Vitest + React Testing Library + jsdom |

Mutation testing: **C3 and C4** (StrykerJS), plus manual SQL mutants for C1. Coordination and the
report: Juan Esteban.

## Conventions

- **Test case ID:** `TC-C<n>-<nn>`, e.g. `TC-C3-07`. Every test name **starts** with its ID:
  `it('TC-C3-07 position 501 with batch 500 is in the second batch', …)`. In SQL the ID is the first
  argument of every assertion (a case may have several assertions; it passes when all its lines are `ok`).
- **Isolated, repeatable, self-checking.** One behavior per test. No real clock and no real
  randomness: inject them (`now`, `random`), or use fake timers (`jest.useFakeTimers`,
  `vi.useFakeTimers`) and `Math.random` spies. Literal UUIDs and literal ISO dates in fixtures.
- **Doubles:** stubs/fakes/mocks of the component's direct dependencies only (`jest.fn`, `vi.fn`,
  `vi.mock` of a module). C4 uses `services/orders/test/p1/helpers/webhook-deps.ts` (`makeDeps()`
  gives a `jest.fn()` with a happy-path default for each of the 9 constructor dependencies).
- **UI queries** go by role and visible text (`getByRole('link', { name: es.detail.joinQueue })`),
  never by CSS classes or markup structure. Texts come from `@/lib/i18n/es`.
- Code, names and comments in English (repo rule).

## Running

One command per scope; every runner prints one verdict line per test.

| What | Local | Notes |
|---|---|---|
| Everything | `npm run test:p1` (root) → `quality/run-all.sh` | Logic + UI always; data (C1) when `DATABASE_URL` or `PGHOST` is set. Summary table at the end; exit ≠ 0 if anything failed. |
| C1 | `DATABASE_URL=postgres://user:pass@host:5432/postgres quality/db/run.sh` | Creates/drops the database `aforo_p1_c1`. Needs `psql` and a PostgreSQL 17. |
| C2 | `npm run test:p1 --workspace=@aforo/inventory` | Build `@aforo/common` first: `npm run build:common`. |
| C3 | `npm run test:p1 --workspace=@aforo/queue` | |
| C4 / C5 | `npm run test:p1:c4 --workspace=@aforo/orders` / `test:p1:c5` | `jest.p1.config.js`, component chosen by `P1_COMPONENT`. |
| C6 | `npm run test:p1 --workspace=@aforo/web` | `vitest.p1.config.mts`, jsdom. |
| Mutation C3 + C4 | `npm run test:p1:mutation` (root) | Stryker, ~10 s each today. |
| Mutation C1 | `quality/db/run-mutants.sh` | Runs the suite against every `quality/db/mutants/*.sql`. |

A throwaway PostgreSQL 17 on a Mac without Docker:
`initdb -D /tmp/pg17 -U postgres --auth=trust && pg_ctl -D /tmp/pg17 -o "-p 55432 -k ''" -l /tmp/pg17/log start`,
then `DATABASE_URL=postgres://postgres@localhost:55432/postgres`.

**CI (the official single command):** `.github/workflows/p1-component-tests.yml` runs on every push
to `quality/**`, on pull requests that touch these units, and by hand (*Actions → p1-component-tests
→ Run workflow*, input `mutation`). One job per tier: `data` (C1, `postgres:17` service container),
`logic` (C2–C5), `ui` (C6), and `mutation` (C3, C4 Stryker; only on a manual run with
`mutation: true`, which also runs the C1 SQL mutants). Each job writes a verdict table and branch
coverage to the job summary and uploads `quality/reports/<component>/` (JUnit XML, coverage HTML/lcov,
`coverage-summary.json`, Stryker HTML/JSON) as an artifact.

The existing unit suites are unchanged (`npm test` of each unit). Only the orders Jest config picks up
`test/p1/` too (its `roots` is `test/`), so the C4/C5 tests also run in `npm test` of orders.

## Reports

Everything lands in `quality/reports/<component>/` (git-ignored):

- `junit.xml` — one `<testcase>` per test (per assertion line for C1).
- `coverage/` — `index.html`, `lcov.info`, `coverage-summary.json` (istanbul), scoped to the
  component's files only. The figure for the report is **% Branch**.
- `mutation/` (C3, C4) — `index.html` and `mutation.json`. Score = (killed + timeout) / (killed +
  timeout + survived + no coverage).
- `node quality/summary.mjs [c1 … c6]` prints the per-component table from those files.

### Coverage of the data tier (C1)

There is no standard branch-coverage tool for SQL/plpgsql, so C1 reports **rule and transition
coverage**, agreed for the report:

- every CHECK constraint exercised **true and false** (accepted and rejected row, at the boundary);
- the partial unique index exercised with a second `ACTIVE` row (rejected) and with a non-`ACTIVE` row
  (accepted);
- the trigger: the full matrix of `OLD.status → NEW.status` over `ACTIVE, CONFIRMED, EXPIRED,
  RELEASED` (allowed from `ACTIVE`, rejected from every terminal state, same-status updates allowed),
  i.e. both branches of `IF NEW.status <> OLD.status AND OLD.status <> 'ACTIVE'`.

Keep the matrix in the report (rule/transition → test IDs).

**Mutation for C1 is manual:** each file in `quality/db/mutants/` is a full copy of
`001_init.sql` with **one** deliberate change, described in its header. `run.sh --mutant <file>`
runs the suite against it and exits 0 when the mutant is **killed**; `run-mutants.sh` runs them all
and prints the score. To add a mutant: copy the migration, change one operator/constant/condition,
document it in the header.

How the SQL runner works: `run.sh` loads `lib/assert.sql` (schema `qa`: `qa.ok`, `qa.assert_equals`,
`qa.assert_raises(id, desc, sql, sqlstate)`, `qa.assert_violates(id, desc, sql, constraint)` (checks the violated constraint's name), `qa.assert_lives`, `qa.summary`), then runs each test file
as `BEGIN; qa.reset(); <file>; qa.summary(); ROLLBACK`. Each case sits between `SAVEPOINT tc` and
`ROLLBACK TO SAVEPOINT tc`. Pass/fail counters are sequences (not rolled back by a savepoint), so
`qa.summary()` sees every verdict and raises if any failed; `run.sh` also counts the `ok` / `not ok`
lines and reports a file that broke (fixture or syntax error) as `not ok <file> aborted`.

## Adding your tests

1. Open the template of your component (`c<n>-*.test.ts(x)` or `quality/db/tests/c1_inventory.test.sql`)
   and keep the two/three example cases: they are real cases (renumber nothing).
2. Write each new case with the next free ID, `TC-C<n>-<nn> <expected behavior>`, one behavior per case,
   doubles for every dependency, no real clock/randomness.
3. Run your component locally (table above) and read the verdict lines and the **% Branch** column;
   add cases for the uncovered branches the coverage report shows.
4. C3/C4: run Stryker and kill or justify surviving mutants (equivalent mutants go in the report).
   C1: add a mutant to `quality/db/mutants/` if your rule has none.
5. Commit only your test files (`test(quality): add TC-C<n>-.. for <component>`), push to
   `quality/p1-component-tests` and check the `p1-component-tests` run: your verdicts appear in the
   job summary.
