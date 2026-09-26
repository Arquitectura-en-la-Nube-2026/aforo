# dlq-monitor — FaaS #2 (Pub/Sub-triggered)

> Owner: Julián (Platform / observability) · Consumes: DLQ topics of [contracts/events](../../contracts/events/README.md)
> Decision: D-17 · Status: not started

Realizes the E-05 tactic "a DLQ with messages raises an alert" without new functional scope.
Triggered (Eventarc / Pub/Sub trigger) by each of the five `<subscription>-dlq` topics.

## Behavior

For each dead-lettered message:
1. Decode the envelope (tolerate malformed bodies: a poison message is exactly what lands here).
2. Emit **one structured log line** at `severity=ERROR` with `event=dead_letter`,
   `subscription`, `type`, `messageId`, `correlationId`, `deliveryAttempt`, `producer`.
3. Acknowledge (return normally). Never re-publish to the original topic automatically.

A **log-based metric + alert policy** in Terraform (`infra/`) fires when `event=dead_letter`
count > 0 over a 60 s window (E-05 measure: DLQ alert ≤ 5 min).

Timing budget (ADR-0005): consumers answer `400` to an invalid envelope; the subscription
retries 5 times with backoff 10 s → 60 s (≈ 2–3 min to the DLQ); this function logs within
seconds; the alert evaluates over 60 s. Total ≈ 3–4 min.

## Demo

`make poison TOPIC=aforo.catalog.event-published` (TODO) publishes an invalid message; after 5
delivery attempts it reaches the DLQ, this function logs it with its `correlationId`, and the
alert fires. While Memorystore is off, the `queue-*` subscriptions don't exist, so the poison
message dead-letters only through `inventory-event-published`; that is enough for the demo.

## FaaS constraints

| Constraint | How it is handled |
| ---------- | ----------------- |
| Cold start | Tiny handler, only the logger; irrelevant for an async alert path, still measured |
| Execution time | Timeout 10 s; work is a single log write |
| Idempotency | Logging twice is acceptable; the alert counts occurrences, not unique ids |

## Configuration

See [.env.example](.env.example).
