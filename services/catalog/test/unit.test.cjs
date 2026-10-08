const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parseCreateEvent, parseSalesRules, parseListQuery, uuidParam } = require("../dist/events/validation");
const { saleStateAt, iso } = require("../dist/events/event.view");
const { loadCatalogConfig } = require("../dist/config/catalog-config");

const valid = {
  name: "Festival",
  venue: "Parque",
  startsAt: "2026-11-14T22:00:00Z",
  salesOpensAt: "2026-10-01T15:00:00Z",
  salesClosesAt: "2026-11-14T20:00:00-05:00",
  sectors: [{ name: "General", capacity: 500, priceCents: 18000000 }],
};

const fields = (fn) => {
  try {
    fn();
  } catch (error) {
    assert.equal(error.code, "VALIDATION_ERROR");
    assert.equal(error.status, 422);
    return error.fieldErrors.map((e) => e.field).sort();
  }
  assert.fail("expected a VALIDATION_ERROR");
};

test("a valid CreateEventRequest parses, dates with any offset become instants", () => {
  const parsed = parseCreateEvent(valid);
  assert.equal(parsed.salesClosesAt.toISOString(), "2026-11-15T01:00:00.000Z");
  assert.deepEqual(parsed.sectors, valid.sectors);
});

test("CreateEventRequest: every broken field is reported, including unknown ones and nested ones", () => {
  assert.deepEqual(
    fields(() =>
      parseCreateEvent({
        ...valid,
        name: "",
        startsAt: "next friday",
        id: "8f1b2c3d-0000-4000-8000-000000000001",
        sectors: [{ name: "A", capacity: 0, priceCents: 1.5, currency: "COP" }, "x"],
      }),
    ),
    ["id", "name", "sectors[0].capacity", "sectors[0].currency", "sectors[0].priceCents", "sectors[1]", "startsAt"],
  );
  assert.deepEqual(fields(() => parseCreateEvent({ ...valid, sectors: [] })), ["sectors"]);
  assert.deepEqual(fields(() => parseCreateEvent(null)), ["body"]);
  assert.deepEqual(fields(() => parseCreateEvent({ ...valid, startsAt: "2026-02-30T10:00:00Z" })), ["startsAt"]);
});

test("a sale window that closes before it opens is a 422 on salesClosesAt", () => {
  assert.deepEqual(
    fields(() => parseCreateEvent({ ...valid, salesClosesAt: valid.salesOpensAt })),
    ["salesClosesAt"],
  );
});

test("SalesRules: minimums of the contract and no extra fields", () => {
  const rules = { maxTicketsPerPerson: 4, reservationTtlSeconds: 480, openingWindowSeconds: 0 };
  assert.deepEqual(parseSalesRules(rules), rules);
  assert.deepEqual(
    fields(() => parseSalesRules({ maxTicketsPerPerson: 0, reservationTtlSeconds: 29, openingWindowSeconds: -1, x: 1 })),
    ["maxTicketsPerPerson", "openingWindowSeconds", "reservationTtlSeconds", "x"],
  );
});

test("list query: defaults page 0 size 20; status, page and size are checked", () => {
  assert.deepEqual(parseListQuery({}), { status: undefined, page: 0, size: 20 });
  assert.deepEqual(parseListQuery({ status: "PUBLISHED", page: "2", size: "100" }), {
    status: "PUBLISHED",
    page: 2,
    size: 100,
  });
  assert.deepEqual(fields(() => parseListQuery({ status: "OPEN", page: "-1", size: "101" })), ["page", "size", "status"]);
  assert.deepEqual(fields(() => parseListQuery({ size: "0" })), ["size"]);
  assert.deepEqual(fields(() => parseListQuery({ page: "1.5" })), ["page"]);
});

test("saleState: SCHEDULED before opening, OPEN from the opening instant, CLOSED from the closing instant", () => {
  const opens = new Date("2026-10-01T15:00:00Z");
  const closes = new Date("2026-10-01T16:00:00Z");
  assert.equal(saleStateAt(opens.getTime() - 1, opens, closes), "SCHEDULED");
  assert.equal(saleStateAt(opens.getTime(), opens, closes), "OPEN");
  assert.equal(saleStateAt(closes.getTime() - 1, opens, closes), "OPEN");
  assert.equal(saleStateAt(closes.getTime(), opens, closes), "CLOSED");
});

test("timestamps are UTC, without milliseconds when they are zero", () => {
  assert.equal(iso(new Date("2026-10-01T10:00:00-05:00")), "2026-10-01T15:00:00Z");
  assert.equal(iso(new Date("2026-10-01T15:00:00.250Z")), "2026-10-01T15:00:00.250Z");
  assert.throws(() => uuidParam("eventId", "nope"), (error) => error.code === "VALIDATION_ERROR");
});

test("config: DATABASE_URL and GCP_PROJECT_ID are required; topics default to the contract's", () => {
  const config = loadCatalogConfig({ DATABASE_URL: "postgres://x", GCP_PROJECT_ID: "p" });
  assert.equal(config.topicEventPublished, "aforo.catalog.event-published");
  assert.equal(config.topicSalesRulesConfigured, "aforo.catalog.sales-rules-configured");
  assert.equal(config.dbPoolMax, 2);
  assert.throws(() => loadCatalogConfig({ GCP_PROJECT_ID: "p" }), /DATABASE_URL/);
  assert.throws(() => loadCatalogConfig({ DATABASE_URL: "postgres://x" }), /GCP_PROJECT_ID/);
  assert.throws(() => loadCatalogConfig({ DATABASE_URL: "x", GCP_PROJECT_ID: "p", PORT: "0" }), /PORT/);
});
