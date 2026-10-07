// scripts/seed-event.mjs against a fake queue: in `dev` the queue is private, so the seed has to carry an
// ID token or Cloud Run rejects it with 403 before it reaches the push endpoints.
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const { after, before, beforeEach, test } = require("node:test");

const SCRIPT = path.join(__dirname, "..", "scripts", "seed-event.mjs");
const received = [];
let server;
let url;

before(async () => {
  server = http.createServer((request, response) => {
    received.push({ url: request.url, authorization: request.headers.authorization });
    request.resume();
    request.on("end", () => {
      response.writeHead(204);
      response.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  received.length = 0;
});

const seed = (...args) =>
  new Promise((resolve, reject) =>
    execFile(process.execPath, [SCRIPT, "--url", url, ...args], (error, stdout, stderr) =>
      error ? reject(new Error(stderr || error.message)) : resolve(stdout),
    ),
  );

test("with --token both pushes carry it as a bearer token, for the private queue in dev", async () => {
  await seed("--token", "id-token-from-gcloud");
  assert.deepEqual(received, [
    { url: "/internal/v1/events/queue-event-published", authorization: "Bearer id-token-from-gcloud" },
    { url: "/internal/v1/events/queue-sales-rules", authorization: "Bearer id-token-from-gcloud" },
  ]);
});

test("without --token nothing is sent, as against a local queue", async () => {
  await seed();
  assert.deepEqual(
    received.map((request) => request.authorization),
    [undefined, undefined],
  );
});
