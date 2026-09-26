# gateway — API Gateway

> Owner: Juan José · Contract: [contracts/openapi/gateway.yaml](../../contracts/openapi/gateway.yaml)
> Status: not started

Our own thin service (not Google's API Gateway product). It issues and validates the session
token, generates the correlation ID, applies a per-IP quota and proxies to the owning service.
With no Edge in this slice, it is the only public entry besides the frontend, so it also handles
CORS. While login is simulated, the auth module lives here.

It does **no** aggregation or response transformation. If a screen needs two things, it makes
two calls.

## Routing table

| Public route | Target | Token |
| ------------ | ------ | :---: |
| `POST /api/v1/auth/login` | gateway itself | No |
| `GET /api/v1/events` | catalog | No |
| `GET /api/v1/events/{eventId}` | catalog | No |
| `POST /api/v1/events` | catalog | Yes |
| `PUT /api/v1/events/{eventId}/sales-rules` | catalog | Yes |
| `POST /api/v1/events/{eventId}/publish` | catalog | Yes |
| `GET /api/v1/events/{eventId}/availability` | inventory | No |
| `POST /api/v1/queue/{eventId}/join` | queue | Yes |
| `GET /api/v1/queue/{eventId}/status` | queue | Yes |
| `GET /api/v1/queue/{eventId}/stream` | queue (SSE) | Yes |
| `POST /api/v1/orders` | orders | Yes |
| `GET /api/v1/orders` | orders | Yes |
| `GET /api/v1/orders/{orderId}` | orders | Yes |
| `POST /api/v1/orders/{orderId}/payment-intents` | orders | Yes |
| `POST /api/v1/payments/webhook` | orders | No (HMAC checked by orders) |
| `GET /mock-gateway/**` | mock-payment-gateway function (prefix stripped) | No |

Note: `/availability` shares the `/api/v1/events/` prefix with Catalog but goes to Inventory —
match it before the generic Catalog rule. `/internal/v1/**` is never routed.

## Rules

1. `POST /api/v1/auth/login` takes email and name, validates nothing and returns the JWT
   (HS256, 8 h, claims `iss`, `sub`=UUID v5(email), `email`, `name`, `iat`, `exp`).
   When Identity Platform arrives, this route disappears and validation uses the provider JWKS,
   cached in memory.
2. Missing or expired token on a protected route → `401 UNAUTHENTICATED` without touching the backend.
3. On success forward `X-User-Id` and `X-User-Email`. Strip any client-sent `X-User-*` headers.
4. `X-Queue-Pass` is forwarded as-is when present. Nobody verifies it (D-07).
5. Quota: 60 req/min per IP on `/api/v1/queue/*` and 600 on the rest → `429 RATE_LIMITED` with `Retry-After`.
6. `/api/v1/queue/{eventId}/stream` is proxied **without buffering and without response timeout**, or SSE breaks.
7. Webhook and mock routes pass without token (the payment gateway has no session).
   `/mock-gateway/checkout/…` is proxied to the function as `/checkout/…`.
8. CORS: only `FRONTEND_ORIGIN`, allowing `Authorization`, `X-Queue-Pass`, `Idempotency-Key`, `X-Correlation-Id`.
9. Calls to backends carry a Google OIDC ID token for the target URL (logic services are private).
10. Generate `X-Correlation-Id` (UUID v4) if absent; echo it in the response.

## Configuration

See [.env.example](.env.example). `AUTH_SECRET` comes from Secret Manager in the cloud.

## Run locally

TODO (owner): `npm run dev` against the deployed `dev` services.
