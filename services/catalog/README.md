# catalog — Catalog & events

> Owner: Juan José · Contract: [contracts/openapi/catalog.yaml](../../contracts/openapi/catalog.yaml)
> Status: service and seed done; the seed runs as the Cloud Run job `aforo-catalog-seed` (`make seed`)

Owner of the event, its sectors, its sales window and its rules. The **only** service that
decides whether a sale is open. PostgreSQL, database `catalog`.

## Endpoints

| Operation | Endpoint | Notes |
| --------- | -------- | ----- |
| List published | `GET /api/v1/events?status=PUBLISHED&page=0&size=20` | Public |
| Detail | `GET /api/v1/events/{eventId}` | Sectors, prices, rules, `saleState` |
| Create draft | `POST /api/v1/events` | Organizer (RF-01) → 201 `DRAFT` |
| Configure rules | `PUT /api/v1/events/{eventId}/sales-rules` | Organizer (RF-03) |
| Publish | `POST /api/v1/events/{eventId}/publish` | Organizer (RF-02) → 200; 422 if no rules |

## Rules

- `saleState` is computed with the server clock: `SCHEDULED` before `salesOpensAt`, `OPEN`
  between open and close, `CLOSED` after. The frontend never compares dates itself.
- Publishing writes **two** outbox rows in the same transaction: `EventPublished` and
  `SalesRulesConfigured`. Changing rules of an already-published event emits
  `SalesRulesConfigured` again.
- No other service reads this database: capacity and price reach Inventory by event, not by query
  (RD-03).
- No organizer UI (D-08): events are created by the seed and with Postman.
- After each commit that writes outbox rows, `flush()` before responding; housekeeping
  (`POST /internal/v1/housekeeping`, every minute) flushes anything left (ADR-0002).

### Behavior the contract leaves open

- `saleState` boundaries: `OPEN` from `salesOpensAt` inclusive, `CLOSED` from `salesClosesAt`
  inclusive. Drafts get a `saleState` too (the field is required).
- `GET /api/v1/events` without `status` lists every event, drafts included; the web always
  sends `status=PUBLISHED`. Order: `startsAt`, then `id`.
- Publishing an event that is already `PUBLISHED` answers 200 with the event as it is and emits
  nothing. The seed is what re-emits (below).
- Changing rules of a published event emits `SalesRulesConfigured` even if the values did not
  change; consumers upsert.
- `salesClosesAt` must be after `salesOpensAt` (422 on `salesClosesAt`).
- There are no roles: any signed-in user can create, configure and publish (D-06, D-08). Changes
  need `X-User-Id` (401 without it) and `Idempotency-Key` (422 without it).
- Each change locks the event row, so a rules change and a publish of the same event serialize.
  `PUBLISHED` never goes back to `DRAFT` (a trigger enforces it).

## Events

| Produces | Topic |
| -------- | ----- |
| `EventPublished` | `aforo.catalog.event-published` |
| `SalesRulesConfigured` | `aforo.catalog.sales-rules-configured` |

Consumes: nothing.

## Data

Tables: `event`, `sector`, `sales_rules`, `outbox`, `idempotency_key`.
Migrations in `migrations/`. `npm run migrate` needs only `DATABASE_URL`.

## Seed

`src/seed/` (`npm run seed`) creates and publishes **three demo events** with small sectors, one
of them with the sale `OPEN`. It must be **idempotent** (fixed UUIDs, upserts): `make up` and
`make redis-up` always run it, and **every run re-emits** `EventPublished` and
`SalesRulesConfigured` (new outbox rows even when nothing changed), so Queue rebuilds its
projection in a freshly created Memorystore (ADR-0001) and Inventory re-applies its upserts
(tested on Thu Oct 1). Inventory's upsert refreshes only the sector name and price: a re-seed
does **not** reset capacity or `available` there, so a sector sold out in a rehearsal stays sold
out until its reservations expire.

| Event | Sale | Sectors (capacity) | Why |
| ----- | ---- | ------------------ | --- |
| Festival Estéreo 2026 (`…0001`, the contract example) | `OPEN` until Nov 14 | General (200), VIP (40), Palco (6) | The purchase; Palco makes `SOLD_OUT` easy to show |
| Concierto Sinfónico de Fin de Año (`…0002`) | `SCHEDULED` (opens Dec 1) | Platea (120), Balcón (60) | A sale that is not open yet |
| Noche de Jazz (`…0003`) | `OPEN` until Dec 15 | Mesa (10) | E-02 against `dev` (exactly 10 seats; they come back when the test's reservations expire) |

Dates are fixed, not relative to the run, so every run converges to the same rows, and the
prewarmer skips all three (window over, or more than 30 days ahead): the seed never raises
min instances. This holds only until **Nov 1, 2026**: from then on the Concierto opens within 30
days and a seed run schedules its warm-up, and from Nov 14 the Festival is `CLOSED` (the seed DB
test asserts the sale states, so it fails too). Move the dates forward if the demo outlives
Delivery 4. E-01 publishes its own event through the API.

It writes everything and the six facts in one transaction, then flushes. If Pub/Sub fails the run
still succeeds with `event=seed_publish_deferred`, and housekeeping publishes within a minute. All
six facts carry the run's `correlationId` (logged as `event=seed_applied`). It needs the
service's env (`DATABASE_URL`, `GCP_PROJECT_ID`, topics); in `dev` it runs as a Cloud Run job
with the catalog image, because the database URL uses the Cloud SQL socket.

## Configuration

See [.env.example](.env.example).

## Tests

`npm test` runs the unit tests. The Postgres tests run when `TEST_DATABASE_URL` points at a
database whose name ends in `_test` (it is wiped):

```bash
TEST_DATABASE_URL=postgres://catalog:test@127.0.0.1:5432/catalog_test npm test
```

They check every published fact with the validator the consumers use (`parseEnvelope`, generated
from `contracts/events/`).
