# queue — Waiting room & admission

> Owner: Cristian · Contract: [contracts/openapi/queue.yaml](../../contracts/openapi/queue.yaml)
> Status: not started · Also owns the queue screen in `apps/web`.

Decides purchase order and admits at a pace. Redis only, no relational DB. The service with the
most domain logic, so it starts first (Mon Sept 28).

## Endpoints

| Operation | Endpoint | Response |
| --------- | -------- | -------- |
| Join | `POST /api/v1/queue/{eventId}/join` | 201 with position, or 409 `SALE_NOT_OPEN` |
| Status | `GET /api/v1/queue/{eventId}/status` | 200 with position or pass |
| Follow | `GET /api/v1/queue/{eventId}/stream` | SSE, one message per change |

`join` and `status` return the same `QueueStatus` object. When admitted: `state=ADMITTED`,
`position=0`, `passToken` set. The SSE emits the same object with `event: position` on each
change and `event: admitted` on admission; the client closes the stream there.

## Rules

- **Order (RF-05).** If the buyer arrives within `openingWindowSeconds` after `salesOpensAt`, the
  score is random within the window block; after it, the score is the arrival timestamp.
  One sorted set per event, `queue:{eventId}`, member = `userId`. A user who re-joins keeps their
  place (`ZSCORE` returns it).
- Joining when the projection says the sale is not open → `409 SALE_NOT_OPEN`.
- **Admission (RF-06).** An in-process job, every `ADMISSION_INTERVAL_SECONDS`, pops the first
  `ADMISSION_BATCH_SIZE` members and writes `admitted:{eventId}:{userId}` with TTL = pass validity.
  Demo: large batch, 5 s interval (D-12). Every instance runs the timer, so each tick first takes
  `SET admission:{eventId}:{tick} 1 NX EX <2 × interval>` with
  `tick = floor(now / ADMISSION_INTERVAL_SECONDS)`; only the winner admits (ADR-0002).
- **Pass.** On admission, generate an opaque `passToken` and store it in
  `admitted:{eventId}:{userId}` with a 10-minute TTL. Not signed, no JWKS, no Secret Manager
  (D-07). If it expires the buyer goes back to the queue; it is not renewed.
- **Local projection.** Consume `EventPublished` and `SalesRulesConfigured` and store per event:
  `salesOpensAt`, `salesClosesAt`, `openingWindowSeconds`. Never call Catalog on the critical path.
- **Cloud Run.** SSE and the admission timer need CPU always allocated and a high request
  timeout; `queue` is the only service configured that way (ADR-0002). If the stream gets
  cut mid-week-1, switch the client to polling `status` every 3 s without touching the contract.
- **Redis is Memorystore, and it exists only for live tests and demos** (ADR-0001).
  `make redis-up` creates it (several minutes, start 15 min before) and re-runs the catalog seed so
  the projection is rebuilt; `make redis-down` / `make down` destroy it. Every creation starts
  empty; losing positions is acceptable (buyers re-join).
- **Boot without Redis.** `REDIS_URL` is empty while Memorystore is off: the service must start
  (`/health/live` 200, `/health/ready` 503), connect lazily, and answer queue endpoints with
  `500 INTERNAL` ("queue store not available") until Redis is there.
- **Local development:** `docker run --rm -p 6379:6379 redis:7` and `REDIS_URL=redis://127.0.0.1:6379`.
  Test your push endpoints by POSTing a Pub/Sub push body locally; the `queue-*` subscriptions in
  dev exist only while Memorystore is on.

## Events

Consumes `EventPublished` (`queue-event-published`) and `SalesRulesConfigured`
(`queue-sales-rules`). Produces nothing.

## Redis keys

| Key | Type | Content |
| --- | ---- | ------- |
| `queue:{eventId}` | sorted set | member `userId`, score per RF-05 |
| `admitted:{eventId}:{userId}` | string + TTL | `passToken` |
| `event:{eventId}` | hash | projection (`salesOpensAt`, `salesClosesAt`, `openingWindowSeconds`) |
| `inbox:{messageId}` | string + TTL | consumed message ids |
| `admission:{eventId}:{tick}` | string + TTL | admission lock for one tick (ADR-0002) |

## Configuration

See [.env.example](.env.example).
