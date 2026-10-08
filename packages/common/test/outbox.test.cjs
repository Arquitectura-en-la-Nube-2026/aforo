const assert = require("node:assert/strict");
const http = require("node:http");
const { test } = require("node:test");
const { OutboxPublisher, PubSubRestTransport, buildEnvelope, runWithCorrelation } = require("../dist");

// Hides only the library's JSON log lines: the test runner reports through stdout too.
function quietly(work) {
  const out = process.stdout.write;
  const err = process.stderr.write;
  const isLogLine = (chunk) => String(chunk).startsWith('{"severity"');
  process.stdout.write = (chunk, ...rest) => isLogLine(chunk) || out.call(process.stdout, chunk, ...rest);
  process.stderr.write = (chunk, ...rest) => isLogLine(chunk) || err.call(process.stderr, chunk, ...rest);
  return Promise.resolve()
    .then(work)
    .finally(() => {
      process.stdout.write = out;
      process.stderr.write = err;
    });
}

function memoryStore(count) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `m-${i}`,
    topic: "aforo.orders.order-paid",
    type: "OrderPaid",
    correlationId: `c-${i}`,
    payload: { messageId: `m-${i}` },
    published: false,
  }));
  return {
    rows,
    async findPending(limit) {
      return rows.filter((row) => !row.published).slice(0, limit);
    },
    async markPublished(id) {
      rows.find((row) => row.id === id).published = true;
    },
  };
}

test("flush publishes pending rows in order with type and correlationId attributes", async () => {
  const store = memoryStore(3);
  const sent = [];
  const publisher = new OutboxPublisher(store, {
    async publish(topic, data, attributes) {
      sent.push({ topic, data: JSON.parse(data.toString()), attributes });
    },
  });
  assert.equal(await quietly(() => publisher.flush()), 3);
  assert.deepEqual(
    sent.map((s) => s.data.messageId),
    ["m-0", "m-1", "m-2"],
  );
  assert.deepEqual(sent[1].attributes, { type: "OrderPaid", correlationId: "c-1" });
  assert.ok(store.rows.every((row) => row.published));
  assert.equal(await publisher.flush(), 0, "nothing left");
});

test("a failed publish stops the flush and leaves that row and the rest pending", async () => {
  const store = memoryStore(3);
  const publisher = new OutboxPublisher(store, {
    async publish(_topic, data) {
      if (JSON.parse(data.toString()).messageId === "m-1") throw new Error("pubsub down");
    },
  });
  await assert.rejects(
    quietly(() => publisher.flush()),
    /pubsub down/,
  );
  assert.deepEqual(
    store.rows.map((row) => row.published),
    [true, false, false],
  );
});

test("flush pages through batches and stops at maxPerFlush", async () => {
  const store = memoryStore(7);
  const publisher = new OutboxPublisher(store, { async publish() {} }, { batchSize: 2, maxPerFlush: 5 });
  assert.equal(await quietly(() => publisher.flush()), 5);
  assert.equal(store.rows.filter((row) => !row.published).length, 2, "housekeeping gets the rest");
});

test("concurrent flushes in one instance share the run in progress", async () => {
  const store = memoryStore(2);
  let publishes = 0;
  const publisher = new OutboxPublisher(store, {
    async publish() {
      publishes += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
  });
  const [a, b] = await quietly(() => Promise.all([publisher.flush(), publisher.flush()]));
  assert.equal(a, 2);
  assert.equal(b, 2);
  assert.equal(publishes, 2);
});

test("PubSubRestTransport posts base64 data and attributes to the topic (emulator, no auth)", async () => {
  const requests = [];
  const emulator = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      requests.push({ url: request.url, headers: request.headers, body: JSON.parse(body) });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ messageIds: ["1"] }));
    });
  });
  await new Promise((resolve) => emulator.listen(0, "127.0.0.1", resolve));
  try {
    const transport = new PubSubRestTransport({
      projectId: "aforo-dev-teamf",
      emulatorHost: `127.0.0.1:${emulator.address().port}`,
    });
    await transport.publish("aforo.orders.order-paid", Buffer.from('{"a":1}'), {
      type: "OrderPaid",
      correlationId: "c",
    });
    const [sent] = requests;
    assert.equal(sent.url, "/v1/projects/aforo-dev-teamf/topics/aforo.orders.order-paid:publish");
    assert.equal(sent.headers.authorization, undefined);
    assert.equal(Buffer.from(sent.body.messages[0].data, "base64").toString(), '{"a":1}');
    assert.deepEqual(sent.body.messages[0].attributes, { type: "OrderPaid", correlationId: "c" });
  } finally {
    await new Promise((resolve) => emulator.close(resolve));
  }
});

test("PubSubRestTransport rejects a non-2xx answer so the row stays pending", async () => {
  const emulator = http.createServer((_request, response) => {
    response.writeHead(404, { "content-type": "application/json" });
    response.end("{}");
  });
  await new Promise((resolve) => emulator.listen(0, "127.0.0.1", resolve));
  try {
    const transport = new PubSubRestTransport({
      projectId: "p",
      emulatorHost: `127.0.0.1:${emulator.address().port}`,
    });
    await assert.rejects(transport.publish("missing", Buffer.from("{}"), {}), /answered 404/);
  } finally {
    await new Promise((resolve) => emulator.close(resolve));
  }
});

test("buildEnvelope fills the envelope and takes the correlation ID from the request", () => {
  const correlationId = "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
  const envelope = runWithCorrelation({ correlationId }, () =>
    buildEnvelope({ type: "OrderPaid", producer: "orders", data: { orderId: "o" } }),
  );
  assert.equal(envelope.correlationId, correlationId);
  assert.equal(envelope.version, 1);
  assert.match(envelope.messageId, /^[0-9a-f-]{36}$/);
  assert.ok(!Number.isNaN(Date.parse(envelope.occurredAt)));
  assert.deepEqual(envelope.data, { orderId: "o" });
});
