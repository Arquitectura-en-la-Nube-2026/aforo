# Event contracts (Pub/Sub) and expiry queue (Cloud Tasks)

The bus is Pub/Sub: one topic per business fact and one push subscription per consumer.
The expiry queue is Cloud Tasks, because it needs delayed delivery and Pub/Sub doesn't have it.

## Envelope

Every message uses the same envelope ([envelope.schema.json](envelope.schema.json)).
`type` and `correlationId` are **also** set as Pub/Sub attributes so they can be filtered without
opening the body.

```json
{
  "messageId": "1f7c…",
  "type": "OrderPaid",
  "version": 1,
  "occurredAt": "2026-10-01T15:04:11Z",
  "correlationId": "6f1c…",
  "producer": "orders",
  "data": { }
}
```

## Topics and subscriptions

| Topic | Producer | `type` | Payload schema | Push subscription | Consumer |
| ----- | -------- | ------ | -------------- | ----------------- | -------- |
| `aforo.catalog.event-published` | catalog | `EventPublished` | [event-published.v1](event-published.v1.schema.json) | `queue-event-published` | queue |
| `aforo.catalog.event-published` | catalog | `EventPublished` | ″ | `inventory-event-published` | inventory |
| `aforo.catalog.event-published` | catalog | `EventPublished` | ″ | `prewarmer-event-published` | `functions/prewarmer` (D-21), at `POST /events/prewarmer-event-published` |
| `aforo.catalog.sales-rules-configured` | catalog | `SalesRulesConfigured` | [sales-rules-configured.v1](sales-rules-configured.v1.schema.json) | `queue-sales-rules` | queue |
| `aforo.catalog.sales-rules-configured` | catalog | `SalesRulesConfigured` | ″ | `inventory-sales-rules` | inventory |
| `aforo.inventory.reservation-expired` | inventory | `ReservationExpired` | [reservation-expired.v1](reservation-expired.v1.schema.json) | `orders-reservation-expired` | orders |
| `aforo.orders.order-paid` | orders | `OrderPaid` | [order-paid.v1](order-paid.v1.schema.json) | *none in this slice* | — |
| `<subscription>-dlq` ×6 | Pub/Sub (dead-lettering) | any | [envelope](envelope.schema.json) (may be malformed) | Eventarc trigger | `functions/dlq-monitor` |

The `order-paid` topic is created anyway: when ticket issuance arrives, Orders doesn't change.

Every push subscription targets `POST /internal/v1/events/{subscription-name}` on its consumer,
authenticated with OIDC, retry backoff 10 s → 60 s, 5 delivery attempts, then its DLQ
(`<subscription>-dlq`) (ADR-0005). Total: 4 business topics, 6 push subscriptions, 6 DLQ topics.

The two `queue-*` subscriptions and their DLQs exist **only while Memorystore is on**
(`make redis-up`, ADR-0001). Messages published while they don't exist are not kept for the
queue; `make redis-up` re-runs the catalog seed, which re-emits both facts to rebuild the
projection.
(The plan's infra table says "6 topics"; its scope table says 4 — confirm at the freeze.)

**Publishing order is not guaranteed.** Catalog emits `EventPublished` and
`SalesRulesConfigured` in the same transaction, but consumers may receive them in any order:
projections must upsert and tolerate either arriving first.

## Outbox (producers)

- Write the fact to the `outbox` table **inside the business transaction**.
- After the commit and before responding, the same request calls `OutboxPublisher.flush()`,
  which sends pending rows to Pub/Sub and marks them sent.
- `POST /internal/v1/housekeeping`, called every minute by Cloud Scheduler, flushes whatever was
  left unsent (crash, Pub/Sub error). No pollers or timers: Cloud Run throttles CPU between
  requests (ADR-0002).
- Never call Pub/Sub directly; only the outbox publisher publishes.

## Inbox (consumers)

- A body that is not a valid envelope answers `400`, never `2xx`: after 5 attempts it lands in
  the DLQ and `dlq-monitor` raises the alert (E-05, `make poison`).
- Insert `messageId` into `inbox` **in the same transaction as the effect**; discard if already
  present.
- 2xx acknowledges; anything else triggers a retry. Delivery is at-least-once: handlers must be
  safe to run twice.
- When debugging a consumer locally, create your own subscription with your initials as suffix.

## Delayed-delivery queues (Cloud Tasks)

| Queue | Producer | Target | Task name | Schedule | Retries |
| ----- | -------- | ------ | --------- | -------- | ------- |
| `reservation-expiry` | inventory | `POST /internal/v1/reservations/{id}/expire` (inventory) | `reservationId` (dedup) | `now + reservationTtlSeconds` | 5, `maxDoublings` 3 |
| `payment-webhooks` | mock-payment-gateway | `POST /webhook-dispatch` (same function) | `notificationId` (dedup) | `now + 2 s` | 5 |
| `prewarm-windows` | prewarmer | `POST /windows/warm`, `POST /windows/cool` (same function) | `warm-{eventId}-{epoch(opens)}`, `cool-{eventId}-{epoch(closes)}` (dedup) | `salesOpensAt − lead`, `min(salesClosesAt, salesOpensAt + hold)` | 5 |

The task name is the deduplication: two attempts to enqueue the same reservation (or notification) produce one task.

Tasks are enqueued after the commit, so an enqueue can be lost. For reservations this is covered
by Inventory's housekeeping sweep, which expires every `ACTIVE` reservation past `expires_at`
within a minute (ADR-0003). `payment-webhooks` needs no sweep: the mock has no database, it
enqueues inside the `complete` request and shows an error page if that fails; and
`/webhook-dispatch` answers non-2xx when Orders fails, so Cloud Tasks retries.
There is no official emulator: locally, a ~20-line dispatcher with `setTimeout` calls the same
endpoint behind the same interface (delivered by Inventory by Thu Oct 1).
