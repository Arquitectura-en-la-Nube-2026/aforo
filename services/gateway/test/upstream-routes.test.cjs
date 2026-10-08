// The Orders, Inventory and mock routes of the public route map (README "Public route map").
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { after, before, beforeEach, test } = require("node:test");
const { configure, createGatewayApp, login, startUpstream } = require("./helpers.cjs");

const eventId = "8f1b2c3d-0000-4000-8000-000000000001";
const orderId = "0d3c1a52-6f7e-4a0b-9c1d-2e3f4a5b6c7d";
const paymentId = "5b2e8f10-3c4d-4e5f-8a6b-7c8d9e0f1a2b";
let orders;
let inventory;
let mock;
let app;
let buyer;

/** Answers `status` with `body`, recording the raw request body on the last request. */
function answer(upstream, status, body, headers = { "content-type": "application/json" }) {
  upstream.respond = (request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      upstream.requests.at(-1).body = Buffer.concat(chunks);
      response.writeHead(status, headers);
      response.end(typeof body === "string" ? body : JSON.stringify(body));
    });
  };
}

before(async () => {
  [orders, inventory, mock] = await Promise.all([startUpstream(), startUpstream(), startUpstream()]);
  configure({
    CATALOG_URL: "http://127.0.0.1:1",
    QUEUE_URL: "http://127.0.0.1:1",
    ORDERS_URL: orders.url,
    INVENTORY_URL: inventory.url,
    MOCK_PAYMENT_GATEWAY_URL: mock.url,
  });
  app = await createGatewayApp();
  buyer = await login(app);
});

after(async () => {
  await app?.close();
  await Promise.all([orders?.close(), inventory?.close(), mock?.close()]);
});

beforeEach(() => {
  for (const upstream of [orders, inventory, mock]) upstream.requests.length = 0;
  answer(orders, 201, { orderId, status: "PENDING_PAYMENT" });
  answer(inventory, 200, { eventId, sectors: [] });
  answer(mock, 200, "<html>Pay</html>", { "content-type": "text/html; charset=utf-8" });
});

const inject = (options) => app.getHttpAdapter().getInstance().inject(options);
const session = (headers = {}) => ({ authorization: `Bearer ${buyer.token}`, ...headers });

test("Orders routes need a session; without one nothing reaches Orders", async () => {
  for (const [method, url] of [
    ["POST", "/api/v1/orders"],
    ["GET", "/api/v1/orders"],
    ["GET", `/api/v1/orders/${orderId}`],
    ["POST", `/api/v1/orders/${orderId}/payment-intents`],
  ]) {
    const response = await inject({ method, url, payload: method === "POST" ? {} : undefined });
    assert.equal(response.statusCode, 401, url);
    assert.equal(response.json().code, "UNAUTHENTICATED");
  }
  assert.equal(orders.requests.length, 0);
});

