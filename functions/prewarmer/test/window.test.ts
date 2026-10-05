import { test } from "node:test";
import assert from "node:assert/strict";
import { anotherWindowOpen, coolTaskId, parsePush, parseWindow, planWindow, warmTaskId } from "../src/window.ts";

const EVENT = "8f1b2c3d-0000-4000-8000-000000000001";
const OTHER = "8f1b2c3d-0000-4000-8000-000000000002";
const window = { eventId: EVENT, salesOpensAt: "2026-10-10T15:00:00Z", salesClosesAt: "2026-11-14T20:00:00Z" };

const push = (envelope: unknown) => ({
  subscription: "projects/p/subscriptions/prewarmer-event-published",
  message: { messageId: "1", data: Buffer.from(JSON.stringify(envelope)).toString("base64") },
});
const envelope = (data: unknown) => ({
  messageId: "1f7c0000-0000-4000-8000-000000000001",
  type: "EventPublished",
  version: 1,
  occurredAt: "2026-10-05T15:00:00Z",
  correlationId: "6f1c0000-0000-4000-8000-000000000002",
  producer: "catalog",
  data,
});

test("parsePush accepts an EventPublished envelope", () => {
  assert.deepEqual(parsePush(push(envelope({ ...window, name: "x", sectors: [] }))), {
    ...window,
    correlationId: "6f1c0000-0000-4000-8000-000000000002",
  });
});

test("parsePush rejects poison, wrong type, bad ids and inverted windows", () => {
  assert.equal(parsePush({ message: { data: Buffer.from("not-an-envelope").toString("base64") } }), null);
  assert.equal(parsePush(push({ ...envelope(window), type: "OrderPaid" })), null);
  assert.equal(parsePush(push(envelope({ ...window, eventId: "nope" }))), null);
  assert.equal(parsePush(push(envelope({ ...window, salesClosesAt: window.salesOpensAt }))), null);
  assert.equal(parsePush({}), null);
});

test("task names follow the contract", () => {
  assert.equal(warmTaskId(window), `warm-${EVENT}-${Date.parse(window.salesOpensAt) / 1000}`);
  assert.equal(coolTaskId(window), `cool-${EVENT}-${Date.parse(window.salesClosesAt) / 1000}`);
});

test("planWindow: warm = opens - lead, cool = min(closes, opens + hold)", () => {
  const now = new Date("2026-10-05T00:00:00Z");
  const result = planWindow(window, now, 600, 3600);
  assert.ok("plan" in result);
  assert.equal(result.plan.warm.at.toISOString(), "2026-10-10T14:50:00.000Z");
  assert.equal(result.plan.cool.at.toISOString(), "2026-10-10T16:00:00.000Z");
});

test("planWindow: a window already open warms now; short windows cool at close", () => {
  const now = new Date("2026-10-10T15:01:00Z");
  const short = { ...window, salesClosesAt: "2026-10-10T15:08:00Z" };
  const result = planWindow(short, now, 600, 3600);
  assert.ok("plan" in result);
  assert.equal(result.plan.warm.at.toISOString(), now.toISOString());
  assert.equal(result.plan.cool.at.toISOString(), "2026-10-10T15:08:00.000Z");
});

test("planWindow skips windows that are over or beyond the 30-day Cloud Tasks limit", () => {
  assert.deepEqual(planWindow(window, new Date("2026-10-10T17:00:00Z"), 600, 3600), { skip: "window-over" });
  assert.deepEqual(planWindow(window, new Date("2026-08-01T00:00:00Z"), 600, 3600), { skip: "too-far-ahead" });
});

test("anotherWindowOpen: the queue is the state", () => {
  const mine = `cool-${EVENT}-1`;
  // Only my own cool task is pending: nothing else open.
  assert.equal(anotherWindowOpen([mine], mine), false);
  // Another event already warmed (its warm ran) and has not cooled: keep warm.
  assert.equal(anotherWindowOpen([mine, `cool-${OTHER}-2`], mine), true);
  // Another event is scheduled but its warm has not run yet: not open.
  assert.equal(anotherWindowOpen([mine, `warm-${OTHER}-1`, `cool-${OTHER}-2`], mine), false);
});

test("parseWindow rejects non-objects", () => {
  assert.equal(parseWindow(null), null);
  assert.equal(parseWindow([window]), null);
});
