/**
 * Single import point for @aforo/common (owner: Juan Jose). The package has no code yet, so the
 * names below are ASSUMED from packages/common/README.md. When it lands, fix naming drift here.
 *
 * Assumed contracts (ports the service implements against our own Postgres tables):
 *  - HttpClient.request({ method, url, headers, body }) -> { status, body }; throws HttpTransportError
 *    (kind: 'connect_timeout' | 'response_timeout' | 'network') and applies the default timeouts.
 *  - ServiceAuthClient.header(audience, userId?) -> { authorization } (OIDC ID token, fake in dev).
 *  - OUTBOX_STORE port: findPending(limit) / markPublished(id), consumed by OutboxPublisher.flush().
 *  - IDEMPOTENCY_REPOSITORY port: find(key) / save(record), consumed by IdempotencyInterceptor.
 *  - HousekeepingModule.forRoot({ imports, sweeps }): POST /internal/v1/housekeeping; flushes the
 *    outbox and runs each sweep ({ name, run() }).
 *  - PubSubPushGuard + @PushEnvelope(): decode the push body, 400 on an invalid envelope.
 */
export { DomainError, HttpClient, HttpTransportError, buildEnvelope } from '@aforo/common';
export type { ErrorCode, EventEnvelope } from '@aforo/common';
export {
  CorrelationMiddleware,
  CurrentUser,
  HealthModule,
  HousekeepingModule,
  IDEMPOTENCY_REPOSITORY,
  IdempotencyInterceptor,
  JsonLogger,
  OUTBOX_STORE,
  OutboxModule,
  OutboxPublisher,
  ProblemJsonFilter,
  PubSubPushGuard,
  PushEnvelope,
  RequestLogInterceptor,
  ServiceAuthClient,
  ShutdownModule,
  getCorrelationId,
  installGracefulShutdown,
} from '@aforo/common/nest';
export type {
  HousekeepingSweep,
  IdempotencyRecord,
  IdempotencyRepository,
  OutboxMessage,
  OutboxStore,
} from '@aforo/common/nest';
