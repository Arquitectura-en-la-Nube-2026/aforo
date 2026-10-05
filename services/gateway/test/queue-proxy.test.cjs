const assert = require("node:assert/strict");
const { after, before, beforeEach, test } = require("node:test");
const { FRONTEND_ORIGIN, configure, createGatewayApp, login, randomUUID, sleep, startUpstream } = require("./helpers.cjs");

let upstream;
let app;
let base;
let defaultRespond;
before(async () => {
  upstream = await startUpstream();
  defaultRespond = upstream.respond;
  configure({ QUEUE_URL: upstream.url }); // no Redis: the quota is off, these tests are about the proxy
  app = await createGatewayApp({ listening: true });
  base = await app.getUrl();
});
after(async () => {
  await app.close().catch(() => undefined); // the last test already closed it
  await upstream.close();
});
beforeEach(() => {
  upstream.requests.length = 0;
  upstream.respond = defaultRespond;
});

const inject = (options) => app.getHttpAdapter().getInstance().inject(options);
const eventId = "8f1b2c3d-0000-4000-8000-000000000001";

test("the queue routes need a session: without a token the queue service is never called", async () => {
  for (const [method, suffix] of [["POST", "join"], ["GET", "status"], ["GET", "stream"]]) {
    const response = await inject({ method, url: `/api/v1/queue/${eventId}/${suffix}` });
    assert.equal(response.statusCode, 401, `${method} ${suffix}`);
    assert.equal(response.json().code, "UNAUTHENTICATED");
  }
  const forged = await inject({ method: "POST", url: `/api/v1/queue/${eventId}/join`, headers: { authorization: "Bearer not.a.jwt" } });
  assert.equal(forged.statusCode, 401);
  assert.equal(upstream.requests.length, 0);
});

test("join is forwarded with the identity from the token, and the answer comes back unchanged", async () => {
  const buyer = await login(app);
  const response = await inject({
    method: "POST",
    url: `/api/v1/queue/${eventId}/join`,
    headers: { authorization: `Bearer ${buyer.token}`, "x-queue-pass": "p_previous" },
  });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json(), { state: "WAITING", position: 1 });
  assert.match(response.headers["content-type"], /^application\/json/);

  assert.equal(upstream.requests.length, 1);
  const [sent] = upstream.requests;
  assert.equal(sent.method, "POST");
  assert.equal(sent.url, `/api/v1/queue/${eventId}/join`);
  assert.equal(sent.headers["x-user-id"], buyer.userId);
  assert.equal(sent.headers["x-user-email"], buyer.email);
  assert.equal(sent.headers["x-correlation-id"], response.headers["x-correlation-id"], "the same id travels end to end");
  assert.equal(sent.headers["x-queue-pass"], "p_previous", "forwarded for logging, never verified (D-07)");
});

test("a browser cannot choose who it is: X-User-Id and X-User-Email from the client are never copied", async () => {
  const buyer = await login(app);
  const victim = randomUUID();
  await inject({
    method: "POST",
    url: `/api/v1/queue/${eventId}/join`,
    headers: {
      authorization: `Bearer ${buyer.token}`,
      "x-user-id": victim,
      "x-user-email": "victim@example.com",
      cookie: "session=secret",
      "x-forwarded-user": victim,
    },
  });
  const [sent] = upstream.requests;
  assert.equal(sent.headers["x-user-id"], buyer.userId, "joining as someone else must be impossible");
  assert.notEqual(sent.headers["x-user-id"], victim);
  assert.equal(sent.headers["x-user-email"], buyer.email);
  assert.equal(sent.headers.authorization, undefined, "the user token is never forwarded to a logic service");
  assert.equal(sent.headers.cookie, undefined);
  assert.equal(sent.headers["x-forwarded-user"], undefined, "only the headers the Gateway chooses travel");
});

