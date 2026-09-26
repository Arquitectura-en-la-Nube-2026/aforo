# orders — Orders & checkout

> Owner: Daniel Felipe · Contract: [contracts/openapi/orders.yaml](../../contracts/openapi/orders.yaml)
> Status: not started · Also owns [functions/mock-payment-gateway](../../functions/mock-payment-gateway/README.md)

Orchestrates the saga and owns the order. Talks to the payment gateway — today the
`mock-payment-gateway` function (D-16), tomorrow Wompi — **only through its payment adapter**
(Anti-Corruption Layer), which carries the E-06 resilience tactics. PostgreSQL, database `orders`.

## Endpoints

| Operation | Endpoint | Headers |
| --------- | -------- | ------- |
| Create order and reserve | `POST /api/v1/orders` | Token, `Idempotency-Key` |
| Start payment | `POST /api/v1/orders/{orderId}/payment-intents` | Token, `Idempotency-Key` |
| Get order | `GET /api/v1/orders/{orderId}` | Token |
| List my orders | `GET /api/v1/orders` | Token |
| Payment webhook | `POST /api/v1/payments/webhook` | HMAC signature |

## Rules

- `POST /orders` calls `POST /internal/v1/reservations` on Inventory with `buyerId = X-User-Id`,
  forwarding `Idempotency-Key` and `X-Correlation-Id`. If Inventory rejects, the order is **not**
  created and the same `code` and HTTP status are propagated.
- `X-Queue-Pass` is logged and ignored (D-07).
- State machine: [docs/architecture/state-machines.md](../../docs/architecture/state-machines.md)
  (Order and Payment). Every transition is a conditional update.
- `payment-intents` calls `POST /payments` on the payment gateway and returns
  `{ paymentId, checkoutUrl, expiresAt }`; the frontend redirects to `checkoutUrl`.
- Webhook, **processed synchronously** (ADR-0002 — Cloud Run throttles CPU after the response):
  1. Validate `X-Signature: sha256=<hmac>` over the **raw body** → `401 INVALID_SIGNATURE`.
  2. `notificationId` already in `inbox` → `200`, nothing else.
  3. `APPROVED`: call Inventory `confirm` (idempotent; `Idempotency-Key` = `notificationId`).
  4. One transaction: insert the `inbox` row, apply the order/payment transition, write the
     outbox row. Commit, `flush()` the outbox, answer `200`.
  5. Any failure → non-2xx (`503`); the mock's `/webhook-dispatch` propagates it and Cloud Tasks
     retries the notification. Steps 3–4 are safe to repeat.
- `APPROVED` → `confirm` on Inventory:
  - `CONFIRMED` → order `PAID` + `OrderPaid` in the outbox, same transaction.
  - `EXPIRED` → order `REFUND_PENDING` + refund on the gateway with an idempotency key
    (`refund-<paymentId>`), requested after the commit in the same request. If that call fails,
    housekeeping retries it for `REFUND_PENDING` orders without a refund id. The reservation is
    **not** reactivated. Implemented even though the happy path doesn't use it: it's the race
    that justifies the saga.
- `ReservationExpired` from the bus: if the order is still `PENDING_PAYMENT` → `EXPIRED`.

## Payment adapter — resilience tactics (E-06, D-18)

This is the demonstrable tactic for Delivery 4. Parameters from Entrega 3 §6.2:

| Tactic | Setting |
| ------ | ------- |
| Timeouts | connect 0.5 s, response 2 s |
| Circuit breaker | opens after 5 consecutive failures, half-open after 30 s; while open, fails in ≤ 50 ms |
| Retry | 3 attempts, exponential backoff 200 ms → 5 s with jitter; only on idempotent calls (they all carry `Idempotency-Key`) |
| Graceful degradation | `503 PAYMENT_UNAVAILABLE` to the buyer, who may retry while the reservation lives; the expiry is **never** extended (ADR-03) |

Circuit state changes are logged (`event=circuit_state`, `from`, `to`) so the demo can show them
in Cloud Logging. Demo: `make fault MODE=timeout` (a Terraform switch, about a minute to apply),
try to pay, watch the circuit open, then `make fault MODE=none` and watch it close.

The breaker lives in the instance's memory. In dev, Orders runs **at most one instance**
(ADR-0005) so the demo shows one breaker; its state is soft (rebuilt on restart) and does not
break statelessness.

## Suggested modules

`orders/` (aggregate + saga), `payments/` (port `PaymentGateway` + HTTP adapter with the
resilience policy — e.g. `opossum` or `cockatiel`), `inventory-client/`, `messaging/` (outbox,
inbox, push controller).

## Events

Produces `OrderPaid` (`aforo.orders.order-paid`). Consumes `ReservationExpired`
(`orders-reservation-expired`).

## Data

Tables: `order`, `payment`, `idempotency_key`, `inbox`, `outbox`. Migrations in `migrations/`.

## Housekeeping

`POST /internal/v1/housekeeping` (every minute, ADR-0002): flush the outbox; retry refunds of
`REFUND_PENDING` orders that have no refund id yet.

## Configuration

See [.env.example](.env.example).
