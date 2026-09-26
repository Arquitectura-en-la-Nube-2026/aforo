# 0001 · Queue store: Memorystore, created only for live tests and demos

- **Status:** Accepted · supersedes D-15
- **Date:** 2026-09-26
- **Deciders:** Julián (Platform)
- **Affects:** `infra/`, `services/queue`, `services/catalog` (seed), `Makefile`, runbooks

## Context

D-15 ran Redis as a container on Cloud Run. That cannot work: Cloud Run only accepts HTTP,
HTTP/2, gRPC and WebSocket ingress, and Redis speaks raw TCP, so `queue` could never reach it.
A Redis sidecar inside `queue` would work only with one instance and would put durable-ish state
inside a service instance, which weakens the statelessness claim.

The design already says what to do: Entrega 3 (E-07, TO-02) selects a managed in-memory store
that is **created only for sales windows and tests, from Infrastructure as Code**, because it
bills by provisioned capacity.

## Decision

- The queue store is **Memorystore for Redis, Basic tier, 1 GB**, in `southamerica-east1`,
  declared in Terraform behind the runtime switch `redis_enabled` (default `false`,
  see [ADR-0004](0004-terraform-owns-config-ci-owns-code.md)).
- It exists only while someone needs the queue live: integration sessions, e2e runs, the
  recorded demo and the presentation. `make redis-up` creates it, `make redis-down` or
  `make down` destroys it.
- Networking: one VPC `aforo-vpc` with one subnet in the region (permanent, free). Memorystore
  uses `DIRECT_PEERING` on that VPC (private IP only). Only `queue` gets Direct VPC egress
  (`egress = PRIVATE_RANGES_ONLY`). No AUTH, no TLS: the instance is reachable only from the VPC.
- Terraform passes the instance address to `queue` as `REDIS_URL`
  (`redis://<host>:<port>`, empty when the switch is off).
- The queue's two push subscriptions (`queue-event-published`, `queue-sales-rules`) and their
  DLQs exist only while `redis_enabled = true`, so messages published while Redis is absent are
  neither retried against a broken consumer nor sent to the DLQ.
- `make redis-up` ends by running the catalog seed, which re-emits `EventPublished` and
  `SalesRulesConfigured`, so the queue projection is rebuilt in the new, empty instance.
- Local development of `queue` uses a local Redis: `docker run --rm -p 6379:6379 redis:7`.
  This is a dependency of one unit, not the full stack, so D-10 still holds.

## Consequences

- Faithful to the design: E-07's "in-memory store created per window by IaC" becomes real and
  demonstrable (`terraform plan` shows it appear and disappear).
- Cost while on is roughly US$1–2 per day (check the pricing page for `southamerica-east1`);
  zero when off.
- **Creating the instance takes several minutes (up to ~10).** Run `make redis-up` at least
  15 minutes before a live test or demo.
- Every creation starts empty and may get a new IP. That is acceptable: queue positions are
  transient (the buyer re-joins) and the projection is rebuilt by the seed.
- While Redis is off, `queue` still boots (`/health/live` = 200, `/health/ready` = 503) and
  answers queue endpoints with `500 INTERNAL` ("queue store not available"). Nobody else is
  affected: no other unit depends on `queue` except the UI flow.
- Risk to check on day one: Direct VPC egress availability in `southamerica-east1`. Fallback:
  a Serverless VPC Access connector created under the same switch.
