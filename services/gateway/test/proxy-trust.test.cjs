// Which address Fastify reports as the client decides the quota key, so it must not change with the
// Fastify version. @nestjs/platform-fastify bundles its own copy (5.11.x) next to the one at the root
// (5.12.x); the numeric `trustProxy: 1` means "count hops" in one and "trust nothing" in the other.
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const { trustOneProxyHop } = require("../dist/trust-proxy");

const copies = {
  "the Fastify bundled by @nestjs/platform-fastify": createRequire(require.resolve("@nestjs/platform-fastify/package.json"))("fastify"),
  "the Fastify at the repository root": require("fastify"),
};

async function clientIp(Fastify, trustProxy, { socket = "10.0.0.1", forwardedFor }) {
  const app = Fastify({ trustProxy });
  app.get("/", async (request) => request.ip);
  try {
    const response = await app.inject({
      method: "GET",
      url: "/",
      remoteAddress: socket,
      headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
    });
    return response.body;
  } finally {
    await app.close();
  }
}

for (const [name, Fastify] of Object.entries(copies)) {
  test(`trustOneProxyHop takes the address the proxy appended, not the one the client wrote (${name})`, async () => {
    // Client wrote 198.51.100.7; Cloud Run's front end appended the real address, 203.0.113.40.
    assert.equal(await clientIp(Fastify, trustOneProxyHop, { forwardedFor: "198.51.100.7, 203.0.113.40" }), "203.0.113.40");
    assert.equal(await clientIp(Fastify, trustOneProxyHop, { forwardedFor: "9.9.9.9, 198.51.100.7, 203.0.113.40" }), "203.0.113.40");
    // Only the proxy's entry: that is the client.
    assert.equal(await clientIp(Fastify, trustOneProxyHop, { forwardedFor: "203.0.113.40" }), "203.0.113.40");
    // No header (a direct call): the socket peer.
    assert.equal(await clientIp(Fastify, trustOneProxyHop, {}), "10.0.0.1");
  });
}

test("the options the Gateway could have used are NOT safe, which is why it uses the function", async () => {
  const [bundled, root] = Object.values(copies);
  const both = { forwardedFor: "198.51.100.7, 203.0.113.40" };
  // `true` takes the first entry, the one the client writes, on both copies.
  assert.equal(await clientIp(bundled, true, both), "198.51.100.7");
  assert.equal(await clientIp(root, true, both), "198.51.100.7");
  // No setting: everyone is the proxy's address.
  assert.equal(await clientIp(bundled, undefined, both), "10.0.0.1");
  // The number 1 differs by version. If these two ever agree, this guard can be relaxed.
  const byVersion = [await clientIp(bundled, 1, both), await clientIp(root, 1, both)];
  assert.notDeepEqual(byVersion[0], byVersion[1], `numeric trustProxy answered the same on both copies: ${byVersion}`);
});
