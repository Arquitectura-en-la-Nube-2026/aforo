// The seed against a real Postgres (see helpers.cjs), run as the job runs it: `node dist/seed/seed.js`.
const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { execFile } = require("node:child_process");
const path = require("node:path");
const { parseEnvelope } = require("@aforo/common");
const h = require("./helpers.cjs");

const skip = h.skipReason();
const SEED = path.join(__dirname, "..", "dist", "seed", "seed.js");
const FESTIVAL = "8f1b2c3d-0000-4000-8000-000000000001";
let pubsub;
let app;
let inject;

before(async () => {
  if (skip) return;
  await h.resetDatabase();
  pubsub = await h.startPubSub();
  ({ app, inject } = await h.startApp({ pubsubHost: pubsub.host }));
});

after(async () => {
  if (skip) return;
  await app.close();
  await pubsub.close();
});

const dbTest = (name, fn) => test(name, { skip: skip ?? false }, fn);

/** Runs the seed in its own process with only the env the job has; resolves with its exit and logs. */
function runSeed() {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [SEED],
      {
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: h.TEST_DATABASE_URL,
          GCP_PROJECT_ID: "test",
          PUBSUB_EMULATOR_HOST: pubsub.host,
        },
      },
      (error, stdout, stderr) => {
        const logs = `${stdout}${stderr}`
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
        resolve({ code: error ? error.code : 0, logs });
      },
    );
  });
}

const listed = async () => (await inject({ method: "GET", url: "/api/v1/events?status=PUBLISHED" })).json();

dbTest("the seed publishes three events, one OPEN with small sectors, and emits both facts of each", async () => {
  const run = await runSeed();
  assert.equal(run.code, 0, JSON.stringify(run.logs));

  const page = await listed();
  assert.equal(page.total, 3);
  assert.deepEqual(
    page.items.map((e) => [e.name, e.status, e.saleState]),
    [
      ["Festival Estéreo 2026", "PUBLISHED", "OPEN"],
      ["Noche de Jazz", "PUBLISHED", "OPEN"],
      ["Concierto Sinfónico de Fin de Año", "PUBLISHED", "SCHEDULED"],
    ],
  );
  const jazz = page.items.find((e) => e.name === "Noche de Jazz");
  assert.deepEqual(jazz.sectors.map((s) => s.capacity), [10], "E-02 needs a sector of exactly 10 seats");

  // Six facts, all valid for the consumers, all with the run's correlationId.
  assert.equal(pubsub.published.length, 6);
  for (const message of pubsub.published) parseEnvelope(message.data, message.data.type);
  const applied = run.logs.find((l) => l.event === "seed_applied");
  assert.deepEqual([...new Set(pubsub.published.map((m) => m.data.correlationId))], [applied.correlationId]);
  assert.equal(run.logs.find((l) => l.event === "seed_published").published, 6);
});

dbTest("every run converges to the same rows and re-emits the facts, even when nothing changed", async () => {
  const before = await listed();
  // Someone edited the demo event by hand: the next run puts the seed's values back.
  await h.sql("UPDATE sector SET capacity = 1 WHERE id = 'a1a1a1a1-0000-4000-8000-000000000003'");
  await h.sql("UPDATE sales_rules SET max_tickets_per_person = 9 WHERE event_id = $1", [FESTIVAL]);
  await h.sql("UPDATE event SET name = 'Edited' WHERE id = $1", [FESTIVAL]);
  const published = pubsub.published.length;

  const run = await runSeed();
  assert.equal(run.code, 0);
  assert.deepEqual(await listed(), before);
  assert.equal(pubsub.published.length - published, 6, "re-emitted, so a fresh Memorystore gets its projection");
  assert.deepEqual(await h.sql("SELECT count(*)::int AS n FROM sector"), [{ n: 6 }]);
});

dbTest("with Pub/Sub down the seed still succeeds; housekeeping publishes what it left", async () => {
  const published = pubsub.published.length;
  pubsub.failing = true;
  let run;
  try {
    run = await runSeed();
  } finally {
    pubsub.failing = false;
  }
  assert.equal(run.code, 0);
  assert.ok(run.logs.some((l) => l.event === "seed_publish_deferred"));
  assert.equal(pubsub.published.length, published);
  assert.equal((await inject({ method: "POST", url: "/internal/v1/housekeeping" })).statusCode, 204);
  assert.equal(pubsub.published.length - published, 6);
});

dbTest("without its database the seed fails loudly (exit 1)", async () => {
  const result = await new Promise((resolve) =>
    execFile(
      process.execPath,
      [SEED],
      { env: { PATH: process.env.PATH, DATABASE_URL: "postgres://x:y@127.0.0.1:1/none", GCP_PROJECT_ID: "test" } },
      (error, _stdout, stderr) => resolve({ code: error?.code, stderr }),
    ),
  );
  assert.equal(result.code, 1);
  assert.match(result.stderr, /seed_failed/);
});
