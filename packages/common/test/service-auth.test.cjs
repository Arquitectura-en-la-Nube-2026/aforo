const assert = require("node:assert/strict");
const http = require("node:http");
const { after, before, test } = require("node:test");
const { MetadataClient, ServiceAuthClient } = require("../dist");

let metadata;
let host;
const calls = [];

before(async () => {
  metadata = http.createServer((request, response) => {
    calls.push(request.url);
    if (request.headers["metadata-flavor"] !== "Google") {
      response.writeHead(403);
      return response.end();
    }
    if (request.url.includes("/identity?")) {
      const audience = new URL(request.url, "http://metadata").searchParams.get("audience");
      return response.end(`id-token-for-${audience}`);
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ access_token: "access-token", expires_in: 3599 }));
  });
  await new Promise((resolve) => metadata.listen(0, "127.0.0.1", resolve));
  host = `127.0.0.1:${metadata.address().port}`;
});

after(() => new Promise((resolve) => metadata.close(resolve)));

test("dev mode sends no Authorization header", async () => {
  assert.deepEqual(await new ServiceAuthClient({ mode: "dev" }).header("aforo-inventory"), {});
});

test("cloud mode asks the metadata server for an ID token per audience and reuses it", async () => {
  calls.length = 0;
  const auth = new ServiceAuthClient({ mode: "cloud", metadata: new MetadataClient(host) });
  assert.deepEqual(await auth.header("aforo-inventory"), {
    authorization: "Bearer id-token-for-aforo-inventory",
  });
  await auth.header("aforo-inventory");
  assert.deepEqual(await auth.header("aforo-catalog"), {
    authorization: "Bearer id-token-for-aforo-catalog",
  });
  assert.equal(calls.length, 2, "one metadata call per audience");
});

test("access tokens are cached until shortly before they expire", async () => {
  calls.length = 0;
  const client = new MetadataClient(host);
  const now = Date.now();
  assert.equal(await client.accessToken(now), "access-token");
  await client.accessToken(now + 30 * 60 * 1000);
  assert.equal(calls.length, 1);
  await client.accessToken(now + 59 * 60 * 1000);
  assert.equal(calls.length, 2, "refreshed inside the last minute");
});

test("an unknown AUTH_MODE fails at construction", () => {
  assert.throws(() => new ServiceAuthClient({ mode: "prod" }), /AUTH_MODE/);
});
