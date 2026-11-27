# C2 — Reservation request validation · Juan Esteban

**Code under test:** `services/inventory/src/reservations/validation.ts` (`parseCreateReservation`, `uuidParam`).
**Tests go in:** `services/inventory/test/p1/c2-validation.test.ts` (TC-C2-01..02 already there).
**Branch:** `quality/c2-juan-esteban` · **Runner:** Vitest

## Missing cases
| ID | Condition | Inputs | Expected |
|---|---|---|---|
| TC-C2-03 | quantity not an integer | `quantity: 1.5`; `quantity: "2"` | `VALIDATION_ERROR` with fieldError on `quantity` |
| TC-C2-05 | Malformed or missing UUID | `eventId: 'abc'`; body without `sectorId` | fieldError on that field |
| TC-C2-06 | Unknown field | valid body + `extra: 'x'` | fieldError `extra` / `unknown field` |
| TC-C2-07 | Body is not an object | `null`, `[]`, `'text'`, `42` | fieldError `body` (use `it.each`, one ID) |
| TC-C2-10 | UUID that is not version 4 | well-formed v1 UUID | Contract (conventions.md) says v4 → expected rejection. If accepted, it is a finding (see README "defect") |

Assert the **error code and the fieldErrors** (not just "it throws"): weak oracles let mutants survive.

## Run
`npm run test:p1 --workspace=@aforo/inventory` → verdicts + branch coverage of `validation.ts`
(`quality/reports/c2/coverage/index.html`).

## Report (doc team-E-p1)
- **Section 8, row C2:** branch coverage % (n/m) and which branch is not executed and why.
- **Section 9:** result of TC-C2-10 (expected vs. observed).
- Extra (coordinator): integrate everyone's results in the doc and remove the "Guía de trabajo" part before the PDF.
