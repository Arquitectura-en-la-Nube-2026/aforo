const assert = require("node:assert/strict");
const http = require("node:http");
const { after, before, test } = require("node:test");
const { configure, createGatewayApp, login, startUpstream } = require("./helpers.cjs");

let metadata;
let upstream;
let app;
const audiences = [];

before(async () => {
  metadata = http.createServer((request, response) => {
    const audience = new URL(request.url, "http://metadata").searchParams.get("audience");
    audiences.push(audience);
    response.end(`token-for-${audience}`);
  });
  await new Promise((resolve) => metadata.listen(0, "127.0.0.1", resolve));
  upstream = await startUpstream();
  configure({
    QUEUE_URL: upstream.url,
    ORDERS_URL: upstream.url,
    INVENTORY_URL: upstream.url,
    MOCK_PAYMENT_GATEWAY_URL: upstream.url,
    AUTH_MODE: "cloud",
    GCE_METADATA_HOST: `127.0.0.1:${metadata.address().port}`,
  });
  app = await createGatewayApp();
});

after(async () => {
  await app?.close();
  await upstream?.close();
  await new Promise((resolve) => metadata?.close(resolve));
});

test("each route carries the Gateway's ID token for its target: aforo-orders, aforo-inventory, the mock's URL", async () => {
  const inject = (options) => app.getHttpAdapter().getInstance().inject(options);
  const buyer = await login(app);
  await inject({ method: "GET", url: "/api/v1/orders", headers: { authorization: `Bearer ${buyer.token}` } });
  await inject({ method: "GET", url: "/api/v1/events/8f1b2c3d-0000-4000-8000-000000000001/availability" });
  await inject({ method: "GET", url: "/mock-gateway/checkout/5b2e8f10-3c4d-4e5f-8a6b-7c8d9e0f1a2b" });
  assert.deepEqual(
    upstream.requests.map((r) => r.headers.authorization),
    ["Bearer token-for-aforo-orders", "Bearer token-for-aforo-inventory", `Bearer token-for-${upstream.url}`],
  );
  assert.deepEqual(audiences, ["aforo-orders", "aforo-inventory", upstream.url]);
});
