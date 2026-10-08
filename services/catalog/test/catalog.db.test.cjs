// Catalog against a real Postgres (see helpers.cjs). Skipped without TEST_DATABASE_URL.
const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { parseEnvelope } = require("@aforo/common");
const h = require("./helpers.cjs");

const skip = h.skipReason();
let pubsub;
let app;
let inject;

before(async () => {
  if (skip) return;
  await h.resetDatabase();
  pubsub = await h.startPubSub();
  ({ app, inject } = await h.startApp({ pubsubHost: pubsub.host }));
});

after(async () => {
  if (skip) return;
  await app.close();
  await pubsub.close();
});

const dbTest = (name, fn) => test(name, { skip: skip ?? false }, fn);

async function createDraft(overrides) {
  const response = await h.organizer(inject, "POST", "/api/v1/events", h.newEvent(overrides));
  assert.equal(response.statusCode, 201, response.body);
  return response.json();
}

async function publishedEvent(overrides) {
  const draft = await createDraft(overrides);
  assert.equal((await h.organizer(inject, "PUT", `/api/v1/events/${draft.id}/sales-rules`, h.RULES)).statusCode, 200);
  const published = await h.organizer(inject, "POST", `/api/v1/events/${draft.id}/publish`);
  assert.equal(published.statusCode, 200, published.body);
  return published.json();
}

const factsFor = (eventId) => pubsub.published.filter((m) => m.data.data.eventId === eventId);

dbTest("create answers 201 with a DRAFT of the contract's shape and emits nothing", async () => {
  const before = pubsub.published.length;
  const event = await createDraft();
  assert.deepEqual(Object.keys(event).sort(), [
    "id", "name", "saleState", "salesClosesAt", "salesOpensAt", "salesRules", "sectors", "startsAt", "status", "venue",
  ]);
  assert.equal(event.status, "DRAFT");
  assert.equal(event.saleState, "OPEN");
  assert.equal(event.salesRules, null);
  assert.match(event.startsAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
  assert.deepEqual(
    event.sectors.map(({ name, capacity, priceCents, currency }) => ({ name, capacity, priceCents, currency })),
    [
      { name: "General", capacity: 500, priceCents: 18000000, currency: "COP" },
      { name: "VIP", capacity: 50, priceCents: 45000000, currency: "COP" },
    ],
  );
  assert.equal(new Set(event.sectors.map((s) => s.id)).size, 2);
  assert.deepEqual((await inject({ method: "GET", url: `/api/v1/events/${event.id}` })).json(), event);
  assert.equal(pubsub.published.length, before);
  assert.deepEqual(await h.sql("SELECT count(*)::int AS n FROM outbox WHERE event_id = $1", [event.id]), [{ n: 0 }]);
});

dbTest("a repeated Idempotency-Key returns the same status and body; another body with it is 409", async () => {
  const key = randomUUID();
  const body = h.newEvent({ name: "Replayed" });
  const first = await h.organizer(inject, "POST", "/api/v1/events", body, { key });
  const replay = await h.organizer(inject, "POST", "/api/v1/events", body, { key });
  assert.equal(first.statusCode, 201);
  assert.equal(replay.statusCode, 201);
  assert.equal(replay.body, first.body, "byte for byte");
  assert.equal(replay.headers["idempotent-replayed"], "true");
  assert.equal(first.headers["idempotent-replayed"], undefined);
  assert.deepEqual(await h.sql("SELECT count(*)::int AS n FROM event WHERE name = 'Replayed'"), [{ n: 1 }]);

  const conflict = await h.organizer(inject, "POST", "/api/v1/events", h.newEvent({ name: "Other" }), { key });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().code, "IDEMPOTENCY_CONFLICT");
});

dbTest("a retry the idempotency cache misses still creates one event (concurrent, or the key row lost)", async () => {
  const key = randomUUID();
  const body = h.newEvent({ name: "Raced" });
  const [a, b] = await Promise.all([
    h.organizer(inject, "POST", "/api/v1/events", body, { key }),
    h.organizer(inject, "POST", "/api/v1/events", body, { key }),
  ]);
  assert.equal(a.statusCode, 201, a.body);
  assert.equal(b.statusCode, 201, b.body);
  assert.deepEqual(b.json(), a.json());

  await h.sql("DELETE FROM idempotency_key WHERE key = $1", [key]);
  const retry = await h.organizer(inject, "POST", "/api/v1/events", body, { key });
  assert.equal(retry.statusCode, 201, retry.body);
  assert.deepEqual(retry.json(), a.json());
  assert.deepEqual(await h.sql("SELECT count(*)::int AS n FROM event WHERE name = 'Raced'"), [{ n: 1 }]);
  assert.deepEqual(await h.sql("SELECT count(*)::int AS n FROM sector WHERE event_id = $1", [a.json().id]), [{ n: 2 }]);
});

