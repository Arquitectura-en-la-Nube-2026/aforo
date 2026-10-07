import { test } from "node:test";
import assert from "node:assert/strict";
import { StructuredLogger } from "@aforo/common";
import type { Config } from "../src/config.ts";
import type { Gcp } from "../src/gcp.ts";
import { coolWindow, onEventPublished, warmWindow, type Deps } from "../src/handlers.ts";

const EVENT = "8f1b2c3d-0000-4000-8000-000000000001";
const window = { eventId: EVENT, salesOpensAt: "2026-10-10T15:00:00Z", salesClosesAt: "2026-10-10T15:08:00Z" };

const config: Config = {
  projectId: "p",
  region: "r",
  tasksQueue: "prewarm-windows",
  selfUrl: "https://prewarmer",
  tasksInvokerServiceAccount: "invoker@p",
  targets: [
    { service: "aforo-gateway", warmMinimum: 1 },
    { service: "aforo-queue", warmMinimum: 1 },
  ],
  baselineMinInstances: 0,
  leadSeconds: 600,
  holdSeconds: 3600,
};

function fakeGcp(pending: string[] = []) {
  const minimums: Record<string, number> = { "aforo-gateway": 0, "aforo-queue": 0 };
  const tasks = new Set<string>(pending);
  const created: { id: string; path: string }[] = [];
  const gcp: Gcp = {
    async createTask(id, _at, path) {
      if (tasks.has(id)) return false;
      tasks.add(id);
      created.push({ id, path });
      return true;
    },
    async listTaskIds() {
      return [...tasks];
    },
    async getMinInstances(service) {
      return minimums[service] ?? 0;
    },
    async setMinInstances(service, value) {
      minimums[service] = value;
    },
  };
  return { gcp, minimums, created };
}

const quietLogger = { write() {} } as unknown as StructuredLogger;
const deps = (gcp: Gcp, now = "2026-10-10T14:58:00Z"): Deps => ({
  config,
  gcp,
  logger: quietLogger,
  now: () => new Date(now),
});

const pushOf = (data: unknown) => ({
  subscription: "s",
  message: {
    messageId: "1",
    data: Buffer.from(
      JSON.stringify({
        messageId: "1f7c0000-0000-4000-8000-000000000001",
        type: "EventPublished",
        version: 1,
        occurredAt: "2026-10-05T15:00:00Z",
        correlationId: "6f1c0000-0000-4000-8000-000000000002",
        producer: "catalog",
        data,
      }),
    ).toString("base64"),
  },
});

test("EventPublished schedules a warm and a cool task; a re-emitted event creates nothing new", async () => {
  const fake = fakeGcp();
  assert.equal((await onEventPublished(deps(fake.gcp), pushOf({ ...window, name: "x", sectors: [] }))).status, 204);
  assert.deepEqual(
    fake.created.map((t) => t.path),
    ["/windows/warm", "/windows/cool"],
  );
  assert.equal((await onEventPublished(deps(fake.gcp), pushOf({ ...window, name: "x", sectors: [] }))).status, 204);
  assert.equal(fake.created.length, 2);
});

test("invalid envelope answers 400 (dead-letters)", async () => {
  const fake = fakeGcp();
  assert.equal((await onEventPublished(deps(fake.gcp), { message: { data: "bm9wZQ==" } })).status, 400);
  assert.equal(fake.created.length, 0);
});

test("warm raises the minimums to the targets and is repeatable", async () => {
  const fake = fakeGcp();
  const first = await warmWindow(deps(fake.gcp), window, "c");
  assert.deepEqual(first.body, {
    action: "WARM",
    services: [
      { service: "aforo-gateway", from: 0, to: 1 },
      { service: "aforo-queue", from: 0, to: 1 },
    ],
  });
  const again = await warmWindow(deps(fake.gcp), window, "c");
  assert.deepEqual((again.body as { services: unknown[] }).services, [
    { service: "aforo-gateway", from: 1, to: 1 },
    { service: "aforo-queue", from: 1, to: 1 },
  ]);
});

test("warm never lowers a minimum someone set higher", async () => {
  const fake = fakeGcp();
  fake.minimums["aforo-gateway"] = 3;
  await warmWindow(deps(fake.gcp), window, "c");
  assert.equal(fake.minimums["aforo-gateway"], 3);
});

test("cool returns to baseline when no other window is open", async () => {
  const mine = `cool-${EVENT}-1`;
  const fake = fakeGcp([mine]);
  await warmWindow(deps(fake.gcp), window, "c");
  const reply = await coolWindow(deps(fake.gcp), window, "c", mine);
  assert.equal((reply.body as { action: string }).action, "COOL");
  assert.deepEqual(fake.minimums, { "aforo-gateway": 0, "aforo-queue": 0 });
});

test("cool keeps instances while another event's window is open", async () => {
  const mine = `cool-${EVENT}-1`;
  const fake = fakeGcp([mine, "cool-8f1b2c3d-0000-4000-8000-000000000009-2"]);
  await warmWindow(deps(fake.gcp), window, "c");
  const reply = await coolWindow(deps(fake.gcp), window, "c", mine);
  assert.equal((reply.body as { action: string }).action, "KEPT_WARM");
  assert.deepEqual(fake.minimums, { "aforo-gateway": 1, "aforo-queue": 1 });
});

test("task routes reject a body that is not a window", async () => {
  const fake = fakeGcp();
  assert.equal((await warmWindow(deps(fake.gcp), { eventId: "x" }, "c")).status, 400);
  assert.equal((await coolWindow(deps(fake.gcp), {}, "c", undefined)).status, 400);
});
