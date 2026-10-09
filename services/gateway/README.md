# Gateway — API Gateway

> Owner: Juan José · Contract: [contracts/openapi/gateway.yaml](../../contracts/openapi/gateway.yaml)
> Status: every route of the public route map implemented; the default quota (`RATE_LIMIT_DEFAULT_PER_MIN`) is not

This slice provides the simulated login, HS256 session validation, correlation IDs,
problem+json errors, structured request logs, health routes, CORS, a Cloud Run container, and the
proxy for the Catalog, queue, Orders, Inventory and mock checkout routes, with a per-IP quota on the
queue routes.
The session JWT represents the browser user session. It is separate from the Google OIDC ID tokens
that identify the Gateway's own calls to private services (Catalog and Queue).

## Implemented routes

| Route | Behavior |
| ------ | -------- |
| `POST /api/v1/auth/login` | Validates `{ email, displayName }`; returns an eight-hour HS256 JWT. No password or identity provider is used. |
| `GET /health/live` | Reports that the process is answering; intended for Cloud Run liveness. |
| `GET /health/ready` | Runs registered dependency checks and returns 503 if any check fails, and while shutting down. |
| `GET /api/v1/events[/{eventId}]` | Public; forwarded to Catalog (`CATALOG_URL`). |
| `POST /api/v1/events`, `PUT /api/v1/events/{eventId}/sales-rules`, `POST /api/v1/events/{eventId}/publish` | Session token required; forwarded to Catalog. |
| `POST /api/v1/queue/{eventId}/join`, `GET .../status`, `GET .../stream` | Session token required. Forwarded to the queue service (`QUEUE_URL`); see below. |
| `GET /api/v1/events/{eventId}/availability` | Public; forwarded to Inventory (`INVENTORY_URL`). |
| `POST /api/v1/orders`, `GET /api/v1/orders[/{orderId}]`, `POST /api/v1/orders/{orderId}/payment-intents` | Session token required; forwarded to Orders (`ORDERS_URL`). |
| `POST /api/v1/payments/webhook` | No session (Orders checks the HMAC); forwarded to Orders byte for byte. |
| `GET /mock-gateway/checkout/{paymentId}[/complete?outcome=]` | Public; forwarded to the mock payment function (`MOCK_PAYMENT_GATEWAY_URL`). |

The UUID v5 namespace used for simulated user IDs is `d394b39c-c447-5a1f-b3ab-44c4b07be48c`.
The email is trimmed and lower-cased before deriving the UUID and signing the token.

## Catalog routes

The Gateway builds only the five Catalog paths above. Public reads preserve the query string and
send no browser-supplied identity headers. Writes forward `Idempotency-Key`, JSON bodies and
`X-User-Id` / `X-User-Email` from the validated session, never from request headers. Every call
forwards `X-Correlation-Id`. With `AUTH_MODE=cloud`, calls to the private Catalog carry the
Gateway service account's Google ID token for audience `aforo-catalog`; locally no ID token is
needed. Catalog's JSON and problem+json status/body, plus `Idempotent-Replayed`, pass through.
An unexpected non-JSON response (for example, an IAM HTML 403) becomes 500 `INTERNAL`.

`GET /api/v1/events/{eventId}/availability` belongs to Inventory and is deliberately not caught
by the Catalog routes (see "Orders, Inventory and mock routes").

## Queue routes

The Gateway is deliberately not a generic proxy. The path sent to the queue service is rebuilt from a
fixed operation (`join`, `status` or `stream`) and an `eventId` that must be a UUID, so nobody can aim
a request at another route of the queue service (`/internal/v1/**` in particular answers 404 here).

- **Identity.** `X-User-Id` and `X-User-Email` come from the validated token. The ones a browser sends are
  never copied, and the user's `Authorization` header is not forwarded. `X-Queue-Pass` and
  `X-Correlation-Id` are forwarded (the pass is logged, never verified, D-07).
- **Service identity.** In `dev` on GCP the queue is private: Cloud Run only lets in the Gateway's service
  account (`infra/envs/dev/services.tf`). With `AUTH_MODE=cloud` (set by Terraform) every call carries the
  Gateway's Google ID token in `Authorization`, for the queue's custom audience `aforo-queue`, taken from the
  instance metadata server and reused for 50 minutes (tokens last one hour; concurrent first calls share
  one fetch). Without it every join is a 403 from Cloud Run. With `AUTH_MODE=dev` (local) no token is sent.
- **SSE.** The stream is piped without buffering and without a response timeout; the 2.5 s timeout only
  covers waiting for the response headers. When the client leaves, the connection to the queue service is
  closed. On SIGTERM open streams are ended and the shutdown waits for them to finish.
- **Quota.** `RATE_LIMIT_QUEUE_PER_MIN` (60) requests per client address per minute on these routes, counted
  in Redis (`REDIS_URL`) so every instance shares it. It answers 429 `RATE_LIMITED` with `Retry-After`
  (exposed by CORS so the browser can read it). It runs before the session check, so requests with a bad
  token spend it too. It **fails open**: with no `REDIS_URL` (Memorystore off, ADR-0001) or a Redis that
  does not answer, requests pass and a warning is logged; Redis is not part of `/health/ready`.