dbTest("changes need X-User-Id (401) and an Idempotency-Key (422); bad bodies are 422 or 400", async () => {
  const noUser = await inject({
    method: "POST",
    url: "/api/v1/events",
    payload: h.newEvent(),
    headers: { "idempotency-key": randomUUID() },
  });
  assert.equal(noUser.statusCode, 401);
  assert.equal(noUser.json().code, "UNAUTHENTICATED");

  const noKey = await inject({
    method: "POST",
    url: "/api/v1/events",
    payload: h.newEvent(),
    headers: { "x-user-id": h.ORGANIZER },
  });
  assert.equal(noKey.statusCode, 422);
  assert.deepEqual(noKey.json().errors.map((e) => e.field), ["Idempotency-Key"]);

  const invalid = await h.organizer(inject, "POST", "/api/v1/events", h.newEvent({ sectors: [] }));
  assert.equal(invalid.statusCode, 422);
  assert.match(invalid.headers["content-type"], /^application\/problem\+json/);
  assert.equal(invalid.json().code, "VALIDATION_ERROR");
  assert.deepEqual(invalid.json().errors.map((e) => e.field), ["sectors"]);

  const malformed = await inject({
    method: "POST",
    url: "/api/v1/events",
    payload: "{not json",
    headers: { "content-type": "application/json", "x-user-id": h.ORGANIZER, "idempotency-key": randomUUID() },
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().code, "MALFORMED_REQUEST");
});

dbTest("detail: an unknown event is 404 NOT_FOUND, a malformed id is 422", async () => {
  const missing = await inject({ method: "GET", url: `/api/v1/events/${randomUUID()}` });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().code, "NOT_FOUND");
  assert.equal((await inject({ method: "GET", url: "/api/v1/events/nope" })).statusCode, 422);
  for (const url of [`/api/v1/events/${randomUUID()}/sales-rules`]) {
    assert.equal((await h.organizer(inject, "PUT", url, h.RULES)).statusCode, 404);
  }
  assert.equal((await h.organizer(inject, "POST", `/api/v1/events/${randomUUID()}/publish`)).statusCode, 404);
});

dbTest("publishing without sales rules is 422 and leaves the event DRAFT, with nothing emitted", async () => {
  const draft = await createDraft();
  const response = await h.organizer(inject, "POST", `/api/v1/events/${draft.id}/publish`);
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().code, "VALIDATION_ERROR");
  assert.deepEqual(response.json().errors.map((e) => e.field), ["salesRules"]);
  assert.equal((await inject({ method: "GET", url: `/api/v1/events/${draft.id}` })).json().status, "DRAFT");
  assert.equal(factsFor(draft.id).length, 0);
});

dbTest("rules on a DRAFT are stored and emit nothing", async () => {
  const draft = await createDraft();
  const response = await h.organizer(inject, "PUT", `/api/v1/events/${draft.id}/sales-rules`, h.RULES);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().salesRules, h.RULES);
  assert.equal(response.json().status, "DRAFT");
  assert.equal(factsFor(draft.id).length, 0);
});

dbTest("publish emits EventPublished and SalesRulesConfigured, valid for their consumers, before answering", async () => {
  const correlationId = randomUUID();
  const draft = await createDraft();
  await h.organizer(inject, "PUT", `/api/v1/events/${draft.id}/sales-rules`, h.RULES);
  const response = await h.organizer(inject, "POST", `/api/v1/events/${draft.id}/publish`, undefined, {
    headers: { "x-correlation-id": correlationId },
  });
  assert.equal(response.statusCode, 200);
  const event = response.json();
  assert.equal(event.status, "PUBLISHED");

  // Already on the bus when the response arrives (flush before responding), in publish order.
  const facts = factsFor(draft.id);
  assert.deepEqual(
    facts.map((m) => [m.topic, m.data.type]),
    [
      ["aforo.catalog.event-published", "EventPublished"],
      ["aforo.catalog.sales-rules-configured", "SalesRulesConfigured"],
    ],
  );
  for (const message of facts) {
    // The same validator the consumers run (contract schemas): a payload they would 400 fails here.
    parseEnvelope(message.data, message.data.type);
    assert.equal(message.data.producer, "catalog");
    assert.equal(message.data.correlationId, correlationId);
    assert.deepEqual(message.attributes, { type: message.data.type, correlationId });
  }
  assert.deepEqual(facts[0].data.data, {
    eventId: event.id,
    name: event.name,
    salesOpensAt: event.salesOpensAt,
    salesClosesAt: event.salesClosesAt,
    sectors: event.sectors.map((s) => ({
      sectorId: s.id,
      name: s.name,
      capacity: s.capacity,
      priceCents: s.priceCents,
      currency: "COP",
    })),
  });
  assert.deepEqual(facts[1].data.data, { eventId: event.id, ...h.RULES });
  assert.deepEqual(
    await h.sql("SELECT count(*)::int AS n FROM outbox WHERE event_id = $1 AND published_at IS NULL", [event.id]),
    [{ n: 0 }],
  );
});

