// E-02 must-deliver test (README): 200 concurrent reservations on a sector with 10 seats leave
// exactly 10 reservations and 190 SOLD_OUT. Real HTTP, real Postgres, a pool of 2 connections
// (ADR-0005: requests queue on the pool instead of opening connections). Prints the counts and the
// p95 latency as evidence for the artifact.
//
// Local:   TEST_DATABASE_URL=postgres://.../inventory_test npm test
// Against dev (an already projected event; private service, so pass an ID token for aforo-inventory):
//   CONCURRENCY_BASE_URL=https://... CONCURRENCY_EVENT_ID=... CONCURRENCY_SECTOR_ID=... \
//   CONCURRENCY_TOKEN=$(gcloud auth print-identity-token ...) node --test test/concurrency/
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { after, before, test } = require("node:test");
const { projectEvent, resetDatabase, skipReason, sql, startApp } = require("../helpers.cjs");

const REQUESTS = 200;
const SEATS = 10;
const remote = process.env.CONCURRENCY_BASE_URL;
const skip = remote ? null : skipReason();

let app;
let base;
let eventId;
let sectorId;
const headers =
  remote && process.env.CONCURRENCY_TOKEN ? { authorization: `Bearer ${process.env.CONCURRENCY_TOKEN}` } : {};

before(async () => {
  if (skip) return;
  if (remote) {
    base = remote.replace(/\/+$/, "");
    eventId = process.env.CONCURRENCY_EVENT_ID;
    sectorId = process.env.CONCURRENCY_SECTOR_ID;
    return;
  }
  await resetDatabase();
  let inject;
  ({ app, inject, url: base } = await startApp({ poolMax: 2, listen: true }));
  ({ eventId, sectorId } = await projectEvent(inject, { capacity: SEATS, maxTicketsPerPerson: 4 }));
});

after(() => app?.close());

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

test(
  `${REQUESTS} concurrent reservations on ${SEATS} seats: exactly ${SEATS} reserved, the rest SOLD_OUT`,
  { skip: skip ?? false },
  async () => {
    const before = await (await fetch(`${base}/api/v1/events/${eventId}/availability`, { headers })).json();
    const seats = before.sectors.find((s) => s.sectorId === sectorId).available;
    if (!remote) assert.equal(seats, SEATS);

    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: REQUESTS }, async () => {
        const t0 = performance.now();
        const response = await fetch(`${base}/internal/v1/reservations`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json", "idempotency-key": randomUUID() },
          body: JSON.stringify({ eventId, sectorId, quantity: 1, buyerId: randomUUID() }),
        });
        const body = await response.json();
        return { status: response.status, code: body.code, latencyMs: performance.now() - t0 };
      }),
    );
    const wallMs = Date.now() - started;

    const created = results.filter((r) => r.status === 201).length;
    const soldOut = results.filter((r) => r.status === 409 && r.code === "SOLD_OUT").length;
    const other = results.filter((r) => r.status !== 201 && r.code !== "SOLD_OUT");
    const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const evidence = {
      event: "concurrency_evidence",
      requests: REQUESTS,
      seats,
      created,
      soldOut,
      other: other.length,
      p50Ms: Math.round(percentile(latencies, 50)),
      p95Ms: Math.round(percentile(latencies, 95)),
      maxMs: Math.round(latencies.at(-1)),
      wallMs,
      target: remote ?? "local Postgres, pool 2",
    };
    process.stderr.write(`${JSON.stringify(evidence)}\n`);

    assert.deepEqual(other, [], "every request is either reserved or SOLD_OUT");
    assert.equal(created, seats, "never more reservations than seats (zero overselling)");
    assert.equal(soldOut, REQUESTS - seats);

    const after = await (await fetch(`${base}/api/v1/events/${eventId}/availability`, { headers })).json();
    assert.equal(after.sectors.find((s) => s.sectorId === sectorId).available, 0);
    if (!remote) {
      const [{ n }] = await sql(
        "SELECT count(*)::int AS n FROM reservation WHERE event_id = $1 AND status = 'ACTIVE'",
        [eventId],
      );
      assert.equal(n, SEATS);
    }
  },
);
