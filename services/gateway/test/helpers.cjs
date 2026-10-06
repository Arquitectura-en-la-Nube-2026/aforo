// Shared setup for the Gateway tests that go through the queue proxy: a fake queue service that records
// every request it receives, and the real Gateway app built the way main.ts builds it.
const { randomBytes, randomUUID } = require("node:crypto");
const http = require("node:http");
const Redis = require("ioredis");

const TEST_REDIS_URL = process.env.QUEUE_TEST_REDIS_URL ?? "redis://127.0.0.1:6379/15";
const FRONTEND_ORIGIN = "http://localhost:4000";

/** The Gateway reads its environment when app.module is first required: call this before. */
function configure(overrides = {}) {
  Object.assign(process.env, {
    AUTH_SECRET: randomBytes(32).toString("base64url"),
    AUTH_ISSUER: "https://gateway.aforo.dev",
    FRONTEND_ORIGIN,
    REDIS_URL: "",
    RATE_LIMIT_QUEUE_PER_MIN: "60",
    SERVICE_NAME: "gateway",
    ...overrides,
  });
}

/**
 * A fake queue service. `requests` collects what the Gateway sent; `respond` decides the answer and can
 * be replaced per test. The default answers like the real join: 201 with a QueueStatus.
 */
async function startUpstream() {
  const upstream = {
    requests: [],
    sockets: new Set(),
    respond: (request, response) => {
      response.writeHead(request.method === "POST" ? 201 : 200, { "content-type": "application/json" });
      response.end(JSON.stringify({ state: "WAITING", position: 1 }));
    },
  };
  upstream.server = http.createServer((request, response) => {
    upstream.requests.push({ method: request.method, url: request.url, headers: request.headers });
    request.socket.once("close", () => upstream.lastSocketClosedAt = Date.now());
    upstream.respond(request, response);
  });
  await new Promise((resolve) => upstream.server.listen(0, "127.0.0.1", resolve));
  upstream.url = `http://127.0.0.1:${upstream.server.address().port}`;
  upstream.close = () =>
    new Promise((resolve) => {
      upstream.server.closeAllConnections();
      upstream.server.close(resolve);
    });
  return upstream;
}

async function createGatewayApp({ listening = false } = {}) {
  const { createApp } = require("../dist/create-app");
  const { loadGatewayConfig } = require("../dist/config/gateway-config");
  const app = await createApp(loadGatewayConfig(), { logger: false });
  app.enableShutdownHooks();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  if (listening) await app.listen(0, "127.0.0.1"); // then `await app.getUrl()` gives the base URL
  return app;
}

/** Logs in through the real login route and returns the bearer token and the user id (the JWT `sub`). */
async function login(app, email = `${randomUUID()}@example.com`) {
  const response = await app.getHttpAdapter().getInstance().inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, displayName: "Test Buyer" },
  });
  const session = response.json();
  return { token: session.accessToken, userId: session.user.id, email: session.user.email };
}

/** A flushed client on the test database, or { skip } with the reason. See services/queue/test/helpers.cjs. */
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

/** Waits until the app's rate-limit Redis connection is ready (it connects in the background). */
async function untilRateLimitRedisReady(app) {
  const { RateLimitService } = require("../dist/rate-limit/rate-limit.service");
  const service = app.get(RateLimitService);
  for (let i = 0; i < 100; i += 1) {
    if (service.client?.status === "ready") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("rate-limit Redis connection did not become ready");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  FRONTEND_ORIGIN,
  TEST_REDIS_URL,
  configure,
  startUpstream,
  createGatewayApp,
  login,
  connectTestRedis,
  untilRateLimitRedisReady,
  sleep,
  randomUUID,
};
