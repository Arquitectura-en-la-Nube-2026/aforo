// Shared setup for the queue tests. They run against a real Redis because the interesting rules (the
// Lua scripts, the tick lock, the SSE reading Redis) only exist there; a mock would test the mock.
//   docker run --rm -p 6379:6379 redis:7
// The tests use database 15 and FLUSH it at the start of each file, so they refuse any other URL:
// they must never wipe a Redis someone cares about. Without Redis they skip, loudly; set
// REQUIRE_REDIS=1 (CI should) to make that a failure instead.
const { randomUUID } = require("node:crypto");
const { after, before, test } = require("node:test");
const Redis = require("ioredis");

const TEST_REDIS_URL = process.env.QUEUE_TEST_REDIS_URL ?? "redis://127.0.0.1:6379/15";

/** The service reads its environment once, when app.module is first required: call this before. */
function configure(overrides = {}) {
  Object.assign(process.env, {
    REDIS_URL: TEST_REDIS_URL,
    // The admission timer never fires by itself in tests; they drive it with admitTick(now).
    ADMISSION_INTERVAL_SECONDS: "3600",
    ADMISSION_BATCH_SIZE: "2",
    PASS_TTL_SECONDS: "600",
    SSE_HEARTBEAT_SECONDS: "15",
    SERVICE_NAME: "queue",
    ...overrides,
  });
}

/** A connected client on the test database, flushed; or null (with the reason) when it cannot be used. */
async function connectTestRedis() {
  if (!/\/15$/.test(TEST_REDIS_URL)) return { skip: `refusing to flush ${TEST_REDIS_URL}: tests only use database /15` };
  const client = new Redis(TEST_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
  client.on("error", () => undefined);
  try {
    await client.connect();
    await client.flushdb();
    return { client };
  } catch {
    client.disconnect();
    const reason = `Redis is not reachable at ${TEST_REDIS_URL} (docker run --rm -p 6379:6379 redis:7)`;
    if (process.env.REQUIRE_REDIS === "1") throw new Error(reason);
    console.warn(`SKIPPED: ${reason}`);
    return { skip: reason };
  }
}

async function createApp() {
  const { NestFactory } = require("@nestjs/core");
  const { FastifyAdapter } = require("@nestjs/platform-fastify");
  const { AppModule } = require("../dist/app.module");
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false });
  app.enableShutdownHooks();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/** An app that is listening on a real port (needed for SSE: light-my-request cannot stream). */
async function createListeningApp() {
  const app = await createApp();
  await app.listen(0, "127.0.0.1");
  return { app, base: await app.getUrl() };
}

/** Waits until the app's Redis connection is ready (it connects in the background). */
async function untilRedisReady(app) {
  const { RedisService } = require("../dist/redis/redis.service");
  const store = app.get(RedisService);
  for (let i = 0; i < 100; i += 1) {
    try {
      store.redis;
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("Redis connection did not become ready");
}

function envelope(type, data, occurredAt = Date.now()) {
  return {
    subscription: "projects/aforo-dev/subscriptions/test",
    message: {
      messageId: "1",
      data: Buffer.from(
        JSON.stringify({
          messageId: randomUUID(),
          type,
          version: 1,
          occurredAt: new Date(occurredAt).toISOString(),
          correlationId: randomUUID(),
          producer: "catalog",
          data,
        }),
      ).toString("base64"),
    },
  };
}

function eventPublished(eventId, { opensAt, closesAt, occurredAt }) {
  return envelope(
    "EventPublished",
    {
      eventId,
      name: "Test event",
      salesOpensAt: new Date(opensAt).toISOString(),
      salesClosesAt: new Date(closesAt).toISOString(),
      sectors: [{ sectorId: randomUUID(), name: "General", capacity: 500, priceCents: 18000000, currency: "COP" }],
    },
    occurredAt,
  );
}

function salesRules(eventId, openingWindowSeconds, occurredAt) {
  return envelope(
    "SalesRulesConfigured",
    {
      eventId,
      maxTicketsPerPerson: 4,
      reservationTtlSeconds: 480,
      openingWindowSeconds,
    },
    occurredAt,
  );
}

/** Seeds an event through the real push endpoints, the way Pub/Sub would. Opens a minute ago by default. */
async function seedEvent(app, { opensAt = Date.now() - 60_000, closesAt = Date.now() + 3_600_000, windowSeconds = 0 } = {}) {
  const eventId = randomUUID();
  const server = app.getHttpAdapter().getInstance();
  const published = await server.inject({
    method: "POST",
    url: "/internal/v1/events/queue-event-published",
    payload: eventPublished(eventId, { opensAt, closesAt }),
  });
  const rules = await server.inject({
    method: "POST",
    url: "/internal/v1/events/queue-sales-rules",
    payload: salesRules(eventId, windowSeconds),
  });
  if (published.statusCode !== 204 || rules.statusCode !== 204) throw new Error("could not seed the event");
  return eventId;
}

const join = (app, eventId, userId) =>
  app.getHttpAdapter().getInstance().inject({
    method: "POST",
    url: `/api/v1/queue/${eventId}/join`,
    headers: { "x-user-id": userId },
  });

const status = (app, eventId, userId) =>
  app.getHttpAdapter().getInstance().inject({
    method: "GET",
    url: `/api/v1/queue/${eventId}/status`,
    headers: { "x-user-id": userId },
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One app (plus the flushed test Redis) for a whole test file. `redisTest` skips, with the reason,
 * when Redis is not there; see the header of this file.
 */
function useRedisApp({ listening = false } = {}) {
  const state = { app: null, base: null, redis: null, skip: null };
  before(async () => {
    const connected = await connectTestRedis();
    if (connected.skip) {
      state.skip = connected.skip;
      return;
    }
    state.redis = connected.client;
    if (listening) Object.assign(state, await createListeningApp());
    else state.app = await createApp();
    await untilRedisReady(state.app);
  });
  after(async () => {
    if (state.app) await state.app.close();
    if (state.redis) await state.redis.quit();
  });
  // Every test starts from an empty database: the admission tick walks ALL events, so buyers left
  // queued by an earlier test would be admitted (and counted) in this one.
  const redisTest = (name, fn) =>
    test(name, async (t) => {
      if (state.skip) return t.skip(state.skip);
      await state.redis.flushdb();
      await fn(t);
    });
  return { state, redisTest };
}

/**
 * Reads an SSE response into messages until `done(messages, raw)` is true, the server ends the stream,
 * or `timeoutMs` passes. Returns { messages, ended, raw }. Comments (keep-alives) are kept in raw only.
 */
async function readSse(response, done = () => false, timeoutMs = 5000) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const messages = [];
  let raw = "";
  let buffer = "";
  let ended = false;
  const deadline = Date.now() + timeoutMs;
  try {
    while (!done(messages, raw)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const next = await Promise.race([reader.read(), sleep(remaining).then(() => "timeout")]);
      if (next === "timeout") break;
      if (next.done) {
        ended = true;
        break;
      }
      const text = decoder.decode(next.value, { stream: true });
      raw += text;
      buffer += text;
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = /^event: (.*)$/m.exec(block);
        const data = /^data: (.*)$/m.exec(block);
        if (event && data) messages.push({ event: event[1], data: JSON.parse(data[1]) });
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { messages, ended, raw };
}

module.exports = {
  TEST_REDIS_URL,
  configure,
  connectTestRedis,
  createApp,
  createListeningApp,
  untilRedisReady,
  envelope,
  eventPublished,
  salesRules,
  seedEvent,
  join,
  status,
  sleep,
  useRedisApp,
  readSse,
  randomUUID,
};
