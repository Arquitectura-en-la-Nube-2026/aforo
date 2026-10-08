const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parseCreateReservation, uuidParam } = require("../dist/reservations/validation");
const { loadInventoryConfig } = require("../dist/config/inventory-config");

const valid = {
  eventId: "8f1b2c3d-0000-4000-8000-000000000001",
  sectorId: "a1a1a1a1-0000-4000-8000-000000000001",
  quantity: 2,
  buyerId: "11111111-1111-4111-8111-111111111111",
};

test("a valid CreateReservationRequest passes as is", () => {
  assert.deepEqual(parseCreateReservation(valid), valid);
});

test("every broken field is reported as 422 VALIDATION_ERROR, including unknown ones", () => {
  assert.throws(
    () => parseCreateReservation({ ...valid, eventId: "x", quantity: 0, extra: true }),
    (error) => {
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.status, 422);
      assert.deepEqual(error.fieldErrors.map((e) => e.field).sort(), ["eventId", "extra", "quantity"]);
      return true;
    },
  );
  assert.throws(() => parseCreateReservation({ ...valid, quantity: 1.5 }), /schema/);
  assert.throws(() => parseCreateReservation(null), /schema/);
  assert.throws(
    () => uuidParam("reservationId", "nope"),
    (error) => error.code === "VALIDATION_ERROR",
  );
});

test("config: cloud-tasks needs SELF_URL and the invoker account; local does not", () => {
  const base = { DATABASE_URL: "postgres://x", GCP_PROJECT_ID: "p" };
  assert.throws(() => loadInventoryConfig({ ...base, EXPIRY_SCHEDULER: "cloud-tasks" }), /SELF_URL/);
  const local = loadInventoryConfig({ ...base, EXPIRY_SCHEDULER: "local", PORT: "9000" });
  assert.equal(local.selfUrl, "http://127.0.0.1:9000");
  assert.equal(local.dbPoolMax, 2);
  assert.throws(() => loadInventoryConfig({ ...base, EXPIRY_SCHEDULER: "cron" }), /EXPIRY_SCHEDULER/);
  assert.throws(() => loadInventoryConfig({ GCP_PROJECT_ID: "p" }), /DATABASE_URL/);
});
