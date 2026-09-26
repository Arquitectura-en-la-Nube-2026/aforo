# Cross-service conventions (normative)

These rules are mandatory and are implemented once in `@aforo/common`. Breaking them breaks the
integration, not just your service.

## Routes and versioning
- Every public endpoint hangs from `/api/v1`. Every internal endpoint hangs from `/internal/v1`
  and is **not** exposed by the Gateway.
- An incompatible change creates `/v2`; it never modifies `/v1` (RD-05).
- Pub/Sub push endpoints: `POST /internal/v1/events/{subscription-name}`.
- Housekeeping (ADR-0002): `POST /internal/v1/housekeeping` on catalog, inventory and orders,
  called every minute by Cloud Scheduler. Idempotent; flushes the outbox and runs the service's
  sweeps. Answers `204`.

## User identity
- The Gateway exposes `POST /api/v1/auth/login` with `{ email, displayName }` and returns an
  HS256 JWT valid for 8 hours, signed with a project secret. No password, no registration:
  a deliberate simulator (D-06).
- Claims are OIDC-shaped: `iss`, `sub`, `email`, `iat`, `exp` (+ `name`). `sub` is a UUID v5 of
  the lower-cased email, so the same person always gets the same id (R-02).
- The browser sends `Authorization: Bearer <token>`. The Gateway validates it and forwards
  `X-User-Id` (= `sub`) and `X-User-Email` to the target service.
- **No logic service validates the user token again.** They trust the Gateway headers; only the
  Gateway can invoke them.

## Queue pass
- The queue returns an opaque `passToken` and `passExpiresAt`. The frontend uses them to enable
  the buy screen and show the countdown, and sends the token as `X-Queue-Pass`.
- Neither Orders nor Inventory verifies it (D-07). The header travels, is logged, and leaves the
  hole where verification would plug in when RD-04 is implemented.

## Correlation ID
- The Gateway generates `X-Correlation-Id` (UUID v4) if absent, and propagates it.
- Every service forwards it on outgoing calls, writes it in every log line and publishes it in
  every bus message (envelope field **and** Pub/Sub attribute) (E-05).
- Cloud Tasks requests carry it as a header too.

## Idempotency
- Every state-changing operation carries `Idempotency-Key` (UUID v4).
- The service stores the key, a SHA-256 of the request body and the produced response; a repeat
  with the same key and body returns exactly the same body and status code (RD-02), plus the
  header `Idempotent-Replayed: true` so the replay is observable (R-06).
- Same key with a different request body → `409 IDEMPOTENCY_CONFLICT`.
- The frontend generates the key **per user attempt**, not per network retry.

## Errors
Always `application/problem+json`, never plain text:

```json
{
  "type": "https://aforo.dev/errors/sold-out",
  "title": "Not enough availability",
  "status": 409,
  "code": "SOLD_OUT",
  "detail": "Sector A has 2 seats left and 4 were requested",
  "correlationId": "6f1c…"
}
```

| `code` | HTTP | Emitted by |
| ------ | :--: | ---------- |
| `UNAUTHENTICATED` | 401 | Gateway |
| `SALE_NOT_OPEN` | 409 | Catalog, Queue |
| `SOLD_OUT` | 409 | Inventory |
| `LIMIT_EXCEEDED` | 409 | Inventory |
| `ACTIVE_RESERVATION_EXISTS` | 409 | Inventory |
| `RESERVATION_EXPIRED` | 409 | Inventory, Orders |
| `IDEMPOTENCY_CONFLICT` | 409 | any |
| `VALIDATION_ERROR` | 422 | any |
| `NOT_FOUND` *(R-04)* | 404 | any |
| `INVALID_SIGNATURE` *(R-04)* | 401 | Orders (webhook) |
| `RATE_LIMITED` *(R-04)* | 429 | Gateway (with `Retry-After`) |
| `PAYMENT_UNAVAILABLE` *(R-04)* | 503 | Orders (payment gateway timeout or circuit open) |
| `INTERNAL` *(R-04)* | 500 | any |

Schema violations are `422 VALIDATION_ERROR`, not `400` (R-07): the body is valid JSON that breaks
the contract. `400` is reserved for unparseable bodies and invalid Pub/Sub envelopes (so they
dead-letter).

`type` is `https://aforo.dev/errors/<code in kebab-case>`. `title` is fixed per code;
`detail` is free text for humans and **must never** be parsed by clients.

## Service-to-service calls
- Cloud Run private with IAM: the caller requests a Google OIDC ID token for the target URL and
  sends it in `Authorization`.
- When running a service locally against cloud dependencies, `AUTH_MODE=dev` accepts a fake token
  carrying the `userId` you pass.
- Timeouts on every outgoing call (default connect 0.5 s, response 2 s).

## Health
- `GET /health/live`: the process answers. `GET /health/ready`: DB and dependencies ready.
- Cloud Run startup and liveness probes call `/health/live` only, so a service deploys and boots
  even when its DB or Redis is off (ADR-0004). Smoke tests check `/health/ready`.
- Never require authentication. Response: `{ "status": "ok" }` or `503` with the failing check.

## Formats
- Dates: ISO-8601 in UTC (`2026-10-01T19:00:00Z`).
- Money: integer cents + `currency: "COP"`. Never decimals.
- Identifiers: UUID v4 as string.
- Paginated lists: `?page=&size=` (page is 0-based) → `{ items, page, size, total }`.
- JSON field names: `camelCase`. Enum values: `UPPER_SNAKE_CASE`. DB columns: `snake_case`.

## Logs
- One JSON line per request with `severity`, `correlationId`, `userId`, `route`, `status`,
  `latencyMs`. Cloud Logging indexes them without extra config.
- Log `queuePass` when `X-Queue-Pass` is present. Never log tokens, secrets or full request bodies.

## Asynchronous messaging
Envelope, topics, outbox and inbox rules: [events/README.md](events/README.md).
