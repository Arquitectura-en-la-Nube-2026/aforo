# queue — Waiting room & admission

> Owner: Cristian · Contract: [contracts/openapi/queue.yaml](../../contracts/openapi/queue.yaml)
> Status: deployed on `dev` behind the Gateway; every live purchase and the E-01 demo went through it
> (Oct 8–9, [docs/evidence/](../../docs/evidence/README.md)) · Also owns the queue screen in `apps/web`.

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
| `admitted:{eventId}:{userId}` | string + TTL | `<passExpiresAt in epoch ms>:<passToken>` (the expiry is stored, not derived from the TTL, so `passExpiresAt` does not drift between calls) |
| `event:{eventId}` | hash | projection (`salesOpensAt`, `salesClosesAt`, `openingWindowSeconds`), plus `publishedAt` and `rulesAt`: the `occurredAt` (epoch ms) of the last message of each kind applied. An older one is skipped, so rules changed from 0 to 60 s stay at 60 s even if the old message arrives last |
| `inbox:{messageId}` | string + TTL | consumed message ids |
| `admission:{eventId}:{tick}` | string + TTL | admission lock for one tick (ADR-0002) |

## Behavior the contract leaves open (decided here, for the contracts owner to confirm)

| Case | What the service does | Why |
| ---- | --------------------- | --- |
| `estimatedWaitSeconds` | `ceil(position / ADMISSION_BATCH_SIZE) * ADMISSION_INTERVAL_SECONDS` | The ticks needed to reach the position. Batch 500, 5 s: position 500 → 5 s, position 501 → 10 s |
| `aheadOf` | `position - 1` while waiting; `0` when admitted | `position - 1` would be -1 for an admitted buyer and break the contract minimum of 0 |
| Event with no projection (Catalog did not publish it, or Redis was recreated) | `join` → 404 `NOT_FOUND` | "I do not know this event" is not "the sale is closed" (409) |
| Only `SalesRulesConfigured` arrived | Still 404 | Rules alone cannot say whether the sale is open |
| `openingWindowSeconds` never arrived | Treated as 0: arrival order from the first second | EventPublished alone is enough to open the queue |
| Pass expired and the buyer joins again | They go to the **end** of the queue | The pass is not renewed (D-07); the 10 minutes are the buyer's chance |
| `status` / `stream` for a buyer who never joined or whose pass expired | 404 `NOT_FOUND` | The contract lists 404 and nothing else for this case |
| Buyer holds a pass and the sale closes | `join` still returns their pass; a new buyer gets 409 | A pass is a promise, closing the sale does not revoke it |
| Buyer is still waiting when the sale closes | `join` returns their place, and admission keeps serving the queue; a new buyer gets 409 | Same promise as the pass. Before, a page reload answered "not open" to a buyer whom the next tick would admit |
| Re-join | Keeps the place (`ZADD NX`) | Natural idempotency |
| `AUTH_MODE` | Reserved, not read | The service trusts `X-User-Id` set by the Gateway; Cloud Run IAM decides who can call it. It makes no outgoing service calls, so it never needs `@aforo/common`'s ID-token client |

## How the queue stays correct

- **Three Lua scripts** (`src/queue/queue-scripts.ts`) because moving a buyer between "in the queue"
  and "has a pass" touches two keys. As separate commands each has a gap: a `join` that checks for a
  pass and then adds to the queue can lose to an admission in between, leaving the buyer admitted
  *and* waiting; a `status` that reads the pass and then the rank can answer 404 to a buyer who was
  just admitted. `test/queue.concurrency.test.cjs` provokes both (and was checked to fail against the
  two-command versions).
- **The tick lock** (`SET admission:{eventId}:{tick} NX`) only stops two instances from admitting the
  same tick twice. It does not protect the queue-to-pass move: that is the script.
- **SSE reads Redis.** The admission runs on whichever instance wins the lock, usually not the one
  the buyer is connected to, so every open stream reads its state once a second and sends
  `position` only when it changed. The first message is a snapshot, so an admission between `join`
  and opening the stream is not missed. The server closes the stream after `admitted`.
- **Push consumers** (`events.controller.ts`) use one Redis Lua script to check the inbox key,
  update the event projection and mark the message. Concurrent deliveries cannot both apply the
  effect. An older fact is skipped and marked consumed, so a retried old message cannot undo a newer
  one. A projection error leaves no inbox marker, allowing Pub/Sub to retry.

## Run it locally

```bash
docker run --rm -p 6379:6379 redis:7
cp .env.example .env            # set REDIS_URL if Redis is elsewhere
npm run dev --workspace=@aforo/queue
node scripts/seed-event.mjs     # Catalog does not exist yet: seeds an event through the push endpoints
curl -X POST localhost:8080/api/v1/queue/8f1b2c3d-0000-4000-8000-000000000001/join \
     -H "X-User-Id: $(node -p 'crypto.randomUUID()')"
```

`X-User-Id` must be a UUID: it is what the Gateway forwards, and it is the sorted-set member.

## In `dev`

- **Deploy with Redis on.** The CI smoke test needs `/health/ready` = 200 (`.github/workflows/_service.yml`),
  and without Redis it is 503 by design. So run `make redis-up` first, then `make deploy SERVICE=queue`.
  A deploy that failed this way cannot be retried at the same commit: tags in Artifact Registry are
  immutable and every build has a new digest, so the push is rejected until there is a new commit.
- **Seed an event.** `make seed` runs Catalog's seed job, whose `EventPublished` facts reach the queue's
  push subscription and build the projection (`make redis-up` runs it too). Without it every `join`
  answers 404. To push a single event by hand instead, use the script with an ID token of an account
  allowed to invoke `aforo-queue` (the queue is private):

```bash
node scripts/seed-event.mjs --url https://aforo-queue-<project-number>.southamerica-east1.run.app \
     --token "$(gcloud auth print-identity-token)"
```

## Tests

`npm test --workspace=@aforo/queue` needs a real Redis, because the rules worth testing (the scripts,
the tick lock, the SSE reading Redis) only exist there. The tests use **database 15 and flush it**, so
they refuse any other `QUEUE_TEST_REDIS_URL`. Without Redis they skip and say so; set
`REQUIRE_REDIS=1` to make that a failure. The CI workflow has no Redis service today, so there the
Redis tests skip: add one (or `REQUIRE_REDIS=1` plus a service container) to make them count.

## Configuration

See [.env.example](.env.example).
