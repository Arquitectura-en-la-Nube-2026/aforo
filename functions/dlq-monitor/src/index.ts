import { cloudEvent, type CloudEvent } from "@google-cloud/functions-framework";
import { StructuredLogger } from "@aforo/common";
import { describeDeadLetter, type PubSubMessage } from "./dead-letter.ts";

const logger = new StructuredLogger("dlq-monitor");

interface MessagePublishedData {
  message?: PubSubMessage;
}

// One ERROR line per dead-lettered message, then return (ack). Never re-publishes.
// The log-based metric on event=dead_letter drives the alert (infra/, E-05).
cloudEvent<MessagePublishedData>("dlqMonitor", (event: CloudEvent<MessagePublishedData>) => {
  const fields = describeDeadLetter(event.data?.message ?? {});
  logger.write("ERROR", "Message dead-lettered", {
    ...fields,
    correlationId: fields.correlationId ?? undefined,
    dlqTopic: event.source ?? null,
  });
});
