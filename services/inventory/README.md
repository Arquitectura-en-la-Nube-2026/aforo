# inventory — Inventory & reservations

> Owner: Luis Esteban · Contract: [contracts/openapi/inventory.yaml](../../contracts/openapi/inventory.yaml)
> Status: not started

Owner of availability. The only service where a race condition turns into lost money, so there
are **no shortcuts** here. PostgreSQL, database `inventory`. Except for availability, the whole
API is internal: only Orders and Cloud Tasks call it.

## Endpoints

| Operation | Endpoint | Result |
| --------- | -------- | ------ |
| Availability | `GET /api/v1/events/{eventId}/availability` | Public |
| Reserve | `POST /internal/v1/reservations` | 201 `ACTIVE` or 409 |
| Confirm | `POST /internal/v1/reservations/{id}/confirm` | `CONFIRMED` or `EXPIRED` |
| Release | `POST /internal/v1/reservations/{id}/release` | `RELEASED` |
| Expire | `POST /internal/v1/reservations/{id}/expire` | Cloud Tasks target |

## Reservation transaction

Receives `{ eventId, sectorId, quantity, buyerId }` with `Idempotency-Key`. Does not verify any
pass (D-07). In **one local transaction**, in this order:

1. `UPDATE sector_availability SET available = available - :q WHERE sector_id = :s AND available >= :q`
   — 0 rows affected → `409 SOLD_OUT`.
2. Insert the reservation with `expires_at = now() + reservationTtlSeconds`; the partial unique
   index on `(event_id, buyer_id) WHERE status = 'ACTIVE'`
   → `409 ACTIVE_RESERVATION_EXISTS`.
3. Buyer's confirmed total + requested quantity > `maxTicketsPerPerson` → `409 LIMIT_EXCEEDED` (RF-12).
4. Write the outbox record if applicable.

After commit, `flush()` the outbox and enqueue the Cloud Tasks expiry task with delay =
`reservationTtlSeconds` and task name = `reservationId` (that is what prevents duplicates).
If the enqueue is lost, the housekeeping sweep expires the reservation within a minute (ADR-0003).

## Confirm vs. expire

Both are conditional on the same row:

- confirm: `UPDATE reservation SET status = 'CONFIRMED' WHERE id = :id AND status = 'ACTIVE'`
- expire: `UPDATE reservation SET status = 'EXPIRED' WHERE id = :id AND status = 'ACTIVE' AND expires_at <= now()`
  (Entrega 2 §5.4: only once the expiry instant is reached, ADR-0003)

Whoever affects one row wins; the other reads the current status and returns it with `200`
(an early expire call is harmless). `confirm` also increments `buyer_event_total`. `expire`
returns seats to the sector and writes `ReservationExpired` to the outbox. Both are idempotent.

## Housekeeping

`POST /internal/v1/housekeeping` (every minute, ADR-0002): expire every reservation with
`status = 'ACTIVE' AND expires_at <= now()` through the same code path as `/expire`, then flush
the outbox.

## Projection

Sectors, prices and rules are built by consuming `EventPublished` and `SalesRulesConfigured`.
An event not yet projected returns `404`; Catalog is never queried.

## Must-deliver test

**200 concurrent reservations on a sector with 10 seats leave exactly 10 reservations and 190
`SOLD_OUT`.** It's the only piece of E-02 that fits in the slice. Lives in `test/concurrency/`.
In dev it runs against 3 instances × 80 concurrency sharing 6 DB connections (ADR-0005): the
pool queues requests instead of opening connections, which is the aggregate concurrency limit
tactic of E-02. Record the p95 and the counts as evidence.

## Local Cloud Tasks replacement (by Thu Oct 1)

No official emulator. Ship a ~20-line dispatcher that does `setTimeout` and calls the same
`/expire` endpoint, behind the same `ExpiryScheduler` interface, selected by `EXPIRY_SCHEDULER=local`.

## Events

Produces `ReservationExpired` (`aforo.inventory.reservation-expired`). Consumes `EventPublished`
(`inventory-event-published`) and `SalesRulesConfigured` (`inventory-sales-rules`).

## Data

Tables: `sector_availability` (with `version`), `reservation` (with `expires_at`),
`buyer_event_total`, `event_projection`, `idempotency_key`, `inbox`, `outbox`.

Every table carries `event_id`, and keys and indexes start with it (e.g.
`sector_availability (event_id, sector_id)`): no sharding in the slice, but `event_id` is the
partition key if it is ever needed (ADR-0006).

## Configuration

See [.env.example](.env.example).
