// Redis is a soft dependency of the quota: when it is missing or down, the queue keeps working.
const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { configure, createGatewayApp, login, sleep, startUpstream } = require("./helpers.cjs");

const eventId = "8f1b2c3d-0000-4000-8000-000000000001";
let upstream;

before(async () => {
  upstream = await startUpstream();
});
after(async () => {
  await upstream.close();
});

async function statusCodes(app, count) {
  const buyer = await login(app);
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/api/v1/queue/${eventId}/status`,
      headers: { authorization: `Bearer ${buyer.token}` },
    });
    codes.push(response.statusCode);
  }
  return codes;
}

test("with no REDIS_URL (Memorystore off) the quota is not enforced and the queue still answers", async () => {
  configure({ QUEUE_URL: upstream.url, REDIS_URL: "", RATE_LIMIT_QUEUE_PER_MIN: "1" });
  const app = await createGatewayApp();
  try {
    assert.deepEqual(await statusCodes(app, 4), [200, 200, 200, 200]);
    const ready = await app.getHttpAdapter().getInstance().inject({ method: "GET", url: "/health/ready" });
    assert.equal(ready.statusCode, 200, "a missing quota store must not make the Gateway unready");
  } finally {
    await app.close();
  }
});

test("with a Redis that does not answer the quota fails open, and the Gateway does not crash or slow down", async () => {
  // Nothing listens on this port: the connection never becomes ready.
  configure({ QUEUE_URL: upstream.url, REDIS_URL: "redis://127.0.0.1:1/15", RATE_LIMIT_QUEUE_PER_MIN: "1" });
  const app = await createGatewayApp();
  try {
    await sleep(300); // let it fail to connect at least once
    const startedAt = Date.now();
    assert.deepEqual(await statusCodes(app, 4), [200, 200, 200, 200]);
    assert.ok(Date.now() - startedAt < 1500, "an unreachable Redis must not add latency to every request");
    const ready = await app.getHttpAdapter().getInstance().inject({ method: "GET", url: "/health/ready" });
    assert.equal(ready.statusCode, 200);
  } finally {
    await app.close();
  }
});
