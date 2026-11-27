# C4 — Payment webhook processing · Sergio

**Code under test:** `services/orders/src/payments/webhook.service.ts` (`WebhookService.handle`) and
`webhook-signature.ts` (`verifySignature`).
**Tests go in:** `services/orders/test/p1/c4-webhook.test.ts` (TC-C4-01..02 already there).
**Doubles:** `services/orders/test/p1/helpers/webhook-deps.ts` → `makeDeps()` gives a `jest.fn()` with a
happy-path default for each of the 9 dependencies; override only what the case is about.
**Branch:** `quality/c4-sergio` · **Runner:** Jest · **Also:** mutation testing (Stryker)

## Missing cases
| ID | Condition | Inputs (stubs) | Expected |
|---|---|---|---|
| TC-C4-03 | Unknown payment, or orderId mismatch | `payments.findById → null`; `payment.orderId ≠ n.orderId` | rejects `NOT_FOUND`; `db.tx` not called |
| TC-C4-05 | DECLINED | `status: 'DECLINED'` | payment `CREATED → DECLINED`; `inventory.confirmReservation` not called; order untouched |
| TC-C4-06 | APPROVED, reservation expired | `confirm → EXPIRED`; `markRefundPending → true` | `refunds.request` called; no `outbox.add` |
| TC-C4-07 | Inventory fails | `confirmReservation` rejects | error propagates; `inbox.claim` not called |
| TC-C4-09 | markPaid returns null | `confirm → CONFIRMED`; `markPaid → null` | no `outbox.add`, no refund (spec gap: report it) |
| TC-C4-10 | Outbox flush fails | `publisher.flush` rejects | `handle` resolves; a warning is logged |
| TC-C4-11 | APPROVED for a payment already DECLINED | `payments.transition → false` | Expected: order **not** PAID. Suspected defect (README "defect") |
| TC-C4-13 | Valid signature followed by non-hex chars | header `'sha256=' + <64 hex> + 'zz'` | Expected `false`. Suspected defect: returns `true` |

## Run
- Tests + coverage: `npm run test:p1:c4 --workspace=@aforo/orders` (`quality/reports/c4/coverage/`).
- Mutation: `npm run test:p1:mutation --workspace=@aforo/orders` (`quality/reports/c4/mutation/index.html`).
  Note the score, then for each **survivor** decide: equivalent, or a missing assertion/case. Strengthen
  assertions (or add at most 2 cases `TC-C4-14/15`), run again, and keep the score **before → after**.

## Report (doc team-E-p1)
- **Section 8:** row C4 (branch % and what is not executed and why) + one paragraph under "Mutation testing":
  score before → after, survivors and what you strengthened (see C3's paragraph as the model).
- **Section 9:** TC-C4-09, -11 and -13 (expected vs. observed).
