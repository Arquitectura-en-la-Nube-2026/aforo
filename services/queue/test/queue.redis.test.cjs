const assert = require("node:assert/strict");
const { configure, envelope, eventPublished, join, randomUUID, salesRules, seedEvent, sleep, status, useRedisApp } = require("./helpers.cjs");

// Batch 2 so a handful of buyers is enough to see admission, and a tick of an hour so the timer never
// fires by itself: the tests drive admission with admitTick(now).
configure({ ADMISSION_BATCH_SIZE: "2", ADMISSION_INTERVAL_SECONDS: "3600", PASS_TTL_SECONDS: "600" });

const { state, redisTest } = useRedisApp();
const queue =() => state.app.get(require("../dist/queue/queue.service").QueueService);
const admission = () => state.app.get(require("../dist/queue/admission.service").AdmissionService);
const users = (count) => Array.from({ length: count }, () => randomUUID());
const tickMs = 3600 * 1000;

redisTest("an event without a projection is 404, and so is one that only has its sales rules", async () => {
  const unknown = randomUUID();
  const [user] = users(1);
  const response = await join(state.app, unknown, user);
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().code, "NOT_FOUND");

  // SalesRulesConfigured alone cannot say whether the sale is open: still unknown.
  const server = state.app.getHttpAdapter().getInstance();
  const rules = await server.inject({ method: "POST", url: "/internal/v1/events/queue-sales-rules", payload: salesRules(unknown, 30) });
  assert.equal(rules.statusCode, 204);
  assert.equal((await join(state.app, unknown, user)).statusCode, 404);

  // Once EventPublished arrives (in either order) the event is known.
  const published = await server.inject({
    method: "POST",
    url: "/internal/v1/events/queue-event-published",
    payload: eventPublished(unknown, { opensAt: Date.now() - 1000, closesAt: Date.now() + 60_000 }),
  });
  assert.equal(published.statusCode, 204);
  assert.equal((await join(state.app, unknown, user)).statusCode, 201);
});

redisTest("joining before the sale opens or after it closes is 409 SALE_NOT_OPEN and leaves no entry", async () => {
  const [early, late] = users(2);
  const notYet = await seedEvent(state.app, { opensAt: Date.now() + 3_600_000, closesAt: Date.now() + 7_200_000 });
  const closed = await seedEvent(state.app, { opensAt: Date.now() - 7_200_000, closesAt: Date.now() - 3_600_000 });

  for (const [eventId, user] of [[notYet, early], [closed, late]]) {
    const response = await join(state.app, eventId, user);
    assert.equal(response.statusCode, 409);
    assert.match(response.headers["content-type"], /^application\/problem\+json/);
    assert.equal(response.json().code, "SALE_NOT_OPEN");
    assert.equal((await status(state.app, eventId, user)).statusCode, 404, "a rejected join must not queue the buyer");
  }
});

redisTest("join returns the QueueStatus of the contract, keeps the place on re-join and counts positions", async () => {
  const eventId = await seedEvent(state.app);
  const [a, b, c] = users(3);

  const first = await join(state.app, eventId, a);
  assert.equal(first.statusCode, 201);
  assert.deepEqual(Object.keys(first.json()).sort(), ["aheadOf", "estimatedWaitSeconds", "eventId", "passExpiresAt", "passToken", "position", "state"]);
  assert.deepEqual(first.json(), {
    eventId,
    state: "WAITING",
    position: 1,
    aheadOf: 0,
    estimatedWaitSeconds: 3600, // one tick of 3600 s for positions 1..2
    passToken: null,
    passExpiresAt: null,
  });

  assert.equal((await join(state.app, eventId, b)).json().position, 2);
  const third = (await join(state.app, eventId, c)).json();
  assert.equal(third.position, 3);
  assert.equal(third.aheadOf, 2);
  assert.equal(third.estimatedWaitSeconds, 7200, "position 3 needs the second tick (batch 2)");

  // Re-joining keeps the place (natural idempotency): nobody moves, nobody is duplicated.
  assert.equal((await join(state.app, eventId, a)).json().position, 1);
  assert.equal((await join(state.app, eventId, b)).json().position, 2);
  assert.equal(await state.redis.zcard(`queue:${eventId}`), 3);

  // status answers what join answered.
  assert.deepEqual((await status(state.app, eventId, c)).json(), third);
  assert.equal((await status(state.app, eventId, randomUUID())).statusCode, 404, "a buyer who never joined");
});

