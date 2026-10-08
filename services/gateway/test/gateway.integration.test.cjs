const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { test } = require("node:test");
const { NestFactory } = require("@nestjs/core");
const { JwtService } = require("@nestjs/jwt");
const { FastifyAdapter } = require("@nestjs/platform-fastify");

process.env.AUTH_SECRET = randomBytes(32).toString("base64url");
process.env.AUTH_ISSUER = "https://gateway.aforo.dev";
process.env.FRONTEND_ORIGIN = "http://localhost:4200";
process.env.CATALOG_URL = "http://127.0.0.1:1"; // required by config; no Catalog call in this test
process.env.QUEUE_URL = "http://127.0.0.1:1"; // required by the config; this test never reaches the queue
process.env.ORDERS_URL = "http://127.0.0.1:1";
process.env.INVENTORY_URL = "http://127.0.0.1:1";
process.env.MOCK_PAYMENT_GATEWAY_URL = "http://127.0.0.1:1";

test("Gateway follows the login, error, and health contracts", async () => {
  const { AppModule } = require("../dist/app.module");
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false });
  await app.init();

  try {
    const server = app.getHttpAdapter().getInstance();
    const login = await server.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "Ana@Example.com", displayName: "Ana" },
    });
    assert.equal(login.statusCode, 200);
    const session = login.json();
    assert.equal(session.tokenType, "Bearer");
    assert.equal(session.user.email, "ana@example.com");
    assert.match(login.headers["x-correlation-id"], /^[0-9a-f-]{36}$/i);

    const claims = await app.get(JwtService).verifyAsync(session.accessToken, {
      algorithms: ["HS256"],
      issuer: process.env.AUTH_ISSUER,
    });
    assert.equal(claims.sub, session.user.id);
    assert.equal(claims.email, session.user.email);
    assert.equal(claims.exp - claims.iat, 8 * 60 * 60);
    assert.equal(new Date(session.expiresAt).getTime(), claims.exp * 1000);

    const repeat = await server.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "ana@example.com", displayName: "Ana" },
    });
    assert.equal(repeat.json().user.id, session.user.id);

    const invalid = await server.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "invalid", displayName: "" },
    });
    assert.equal(invalid.statusCode, 422);
    assert.equal(invalid.json().code, "VALIDATION_ERROR");
    assert.match(invalid.headers["content-type"], /^application\/problem\+json/);

    const malformed = await server.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    assert.equal(malformed.statusCode, 400);
    assert.equal(malformed.json().code, "MALFORMED_REQUEST");

    assert.deepEqual((await server.inject({ method: "GET", url: "/health/live" })).json(), {
      status: "ok",
    });
    assert.equal((await server.inject({ method: "GET", url: "/missing" })).json().code, "NOT_FOUND");
  } finally {
    await app.close();
  }
});
