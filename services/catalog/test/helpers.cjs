// Shared by the Postgres tests. Opt-in: TEST_DATABASE_URL=postgres://.../catalog_test npm test
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
  const url = new URL(TEST_DATABASE_URL);
  if (!/_test$/.test(url.pathname)) {
    return `refusing to wipe ${url.pathname}: the test database name must end in _test`;
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

/** A fake Pub/Sub emulator that records every publish; `failing = true` makes it answer 503. */
async function startPubSub() {
  const state = { published: [], failing: false };
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      if (state.failing) {
        response.writeHead(503, { "content-type": "application/json" });
        response.end('{"error":{"code":503}}');
        return;
      }
      const topic = decodeURIComponent(request.url.split("/topics/")[1].split(":publish")[0]);
      for (const message of JSON.parse(body).messages) {
        state.published.push({
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
  state.host = `127.0.0.1:${server.address().port}`;
  state.close = () => new Promise((r) => server.close(r));
  return state;
}

/** Boots the real AppModule on Fastify and returns Fastify's inject. */
async function startApp({ pubsubHost }) {
  Object.assign(process.env, {
    DATABASE_URL: TEST_DATABASE_URL,
    DB_POOL_MAX: "2",
    GCP_PROJECT_ID: "test",
    PUBSUB_EMULATOR_HOST: pubsubHost,
    LOG_LEVEL: "error",
    SERVICE_NAME: "catalog",
  });
  const { NestFactory } = require("@nestjs/core");
  const { FastifyAdapter } = require("@nestjs/platform-fastify");
  const { AppModule } = require("../dist/app.module");
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const inject = (options) => app.getHttpAdapter().getInstance().inject(options);
  return { app, inject };
}

const ORGANIZER = "0b8a5f0e-5c1e-5a4b-9a43-2f9d8b7c6a51";

/** A state-changing call as the Gateway forwards it: organizer headers and a fresh key. */
function organizer(inject, method, url, payload, { key = randomUUID(), user = ORGANIZER, headers = {} } = {}) {
  return inject({
    method,
    url,
    payload,
    headers: { "x-user-id": user, "x-user-email": "organizer@aforo.dev", "idempotency-key": key, ...headers },
  });
}

const hour = 3600 * 1000;
const isoAt = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

/** A valid CreateEventRequest; the sale is OPEN unless the window is overridden. */
function newEvent(overrides = {}) {
  return {
    name: "Festival Estéreo 2026",
    venue: "Parque Simón Bolívar",
    startsAt: isoAt(48 * hour),
    salesOpensAt: isoAt(-hour),
    salesClosesAt: isoAt(24 * hour),
    sectors: [
      { name: "General", capacity: 500, priceCents: 18000000 },
      { name: "VIP", capacity: 50, priceCents: 45000000 },
    ],
    ...overrides,
  };
}

const RULES = { maxTicketsPerPerson: 4, reservationTtlSeconds: 480, openingWindowSeconds: 30 };

async function sql(text, params) {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, params)).rows;
  } finally {
    await client.end();
  }
}

module.exports = {
  TEST_DATABASE_URL,
  skipReason,
  resetDatabase,
  startPubSub,
  startApp,
  organizer,
  newEvent,
  isoAt,
  hour,
  RULES,
  ORGANIZER,
  sql,
};
