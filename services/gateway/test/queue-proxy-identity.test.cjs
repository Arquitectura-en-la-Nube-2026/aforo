// The Gateway in the cloud (AUTH_MODE=cloud, as Terraform sets it). The queue is private there: Cloud Run
// only lets in calls that carry a Google ID token of the Gateway's service account, so without one every
// join/status/stream is a 403 before it reaches the queue.
const assert = require("node:assert/strict");
const http = require("node:http");
const { after, before, test } = require("node:test");
const { configure, createGatewayApp, login, sleep, startUpstream } = require("./helpers.cjs");

const eventId = "8f1b2c3d-0000-4000-8000-000000000001";
const metadata = { calls: 0, fail: false, delayMs: 0, server: null };
let upstream;
let app;
let base;

before(async () => {
  metadata.server = http.createServer((request, response) => {
    metadata.calls += 1;
    setTimeout(() => {
      if (metadata.fail) {
        response.writeHead(503);
        response.end("unavailable");
        return;
      }
      response.end("google-id-token");
    }, metadata.delayMs);
  });
  await new Promise((resolve) => metadata.server.listen(0, "127.0.0.1", resolve));
  upstream = await startUpstream();
  configure({
    QUEUE_URL: upstream.url,
    AUTH_MODE: "cloud",
    GCE_METADATA_HOST: `127.0.0.1:${metadata.server.address().port}`,
  });
  app = await createGatewayApp({ listening: true });
  base = await app.getUrl();
});
after(async () => {
  await app.close();
  await upstream.close();
  await new Promise((resolve) => metadata.server.close(resolve));
});

const inject = (options) => app.getHttpAdapter().getInstance().inject(options);
/** Drops the cached token, so the next call asks the metadata server again (like a fresh instance). */
const forgetTokens = () => app.get(require("../dist/auth/service-identity.service").ServiceIdentityService).tokens.clear();

test("a buyer who leaves while the token is being fetched does not open a stream to the queue", async () => {
  // The close listener must be in place before the token is awaited: `close` fires once, and a buyer
  // gone at 100 ms with the token arriving at 500 ms used to be missed, leaving an upstream stream open.
  const buyer = await login(app);
  forgetTokens();
  metadata.delayMs = 500;
  const client = new AbortController();
  const request = fetch(`${base}/api/v1/queue/${eventId}/stream`, {
    headers: { authorization: `Bearer ${buyer.token}` },
    signal: client.signal,
  }).catch(() => undefined);
  await sleep(100);
  client.abort();
  await request;
  await sleep(800); // the token has arrived by now
  metadata.delayMs = 0;
  assert.equal(upstream.requests.length, 0, "the Gateway called the queue for a buyer who had already left");
});

test("without a token from the metadata server the buyer gets 500 INTERNAL problem+json, and the queue is not called", async () => {
  const buyer = await login(app);
  forgetTokens();
  metadata.fail = true;
  const response = await inject({
    method: "POST",
    url: `/api/v1/queue/${eventId}/join`,
    headers: { authorization: `Bearer ${buyer.token}` },
  });
  metadata.fail = false;
  assert.equal(response.statusCode, 500);
  assert.match(response.headers["content-type"], /^application\/problem\+json/);
  assert.equal(response.json().code, "INTERNAL");
  assert.equal(upstream.requests.length, 0, "a call without the token would only be a 403 from Cloud Run");
});

test("the queue gets the Gateway's Google ID token, never the buyer's session token, on every operation", async () => {
  const buyer = await login(app);
  const calls = metadata.calls;
  for (const [method, operation] of [["POST", "join"], ["GET", "status"]]) {
    const response = await inject({
      method,
      url: `/api/v1/queue/${eventId}/${operation}`,
      headers: { authorization: `Bearer ${buyer.token}` },
    });
    assert.ok(response.statusCode < 300, `${operation} answered ${response.statusCode}`);
  }
  const sent = upstream.requests.map((request) => request.headers.authorization);
  assert.deepEqual(sent, ["Bearer google-id-token", "Bearer google-id-token"]);
  assert.equal(metadata.calls - calls, 1, "one token, reused: the failed fetch before was not remembered");
});
