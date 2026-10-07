// Pure logic: turn a dead-lettered Pub/Sub message into the fields of one log line.
// Tolerates anything, because a poison message is exactly what lands here.

export interface PubSubMessage {
  data?: string;
  attributes?: Record<string, string>;
  messageId?: string;
}

export interface DeadLetterFields {
  event: "dead_letter";
  subscription: string | null;
  deliveryAttempt: number | null;
  type: string | null;
  messageId: string | null;
  correlationId: string | null;
  producer: string | null;
  pubsubMessageId: string | null;
  validEnvelope: boolean;
}

function parseEnvelope(data: string | undefined): Record<string, unknown> | null {
  if (!data) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function describeDeadLetter(message: PubSubMessage): DeadLetterFields {
  const attributes = message.attributes ?? {};
  const envelope = parseEnvelope(message.data);
  const attempts = Number(attributes.CloudPubSubDeadLetterSourceDeliveryCount);

  return {
    event: "dead_letter",
    // Pub/Sub adds these attributes when it dead-letters a message.
    subscription: text(attributes.CloudPubSubDeadLetterSourceSubscription),
    deliveryAttempt: Number.isFinite(attempts) && attempts > 0 ? attempts : null,
    // Envelope first; the producer also sets type and correlationId as attributes.
    type: text(envelope?.type) ?? text(attributes.type),
    messageId: text(envelope?.messageId),
    correlationId: text(envelope?.correlationId) ?? text(attributes.correlationId),
    producer: text(envelope?.producer),
    pubsubMessageId: text(message.messageId),
    validEnvelope: envelope !== null && text(envelope.type) !== null && text(envelope.messageId) !== null,
  };
}
