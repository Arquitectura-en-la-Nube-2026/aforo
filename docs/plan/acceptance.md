# Definition of Done and acceptance

## Definition of Done (per service)

A unit is done when all of these hold — not when its endpoint answers locally.
The PR template repeats this checklist.

- [ ] Its OpenAPI in `contracts/` matches what it implements
- [ ] `/health/live` and `/health/ready` respond
- [ ] Dockerfile and deployment to Cloud Run from CI
- [ ] Its resources declared in Terraform
- [ ] Structured logs with `correlationId` on every request
- [ ] Errors in `problem+json` with the agreed `code`s
- [ ] Tests of its own rules, including a repeat with the same `Idempotency-Key`
- [ ] README with how to run it locally and which variables it needs
- [ ] Graceful shutdown on `SIGTERM` (services) / cold start and timeout documented (functions)
- [ ] Boots with its DB/Redis off (`/health/live` 200); no timers or post-response work (ADR-0002)
- [ ] Replays carry `Idempotent-Replayed: true`; invalid Pub/Sub envelopes answer `400`
- [ ] State-machine transitions it owns are tested ([state-machines.md](../architecture/state-machines.md))

## Acceptance script

Run end to end on `dev` and recorded:

1. A user enters their email on the login screen and gets a session.
2. They see three published events and open the one whose sale is open.
3. They join the queue and see their position.
4. They are admitted; the buy screen is enabled and the pass countdown runs.
5. They pick a sector and two tickets and confirm.
6. The order is `PENDING_PAYMENT` and the sector availability dropped by two.
7. They pay in the mock and return to the order.
8. The order is `PAID` in under five seconds.
9. It appears with its status in `GET /orders`.
10. A `correlationId` from the purchase lets you follow it in the logs, including the hop through
    the queue/bus.

### Checks that must fail well

- Asking for more tickets than remain returns `409 SOLD_OUT` and decrements nothing.
- Asking for more than the per-person max returns `409 LIMIT_EXCEEDED`.
- Letting a reservation expire releases it, restores availability and leaves the order `EXPIRED`.
- Repeating `POST /orders` with the same `Idempotency-Key` returns the same order, not a new one.
- Repeating the webhook with the same notification id changes nothing and emits no second `OrderPaid`.

### Tactic and construction demonstrations (Delivery 4)

- **Resilience (E-06):** with `make fault MODE=timeout` (about a minute to apply), starting a payment fails fast with
  `503 PAYMENT_UNAVAILABLE`; after 5 failures the circuit opens (visible in the logs) and calls
  fail in ≤ 50 ms; with `MODE=none` it closes again and the payment completes.
- **Integrity (E-02):** the Inventory concurrency test (200 concurrent reservations, 10 seats →
  exactly 10 reservations, 190 `SOLD_OUT`) runs against `dev`.
- **Observability (E-05):** `make poison` sends a malformed message; it lands in the DLQ and
  `dlq-monitor` logs it and raises the alert within 5 minutes.
- **Elasticity (E-01) / FaaS:** publish an event that opens in 3 minutes and closes in 8; the
  `prewarmer` raises `gateway` and `queue` to 1 minimum instance right away and returns them to 0
  at the close (visible in Cloud Run and in `event=prewarm_applied` logs).
- **FaaS:** `prewarmer` and `dlq-monitor` deployed and exercised by the steps above (D-21).
- **Deployment strategy:** a new revision is deployed with no traffic, smoke-tested on its tag URL
  and then promoted; a rollback is shown.

Reserving without going through the queue does **not** fail, and that is why it is not in the
script: direct consequence of D-07.

The full script is run once the day before the presentation, after a cold `make up` and
`make redis-up` (≥ 15 min before), so we don't discover live that the seed didn't run, the
database stayed off or Memorystore was not created.

These scenarios are automated in [`e2e/`](../../e2e/README.md).
