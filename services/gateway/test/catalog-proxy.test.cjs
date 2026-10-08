const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");
const { configure, createGatewayApp, login, startUpstream } = require("./helpers.cjs");

const eventId = "8f1b2c3d-0000-4000-8000-000000000001";
let catalog;
let app;

before(async () => {
  catalog = await startUpstream();
  configure({ CATALOG_URL: catalog.url, QUEUE_URL: catalog.url });
  app = await createGatewayApp();
});

after(async () => {
  await app?.close();
  await catalog?.close();
});

beforeEach(() => {
  catalog.requests.length = 0;
  catalog.respond = (request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ items: [{ id: eventId }], page: 0, size: 20, total: 1 }));
  };
});

const inject = (options) => app.getHttpAdapter().getInstance().inject(options);

test("public event list and detail reach Catalog with query and correlation, without browser identity headers", async () => {
  const list = await inject({
    method: "GET",
    url: "/api/v1/events?status=PUBLISHED&page=0&size=20",
    headers: { "x-user-id": "forged", "x-user-email": "forged@example.com" },
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().items[0].id, eventId);
  assert.equal(catalog.requests[0].url, "/api/v1/events?status=PUBLISHED&page=0&size=20");
  assert.equal(catalog.requests[0].headers["x-correlation-id"], list.headers["x-correlation-id"]);
  assert.equal(catalog.requests[0].headers["x-user-id"], undefined);
  assert.equal(catalog.requests[0].headers["x-user-email"], undefined);

  const detail = await inject({ method: "GET", url: `/api/v1/events/${eventId}` });
  assert.equal(detail.statusCode, 200);
  assert.equal(catalog.requests[1].url, `/api/v1/events/${eventId}`);
});

test("Catalog writes require a session and forward the validated user, body and idempotency key", async () => {
  const body = { title: "Concert" };
  const unauthenticated = await inject({ method: "POST", url: "/api/v1/events", payload: body });
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(catalog.requests.length, 0);

  const buyer = await login(app);
  catalog.respond = (request, response) => {
    let data = "";
    request.on("data", (chunk) => { data += chunk; });
    request.on("end", () => {
      catalog.requests.at(-1).body = data;
      response.writeHead(request.url === "/api/v1/events" ? 201 : 200, {
        "content-type": "application/json",
        "idempotent-replayed": "true",
      });
      response.end(JSON.stringify({ id: eventId }));
    });
  };

  for (const [method, path, payload] of [
    ["POST", "/api/v1/events", body],
    ["PUT", `/api/v1/events/${eventId}/sales-rules`, { maxPerPerson: 4 }],
    ["POST", `/api/v1/events/${eventId}/publish`, undefined],
  ]) {
    const response = await inject({
      method, url: path, payload,
      headers: {
        authorization: `Bearer ${buyer.token}`,
        "idempotency-key": "create-event-key",
        "x-user-id": "forged",
        "x-user-email": "forged@example.com",
      },
    });
    assert.equal(response.statusCode, path === "/api/v1/events" ? 201 : 200, path);
    assert.equal(response.headers["idempotent-replayed"], "true");
    const sent = catalog.requests.at(-1);
    assert.equal(sent.method, method);
    assert.equal(sent.url, path);
    assert.equal(sent.headers["x-user-id"], buyer.userId);
    assert.equal(sent.headers["x-user-email"], buyer.email);
    assert.equal(sent.headers["idempotency-key"], "create-event-key");
    assert.equal(sent.headers.authorization, undefined);
    assert.equal(sent.headers["x-correlation-id"], response.headers["x-correlation-id"]);
    if (payload) assert.deepEqual(JSON.parse(sent.body), payload);
  }
});

test("availability and internal paths never reach Catalog", async () => {
  const paths = [
    `/api/v1/events/${eventId}/availability`,
    "/internal/v1/housekeeping",
    `/api/v1/events/${eventId}/internal/v1/housekeeping`,
  ];
  for (const url of paths) {
    const response = await inject({ method: "GET", url });
    assert.equal(response.statusCode, 404, url);
  }
  assert.equal(catalog.requests.length, 0);
});

test("an invalid event ID is rejected before Catalog is called", async () => {
  const response = await inject({ method: "GET", url: "/api/v1/events/not-a-uuid" });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().code, "VALIDATION_ERROR");
  assert.equal(catalog.requests.length, 0);
});

test("Catalog problem responses keep their status and Idempotent-Replayed header", async () => {
  catalog.respond = (request, response) => {
    response.writeHead(404, { "content-type": "application/problem+json", "idempotent-replayed": "true" });
    response.end(JSON.stringify({ code: "NOT_FOUND", status: 404 }));
  };
  const response = await inject({ method: "GET", url: `/api/v1/events/${eventId}` });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().code, "NOT_FOUND");
  assert.match(response.headers["content-type"], /^application\/problem\+json/);
  assert.equal(response.headers["idempotent-replayed"], "true");
});

test("an HTML IAM rejection is mapped to INTERNAL problem+json", async () => {
  catalog.respond = (request, response) => {
    response.writeHead(403, { "content-type": "text/html" });
    response.end("<html>Forbidden</html>");
  };
  const response = await inject({ method: "GET", url: "/api/v1/events" });
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().code, "INTERNAL");
  assert.match(response.headers["content-type"], /^application\/problem\+json/);
  assert.doesNotMatch(response.body, /<html>/);
});
