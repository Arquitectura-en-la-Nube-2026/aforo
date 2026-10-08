// Boots a real Nest app on Fastify with the modules a producer service wires (outbox, housekeeping,
// idempotency, push envelopes), the way services/orders does. Decorators are applied as functions
// because this file is plain CommonJS.
require("reflect-metadata");
const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const {
  Body,
  Controller,
  Global,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Post,
  UseInterceptors,
} = require("@nestjs/common");
const { APP_FILTER, NestFactory } = require("@nestjs/core");
const { FastifyAdapter } = require("@nestjs/platform-fastify");
const { getCorrelationId } = require("../dist");
const {
  CorrelationMiddleware,
  CurrentUser,
  HousekeepingModule,
  IDEMPOTENCY_REPOSITORY,
  IdempotencyInterceptor,
  OUTBOX_STORE,
  OutboxModule,
  ProblemJsonFilter,
  PushEnvelope,
} = require("../dist/nest");

const method = (target, name) => [target.prototype, name, Object.getOwnPropertyDescriptor(target.prototype, name)];
const decorateMethod = (target, name, ...decorators) => decorators.forEach((d) => d(...method(target, name)));

// --- service-side adapters, in memory -------------------------------------------------------------
const state = {
  idempotency: new Map(),
  outbox: [],
  published: [],
  sweepRuns: [],
  failSweep: false,
  handled: 0,
  seen: null,
};

class MemoryStores {
  async find(key) {
    return state.idempotency.get(key) ?? null;
  }
  async save(record) {
    if (!state.idempotency.has(record.key)) state.idempotency.set(record.key, record);
  }
  async findPending(limit) {
    return state.outbox.filter((row) => !row.published).slice(0, limit);
  }
  async markPublished(id) {
    state.outbox.find((row) => row.id === id).published = true;
  }
}

// Like services/orders: a @Global module exports the stores under the common tokens.
class StoresModule {}
Global()(StoresModule);
Module({
  providers: [
    MemoryStores,
    { provide: OUTBOX_STORE, useExisting: MemoryStores },
    { provide: IDEMPOTENCY_REPOSITORY, useExisting: MemoryStores },
  ],
  exports: [OUTBOX_STORE, IDEMPOTENCY_REPOSITORY],
})(StoresModule);

// The sweep depends on a provider of its own domain module, like Orders' RefundSweep on
// PaymentsRepository: housekeeping must resolve it there, not instantiate it again.
class ReservationsRepository {
  overdue() {
    return ["r-1"];
  }
}
Injectable()(ReservationsRepository);

class ExpireSweep {
  constructor(reservations) {
    this.name = "expire";
    this.reservations = reservations;
  }
  async run() {
    state.sweepRuns.push(`expire:${this.reservations.overdue().join(",")}`);
    // A sweep that writes a fact: the flush after the sweeps must publish it.
    state.outbox.push({
      id: "m-1",
      topic: "aforo.inventory.reservation-expired",
      type: "ReservationExpired",
      correlationId: "c",
      payload: "{}",
    });
  }
}
Injectable()(ExpireSweep);
Inject(ReservationsRepository)(ExpireSweep, undefined, 0);

class BrokenSweep {
  constructor() {
    this.name = "broken";
  }
  async run() {
    state.sweepRuns.push("broken");
    if (state.failSweep) throw new Error("boom");
  }
}
Injectable()(BrokenSweep);

class ReservationsModule {}
Module({
  providers: [ReservationsRepository, ExpireSweep, BrokenSweep],
  exports: [ExpireSweep, BrokenSweep],
})(ReservationsModule);

class OrdersController {
  create(user, body) {
    state.handled += 1;
    return { orderId: `order-${state.handled}`, buyerId: user.userId, quantity: body.quantity };
  }
  onExpired(envelope) {
    state.seen = { envelope, correlationId: getCorrelationId() };
  }
}
Controller()(OrdersController);
decorateMethod(OrdersController, "create", Post("api/v1/orders"), UseInterceptors(IdempotencyInterceptor));
CurrentUser()(OrdersController.prototype, "create", 0);
Body()(OrdersController.prototype, "create", 1);
decorateMethod(OrdersController, "onExpired", Post("internal/v1/events/orders-reservation-expired"), HttpCode(204));
PushEnvelope("ReservationExpired")(OrdersController.prototype, "onExpired", 0);

class AppModule {
  configure(consumer) {
    consumer.apply(CorrelationMiddleware).forRoutes("*");
  }
}
Module({
  imports: [
    StoresModule,
    OutboxModule.forRoot({
      projectId: "test",
      transport: {
        publish: async (topic, data, attributes) => state.published.push({ topic, attributes }),
      },
    }),
    HousekeepingModule.forRoot({ imports: [ReservationsModule], sweeps: [ExpireSweep, BrokenSweep] }),
  ],
  controllers: [OrdersController],
  providers: [{ provide: APP_FILTER, useClass: ProblemJsonFilter }],
})(AppModule);

// --- app ----------------------------------------------------------------------------------------
let app;
const inject = (options) => app.getHttpAdapter().getInstance().inject(options);
const buyer = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";

