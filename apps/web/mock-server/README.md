# Aforo dev mock backend

A **development-only**, in-memory mock of the API Gateway plus every public service route, so the
web UI can be exercised end to end (login, catalog, waiting room, reservation, mock payment, paid
order) without the cloud. Node built-ins only, no dependencies, Node 22 or 24.

> **This is NOT part of the Docker image or of any deployment.** It lives in the repo only as a dev
> tool. Never ship it, never point a deployed environment at it. State is lost on every restart.

## Run

```bash
npm run mock --workspace @aforo/web
# or directly
node apps/web/mock-server/server.mjs
```

Point the frontend's `API_BASE_URL` at `http://localhost:8080`. A startup banner prints the port,
the seed event ids and the current env knobs.

## Env knobs

| Variable                   | Default                  | Meaning                                                                                      |
| -------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `PORT`                     | `8080`                   | Listening port.                                                                              |
| `PUBLIC_ORIGIN`            | `http://localhost:$PORT` | Origin used to build `checkoutUrl`.                                                          |
| `FRONTEND_ORIGIN`          | `http://localhost:4000`  | CORS origin (`http://127.0.0.1:4000` is also allowed) and redirect target after paying.      |
| `MOCK_RESERVATION_SECONDS` | `480`                    | `reservationTtlSeconds` of every seed event. Use `30` to see an expiry fast.                 |
| `MOCK_SCHEDULED_MINUTES`   | `3`                      | Minutes after server start when "Jazz al Parque" flips from SCHEDULED to OPEN.               |
| `MOCK_QUEUE_START`         | `8`                      | Position a new joiner starts at. `0` admits immediately.                                     |
| `MOCK_QUEUE_STEP_SECONDS`  | `2`                      | Seconds per position. Also the per-person wait estimate.                                     |
| `MOCK_PASS_SECONDS`        | `600`                    | Lifetime of the queue pass (`passExpiresAt`).                                                |
| `MOCK_NO_SSE`              | unset                    | `1` makes `/stream` answer `503`, to exercise the polling fallback.                          |
| `MOCK_FAULT`               | `none`                   | Initial payment fault: `none`, `error` or `timeout` (both answer `503 PAYMENT_UNAVAILABLE`). |

Example: `MOCK_QUEUE_START=2 MOCK_QUEUE_STEP_SECONDS=1 PORT=18080 node apps/web/mock-server/server.mjs`

## Seed events (fixed ids, times relative to server start)

| Id                                     | Event                             | Sale state                                      | Sectors (capacity, price in COP cents)                                 |
| -------------------------------------- | --------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| `8f1b2c3d-0000-4000-8000-000000000001` | Festival Estéreo 2026             | OPEN                                            | General (500, 18000000), Platea (120, 45000000), VIP (30, 120000000)   |
| `8f1b2c3d-0000-4000-8000-000000000002` | Noche de Salsa en el Teatro Colón | OPEN                                            | Balcón (capacity 3, **2 available**, 9000000), Orquesta (40, 15000000) |
| `8f1b2c3d-0000-4000-8000-000000000003` | Jazz al Parque                    | SCHEDULED, opens after `MOCK_SCHEDULED_MINUTES` | General (200, 6000000)                                                 |

Sector ids are `a1a1a1a1-0000-4000-8000-00000000000N` (N = 1..6 in the order above; read them from
`GET /api/v1/events/{id}`). Sales rules: 4 tickets per person, `openingWindowSeconds` 30.
Ask for the Balcón sector with `quantity: 3` to get `409 SOLD_OUT`.

## Behavior summary

- `POST /api/v1/auth/login` returns an HS256 JWT (8 h) signed with a fixed dev secret; `sub` is a
  UUID v5-style hash of the lower-cased email, so the same email always yields the same user id.
- Everything except login, `GET /api/v1/events*`, availability, `/health/*`, `/mock-gateway/**` and
  `/__mock/**` needs `Authorization: Bearer <token>` (`401 UNAUTHENTICATED` otherwise).
- Queue: positions are computed lazily from elapsed time. `/stream` is SSE: `event: position` on
  every change, then `event: admitted` and the response ends. Joining while already admitted
  returns the admitted status; the stream of an already admitted user sends only `admitted`.
- Orders: `Idempotency-Key` is mandatory. Same key and same body replays the stored response with
  `Idempotent-Replayed: true`; a different body gives `409 IDEMPOTENCY_CONFLICT`. Only `201` and
  `409` results are stored, so a `503` payment fault can be retried with the same key. Rules run
  in this order: 404, SOLD_OUT, ACTIVE_RESERVATION_EXISTS, LIMIT_EXCEEDED. `X-Queue-Pass` is
  logged, never verified. Unpaid reservations expire (lazily on each request and every second)
  and the seats return to the sector.
- Payment: `POST /api/v1/orders/{id}/payment-intents` returns a `checkoutUrl` on this server. The
  checkout page offers "Pagar" and "Rechazar"; the server answers at once and applies the
  "webhook" 2 s later: APPROVED makes a pending order `PAID` (or an already `EXPIRED` one
  `REFUND_PENDING`); DECLINED changes nothing. `GET .../complete?outcome=` (the contract variant)
  also works and answers `302`.
- Every response has `X-Correlation-Id`; errors are `application/problem+json`.

## Dev controls (not in any contract)

| Endpoint                                       | Effect                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `POST /__mock/reset`                           | Restores seed availability and clears orders, queues, payments and idempotency keys. |
| `POST /__mock/fault?mode=none\|error\|timeout` | Switches the payment fault mode at runtime.                                          |
| `GET /__mock/state`                            | JSON dump of availability, orders, queues, payments and the fault mode.              |
