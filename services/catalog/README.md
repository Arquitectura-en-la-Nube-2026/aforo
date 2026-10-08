# catalog — Catalog & events

> Owner: Juan José · Contract: [contracts/openapi/catalog.yaml](../../contracts/openapi/catalog.yaml)
> Status: service done (endpoints, outbox, housekeeping); seed pending

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

## Seed (extra deliverable, needed by Wed Sept 30)

`seed/` — script that creates and publishes **three demo events** with small sectors, one of them
with the sale `OPEN`. It must be **idempotent** (fixed UUIDs, upserts): `make up` and
`make redis-up` always run it, and **every run re-emits** `EventPublished` and
`SalesRulesConfigured` (new outbox rows even when nothing changed), so Queue rebuilds its
projection in a freshly created Memorystore (ADR-0001) and Inventory re-applies its upserts
(tested on Thu Oct 1).

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
