# E-05 · Observability: a dead-lettered message raises an alert

**Target (Delivery 3):** a message no consumer can process does not block the subscription or
get lost: after 5 attempts it moves to that consumer's DLQ, the `dlq-monitor` function (FaaS #2)
logs it with its `correlationId`, and the alert **aforo: message dead-lettered** opens an incident
and emails the team within 5 minutes.

**When:** Fri Oct 9, 2026, 13:27–13:29 UTC.
**How:** `make poison TOPIC=aforo.catalog.event-published` publishes `not-an-envelope` with
`correlationId=fe16d541-35ee-46f7-887e-e8debaf1fff6`.

The topic has three push subscriptions, each with its own DLQ topic (`infra/modules/pubsub-topic`):
inventory, queue and the `prewarmer` function. All three rejected it, so it dead-lettered three
times.

## Result

| Target | Observed |
| ------ | -------- |
| Each consumer rejects the bad message (`400`), nothing is applied | ✅ inventory, queue and prewarmer, 5 deliveries each, `400` in 2–6 ms when warm |
| Retried with backoff, then moved to the DLQ after 5 attempts | ✅ attempts at ~13, ~13, ~17 and ~25 s apart; DLQ at `deliveryAttempt: 5` |
| `dlq-monitor` logs `event=dead_letter` with the `correlationId` and the DLQ topic | ✅ 3 lines, 13:28:36 → 13:28:46 (1 min 36 s after publishing) |
| Alert opens an incident + email ≤ 5 min | ⏳ screenshots pending (`01-incident.png`, `02-email.png`) |

### Timeline (UTC)

| Time | Hop |
| ---- | --- |
| 13:27:00 | Poison published |
| 13:27:02.980 | inventory → `400` (attempt 1) |
| 13:27:03.032 | prewarmer → `400` (attempt 1, cold start, logs `prewarm_invalid`) |
| 13:27:03.282 | queue → `400` (attempt 1) |
| 13:27:15 → 13:28:18 | attempts 2–5 on each subscription, all `400` |
| 13:28:36.429 | `dlq-monitor`: `dead_letter`, `inventory-event-published-dlq`, `deliveryAttempt: 5` (cold start) |
| 13:28:45.811 | `dlq-monitor`: `dead_letter`, `prewarmer-event-published-dlq` |
| 13:28:46.105 | `dlq-monitor`: `dead_letter`, `queue-event-published-dlq` |

A bad message costs five cheap `400`s per consumer and then leaves the subscription.

## Log queries

The whole story of the message, every hop:

```
jsonPayload.correlationId="fe16d541-35ee-46f7-887e-e8debaf1fff6"
```

What the alert counts (log-based metric `aforo/dead_letters`):

```
resource.type="cloud_run_revision"
resource.labels.service_name="aforo-dlq-monitor"
jsonPayload.event="dead_letter"
```

Deliveries and rejections:

```
resource.type="cloud_run_revision"
resource.labels.service_name=("aforo-inventory" OR "aforo-queue" OR "aforo-prewarmer")
httpRequest.status=400
timestamp>="2026-10-09T13:26:50Z" timestamp<="2026-10-09T13:29:00Z"
```

## Rerun

```bash
make poison TOPIC=aforo.catalog.event-published   # ~2 min to the DLQ; the alert follows
```

The incident closes by itself 30 min after the last dead letter (`auto_close`).
