import { randomUUID } from "node:crypto";
import { getCorrelationId } from "../correlation/correlation-context";
import type { EventEnvelope, EventProducer, EventType } from "./envelope";

export interface BuildEnvelopeInput<T> {
  type: EventType;
  producer: EventProducer;
  data: T;
  /** Defaults to the current request's correlation ID, so the fact can be followed across the bus. */
  correlationId?: string;
  version?: number;
  occurredAt?: Date;
}

/** A new envelope with a fresh messageId (contracts/events/envelope.schema.json). */
export function buildEnvelope<T>(input: BuildEnvelopeInput<T>): EventEnvelope<T> {
  return {
    messageId: randomUUID(),
    type: input.type,
    version: input.version ?? 1,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    correlationId: input.correlationId ?? getCorrelationId() ?? randomUUID(),
    producer: input.producer,
    data: input.data,
  };
}