test("creating an order forwards the validated user, key, pass, correlation and the body as sent", async () => {
  const raw = '{"eventId":"8f1b2c3d-0000-4000-8000-000000000001",  "sectorId":"a1","quantity":2}';
  const response = await inject({
    method: "POST",
    url: "/api/v1/orders",
    payload: raw,
    headers: session({
      "content-type": "application/json",
      "idempotency-key": "order-key",
      "x-queue-pass": "p_pass",
      "x-user-id": "forged",
      "x-user-email": "forged@example.com",
    }),
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().orderId, orderId);
  const sent = orders.requests[0];
  assert.equal(sent.method, "POST");
  assert.equal(sent.url, "/api/v1/orders");
  assert.equal(sent.headers["x-user-id"], buyer.userId);
  assert.equal(sent.headers["x-user-email"], buyer.email);
  assert.equal(sent.headers["idempotency-key"], "order-key");
  assert.equal(sent.headers["x-queue-pass"], "p_pass");
  assert.equal(sent.headers["x-correlation-id"], response.headers["x-correlation-id"]);
  assert.equal(sent.headers.authorization, undefined, "the user token never leaves the Gateway");
  assert.equal(sent.body.toString(), raw);
});

test("order reads and payment intents reach their own paths; the list keeps its query", async () => {
  answer(orders, 200, { items: [], page: 1, size: 5, total: 0 });
  assert.equal((await inject({ method: "GET", url: "/api/v1/orders?page=1&size=5", headers: session() })).statusCode, 200);
  assert.equal(orders.requests[0].url, "/api/v1/orders?page=1&size=5");

  await inject({ method: "GET", url: `/api/v1/orders/${orderId}`, headers: session() });
  assert.equal(orders.requests[1].url, `/api/v1/orders/${orderId}`);
  assert.equal(orders.requests[1].headers["x-user-id"], buyer.userId);

  answer(orders, 201, { checkoutUrl: "https://gw/mock-gateway/checkout/x" }, {
    "content-type": "application/json",
    "idempotent-replayed": "true",
  });
  const intent = await inject({
    method: "POST",
    url: `/api/v1/orders/${orderId}/payment-intents`,
    headers: session({ "idempotency-key": "pay-key" }),
  });
  assert.equal(intent.statusCode, 201);
  assert.equal(intent.headers["idempotent-replayed"], "true");
  assert.equal(orders.requests[2].method, "POST");
  assert.equal(orders.requests[2].url, `/api/v1/orders/${orderId}/payment-intents`);
  assert.equal(orders.requests[2].headers["idempotency-key"], "pay-key");

  const invalid = await inject({ method: "GET", url: "/api/v1/orders/not-a-uuid", headers: session() });
  assert.equal(invalid.statusCode, 422);
  assert.equal(orders.requests.length, 3);
});

test("Orders' problems pass through with their status and code", async () => {
  answer(orders, 409, { code: "SOLD_OUT", status: 409 }, { "content-type": "application/problem+json" });
  const response = await inject({
    method: "POST",
    url: "/api/v1/orders",
    payload: {},
    headers: session({ "idempotency-key": "k" }),
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, "SOLD_OUT");
  assert.match(response.headers["content-type"], /^application\/problem\+json/);
});

test("a slow Orders answer (E-06: its retries take seconds) still reaches the buyer as Orders' 503", async () => {
  orders.respond = (request, response) => {
    request.resume();
    setTimeout(() => {
      response.writeHead(503, { "content-type": "application/problem+json" });
      response.end(JSON.stringify({ code: "PAYMENT_UNAVAILABLE", status: 503 }));
    }, 3000);
  };
  const response = await inject({
    method: "POST",
    url: `/api/v1/orders/${orderId}/payment-intents`,
    headers: session({ "idempotency-key": "k" }),
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().code, "PAYMENT_UNAVAILABLE");
});

test("the webhook needs no session and reaches Orders byte for byte with its signature", async () => {
  answer(orders, 200, {});
  const raw = '{ "notificationId": "n-1",\n  "paymentId": "p", "outcome": "APPROVED" }';
  const signature = `sha256=${createHmac("sha256", "secret").update(raw).digest("hex")}`;
  const response = await inject({
    method: "POST",
    url: "/api/v1/payments/webhook",
    payload: raw,
    headers: { "content-type": "application/json", "x-signature": signature, "x-user-id": "forged" },
  });
  assert.equal(response.statusCode, 200);
  const sent = orders.requests[0];
  assert.equal(sent.url, "/api/v1/payments/webhook");
  assert.equal(sent.body.toString(), raw, "an HMAC over a re-serialized body would not match");
  assert.equal(`sha256=${createHmac("sha256", "secret").update(sent.body).digest("hex")}`, signature);
  assert.equal(sent.headers["x-signature"], signature);
  assert.equal(sent.headers["x-user-id"], undefined);

  answer(orders, 401, { code: "INVALID_SIGNATURE", status: 401 }, { "content-type": "application/problem+json" });
  const rejected = await inject({
    method: "POST",
    url: "/api/v1/payments/webhook",
    payload: raw,
    headers: { "content-type": "application/json", "x-signature": "sha256=00" },
  });
  assert.equal(rejected.statusCode, 401);
  assert.equal(rejected.json().code, "INVALID_SIGNATURE");
});

test("a handled webhook's bare 200 (no body, no Content-Type) passes through, never as a 500", async () => {
  orders.respond = (request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200);
      response.end();
    });
  };
  const handled = await inject({
    method: "POST",
    url: "/api/v1/payments/webhook",
    payload: "{}",
    headers: { "content-type": "application/json", "x-signature": "sha256=00" },
  });
  assert.equal(handled.statusCode, 200);
  assert.equal(handled.body, "");

  orders.respond = (request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200);
      response.end("<html>not Orders</html>");
    });
  };
  const foreign = await inject({
    method: "POST",
    url: "/api/v1/payments/webhook",
    payload: "{}",
    headers: { "content-type": "application/json", "x-signature": "sha256=00" },
  });
  assert.equal(foreign.statusCode, 500, "a typeless body did not come from Orders");
});

