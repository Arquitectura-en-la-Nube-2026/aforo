# Work log — Daniel Felipe (Orders & mock-payment-gateway)

Delivery 4 assignment: [services/orders](README.md) and
[functions/mock-payment-gateway](../../functions/mock-payment-gateway/README.md).
Branch: `feature/Orders&checkout`. Contracts: `contracts/openapi/orders.yaml`,
`contracts/openapi/mock-payment-gateway.yaml`, `contracts/events/order-paid.v1.schema.json`.

## Step 1 — `services/orders` skeleton and health checks

- `src/main.ts`: `rawBody: true` (webhook HMAC), global `ProblemJsonFilter`, `ValidationPipe`
  mapped to `422 VALIDATION_ERROR`, JSON logger, `enableShutdownHooks()` + `installGracefulShutdown`
  (SIGTERM), listens on `PORT`.
- `src/config/config.ts`: typed, fail-fast reader for every variable in `.env.example`.
- `src/app.module.ts`: correlation middleware, request-log interceptor, `HealthModule`
  (`/health/live`, `/health/ready` with a DB check), housekeeping, shutdown.
- `src/db/`: lazy `pg` pool (the service boots without its DB), `tx()` helper, `migrate.ts` runner.
- `Dockerfile`, `package.json` (`dev`, `build`, `test`, `lint`, `migrate`), `tsconfig*.json`.

## Step 2 — Migrations (`migrations/001_init.sql`)

Tables `order`, `payment`, `idempotency_key`, `inbox`, `outbox`.
Triggers enforce the transitions of `docs/architecture/state-machines.md`:

- Order: `PENDING_PAYMENT -> PAID | REFUND_PENDING | EXPIRED`, and `EXPIRED -> REFUND_PENDING`
  (late approval, the option the state-machines doc recommends).
- Payment: `CREATED -> APPROVED | DECLINED`, `APPROVED -> REFUNDED`.
- Check constraints: `paid_at` only when `PAID`, `refund_id` only when `REFUNDED`,
  `total = unit_price * quantity`, currency `COP`, unique `reservation_id`.

## Step 3 — `functions/mock-payment-gateway`

No NestJS, one entry point (`src/index.ts`, `@google-cloud/functions-framework`). Pure routing in
`src/handler.ts`, so it is unit-testable without the framework.

- `POST /payments` (idempotent: the payment id is derived from the `Idempotency-Key`),
  `POST /payments/{id}/refunds`, `GET /checkout/{id}` (HTML with Pay / Decline),
  `GET /checkout/{id}/complete?outcome=`, `POST /webhook-dispatch`.
- `FAULT_MODE`: `none`, `error` (503 problem+json), `timeout` (sleeps `FAULT_DELAY_MS`), only on
  `POST /payments`.
- The +2 s webhook is a Cloud Tasks task (`scheduleTime = now + 2 s`, task name = `notificationId`);
  no sleep, no background work. `/webhook-dispatch` signs the raw body (`X-Signature: sha256=...`)
  and answers non-2xx when Orders does, so Cloud Tasks retries.
- Storage: Firestore (decided), collection `payments`. In-memory repository for tests.
- Build: `npm run build` bundles our code (~11 kB); `@google-cloud/*` stay external.

## Step 4 — Resilient payments module (E-06)

`src/payments/`: `PaymentGateway` port + `HttpPaymentGateway` adapter + `resilience.ts` (`cockatiel`).

| Tactic | Implementation |
| ------ | -------------- |
| Timeouts | connect 0.5 s, response 2 s (HTTP client) |
| Circuit breaker | `ConsecutiveBreaker(5)`, half-open after 30 s; open circuit fails immediately |
| Retry | 3 attempts total, exponential backoff 200 ms to 5 s with jitter |
| Logs | `event=circuit_state` with `from` / `to`; `event=payment_retry` |
| Degradation | `503 PAYMENT_UNAVAILABLE`; 4xx answers are not retried and do not trip the breaker |

## Step 5 — Saga orchestrator and webhook

- `POST /api/v1/orders`: reserves in Inventory (`buyerId = X-User-Id`, forwards
  `Idempotency-Key` and `X-Correlation-Id`); Inventory rejections propagate with the same `code`;
  the order is inserted idempotently on `reservation_id`.
- `POST /api/v1/orders/{id}/payment-intents`, `GET /api/v1/orders`, `GET /api/v1/orders/{id}`.
- `POST /api/v1/payments/webhook` (`payments/webhook.service.ts`):
  1. HMAC over the raw body (`401 INVALID_SIGNATURE`, constant-time compare).
  2. `notificationId` already in `inbox` -> `200`.
  3. `APPROVED` -> Inventory `confirm` (key = `notificationId`).
  4. One transaction: `inbox` row + payment/order transition + `outbox` row (`OrderPaid`);
     commit, `OutboxPublisher.flush()`, `200`.
  5. Any failure -> `503` so Cloud Tasks retries. `confirm -> EXPIRED` sends the order to
     `REFUND_PENDING` and requests a refund keyed by a UUID derived from the payment id; housekeeping retries failed refunds.
- `ReservationExpired` push (`PENDING_PAYMENT -> EXPIRED`, deduped by `messageId`) and
  `RefundSweep` for `POST /internal/v1/housekeeping`.

## Verification

- `services/orders`: `npx jest` (config, HMAC signature, webhook saga, E-06 breaker/retry).
- Against a real Postgres (`test/repositories.integration.spec.ts`, opt-in):

  ```bash
  docker run --rm -d --name orders-test-db -e POSTGRES_USER=orders -e POSTGRES_PASSWORD=test \
    -e POSTGRES_DB=orders -p 55432:5432 postgres:17-alpine
  DATABASE_URL=postgres://orders:test@127.0.0.1:55432/orders npx tsx src/db/migrate.ts
  TEST_DATABASE_URL=postgres://orders:test@127.0.0.1:55432/orders npx jest
  docker stop orders-test-db
  ```

  Also checked by hand: every invalid transition is rejected by the triggers, `migrate` is
  idempotent, a rolled-back transaction leaves no `inbox`/`outbox` row.
- `functions/mock-payment-gateway`: `npx jest` (20 tests) and a local `functions-framework` smoke run.

## Assumptions and open items

- **`@aforo/common` has no code yet.** Every import goes through `services/orders/src/common.ts`
  and `functions/mock-payment-gateway/src/common.ts`; names are taken from
  `packages/common/README.md`. Fix any naming drift there when Juan Jose publishes it.
  Until then `npm install` fails on the `@aforo/common` dependency and the function build needs it.
- Orders provides Postgres adapters for the common ports (`OUTBOX_STORE`, `IDEMPOTENCY_REPOSITORY`).
  The `outbox` columns (`id, topic, type, correlation_id, payload, created_at, published_at`) must
  match what `OutboxPublisher` expects.
- Missing test: a repeated `Idempotency-Key` on `POST /orders` returns the same status and body.
  That behavior lives in common's interceptor; add it once the package exists. (The function's
  replay is already tested.)
- Not measured yet: cold start of the function (record it in its README after the first deploy).
- Node 24 is the target; it was developed on Node 22. Nest 11 and cockatiel 3 (CommonJS) were
  chosen because `tsconfig.base.json` is `commonjs`; TypeScript is pinned to 5.9.
- Out of this PR's folders: root `package-lock.json` (npm workspaces).
