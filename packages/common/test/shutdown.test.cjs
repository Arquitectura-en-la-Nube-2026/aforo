const assert = require("node:assert/strict");
const { test } = require("node:test");
const { HealthService, ShutdownService } = require("../dist/nest");

function captureLogs() {
  const lines = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  const record = (chunk) => {
    lines.push(JSON.parse(String(chunk)));
    return true;
  };
  process.stdout.write = record;
  process.stderr.write = record;
  return {
    lines,
    restore() {
      process.stdout.write = stdout;
      process.stderr.write = stderr;
    },
  };
}

test("readiness answers error from the first moment of the shutdown", async () => {
  const health = new HealthService();
  const shutdown = new ShutdownService(health);
  assert.equal((await health.readiness()).status, "ok");
  const logs = captureLogs();
  try {
    await shutdown.beforeApplicationShutdown("SIGTERM");
  } finally {
    logs.restore();
  }
  assert.equal(shutdown.isShuttingDown, true);
  const readiness = await health.readiness();
  assert.equal(readiness.status, "error");
  assert.equal(readiness.checks.shutdown, "error");
});

test("drain hooks run before close hooks, and the end is logged with its duration", async () => {
  const shutdown = new ShutdownService(new HealthService());
  const order = [];
  shutdown.onDrain("sse", () => order.push("drain:sse"));
  shutdown.onClose("redis", async () => order.push("close:redis"));
  const logs = captureLogs();
  try {
    await shutdown.beforeApplicationShutdown("SIGTERM");
    order.push("http-server-closes");
    await shutdown.onApplicationShutdown("SIGTERM");
  } finally {
    logs.restore();
  }
  assert.deepEqual(order, ["drain:sse", "http-server-closes", "close:redis"]);
  const done = logs.lines.find((line) => line.phase === "complete");
  assert.equal(done.event, "shutdown");
  assert.equal(typeof done.durationMs, "number");
  assert.ok(done.durationMs >= 0);
});

test("a hook that fails is logged and does not stop the others", async () => {
  const shutdown = new ShutdownService(new HealthService());
  const ran = [];
  shutdown.onDrain("broken", () => {
    throw new Error("cannot close");
  });
  shutdown.onDrain("sse", () => ran.push("sse"));
  const logs = captureLogs();
  try {
    await shutdown.beforeApplicationShutdown("SIGTERM");
  } finally {
    logs.restore();
  }
  assert.deepEqual(ran, ["sse"]);
  const failure = logs.lines.find((line) => line.message === "shutdown.hook_failed");
  assert.equal(failure.hook, "broken");
  assert.equal(failure.error, "cannot close");
});