test("status passes the queue's problem+json through with its status, type and correlation id", async () => {
  const buyer = await login(app);
  upstream.respond = (request, response) => {
    response.writeHead(409, { "content-type": "application/problem+json" });
    response.end(JSON.stringify({ code: "SALE_NOT_OPEN", status: 409, correlationId: request.headers["x-correlation-id"] }));
  };
  const response = await inject({ method: "GET", url: `/api/v1/queue/${eventId}/status`, headers: { authorization: `Bearer ${buyer.token}` } });
  assert.equal(response.statusCode, 409);
  assert.match(response.headers["content-type"], /^application\/problem\+json/);
  assert.equal(response.json().code, "SALE_NOT_OPEN");
  assert.equal(response.json().correlationId, response.headers["x-correlation-id"]);
});

test("only the three queue operations with a UUID event id reach the queue service", async () => {
  const buyer = await login(app);
  const headers = { authorization: `Bearer ${buyer.token}` };
  for (const bad of ["not-a-uuid", "00000000-0000-0000-0000-00000000000g", "..%2F..%2Finternal%2Fv1", `${eventId}%2F..%2Fx`]) {
    const response = await inject({ method: "POST", url: `/api/v1/queue/${bad}/join`, headers });
    assert.ok([404, 422].includes(response.statusCode), `${bad} answered ${response.statusCode}`);
  }
  // The internal routes of the queue service (Pub/Sub push) must never be reachable through the Gateway.
  for (const url of ["/internal/v1/events/queue-event-published", "/api/v1/queue/internal/v1/events/queue-sales-rules"]) {
    const response = await inject({ method: "POST", url, headers, payload: {} });
    assert.equal(response.statusCode, 404, url);
  }
  assert.equal((await inject({ method: "DELETE", url: `/api/v1/queue/${eventId}/join`, headers })).statusCode, 404);
  assert.equal(upstream.requests.length, 0, "none of that may reach the queue service");
});

test("an unreachable queue service is a 500 INTERNAL problem+json, not a hang or a crash", async () => {
  const buyer = await login(app);
  await upstream.close();
  try {
    const response = await inject({ method: "GET", url: `/api/v1/queue/${eventId}/status`, headers: { authorization: `Bearer ${buyer.token}` } });
    assert.equal(response.statusCode, 500);
    assert.match(response.headers["content-type"], /^application\/problem\+json/);
    assert.equal(response.json().code, "INTERNAL");
    assert.match(response.json().correlationId, /^[0-9a-f-]{36}$/i);
  } finally {
    // Bring the fake back on the same port for the next tests.
    const port = new URL(upstream.url).port;
    await new Promise((resolve) => upstream.server.listen(Number(port), "127.0.0.1", resolve));
  }
});

test("a queue service that never answers is cut off after the response timeout", async () => {
  const buyer = await login(app);
  upstream.respond = () => undefined; // accepts the request and stays silent
  const startedAt = Date.now();
  const response = await inject({ method: "GET", url: `/api/v1/queue/${eventId}/status`, headers: { authorization: `Bearer ${buyer.token}` } });
  const elapsed = Date.now() - startedAt;
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().code, "INTERNAL");
  assert.ok(elapsed >= 2000 && elapsed < 4000, `answered after ${elapsed} ms`);
});

test("the stream is passed through as it arrives: the first event is not held back until the upstream ends", async () => {
  const buyer = await login(app);
  const sentAt = {};
  upstream.respond = (request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.write('event: position\ndata: {"position":3}\n\n');
    sentAt.first = Date.now();
    setTimeout(() => {
      sentAt.last = Date.now();
      response.end('event: admitted\ndata: {"position":0}\n\n');
    }, 700);
  };

  const response = await fetch(`${base}/api/v1/queue/${eventId}/stream`, {
    headers: { authorization: `Bearer ${buyer.token}`, origin: FRONTEND_ORIGIN },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/event-stream/);
  assert.match(response.headers.get("cache-control"), /no-cache/);
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.equal(response.headers.get("access-control-allow-origin"), FRONTEND_ORIGIN, "the browser needs CORS on the stream too");
  assert.match(response.headers.get("access-control-expose-headers"), /Retry-After/);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const first = await reader.read();
  const firstArrivedAt = Date.now();
  assert.match(decoder.decode(first.value), /event: position/);
  assert.ok(firstArrivedAt < sentAt.first + 400 && firstArrivedAt < (sentAt.first + 700), "buffered until the end would arrive after ~700 ms");

  let rest = "";
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    rest += decoder.decode(next.value);
  }
  assert.match(rest, /event: admitted/);
  assert.equal(upstream.requests[0].url, `/api/v1/queue/${eventId}/stream`);
  assert.equal(upstream.requests[0].headers.accept, "text/event-stream");
});

