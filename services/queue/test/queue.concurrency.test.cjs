// The rules that only break when two things happen at once: a join racing an admission, a status read
// racing an admission, and two instances racing for the same tick. Two apps in this process share the
// one Redis, exactly like two Cloud Run instances.
const assert = require("node:assert/strict");
const { after, before } = require("node:test");
const { configure, createApp, randomUUID, seedEvent, sleep, untilRedisReady, useRedisApp } = require("./helpers.cjs");

configure({ ADMISSION_BATCH_SIZE: "3", ADMISSION_INTERVAL_SECONDS: "3600", PASS_TTL_SECONDS: "600" });

const { state, redisTest } = useRedisApp();
let other = null; // the second instance
before(async () => {
  if (state.skip) return;
  other = await createApp();
  await untilRedisReady(other);
});
after(async () => {
  if (other) await other.close();
});

const queueOf = (app) => app.get(require("../dist/queue/queue.service").QueueService);
const admissionOf = (app) => app.get(require("../dist/queue/admission.service").AdmissionService);
const users = (count) => Array.from({ length: count }, () => randomUUID());
const tickMs = 3600 * 1000;

/** Every buyer who joined is either in the queue or holds a pass: never both, never neither. */
async function assertEveryoneInExactlyOnePlace(redis, eventId, crowd) {
  const both = [];
  const neither = [];
  for (const user of crowd) {
    const waiting = (await redis.zscore(`queue:${eventId}`, user)) !== null;
    const admitted = (await redis.exists(`admitted:${eventId}:${user}`)) === 1;
    if (waiting && admitted) both.push(user);
    if (!waiting && !admitted) neither.push(user);
  }
  assert.deepEqual(both, [], "admitted AND still waiting");
  assert.deepEqual(neither, [], "lost: neither waiting nor admitted");
}

redisTest("a RE-join racing the admission never leaves a buyer both admitted and waiting, or lost", async () => {
  // The race needs a buyer who is already queued: the admission can only pop someone who is in the queue.
  // A join that checks "no pass" and then adds to the queue as two commands loses to an admission in
  // between: the admission pops the buyer and gives a pass, and the late ZADD puts them back in the queue,
  // admitted AND waiting. It happens in real life when a buyer reloads the page or opens a second tab at
  // the moment their turn comes. JOIN_LUA does both steps as one unit; the first run of this test against
  // the two-command version (checked by mutating dist/) must fail, or the test proves nothing.
  for (let round = 0; round < 15; round += 1) {
    const eventId = await seedEvent(state.app);
    const crowd = users(60);
    const now = Date.now();
    await Promise.all(crowd.map((user, i) => queueOf(state.app).join(eventId, user, now + i)));

    const work = [];
    for (const [i, user] of crowd.entries()) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        work.push(
          (async () => {
            await sleep(Math.random() * 40);
            await queueOf((i + attempt) % 2 === 0 ? state.app : other).join(eventId, user, now + 1000 + i);
          })(),
        );
      }
    }
    for (let k = 0; k < 10; k += 1) {
      work.push(
        (async () => {
          await sleep(Math.random() * 50);
          await admissionOf(k % 2 === 0 ? state.app : other).admitTick(now + k * tickMs);
        })(),
      );
    }
    await Promise.all(work);
    await assertEveryoneInExactlyOnePlace(state.redis, eventId, crowd);
  }
});

redisTest("a status read racing the admission never answers 404 to a buyer who is in the queue", async () => {
  // Status as GET (no pass) then ZRANK has a gap: an admission in between leaves both empty and the buyer
  // who was just admitted would get a 404. STATUS_LUA reads both in one unit.
  for (let round = 0; round < 6; round += 1) {
    const eventId = await seedEvent(state.app);
    const crowd = users(24);
    const now = Date.now();
    for (const [i, user] of crowd.entries()) await queueOf(state.app).join(eventId, user, now + i);

    let running = true;
    const notFound = [];
    const readers = [state.app, other, state.app, other].map(async (app) => {
      while (running) {
        for (const user of crowd) {
          try {
            await queueOf(app).status(eventId, user);
          } catch (error) {
            if (error.code === "NOT_FOUND") notFound.push(user);
            else throw error;
          }
        }
      }
    });
    const ticks = [];
    for (let k = 0; k < 8; k += 1) {
      await sleep(Math.random() * 15);
      ticks.push(admissionOf(k % 2 === 0 ? state.app : other).admitTick(now + k * tickMs));
    }
    await Promise.all(ticks);
    running = false;
    await Promise.all(readers);

    assert.deepEqual(notFound, [], "a buyer in transit between the queue and a pass was reported as unknown");
    await assertEveryoneInExactlyOnePlace(state.redis, eventId, crowd);
  }
});

redisTest("two instances racing for the same tick admit one batch, not two", async () => {
  const eventId = await seedEvent(state.app);
  const crowd = users(20);
  const now = Date.now();
  for (const [i, user] of crowd.entries()) await queueOf(state.app).join(eventId, user, now + i);

  // Both instances wake up for the same tick (same bucket) at the same moment; the batch is 3.
  const first = await Promise.all([admissionOf(state.app).admitTick(now), admissionOf(other).admitTick(now)]);
  assert.equal(first[0] + first[1], 3, `admitted ${first} in the same tick`);
  assert.equal(await state.redis.zcard(`queue:${eventId}`), 17);

  // The next tick is a new lock and admits the next batch, again only once.
  const second = await Promise.all([admissionOf(state.app).admitTick(now + tickMs), admissionOf(other).admitTick(now + tickMs)]);
  assert.equal(second[0] + second[1], 3, `admitted ${second} in the next tick`);
  assert.equal(await state.redis.zcard(`queue:${eventId}`), 14);

  const admitted = [];
  for (const user of crowd) if ((await state.redis.exists(`admitted:${eventId}:${user}`)) === 1) admitted.push(user);
  assert.equal(admitted.length, 6);
  assert.deepEqual(admitted.sort(), crowd.slice(0, 6).sort(), "the first six buyers, in order");
  assert.ok((await state.redis.ttl(`admission:${eventId}:${Math.floor(now / tickMs)}`)) > 0, "the tick lock expires by itself");
});

redisTest("with nobody queued a tick takes no lock and admits nobody", async () => {
  const eventId = await seedEvent(state.app);
  const now = Date.now();
  assert.equal(await admissionOf(state.app).admitTick(now), 0);
  assert.equal(await state.redis.exists(`admission:${eventId}:${Math.floor(now / tickMs)}`), 0);
});
