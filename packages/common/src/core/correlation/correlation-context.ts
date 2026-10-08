import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface CorrelationStore {
  correlationId: string;
  userId?: string;
}

const context = new AsyncLocalStorage<CorrelationStore>();
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeCorrelationId(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && uuidV4Pattern.test(candidate) ? candidate : randomUUID();
}

export function runWithCorrelation<T>(store: CorrelationStore, callback: () => T): T {
  return context.run(store, callback);
}

export function getCorrelationStore(): CorrelationStore | undefined {
  return context.getStore();
}

export function getCorrelationId(): string | undefined {
  return context.getStore()?.correlationId;
}

/**
 * Replaces the current context's correlation ID. For Pub/Sub push requests, which carry the ID in the
 * envelope instead of a header: logs then follow the purchase across the bus (E-05).
 */
export function adoptCorrelationId(value: string): void {
  const store = context.getStore();
  if (store && uuidV4Pattern.test(value)) store.correlationId = value;
}

export function setCorrelationUserId(userId: string): void {
  const store = context.getStore();
  if (store) store.userId = userId;
}
