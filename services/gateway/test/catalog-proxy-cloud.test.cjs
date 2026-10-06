const assert = require("node:assert/strict");
const http = require("node:http");
const { after, before, test } = require("node:test");
const { configure, createGatewayApp, login, startUpstream } = require("./helpers.cjs");

let metadata;
let catalog;
let app;
let audience;

before(async () => {
  metadata = http.createServer((request, response) => {
    audience = new URL(request.url, "http://metadata").searchParams.get("audience");
    response.end("catalog-id-token");
  });
  await new Promise((resolve) => metadata.listen(0, "127.0.0.1", resolve));
  catalog = await startUpstream();
  configure({
    CATALOG_URL: catalog.url,
    QUEUE_URL: catalog.url,
    AUTH_MODE: "cloud",
    GCE_METADATA_HOST: `127.0.0.1:${metadata.address().port}`,
  });
  app = await createGatewayApp();
});

after(async () => {
  await app?.close();
  await catalog?.close();
  await new Promise((resolve) => metadata?.close(resolve));
});

test("public and authenticated Catalog calls use the Gateway service token for aforo-catalog", async () => {
  const inject = (options) => app.getHttpAdapter().getInstance().inject(options);
  const publicResponse = await inject({ method: "GET", url: "/api/v1/events" });
  assert.equal(publicResponse.statusCode, 200);
  assert.equal(audience, "aforo-catalog");
  assert.equal(catalog.requests[0].headers.authorization, "Bearer catalog-id-token");

  const buyer = await login(app);
  const privateResponse = await inject({
    method: "POST", url: "/api/v1/events", payload: { title: "Concert" },
    headers: { authorization: `Bearer ${buyer.token}` },
  });
  assert.equal(privateResponse.statusCode, 201);
  assert.equal(catalog.requests[1].headers.authorization, "Bearer catalog-id-token");
  assert.notEqual(catalog.requests[1].headers.authorization, `Bearer ${buyer.token}`);
});
