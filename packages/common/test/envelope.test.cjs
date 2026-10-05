const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { DomainError, decodePushBody, parseEnvelope, parsePushEnvelope } = require("../dist");
const { envelopeSchema, payloadSchemas } = require("../dist/core/envelope/event-schemas.generated");

const eventId = "8f1b2c3d-0000-4000-8000-000000000001";

function envelope(overrides = {}) {
  return {
    messageId: "1f7c0f0e-0000-4000-8000-000000000001",
    type: "EventPublished",
    version: 1,
    occurredAt: "2026-10-01T15:04:11Z",
    correlationId: "6f1c0f0e-0000-4000-8000-000000000002",
    producer: "catalog",
    data: {
      eventId,
      name: "Festival Estéreo 2026",
      salesOpensAt: "2026-10-01T15:00:00Z",
      salesClosesAt: "2026-11-14T20:00:00Z",
      sectors: [
        {
          sectorId: "a1a1a1a1-0000-4000-8000-000000000001",
          name: "General",
          capacity: 500,
          priceCents: 18000000,
          currency: "COP",
        },
      ],
    },
    ...overrides,
  };
}

function pushBody(message) {
  return {
    subscription: "projects/aforo-dev/subscriptions/queue-event-published",
    message: { messageId: "123", data: Buffer.from(JSON.stringify(message)).toString("base64") },
  };
}

function assertMalformed(action, pattern) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof DomainError, "must be a DomainError");
    assert.equal(error.code, "MALFORMED_REQUEST");
    assert.equal(error.status, 400);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

test("a valid Pub/Sub push body yields the envelope with its typed data", () => {
  const result = parsePushEnvelope(pushBody(envelope()), "EventPublished");
  assert.equal(result.messageId, "1f7c0f0e-0000-4000-8000-000000000001");
  assert.equal(result.data.eventId, eventId);
});

test("an envelope with empty data is rejected: the envelope schema alone would accept it", () => {
  // envelope.schema.json only requires `data` to be an object. EventPublished.v1 requires
  // eventId, name, salesOpensAt, salesClosesAt and sectors, so {} must not get through.
  assertMalformed(() => parsePushEnvelope(pushBody(envelope({ data: {} })), "EventPublished"), /Invalid EventPublished data/);
});

test("a payload that breaks its own schema is rejected", () => {
  const data = envelope().data;
  assertMalformed(
    () => parsePushEnvelope(pushBody(envelope({ data: { ...data, sectors: [] } })), "EventPublished"),
    /sectors/,
  );
  assertMalformed(
    () => parsePushEnvelope(pushBody(envelope({ data: { ...data, eventId: "not-a-uuid" } })), "EventPublished"),
    /eventId/,
  );
});

test("a valid envelope of another type is rejected by the endpoint that expects one", () => {
  // The queue-sales-rules endpoint must not accept an EventPublished message.
  assertMalformed(() => parsePushEnvelope(pushBody(envelope()), "SalesRulesConfigured"), /Expected SalesRulesConfigured/);
});

test("SalesRulesConfigured validates its own payload", () => {
  const rules = envelope({
    type: "SalesRulesConfigured",
    data: { eventId, maxTicketsPerPerson: 4, reservationTtlSeconds: 480, openingWindowSeconds: 30 },
  });
  assert.equal(parsePushEnvelope(pushBody(rules), "SalesRulesConfigured").data.openingWindowSeconds, 30);
  const tooShort = envelope({
    type: "SalesRulesConfigured",
    data: { eventId, maxTicketsPerPerson: 4, reservationTtlSeconds: 10, openingWindowSeconds: 30 },
  });
  assertMalformed(() => parsePushEnvelope(pushBody(tooShort), "SalesRulesConfigured"), /reservationTtlSeconds/);
});

test("an unknown version, a missing field and an extra field are rejected", () => {
  assertMalformed(() => parseEnvelope(envelope({ version: 2 }), "EventPublished"), /Unsupported EventPublished version 2/);
  const { messageId: _omitted, ...withoutMessageId } = envelope();
  assertMalformed(() => parseEnvelope(withoutMessageId, "EventPublished"), /messageId/);
  assertMalformed(() => parseEnvelope(envelope({ extra: true }), "EventPublished"), /additional properties/);
});

test("a body that is not a push request, not base64 JSON or not an object is rejected", () => {
  assertMalformed(() => decodePushBody(undefined), /not a Pub\/Sub push request/);
  assertMalformed(() => decodePushBody({ message: {} }), /not a Pub\/Sub push request/);
  assertMalformed(() => decodePushBody({ message: { data: 123 } }), /not a Pub\/Sub push request/);
  assertMalformed(
    () => decodePushBody({ message: { data: Buffer.from("not json {").toString("base64") } }),
    /not base64 JSON/,
  );
  assertMalformed(() => parsePushEnvelope(pushBody([1, 2]), "EventPublished"), /Invalid envelope/);
});

test("the error detail stays short even when many fields fail", () => {
  try {
    parseEnvelope({ type: 1, version: "x", data: 5 }, "EventPublished");
    assert.fail("must throw");
  } catch (error) {
    assert.ok(error.message.length <= "Invalid envelope: ".length + 300);
  }
});

test("the generated schemas match contracts/events (run npm run gen:events when a contract changes)", () => {
  const contracts = join(__dirname, "..", "..", "..", "contracts", "events");
  const read = (file) => JSON.parse(readFileSync(join(contracts, file), "utf8"));
  assert.deepEqual(envelopeSchema, read("envelope.schema.json"));
  assert.deepEqual(payloadSchemas["EventPublished.v1"], read("event-published.v1.schema.json"));
  assert.deepEqual(payloadSchemas["SalesRulesConfigured.v1"], read("sales-rules-configured.v1.schema.json"));
  assert.deepEqual(payloadSchemas["ReservationExpired.v1"], read("reservation-expired.v1.schema.json"));
  assert.deepEqual(payloadSchemas["OrderPaid.v1"], read("order-paid.v1.schema.json"));
});