test("when the client leaves, the Gateway stops reading from the queue service", async () => {
  const buyer = await login(app);
  let upstreamClosed = false;
  upstream.respond = (request, response) => {
    request.socket.once("close", () => { upstreamClosed = true; });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write('event: position\ndata: {"position":3}\n\n'); // and then keeps the stream open
  };
  const response = await fetch(`${base}/api/v1/queue/${eventId}/stream`, { headers: { authorization: `Bearer ${buyer.token}` } });
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel(); // the buyer closes the tab

  for (let i = 0; i < 20 && !upstreamClosed; i += 1) await sleep(50);
  assert.equal(upstreamClosed, true, "the upstream connection leaked: every closed tab would keep one open");
});

test("a client that leaves before the queue service answers does not leave the upstream stream open", async () => {
  // The close listener used to be added only after the upstream headers arrived. A buyer who closed the
  // tab at 100 ms, with the queue answering at 500 ms, had already fired it: nothing aborted the upstream
  // and the Gateway kept reading a stream nobody would receive, until that buyer was admitted.
  const buyer = await login(app);
  let upstreamClosed = false;
  upstream.respond = (request, response) => {
    request.socket.once("close", () => { upstreamClosed = true; });
    setTimeout(() => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write('event: position\ndata: {"position":3}\n\n'); // and then keeps the stream open
    }, 500);
  };
  const client = new AbortController();
  const request = fetch(`${base}/api/v1/queue/${eventId}/stream`, {
    headers: { authorization: `Bearer ${buyer.token}` },
    signal: client.signal,
  }).catch(() => undefined);
  await sleep(100);
  client.abort(); // the buyer closes the tab before the queue service answers
  await request;

  for (let i = 0; i < 30 && !upstreamClosed; i += 1) await sleep(50);
  assert.equal(upstreamClosed, true, "the upstream connection leaked after an early disconnect");
});

test("an error from the queue before the stream starts is a normal problem+json, not an empty stream", async () => {
  const buyer = await login(app);
  upstream.respond = (request, response) => {
    response.writeHead(404, { "content-type": "application/problem+json" });
    response.end(JSON.stringify({ code: "NOT_FOUND", status: 404 }));
  };
  const response = await fetch(`${base}/api/v1/queue/${eventId}/stream`, { headers: { authorization: `Bearer ${buyer.token}` } });
  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type"), /^application\/problem\+json/);
  assert.equal((await response.json()).code, "NOT_FOUND");
});

test("shutting the Gateway down ends the open streams instead of waiting for them", async () => {
  // Runs last on purpose: it closes the shared app.
  const buyer = await login(app);
  upstream.respond = (request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write('event: position\ndata: {"position":3}\n\n');
  };
  const response = await fetch(`${base}/api/v1/queue/${eventId}/stream`, { headers: { authorization: `Bearer ${buyer.token}` } });
  const reader = response.body.getReader();
  await reader.read();

  const closing = app.close();
  const outcome = await Promise.race([closing.then(() => "closed"), sleep(4000).then(() => "hung")]);
  assert.equal(outcome, "closed", "app.close() waited for an open stream");
  const ended = await Promise.race([reader.read().then((next) => next.done), sleep(2000).then(() => false)]);
  assert.equal(ended, true, "the client saw the stream end");
});
