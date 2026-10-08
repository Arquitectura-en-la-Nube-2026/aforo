# @aforo/common

> Owner: Juan José · Status: every module in the table implemented

Shared NestJS library for the behaviors in `contracts/conventions.md`. Implemented: the error
catalog/filter, correlation context, structured request logging, live/readiness health module,
the event `envelope` (validates the Pub/Sub push body, the envelope and its `data` against the
contract schemas; `buildEnvelope` for producers), the `inbox` helper (`consumeOnce`), `shutdown`
(`ShutdownService`), `auth` (`@CurrentUser()`, `ServiceAuthClient`), `idempotency`
(`IdempotencyInterceptor`), `outbox` (`OutboxPublisher` over Pub/Sub REST), `housekeeping`
(`HousekeepingModule`), `http` (`HttpClient`) and `@PushEnvelope()` for push endpoints.

## Wiring a producer service (catalog, inventory, orders)

```ts
// A @Global module of the service exports its table adapters under the common tokens.
{ provide: OUTBOX_STORE, useExisting: OutboxRepository },            // implements OutboxStore
{ provide: IDEMPOTENCY_REPOSITORY, useExisting: IdempotencyKeyRepository }, // implements IdempotencyRepository

// AppModule imports:
OutboxModule.forRoot({ projectId: process.env.GCP_PROJECT_ID! }),
HousekeepingModule.forRoot({ imports: [ReservationsModule], sweeps: [ExpireSweep] }),

// State-changing route:
@Post() @UseInterceptors(IdempotencyInterceptor)
create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateDto) { ... }

// In the service: write the fact in the business transaction, flush after the commit.
await tx.outbox.add(topic, buildEnvelope({ type: "ReservationExpired", producer: "inventory", data }));
await this.outboxPublisher.flush();

// Push endpoint:
@Post("internal/v1/events/orders-reservation-expired") @HttpCode(204)
onExpired(@PushEnvelope("ReservationExpired") envelope: EventEnvelope<ReservationExpiredData>) { ... }
```

Behaviors to know:

- **Outbox** publishes in order and stops at the first failure (that row and the rest stay pending
  for housekeeping). Delivery is at-least-once; consumers deduplicate by `messageId`. Each message
  carries `type` and `correlationId` as Pub/Sub attributes too. `PUBSUB_EMULATOR_HOST` switches it
  to the emulator without auth.
- **Idempotency** stores only successful responses, and the fingerprint covers method, path,
  buyer and body: the same key from another buyer or endpoint is `409 IDEMPOTENCY_CONFLICT`. It is
  a cache, not a lock — two concurrent first calls both run, so the business transaction must be
  safe under duplicates anyway (unique constraints, conditional updates).
- **Housekeeping** runs every sweep even if one fails, then flushes the outbox, and answers `500`
  if anything failed so Cloud Scheduler records it.
- **`@PushEnvelope(type)`** answers `400` on an invalid message (it dead-letters) and makes the
  envelope's `correlationId` the request's, so the consumer's logs join the purchase (E-05).
- **`ServiceAuthClient.header(audience)`**: use the target's custom audience `aforo-<service>`,
  which is also valid on revision tag URLs. `AUTH_MODE=dev` sends no header.

The event schemas are copied from `contracts/events` into `src/core/envelope/event-schemas.generated.ts`
by `npm run gen:events`; a test fails when the copy drifts from the contract.

Request logs use Cloud Run's `K_SERVICE` as the service name. Local runs can set `SERVICE_NAME`;
when neither exists, logs use `unknown` instead of attributing them to another service.

## What it must export

| Module | Provides | Used by |
| ------ | -------- | ------- |
| `errors` | `DomainError(code, detail)`, error-code catalog (mirrors `ErrorCode` in the contract), global `ProblemJsonFilter` | all |
| `correlation` | Middleware reading/generating `X-Correlation-Id`, async-local context, HTTP client that forwards it | all |
| `logging` | JSON logger with `severity`, `correlationId`, `userId`, `route`, `status`, `latencyMs`; request-log middleware; `JsonLogger` for `app.useLogger()` (object messages become fields, e.g. `jsonPayload.event`) | all |
| `auth` | `@CurrentUser()` decorator reading `X-User-Id`/`X-User-Email`; Google ID-token client for service calls; `AUTH_MODE=dev` fake token | all |
| `idempotency` | Interceptor + repository port storing key, SHA-256 of the body, status and response; returns the stored response on repeat with `Idempotent-Replayed: true` (R-06); `IDEMPOTENCY_CONFLICT` on a different body | catalog, orders, inventory |
| `envelope` | `EventEnvelope<T>` type, builder, and the four event type names + payload types (generated from `contracts/events/*.schema.json`) | all producers/consumers |
| `outbox` | Outbox table definition, `OutboxWriter` (inside the business transaction), `OutboxPublisher.flush()` (called after commit and by housekeeping; publishes pending rows to Pub/Sub with `type` and `correlationId` attributes). **No poller** (ADR-0002) | catalog, orders, inventory |
| `housekeeping` | Controller for `POST /internal/v1/housekeeping` that flushes the outbox and runs the sweeps each service registers | catalog, orders, inventory |
| `inbox` | `consumeOnce(store, messageId, effect)` inserts the inbox row and applies the effect in the same database transaction. The service supplies a transactional `InboxStore` with a unique `message_id`; the effect receives and uses that transaction. Queue must use an atomic Redis Lua script instead. `parsePushEnvelope` rejects invalid push messages with `400` | orders, inventory; queue uses the envelope and needs an atomic Redis script |
| `health` | `HealthModule` exposing `/health/live` (process only; used by Cloud Run probes) and `/health/ready` (pluggable dependency checks) | all |
| `http` | Outgoing HTTP client with default timeouts (connect 0.5 s, response 2 s) and problem+json error mapping | orders, gateway |
| `shutdown` | `ShutdownService`: readiness flips to 503 on `SIGTERM`, `onDrain` hooks close SSE streams before the HTTP server stops, `onClose` hooks close pools after the last request, and `event=shutdown` is logged with `durationMs`. Needs `app.enableShutdownHooks()` | all services |

## Inbox transaction boundary

The database adapter's `transaction` must commit only when its callback succeeds and roll back on
error. Its `insertIfAbsent` must use a unique `message_id` (for example `INSERT ... ON CONFLICT DO
NOTHING RETURNING message_id`). The effect must use the transaction argument passed to it; using a
separate connection would reopen the crash window. Only return 2xx to Pub/Sub after the transaction
commits. Queue's Redis projection and inbox key must be updated together in one Lua script; separate
`EXISTS`, projection and `SET` commands do not satisfy the event contract.

## Rules

- No business logic of any service lives here.
- Keep the DB layer pluggable (a port) so each service picks its own driver/ORM.
- **Two entry points**: `@aforo/common` (framework-agnostic core: `errors`, `envelope`, `logging`
  core, `http`) and `@aforo/common/nest` (Nest modules, interceptors, filters). The functions import
  only the core so their cold start stays small.
- Breaking changes after the freeze (Tue Sept 29) are announced like contract changes.
- Due: Tue Sept 29.

## Layout

```
src/
  core/          errors/ envelope/ logging/ http/        (no Nest dependency)
  nest/          correlation/ auth/ idempotency/ outbox/ inbox/ housekeeping/ health/ shutdown/
  index.ts       exports core
  nest.ts        exports nest
test/
```
