# C6 — Purchase button (`PurchaseAction`) · Daniel

**Code under test:** `apps/web/src/components/purchase-action.tsx`.
**Tests go in:** `apps/web/test/p1/c6-purchase-action.test.tsx` (TC-C6-01..02 already there, with
`vi.mock` of `@/lib/use-session`, `@/lib/pass` and `next/link` — reuse them).
**Branch:** `quality/c6-daniel` · **Runner:** Vitest + React Testing Library (jsdom)

Query by role and visible text (`getByRole('link', { name: es.detail.joinQueue })`), texts from
`@/lib/i18n/es`. Assert `href` with `getAttribute('href')`. Never by CSS class or markup structure.

## Missing cases
| ID | Condition | Inputs | Expected |
|---|---|---|---|
| TC-C6-03 | saleState SCHEDULED | `salesOpensAt '2026-12-01T15:00:00Z'` | opening text with `<time dateTime=…>` equal to salesOpensAt; no link |
| TC-C6-04 | OPEN, session not loaded yet | `ready: false` | no link |
| TC-C6-05 | OPEN, no session | `session: null`, `ready: true` | link `es.detail.loginToJoin` → `/login?next=%2Fevents%2F<id>` |
| TC-C6-06 | OPEN, session and live pass | `getPass → { passToken, passExpiresAt }` | link `es.detail.continueBuying` → `/events/<id>/buy` |
| TC-C6-08 | Session changes with the page open | render with buyer A + pass, then `rerender` after switching `useSession` to buyer B and `getPass → null` | Expected: link to `/queue`. Suspected defect: still `/buy` (README "defect") |

## Run
`npm run test:p1 --workspace=@aforo/web` → verdicts + branch coverage of `purchase-action.tsx`
(`quality/reports/c6/coverage/`).

## Report (doc team-E-p1)
- **Section 8, row C6:** branch % (n/m) and what is not executed and why.
- **Section 9:** result of TC-C6-08 (expected vs. observed).