redisTest("admission takes the first buyers in order and hands each a pass; the rest move up", async () => {
  const eventId = await seedEvent(state.app);
  const [a, b, c] = users(3);
  const now = Date.now();
  for (const [i, user] of [a, b, c].entries()) await queue().join(eventId, user, now + i);

  assert.equal(await admission().admitTick(now), 2, "the batch is 2");

  for (const user of [a, b]) {
    const response = await status(state.app, eventId, user);
    assert.equal(response.statusCode, 200);
    const admitted = response.json();
    assert.equal(admitted.state, "ADMITTED");
    assert.equal(admitted.position, 0);
    assert.equal(admitted.aheadOf, 0);
    assert.equal(admitted.estimatedWaitSeconds, 0);
    assert.match(admitted.passToken, /^p_[A-Za-z0-9_-]{24}$/);
    assert.equal(admitted.passExpiresAt, new Date(Math.floor((now + 600_000) / 1000) * 1000).toISOString().replace(".000Z", "Z"));
  }
  assert.notEqual((await status(state.app, eventId, a)).json().passToken, (await status(state.app, eventId, b)).json().passToken);

  // The third buyer is now first. Pass keys carry a TTL of the pass validity, and the buyers left the queue.
  const waiting = (await status(state.app, eventId, c)).json();
  assert.equal(waiting.state, "WAITING");
  assert.equal(waiting.position, 1);
  const ttl = await state.redis.ttl(`admitted:${eventId}:${a}`);
  assert.ok(ttl > 590 && ttl <= 600, `pass TTL was ${ttl}`);
  assert.equal(await state.redis.zscore(`queue:${eventId}`, a), null);
});

redisTest("a buyer who joins after being admitted gets the same pass back, not a new place in the queue", async () => {
  const eventId = await seedEvent(state.app);
  const [a] = users(1);
  await queue().join(eventId, a, Date.now());
  await admission().admitTick(Date.now());
  const pass = (await status(state.app, eventId, a)).json();

  const again = await join(state.app, eventId, a);
  assert.equal(again.statusCode, 201);
  assert.deepEqual(again.json(), pass);
  assert.equal(await state.redis.zscore(`queue:${eventId}`, a), null, "admitted and waiting at once would be a bug");
});

redisTest("a buyer who holds a pass keeps it even if the sale closes before they join again", async () => {
  const closesIn = 3000;
  const eventId = await seedEvent(state.app, { closesAt: Date.now() + closesIn });
  const [holder, newcomer] = users(2);
  await queue().join(eventId, holder, Date.now());
  await admission().admitTick(Date.now());
  await sleep(closesIn + 200);

  assert.equal((await join(state.app, eventId, holder)).json().state, "ADMITTED");
  assert.equal((await join(state.app, eventId, newcomer)).json().code, "SALE_NOT_OPEN");
});

redisTest("a buyer still waiting when the sale closes keeps the place on re-join, as admission still serves them", async () => {
  // Admission keeps serving the queue after the close; a re-join (a page reload) answered 409 "not open"
  // to a buyer who was about to get a pass, while a newcomer must still get 409.
  const closesIn = 1000;
  const eventId = await seedEvent(state.app, { closesAt: Date.now() + closesIn });
  const [waiter, newcomer] = users(2);
  await queue().join(eventId, waiter, Date.now());
  await sleep(closesIn + 200);

  const rejoined = await join(state.app, eventId, waiter);
  assert.equal(rejoined.statusCode, 201);
  assert.equal(rejoined.json().state, "WAITING");
  assert.equal(rejoined.json().position, 1);
  assert.equal((await join(state.app, eventId, newcomer)).json().code, "SALE_NOT_OPEN");
});

redisTest("two ticks in the same interval admit once; the next interval admits the next batch", async () => {
  const eventId = await seedEvent(state.app);
  const [a, b, c, d] = users(4);
  const now = Date.now();
  for (const [i, user] of [a, b, c, d].entries()) await queue().join(eventId, user, now + i);

  assert.equal(await admission().admitTick(now), 2);
  assert.equal(await admission().admitTick(now + 10), 0, "same tick: the lock is already taken");
  assert.equal((await status(state.app, eventId, c)).json().state, "WAITING");
  assert.equal(await admission().admitTick(now + tickMs), 2, "next tick: the next two");
  assert.equal((await status(state.app, eventId, d)).json().state, "ADMITTED");
});

