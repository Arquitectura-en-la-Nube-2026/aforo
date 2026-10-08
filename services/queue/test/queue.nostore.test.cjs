// Memorystore is off (ADR-0001): REDIS_URL is empty. The service must still boot.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { configure, createApp, eventPublished, randomUUID } = require("./helpers.cjs");

configure({ REDIS_URL: "" });

const userId = randomUUID();
const eventId = randomUUID();

test("without Redis the service boots, live is 200 and ready is 503", async () => {
  const app = await createApp();
  try {
    const server = app.getHttpAdapter().getInstance();
    const live = await server.inject({ method: "GET", url: "/health/live" });
    assert.equal(live.statusCode, 200);
    const ready = await server.inject({ method: "GET", url: "/health/ready" });
    assert.equal(ready.statusCode, 503);
    assert.equal(ready.json().checks.redis, "error");
  } finally {
    await app.close();
  }
});

test("without Redis every queue endpoint answers 500 INTERNAL 'queue store not available'", async () => {
  const app = await createApp();
  try {
    const server = app.getHttpAdapter().getInstance();
    for (const [method, url] of [
      ["POST", `/api/v1/queue/${eventId}/join`],
      ["GET", `/api/v1/queue/${eventId}/status`],
      ["GET", `/api/v1/queue/${eventId}/stream`],
    ]) {
      const response = await server.inject({ method, url, headers: { "x-user-id": userId } });
      assert.equal(response.statusCode, 500, `${method} ${url}`);
      assert.match(response.headers["content-type"], /^application\/problem\+json/);
      const problem = response.json();
      assert.equal(problem.code, "INTERNAL");
      assert.equal(problem.detail, "queue store not available");
      assert.match(problem.correlationId, /^[0-9a-f-]{36}$/i);
    }
  } finally {
    await app.close();
  }
});

test("identity and path are checked before the store: 401 without X-User-Id, 422 for a bad event id", async () => {
  const app = await createApp();
  try {
    const server = app.getHttpAdapter().getInstance();
    for (const headers of [{}, { "x-user-id": "not-a-uuid" }]) {
      const response = await server.inject({ method: "POST", url: `/api/v1/queue/${eventId}/join`, headers });
      assert.equal(response.statusCode, 401);
      assert.equal(response.json().code, "UNAUTHENTICATED");
    }
    const bad = await server.inject({ method: "POST", url: "/api/v1/queue/not-a-uuid/join", headers: { "x-user-id": userId } });
    assert.equal(bad.statusCode, 422);
    assert.equal(bad.json().code, "VALIDATION_ERROR");
    assert.deepEqual(bad.json().errors, [{ field: "eventId", message: "eventId must be a UUID" }]);
  } finally {
    await app.close();
  }
});

test("a push that is not a valid envelope answers 400 even without Redis, so it dead-letters", async () => {
  const app = await createApp();
  try {
    const server = app.getHttpAdapter().getInstance();
    const url = "/internal/v1/events/queue-event-published";
    const notAPush = await server.inject({ method: "POST", url, payload: { hello: "world" } });
    assert.equal(notAPush.statusCode, 400);
    assert.equal(notAPush.json().code, "MALFORMED_REQUEST");

    const wrongType = await server.inject({
      method: "POST",
      url: "/internal/v1/events/queue-sales-rules",
      payload: eventPublished(eventId, { opensAt: Date.now(), closesAt: Date.now() + 1000 }),
    });
    assert.equal(wrongType.statusCode, 400, "EventPublished sent to the sales-rules endpoint");

    const brokenJson = await server.inject({
      method: "POST",
      url,
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    assert.equal(brokenJson.statusCode, 400);
    assert.match(brokenJson.headers["content-type"], /^application\/problem\+json/);
  } finally {
    await app.close();
  }
});

test("a valid push with Redis down answers 5xx, so Pub/Sub retries instead of losing the event", async () => {
  const app = await createApp();
  try {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/internal/v1/events/queue-event-published",
      payload: eventPublished(eventId, { opensAt: Date.now(), closesAt: Date.now() + 1000 }),
    });
    assert.equal(response.statusCode, 500);
  } finally {
    await app.close();
  }
});
