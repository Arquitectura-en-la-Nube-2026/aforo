# Gateway — API Gateway

> Owner: Juan José · Contract: [contracts/openapi/gateway.yaml](../../contracts/openapi/gateway.yaml)
> Status: authentication foundation and the queue routes (proxy, SSE, per-IP quota) implemented

This slice provides the simulated login, HS256 session validation, correlation IDs,
problem+json errors, structured request logs, health routes, CORS, a Cloud Run container, and the
proxy for the three queue routes with its per-IP quota.
The session JWT represents the browser user session. It is separate from Google OIDC ID tokens,
which will identify Gateway-to-service calls when private service routing is implemented.

## Implemented routes

| Route | Behavior |
| ------ | -------- |
| `POST /api/v1/auth/login` | Validates `{ email, displayName }`; returns an eight-hour HS256 JWT. No password or identity provider is used. |
| `GET /health/live` | Reports that the process is answering; intended for Cloud Run liveness. |
| `GET /health/ready` | Runs registered dependency checks and returns 503 if any check fails, and while shutting down. |
| `POST /api/v1/queue/{eventId}/join`, `GET .../status`, `GET .../stream` | Session token required. Forwarded to the queue service (`QUEUE_URL`); see below. |

The UUID v5 namespace used for simulated user IDs is `d394b39c-c447-5a1f-b3ab-44c4b07be48c`.
The email is trimmed and lower-cased before deriving the UUID and signing the token.

## Queue routes

The Gateway is deliberately not a generic proxy. The path sent to the queue service is rebuilt from a
fixed operation (`join`, `status` or `stream`) and an `eventId` that must be a UUID, so nobody can aim
a request at another route of the queue service (`/internal/v1/**` in particular answers 404 here).

- **Identity.** `X-User-Id` and `X-User-Email` come from the validated token. The ones a browser sends are
  never copied, and the user's `Authorization` header is not forwarded. `X-Queue-Pass` and
  `X-Correlation-Id` are forwarded (the pass is logged, never verified, D-07).
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
  problem+json. The queue's own answers (200, 201, 404, 409, 500) pass through unchanged.

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

The Catalog, Orders and Inventory routes, **Google OIDC service identity**, the default quota
(`RATE_LIMIT_DEFAULT_PER_MIN`) and payment webhook/mock routing are not part of this slice.
Without the OIDC ID token the queue routes only work against a queue service that does not require
it, as when running both locally: in `dev` on GCP the queue is private and only this service's account
may call it (`infra/envs/dev/services.tf`), so Cloud Run IAM would reject the Gateway's calls. Also
missing in Terraform: `REDIS_URL` and VPC egress for the Gateway, without which the quota stays off.
`sessionStorage` persistence belongs to the frontend; the Gateway only issues and validates the
session token.

The planned public route map remains:

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

When routing is added, `/availability` must be matched before the general Catalog event route,
`/internal/v1/**` must never be exposed, and the SSE route must stream without buffering or a
response timeout. Quotas and service-to-service identity will be implemented with shared or
distributed infrastructure, never as per-instance in-memory state.
