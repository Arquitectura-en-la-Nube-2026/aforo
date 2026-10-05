// SSE against a real HTTP server (light-my-request cannot stream). Two instances share the one Redis.
const assert = require("node:assert/strict");
const { after, before } = require("node:test");
const { configure, createListeningApp, randomUUID, readSse, seedEvent, sleep, untilRedisReady, useRedisApp } = require("./helpers.cjs");

configure({ ADMISSION_BATCH_SIZE: "2", ADMISSION_INTERVAL_SECONDS: "3600", PASS_TTL_SECONDS: "600", SSE_HEARTBEAT_SECONDS: "1" });

const { state, redisTest } = useRedisApp({ listening: true });
let other = null; // a second instance, on its own port
before(async () => {
  if (state.skip) return;
  other = await createListeningApp();
  await untilRedisReady(other.app);
});
after(async () => {
  if (other) await other.app.close();
});

const queueOf = (app) => app.get(require("../dist/queue/queue.service").QueueService);
const admissionOf = (app) => app.get(require("../dist/queue/admission.service").AdmissionService);
const users = (count) => Array.from({ length: count }, () => randomUUID());
const tickMs = 3600 * 1000;
const open = (base, eventId, userId) => fetch(`${base}/api/v1/queue/${eventId}/stream`, { headers: { "x-user-id": userId } });

redisTest("the stream sends a snapshot first, with the SSE headers, and keep-alives while nothing changes", async () => {
  const eventId = await seedEvent(state.app);
  const [a] = users(1);
  await queueOf(state.app).join(eventId, a, Date.now());

  const response = await open(state.base, eventId, a);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/event-stream/);
  assert.match(response.headers.get("cache-control"), /no-cache/);
  assert.match(response.headers.get("x-correlation-id"), /^[0-9a-f-]{36}$/i);

  const { messages, raw, ended } = await readSse(response, (_, text) => text.includes(": keep-alive"), 4000);
  assert.equal(ended, false, "a buyer who is still waiting keeps the stream open");
  assert.equal(messages.length, 1, "no repeated position while nothing changes");
  assert.equal(messages[0].event, "position");
  assert.equal(messages[0].data.position, 1);
  assert.match(raw, /: keep-alive/);
});

redisTest("a buyer who is not in the queue gets a normal 404 problem+json, not an empty stream", async () => {
  const eventId = await seedEvent(state.app);
  const response = await open(state.base, eventId, randomUUID());
  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type"), /^application\/problem\+json/);
  assert.equal((await response.json()).code, "NOT_FOUND");
});

redisTest("an admission done by ANOTHER instance reaches a stream connected to this one, and the server ends it", async () => {
  // The tick lock goes to whichever instance wakes first, often not the one this buyer is connected to. A stream
  // that only listened locally would send keep-alives forever and the buyer would wait until the pass was lost.
  const eventId = await seedEvent(state.app);
  const [a] = users(1);
  await queueOf(state.app).join(eventId, a, Date.now());

  const response = await open(state.base, eventId, a); // connected to instance 1
  // Read until the server closes the stream (the timeout is only the upper bound for a failing run).
  const reading = readSse(response, () => false, 6000);
  await sleep(300);
  assert.equal(await admissionOf(other.app).admitTick(Date.now()), 1); // admitted by instance 2

  const { messages, ended } = await reading;
  const admitted = messages.find((m) => m.event === "admitted");
  assert.ok(admitted, `no admitted event, got ${JSON.stringify(messages)}`);
  assert.equal(admitted.data.state, "ADMITTED");
  assert.equal(admitted.data.position, 0);
  assert.match(admitted.data.passToken, /^p_/);
  assert.equal(ended, true, "after admitted the server closes the stream");
});

redisTest("an admission between join and opening the stream is not missed: the snapshot already says ADMITTED", async () => {
  const eventId = await seedEvent(state.app);
  const [a] = users(1);
  await queueOf(state.app).join(eventId, a, Date.now());
  await admissionOf(state.app).admitTick(Date.now()); // happens before the client opens the stream

  const { messages, ended } = await readSse(await open(state.base, eventId, a), () => false, 3000);
  assert.deepEqual(messages.map((m) => m.event), ["admitted"]);
  assert.equal(ended, true);
});

redisTest("the stream announces each change of position, then admitted, over one connection", async () => {
  const eventId = await seedEvent(state.app);
  const [a, b, c] = users(3);
  const now = Date.now();
  for (const [i, user] of [a, b, c].entries()) await queueOf(state.app).join(eventId, user, now + i);

  const response = await open(state.base, eventId, c); // third in line, batch of 2
  const reading = readSse(response, () => false, 8000); // until the server closes it
  await sleep(300);
  await admissionOf(state.app).admitTick(now); // a and b leave: c is now first
  await sleep(1500);
  await admissionOf(other.app).admitTick(now + tickMs); // c is admitted

  const { messages, ended } = await reading;
  assert.deepEqual(
    messages.map((m) => `${m.event}:${m.data.position}`),
    ["position:3", "position:1", "admitted:0"],
  );
  assert.equal(ended, true);
});

redisTest("a stream that opens after the shutdown drain already ran is ended too, after its snapshot", async () => {
  // stream() reads the first status before registering itself. A SIGTERM landing in that read ran the
  // drain without it, and the stream then stayed open, holding the HTTP server past Cloud Run's ~10 s.
  const doomed = await createListeningApp();
  await untilRedisReady(doomed.app);
  const eventId = await seedEvent(doomed.app);
  const [a] = users(1);
  await queueOf(doomed.app).join(eventId, a, Date.now());

  const { ShutdownService } = require("@aforo/common/nest");
  await doomed.app.get(ShutdownService).beforeApplicationShutdown("SIGTERM"); // the drain runs with no stream open

  try {
    const { ended, messages } = await readSse(await open(doomed.base, eventId, a), () => false, 3000);
    assert.equal(messages.length, 1, "it still gets its snapshot");
    assert.equal(ended, true, "the stream must end at once, not stay open after the drain");
  } finally {
    await doomed.app.close();
  }
});

redisTest("shutting an instance down closes its open streams instead of waiting for them", async () => {
  // An open stream is an in-flight request: without the drain hook the HTTP server would wait for it
  // until Cloud Run kills the instance.
  const doomed = await createListeningApp();
  await untilRedisReady(doomed.app);
  const eventId = await seedEvent(doomed.app);
  const [a] = users(1);
  await queueOf(doomed.app).join(eventId, a, Date.now());

  const reading = readSse(await open(doomed.base, eventId, a), () => false, 8000);
  await sleep(300);
  const closing = doomed.app.close();
  const outcome = await Promise.race([closing.then(() => "closed"), sleep(4000).then(() => "hung")]);
  assert.equal(outcome, "closed", "app.close() waited for an open stream");
  const { ended, messages } = await reading;
  assert.equal(ended, true, "the client saw the stream end");
  assert.equal(messages.length, 1, "it got its snapshot and nothing else");
});