dbTest("publishing again changes nothing and emits nothing; two concurrent publishes emit one pair", async () => {
  const event = await publishedEvent();
  const again = await h.organizer(inject, "POST", `/api/v1/events/${event.id}/publish`);
  assert.equal(again.statusCode, 200);
  assert.deepEqual(again.json(), event);
  assert.equal(factsFor(event.id).length, 2);

  const draft = await createDraft();
  await h.organizer(inject, "PUT", `/api/v1/events/${draft.id}/sales-rules`, h.RULES);
  const racers = await Promise.all(
    Array.from({ length: 5 }, () => h.organizer(inject, "POST", `/api/v1/events/${draft.id}/publish`)),
  );
  assert.deepEqual(racers.map((r) => r.statusCode), [200, 200, 200, 200, 200]);
  assert.deepEqual(
    await h.sql("SELECT type FROM outbox WHERE event_id = $1 ORDER BY seq", [draft.id]),
    [{ type: "EventPublished" }, { type: "SalesRulesConfigured" }],
  );
});

dbTest("changing the rules of a published event emits SalesRulesConfigured with the new rules", async () => {
  const event = await publishedEvent();
  const rules = { maxTicketsPerPerson: 2, reservationTtlSeconds: 300, openingWindowSeconds: 0 };
  const response = await h.organizer(inject, "PUT", `/api/v1/events/${event.id}/sales-rules`, rules);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().salesRules, rules);
  const facts = factsFor(event.id);
  assert.deepEqual(facts.map((m) => m.data.type), ["EventPublished", "SalesRulesConfigured", "SalesRulesConfigured"]);
  assert.deepEqual(facts[2].data.data, { eventId: event.id, ...rules });
});

dbTest("with Pub/Sub down the publish still succeeds; housekeeping ships the facts later", async () => {
  const draft = await createDraft();
  await h.organizer(inject, "PUT", `/api/v1/events/${draft.id}/sales-rules`, h.RULES);
  pubsub.failing = true;
  try {
    const response = await h.organizer(inject, "POST", `/api/v1/events/${draft.id}/publish`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, "PUBLISHED");
    assert.equal(factsFor(draft.id).length, 0);
    const failed = await inject({ method: "POST", url: "/internal/v1/housekeeping" });
    assert.notEqual(failed.statusCode, 204, "housekeeping reports the failure so the run is visible");
  } finally {
    pubsub.failing = false;
  }
  const housekeeping = await inject({ method: "POST", url: "/internal/v1/housekeeping" });
  assert.equal(housekeeping.statusCode, 204);
  assert.deepEqual(factsFor(draft.id).map((m) => m.data.type), ["EventPublished", "SalesRulesConfigured"]);
});

dbTest("saleState follows the server clock: SCHEDULED, OPEN, CLOSED", async () => {
  const scheduled = await createDraft({ salesOpensAt: h.isoAt(h.hour), salesClosesAt: h.isoAt(2 * h.hour) });
  const closed = await createDraft({ salesOpensAt: h.isoAt(-2 * h.hour), salesClosesAt: h.isoAt(-h.hour) });
  assert.equal(scheduled.saleState, "SCHEDULED");
  assert.equal(closed.saleState, "CLOSED");
  assert.equal((await createDraft()).saleState, "OPEN");
});

dbTest("list: filters by status, pages soonest first, counts the total; bad paging is 422", async () => {
  await h.sql("DELETE FROM sales_rules; DELETE FROM sector; DELETE FROM outbox; DELETE FROM event;");
  const day = 24 * h.hour;
  const published = [];
  for (const days of [3, 1, 2]) published.push(await publishedEvent({ startsAt: h.isoAt(days * day) }));
  await createDraft({ startsAt: h.isoAt(0.5 * day) });

  const first = await inject({ method: "GET", url: "/api/v1/events?status=PUBLISHED&page=0&size=2" });
  assert.equal(first.statusCode, 200);
  const page = first.json();
  assert.deepEqual([page.page, page.size, page.total], [0, 2, 3]);
  const byStart = [...published].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((e) => e.id);
  assert.deepEqual(page.items.map((e) => e.id), byStart.slice(0, 2));
  const second = (await inject({ method: "GET", url: "/api/v1/events?status=PUBLISHED&page=1&size=2" })).json();
  assert.deepEqual(second.items.map((e) => e.id), byStart.slice(2));
  assert.deepEqual(second.items[0], published.find((e) => e.id === byStart[2]));

  const all = (await inject({ method: "GET", url: "/api/v1/events" })).json();
  assert.deepEqual([all.page, all.size, all.total, all.items[0].status], [0, 20, 4, "DRAFT"]);
  const bad = await inject({ method: "GET", url: "/api/v1/events?status=OPEN&size=500" });
  assert.equal(bad.statusCode, 422);
  assert.deepEqual(bad.json().errors.map((e) => e.field), ["status", "size"]);
});

dbTest("a published event never goes back to DRAFT, even by hand", async () => {
  const event = await publishedEvent();
  await assert.rejects(h.sql("UPDATE event SET status = 'DRAFT' WHERE id = $1", [event.id]), /cannot go from PUBLISHED/);
});

dbTest("health: ready checks the database", async () => {
  const ready = await inject({ method: "GET", url: "/health/ready" });
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.json().checks.database, "ok");
});
