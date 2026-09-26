# 0005 · Dev environment sizing and demo determinism

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** Julián (Platform)
- **Affects:** `infra/`, `services/catalog`, `services/orders`, `services/inventory`, `functions/dlq-monitor`, `contracts/events`

## Context

- The dev Cloud SQL instance (`db-f1-micro`) allows 25 connections, 3 reserved for the
  superuser. Autoscaling instances × pool size can exhaust it before the CPU is busy
  (Entrega 3 weakness D-03, tactic "aggregate concurrency limit" of E-02).
- The circuit breaker lives in each Orders instance's memory. With several instances, the
  E-06 demo becomes non-deterministic (some requests hit a closed breaker).
- The E-05 demo needs a poison message to reach the DLQ and raise the alert within 5 minutes.
  Default Pub/Sub backoff can take longer, and a consumer that acks a malformed message never
  dead-letters it.

## Decision

**Connection budget and instance caps** (Terraform + each service's `DB_POOL_MAX`):

| Unit | Max instances | Concurrency | DB pool per instance | DB connections |
| ---- | :-----------: | :---------: | :------------------: | :------------: |
| inventory | 3 | 80 | 2 | 6 |
| orders | **1** | 80 | 3 | 3 |
| catalog | 2 | 80 | 2 | 4 |
| migration job (one at a time) | 1 | — | 1 | 1 |
| developers running a unit locally against dev | ~5 people | — | 1 | 5 |
| **Total** | | | | **19 of 22** |

Services without a database: gateway max 3, web max 2, queue max 2 (CPU always allocated),
functions max 5. All `min_instance_count = 0`.
The pool waits (acquire timeout 5 s) instead of opening more connections. The concurrency
test (200 concurrent reservations) fits in 3 × 80 request slots and queues on 6 connections.

**Orders runs one instance** in dev, so its circuit breaker is a single, observable state. The
breaker state is in-memory soft state that is rebuilt on restart; it does not break the
statelessness rule (no business state is lost).

**Pub/Sub push subscriptions:** `retry_policy` 10 s → 60 s, `max_delivery_attempts = 5`, DLQ
per subscription. A consumer answers **`400`** for a body that is not a valid envelope (never
`2xx`), so poison messages dead-letter in about 2–3 minutes. The DLQ alert policy evaluates
over 60 s, which keeps the E-05 measure (alert ≤ 5 min).

## Consequences

- E-02's aggregate concurrency limit becomes a visible configuration (instance caps × pools
  in Terraform) instead of a dropped tactic.
- Scaling limits are demo-sized, not load-test-sized; Entrega 3 §6.4 values stay the target.
- Local runs against dev must set `DB_POOL_MAX=1`.
- Orders cannot scale out in dev; irrelevant at demo traffic.
