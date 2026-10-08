const assert = require("node:assert/strict");
const { test } = require("node:test");
const { runWithCorrelation } = require("../dist");
const { JsonLogger } = require("../dist/nest");

// Captures only the library's JSON lines: the test runner reports through stdout too.
function capture(work) {
  const lines = [];
  const out = process.stdout.write;
  const err = process.stderr.write;
  const grab =
    (original, stream) =>
    (chunk, ...rest) => {
      if (String(chunk).startsWith('{"severity"')) return lines.push(JSON.parse(String(chunk))) > 0;
      return original.call(stream, chunk, ...rest);
    };
  process.stdout.write = grab(out, process.stdout);
  process.stderr.write = grab(err, process.stderr);
  try {
    work();
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
  return lines;
}

test("an object message becomes fields, with the request's correlation and user", () => {
  const logger = new JsonLogger({ service: "orders" });
  const [line] = capture(() =>
    runWithCorrelation({ correlationId: "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f", userId: "u-1" }, () =>
      logger.log({ event: "circuit_state", state: "open" }, "PaymentGateway"),
    ),
  );
  assert.deepEqual(line, {
    severity: "INFO",
    message: "circuit_state",
    service: "orders",
    context: "PaymentGateway",
    correlationId: "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
    userId: "u-1",
    event: "circuit_state",
    state: "open",
  });
});

test("a severity field overrides the method, and levels below the minimum are dropped", () => {
  const logger = new JsonLogger({ level: "info" });
  const lines = capture(() => {
    logger.log({ severity: "WARNING", event: "payment_retry", attempt: 2 });
    logger.debug("not written");
    logger.warn("plain text", "RefundService");
  });
  assert.deepEqual(
    lines.map((l) => [l.severity, l.message]),
    [
      ["WARNING", "payment_retry"],
      ["WARNING", "plain text"],
    ],
  );
  assert.equal(lines[0].attempt, 2);
});

test("Nest's error(message, stack, context) keeps the stack; an Error message keeps its text", () => {
  const logger = new JsonLogger();
  const lines = capture(() => {
    logger.error("startup failed", "Error: boom\n    at x", "NestApplication");
    logger.error(new Error("db down"));
  });
  assert.equal(lines[0].severity, "ERROR");
  assert.equal(lines[0].stack, "Error: boom\n    at x");
  assert.equal(lines[0].context, "NestApplication");
  assert.equal(lines[1].message, "db down");
  assert.equal(lines[1].error, "db down");
});
