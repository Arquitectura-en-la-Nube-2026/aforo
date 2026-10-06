const assert = require("node:assert/strict");
const { test } = require("node:test");
const { admittedStatus, passExpiryMs, scoreFor, waitingStatus } = require("../dist/queue/queue-status");
const { loadQueueConfig } = require("../dist/config/queue-config");

const eventId = "8f1b2c3d-0000-4000-8000-000000000001";
const pacing = { admissionBatchSize: 500, admissionIntervalSeconds: 5 };

test("estimatedWaitSeconds counts the admission ticks needed to reach the position", () => {
  // Batch 500, tick every 5 s. The first tick takes positions 1..500, the second 501..1000.
  assert.equal(waitingStatus(eventId, 1, pacing).estimatedWaitSeconds, 5, "position 1 waits at most one tick");
  assert.equal(waitingStatus(eventId, 500, pacing).estimatedWaitSeconds, 5, "position 500 is still the first tick");
  assert.equal(waitingStatus(eventId, 501, pacing).estimatedWaitSeconds, 10, "position 501 needs the second tick");
  assert.equal(waitingStatus(eventId, 1000, pacing).estimatedWaitSeconds, 10);
  assert.equal(waitingStatus(eventId, 1001, pacing).estimatedWaitSeconds, 15);
});

test("a waiting buyer has aheadOf = position - 1 and no pass", () => {
  assert.deepEqual(waitingStatus(eventId, 412, pacing), {
    eventId,
    state: "WAITING",
    position: 412,
    aheadOf: 411,
    estimatedWaitSeconds: 5,
    passToken: null,
    passExpiresAt: null,
  });
});

test("an admitted buyer is 0 / 0 / 0, never -1, and the expiry comes from the stored value", () => {
  // aheadOf = position - 1 would give -1 here and break the contract minimum of 0.
  const expiresAtMs = Date.parse("2026-10-01T15:10:00Z");
  const first = admittedStatus(eventId, `${expiresAtMs}:p_abc:with:colons`);
  assert.deepEqual(first, {
    eventId,
    state: "ADMITTED",
    position: 0,
    aheadOf: 0,
    estimatedWaitSeconds: 0,
    passToken: "p_abc:with:colons",
    passExpiresAt: "2026-10-01T15:10:00Z",
  });
  assert.deepEqual(admittedStatus(eventId, `${expiresAtMs}:p_abc:with:colons`), first, "repeat calls do not drift");
});

test("the pass expiry is a whole second and never later than the key TTL", () => {
  const now = 1_700_000_000_750;
  const expiry = passExpiryMs(now, 600);
  assert.equal(expiry % 1000, 0);
  assert.ok(expiry <= now + 600 * 1000, "a Redis key set EX 600 lives at least until the reported expiry");
  assert.ok(expiry > now + 599 * 1000);
});

test("RF-05: inside the opening window the score is random within it; after it, the arrival time", () => {
  const opens = 1_000_000_000_000;
  const windowSeconds = 30;
  // Inside the window: the score is opens + random * window, whatever the arrival time.
  assert.equal(scoreFor(opens + 5_000, opens, windowSeconds, () => 0), opens);
  assert.equal(scoreFor(opens + 5_000, opens, windowSeconds, () => 0.5), opens + 15_000);
  assert.ok(scoreFor(opens + 29_999, opens, windowSeconds, () => 0.999999) < opens + 30_000);
  // After the window: the arrival time, so everyone from the window sorts before.
  assert.equal(scoreFor(opens + 30_000, opens, windowSeconds, () => 0), opens + 30_000);
  assert.equal(scoreFor(opens + 90_000, opens, windowSeconds, () => 0), opens + 90_000);
  // No window: arrival order from the first second.
  assert.equal(scoreFor(opens + 1_000, opens, 0, () => 0.5), opens + 1_000);
});

test("config defaults match .env.example and bad values fail fast", () => {
  const config = loadQueueConfig({});
  assert.deepEqual(config, {
    port: 8080,
    redisUrl: null,
    admissionBatchSize: 500,
    admissionIntervalSeconds: 5,
    passTtlSeconds: 600,
    sseHeartbeatSeconds: 15,
  });
  assert.equal(loadQueueConfig({ REDIS_URL: "  " }).redisUrl, null, "an empty REDIS_URL means Memorystore is off");
  assert.equal(loadQueueConfig({ REDIS_URL: "rediss://10.0.0.3:6378" }).redisUrl, "rediss://10.0.0.3:6378");
  assert.throws(() => loadQueueConfig({ ADMISSION_BATCH_SIZE: "0" }), /ADMISSION_BATCH_SIZE/);
  assert.throws(() => loadQueueConfig({ PASS_TTL_SECONDS: "ten" }), /PASS_TTL_SECONDS/);
  assert.throws(() => loadQueueConfig({ REDIS_URL: "http://nope" }), /REDIS_URL/);
  assert.throws(() => loadQueueConfig({ PORT: "99999" }), /PORT/);
});
