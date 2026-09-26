---
paths:
  - "services/**"
---

# Backend service rules (NestJS, Node 24, TypeScript)

Normative cross-service rules are in `contracts/conventions.md`. This file is how we apply them
in code so all five services look the same.

## Layout
```
services/<name>/
  src/
    main.ts                 bootstrap: logger, correlation, problem+json filter from @aforo/common
    app.module.ts
    config/                 typed env config; fail fast on missing variables
    health/                 GET /health/live, GET /health/ready (from @aforo/common)
    <domain>/               one Nest module per aggregate: controller, service, repository, dto
    messaging/              outbox publisher, push-subscription controllers (inbox)
  migrations/               SQL migrations (Postgres services only)
  test/                     unit + service-level tests
  Dockerfile
  .env.example
  README.md                 the service spec — keep it current
```

## Must
- Controllers are thin: validate the DTO, call a service, map the result. No SQL, no Pub/Sub in
  controllers.
- Validate every request body and params against the contract (class-validator DTOs mirroring
  the OpenAPI schema). Invalid input → `422 VALIDATION_ERROR`.
- Throw typed errors from `@aforo/common` (`new DomainError('SOLD_OUT', …)`); a global filter
  renders `application/problem+json` with `correlationId`.
- Use the `@aforo/common` idempotency interceptor on every state-changing public or internal
  endpoint; persist key + SHA-256 of the body + status + response in the `idempotency_key` table.
  A replay returns the stored status and body with `Idempotent-Replayed: true` (R-06).
- Trust `X-User-Id` / `X-User-Email` from the Gateway. Never decode the user JWT in a service.
- Log `X-Queue-Pass` when present; never validate it (D-07).
- Forward `X-Correlation-Id` on every outgoing HTTP call and put it in every event envelope.
- Write events to the `outbox` table **in the same DB transaction** as the state change. After
  the commit and **before responding**, call `OutboxPublisher.flush()` from `@aforo/common`.
  Anything left unpublished is shipped by housekeeping (ADR-0002).
- **No work outside a request** (ADR-0002). Cloud Run throttles CPU between requests: no
  `setInterval`, no pollers, no "respond now, process later". Periodic work goes in
  `POST /internal/v1/housekeeping` (Postgres services), called every minute by Cloud Scheduler;
  it must be idempotent. Only `queue` runs an in-process timer (admission), guarded by a Redis lock.
- Push consumers: a body that is not a valid envelope → `400` (so it dead-letters, never `2xx`).
  Otherwise insert `messageId` in `inbox` **in the same transaction as the effect**, skip
  duplicates, return 2xx only after the commit. Handlers must be safe to run twice.
- Outgoing HTTP calls always have a timeout (default: connect 0.5 s, response 2 s).
- **Stateless**: no in-memory state that must survive a request or be shared between instances
  (sessions, queues, caches of truth). Durable state goes to Postgres or Redis. In-memory caches
  are allowed only for data that can be rebuilt (e.g. config).
- **Graceful shutdown** (Cloud Run sends `SIGTERM` and allows ~10 s): `app.enableShutdownHooks()`;
  on shutdown stop accepting requests, let in-flight requests finish (including their outbox
  flush), close SSE streams (the client reconnects), close DB/Redis pools. Use
  the `shutdown` helpers from `@aforo/common`. Log `event=shutdown` with the duration.
- `/health/ready` returns 503 while shutting down or while a dependency (DB, Redis) is down.
  `/health/live` only says the process answers: it is what Cloud Run's startup and liveness
  probes call, so a service **must boot without its DB or Redis** (connect lazily, retry)
  (ADR-0004).
- DB pool size comes from `DB_POOL_MAX` (budget in ADR-0005; `1` when running locally against
  dev) with an acquire timeout; never open connections outside the pool.
- Service-to-service calls use a Google OIDC ID token for the target URL.
  `AUTH_MODE=dev` accepts a fake token so you can run locally against cloud dependencies.
- Config only from environment variables; document each one in `.env.example` and the README.

## Must not
- Read or write another service's database or Redis keys.
- Call Catalog on the critical path (Queue and Inventory use their own projections).
- Publish to Pub/Sub directly. The only publisher is `OutboxPublisher.flush()`, which reads
  committed outbox rows.
- Use floats for money or local-time dates.

## Tests
- Unit tests for domain rules, plus at least one test proving a repeated `Idempotency-Key`
  returns the same status and body.
- Name tests after the behavior: `it('returns 409 SOLD_OUT and does not decrement when …')`.
