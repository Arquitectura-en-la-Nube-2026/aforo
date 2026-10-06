// SIGTERM and streams that are not open yet. The drain ends the streams it knows about; one still
// waiting for the queue's headers, or arriving after the drain, must not slip past it and hold the
// HTTP server open until Cloud Run kills the instance (~10 s after SIGTERM).
const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { configure, createGatewayApp, login, sleep, startUpstream } = require("./helpers.cjs");

const eventId = "8f1b2c3d-0000-4000-8000-000000000001";
let upstream;

before(async () => {
  upstream = await startUpstream();
  configure({ QUEUE_URL: upstream.url });
  // The queue answers the stream late, then keeps it open: a buyer with a long wait ahead.
  upstream.respond = (request, response) =>
    setTimeout(() => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write('event: position\ndata: {"position":3}\n\n');
    }, 800);
});
after(() => upstream.close());

const outcomeOf = (closing) => Promise.race([closing.then(() => "closed"), sleep(5000).then(() => "hung")]);

test("SIGTERM while a stream waits for the queue's headers: the shutdown does not wait for that stream", async () => {
  const app = await createGatewayApp({ listening: true });
  const buyer = await login(app);
  const opening = fetch(`${await app.getUrl()}/api/v1/queue/${eventId}/stream`, {
    headers: { authorization: `Bearer ${buyer.token}` },
  }).catch(() => undefined);
  await sleep(200); // the Gateway is waiting for the queue's headers (they come at 800 ms)

  assert.equal(await outcomeOf(app.close()), "closed", "app.close() waited for a stream that opened after the drain");
  await opening;
});

test("a stream asked for after the drain already ran is refused, not opened for good", async () => {
  const app = await createGatewayApp({ listening: true });
  const buyer = await login(app);
  const { ShutdownService } = require("@aforo/common/nest");
  await app.get(ShutdownService).beforeApplicationShutdown("SIGTERM"); // the drain runs with nothing open

  const response = await fetch(`${await app.getUrl()}/api/v1/queue/${eventId}/stream`, {
    headers: { authorization: `Bearer ${buyer.token}` },
  });
  assert.equal(response.status, 500, "the client falls back to polling, which the next instance answers");
  assert.equal((await response.json()).code, "INTERNAL");
  assert.equal(await outcomeOf(app.close()), "closed");
});
