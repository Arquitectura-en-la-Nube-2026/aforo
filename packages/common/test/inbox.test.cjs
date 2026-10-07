const assert = require('node:assert/strict');
const { test } = require('node:test');
const { consumeOnce } = require('../dist');

// Models a database transaction: the inbox row and projection become visible together on commit.
// Concurrent deliveries wait for the first transaction before checking the unique message id.
function transactionalStore() {
  const store = { seen: new Set(), projectionWrites: 0 };
  let last = Promise.resolve();
  store.transaction = async (work) => {
    let release;
    const turn = new Promise((resolve) => {
      release = resolve;
    });
    const previous = last;
    last = turn;
    await previous;
    const pending = new Set(store.seen);
    let writes = store.projectionWrites;
    const tx = {
      insertIfAbsent: async (messageId) => {
        if (pending.has(messageId)) return false;
        pending.add(messageId);
        return true;
      },
      writeProjection: async () => {
        writes += 1;
      },
    };
    try {
      const result = await work(tx);
      store.seen = pending;
      store.projectionWrites = writes;
      return result;
    } finally {
      release();
    }
  };
  return store;
}

test('the inbox row and effect commit together, then a redelivery is skipped', async () => {
  const store = transactionalStore();
  const effect = (tx) => tx.writeProjection();
  assert.equal(await consumeOnce(store, 'm1', effect), 'applied');
  assert.equal(await consumeOnce(store, 'm1', effect), 'duplicate');
  assert.equal(store.projectionWrites, 1);
  assert.deepEqual([...store.seen], ['m1']);
});

test('an effect failure rolls back the inbox row and effect so redelivery can apply', async () => {
  const store = transactionalStore();
  await assert.rejects(
    consumeOnce(store, 'm1', async (tx) => {
      await tx.writeProjection();
      throw new Error('effect failed');
    }),
    /effect failed/,
  );
  assert.equal(store.seen.has('m1'), false);
  assert.equal(store.projectionWrites, 0);
  assert.equal(await consumeOnce(store, 'm1', (tx) => tx.writeProjection()), 'applied');
  assert.equal(store.projectionWrites, 1);
});

test('concurrent deliveries of one message commit the effect only once', async () => {
  const store = transactionalStore();
  const effect = async (tx) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await tx.writeProjection();
  };
  const results = await Promise.all(
    Array.from({ length: 10 }, () => consumeOnce(store, 'm1', effect)),
  );
  assert.equal(results.filter((result) => result === 'applied').length, 1);
  assert.equal(results.filter((result) => result === 'duplicate').length, 9);
  assert.equal(store.projectionWrites, 1);
});
