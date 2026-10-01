/** Test-only stand-in for @aforo/common until the real package exists (see src/common.ts). */
import { randomUUID } from 'node:crypto';

export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly detail: string,
  ) {
    super(detail);
  }
}

export class HttpTransportError extends Error {
  constructor(
    readonly kind: string,
    message: string,
  ) {
    super(message);
  }
}

export const buildEnvelope = (p: { type: string; producer: string; correlationId: string; data: unknown }) => ({
  messageId: randomUUID(),
  version: 1,
  occurredAt: new Date().toISOString(),
  ...p,
});

export class OutboxPublisher {
  async flush(): Promise<void> {}
}
export class ServiceAuthClient {}
export const getCorrelationId = () => undefined;
