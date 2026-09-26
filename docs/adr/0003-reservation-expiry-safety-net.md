# 0003 · Reservation expiry has a safety net

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** Julián (Platform)
- **Affects:** `services/inventory`, `infra/` (Cloud Scheduler job of ADR-0002)

## Context

Inventory commits the reservation and **then** enqueues the Cloud Tasks expiry task. If the
enqueue fails after the commit (network error, instance killed), the reservation never expires
and its seats stay blocked forever. This is the dual-write problem (Lab 4 §3.5).

Entrega 2 §5.4 also says the expiry transition applies only "if the expected version matches and
the expiry instant has been reached"; the drafted `UPDATE` only checked `status = 'ACTIVE'`.

## Decision

- Keep the Cloud Tasks task: it gives expiry at the exact second (named by `reservationId`, so
  it is deduplicated).
- Add a **sweep** in Inventory's housekeeping ([ADR-0002](0002-work-happens-inside-a-request.md)):
  every minute, expire every reservation with `status = 'ACTIVE' AND expires_at <= now()`,
  through the same code path as `/expire`.
- The expire transition is
  `UPDATE reservation SET status = 'EXPIRED' WHERE id = :id AND status = 'ACTIVE' AND expires_at <= now()`.
  If it affects no row, `/expire` returns the current state with `200` (a task that arrives a
  little early is harmless: the sweep catches it).
- `expires_at` is written in the reservation transaction (it already is: it is the source of
  truth; the task is only the trigger).

## Consequences

- A lost task delays expiry by at most one minute instead of blocking seats forever.
- No outbox for tasks, no extra table: one query in housekeeping.
- Confirm and expire still race on the same conditional update; the extra time condition can
  only make expire lose more often, never win wrongly.
