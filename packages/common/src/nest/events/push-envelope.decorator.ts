import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { adoptCorrelationId } from "../../core/correlation/correlation-context";
import { parsePushEnvelope, type EventEnvelope, type EventType } from "../../core/envelope/envelope";

/**
 * Decodes and validates a Pub/Sub push body as an envelope of `type`, then makes the envelope's
 * correlation ID the request's, so this request's logs join the purchase that produced the fact.
 * Throws MALFORMED_REQUEST (400) on anything invalid, so the message dead-letters.
 */
export function pushEnvelopeFrom<T>(body: unknown, type: EventType): EventEnvelope<T> {
  const envelope = parsePushEnvelope<T>(body, type);
  adoptCorrelationId(envelope.correlationId);
  return envelope;
}

/** `@PushEnvelope("ReservationExpired") envelope: EventEnvelope<ReservationExpiredData>` */
export const PushEnvelope = createParamDecorator((type: EventType, context: ExecutionContext): EventEnvelope =>
  pushEnvelopeFrom(context.switchToHttp().getRequest<{ body: unknown }>().body, type),
);
