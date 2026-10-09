// E-01 on dev: create, configure and publish an event through the gateway whose sale opens in
// 3 min and closes in 8, then time a queue join at the opening. Appends to ./run.log.
//   node e01.cjs
const fs = require("fs");
const GW = "https://aforo-gateway-68220265740.southamerica-east1.run.app";
const LOG = `${__dirname}/run.log`;
const out = (l) => { const s = `${new Date().toISOString()} ${l}`; console.log(s); fs.appendFileSync(LOG, s + "\n"); };
const call = async (method, path, token, body) => {
  const t = performance.now();
  const r = await fetch(`${GW}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}), "idempotency-key": crypto.randomUUID() }, body: body && JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json, ms: Math.round(performance.now() - t) };
};

(async () => {
  const now = Date.now();
  const opens = new Date(Math.ceil((now + 3 * 60_000) / 1000) * 1000);
  const closes = new Date(opens.getTime() + 5 * 60_000);
  const login = await (await fetch(`${GW}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "e01-organizer@aforo.dev", displayName: "E-01 organizer" }) })).json();
  const token = login.accessToken;

  const ev = await call("POST", "/api/v1/events", token, {
    name: "Demo pre-warming (E-01)", venue: "Sala de pruebas",
    startsAt: new Date(opens.getTime() + 24 * 3600_000).toISOString(),
    salesOpensAt: opens.toISOString(), salesClosesAt: closes.toISOString(),
    sectors: [{ name: "General", capacity: 20, priceCents: 5000000 }],
  });
  out(`create -> ${ev.status} id=${ev.json.id} status=${ev.json.status} opens=${opens.toISOString()} closes=${closes.toISOString()}`);
  if (ev.status !== 201) throw new Error(JSON.stringify(ev.json));
  const id = ev.json.id;
  const rules = await call("PUT", `/api/v1/events/${id}/sales-rules`, token, { maxTicketsPerPerson: 4, reservationTtlSeconds: 60, openingWindowSeconds: 30 });
  out(`sales-rules -> ${rules.status}`);
  const pub = await call("POST", `/api/v1/events/${id}/publish`, token);
  out(`publish -> ${pub.status} status=${pub.json.status}`);
  fs.writeFileSync(`${__dirname}/event.json`, JSON.stringify({ id, opens, closes }));

  // At the opening: one buyer joins the queue; the latency is what a warm gateway + queue give.
  await new Promise((r) => setTimeout(r, opens.getTime() - Date.now() + 1000));
  const buyer = (await (await fetch(`${GW}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `e01-buyer-${now}@aforo.dev`, displayName: "E-01 buyer" }) })).json()).accessToken;
  const join = await call("POST", `/api/v1/queue/${id}/join`, buyer);
  out(`join at opening -> ${join.status} ${join.json.state ?? join.json.code} latencyMs=${join.ms}`);
})().catch((e) => { out(`error: ${e.message}`); process.exit(1); });
