/**
 * Single import point for @aforo/common (owner: Juan Jose): the framework-agnostic core from
 * `@aforo/common`, the Nest pieces from `@aforo/common/nest`. Ports the service implements against
 * its own Postgres tables: OutboxStore (OUTBOX_STORE) and IdempotencyRepository
 * (IDEMPOTENCY_REPOSITORY), see messaging/repositories.ts.
 */
export {
  DomainError,
  HttpClient,
  HttpTransportError,
  OutboxPublisher,
  ServiceAuthClient,
  buildEnvelope,
  getCorrelationId,
} from '@aforo/common';
export type {
  ErrorCode,
  EventEnvelope,
  IdempotencyRecord,
  IdempotencyRepository,
  OutboxMessage,
  OutboxStore,
  ReservationExpiredData,
} from '@aforo/common';
export {
  CorrelationMiddleware,
  CurrentUser,
  HealthModule,
  HealthService,
  HousekeepingModule,
  IDEMPOTENCY_REPOSITORY,
  IdempotencyInterceptor,
  JsonLogger,
  OUTBOX_STORE,
  OutboxModule,
  ProblemJsonFilter,
  PushEnvelope,
  RequestLoggingMiddleware,
  ShutdownModule,
} from '@aforo/common/nest';
export type { HousekeepingSweep, JsonLogLevel } from '@aforo/common/nest';