test("availability is public and goes to Inventory, never with identity headers", async () => {
  const response = await inject({
    method: "GET",
    url: `/api/v1/events/${eventId}/availability`,
    headers: { "x-user-id": "forged" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().eventId, eventId);
  assert.equal(inventory.requests[0].url, `/api/v1/events/${eventId}/availability`);
  assert.equal(inventory.requests[0].headers["x-user-id"], undefined);
  assert.equal((await inject({ method: "GET", url: "/api/v1/events/nope/availability" })).statusCode, 422);
  assert.equal(inventory.requests.length, 1);
});

test("the checkout page and its completion pass through as HTML and as the redirect to the web", async () => {
  const page = await inject({ method: "GET", url: `/mock-gateway/checkout/${paymentId}` });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers["content-type"], /^text\/html/);
  assert.equal(page.headers["cache-control"], "no-store");
  assert.equal(page.body, "<html>Pay</html>");
  assert.equal(mock.requests[0].url, `/checkout/${paymentId}`);

  answer(mock, 302, "", { location: `http://localhost:4000/orders/${orderId}` });
  const done = await inject({ method: "GET", url: `/mock-gateway/checkout/${paymentId}/complete?outcome=APPROVED&x=1` });
  assert.equal(done.statusCode, 302);
  assert.equal(done.headers.location, `http://localhost:4000/orders/${orderId}`);
  assert.equal(mock.requests[1].url, `/checkout/${paymentId}/complete?outcome=APPROVED`);

  const bad = await inject({ method: "GET", url: `/mock-gateway/checkout/${paymentId}/complete?outcome=MAYBE` });
  assert.equal(bad.statusCode, 422);
  assert.equal(mock.requests.length, 2);
});

test("only the checkout pages of the mock are reachable", async () => {
  for (const [method, url] of [
    ["POST", "/mock-gateway/payments"],
    ["GET", "/mock-gateway/payments"],
    ["POST", "/mock-gateway/webhook-dispatch"],
    ["POST", `/mock-gateway/checkout/${paymentId}`],
    ["GET", "/internal/v1/housekeeping"],
  ]) {
    assert.equal((await inject({ method, url })).statusCode, 404, `${method} ${url}`);
  }
  assert.equal(mock.requests.length, 0);
});

test("an HTML IAM rejection from any of them becomes INTERNAL problem+json", async () => {
  const forbidden = ["<html>403 Forbidden</html>", { "content-type": "text/html" }];
  answer(mock, 403, ...forbidden);
  answer(inventory, 403, ...forbidden);
  answer(orders, 403, ...forbidden);
  for (const [url, headers] of [
    [`/mock-gateway/checkout/${paymentId}`, {}],
    [`/api/v1/events/${eventId}/availability`, {}],
    ["/api/v1/orders", session()],
  ]) {
    const response = await inject({ method: "GET", url, headers });
    assert.equal(response.statusCode, 500, url);
    assert.equal(response.json().code, "INTERNAL");
    assert.doesNotMatch(response.body, /<html>/);
  }
});
