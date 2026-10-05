# Runbook · Acceptance demo

> Owner: Platform (Julián). Status: **draft** — the Platform steps work; the purchase path
> depends on each unit being deployed. Script: [../plan/acceptance.md](../plan/acceptance.md).

## The day before

1. `make up`, then `make redis-up` (≥ 15 min, Memorystore takes up to ~10).
2. Deploy every unit from `main`: `make deploy SERVICE=<unit>` for the five services, `web`,
   `dlq-monitor`, `prewarmer` and `mock-payment-gateway` (or set `DEPLOY_ON_MERGE=true` once
   the team is ready).
3. Run the full acceptance script, record the video, then `make down`.

## Demo day

1. `make redis-up` at least 15 minutes before. Check the three seeded events are listed and the
   queue answers.
2. `make status` shows `mock_fault_mode=none`.
3. Open three Cloud Logging queries (project `aforo-dev-teamf`):
   - one purchase: `jsonPayload.correlationId="<id>"` (E-05 traceability)
   - circuit breaker: `jsonPayload.event="circuit_state"` (E-06)
   - pre-warming: `jsonPayload.event="prewarm_applied"` (E-01)

## E-06 · Payment gateway resilience (circuit breaker)

1. `make fault MODE=timeout` — about a minute to apply; explain the breaker parameters meanwhile
   (2 s response timeout, opens after 5 failures, 30 s reset).
2. Buy: Orders answers `503 PAYMENT_UNAVAILABLE`; after 5 failures the `circuit_state` log shows
   the breaker open and later calls fail fast.
3. `make fault MODE=none`; after the reset timeout the breaker half-opens and closes.

## E-05 · Dead letters raise an alert

1. `make poison TOPIC=aforo.catalog.event-published` — prints the `correlationId` it used.
2. The consumer answers `400`; after 5 attempts (≈ 2–3 min, backoff 10 s → 60 s) the message
   lands in `<subscription>-dlq`.
3. `dlq-monitor` logs `event=dead_letter` with that `correlationId` within seconds:
   `jsonPayload.event="dead_letter"`.
4. The alert policy **aforo: message dead-lettered** opens an incident and emails the Platform
   owner (≤ 5 min end to end). Show it in Monitoring → Alerting.

Requires the consumer's real code: a placeholder image answers `200` to anything, so nothing
dead-letters. While Memorystore is off only `inventory-event-published` and
`prewarmer-event-published` receive the poison message — enough for the demo.

## E-01 · Pre-warming per sales window

1. Through the Gateway with a session token, create an event with
   `salesOpensAt = now + 3 min` and `salesClosesAt = now + 8 min` (`POST /api/v1/events`), set
   its rules (`PUT …/sales-rules`) and publish it (`POST …/publish`).
2. Catalog's outbox publishes `EventPublished`; `prewarmer` schedules
   `warm-<eventId>-<epoch>` (now, since the lead time is already past) and
   `cool-<eventId>-<epoch>` (at the close) on `prewarm-windows`.
3. Show `aforo-gateway` and `aforo-queue` minimum instances go to 1 within seconds:
   ```bash
   gcloud run services describe aforo-gateway --region southamerica-east1 --format='value(scaling.minInstanceCount)'
   gcloud tasks list --queue prewarm-windows --location southamerica-east1
   ```
4. At the close they go back to 0; the `prewarm_applied` logs show `from`/`to` for each step.

TODO: script it (`make prewarm-demo`) once catalog's organizer endpoints are deployed.

## Deployment (D-19 evidence)

- `gcloud run revisions list --service aforo-gateway --region southamerica-east1` shows one
  revision per git SHA, each tagged `sha-<short>`.
- Rollback: `gcloud run services update-traffic aforo-<svc> --region southamerica-east1
  --to-revisions <previous>=100`; time it from command to 100 %.

## After the presentation

`make down`. The environment is not left on for later review.
