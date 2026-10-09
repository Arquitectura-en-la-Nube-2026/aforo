// E-06 on dev through the gateway: payment intents against a faulty mock, then recovery.
//   make fault MODE=timeout  ->  node e06.cjs trip      (opens the circuit, records fast failures)
//   make fault MODE=none     ->  node e06.cjs recover   (same order; retries until 201)
// Output is appended to ./run.log; the order in use is kept in ./.state.json.
const fs = require("fs");
const GW = "https://aforo-gateway-68220265740.southamerica-east1.run.app";
const EVENT = "8f1b2c3d-0000-4000-8000-000000000001";
const GENERAL = "a1a1a1a1-0000-4000-8000-000000000001";
const STATE = `${__dirname}/.state.json`;
const LOG = `${__dirname}/run.log`;

const out = (line) => {
  const l = `${new Date().toISOString()} ${line}`;
  console.log(l);
  fs.appendFileSync(LOG, l + "\n");
};
const call = async (method, path, { token, body, headers = {} } = {}) => {
  const t = performance.now();
  const res = await fetch(`${GW}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, ms: Math.round(performance.now() - t), cid: res.headers.get("x-correlation-id") };
};

async function setup() {
  const email = `e06-${Date.now()}@aforo.dev`;
  const login = await call("POST", "/api/v1/auth/login", { body: { email, displayName: "E-06 demo" } });
  if (login.status !== 200) throw new Error(`login ${login.status} ${JSON.stringify(login.json)}`);
  const token = login.json.accessToken;
  let q = await call("POST", `/api/v1/queue/${EVENT}/join`, { token });
  for (let i = 0; q.json.state !== "ADMITTED" && i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    q = await call("GET", `/api/v1/queue/${EVENT}/status`, { token });
  }
  if (q.json.state !== "ADMITTED") throw new Error(`not admitted: ${JSON.stringify(q.json)}`);
  const pass = q.json.passToken;
  const order = await call("POST", "/api/v1/orders", {
    token,
    body: { eventId: EVENT, sectorId: GENERAL, quantity: 1 },
    headers: { "idempotency-key": crypto.randomUUID(), "x-queue-pass": pass },
  });
  if (order.status !== 201) throw new Error(`order ${order.status} ${JSON.stringify(order.json)}`);
  const state = { email, token, pass, orderId: order.json.orderId ?? order.json.id };
  fs.writeFileSync(STATE, JSON.stringify(state));
  out(`setup user=${email} order=${state.orderId} (PENDING_PAYMENT)`);
  return state;
}

const intent = async (s, n) => {
  const r = await call("POST", `/api/v1/orders/${s.orderId}/payment-intents`, {
    token: s.token,
    headers: { "idempotency-key": crypto.randomUUID(), "x-queue-pass": s.pass },
  });
  out(`intent #${n} -> ${r.status} ${r.json?.code ?? ""} latencyMs=${r.ms} correlationId=${r.cid}`);
  return r;
};

(async () => {
  const phase = process.argv[2];
  if (phase === "trip") {
    out("--- trip (fault expected: timeout) ---");
    const s = await setup();
    // ~6.6 s per call while closed (3 attempts x 2 s timeout + backoff); fast once open.
    for (let n = 1; n <= 6; n++) await intent(s, n);
  } else if (phase === "recover") {
    out("--- recover (fault expected: none) ---");
    const s = JSON.parse(fs.readFileSync(STATE, "utf8"));
    for (let n = 1; n <= 30; n++) {
      const r = await intent(s, n);
      if (r.status === 201) {
        out(`recovered: checkoutUrl=${r.json.checkoutUrl}`);
        return;
      }
      await new Promise((res) => setTimeout(res, 5000));
    }
    out("did not recover within 30 tries");
  } else {
    console.log("usage: node e06.cjs <trip|recover>");
    process.exit(1);
  }
})().catch((e) => {
  out(`error: ${e.message}`);
  process.exit(1);
});