before(async () => {
  app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

after(() => app?.close());

// The library logs JSON lines to stdout/stderr; keep the test output readable.
const writes = { out: process.stdout.write, err: process.stderr.write };
const isLogLine = (chunk) => String(chunk).startsWith('{"severity"');
before(() => {
  process.stdout.write = (chunk, ...rest) => isLogLine(chunk) || writes.out.call(process.stdout, chunk, ...rest);
  process.stderr.write = (chunk, ...rest) => isLogLine(chunk) || writes.err.call(process.stderr, chunk, ...rest);
});
after(() => {
  process.stdout.write = writes.out;
  process.stderr.write = writes.err;
});

const order = (body, headers = {}) =>
  inject({
    method: "POST",
    url: "/api/v1/orders",
    payload: body,
    headers: {
      "x-user-id": buyer,
      "x-user-email": "b@aforo.dev",
      "idempotency-key": key,
      ...headers,
    },
  });

test("idempotency: first call runs, a repeat replays the same body with Idempotent-Replayed", async () => {
  const first = await order({ quantity: 2 });
  assert.equal(first.statusCode, 201);
  assert.equal(first.headers["idempotent-replayed"], undefined);
  const second = await order({ quantity: 2 });
  assert.equal(second.statusCode, 201);
  assert.equal(second.headers["idempotent-replayed"], "true");
  assert.deepEqual(second.json(), first.json());
  assert.equal(state.handled, 1, "the handler ran once");
  assert.equal(state.idempotency.get(key).statusCode, 201);
});

test("idempotency: same key with another body, or another buyer, is 409 IDEMPOTENCY_CONFLICT", async () => {
  const otherBody = await order({ quantity: 3 });
  assert.equal(otherBody.statusCode, 409);
  assert.equal(otherBody.json().code, "IDEMPOTENCY_CONFLICT");
  assert.match(otherBody.headers["content-type"], /^application\/problem\+json/);
  const otherBuyer = await order({ quantity: 2 }, { "x-user-id": "33333333-3333-4333-8333-333333333333" });
  assert.equal(otherBuyer.statusCode, 409);
  assert.equal(state.handled, 1);
});

test("idempotency: a missing or malformed key is 422, a missing user is 401", async () => {
  const missing = await order({ quantity: 1 }, { "idempotency-key": "" });
  assert.equal(missing.statusCode, 422);
  assert.equal(missing.json().code, "VALIDATION_ERROR");
  assert.equal(missing.json().errors[0].field, "Idempotency-Key");
  const malformed = await order({ quantity: 1 }, { "idempotency-key": "not-a-uuid" });
  assert.equal(malformed.statusCode, 422);
  const anonymous = await order(
    { quantity: 1 },
    { "x-user-id": "", "idempotency-key": "44444444-4444-4444-8444-444444444444" },
  );
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.json().code, "UNAUTHENTICATED");
});

test("housekeeping: runs the sweeps, then flushes what they wrote, and answers 204", async () => {
  state.sweepRuns.length = 0;
  const response = await inject({ method: "POST", url: "/internal/v1/housekeeping" });
  assert.equal(response.statusCode, 204);
  assert.deepEqual(state.sweepRuns, ["expire:r-1", "broken"]);
  assert.equal(state.published.length, 1);
  assert.deepEqual(state.published[0], {
    topic: "aforo.inventory.reservation-expired",
    attributes: { type: "ReservationExpired", correlationId: "c" },
  });
});

test("housekeeping: a failing sweep does not stop the others or the flush, and answers 500", async () => {
  state.failSweep = true;
  state.sweepRuns.length = 0;
  state.published.length = 0;
  state.outbox.length = 0;
  try {
    const response = await inject({ method: "POST", url: "/internal/v1/housekeeping" });
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().code, "INTERNAL");
    assert.deepEqual(state.sweepRuns, ["expire:r-1", "broken"]);
    assert.equal(state.published.length, 1, "the outbox was still flushed");
  } finally {
    state.failSweep = false;
  }
});

const pushBody = (envelope) => ({
  message: { data: Buffer.from(JSON.stringify(envelope)).toString("base64"), messageId: "1" },
  subscription: "projects/p/subscriptions/orders-reservation-expired",
});

test("push envelope: a valid message reaches the handler with the envelope's correlation ID", async () => {
  const envelope = {
    messageId: "55555555-5555-4555-8555-555555555555",
    type: "ReservationExpired",
    version: 1,
    occurredAt: "2026-10-08T12:00:00Z",
    correlationId: "66666666-6666-4666-8666-666666666666",
    producer: "inventory",
    data: {
      reservationId: "77777777-7777-4777-8777-777777777777",
      eventId: "88888888-8888-4888-8888-888888888888",
      sectorId: "99999999-9999-4999-8999-999999999999",
      buyerId: buyer,
      quantity: 2,
      expiredAt: "2026-10-08T12:00:00Z",
    },
  };
  const response = await inject({
    method: "POST",
    url: "/internal/v1/events/orders-reservation-expired",
    payload: pushBody(envelope),
  });
  assert.equal(response.statusCode, 204);
  assert.equal(state.seen.envelope.data.reservationId, envelope.data.reservationId);
  assert.equal(state.seen.correlationId, envelope.correlationId);
});

test("push envelope: an invalid message is 400 MALFORMED_REQUEST, so it dead-letters", async () => {
  state.seen = null;
  const response = await inject({
    method: "POST",
    url: "/internal/v1/events/orders-reservation-expired",
    payload: pushBody({ type: "ReservationExpired", data: {} }),
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, "MALFORMED_REQUEST");
  assert.equal(state.seen, null);
});
