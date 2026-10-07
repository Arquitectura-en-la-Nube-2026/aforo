// The per-IP quota on the queue routes, against a real Redis (database 15, flushed; see helpers.cjs).
const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");
const {
  FRONTEND_ORIGIN,
  TEST_REDIS_URL,
  configure,
  connectTestRedis,
  createGatewayApp,
  login,
  startUpstream,
  untilRateLimitRedisReady,
} = require("./helpers.cjs");

const LIMIT = 5;
const eventId = "8f1b2c3d-0000-4000-8000-000000000001";
const state = { skip: null, app: null, other: null, upstream: null, redis: null, buyer: null };

before(async () => {
  const connected = await connectTestRedis();
  if (connected.skip) {
    state.skip = connected.skip;
    return;
  }
  state.redis = connected.client;
  state.upstream = await startUpstream();
  configure({ QUEUE_URL: state.upstream.url, REDIS_URL: TEST_REDIS_URL, RATE_LIMIT_QUEUE_PER_MIN: String(LIMIT) });
  state.app = await createGatewayApp();
  state.other = await createGatewayApp(); // a second Gateway instance sharing the same Redis
  await untilRateLimitRedisReady(state.app);
  await untilRateLimitRedisReady(state.other);
  state.buyer = await login(state.app);
});
after(async () => {
  if (state.app) await state.app.close();
  if (state.other) await state.other.close();
  if (state.upstream) await state.upstream.close();
  if (state.redis) await state.redis.quit();
});
beforeEach(async () => {
  if (state.skip) return;
  await state.redis.flushdb();
  state.upstream.requests.length = 0;
});

const redisTest = (name, fn) =>
  test(name, async (t) => {
    if (state.skip) return t.skip(state.skip);
    await fn(t);
  });

const call = (app, { ip, forwardedFor, token = state.buyer.token, origin } = {}) =>
  app.getHttpAdapter().getInstance().inject({
    method: "GET",
    url: `/api/v1/queue/${eventId}/status`,
    remoteAddress: ip,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
      ...(origin ? { origin } : {}),
    },
  });

redisTest("the request after the quota is 429 RATE_LIMITED with a Retry-After the browser can read", async () => {
  for (let i = 1; i <= LIMIT; i += 1) assert.equal((await call(state.app, { forwardedFor: "203.0.113.10" })).statusCode, 200, `request ${i}`);

  const blocked = await call(state.app, { forwardedFor: "203.0.113.10", origin: FRONTEND_ORIGIN });
  assert.equal(blocked.statusCode, 429);
  assert.match(blocked.headers["content-type"], /^application\/problem\+json/);
  assert.equal(blocked.json().code, "RATE_LIMITED");
  const retryAfter = Number(blocked.headers["retry-after"]);
  assert.ok(retryAfter >= 1 && retryAfter <= 60, `Retry-After was ${blocked.headers["retry-after"]}`);
  assert.match(blocked.headers["access-control-expose-headers"], /Retry-After/, "without it the browser hides the header");
  assert.equal(state.upstream.requests.length, LIMIT, "the blocked request must not reach the queue service");
});

redisTest("requests with no token or a forged one spend quota too, so the quota protects against token guessing", async () => {
  for (let i = 1; i <= LIMIT; i += 1) assert.equal((await call(state.app, { forwardedFor: "203.0.113.20", token: null })).statusCode, 401);
  assert.equal((await call(state.app, { forwardedFor: "203.0.113.20", token: null })).statusCode, 429);
  assert.equal(state.upstream.requests.length, 0);
});

redisTest("the quota is per client address: another address has its own, and the same one cannot be faked", async () => {
  for (let i = 1; i <= LIMIT; i += 1) await call(state.app, { forwardedFor: "203.0.113.30" });
  assert.equal((await call(state.app, { forwardedFor: "203.0.113.30" })).statusCode, 429);
  assert.equal((await call(state.app, { forwardedFor: "203.0.113.31" })).statusCode, 200, "a different buyer is not punished");

  // The client writes the START of X-Forwarded-For; the proxy in front (Cloud Run) appends the real
  // address at the END. Rotating a fake first entry must not give a fresh quota each time.
  for (let i = 1; i <= LIMIT; i += 1) await call(state.app, { forwardedFor: `198.51.100.${i}, 203.0.113.40` });
  const evasion = await call(state.app, { forwardedFor: "198.51.100.99, 203.0.113.40" });
  assert.equal(evasion.statusCode, 429, "a fake leftmost X-Forwarded-For entry evaded the quota");
});

redisTest("the quota is shared by every Gateway instance, not counted per instance", async () => {
  // Per-instance memory would give each of the two instances its own 5, so a client could send 10.
  for (let i = 0; i < 3; i += 1) assert.equal((await call(state.app, { forwardedFor: "203.0.113.50" })).statusCode, 200);
  for (let i = 0; i < 2; i += 1) assert.equal((await call(state.other, { forwardedFor: "203.0.113.50" })).statusCode, 200);
  assert.equal((await call(state.app, { forwardedFor: "203.0.113.50" })).statusCode, 429, "6th request across both instances");
  assert.equal((await call(state.other, { forwardedFor: "203.0.113.50" })).statusCode, 429);
});

redisTest("the window is one minute: it resets by itself, and no counter is left without an expiry", async () => {
  const { RateLimitService } = require("../dist/rate-limit/rate-limit.service");
  const limiter = state.app.get(RateLimitService);
  const now = Date.UTC(2026, 9, 5, 12, 0, 30);

  for (let i = 1; i <= LIMIT; i += 1) assert.equal((await limiter.hit("queue", "203.0.113.60", LIMIT, now)).allowed, true);
  const denied = await limiter.hit("queue", "203.0.113.60", LIMIT, now);
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfterSeconds >= 1 && denied.retryAfterSeconds <= 60);

  const key = `ratelimit:queue:203.0.113.60:${Math.floor(now / 60_000)}`;
  const ttl = await state.redis.ttl(key);
  assert.ok(ttl > 0 && ttl <= 60, `counter TTL was ${ttl}: a counter with no expiry would block that address forever`);
  assert.equal((await limiter.hit("queue", "203.0.113.60", LIMIT, now + 60_000)).allowed, true, "the next minute starts clean");
});
