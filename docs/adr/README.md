# Architecture Decision Records

Record here any decision taken during implementation that affects more than one unit or that
someone will ask "why?" about later. Plan-level decisions are in
[../plan/decisions.md](../plan/decisions.md); do not duplicate them.

- File name: `NNNN-short-title.md` (e.g. `0001-login-subject-uuid-v5.md`). Cite them as
  `ADR-NNNN` (four digits) so they are not confused with the design-phase ADR-03 / ADR-04.
- Copy [template.md](template.md). Keep it under one page.
- Statuses: `Proposed`, `Accepted`, `Superseded by NNNN`.
- If a record changes a rule, update the rule file (`.claude/rules/`, `contracts/`, unit README)
  in the same PR. The rule is what people read; the ADR is why.

Design-phase ADRs (ADR-03, ADR-04) are in the Entrega 3 document; ADR-04 (signed pass) is not
implemented in this slice because of D-07.

## Index

| ADR | Decision | Where it is applied |
| --- | -------- | ------------------- |
| [0001](0001-memorystore-on-demand.md) | Queue store is Memorystore, created only for live tests and demos (supersedes D-15) | `infra/`, `services/queue`, runbooks |
| [0002](0002-work-happens-inside-a-request.md) | No work outside a request: outbox flushed after commit + housekeeping every minute; webhook processed synchronously; queue admission with a Redis lock | `.claude/rules/services.md`, `packages/common`, `contracts/events` |
| [0003](0003-reservation-expiry-safety-net.md) | Cloud Tasks expiry + a one-minute sweep; expire only when `expires_at <= now()` | `services/inventory` |
| [0004](0004-terraform-owns-config-ci-owns-code.md) | Terraform owns config, CI owns code and traffic; runtime switches only via `make`; probes on `/health/live` | `.claude/rules/infra.md`, `Makefile`, build-and-deploy |
| [0005](0005-dev-sizing-and-demo-determinism.md) | Connection budget and instance caps; one Orders instance; DLQ timing | `infra/README.md`, `.env.example` files |
| [0006](0006-inventory-partition-key.md) | No sharding in the slice; `event_id` is the partition key when needed | `services/inventory` schema |
