const assert = require("node:assert/strict");
const http = require("node:http");
const { after, before, test } = require("node:test");
const { HttpClient, HttpTransportError, runWithCorrelation } = require("../dist");

let server;
let base;
const seen = [];

before(async () => {
  server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      seen.push({ url: request.url, method: request.method, headers: request.headers, body });
      if (request.url === "/slow") return setTimeout(() => response.end("{}"), 300);
      if (request.url === "/problem") {
        response.writeHead(409, { "content-type": "application/problem+json" });
        return response.end(JSON.stringify({ code: "SOLD_OUT", status: 409 }));
      }
      if (request.url === "/empty") {
        response.writeHead(204);
        return response.end();
      }
      response.writeHead(201, { "content-type": "application/json", "x-extra": "yes" });
      response.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test("sends JSON, parses JSON and forwards the correlation ID of the request context", async () => {
  const client = new HttpClient();
  const correlationId = "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
  const response = await runWithCorrelation({ correlationId }, () =>
    client.request({ method: "POST", url: `${base}/things`, body: { quantity: 2 } }),
  );
  assert.equal(response.status, 201);
  assert.deepEqual(response.body, { ok: true });
  assert.equal(response.headers["x-extra"], "yes");
  const sent = seen.at(-1);
  assert.equal(sent.headers["x-correlation-id"], correlationId);
  assert.equal(sent.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(sent.body), { quantity: 2 });
});

test("an explicit X-Correlation-Id from the caller wins", async () => {
  await runWithCorrelation({ correlationId: "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f" }, () =>
    new HttpClient().request({
      method: "GET",
      url: `${base}/x`,
      headers: { "X-Correlation-Id": "mine" },
    }),
  );
  assert.equal(seen.at(-1).headers["x-correlation-id"], "mine");
});

test("an error status is a response, not a transport error; problem+json is parsed", async () => {
  const response = await new HttpClient().request({ method: "GET", url: `${base}/problem` });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "SOLD_OUT");
});

test("an empty body comes back as undefined", async () => {
  const response = await new HttpClient().request({ method: "GET", url: `${base}/empty` });
  assert.equal(response.status, 204);
  assert.equal(response.body, undefined);
});

test("a slow answer fails with response_timeout", async () => {
  const client = new HttpClient({ responseTimeoutMs: 50 });
  await assert.rejects(client.request({ method: "GET", url: `${base}/slow` }), (error) => {
    assert.ok(error instanceof HttpTransportError);
    assert.equal(error.kind, "response_timeout");
    return true;
  });
});

test("a refused connection fails with network", async () => {
  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const port = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  await assert.rejects(new HttpClient().request({ method: "GET", url: `http://127.0.0.1:${port}/` }), (error) => {
    assert.ok(error instanceof HttpTransportError);
    assert.equal(error.kind, "network");
    return true;
  });
});
