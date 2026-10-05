# @aforo/common

> Owner: Juan José · Status: initial foundation implemented

Shared NestJS library for the behaviors in `contracts/conventions.md`. Implemented: the error
catalog/filter, correlation context, structured request logging, live/readiness health module,
the event `envelope` (validates the Pub/Sub push body, the envelope and its `data` against the
contract schemas), the `inbox` helper (`consumeOnce`) and `shutdown` (`ShutdownService`). The
rest of the table remains planned.

The event schemas are copied from `contracts/events` into `src/core/envelope/event-schemas.generated.ts`
by `npm run gen:events`; a test fails when the copy drifts from the contract.

Request logs use Cloud Run's `K_SERVICE` as the service name. Local runs can set `SERVICE_NAME`;
when neither exists, logs use `unknown` instead of attributing them to another service.

## What it must export

| Module | Provides | Used by |
| ------ | -------- | ------- |
| `errors` | `DomainError(code, detail)`, error-code catalog (mirrors `ErrorCode` in the contract), global `ProblemJsonFilter` | all |
| `correlation` | Middleware reading/generating `X-Correlation-Id`, async-local context, HTTP client that forwards it | all |
| `logging` | JSON logger with `severity`, `correlationId`, `userId`, `route`, `status`, `latencyMs`; request-log middleware | all |
| `auth` | `@CurrentUser()` decorator reading `X-User-Id`/`X-User-Email`; Google ID-token client for service calls; `AUTH_MODE=dev` fake token | all |
| `idempotency` | Interceptor + repository port storing key, SHA-256 of the body, status and response; returns the stored response on repeat with `Idempotent-Replayed: true` (R-06); `IDEMPOTENCY_CONFLICT` on a different body | catalog, orders, inventory |
| `envelope` | `EventEnvelope<T>` type, builder, and the four event type names + payload types (generated from `contracts/events/*.schema.json`) | all producers/consumers |
| `outbox` | Outbox table definition, `OutboxWriter` (inside the business transaction), `OutboxPublisher.flush()` (called after commit and by housekeeping; publishes pending rows to Pub/Sub with `type` and `correlationId` attributes). **No poller** (ADR-0002) | catalog, orders, inventory |
| `housekeeping` | Controller for `POST /internal/v1/housekeeping` that flushes the outbox and runs the sweeps each service registers | catalog, orders, inventory |
| `inbox` | `consumeOnce(store, messageId, effect)`: applies an idempotent effect once per `messageId`, marking the inbox after the effect (so a crash never drops an event). With `parsePushEnvelope` (`envelope`) it answers `400` to an invalid push body or envelope (so it dead-letters). Each service supplies its own `InboxStore` | queue, orders, inventory |
| `health` | `HealthModule` exposing `/health/live` (process only; used by Cloud Run probes) and `/health/ready` (pluggable dependency checks) | all |
| `http` | Outgoing HTTP client with default timeouts (connect 0.5 s, response 2 s) and problem+json error mapping | orders, gateway |
| `shutdown` | `ShutdownService`: readiness flips to 503 on `SIGTERM`, `onDrain` hooks close SSE streams before the HTTP server stops, `onClose` hooks close pools after the last request, and `event=shutdown` is logged with `durationMs`. Needs `app.enableShutdownHooks()` | all services |

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
