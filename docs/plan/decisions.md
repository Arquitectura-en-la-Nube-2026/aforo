# Decisions

The rest of the repo is written on top of these decisions. To change one, open a PR against this
file and announce it in the team channel.

## Plan decisions (closed)

| ID   | Decision | Consequence |
| ---- | -------- | ----------- |
| D-01 | TypeScript with NestJS on **Node 24 (LTS)** in all five services | `packages/common` serves everyone without duplication. Node 24 required by current Prism; supported by Angular 20 and NestJS 11 |
| D-02 | ~~Angular 20 with SSR on public routes~~ — **superseded by [ADR-0007](../adr/0007-web-framework-next.md)**: Next.js with SSR on public routes | The frontend deploys as its own container |
| D-03 | Single monorepo with CI per affected folder | One branch per person, `main` always deployable |
| D-04 | One GCP project, `aforo-dev`, in `southamerica-east1`, on Julián's student account | Julián creates the project and grants access; nobody else can unblock it |
| D-05 | One Cloud SQL instance with one database and one user per service | Turned off when nobody is working |
| D-06 | Simulated login issued by the Gateway; Identity Platform only if there is slack | The token keeps the shape of an OIDC JWT so switching is configuration |
| D-07 | Orders and Inventory do **not** verify the queue pass | No JWKS, no ES256 signature, no key in Secret Manager. Re-evaluate: see [delivery-4.md](delivery-4.md) |
| D-08 | No organizer UI | Events are created by the seed and with Postman |
| D-09 | ~~Payment-gateway mock inside Orders~~ — **superseded by D-16** | |
| D-10 | Everything lives in the cloud: the full stack is never run locally | Each person runs only their unit against cloud dependencies |
| D-11 | The environment stays off except when working or presenting | Needs an up/down procedure and someone who operates it |
| D-12 | Admission releases N buyers every T seconds, configurable | For the demo: large batch, 5 s interval |
| D-13 | Position travels over SSE, with 3 s polling as plan B | One hour of work if Cloud Run cuts the stream |
| D-14 | ~~Sept 21 – Oct 2~~ → **Sept 28 – Oct 12** (Delivery 4 deadline), ~10 h per person per week | No load test in this slice |
| D-15 | ~~Redis runs as a container on Cloud Run~~ — **superseded by [ADR-0001](../adr/0001-memorystore-on-demand.md)**: Cloud Run has no TCP ingress. Memorystore, created only for live tests and demos | |

## Decisions forced by the Delivery 4 guide — **Proposed, confirm as a team**

Full context, options and consequences: [delivery-4-decisions.md](delivery-4-decisions.md).

The official guide ([delivery-4.md](delivery-4.md)) arrived after the plan. It requires two FaaS
components, a demonstrable resilience/elasticity/reliability tactic, immutable artifacts with a
deliberate deployment strategy, and state machines honored in code.

| ID   | Decision | Why |
| ---- | -------- | --- |
| D-16 | *(amended by D-21: still a function, not counted as a FaaS component)* The **mock payment gateway is a FaaS component** (`functions/mock-payment-gateway`, Cloud Run functions), outside Orders. Orders reaches it through its payment adapter (Anti-Corruption Layer). The 2 s delayed webhook goes through a Cloud Tasks queue `payment-webhooks` | FaaS #1. It stands in for an external system, so moving it out of Orders makes the ACL and the circuit breaker real |
| D-17 | A **DLQ monitor is a FaaS component** (`functions/dlq-monitor`), triggered by the DLQ topics (six with D-21); it emits a structured ERROR log that feeds a log-based alert | FaaS #2 with no new functional scope. Realizes the E-05 "DLQ with messages → alert" tactic |
| D-21 | **The FaaS components are the pre-warmer and the DLQ monitor.** `functions/prewarmer` sets minimum instances on `gateway` and `queue` before each sales window and reverts them after (E-01). The payment mock stays a function but is not counted (amends D-16) | Professor: FaaS required, but not added only to comply. Both functions realize designed tactics (E-01, E-05); no microservice is converted |
| D-18 | Orders' payment adapter implements **timeouts + circuit breaker + retry with backoff and jitter**; the mock supports **fault injection** (`FAULT_MODE`) | Gives the live, demonstrable resilience tactic (E-06). Circuit breaker is a Delivery 2 pattern and must be visible in code |
| D-19 | **Immutable artifacts + blue/green on Cloud Run**: images tagged with the git SHA and deployed by digest; new revision deployed with `--no-traffic` and a tag, smoke-tested, then 100 % traffic; rollback = shift back. DB migrations follow expand/contract and run as a Cloud Run job before the traffic shift | Required by the guide. Details: [../architecture/build-and-deploy.md](../architecture/build-and-deploy.md) |
| D-20 | The Inventory concurrency test is **no longer cuttable** | It is the running evidence of E-02 (zero overselling) |

