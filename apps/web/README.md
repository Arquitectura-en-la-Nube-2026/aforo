# web — Purchase frontend (Angular 20 + SSR)

> Owners: Sergio (all screens except the queue) · Cristian (queue screen)
> Contracts: every `contracts/openapi/*.yaml`, always through the Gateway
> Status: not started

Seven screens, no more. UI built with an existing component library (suggestion: Angular
Material); no custom visual system. SSR only on public routes `/` and `/events/:id`; queue, buy
and orders render on the client — they depend on the session and there is nothing to precompute.

## Screens

| Route | Screen | Calls | Owner |
| ----- | ------ | ----- | ----- |
| `/login` | Email and name, no password | `POST /auth/login` | Sergio |
| `/` | Published events | `GET /events?status=PUBLISHED` | Sergio |
| `/events/:id` | Detail, sectors, prices, sale state | `GET /events/{id}`, `GET /events/{id}/availability` | Sergio |
| `/events/:id/queue` | Position, estimated wait, admission | `POST /queue/{id}/join`, SSE `stream` (fallback: `status` every 3 s) | Cristian |
| `/events/:id/buy` | Sector, quantity, total, pass countdown | `POST /orders` | Sergio |
| `/orders/:id/pay` | Summary and jump to the mock | `POST /orders/{id}/payment-intents` | Sergio |
| `/orders`, `/orders/:id` | My orders and detail with status | `GET /orders`, `GET /orders/{id}` | Sergio |

## Client rules

1. The token goes on every request via an interceptor; a `401` sends the user to `/login`. The
   login screen stores whatever the Gateway returns: when Identity Platform arrives only this
   screen changes.
2. `passToken` lives in memory and is mirrored in `sessionStorage` to survive a refresh. It is
   sent as `X-Queue-Pass` even though nobody verifies it today, so the client doesn't change later.
3. The pass countdown uses `passExpiresAt`; at zero the screen returns to the queue. No auto-renew.
4. `Idempotency-Key` is generated once when the buy screen opens and reused on every retry of
   that attempt. If sector or quantity change, generate a new one.
5. Errors are shown by `code`, never by `detail`: `SOLD_OUT`, `LIMIT_EXCEEDED` and
   `RESERVATION_EXPIRED` have their own text; everything else falls back to a generic message
   **with the `correlationId` visible**. That makes traceability demonstrable.
6. Order detail polls every 2 s while status is `PENDING_PAYMENT`: the webhook arrives after the
   user returns.

## Suggested layout

```
src/app/
  core/          interceptors (auth, correlation, queue pass), error mapping by code, session store
  api/           types generated from contracts/openapi (openapi-typescript), thin API clients
  features/
    login/  catalog/  event-detail/  queue/  buy/  pay/  orders/
  shared/        UI building blocks from the component library
```

## UI language

Code is English. User-facing copy: decide once (Spanish for the demo audience is fine) and keep
it in one place (e.g. `src/app/shared/i18n/`), never hard-coded in components.

## Configuration

See [.env.example](.env.example). Local dev points at the deployed Gateway or at Prism mocks
(`make mock SERVICE=…`).