- **Client address.** `request.ip` is the address Cloud Run's front end appended at the end of
  `X-Forwarded-For` (`src/trust-proxy.ts`). It is a function and not `trustProxy: 1` because Fastify 5.12
  treats a number as "trust nothing" while the 5.11 bundled by `@nestjs/platform-fastify` counts hops.
- **Upstream errors.** A queue service that is down or does not answer within 2.5 s is a 500 `INTERNAL`
  problem+json. The queue's own answers (200, 201, 404, 409, 500) pass through unchanged. An answer that is
  not JSON did not come from the queue (Google's HTML page for a 403 from IAM, for example): it becomes a
  500 `INTERNAL` problem+json, and the log line `queue.unexpected_answer` keeps its real status. A failed
  ID token is the same 500, logged as `queue.identity_token_failed`, and the queue is not called.

## Orders, Inventory and mock routes

Same rules as the Catalog and queue routes: the upstream path is rebuilt from a fixed operation and
UUIDs (`src/upstream/upstream.service.ts`), identity headers come only from the validated session,
the browser's `Authorization` is never forwarded, and `X-Correlation-Id` always is. JSON and
problem+json answers pass through with `Idempotent-Replayed`; a 2xx with an empty body passes
through bodiless whatever its label (Orders answers a handled webhook with an empty 200 that Express
labels `text/html`); anything else (an IAM HTML 403) is a 500 `INTERNAL`.

- **Orders.** Writes forward `Idempotency-Key`, `X-Queue-Pass` (logged by Orders, never verified,
  D-07) and the body exactly as received. The list keeps its query string. Timeout **15 s**, not the
  usual 2.5 s: a payment intent waits for Orders' own E-06 policy toward the mock (3 attempts of
  0.5 s + 2 s, plus backoff, about 8 s), plus Orders' DB work and a possible cold start, and the
  Gateway must outlast it so the buyer gets Orders' `503 PAYMENT_UNAVAILABLE`, not a Gateway 500. ID-token audience `aforo-orders`.
- **Payment webhook.** Called by the mock through Cloud Tasks, so no session. The raw body is
  forwarded byte for byte with `X-Signature` (the app runs with `rawBody`): an HMAC over a
  re-serialized JSON would not match.
- **Availability.** Public, no identity headers, 2.5 s, audience `aforo-inventory`.
- **Mock checkout.** Only `GET /checkout/{paymentId}` (an HTML page) and
  `GET /checkout/{paymentId}/complete?outcome=APPROVED|DECLINED` (a 302 back to the web) are
  routed; the mock's `/payments` and `/webhook-dispatch` are not reachable. A 200 HTML page and the
  302 `Location` pass through with `Cache-Control: no-store`. Timeout 10 s (a cold function that
  enqueues a Cloud Task). A function has no custom audience: the ID token is for its URL, as
  Orders does.

## Local run

Use Node 24. From this folder, copy `.env.example` to `.env`, set `AUTH_SECRET` to at least 32
random bytes, and run `npm install` once at the repository root. Start the service with
`npm run dev`. The service listens on `PORT` (8080 by default) and binds to `0.0.0.0`.
Run `npm run dev` again after changing TypeScript sources; the command builds the shared package
and Gateway before starting the process.

To build the Cloud Run image, use the repository root as Docker context:
`docker build -f services/gateway/Dockerfile -t aforo-gateway .`. Runtime values, including
`AUTH_SECRET`, must be supplied through the Cloud Run service configuration.

Example request:

```http
POST /api/v1/auth/login
Content-Type: application/json

{"email":"ana@example.com","displayName":"Ana"}
```

## Still to implement

The default quota (`RATE_LIMIT_DEFAULT_PER_MIN`) is not implemented.

The Gateway's Redis quota wiring and the 3600 s SSE request timeout are supplied by infrastructure
PRs #21 and #20 respectively. The quota fails open while Redis is off.
`sessionStorage` persistence belongs to the frontend; the Gateway only issues and validates the
session token.

The public route map is:

| Public route | Target | Session token |
| ------------ | ------ | :---: |
| `GET /api/v1/events[/{eventId}]` | Catalog | No |
| `POST /api/v1/events` | Catalog | Yes |
| `PUT /api/v1/events/{eventId}/sales-rules` | Catalog | Yes |
| `POST /api/v1/events/{eventId}/publish` | Catalog | Yes |
| `GET /api/v1/events/{eventId}/availability` | Inventory | No |
| `POST /api/v1/queue/{eventId}/join` | Queue | Yes |
| `GET /api/v1/queue/{eventId}/status` and `/stream` | Queue | Yes |
| `POST /api/v1/orders` and `GET /api/v1/orders[/{orderId}]` | Orders | Yes |
| `POST /api/v1/orders/{orderId}/payment-intents` | Orders | Yes |
| `POST /api/v1/payments/webhook` | Orders | No; Orders checks HMAC |
| `GET /mock-gateway/**` | Mock-payment-gateway function | No |

Future routing must keep `/availability` on Inventory and `/internal/v1/**` private. The SSE route
streams without buffering or a response timeout; quotas use shared Redis, not per-instance state.
