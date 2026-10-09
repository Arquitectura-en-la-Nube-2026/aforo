// "Fails well" checks of the acceptance script on dev, through the public gateway.
//   node fails-well.cjs   -> prints each request/answer; appends to ./run.log
const fs = require("fs");
const GW = "https://aforo-gateway-68220265740.southamerica-east1.run.app";
const FEST = "8f1b2c3d-0000-4000-8000-000000000001";
const LOG = `${__dirname}/run.log`;
const out = (l) => { const s = `${new Date().toISOString()} ${l}`; console.log(s); fs.appendFileSync(LOG, s + "\n"); };
const run = Date.now();

const login = async (who) =>
  (await (await fetch(`${GW}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `fw-${run}-${who}@aforo.dev`, displayName: `Fails well ${who}` }) })).json()).accessToken;
const sectors = async () => Object.fromEntries(
  (await (await fetch(`${GW}/api/v1/events/${FEST}/availability`)).json()).sectors.map((s) => [s.name, s]));
const order = async (token, sectorId, quantity, key = crypto.randomUUID()) => {
  const r = await fetch(`${GW}/api/v1/orders`, { method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ eventId: FEST, sectorId, quantity }) });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, replayed: r.headers.get("idempotent-replayed"), ctype: r.headers.get("content-type"), body };
};
const show = (label, r) => out(`${label} -> ${r.status} ${r.ctype} replayed=${r.replayed} ${JSON.stringify(r.body)}`);

(async () => {
  out(`--- fails well (run=${run}, users fw-${run}-<who>@aforo.dev) ---`);
  let s = await sectors();
  const PALCO = s.Palco.sectorId, GENERAL = s.General.sectorId;
  out(`availability: Palco ${s.Palco.available}/${s.Palco.capacity}, General ${s.General.available}/${s.General.capacity}`);

  // 1. More tickets than remain -> 409 SOLD_OUT, nothing decremented
  const a = await login("a"), b = await login("b");
  const take = Math.min(4, s.Palco.available - 2); // leave 2 seats
  show(`1a user A orders ${take} Palco`, await order(a, PALCO, take));
  const mid = (await sectors()).Palco.available;
  out(`Palco available after A: ${mid}`);
  show(`1b user B orders 4 Palco (only ${mid} left)`, await order(b, PALCO, 4));
  out(`Palco available after B: ${(await sectors()).Palco.available} (expected ${mid})`);

  // 2. More than the per-person maximum -> 409 LIMIT_EXCEEDED
  const c = await login("c");
  const g0 = (await sectors()).General.available;
  show("2 user C orders 5 General (max 4)", await order(c, GENERAL, 5));
  out(`General available: ${g0} -> ${(await sectors()).General.available}`);

  // 3. Same POST /orders, same Idempotency-Key -> same order, Idempotent-Replayed: true
  const d = await login("d");
  const key = crypto.randomUUID();
  const g1 = (await sectors()).General.available;
  const first = await order(d, GENERAL, 1, key);
  show(`3a user D orders 1 General, key ${key}`, first);
  const second = await order(d, GENERAL, 1, key);
  show(`3b same request, same key`, second);
  out(`same orderId: ${first.body.orderId === second.body.orderId}; General available: ${g1} -> ${(await sectors()).General.available} (expected -1)`);
})().catch((e) => { out(`error: ${e.message}`); process.exit(1); });
