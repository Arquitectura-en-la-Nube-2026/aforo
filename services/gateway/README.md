# Gateway — API Gateway

> Owner: Juan José · Contract: [contracts/openapi/gateway.yaml](../../contracts/openapi/gateway.yaml)
> Status: initial authentication foundation implemented

This first slice provides the simulated login, HS256 session validation, correlation IDs,
problem+json errors, structured request logs, health routes, CORS, and a Cloud Run container.
The session JWT represents the browser user session. It is separate from Google OIDC ID tokens,
which will identify Gateway-to-service calls when private service routing is implemented.

## Implemented routes

| Route | Behavior |
| ------ | -------- |
| `POST /api/v1/auth/login` | Validates `{ email, displayName }`; returns an eight-hour HS256 JWT. No password or identity provider is used. |
| `GET /health/live` | Reports that the process is answering; intended for Cloud Run liveness. |
| `GET /health/ready` | Runs registered dependency checks and returns 503 if any check fails. |

The UUID v5 namespace used for simulated user IDs is `d394b39c-c447-5a1f-b3ab-44c4b07be48c`.
The email is trimmed and lower-cased before deriving the UUID and signing the token.

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

The route proxy, bearer-token enforcement on proxied routes, stripping and forwarding user
headers, Google OIDC service identity, distributed per-IP quotas, SSE pass-through, and payment
webhook/mock routing are not part of this slice. `sessionStorage` persistence belongs to the
frontend; the Gateway only issues and validates the session token.

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
