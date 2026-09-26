# Team, ownership and schedule

## Fronts

Six fronts, one per person, each with its folder, its deployment and its contract. After the
contract freeze nobody needs anyone else's code to move forward: work against the Prism mocks
generated from `contracts/`. Reviewers are assigned automatically by
[`.github/CODEOWNERS`](../../.github/CODEOWNERS) (owner + backup).

| Front | Owner (GitHub) | Folder(s) | Deliverables | Load |
| ----- | -------------- | --------- | ------------ | :--: |
| Platform, deployment and operations | Julián (`@djguzmanc`) | `infra/`, `.github/`, `Makefile`, `e2e/`, `docs/runbooks/`, `functions/dlq-monitor` | Terraform for everything, Memorystore on demand + VPC (ADR-0001), Cloud Scheduler housekeeping jobs, runtime switches (ADR-0004), Artifact Registry, CI/CD with blue/green (D-19), secrets, `make up/down/redis-up/redis-down/fault` + runbook, logs with correlation ID, DLQ monitor function + alert (D-17), e2e of the happy path. Owns the GCP account and operates the environment | 14 |
| Gateway, contracts and common library | Juan José (`@JuanjMedina`) | `services/gateway/`, `contracts/`, `packages/common/`, `services/catalog/` | API Gateway, simulated login, `@aforo/common`, all OpenAPI files, event schemas, Prism mocks, Catalog with its idempotent seed | 13 |
| Purchase frontend | Sergio (`@SergioR-02`) | `apps/web/` (all screens except the queue) | Login, catalog, detail, selection, payment, my orders, error handling by `code`, SSR deployment | 12 |
| Waiting room, end to end | Cristian (`@CristianMontane`) | `services/queue/`, `apps/web` queue screen | Redis queue (local Redis in development, Memorystore in dev), admission lock, RF-05 ordering, admission job, pass with TTL, SSE, catalog projection, and the queue screen that consumes the SSE | 12 |
| Orders & checkout | Daniel Felipe (*not yet in the GitHub org*) | `services/orders/`, `functions/mock-payment-gateway` | Saga, states, idempotency, payment adapter with circuit breaker (D-18), mock payment function with page, signed webhook and fault injection (D-16), outbox, `ReservationExpired` consumer | 14 |
| Inventory & reservations | Luis Esteban (`@luleonr`) | `services/inventory/` | Reservation transaction, confirm, release, expire, Cloud Tasks queue, outbox, concurrency test | 10 |

Platform and contracts serve everyone and start first: if either slips, the whole team slips.

The contracts owner is also the **arbiter**: any contract change after the freeze goes through
them, is reflected in `contracts/` and announced in the team channel the same day.

If the team runs short, cut in this order: (1) "my orders" list screen (keep order detail — the
demo needs it), (2) the organizer endpoints beyond what the seed uses. The Inventory concurrency
test and the circuit-breaker demo are **not** cuttable anymore (D-20): they are the Delivery 4
evidence of the tactics.

## Schedule (rebased to the Delivery 4 deadline)

**Deadline: Monday, October 12, 2026, 23:59** — PDF `delivery4-team-F` on Google Classroom.
Presentation date: to be defined by the course. Weekends are buffer. Every day ends with something
verifiable, not a percentage. *Proposed; adjust if a front already progressed.*

| Day | What must exist at end of day |
| --- | ----------------------------- |
| Sat–Sun 26–27 | GCP project with billing, access, APIs, state bucket, Workload Identity Federation (Julián). Contracts reviewed against this repo (Juan José). Daniel Felipe invited to the GitHub org |
| Mon 28 | Monorepo skeletons answering `/health/live` (5 services, 2 functions, web). Open contract points resolved |
| Tue 29 | **Contracts frozen.** `@aforo/common` published, Prism mocks running, CI green, `make up`/`make down` working, one service deployed to Cloud Run **with the blue/green pipeline** |
| Wed 30 | Simulated login issuing tokens. Catalog with its endpoints and seed. Frontend with login and list. Inventory reserving against Cloud SQL. Queue returning position from a local Redis. Orders creating orders against the Inventory mock. Mock payment function deployed. **Integration point 1** |
| Thu Oct 1 | Terraform with Cloud SQL, Pub/Sub, Cloud Tasks, Cloud Scheduler, functions applied and reversible; first `make redis-up` / `make redis-down` cycle timed. Pass with TTL. `confirm`, `release`, `expire` with the real queue. Mock payment page + delayed signed webhook |
| Fri Oct 2 | **Milestone 1.** In `dev`: login, catalog and detail end to end; everything deployed and healthy behind the Gateway. 15-minute internal demo |
| Mon Oct 5 | Outbox and real Pub/Sub publishing. Queue and Inventory building their projections. Queue with SSE in `dev`. DLQ monitor + alert. **Integration point 2** |
| Tue Oct 6 | Full purchase between real services: reservation, mock payment, webhook, confirmation, paid order |
| Wed Oct 7 | **Milestone 2.** Full happy path in `dev`, login to paid order, traceable `correlationId` in the logs |
| Thu Oct 8 | Alternate paths: reservation expiry, sold out, per-person limit, expired pass in the UI, duplicate webhook. Inventory concurrency test. Circuit breaker demo with fault injection. One schema change shipped with expand/contract (evidence for the artifact) |
| Fri Oct 9 | **Milestone 3.** Code freeze, e2e green, README per unit, tag `v0.1.0`. Demo video recorded |
| Sat–Sun 10–11 | Buffer. Assemble the Delivery 4 PDF (outside this repo) using [delivery-4.md](delivery-4.md) |
| Mon Oct 12 | Cold `make up`, full acceptance script once more, submit before 23:59, `make down` |

**Rituals.** Async note from each person before 10 pm: what I did, what's next, what blocks me.
Two fixed one-hour integration points (Wed Sept 30 and Mon Oct 5) with everyone connected and
deploying.

**Schedule risk is the freeze (Tue 29).** If contracts are not frozen that day, the fronts
implement against different assumptions and integration becomes days of fixes.

## Critical dependency

Orders cannot close its saga until Inventory has `confirm` and `expire` (Thu Oct 1). Until then
Orders works against the Prism mock of that same contract.