redisTest("an expired pass is 404 on status, and joining again puts the buyer at the end", async () => {
  const eventId = await seedEvent(state.app);
  const [a, b] = users(2);
  const now = Date.now();
  await queue().join(eventId, a, now);
  await admission().admitTick(now);
  await queue().join(eventId, b, now + 1);

  await state.redis.pexpire(`admitted:${eventId}:${a}`, 1); // the pass TTL runs out
  await sleep(20);
  assert.equal((await status(state.app, eventId, a)).statusCode, 404);

  const rejoined = (await join(state.app, eventId, a)).json();
  assert.equal(rejoined.state, "WAITING");
  assert.equal(rejoined.position, 2, "b was already waiting, so a comes after");
});

redisTest("RF-05: inside the opening window the order is random; after it, it is arrival order", async () => {
  const opensAt = Date.now() - 10_000;
  // Joined inside the window (10 s after it opened, window is 60 s): the order must not follow arrival.
  const inWindow = await seedEvent(state.app, { opensAt, windowSeconds: 60 });
  const crowd = users(30);
  for (const [i, user] of crowd.entries()) await queue().join(inWindow, user, opensAt + 10_000 + i);
  const positions = [];
  for (const user of crowd) positions.push((await status(state.app, inWindow, user)).json().position);
  assert.deepEqual([...positions].sort((x, y) => x - y), crowd.map((_, i) => i + 1), "every place is taken once");
  assert.notDeepEqual(positions, crowd.map((_, i) => i + 1), "30 buyers landing in arrival order by chance is 1 in 30!");

  // Joined after the window: arrival order, exactly.
  const afterWindow = await seedEvent(state.app, { opensAt: Date.now() - 120_000, windowSeconds: 30 });
  const later = users(10);
  const base = Date.now();
  for (const [i, user] of later.entries()) await queue().join(afterWindow, user, base + i * 5);
  const order = [];
  for (const user of later) order.push((await status(state.app, afterWindow, user)).json().position);
  assert.deepEqual(order, later.map((_, i) => i + 1));
});

redisTest("everyone who joined inside the window sorts before everyone who joins after it", async () => {
  const opensAt = Date.now() - 40_000;
  const eventId = await seedEvent(state.app, { opensAt, windowSeconds: 30 });
  const early = users(5);
  const late = users(5);
  // "Early" arrived inside the window, "late" 30 s after it ended (the window closed at opensAt + 30 s).
  for (const [i, user] of early.entries()) await queue().join(eventId, user, opensAt + 1000 + i);
  for (const [i, user] of late.entries()) await queue().join(eventId, user, opensAt + 60_000 + i);
  const earlyPositions = [];
  const latePositions = [];
  for (const user of early) earlyPositions.push((await status(state.app, eventId, user)).json().position);
  for (const user of late) latePositions.push((await status(state.app, eventId, user)).json().position);
  assert.ok(Math.max(...earlyPositions) < Math.min(...latePositions), `${earlyPositions} vs ${latePositions}`);
});

redisTest("the projection does not depend on which event arrives first", async () => {
  const eventId = randomUUID();
  const server = state.app.getHttpAdapter().getInstance();
  // Rules first, with a 600 s window; then EventPublished. Neither may overwrite the other.
  await server.inject({ method: "POST", url: "/internal/v1/events/queue-sales-rules", payload: salesRules(eventId, 600) });
  await server.inject({
    method: "POST",
    url: "/internal/v1/events/queue-event-published",
    payload: eventPublished(eventId, { opensAt: Date.now() - 1000, closesAt: Date.now() + 60_000 }),
  });
  const stored = await state.redis.hgetall(`event:${eventId}`);
  assert.equal(stored.openingWindowSeconds, "600", "EventPublished must not erase the rules that came first");
  assert.ok(stored.salesOpensAt && stored.salesClosesAt, "the rules must not erase the sale window either");
  assert.equal((await join(state.app, eventId, randomUUID())).statusCode, 201);
});

redisTest("a redelivered message is not applied twice, and a new message id is", async () => {
  const eventId = randomUUID();
  const server = state.app.getHttpAdapter().getInstance();
  const url = "/internal/v1/events/queue-sales-rules";
  const body = salesRules(eventId, 30);

  assert.equal((await server.inject({ method: "POST", url, payload: body })).statusCode, 204);
  assert.equal(await state.redis.hget(`event:${eventId}`, "openingWindowSeconds"), "30");

  // Someone changes the projection by hand; the same Pub/Sub message arrives again (at-least-once delivery).
  await state.redis.hset(`event:${eventId}`, "openingWindowSeconds", "99");
  assert.equal((await server.inject({ method: "POST", url, payload: body })).statusCode, 204);
  assert.equal(await state.redis.hget(`event:${eventId}`, "openingWindowSeconds"), "99", "the duplicate must be skipped");

  // A different message (new messageId) with new rules is applied.
  assert.equal((await server.inject({ method: "POST", url, payload: salesRules(eventId, 45) })).statusCode, 204);
  assert.equal(await state.redis.hget(`event:${eventId}`, "openingWindowSeconds"), "45");
});

