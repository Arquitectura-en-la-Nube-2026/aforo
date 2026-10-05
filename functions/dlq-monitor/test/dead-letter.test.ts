import { test } from "node:test";
import assert from "node:assert/strict";
import { describeDeadLetter } from "../src/dead-letter.ts";

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64");

const deadLetterAttributes = {
  CloudPubSubDeadLetterSourceSubscription: "inventory-event-published",
  CloudPubSubDeadLetterSourceDeliveryCount: "5",
};

test("valid envelope: fields come from the envelope and the dead-letter attributes", () => {
  const fields = describeDeadLetter({
    messageId: "123",
    attributes: deadLetterAttributes,
    data: encode({
      messageId: "1f7c0000-0000-4000-8000-000000000001",
      type: "EventPublished",
      version: 1,
      correlationId: "6f1c0000-0000-4000-8000-000000000002",
      producer: "catalog",
      data: {},
    }),
  });

  assert.deepEqual(fields, {
    event: "dead_letter",
    subscription: "inventory-event-published",
    deliveryAttempt: 5,
    type: "EventPublished",
    messageId: "1f7c0000-0000-4000-8000-000000000001",
    correlationId: "6f1c0000-0000-4000-8000-000000000002",
    producer: "catalog",
    pubsubMessageId: "123",
    validEnvelope: true,
  });
});

test("poison message (not JSON): still described, falls back to attributes", () => {
  const fields = describeDeadLetter({
    messageId: "124",
    attributes: { ...deadLetterAttributes, correlationId: "abc", type: "EventPublished" },
    data: Buffer.from("not-an-envelope").toString("base64"),
  });

  assert.equal(fields.validEnvelope, false);
  assert.equal(fields.subscription, "inventory-event-published");
  assert.equal(fields.correlationId, "abc");
  assert.equal(fields.type, "EventPublished");
  assert.equal(fields.messageId, null);
});

test("empty message: no throw, everything null", () => {
  const fields = describeDeadLetter({});

  assert.equal(fields.event, "dead_letter");
  assert.equal(fields.subscription, null);
  assert.equal(fields.deliveryAttempt, null);
  assert.equal(fields.validEnvelope, false);
});

test("JSON that is not an object is not an envelope", () => {
  assert.equal(describeDeadLetter({ data: encode([1, 2]) }).validEnvelope, false);
  assert.equal(describeDeadLetter({ data: encode("text") }).validEnvelope, false);
});
