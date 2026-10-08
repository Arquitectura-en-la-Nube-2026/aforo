// The Inventory rules against a real Postgres, through the real app (HTTP + Nest wiring).
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { after, before, describe, test } = require("node:test");
const { projectEvent, push, resetDatabase, skipReason, sql, startApp, startPubSub } = require("./helpers.cjs");

const skip = skipReason();

describe("inventory against Postgres", { skip: skip ?? false }, () => {
  let app;
  let inject;
  let pubsub;

  before(async () => {
    await resetDatabase();
    pubsub = await startPubSub();
    ({ app, inject } = await startApp({ pubsubHost: pubsub.host }));
  });

  after(async () => {
    await app?.close();
    await pubsub?.close();
  });

  const reserve = (body, key = randomUUID(), headers = {}) =>
    inject({
      method: "POST",
      url: "/internal/v1/reservations",
      payload: body,
      headers: { "idempotency-key": key, ...headers },
    });
  const transition = (id, action, key = randomUUID()) =>
    inject({
      method: "POST",
      url: `/internal/v1/reservations/${id}/${action}`,
      headers: action === "expire" ? {} : { "idempotency-key": key },
    });
  const available = async (eventId) =>
    (await inject({ method: "GET", url: `/api/v1/events/${eventId}/availability` })).json().sectors[0].available;
  const buyer = () => randomUUID();

  test("availability is 404 until projected; the two facts may arrive in either order", async () => {
    const eventId = randomUUID();
    assert.equal((await inject({ method: "GET", url: `/api/v1/events/${eventId}/availability` })).statusCode, 404);

    const rules = push("SalesRulesConfigured", {
      eventId,
      maxTicketsPerPerson: 4,
      reservationTtlSeconds: 480,
      openingWindowSeconds: 0,
    });
    assert.equal(
      (await inject({ method: "POST", url: "/internal/v1/events/inventory-sales-rules", payload: rules.body }))
        .statusCode,
      204,
    );
    assert.equal(
      (await inject({ method: "GET", url: `/api/v1/events/${eventId}/availability` })).statusCode,
      404,
      "rules alone are not an event",
    );

    const sectorId = randomUUID();
    const published = push("EventPublished", {
      eventId,
      name: "Festival",
      salesOpensAt: "2026-10-01T15:00:00Z",
      salesClosesAt: "2026-11-14T20:00:00Z",
      sectors: [{ sectorId, name: "General", capacity: 500, priceCents: 18000000, currency: "COP" }],
    });
    assert.equal(
      (await inject({ method: "POST", url: "/internal/v1/events/inventory-event-published", payload: published.body }))
        .statusCode,
      204,
    );
    const response = await inject({ method: "GET", url: `/api/v1/events/${eventId}/availability` });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      eventId,
      sectors: [{ sectorId, name: "General", capacity: 500, available: 500, priceCents: 18000000, currency: "COP" }],
    });
  });

  test("a duplicate push changes nothing, and a re-emitted fact never resets availability", async () => {
    const { eventId, sectorId } = await projectEvent(inject, { capacity: 10 });
    assert.equal((await reserve({ eventId, sectorId, quantity: 3, buyerId: buyer() })).statusCode, 201);
    assert.equal(await available(eventId), 7);

    const reemit = push(
      "EventPublished",
      {
        eventId,
        name: "Festival (renamed)",
        salesOpensAt: "2026-10-01T15:00:00Z",
        salesClosesAt: "2026-11-14T20:00:00Z",
        sectors: [{ sectorId, name: "General", capacity: 10, priceCents: 20000000, currency: "COP" }],
      },
      { occurredAt: "2026-12-01T00:00:00Z" },
    );
    for (let i = 0; i < 2; i += 1) {
      assert.equal(
        (await inject({ method: "POST", url: "/internal/v1/events/inventory-event-published", payload: reemit.body }))
          .statusCode,
        204,
      );
    }
    const sector = (await inject({ method: "GET", url: `/api/v1/events/${eventId}/availability` })).json().sectors[0];
    assert.equal(sector.available, 7, "seats held by the reservation stay held");
    assert.equal(sector.priceCents, 20000000);
    assert.equal(
      (await sql("SELECT count(*)::int AS n FROM inbox WHERE message_id = $1", [reemit.envelope.messageId]))[0].n,
      1,
    );
  });

  test("an invalid push is 400 MALFORMED_REQUEST, so it dead-letters", async () => {
    const response = await inject({
      method: "POST",
      url: "/internal/v1/events/inventory-event-published",
      payload: push("EventPublished", { eventId: "nope" }).body,
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, "MALFORMED_REQUEST");
  });

  test("reserve: 201 ACTIVE with prices, seats drop, and a repeat with the same key replays it", async () => {
    const { eventId, sectorId } = await projectEvent(inject, { capacity: 10, priceCents: 18000000 });
    const body = { eventId, sectorId, quantity: 2, buyerId: buyer() };
    const key = randomUUID();
    const first = await reserve(body, key, { "x-correlation-id": randomUUID() });
    assert.equal(first.statusCode, 201);
    const reservation = first.json();
    assert.equal(reservation.status, "ACTIVE");
    assert.equal(reservation.unitPriceCents, 18000000);
    assert.equal(reservation.totalCents, 36000000);
    assert.equal(reservation.currency, "COP");
    const ttl = (Date.parse(reservation.expiresAt) - Date.now()) / 1000;
    assert.ok(ttl > 470 && ttl <= 480, `expires in the rules' 480 s (got ${ttl})`);
    assert.equal(await available(eventId), 8);

    const replay = await reserve(body, key);
    assert.equal(replay.statusCode, 201);
    assert.equal(replay.headers["idempotent-replayed"], "true");
    assert.equal(replay.body, first.body, "byte-identical replay");
    assert.equal(await available(eventId), 8, "the replay reserved nothing");

    const conflict = await reserve({ ...body, quantity: 3 }, key);
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().code, "IDEMPOTENCY_CONFLICT");
  });

  test("SOLD_OUT when fewer seats remain, and nothing is decremented", async () => {
    const { eventId, sectorId } = await projectEvent(inject, { capacity: 3 });
    const response = await reserve({ eventId, sectorId, quantity: 4, buyerId: buyer() });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, "SOLD_OUT");
    assert.equal(await available(eventId), 3);
  });

  test("LIMIT_EXCEEDED over the per-person max, counting confirmed tickets, and nothing is decremented", async () => {
    const { eventId, sectorId } = await projectEvent(inject, { capacity: 20, maxTicketsPerPerson: 4 });
    const buyerId = buyer();
    const tooMany = await reserve({ eventId, sectorId, quantity: 5, buyerId });
    assert.equal(tooMany.statusCode, 409);
    assert.equal(tooMany.json().code, "LIMIT_EXCEEDED");
    assert.equal(await available(eventId), 20);

    const first = (await reserve({ eventId, sectorId, quantity: 3, buyerId })).json();
    assert.equal((await transition(first.reservationId, "confirm")).json().status, "CONFIRMED");
    const overTotal = await reserve({ eventId, sectorId, quantity: 2, buyerId });
    assert.equal(overTotal.json().code, "LIMIT_EXCEEDED", "3 confirmed + 2 > 4");
    assert.equal(await available(eventId), 17);
    assert.equal((await reserve({ eventId, sectorId, quantity: 1, buyerId })).statusCode, 201, "3 + 1 = 4 is allowed");
  });

  test("ACTIVE_RESERVATION_EXISTS for a second active reservation of the same buyer and event", async () => {
    const { eventId, sectorId } = await projectEvent(inject, { capacity: 10 });
    const buyerId = buyer();
    assert.equal((await reserve({ eventId, sectorId, quantity: 1, buyerId })).statusCode, 201);
    const second = await reserve({ eventId, sectorId, quantity: 1, buyerId });
    assert.equal(second.statusCode, 409);
    assert.equal(second.json().code, "ACTIVE_RESERVATION_EXISTS");
    assert.equal(await available(eventId), 9);
  });

  test("an unknown event or sector is 404; bad input is 422", async () => {
    const { eventId } = await projectEvent(inject);
    assert.equal(
      (await reserve({ eventId: randomUUID(), sectorId: randomUUID(), quantity: 1, buyerId: buyer() })).statusCode,
      404,
    );
    assert.equal((await reserve({ eventId, sectorId: randomUUID(), quantity: 1, buyerId: buyer() })).statusCode, 404);
    assert.equal((await reserve({ eventId, quantity: 1 })).statusCode, 422);
    assert.equal((await transition(randomUUID(), "confirm")).statusCode, 404);
    assert.equal((await inject({ method: "POST", url: "/internal/v1/reservations/x/expire" })).statusCode, 422);
  });

  test("expire: early is a harmless 200 ACTIVE; after the instant, seats return and ReservationExpired is published", async () => {
    const { eventId, sectorId } = await projectEvent(inject, { capacity: 10 });
    const buyerId = buyer();
    const correlationId = randomUUID();
    const { reservationId } = (
      await reserve({ eventId, sectorId, quantity: 2, buyerId }, randomUUID(), { "x-correlation-id": correlationId })
    ).json();

    const early = await transition(reservationId, "expire");
    assert.equal(early.statusCode, 200);
    assert.deepEqual(early.json(), { reservationId, status: "ACTIVE" });

    await sql("UPDATE reservation SET expires_at = now() - interval '1 second' WHERE id = $1", [reservationId]);
    pubsub.published.length = 0;
    // Cloud Tasks sends the purchase's correlation ID on the expiry call.
    const expired = await inject({
      method: "POST",
      url: `/internal/v1/reservations/${reservationId}/expire`,
      headers: { "x-correlation-id": correlationId },
    });
    assert.deepEqual(expired.json(), { reservationId, status: "EXPIRED" });
    assert.equal(await available(eventId), 10);

    assert.equal(pubsub.published.length, 1);
    const [message] = pubsub.published;
    assert.equal(message.topic, "aforo.inventory.reservation-expired");
    assert.deepEqual(message.attributes, { type: "ReservationExpired", correlationId });
    assert.equal(message.data.correlationId, correlationId, "the event joins the purchase in the logs (E-05)");
    assert.deepEqual(
      { ...message.data.data, expiredAt: undefined },
      { reservationId, eventId, sectorId, buyerId, quantity: 2, expiredAt: undefined },
    );

    assert.deepEqual(
      (await transition(reservationId, "expire")).json(),
      { reservationId, status: "EXPIRED" },
      "repeat is idempotent",
    );
    assert.deepEqual(
      (await transition(reservationId, "confirm")).json(),
      { reservationId, status: "EXPIRED" },
      "confirm lost the race",
    );
    assert.equal(await available(eventId), 10, "seats were returned once");
  });

  test("confirm wins over a later expire, and adds to the buyer's total", async () => {
    const { eventId, sectorId } = await projectEvent(inject, { capacity: 10 });
    const buyerId = buyer();
    const { reservationId } = (await reserve({ eventId, sectorId, quantity: 2, buyerId })).json();
    const key = randomUUID();
    const confirmed = await transition(reservationId, "confirm", key);
    assert.equal(confirmed.statusCode, 200);
    assert.deepEqual(confirmed.json(), { reservationId, status: "CONFIRMED" });
    assert.equal((await transition(reservationId, "confirm", key)).headers["idempotent-replayed"], "true");
    assert.deepEqual(
      (await transition(reservationId, "confirm")).json(),
      { reservationId, status: "CONFIRMED" },
      "a new key is idempotent too",
    );

    await sql("UPDATE reservation SET expires_at = now() - interval '1 second' WHERE id = $1", [reservationId]);
    assert.deepEqual((await transition(reservationId, "expire")).json(), { reservationId, status: "CONFIRMED" });
    assert.equal(await available(eventId), 8, "confirmed seats stay sold");
    assert.equal(
      (
        await sql("SELECT confirmed FROM buyer_event_total WHERE event_id = $1 AND buyer_id = $2", [eventId, buyerId])
      )[0].confirmed,
      2,
    );
  });

  test("release returns the seats once and is idempotent", async () => {
    const { eventId, sectorId } = await projectEvent(inject, { capacity: 10 });
    const { reservationId } = (await reserve({ eventId, sectorId, quantity: 4, buyerId: buyer() })).json();
    assert.equal(await available(eventId), 6);
    assert.deepEqual((await transition(reservationId, "release")).json(), { reservationId, status: "RELEASED" });
    assert.deepEqual((await transition(reservationId, "release")).json(), { reservationId, status: "RELEASED" });
    assert.equal(await available(eventId), 10);
  });

  test("housekeeping expires overdue reservations (lost task, ADR-0003) and flushes their events", async () => {
    const { eventId, sectorId } = await projectEvent(inject, { capacity: 10 });
    const ids = [];
    for (let i = 0; i < 3; i += 1)
      ids.push((await reserve({ eventId, sectorId, quantity: 1, buyerId: buyer() })).json().reservationId);
    await sql("UPDATE reservation SET expires_at = now() - interval '1 second' WHERE id = ANY($1)", [ids.slice(0, 2)]);
    pubsub.published.length = 0;

    const response = await inject({ method: "POST", url: "/internal/v1/housekeeping" });
    assert.equal(response.statusCode, 204);
    const statuses = await sql("SELECT id, status FROM reservation WHERE id = ANY($1)", [ids]);
    assert.deepEqual(Object.fromEntries(statuses.map((r) => [r.id, r.status])), {
      [ids[0]]: "EXPIRED",
      [ids[1]]: "EXPIRED",
      [ids[2]]: "ACTIVE",
    });
    assert.equal(await available(eventId), 9);
    assert.deepEqual(pubsub.published.map((m) => m.data.data.reservationId).sort(), ids.slice(0, 2).sort());
    assert.equal((await sql("SELECT count(*)::int AS n FROM outbox WHERE published_at IS NULL"))[0].n, 0);
  });

  test("the database refuses to move a reservation out of a terminal state", async () => {
    const { eventId, sectorId } = await projectEvent(inject);
    const { reservationId } = (await reserve({ eventId, sectorId, quantity: 1, buyerId: buyer() })).json();
    await transition(reservationId, "release");
    await assert.rejects(
      sql("UPDATE reservation SET status = 'ACTIVE' WHERE id = $1", [reservationId]),
      /cannot go from RELEASED to ACTIVE/,
    );
  });

  test("health: ready reports the database", async () => {
    const response = await inject({ method: "GET", url: "/health/ready" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().checks.database, "ok");
  });
});
