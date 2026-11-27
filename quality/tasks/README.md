# P1 — pending work per component

One file per owner. Each says **what is missing, where to build it, how to run it, and what to report**.
It does not matter which tool (or AI) you use: follow the file and the conventions below.

| ID | Owner | Status | Task file |
|---|---|---|---|
| C1 | Cristian | Template only (TC-C1-01..03) | [c1-cristian.md](c1-cristian.md) |
| C2 | Juan Esteban | Template only (TC-C2-01..02) | [c2-juan-esteban.md](c2-juan-esteban.md) |
| C3 | David | **Done** (branch `quality/c3-david`) | — |
| C4 | Sergio | Template only (TC-C4-01..02) | [c4-sergio.md](c4-sergio.md) |
| C5 | Juan José | Template only (TC-C5-01..02) | [c5-juan-jose.md](c5-juan-jose.md) |
| C6 | Daniel | Template only (TC-C6-01..02) | [c6-daniel.md](c6-daniel.md) |

**Deadline:** tests pushed and results in the report doc (team-E-p1, Google Docs) by **Fri Nov 27, 5:00 pm**.

## Workflow (same for everyone)
1. `git checkout main && git pull && git checkout -b quality/c<n>-<name>` (e.g. `quality/c4-sergio`).
2. `nvm use` (Node 24), `npm ci`, `npm run build:common`.
3. Implement **only** the cases listed in your file, in your component's existing test file. Keep the IDs.
4. Run your command until green (see your file). Push the branch: the CI workflow `p1-component-tests`
   runs automatically on `quality/**` and shows one verdict per test.
5. Fill your rows in the report doc (sections 8 and 9 — see "Report" in your file). Do not open a PR.

## Conventions (non-negotiable)
- Every test name **starts with its ID**: `it('TC-C4-05 DECLINED moves the payment to DECLINED …')`.
- One behavior per test. Isolated, repeatable, self-checking (an assertion decides the verdict).
- No real clock or randomness: inject them, or use fake timers / `Math.random` spies.
- Doubles only for the component's direct dependencies. UI: query by role/text, never CSS/markup.
- **Do not change product code** (`src/`, migrations) and do not fix defects: they are findings.
- Code, test names and comments in English.

## When a test reveals a defect
Write the test with the **expected** result (from the contract). If it fails because the product is
wrong, keep it and mark it as a known failure so the suite stays green and the finding is recorded:
- Jest: `test.failing('TC-C4-13 …', …)` · Vitest: `it.fails('TC-C6-08 …', …)` · SQL: keep the
  `not ok` and tell Julián before pushing.
Add a comment `// DEFECT: expected X, observed Y` and report it in section 9 of the doc
(expected vs. observed). If the test passes, the suspected defect is not real: report that instead.

## Useful commands
- Everything local: `npm run test:p1` (root). Summary table: `node quality/summary.mjs`.
- Reports land in `quality/reports/<cN>/` (`coverage/index.html`, `junit.xml`, `mutation/`).
- Full guide: [`quality/README.md`](../README.md).
