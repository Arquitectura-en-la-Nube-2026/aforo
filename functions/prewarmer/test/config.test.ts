import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTargets } from "../src/config.ts";

test("parseTargets reads service:minimum pairs", () => {
  assert.deepEqual(parseTargets("aforo-gateway:1, aforo-queue:2"), [
    { service: "aforo-gateway", warmMinimum: 1 },
    { service: "aforo-queue", warmMinimum: 2 },
  ]);
});

test("parseTargets rejects malformed entries", () => {
  assert.throws(() => parseTargets("aforo-gateway"));
  assert.throws(() => parseTargets("aforo-gateway:-1"));
});
