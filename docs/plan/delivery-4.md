# Delivery 4 compliance map

Source: *[CBSE_2026ii] Project Delivery #4* (deadline **Monday, October 12, 2026, 23:59**,
PDF `delivery4-team-F`). The written artifact is produced outside this repo; this file maps each
requirement of the guide to **where the evidence lives in the running system and the repo**, so
nothing is left to "we documented it".

Status legend: ✅ covered by the plan · ⚠️ covered with a known deviation · 🆕 added for Delivery 4

## 2.1 Functional

| Requirement | How we meet it | Evidence | Status |
| ----------- | -------------- | -------- | :----: |
| Implement the end-to-end scenario(s) as designed, no new functional scope | Purchase happy path (RF-01–05, RF-08–12, orders half of RF-14) | [acceptance.md](acceptance.md), `e2e/` | ✅ |
| Demonstrate one complete scenario end-to-end on the deployed system | Acceptance script run live on `dev` + recorded video | `e2e/happy-path.spec.ts`, [../runbooks/demo.md](../runbooks/demo.md) | ✅ |

## 2.2 Non-functional

| Requirement | How we meet it | Where it lives | Status |
| ----------- | -------------- | -------------- | :----: |
| Architectural styles from Delivery 2, visible in code and deployment | Microservices (one deployable per bounded context), event-driven (Pub/Sub topics + push subscriptions) | `services/*`, `infra/`, [../../contracts/events/](../../contracts/events/README.md) | ✅ |
| Patterns from Delivery 2 | API Gateway · Database per Service · Saga (orchestrated) · Transactional Outbox / Inbox · Idempotent consumer · Anti-Corruption Layer · Circuit Breaker | See [pattern map](#pattern-map) | 🆕 Circuit breaker + real ACL (D-16, D-18) |
| At least one resilience / elasticity / reliability tactic **demonstrable** live | (1) Timeouts + circuit breaker + retry against the mock with fault injection (E-06). (2) 200 concurrent reservations → exactly 10 (E-02). (3) Reservation expiry via Cloud Tasks restores seats (reliability). (4) Scale to zero / autoscaling on Cloud Run (E-07/E-01) | `services/orders` payment adapter, `functions/mock-payment-gateway` (`FAULT_MODE`), `services/inventory/test/concurrency/` | 🆕 |
| Detailed design honored: contracts = actual API | OpenAPI + JSON Schema in `contracts/`; request validation mirrors them; contract tests in CI against deployed revisions | `contracts/`, DoD | ✅ |
| Schemas match what is deployed | SQL migrations per service are the schema source; they run as a Cloud Run job in the pipeline | `services/*/migrations/`, [build-and-deploy](../architecture/build-and-deploy.md) | 🆕 |
| Lifecycle entities follow their state machines | Reservation, Order, Payment, Queue entry — transitions implemented as conditional updates and tested | [../architecture/state-machines.md](../architecture/state-machines.md) | 🆕 |
| Infrastructure as Code, no manual resources | Terraform for everything (Cloud Run, functions, Cloud SQL, Pub/Sub, Cloud Tasks, secrets, IAM, alerts) | `infra/` | ✅ |
| Immutable artifact + deliberate deployment strategy | Image per git SHA, deploy by digest, blue/green with Cloud Run revision tags; function source archives versioned by SHA | [build-and-deploy](../architecture/build-and-deploy.md), `.github/workflows/` | 🆕 (D-19) |
| At least two FaaS components | `functions/mock-payment-gateway` (HTTP) and `functions/dlq-monitor` (Pub/Sub-triggered) | `functions/` | 🆕 (D-16, D-17) |

## 3.3 "Prototype" evaluation items

| Item | Evidence | Status |
| ---- | -------- | :----: |
| End-to-end scenario | Acceptance script | ✅ |
| Architectural style and patterns | Pattern map below | ✅ |
| Quality attribute tactics | Tactic map below | 🆕 |
| **Multiple persistence paradigms** | Relational (Cloud SQL PostgreSQL: catalog, orders, inventory) + in-memory key-value with sorted sets (Memorystore for Redis: queue, created per window, ADR-0001) | ✅ |
| FaaS component | Two functions | 🆕 |
| Containers + IaC | Cloud Run containers from Artifact Registry, Terraform | ✅ |

## Construction section of the artifact — where to get the material

| Artifact item | Source in the repo |
| ------------- | ------------------ |
| Statelessness, health checks, graceful shutdown, structured logging | [`.claude/rules/services.md`](../../.claude/rules/services.md), `packages/common` (`health`, `logging`, `shutdown`), [ADR-0002](../adr/0002-work-happens-inside-a-request.md) (no work outside a request) |
| FaaS component, cold start and execution-time constraints | `functions/*/README.md` |
| IaC tool, what it provisions, organization | [`infra/README.md`](../../infra/README.md), [ADR-0004](../adr/0004-terraform-owns-config-ci-owns-code.md) (runtime switches, Terraform vs CI) |
| Build artifact, deployment strategy, schema/contract change sequencing | [build-and-deploy.md](../architecture/build-and-deploy.md) |
| Component interfaces and contracts | `contracts/` |
| Data schema and model | `services/*/migrations/` + each service README "Data" section, [ADR-0006](../adr/0006-inventory-partition-key.md) (partition key) |
| Behavioral design | [state-machines.md](../architecture/state-machines.md), [overview.md](../architecture/overview.md) (saga) |

## Pattern map

| Pattern (Delivery 2/3) | Where it lives |
| ---------------------- | -------------- |
| API Gateway | `services/gateway` |
| Database per Service | three databases + three users in `infra/`; no cross-DB access |
| Saga (orchestration) | `services/orders` (`orders/` module) |
| Transactional Outbox | `packages/common/outbox`, `outbox` tables in catalog, inventory, orders |
| Inbox / Idempotent consumer | `packages/common/inbox`, `inbox` tables / Redis keys |
| Idempotency key (RD-02) | `packages/common/idempotency` |
| Anti-Corruption Layer | `services/orders` `payments/` adapter ↔ `functions/mock-payment-gateway` |
| Circuit Breaker | `services/orders` payment adapter |
| Delayed delivery / competing expiry | Cloud Tasks `reservation-expiry` → `inventory /expire`, plus the one-minute sweep (ADR-0003) |
| Health checks | `/health/live`, `/health/ready` in every service |

## Tactic map (Delivery 3 scenarios)

| Scenario | Tactic in the prototype | Demonstrable? | Dropped (justify in the artifact) |
| -------- | ----------------------- | :-----------: | --------------------------------- |
| E-01 Elasticity | Autoscaling, scale to zero, throttling by the waiting room, per-IP quota in the Gateway | Partially (admission pacing, scaling in Cloud Run metrics) | Pre-warming per window, load test |
| E-02 Zero overselling | Serialized conditional write in the data owner; admission control upstream; aggregate concurrency limit = instance caps × DB pools (ADR-0005) | **Yes** (concurrency test + Terraform config) | Window-sized DB profile (100 connections) |
| E-03 Availability | Health checks; Cloud Run spreads instances across zones | Health checks only | DB replica / failover |
| E-05 Observability | Structured logs + correlation ID across HTTP and bus; DLQ alert via `dlq-monitor` | **Yes** (follow a purchase in Cloud Logging; push a poison message) | Distributed tracing, error-rate alert |
| E-06 Payment gateway resilience | Timeouts, circuit breaker, retry with backoff + jitter, no expiry extension (ADR-03) | **Yes** (`FAULT_MODE=timeout`) | — |
| E-07 Cost | Scale to zero, `make down`, in-memory store created per window by IaC (Memorystore, `make redis-up`, ADR-0001) | Yes (billing dashboard, `terraform plan`) | Per-window Edge creation |
| E-08 Security | Private Cloud Run + IAM invoker, Gateway token check, HMAC webhook, input validation | Partially | WAF, Identity Platform, VPC |

## Compute model per unit (Lab 5 §2.1 and §4.1)

Why each unit is a container or a function. Use it in the artifact's FaaS section; it also
reconciles the functions with Entrega 3 §5.2, which rejected FaaS for the services.

| Unit | Traffic | Duration | State and connections | Choice |
| ---- | ------- | -------- | --------------------- | ------ |
| gateway, web | Continuous during a sale | Short, but proxies long SSE streams | Stateless; keep-alive connections | Container |
| queue | Bursty at opening, continuous while a sale lasts | SSE streams up to 15 min | Redis connection, in-process admission timer | Container, CPU always allocated |
| catalog, orders, inventory | Continuous during a sale | Short | DB connection pool (E-02), outbox flush | Container |
| mock-payment-gateway | Sporadic: one call per payment | Sub-second | Stateless; delayed work delegated to Cloud Tasks | **FaaS** (HTTP) |
| dlq-monitor | Rare: only when a message dead-letters | Milliseconds | Stateless, one log write | **FaaS** (Pub/Sub event) |

The two functions follow Lab 5's five phases: one responsibility each (granularity), an OpenAPI
contract or an event schema (trigger and contract), no state kept between invocations
(externalization), idempotent under redelivery, and explicit timeouts (resilience).

## Evidence to capture (Quality Attribute Verification)

Each row needs the observed value, how it was measured, and a screenshot or log query, stored
with the artifact.

| Scenario | Measure (Entrega 3) | How to measure in dev |
| -------- | ------------------- | --------------------- |
| E-02 | Overselling = 0; p95 reservation ≤ 300 ms | Concurrency test output: counts + latency percentiles |
| E-06 | Fail fast ≤ 50 ms with the circuit open; 0 double charges | `latencyMs` of `PAYMENT_UNAVAILABLE` responses while open; `circuit_state` logs |
| E-05 | DLQ alert ≤ 5 min; purchase traceable by `correlationId` | Timestamp of `make poison` vs alert incident; Logging query for one purchase |
| E-07 | Cost follows use | Billing report for an off day vs a demo day; `terraform plan` of `make redis-up` |
| FaaS | Cold start, execution time | First-invocation latency after idle, per function |
| Deployment | Blue/green and rollback | Revision list with tags; time from `update-traffic` rollback to 100 % |

## Deviations to justify ("exactly as designed")

The guide asks to build the system *exactly as designed*. The slice deviates on purpose; the
artifact must say so with its rationale ([target-vs-slice.md](../architecture/target-vs-slice.md)).

**Recommendation:** the deadline moved from Oct 2 to Oct 12. The plan estimates pass verification
(D-07, RD-04) at "two endpoints and half a day". It is the largest deviation and the cheapest to
close — reconsider bringing it back into scope if Milestone 2 lands on time.
