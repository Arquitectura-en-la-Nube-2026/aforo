// Seeds one event into a running queue the way Pub/Sub would, for local development: Catalog does not
// exist yet, so nobody else sends EventPublished and SalesRulesConfigured. It POSTs both push bodies.
//
//   node scripts/seed-event.mjs                         event 8f1b2c3d-...-01, open now, closes in 1 h
//   node scripts/seed-event.mjs --opens-in 30 --window 10
//
// Options: --url (default http://127.0.0.1:8080), --event, --opens-in <seconds, negative = already open>,
// --closes-in <seconds>, --window <opening window seconds>.
import { randomUUID } from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1]]);
    return pairs;
  }, []),
);

const base = args.url ?? process.env.QUEUE_URL ?? "http://127.0.0.1:8080";
const eventId = args.event ?? "8f1b2c3d-0000-4000-8000-000000000001";
const now = Date.now();
const iso = (offsetSeconds) => new Date(now + Number(offsetSeconds) * 1000).toISOString();

const envelope = (type, data) => ({
  subscription: "projects/aforo-dev/subscriptions/local-seed",
  message: {
    messageId: "1",
    data: Buffer.from(
      JSON.stringify({
        messageId: randomUUID(),
        type,
        version: 1,
        occurredAt: new Date(now).toISOString(),
        correlationId: randomUUID(),
        producer: "catalog",
        data,
      }),
    ).toString("base64"),
  },
});

async function push(subscription, body) {
  const response = await fetch(`${base}/internal/v1/events/${subscription}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status !== 204) throw new Error(`${subscription} answered ${response.status}: ${await response.text()}`);
}

await push(
  "queue-event-published",
  envelope("EventPublished", {
    eventId,
    name: "Festival Estéreo 2026",
    salesOpensAt: iso(args["opens-in"] ?? 0),
    salesClosesAt: iso(args["closes-in"] ?? 3600),
    sectors: [{ sectorId: randomUUID(), name: "General", capacity: 500, priceCents: 18000000, currency: "COP" }],
  }),
);
await push(
  "queue-sales-rules",
  envelope("SalesRulesConfigured", {
    eventId,
    maxTicketsPerPerson: 4,
    reservationTtlSeconds: 480,
    openingWindowSeconds: Number(args.window ?? 0),
  }),
);
console.log(`seeded event ${eventId} into ${base}`);
