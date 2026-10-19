// E-02 on dev through the public gateway: N buyers order 1 seat each, all at once, on the
// 10-seat "Mesa" sector of "Noche de Jazz". gateway -> orders -> inventory, as in a real sale.
// No queue pass: it is never verified downstream (D-07), so the burst skips the waiting room.
//   node e02-gateway.cjs [buyers=200] [spreadMs=0]   -> appends to ./run-dev.log, raw results in ./run-dev*.json
// E02_EVENT and E02_SECTOR target another seeded sector (paid seats never come back, so a sold-out
// Mesa needs one), e.g. Palco (6 seats) of "Festival Estéreo 2026".
// spreadMs > 0 sends the orders evenly over that window, like a metered admission.
const fs = require("fs");
const GW = "https://aforo-gateway-68220265740.southamerica-east1.run.app";
const EVENT = process.env.E02_EVENT || "8f1b2c3d-0000-4000-8000-000000000003";
const MESA = process.env.E02_SECTOR || "a3a3a3a3-0000-4000-8000-000000000001";
const N = Number(process.argv[2] ?? 200);
const SPREAD = Number(process.argv[3] ?? 0);
const LOG = `${__dirname}/run-dev.log`;

const out = (line) => {
  const l = `${new Date().toISOString()} ${line}`;
  console.log(l);
  fs.appendFileSync(LOG, l + "\n");
};
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const available = async () =>
  (await (await fetch(`${GW}/api/v1/events/${EVENT}/availability`)).json()).sectors.find((s) => s.sectorId === MESA).available;

async function login(i, run) {
  const r = await fetch(`${GW}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `e02-${run}-${i}@aforo.dev`, displayName: `E-02 buyer ${i}` }),
  });
  if (r.status !== 200) throw new Error(`login ${i}: ${r.status}`);
  return (await r.json()).accessToken;
}

async function order(token) {
  const t = performance.now();
  const r = await fetch(`${GW}/api/v1/orders`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ eventId: EVENT, sectorId: MESA, quantity: 1 }),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, code: body.code ?? null, orderId: body.orderId ?? null, ms: Math.round(performance.now() - t), cid: r.headers.get("x-correlation-id") };
}

(async () => {
  const run = Date.now();
  out(`--- E-02 via gateway (run=${run}, buyers e02-${run}-<i>@aforo.dev): ${N} buyers x 1 seat, sector ${MESA} of event ${EVENT}, ${SPREAD ? `spread over ${SPREAD} ms` : "all at once"} ---`);
  const before = await available();
  out(`available before: ${before}`);

  const tokens = [];
  for (let i = 0; i < N; i += 20)
    tokens.push(...(await Promise.all(Array.from({ length: Math.min(20, N - i) }, (_, j) => login(i + j, run)))));
  out(`${tokens.length} buyers logged in`);

  const start = new Date().toISOString();
  const results = await Promise.all(
    tokens.map((t, i) => new Promise((r) => setTimeout(r, (i * SPREAD) / N)).then(() => order(t))),
  );
  const end = new Date().toISOString();

  const created = results.filter((r) => r.status === 201);
  const by = {};
  for (const r of results) by[`${r.status} ${r.code ?? ""}`.trim()] = (by[`${r.status} ${r.code ?? ""}`.trim()] ?? 0) + 1;
  const ms = results.map((r) => r.ms);
  out(`burst ${start} .. ${end}`);
  out(`answers: ${JSON.stringify(by)}`);
  out(`created=${created.length} (expected ${before}); client latency p50=${pct(ms, 50)} ms p95=${pct(ms, 95)} ms max=${Math.max(...ms)} ms`);
  const after = await available();
  out(`available after: ${after}; oversold=${Math.max(0, created.length - before)}`);
  fs.writeFileSync(`${__dirname}/run-dev${SPREAD ? `-spread${SPREAD}` : ""}.json`, JSON.stringify({ start, end, before, after, results }, null, 1));
})().catch((e) => {
  out(`error: ${e.message}`);
  process.exit(1);
});
