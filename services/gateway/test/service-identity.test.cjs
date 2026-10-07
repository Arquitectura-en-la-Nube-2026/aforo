// The Gateway's Google ID tokens for private services, against a fake of the metadata server that every
// Cloud Run instance has (it is what hands the instance its tokens).
const assert = require("node:assert/strict");
const http = require("node:http");
const { after, before, beforeEach, test } = require("node:test");
const { ServiceIdentityService } = require("../dist/auth/service-identity.service");

const metadata = { calls: [], respond: null, server: null, host: null };
let issued = 0;
before(async () => {
  metadata.server = http.createServer((request, response) => {
    metadata.calls.push({ url: request.url, flavor: request.headers["metadata-flavor"] });
    metadata.respond(request, response);
  });
  await new Promise((resolve) => metadata.server.listen(0, "127.0.0.1", resolve));
  metadata.host = `127.0.0.1:${metadata.server.address().port}`;
});
after(() => new Promise((resolve) => metadata.server.close(resolve)));
beforeEach(() => {
  metadata.calls.length = 0;
  issued = 0;
  // A little slow on purpose, like a real network call, so concurrent callers really overlap.
  metadata.respond = (request, response) =>
    setTimeout(() => {
      issued += 1;
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(`id-token-${issued}`);
    }, 50);
});

const identity = (authMode = "cloud") => new ServiceIdentityService({ authMode, metadataHost: metadata.host });
const minutes = (n) => n * 60_000;

test("locally (AUTH_MODE=dev) there is no token, and the metadata server is never asked", async () => {
  assert.equal(await identity("dev").authorizationFor("aforo-queue"), null);
  assert.equal(metadata.calls.length, 0);
});

test("in the cloud it asks the metadata server for a token for the target's audience", async () => {
  assert.equal(await identity().authorizationFor("aforo-queue"), "Bearer id-token-1");
  assert.deepEqual(metadata.calls, [
    {
      url: "/computeMetadata/v1/instance/service-accounts/default/identity?audience=aforo-queue",
      flavor: "Google", // without this header the metadata server refuses
    },
  ]);
});

test("a token is reused for 50 minutes and renewed after, well before its hour runs out", async () => {
  const service = identity();
  const now = Date.now();
  assert.equal(await service.authorizationFor("aforo-queue", now), "Bearer id-token-1");
  assert.equal(await service.authorizationFor("aforo-queue", now + minutes(49)), "Bearer id-token-1");
  assert.equal(metadata.calls.length, 1);
  assert.equal(await service.authorizationFor("aforo-queue", now + minutes(51)), "Bearer id-token-2");
  assert.equal(metadata.calls.length, 2);
});

test("the opening of a sale does not send one metadata request per buyer: concurrent first calls share one", async () => {
  const service = identity();
  const all = await Promise.all(Array.from({ length: 20 }, () => service.authorizationFor("aforo-queue")));
  assert.deepEqual(new Set(all), new Set(["Bearer id-token-1"]));
  assert.equal(metadata.calls.length, 1);
});

test("a failed fetch is not remembered: the next call asks again", async () => {
  const service = identity();
  metadata.respond = (request, response) => {
    metadata.respond = (_request, ok) => ok.end("id-token-after-failure");
    response.writeHead(500);
    response.end("metadata server unavailable");
  };
  await assert.rejects(service.authorizationFor("aforo-queue"));
  assert.equal(await service.authorizationFor("aforo-queue"), "Bearer id-token-after-failure");
  assert.equal(metadata.calls.length, 2);
});