## Implementation decisions taken while scaffolding the repo

Proposals until the contracts owner confirms them at the freeze.

| ID   | Decision | Why |
| ---- | -------- | --- |
| R-01 | All code-level names are English; Spanish design names are mapped in the [glossary](../architecture/glossary.md) (e.g. `PedidoPagado` → `OrderPaid`, `ACTIVA` → `ACTIVE`) | "Everything in English" |
| R-02 | The login `sub` is a **UUID v5 of the lower-cased email** | The same person must get the same `userId` on every login, otherwise "my orders" and queue re-entry break |
| R-03 | The mock payment page completes via `GET /mock-gateway/checkout/{paymentId}/complete?outcome=APPROVED\|DECLINED` | The Gateway only routes `GET /mock-gateway/**` |
| R-04 | Extra error codes `NOT_FOUND` (404), `RATE_LIMITED` (429), `INVALID_SIGNATURE` (401), `PAYMENT_UNAVAILABLE` (503), `INTERNAL` (500) | Needed by the plan's own behavior but missing from its table |
| R-05 | Queue admission parameters (`ADMISSION_BATCH_SIZE`, `ADMISSION_INTERVAL_SECONDS`) are service env vars, not sales rules | Sales rules carry exactly three fields in the plan |
| R-06 | A response replayed from an `Idempotency-Key` carries the header `Idempotent-Replayed: true` (same status and body as the first one) | Makes a replay observable in the demo and in logs (Lab 4 §2.2 "HIT"); one line in the common interceptor |
| R-07 | Schema validation failures are `422 VALIDATION_ERROR`, not `400` | The request is well-formed JSON but violates the contract (RFC 9110 §15.5.21); `400` stays for malformed bodies and Pub/Sub poison messages |

## Implementation decisions (ADRs)

Decisions taken while turning the plan into running infrastructure. Full records, with context
and consequences, in [../adr/](../adr/README.md).

| ADR | Decision |
| --- | -------- |
| [0001](../adr/0001-memorystore-on-demand.md) | Queue store is Memorystore Basic 1 GB, created only for live tests and demos (`make redis-up`) |
| [0002](../adr/0002-work-happens-inside-a-request.md) | No work outside a request: outbox flush after commit + housekeeping endpoint every minute; synchronous webhook; admission tick guarded by a Redis lock |
| [0003](../adr/0003-reservation-expiry-safety-net.md) | Reservation expiry: Cloud Tasks + one-minute sweep; expire requires `expires_at <= now()` |
| [0004](../adr/0004-terraform-owns-config-ci-owns-code.md) | Terraform owns config, CI owns code and traffic; runtime switches via `make` only |
| [0005](../adr/0005-dev-sizing-and-demo-determinism.md) | Connection budget and instance caps; one Orders instance; DLQ retry timing |
| [0006](../adr/0006-inventory-partition-key.md) | No sharding; `event_id` is Inventory's partition key when needed |
