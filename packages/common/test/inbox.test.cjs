const assert = require("node:assert/strict");
const { test } = require("node:test");
const { consumeOnce } = require("../dist");

function memoryStore({ failMarkOnce = false } = {}) {
  const seen = new Set();
  let failNext = failMarkOnce;
  return {
    seen,
    has: async (id) => seen.has(id),
    mark: async (id) => {
      if (failNext) {
        failNext = false;
        throw new Error("process died before marking");
      }
      seen.add(id);
    },
  };
}

test("the effect runs once per message id and the repeat is reported as a duplicate", async () => {
  const store = memoryStore();
  let runs = 0;
  const effect = async () => {
    runs += 1;
  };
  assert.equal(await consumeOnce(store, "m1", effect), "applied");
  assert.equal(await consumeOnce(store, "m1", effect), "duplicate");
  assert.equal(await consumeOnce(store, "m2", effect), "applied");
  assert.equal(runs, 2);
});

test("a failing effect does not mark the message, so the redelivery applies it", async () => {
  const store = memoryStore();
  await assert.rejects(
    consumeOnce(store, "m1", async () => {
      throw new Error("effect failed");
    }),
    /effect failed/,
  );
  assert.equal(store.seen.has("m1"), false);
  let applied = false;
  assert.equal(
    await consumeOnce(store, "m1", async () => {
      applied = true;
    }),
    "applied",
  );
  assert.equal(applied, true);
});

test("a crash between the effect and the mark does not lose the event on redelivery", async () => {
  // The dangerous order is mark-then-effect: inbox:M saved, process dead before the upsert, and
  // Pub/Sub's retry is dropped as a duplicate. Here the effect ran and the mark failed.
  const store = memoryStore({ failMarkOnce: true });
  let upserts = 0;
  const upsert = async () => {
    upserts += 1;
  };
  await assert.rejects(consumeOnce(store, "m1", upsert), /process died/);
  assert.equal(upserts, 1);
  assert.equal(await consumeOnce(store, "m1", upsert), "applied");
  assert.equal(upserts, 2);
  assert.equal(await consumeOnce(store, "m1", upsert), "duplicate");
});
