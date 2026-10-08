// Shared by the Postgres tests. Opt-in: TEST_DATABASE_URL=postgres://.../inventory_test npm test
// The database is wiped and migrated on every run, so its name must end in _test.
require("reflect-metadata");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { Client } = require("pg");

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

function skipReason() {
  if (!TEST_DATABASE_URL) return "TEST_DATABASE_URL not set";
  if (!/_test(\?|$)/.test(new URL(TEST_DATABASE_URL).pathname + new URL(TEST_DATABASE_URL).search)) {
    return `refusing to wipe ${new URL(TEST_DATABASE_URL).pathname}: the test database name must end in _test`;
  }
  return null;
}

async function resetDatabase() {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await client.end();
  execFileSync(process.execPath, [path.join(__dirname, "..", "dist", "db", "migrate.js")], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "ignore",
  });
}

/** A fake Pub/Sub emulator that records every publish. */
async function startPubSub() {
  const published = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const topic = decodeURIComponent(request.url.split("/topics/")[1].split(":publish")[0]);
      for (const message of JSON.parse(body).messages) {
        published.push({
          topic,
          attributes: message.attributes,
          data: JSON.parse(Buffer.from(message.data, "base64").toString()),
        });
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"messageIds":["1"]}');
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { host: `127.0.0.1:${server.address().port}`, published, close: () => new Promise((r) => server.close(r)) };
}

/** Boots the real AppModule on Fastify. `listen` gives a real port (concurrency test). */
async function startApp({ pubsubHost, poolMax = 2, listen = false } = {}) {
  Object.assign(process.env, {
    DATABASE_URL: TEST_DATABASE_URL,
    DB_POOL_MAX: String(poolMax),
    GCP_PROJECT_ID: "test",
    EXPIRY_SCHEDULER: "local",
    PUBSUB_EMULATOR_HOST: pubsubHost ?? "127.0.0.1:1",
    LOG_LEVEL: "error",
    SERVICE_NAME: "inventory",
  });
  const { NestFactory } = require("@nestjs/core");
  const { FastifyAdapter } = require("@nestjs/platform-fastify");
  const { AppModule } = require("../dist/app.module");
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false });
  if (listen) await app.listen(0, "127.0.0.1");
  else await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const inject = (options) => app.getHttpAdapter().getInstance().inject(options);
  const url = listen ? `http://127.0.0.1:${app.getHttpServer().address().port}` : null;
  return { app, inject, url };
}

let sequence = 0;
/** A Pub/Sub push body around a valid envelope. */
function push(type, data, overrides = {}) {
  sequence += 1;
  const envelope = {
    messageId: randomUUID(),
    type,
    version: 1,
    occurredAt: new Date(Date.UTC(2026, 9, 1, 12, 0, sequence)).toISOString(),
    correlationId: randomUUID(),
    producer: "catalog",
    data,
    ...overrides,
  };
  return {
    envelope,
    body: { message: { data: Buffer.from(JSON.stringify(envelope)).toString("base64"), messageId: "1" } },
  };
}

/** Projects an event (both facts) and returns its ids. */
async function projectEvent(
  inject,
  { capacity = 10, maxTicketsPerPerson = 4, priceCents = 18000000, sectors = 1 } = {},
) {
  const eventId = randomUUID();
  const sectorIds = Array.from({ length: sectors }, () => randomUUID());
  const published = push("EventPublished", {
    eventId,
    name: "Festival",
    salesOpensAt: "2026-10-01T15:00:00Z",
    salesClosesAt: "2026-11-14T20:00:00Z",
    sectors: sectorIds.map((sectorId, i) => ({ sectorId, name: `Sector ${i}`, capacity, priceCents, currency: "COP" })),
  });
  const rules = push("SalesRulesConfigured", {
    eventId,
    maxTicketsPerPerson,
    reservationTtlSeconds: 480,
    openingWindowSeconds: 0,
  });
  for (const [url, message] of [
    ["/internal/v1/events/inventory-event-published", published],
    ["/internal/v1/events/inventory-sales-rules", rules],
  ]) {
    const response = await inject({ method: "POST", url, payload: message.body });
    if (response.statusCode !== 204) throw new Error(`projection ${url}: ${response.statusCode} ${response.body}`);
  }
  return { eventId, sectorId: sectorIds[0], sectorIds };
}

async function sql(text, params) {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, params)).rows;
  } finally {
    await client.end();
  }
}

module.exports = { TEST_DATABASE_URL, skipReason, resetDatabase, startPubSub, startApp, push, projectEvent, sql };
