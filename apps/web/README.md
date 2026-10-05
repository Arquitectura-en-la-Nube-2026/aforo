# web — Purchase frontend (Next.js + SSR)

> Owners: Sergio (all screens except the queue) · Cristian (queue screen)
> Contracts: every `contracts/openapi/*.yaml`, always through the Gateway
> Status: all seven screens implemented against the contracts and a dev mock; not yet run against `dev`
> Framework: Next.js (App Router) — [ADR-0007](../../docs/adr/0007-web-framework-next.md) replaces D-02 (Angular)

Seven screens, no more. UI built with an existing component library (shadcn-style components on
Radix and Tailwind, themed through tokens in `src/app/globals.css`); no custom visual system. SSR only
on public routes `/` and `/events/:id`; queue, buy and orders render on the client — they depend on
the session and there is nothing to precompute.

## Screens

| Route                    | Screen                                  | Calls                                                                | Owner    |
| ------------------------ | --------------------------------------- | -------------------------------------------------------------------- | -------- |
| `/login`                 | Email and name, no password             | `POST /auth/login`                                                   | Sergio   |
| `/`                      | Published events                        | `GET /events?status=PUBLISHED`                                       | Sergio   |
| `/events/:id`            | Detail, sectors, prices, sale state     | `GET /events/{id}`, `GET /events/{id}/availability`                  | Sergio   |
| `/events/:id/queue`      | Position, estimated wait, admission     | `POST /queue/{id}/join`, SSE `stream` (fallback: `status` every 3 s) | Cristian |
| `/events/:id/buy`        | Sector, quantity, total, pass countdown | `POST /orders`                                                       | Sergio   |
| `/orders/:id/pay`        | Summary and jump to the mock            | `POST /orders/{id}/payment-intents`                                  | Sergio   |
| `/orders`, `/orders/:id` | My orders and detail with status        | `GET /orders`, `GET /orders/{id}`                                    | Sergio   |

Besides the screens, the app answers `GET /health/live` and `GET /health/ready` (no auth). `ready`
checks that the Gateway answers, and is what the deployment smoke test calls.

## Client rules

1. All HTTP goes through one API client (`src/api/client.ts`, the only place that calls `fetch`). It
   adds `Authorization` and `X-Queue-Pass`; a `401` clears the session and sends the buyer to
   `/login`. The login screen stores whatever the Gateway returns: when Identity Platform arrives
   only this screen changes.
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
7. The frontend never compares dates to decide if a sale is open: it uses `saleState`.

## Decisions taken while building (not in the plan)

- **SSE is read with `fetch`, not `EventSource`.** The stream is authenticated with a bearer token
  and `EventSource` cannot send an `Authorization` header (`src/lib/sse.ts`). If the stream fails or
  ends without admission, the screen polls `status` every 3 s (D-13).
- **Two different countdowns.** The queue pass (10 min, `passExpiresAt`) and the reservation
  (`reservationTtlSeconds`, `expiresAt` of the order) are labelled differently on screen ("Tu turno
  vence en…" / "Tus entradas están reservadas por…") so the buyer knows which one is running.
- **Payment key.** `Idempotency-Key` on `payment-intents` is generated when the pay screen opens. After
  an API error the next click is a new attempt (new key); after a lost connection it is the same one.
- **A payment that never arrives.** If the buyer cancels or declines at the payment page, the backend sends
  nothing: the order just stays `PENDING_PAYMENT`. The order screen says "confirming your payment"
  for 10 s (the plan promises `PAID` in under 5 s) and then switches to "we don't see your payment yet"
  with a button to try again while the reservation lasts.
- **Event names in orders.** `Order` only has `eventId`/`sectorId` and the Gateway does not
  aggregate, so order screens ask Catalog for the event (cached per event, `src/lib/event-cache.ts`).
- **Runtime config.** The image is built once (ADR-0004), so `NEXT_PUBLIC_*` is not used: the root
  layout reads `API_BASE_URL` per request and passes it to the browser (`src/lib/config.tsx`).
- **Public pages refresh themselves.** `/events/:id` starts from the server render and refetches every
  15 s, so a sale that opens or a sector that sells out shows without a reload.

## Layout

```
src/
  app/            routes (App Router): login, events, queue, buy, orders, health/*
  api/            client.ts (the only fetch), endpoints.ts (one function per operation),
                  generated/ (types from contracts/openapi — `npm run gen:api`, never hand-edited)
  features/       queue/, buy/, orders/  — screens with their own state
  components/     shared pieces (ticket stub, countdown, error panel, badges) and ui/ (library components)
  lib/            session, pass, errors by code, money/date formatting, SSE parser, hooks
  lib/i18n/es.ts  every user-facing string (Spanish for the demo audience)
mock-server/      dev-only stateful mock of the Gateway (not part of the image)
```

## UI language

Code is English. User-facing copy is Spanish and lives in one place, `src/lib/i18n/es.ts`; components
never hard-code visible text.

## Run it

```bash
npm install                                   # at the repo root
npm run mock --workspace @aforo/web           # fake Gateway on :8080 (see mock-server/README.md)
npm run dev --workspace @aforo/web            # the app on :4000
```

Or point `API_BASE_URL` / `SSR_API_BASE_URL` at the deployed Gateway (see [.env.example](.env.example)).
Other scripts: `test` (unit tests), `lint`, `typecheck`, `build`, `gen:api`.

The mock has switches to exercise the paths that must fail well: `MOCK_NO_SSE=1` (polling fallback),
`MOCK_PASS_SECONDS`, `MOCK_RESERVATION_SECONDS` (expiry), `POST /__mock/fault?mode=error` (payment down).

## Configuration

See [.env.example](.env.example). `API_BASE_URL` is what the browser calls; `SSR_API_BASE_URL` is what
the server uses to render `/` and `/events/:id`. Both are read at runtime.
