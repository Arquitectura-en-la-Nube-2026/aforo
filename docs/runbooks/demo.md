# Runbook · Acceptance demo

> Owner: Platform (Julián). Status: **TODO**.

1. The day before: cold `make up` and `make redis-up`, run the full acceptance script
   ([../plan/acceptance.md](../plan/acceptance.md)), record the video, then `make down`.
2. Demo day: `make redis-up` at least 15 minutes before (Memorystore takes up to ~10 minutes to
   be created, ADR-0001); check the three seeded events are listed and the queue answers.
3. Check `make status` shows `mock_fault_mode=none`.
4. Keep a Cloud Logging query ready, filtered by `jsonPayload.correlationId="<id>"`, and another
   one for `jsonPayload.event="circuit_state"` (E-06 demo).
5. E-06 demo: `make fault MODE=timeout` takes about a minute to apply — explain the circuit
   breaker parameters meanwhile. Revert with `make fault MODE=none`.
6. After the presentation: `make down`. The environment is not left on for later review.