redisTest("concurrent projection deliveries update the projection and inbox only once", async () => {
  const { RedisService } = require("../dist/redis/redis.service");
  const client = state.app.get(RedisService).redis;
  const eventId = randomUUID();
  const messageId = randomUUID();
  const projectionKey = `event:${eventId}`;
  const inboxKey = `inbox:${messageId}`;
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      client.projectionUpsert(projectionKey, inboxKey, "rulesAt", Date.now(), 86400, "openingWindowSeconds", "45"),
    ),
  );

  assert.equal(results.filter((result) => result === 1).length, 1, "one delivery applies the effect");
  assert.equal(results.filter((result) => result === 2).length, 9, "the others see the inbox marker");
  assert.equal(await state.redis.hget(projectionKey, "openingWindowSeconds"), "45");
  assert.equal(await state.redis.exists(inboxKey), 1);
});

redisTest("a projection failure leaves no inbox marker and a redelivery succeeds", async () => {
  const eventId = randomUUID();
  const body = salesRules(eventId, 30);
  const inboxKey = `inbox:${JSON.parse(Buffer.from(body.message.data, "base64").toString("utf8")).messageId}`;
  const projectionKey = `event:${eventId}`;
  const server = state.app.getHttpAdapter().getInstance();

  await state.redis.set(projectionKey, "wrong type");
  const failed = await server.inject({ method: "POST", url: "/internal/v1/events/queue-sales-rules", payload: body });
  assert.equal(failed.statusCode, 500);
  assert.equal(await state.redis.exists(inboxKey), 0);

  await state.redis.del(projectionKey);
  const retried = await server.inject({ method: "POST", url: "/internal/v1/events/queue-sales-rules", payload: body });
  assert.equal(retried.statusCode, 204);
  assert.equal(await state.redis.hget(projectionKey, "openingWindowSeconds"), "30");
  assert.equal(await state.redis.exists(inboxKey), 1);
});

redisTest("an older message that arrives late does not overwrite a newer one", async () => {
  // Catalog re-emits SalesRulesConfigured when the rules change, and Pub/Sub does not keep the order. The
  // window went from 0 to 60 s; the old message (0) arriving last used to win, and the lottery was gone.
  const eventId = randomUUID();
  const server = state.app.getHttpAdapter().getInstance();
  const now = Date.now();
  const push = (url, payload) => server.inject({ method: "POST", url, payload });
  const rulesUrl = "/internal/v1/events/queue-sales-rules";
  const publishedUrl = "/internal/v1/events/queue-event-published";

  assert.equal((await push(rulesUrl, salesRules(eventId, 60, now))).statusCode, 204);
  assert.equal((await push(rulesUrl, salesRules(eventId, 0, now - 5000))).statusCode, 204, "acknowledged, not retried");
  assert.equal(await state.redis.hget(`event:${eventId}`, "openingWindowSeconds"), "60");

  // The same for the sale window, and each kind keeps its own clock: the old rules did not hold back
  // a newer EventPublished, nor the other way round.
  const closesAt = now + 60_000;
  await push(publishedUrl, eventPublished(eventId, { opensAt: now - 1000, closesAt, occurredAt: now - 10_000 }));
  await push(publishedUrl, eventPublished(eventId, { opensAt: now - 1000, closesAt: now - 500, occurredAt: now - 20_000 }));
  assert.equal(await state.redis.hget(`event:${eventId}`, "salesClosesAt"), new Date(closesAt).toISOString());
});

redisTest("a message whose data breaks its schema is 400 and writes nothing", async () => {
  const eventId = randomUUID();
  const server = state.app.getHttpAdapter().getInstance();
  const empty = await server.inject({
    method: "POST",
    url: "/internal/v1/events/queue-event-published",
    payload: envelope("EventPublished", {}),
  });
  assert.equal(empty.statusCode, 400);
  assert.equal(empty.json().code, "MALFORMED_REQUEST");

  const negative = await server.inject({
    method: "POST",
    url: "/internal/v1/events/queue-sales-rules",
    payload: envelope("SalesRulesConfigured", { eventId, maxTicketsPerPerson: 4, reservationTtlSeconds: 480, openingWindowSeconds: -5 }),
  });
  assert.equal(negative.statusCode, 400);
  assert.equal(await state.redis.exists(`event:${eventId}`), 0);
});
