# Delivery 4 artifact — master reference

> Owner: Platform (Julián). Compiled **Sat Oct 10, 2026** from the Delivery 4 guide, Labs 4–5, the
> three Unit 5 readings, Entregas 1–3 (`docs/design/*.pdf`), and the repo at `main` `48a9b55`.
> Deadline **Mon Oct 12, 23:59** — one PDF named **`delivery4-team-F`** on Google Classroom.

This file is the single brief for writing the PDF. Each section below follows the guide's §3.1
order. For each section it gives what the guide asks, what we write, the facts and numbers to
quote, the sources to copy from, and the traps to avoid. The PDF is written outside the repo. Copy
from here and from the linked files, and do not invent numbers.

Companions:
- [delivery-4.md](delivery-4.md) maps each requirement to its evidence.
- [../atlas/index.html](../atlas/index.html) shows every component and decision, with results.
- [../evidence/](../evidence/README.md) holds the measured runs.

---

## 0. Ground rules for writers

1. **Precedence.** The order is contracts, then `docs/plan/`, then the PDFs of Entregas 1–3. The PDFs
   describe the **target** system. The prototype is a **slice** of it. Every deviation is stated
   with its rationale ([target-vs-slice.md](../architecture/target-vs-slice.md)). The guide says
   "exactly as designed", so naming each deviation openly is what makes the artifact defensible.
2. **ID collisions.** Disambiguate these IDs every time you use one:
   - **Entrega 3 weaknesses D-01…D-06** are not the **repo decisions D-01…D-21**. In the PDF, write
     "E3 weakness W-01…W-06" for the former and keep D-xx for repo decisions.
   - **Entrega 3 ADR-03/ADR-04** are not the **repo ADR-0001…0007**. Write "E3-ADR-03" and "ADR-0001".
   - Entrega 3 never wrote out ADR-01/02. Those decisions live as trade-offs TO-01/TO-02.
3. **Language.** The PDF is in English, like the repo. The Entregas were in Spanish, so translate
   their IDs' titles and keep the IDs as they are.
4. **Numbers.** Quote measured values exactly, with date and environment (`dev`,
   `aforo-dev-teamf`, `southamerica-east1`, Oct 8–9 2026). §9 lists everything that must not
   be overclaimed.
5. **Theory hooks.** Each section has a "Course hook" line. It names the concept from Labs 4–5 or
   the Unit 5 readings that the graders will look for. Use that vocabulary.

---

## 1. What the guide asks, and how it is graded

### 1.1 Required content (guide §3.1) → proposed PDF table of contents

| # | PDF section | Guide item | Brief here |
| - | ----------- | ---------- | ---------- |
| 1 | Team | Name (F) + full names | §2.1 |
| 2 | Software system | Name, logo, description, domain (from Delivery 1) | §2.2 |
| 3.1 | C&C view | Diagram + description of components and connectors | §3.1 |
| 3.2 | Deployment view | Diagram + software and environmental elements, cloud services | §3.2 |
| 3.3 | Quality attribute scenarios | The concrete scenarios the architecture was designed for | §3.3 |
| 3.4 | Tactics and patterns | Mapped explicitly to each quality attribute | §3.4 |
| 3.5 | Trade-off analysis | ≥ 1 sensitivity or trade-off point, **resolved as an ADR** | §3.5 |
| 4.1 | Interfaces and contracts | API and event specifications | §4.1 |
| 4.2 | Data schema and model | | §4.2 |
| 4.3 | Behavioral design | State machines + key internal logic | §4.3 |
| 5.1 | Implementation practices | Statelessness, health checks, graceful shutdown, structured logging; **the FaaS component, its cold start and execution-time constraints** | §5.1–5.2 |
| 5.2 | Infrastructure as Code | Tool, what it provisions, organization | §5.3 |
| 5.3 | Build and deployment | Artifact, strategy, **how a schema or contract change was sequenced** | §5.4 |
| 5.4 | Links | Repository; deployed system if public | §5.5 |
| 6 | Discussion and reflection | Rationale · challenges · QA verification · cloud-native evaluation · lessons | §6 |

### 1.2 Non-functional requirements the prototype must prove (guide §2.2)

- **Styles and patterns from Delivery 2.** Point at where each one lives in code and deployment: §3.4 pattern map.
- **Delivery 3 tactics.** At least one resilience, elasticity or reliability tactic must be demonstrable live. We have five: E-06, E-02, expiry, E-01 and E-05 (§7).
- **Detailed design honored.** Contracts must match the API, schemas must match what is deployed, and lifecycle entities must follow their state machines (§4).
- **IaC with no manual resources.** Terraform (§5.3). Name the bootstrap exceptions honestly.
- **Immutable artifact and deliberate deployment strategy.** Image per SHA, deployed by digest, blue/green (§5.4).
- **At least two FaaS components.** `prewarmer` and `dlq-monitor` (§5.2).

### 1.3 Grading (guide §3.3)

- **Artifact.** Graded on clarity, organization, depth and format. Name the file `delivery4-team-F.pdf`.
- **Consolidated design.** Graded on coherence of structures, QAs, trade-offs and detailed design, and **how faithfully the construction reflects it**. The deltas table in §6.1 is the answer.
- **Prototype.** The checklist is:
  - the end-to-end scenario;
  - styles and patterns;
  - tactics;
  - **multiple persistence paradigms**;
  - a FaaS component;
  - containers and IaC.

  Each needs a row in §7 with evidence.
- **Presentation.** Covers rationale, construction and the live demo, and answering questions critically. Use [../runbooks/demo.md](../runbooks/demo.md). §9 is the list of honest answers to the hard questions.

---

## 2. Team and system

### 2.1 Team F

There are six members. Entrega 1 lists **six** on its cover but only five in its p.3 table, where
Juan José is missing. Use all six:

| Name | Front in Delivery 4 |
| ---- | ------------------- |
| David Julián Guzmán Cárdenas (`@djguzmanc`) | Platform, deployment, operations, `prewarmer`, `dlq-monitor` |
| Juan José Medina Guerrero (`@JuanjMedina`) | Gateway, contracts, `@aforo/common`, catalog |
| Sergio Alejandro Ruiz Hurtado (`@SergioR-02`) | Purchase frontend (`apps/web`) |
| Cristian Daniel Montañez Pineda (`@CristianMontane`) | Waiting room end to end (`services/queue` + queue screen) |
| Daniel Felipe Soracipa Torres | Orders and checkout, mock payment gateway |
| Luis Esteban León Rojas (`@luleonr`) | Inventory and reservations |

Ownership drifted during the build: Platform took over finishing catalog, inventory and orders.
Mention this only in Lessons Learned (§6.5), if at all.

### 2.2 Software system (carry over from Entrega 1 §2)

- **Name.** **Aforo**, from *aforo*, the maximum capacity of a venue. The promise is to never sell
  more tickets than exist, and never fail to sell the ones that do, "even if tens of thousands of
  people arrive in the same second".
- **Subtitle.** "Ticketing platform for mass events" ("plataforma de venta de entradas para
  eventos masivos").
- **Logo.** `apps/web/public/brand/aforo-logo.png`. It is the lowercase "aforo" wordmark with a
  navy-to-blue gradient. The first "o" is a tilted ticket stub with a white star and an
  orange orbit ring.
- **Description.** Sales of concert, festival and match tickets under extreme bursts. It has three
  cooperating pieces:
  1. a virtual **waiting room** that admits at the rate the platform can serve;
  2. **inventory with temporary reservation**, where each seat is sold exactly once;
  3. **anti-automation** (CAPTCHA, a per-person limit, blocking). This piece is out of the slice.
- **Business model.** A per-ticket commission paid by the organizer, with no fixed fee. Cost must
  therefore follow sales (RN-03).
- **Domain.** Mass-event ticketing.
  - Load pattern: weeks near zero, then minutes with more people than the venue holds.
  - Reference case: the Ticketmaster Eras Tour presale, Nov 15, 2022. It saw 3.5 billion requests
    in one day, 4× its historic peak, and the general sale was cancelled.
  - Three failures to avoid: going down at the peak, bots buying before people, and not
    knowing who bought what.
- **Stakeholders.** Buyer, organizer, platform operator (the team), and the payment gateway.
  MinCultura, DIAN and gate staff are out of the slice.
- **Bounded contexts (DDD).**
  - Core: waiting room, inventory and reservations, anti-bot rules.
  - Supporting: catalog, orders, ticket issuance, back-office, notifications, after-sales.
  - Generic: payments, identity, email/SMS, CAPTCHA, e-invoicing, CDN.

---

## 3. Architectural design (consolidated and finalized)

> **Present two layers in every view:** the **target** design (Entregas 2–3) and the **built slice**
> (Delivery 4). The grader evaluates "how faithfully the construction reflects" the design. One
> diagram per view with the slice highlighted, plus a "target-only" legend, does both jobs.

### 3.1 Component-and-Connector view

**Diagram sources.**
- Target: `docs/design/C&C_foro-Architectura.drawio (2).png`. This is the Entrega 2 figure plus the
  Entrega 3 additions in red: correlation ID, payment timeouts, instance cap, rate limiting,
  secrets manager, observability, `/health/*`.
- Slice: the mermaid component diagram in [overview.md](../architecture/overview.md) §Components
  and §Asynchronous topology.
- **To do:** a slice C&C figure in the same visual style as the target, with the functions added.

**Styles (Entrega 2 §4).**
- **Microservices** as the primary style. There is one deployable per bounded context, with
  intermediate granularity.
  - A modular monolith was rejected: the admission and reservation peak would sit on one runtime
    and one database.
  - Service-per-requirement was rejected as over-fragmentation.
- **Event-driven** as the complementary style. Facts go on the bus without the producer knowing
  its consumers.
  - Availability checks and reservations stay **synchronous**.
  - The rule: use sync when the actor waits or correctness needs the answer now, and async
  otherwise.
- **Rejected styles:** space-based architecture (in-memory is used only inside the waiting room),
  event sourcing, streaming, and micro-frontends.
- "Managed execution", meaning stateless containers on managed compute, is a **deployment** decision,
  not a style.

**Components in the slice.** Target-only components are marked †.

| Component | Type | Responsibility | Unit |
| --------- | ---- | -------------- | ---- |
| Web (SSR) | Presentation | Login, catalog, queue screen, purchase, my orders; no server session | `apps/web` (Next.js, ADR-0007) |
| API Gateway | Orchestration | Simulated login (HS256 JWT, D-06), session check, per-IP quota on queue routes, fixed route map, generates `X-Correlation-Id` | `services/gateway` |
| Catalog | Logic | Events, sectors, prices, sale windows and rules; publishes facts | `services/catalog` |
| Waiting room | Logic | Join, position (RF-05 random-then-FIFO), paced admission, pass with a 10-min TTL, SSE | `services/queue` |
| Orders & Checkout | Logic | Owns the order; **saga orchestrator** for reserve → pay → confirm/refund; payment ACL + circuit breaker | `services/orders` |
| Inventory | Logic | Availability, conditional decrement, single active reservation, per-person limit, expiry | `services/inventory` |
| `prewarmer` | FaaS | Pre-warms gateway and queue around each sale window (E-01) | `functions/prewarmer` |
| `dlq-monitor` | FaaS | Turns dead-lettered messages into a log metric and an alert (E-05) | `functions/dlq-monitor` |
| Mock payment gateway | External (test double) | Payments, checkout page, signed webhook, fault injection | `functions/mock-payment-gateway` |
| Edge (CDN/WAF/LB) †, identity provider †, CAPTCHA †, ticket issuance †, notifications †, email † | — | Out of the slice (§6.1) | — |

**Connectors.**

| From → to | Kind | Purpose |
| --------- | ---- | ------- |
| Browser → web, browser → gateway | HTTPS REST (sync) | Pages; `/api/v1/**` calls |
| Gateway → catalog / queue / orders / inventory / mock | HTTPS REST + Google OIDC ID token (sync) | Routed calls; services are private (IAM invoker) |
| Queue → browser (via gateway) | **SSE**, long-lived, one-way | Position and admission push |
| Orders → inventory | Internal REST `/internal/v1/reservations[/confirm\|/release]` (sync) | Saga commands; result needed now |
| Orders → mock | Outbound HTTPS through the **ACL adapter** with timeouts, retry and breaker | Create payment, refund |
| Mock → orders (via gateway) | Signed webhook (HMAC-SHA256), delivered by **Cloud Tasks** | Payment result; retried until 2xx |
| Service → Pub/Sub | Publish **only through the transactional outbox** | `EventPublished`, `SalesRulesConfigured`, `ReservationExpired`, `OrderPaid` |
| Pub/Sub → consumer | Push subscription with OIDC; at-least-once; 5 attempts; DLQ | Projections (queue, inventory), expiry → orders, prewarmer |
| Inventory → Cloud Tasks → inventory | **Delayed message**, task name = reservation id | Expire the reservation at its TTL |
| Cloud Scheduler → catalog / inventory / orders | HTTPS, every minute | `/internal/v1/housekeeping`: outbox flush, expiry sweep, refund sweep (ADR-0002) |
| DLQ topics → `dlq-monitor` | Eventarc CloudEvent | Dead-letter alert |
| Service → its own store | pg / Redis | No cross-store access (RD-03) |

### 3.2 Deployment view

**Diagram sources.**
- Target: `docs/design/aforo_despliegue_final.png` (component → category → GCP service) and
  `docs/design/aforo_despliegue_final_red.png` (network topology).
- Entrega 2 had **no** deployment view of its own; these two PNGs are from Entrega 3.
- **To do:** a slice deployment figure. Show `dev` with the on-demand pieces drawn dashed: Memorystore,
  and Cloud SQL on/off.

**Built slice** (from `infra/envs/dev/*.tf`). GCP project `aforo-dev-teamf`, region
**southamerica-east1** (São Paulo). It was chosen in Entrega 3 §5.9 over AWS, Azure and Oracle,
which has single-AZ regions.

| Layer | Elements |
| ----- | -------- |
| Compute (Cloud Run services) | `aforo-web`, `-gateway`, `-catalog`, `-queue`, `-orders`, `-inventory`. All min 0. Max: inventory 3, orders 1, catalog 2, gateway 3, web 2, queue 2. Concurrency 80. Only queue has CPU always allocated. Startup CPU boost |
| Compute (Cloud Run functions gen2, Node 24) | `prewarmer` (max 1, concurrency 1, 30 s), `dlq-monitor` (10 s), `mock-payment-gateway` (30 s). 256 MiB each |
| Jobs | `aforo-<svc>-migrate` (catalog, inventory, orders) and `aforo-catalog-seed` (Cloud Run jobs) |
| Relational | Cloud SQL `aforo-pg`, PostgreSQL 17, db-f1-micro, ZONAL, `max_connections` 25. Three databases with three users (`catalog`, `inventory`, `orders`). On/off via `activation_policy` |
| Key-value | Memorystore for Redis 7.2 **Basic 1 GB**, Direct VPC egress from queue and gateway; **created only for tests and demos** (ADR-0001) |
| Document | Firestore Native, used only by the mock (`payments` collection) |
| Messaging | Pub/Sub: 4 topics, push subscriptions with OIDC, ack 60 s, retry 10→60 s, 5 attempts, 6 DLQ topics. Cloud Tasks queues: `reservation-expiry`, `payment-webhooks`, `prewarm-windows`. Cloud Scheduler: 3 housekeeping jobs (paused when off) |
| Network | VPC `aforo-vpc` with subnet 10.10.0.0/24, used only for Memorystore egress. Cloud SQL through the connector. Services private through IAM invoker |
| Platform | Artifact Registry (immutable tags), Secret Manager (DB URLs, JWT key, webhook secret), Cloud Logging, a log-based metric `aforo/dead_letters` with an alert policy and email channel, a GCS state bucket, and the functions source bucket (versioned) |
| Outside GCP | GitHub Actions with Workload Identity Federation (no keys) |

The **target** (Entrega 3 §6.2) differs in these ways:
- a global L7 LB with Cloud CDN and Cloud Armor per window;
- Identity Platform and reCAPTCHA;
- a DB window profile of 1 vCPU with 100 connections and a zone-b standby;
- Memorystore Standard with a replica;
- instance ranges of 2–20 for the gateway and 3–20 for the queue;
- NAT with a static egress IP;
- internal ingress everywhere;
- Wompi as the payment gateway, plus the issuance and notifications services with Firestore.

### 3.3 Quality attribute scenarios (Entrega 3 §4, six-part QAS)

Entrega 1 had E-01…E-06. Entrega 3 kept 5 of them, dropped **E-04** (no baseline exists; there is
one organizer in the slice), added **E-07 cost** and **E-08 security**, and corrected **E-06** with
E3-ADR-03 (no expiry extension). Write each one in full with source, stimulus, artifact,
environment, response and response measure. The full text is in the Delivery 3 extract; the
measures are:

| ID | QA | Stimulus (short) | Response measure (Entrega 3) |
| -- | -- | ---------------- | ---------------------------- |
| E-01 | Elasticity | 3,000 joins in the first 60 s from near-zero | Everyone gets a position; 0 × 5xx on ingress; p95 to position ≤ 2 s; extra capacity ≤ 90 s; **no cold-start instance in the first minute** |
| E-02 | Integrity under contention | 2,000 concurrent reservations, 100 seats, 10 s | **Overselling = 0** every run; 0 orphan seats after 60 s; 0 connection-exhaustion errors; **p95 reservation ≤ 300 ms** |
| E-03 | Availability | One zone stops | ≥ 99.9 % successful requests; recovery ≤ 60 s; 0 confirmed reservations lost |
| E-05 | Observability | Payment errors > 2 % for 1 min | Alert ≤ 60 s; full trace ≤ 5 min; 100 % carry a correlation ID; **DLQ alert ≤ 5 min** |
| E-06 | Resilience (payment gateway) | 5xx or > 10 s for 5 min | **Fail fast ≤ 50 ms when open**; 0 blocked threads; **0 double charges**; 0 errors propagated to queue/inventory; ≥ 95 % complete within 10 min of recovery |
| E-07 | Cost | Two weeks with no sale | Idle ≤ 15 USD/month; total ≤ 50 USD/month (RN-01); cost per ticket measured |
| E-08 | Security | 1,000 OWASP payloads, 500 bad tokens, direct calls | ≥ 95 % blocked at edge; ≤ 1 % false positives; 100 % 401/403 at gateway; 0 services reachable; alert ≤ 5 min |

### 3.4 Tactics and patterns mapped to quality attributes (and where they live)

**Patterns** (Entrega 2 §4, with locations from [delivery-4.md](delivery-4.md#pattern-map)):

| Pattern | QA supported | Lives in (code / deployment) |
| ------- | ------------ | ---------------------------- |
| API Gateway (single entry) | Security, modifiability | `services/gateway`; only public service besides web |
| Database per Service | Modifiability, availability isolation | 3 databases and 3 users in `infra/modules/cloud-sql`; no cross-DB access |
| Saga (orchestrated) | Consistency without 2PC | `services/orders/src/orders/`, `payments/webhook.service.ts` |
| Transactional Outbox | Reliability (no lost events, no dual write) | `packages/common/src/core/outbox/outbox.ts`; `outbox` tables in the 3 DBs; flush after commit + housekeeping |
| Inbox / Idempotent consumer | Reliability under at-least-once | `packages/common/src/core/inbox/inbox.ts` (`consumeOnce`); Redis `inbox:{id}` in queue; orders `InboxRepository` |
| Idempotency key (RD-02) | Reliability, correctness under retries | `packages/common/src/nest/idempotency/idempotency.interceptor.ts` |
| Anti-Corruption Layer | Modifiability, resilience | `services/orders/src/payments/` ↔ `functions/mock-payment-gateway` |
| Circuit Breaker + timeout + retry | Resilience (E-06) | `services/orders/src/payments/resilience.ts` (cockatiel) |
| Competing consumers + DLQ | Reliability, observability | Pub/Sub push subscriptions + DLQ topics (`infra/modules/pubsub-topic`) |
| Delayed delivery | Reliability (expiry) | Cloud Tasks `reservation-expiry` → `/internal/v1/reservations/{id}/expire` (+ sweep, ADR-0003) |
| Event-carried state transfer | Availability (no sync call to catalog) | Inventory `event_projection`, queue `event:{id}` hash |
| Health endpoints | Availability (detection) | `/health/live`, `/health/ready` (`packages/common/src/nest/health/`) |
| Waiting room (queue-based load leveling) | Elasticity, integrity | `services/queue` (admission tick under a Redis lock) |

**Tactics per scenario** (Entrega 3 tactic tables cross-referenced with the slice):

| Scenario | Tactics (Bass et al. names) | Built in the slice | Dropped (state why) |
| -------- | --------------------------- | ------------------ | ------------------- |
| E-01 | Pre-warming per window; autoscaling + LB; throttling by the waiting room; rate limiting | `prewarmer` raises gateway and queue min to 1 at opens − 600 s; scale 0..N; paced admission (D-12); per-IP quota 60/min on queue routes | Window-sized minimums (2–3 → 1), Edge rate limiting, load test |
| E-02 | Serialized write at the data owner; aggregate concurrency limit (bulkhead); admission control | Conditional `UPDATE … WHERE available >= q`; instance cap × pool kept under 25 connections (ADR-0005); queue | DB window profile (100 conns) |
| E-03 | Health checks (detection); multi-zone redundancy + failover | `/health/*` + Cloud Run startup/liveness probes; Cloud Run is regional | Cloud SQL standby, Memorystore replica |
| E-05 | Structured logging; correlation ID; metrics + alerts | JSON logs, `correlationId` across HTTP, Pub/Sub attributes and Cloud Tasks; `dlq-monitor` + alert | Distributed tracing (OTel), error-rate alert |
| E-06 | Timeouts; circuit breaker; retry with backoff + jitter; graceful degradation | 0.5 s / 2 s timeouts, 3 attempts with 200 ms→5 s backoff, breaker opens at 5 consecutive failures and half-opens after 30 s, `503 PAYMENT_UNAVAILABLE`, no expiry extension (E3-ADR-03) | — |
| E-07 | Scale to zero; per-window creation with IaC; TTL on transient data | min 0 everywhere; `make up/down`; Memorystore by `make redis-up/down`; Cloud SQL stop | Edge per window (no Edge at all); outbox/inbox TTL purge |
| E-08 | Authenticate, authorize, limit exposure, validate input, detect intrusion | HS256 session check at gateway, private services + IAM invoker, HMAC webhook, schema validation (422) | WAF, Identity Platform, internal ingress, NAT |

**Reliability (not a numbered QAS but demonstrated).** Reservation expiry uses Cloud Tasks plus a
one-minute sweep. It is idempotent because the task name is the reservation id, and it requires
`expires_at <= now()`.

**Course hook** (U5 Behavioral design §5): "for every resilience tactic name the specific internal
method responsible, tuned to the documented failure modes of the managed dependency". Cite
`resilience.ts` and its parameters. Cite the 2 s response timeout chosen against the mock's
5 s fault delay, and the 15 s gateway → orders timeout sized for 3 attempts.

### 3.5 Trade-off analysis + ADR (required: at least one)

Recommended structure: one table of sensitivity and trade-off points, then **one ADR written out in
full** (MADR: status, context, options, criteria, decision, consequences), plus short references to
the others.

**Sensitivity and trade-off points** (Entrega 3 §8.1, plus what construction measured):

| Point | Attributes | Type | What we learned building it |
| ----- | ---------- | ---- | --------------------------- |
| In-memory store exists only per window | E-01 / E-03 vs E-07 | Trade-off | ADR-0001: Memorystore on demand. Creation takes ~10 min, so `redis-up` must run ≥ 15 min before a test. Costs about US$1–2/day when on |
| One DB instance for all services | Isolation vs E-07 | Trade-off | D-05: one db-f1-micro with 25 connections, split by caps × pools (ADR-0005) |
| Inventory instance cap × pool | E-02 integrity vs latency | **Sensitivity** | **Measured.** 200 at once took inventory p95 to 808 ms; 20/s metered gave 75 ms. Same code, same 0 oversold |
| Serialized sector counter | E-02 vs scalability (TO-03) | Trade-off | ADR-0006: partition key `event_id` if ever sharded |
| Breaker state in memory | E-06 determinism vs scale-out | Trade-off | ADR-0005: orders max 1 instance so the demo is deterministic |
| Work only inside a request | Cost (CPU throttled) vs latency of async work | Trade-off | ADR-0002: no pollers; outbox flush after commit plus a scheduler every minute |

**ADR to write out in full.** Pick **one** of these. The first is recommended:

1. **ADR-0001 — Memorystore on demand** ([../adr/0001-memorystore-on-demand.md](../adr/0001-memorystore-on-demand.md)).
   It resolves E3 TO-01/TO-02 (cost vs elasticity and availability), was revised by construction
   (D-15 was impossible: Cloud Run has no raw TCP ingress), and is verified by the E-07 switch evidence.
2. **ADR-0005 — dev sizing and demo determinism.** It resolves the E-02 sensitivity point, with
   measured numbers on both sides.
3. **ADR-0006 — inventory partition key.** This is the exact shape Lab 4 asks for:
   - options: `event_id`, `buyer_id`, `reservation_id`, `created_at`;
   - criteria: hotspot, scatter-gather, local ACID with the outbox.

   It is also the answer to Lab 4's "sharding justification" checklist item.

Also cite **E3-ADR-03** (no expiry extension during a gateway failure). It is the one correction
to an earlier delivery and is implemented exactly.

---

## 4. Detailed design (consolidated and finalized)

### 4.1 Component interfaces and contracts

**Sources:** `contracts/openapi/{gateway,catalog,queue,inventory,orders,mock-payment-gateway,prewarmer}.yaml`,
`contracts/events/*.schema.json`, [conventions.md](../../contracts/conventions.md). The files are
linted in CI with Redocly (`contracts.yml`).

**Write these points.**

- **Contract-first.**
  - The contracts were frozen Tue Sep 29, before the code.
  - The teams built against Prism mocks generated from them (`make mock SERVICE=…`).
  - The contracts owner arbitrates every change.
- **Routes and versioning.**
  - Public routes are `/api/v1`; internal routes are `/internal/v1`, never exposed by the gateway.
  - Versioning is in the URL.
  - **Compatible changes** stay in v1 and ship provider first: a new optional field, a new
    endpoint, a new error code.
  - **Breaking changes** (rename or remove a field, change a type, make a field required) create
    `/v2` or event `version: 2`, served in parallel (RD-05).
- **Error semantics.** RFC 9457 `application/problem+json` with a closed catalog of `code`s. Show
  the table: 401 UNAUTHENTICATED, 409 SALE_NOT_OPEN, SOLD_OUT, LIMIT_EXCEEDED,
  ACTIVE_RESERVATION_EXISTS, RESERVATION_EXPIRED, IDEMPOTENCY_CONFLICT, 422 VALIDATION_ERROR, 400
  MALFORMED_REQUEST, 404, 401 INVALID_SIGNATURE, 429 RATE_LIMITED, 503 PAYMENT_UNAVAILABLE, 500
  INTERNAL.
  - Caller faults (4xx) are distinguished from provider faults (5xx/503); retrying a 4xx unchanged
    never helps.
  - **Course hook:** U5 Contracts §2.2.
- **Idempotency guarantee** (RD-02). Every state-changing endpoint requires `Idempotency-Key`.
  - The fingerprint is `sha256([method, path, userId, body])`.
  - It is stored in the service's own Postgres table, so it **holds across instances**. This is the
    course's "never in-memory dedup" point (U5 Contracts §4.2).
  - Behavior against Lab 4's matrix:

    | Lab 4 case | Aforo | Note |
    | ---------- | ----- | ---- |
    | New key → 201 MISS | 201 | |
    | Same key, same payload → 200 HIT | **Same 201 and body + `Idempotent-Replayed: true`** | R-06: replays the original status. The header plays the role of `X-Cache-Lookup: HIT` |
    | Same key, different payload → 409 | 409 IDEMPOTENCY_CONFLICT | |
    | Invalid → 400 | 422 VALIDATION_ERROR | R-07: schema violations are 422; unparseable JSON is 400 |

  - Errors are not cached, so a retry after SOLD_OUT re-executes.
  - The interceptor is a cache, not a lock. Concurrent first calls are made safe by the business
    layer, so the check-and-act stays atomic (U5 Behavioral §4.2):
    - deterministic ids in catalog;
    - `ON CONFLICT (reservation_id)` in orders;
    - the partial unique index plus the conditional update in inventory.
- **Async contract.**
  - **Envelope** `{messageId, type, version, occurredAt, correlationId, producer, data}`. It is
    CloudEvents-like and validated with Ajv strict.
    - `messageId` is the dedup key.
    - `type` and `correlationId` are also Pub/Sub attributes.
  - **Delivery** is at-least-once, stated in the contract; consumers dedup.
  - **Ordering** is not guaranteed. Consumers skip stale facts by comparing `occurredAt`, and
    `EventPublished` and `SalesRulesConfigured` write disjoint fields.
  - **Schema compatibility.**
    - Payload schemas do not set `additionalProperties: false`, so consumers tolerate new fields
      (forward compatible, Postel's law, Lab 4 §2.4).
    - The envelope itself is strict, so adding an envelope field is a breaking change.
  - **Events** (topic, producer, consumers):
    - `EventPublished`: catalog → queue, inventory, prewarmer.
    - `SalesRulesConfigured`: catalog → queue, inventory.
    - `ReservationExpired`: inventory → orders.
    - `OrderPaid`: orders → **no consumer** (the future ticketing hook).
- **Contract enforcement at runtime.**
  - Request validation in each service mirrors the OpenAPI.
  - Invalid push envelopes answer 400 so they dead-letter instead of looping.
  - **There are no automated contract tests against deployed revisions.** Say "linted in CI and
    exercised by the live runs", nothing stronger.

### 4.2 Data schema and model

**Three persistence paradigms**, a graded item:

| Paradigm | Engine | Owner | Why this engine (access pattern) |
| -------- | ------ | ----- | -------------------------------- |
| Relational | Cloud SQL PostgreSQL 17, one DB per service | catalog, inventory, orders | Inventory needs a 3-row atomic update (counter + reservation + buyer total) with the outbox in the same local ACID transaction. A document DB was rejected for this in Entrega 3 §5 |
| In-memory key-value / sorted set | Memorystore for Redis | queue (+ gateway quota counters) | Ordered positions (ZSET), TTL passes, atomic Lua; ephemeral by design (rebuilt from events) |
| Document | Firestore | mock payment gateway | Pay per operation, nothing at rest. **Caveat:** used only by the test double. The target used it for Notifications |

**Schemas** (migrations are the source: `services/{catalog,inventory,orders}/migrations/001_init.sql`).
Include an ER figure per database:

- **catalog:** `event`, `sector`, `sales_rules`, `idempotency_key`, `outbox`. These are
  normalized because catalog is the single source of truth. `saleState` is derived, not stored.
  The trigger `event_transition_guard` forbids leaving PUBLISHED.
- **inventory:**
  - `event_projection`: denormalized, fed by events, the read model.
  - `sector_availability(available CHECK 0..capacity, version)`: the serializing counter.
  - `reservation`: partial UNIQUE `(event_id, buyer_id) WHERE status='ACTIVE'` gives RF-11, and the
    trigger allows only ACTIVE to change.
  - `buyer_event_total`: RF-12.
  - `idempotency_key`, `inbox`, `outbox`.
- **orders:**
  - `"order"`: CHECKs `total = unit × qty` and `(status='PAID') = (paid_at NOT NULL)`, with a
    transition trigger.
  - `payment`: transition trigger.
  - `idempotency_key`, `inbox`, `outbox`.
- **queue (Redis):**

  | Key | Type | Content |
  | --- | ---- | ------- |
  | `queue:{eventId}` | ZSET | Positions |
  | `admitted:{eventId}:{userId}` | STRING, TTL 600 s | The pass |
  | `event:{eventId}` | HASH | The projection |
  | `inbox:{messageId}` | STRING, TTL 24 h | Dedup |
  | `admission:{eventId}:{tick}` | STRING, NX lock | Admission tick lock |

- **Conventions:** money is integer cents plus `currency` (COP), times are `timestamptz` UTC, ids are
  UUIDs, and DB column names are snake_case.

**Design decisions to discuss.** Course hooks are U5 Data and Lab 4 §3.

- **Query-driven design.**
  - The hot query is the reservation, a single-row conditional update keyed by
    `(event_id, sector_id)`.
  - The availability read hits the same table.
  - My orders uses the index `(buyer_id, created_at DESC)`.
- **Normalize vs denormalize, per field.**
  - Orders copies the unit price and expiry from the reservation, because the financial total
    must never depend on another service.
  - Inventory denormalizes event rules and sector names and prices via events (event-carried
    state transfer). It never calls catalog synchronously.
- **Partition key** (ADR-0006).
  - No sharding in the slice.
  - The key would be `event_id`, which keeps the counter, the reservations and the buyer total on
    one shard, so the transaction stays local.
  - Rejected keys: `buyer_id` splits the counter, `reservation_id` forces scatter-gather, and
    `created_at` creates a temporal hotspot.
  - Accepted limit: one very hot event is still a single-node hotspot. The waiting room is the mitigation.
- **Ownership and privacy.** Each service owns its database and DB user (RD-03). No service reads
  another's schema, which is what lets each migrate alone.
- **Transactional boundaries** (Lab 4 checklist). The business row and its outbox row commit in one
  local transaction:
  - catalog publish: `EventPublished` and `SalesRulesConfigured`;
  - inventory expire: `ReservationExpired`;
  - orders webhook: `OrderPaid`.

  There is no 2PC and no dual write.
- **Schema evolution.**
  - The policy is expand/contract, with migrations run as a Cloud Run job before the new revision
    (§5.4).
  - **Honest note:** only `001_init.sql` exists per service, so no expand/contract change was ever
    shipped.

### 4.3 Behavioral design

**Source:** [state-machines.md](../architecture/state-machines.md) (normative) and
[overview.md](../architecture/overview.md) (happy-path sequence, saga branches). Draw one
state diagram per entity.

| Entity | States | Transitions (guard) | Enforcement |
| ------ | ------ | ------------------- | ----------- |
| Reservation (inventory) | ACTIVE → CONFIRMED \| EXPIRED \| RELEASED (all terminal) | confirm: `status='ACTIVE'`; expire: `status='ACTIVE' AND expires_at <= now()`; release: `status='ACTIVE'` | Conditional `UPDATE … WHERE` + DB trigger `reservation_transition_guard` |
| Order (orders) | PENDING_PAYMENT → PAID \| EXPIRED \| REFUND_PENDING; EXPIRED → REFUND_PENDING | PAID only from PENDING_PAYMENT; EXPIRED on `ReservationExpired`; REFUND_PENDING on approval after expiry | Conditional updates + trigger `order_check_transition` |
| Payment (orders + mock) | CREATED → APPROVED \| DECLINED; APPROVED → REFUNDED | `WHERE status = :from` | Conditional update + trigger; Firestore transactions in the mock |
| Queue entry (Redis) | WAITING → ADMITTED → gone (pass TTL) | `ZADD NX`; `ADMIT_LUA` pops and sets the pass atomically | Lua scripts (atomic) |
| Event (catalog) | DRAFT → PUBLISHED | `WHERE status='DRAFT'` under `SELECT … FOR UPDATE` | Row lock + trigger |

**Key internal logic to describe.** Include a sequence diagram for each.

1. **Reservation transaction** (`reservations.service.ts`). This is the core of E-02. One
   transaction:
   1. Read the projected rules.
   2. `UPDATE sector_availability SET available = available − q WHERE … AND available >= q`.
      0 rows means SOLD_OUT, and the row lock serializes buyers.
   3. Insert the reservation. A unique violation becomes ACTIVE_RESERVATION_EXISTS.
   4. Check the buyer total. Over the limit, it returns LIMIT_EXCEEDED and rolls back everything.
   5. After commit, enqueue the expiry task. A failure there is only logged, because the sweep is
      the safety net (ADR-0003).
2. **Confirm vs expire race.** Both are conditional transitions out of ACTIVE, so exactly one wins.
   A late approval therefore gives an order in REFUND_PENDING plus an idempotent refund, never a
   reactivated reservation (RF-09, E3-ADR-03).
3. **Saga, orchestrated by orders.**
   - Steps: reserve (with the client's idempotency key forwarded), create the order, create the
     payment intent, receive the webhook, confirm in inventory, then PAID + `OrderPaid` or
     REFUND_PENDING + refund.
   - Compensations: expiry releases the seats and moves the order to EXPIRED by event;
     `RefundSweep` retries refunds.
4. **Webhook.** It checks the HMAC first. It claims the inbox entry by `notificationId` in the
   same transaction as the state change, and answers only after processing. A duplicate returns
   200 as a no-op; any failure returns 503, so Cloud Tasks retries. Observed: 5 deliveries gave
   1 PAID and 1 `OrderPaid`.
5. **Admission tick** (queue).
   - It runs every 5 s on each instance, but only the instance that wins `SET admission:{id}:{tick} NX` admits.
   - The winner admits batches of 500.
   - Ordering is RF-05: random inside the opening window, FIFO after it.
   - This is the **only** in-process timer, and the reason the queue has CPU always allocated (ADR-0002).
6. **Outbox flush.**
   - The same request flushes right after commit.
   - Leftovers go out with housekeeping every minute (Cloud Scheduler).
   - A crash between publish and mark causes a duplicate, which the inbox absorbs.

**Course hook** (U5 Behavioral §1, §6). Correctness is designed for duplicate and concurrent
invocation across instances, not for one process. Explicit state machines replace flags, and
every check-and-act is a single atomic statement or script. Every state has a failure exit:

| State | Failure exit |
| ----- | ------------ |
| ACTIVE | expire |
| PENDING_PAYMENT | EXPIRED, or REFUND_PENDING on a late approval |
| APPROVED | REFUNDED |

---

## 5. Construction

### 5.1 Implementation practices

**Statelessness (RD-01).**
- No business state lives in an instance. The stores are:
  - Postgres for data, idempotency keys, inbox and outbox;
  - Redis for the queue and quotas;
  - Firestore for the mock;
  - Cloud Tasks for the prewarmer's schedule ("the queue is the state").
- Connections are lazy, so services boot without their DB or Redis.
- Config comes from env vars and Secret Manager at runtime. The web reads `API_BASE_URL` at
  runtime with no `NEXT_PUBLIC_*`, so one image serves any environment (ADR-0007).
- **Accepted soft state:** the circuit breaker lives in memory, so orders runs with max 1 instance
  (ADR-0005).
- **No work outside a request** (ADR-0002). Cloud Run throttles CPU between requests, so there are
  no pollers and no "respond now, process later". The one exception is the queue admission tick
  under a Redis lock.

**Health checks.** Code: `packages/common/src/nest/health/`.
- `GET /health/live` always returns 200.
- `GET /health/ready` runs the registered checks (1.5 s timeout each) and returns 503 with
  per-check results. The checks are `database` (catalog, inventory, orders), `redis` (queue), and
  `shutdown` (all).
- Cloud Run probes:
  - startup probe on `/health/live`, every 3 s, failure threshold 20;
  - liveness probe on `/health/live`, every 30 s.
  - Readiness is used by the **CI smoke test** before traffic shifts. Probes deliberately use
    *live*, so a revision boots even with the DB off (ADR-0004).
- Web: `/health/ready` checks the gateway.

**Graceful shutdown on SIGTERM.** Code: `packages/common/src/nest/shutdown/shutdown.service.ts`.
On SIGTERM:
1. Readiness turns 503.
2. The `onDrain` hooks close SSE streams. The queue waits at most 1 s, inside Cloud Run's ~10 s
   window.
3. Nest closes the server and waits for in-flight requests, including their outbox flush.
4. The `onClose` hooks quit Redis and end the pg pools.
5. It logs `shutdown.begin` and `shutdown.complete` with `durationMs`.

Covered by tests. Every NestJS `main.ts` calls `enableShutdownHooks()`.

**Structured logging.** Code: `packages/common/src/core/logging/structured-logger.ts`.
- One JSON line per log: `{severity, message, service, …}`. Cloud Logging indexes it as
  `jsonPayload`.
- Per request, an `http.request` line with `correlationId`, `userId`, `route`, `status`,
  `latencyMs` and `queuePass`.
- **Correlation ID.**
  - Generated or accepted (UUID v4) by the gateway and kept in AsyncLocalStorage.
  - Forwarded on outgoing HTTP, in the event envelope, as a Pub/Sub attribute and as a Cloud Tasks
    header.
  - Evidence: one purchase followed across gateway → orders → inventory → `OrderPaid`
    (`docs/evidence/happy-path/10-trace.png`).
- **Honest gaps:**
  - No OpenTelemetry or trace propagation; the correlation ID only.
  - Nest framework logs in gateway and queue are not JSON, though their request and domain logs are.

**Containers.** Multi-stage `node:24-slim` builds, running as `USER node` with `NODE_ENV=production`.
Images are built from the repo root and carry `migrations/` for the migrate job. The web uses
Next.js standalone output.

### 5.2 FaaS components (≥ 2 required)

**Why these and not a converted service** (D-21). The course hook is Lab 5 §2.1 and §4.1, the
"traffic, duration, state" decision tree.
- Entrega 3 §5.2 rejected FaaS for the services: 15-min SSE streams and the DB pools E-02 needs.
- Construction applied FaaS where those limits do not apply: rare, sub-second, stateless work
  that realizes a designed tactic.
- The professor's guidance was not to add FaaS "only to comply". Converting a microservice was
  rejected for that reason.
- Use the compute-model table in [delivery-4.md](delivery-4.md#compute-model-per-unit-lab-5-21-and-41).

| | `prewarmer` (E-01) | `dlq-monitor` (E-05) |
| - | ------------------ | -------------------- |
| Trigger | Pub/Sub push (`EventPublished`) + Cloud Tasks (`/windows/warm`, `/windows/cool`) | Eventarc CloudEvent, one trigger per DLQ topic |
| Does | Creates two named tasks (warm at opens − 600 s, cool at min(closes, opens + 3600 s)); PATCHes service-level `minInstanceCount` on gateway and queue via the Cloud Run Admin REST API (no new revision) | Logs one ERROR line `event=dead_letter` with subscription, attempt, type, correlationId; acks |
| Contract | `contracts/openapi/prewarmer.yaml` + event schema | Pub/Sub CloudEvent |
| State | None: the window lives in the payload and in the pending tasks | None |
| Idempotency | Deterministic task names (409 ALREADY_EXISTS = done); warm uses `max(current, target)`; cool re-checks pending tasks | Duplicate log lines accepted (the alert counts > 0) |
| Cold-start design | No NestJS; esbuild single file; REST instead of SDK clients; lazy module-scope init | Only functions-framework; `@aforo/common` inlined |
| **Cold start measured** | **543 ms** (warm 3–6 ms) | **1,077 ms** (warm 4–6 ms) |
| Execution-time constraint | Timeout 30 s, max 1 instance, concurrency 1 ("warm and cool never race"); finishes all work before responding; delays delegated to Cloud Tasks, never `sleep`; Google API calls 10 s timeout; 503 on transient errors so the platform retries | Timeout 10 s |
| **Execution measured** | event 1.15 s, warm 1.61 s, cool 2.08 s | ms |
| Evidence | `docs/evidence/e01-prewarming/`, `docs/evidence/faas-cold-start/` | `docs/evidence/e05-observability/` |

Lab 5's five FaaS phases fit both functions:

| Phase | How both functions meet it |
| ----- | -------------------------- |
| Granularity (SRP) | One responsibility each |
| Trigger and contract | An explicit trigger and contract |
| Externalized state | No state between invocations |
| Idempotency | Idempotent under redelivery |
| Resilience | Explicit timeouts and platform retries |

**The mock payment gateway** is also a Cloud Run function, but it is a **test double** and is not
counted (D-21). It has deterministic payment ids from the key, a 2 s webhook delay done as a named
Cloud Task rather than a sleep, and `FAULT_MODE` none/error/timeout. Its cold start is 2.8 s
(Firestore and Tasks gRPC SDKs), which misses the < 1 s target; this is documented.

### 5.3 Infrastructure as Code

**Tool.**
- Terraform ≥ 1.9 with provider `hashicorp/google ~> 7.0` (locked 7.46.1), plus `archive` and
  `random`.
- State lives in GCS `aforo-dev-teamf-tfstate`, versioned and locked.
- Default labels: app, env, owner.

**Organization.**
- `infra/envs/dev/` is the root, split by concern: network, database, services, functions,
  messaging, tasks, scheduler, secrets, monitoring, outputs, and `main` (IAM, Artifact Registry,
  functions bucket).
- `infra/modules/`:

  | Module | Provisions |
  | ------ | ---------- |
  | `cloud-run-service` | Runtime SA, secret IAM, service, probes, invoker IAM, optional migrate and seed jobs |
  | `cloud-function` | Runtime SA, placeholder source, gen2 function, invoker |
  | `cloud-sql` | Instance, databases, users, URL secrets |
  | `memorystore` | Instance (count = `enabled`) |
  | `pubsub-topic` | Topic, push subscriptions, a DLQ per subscription, IAM |

**What it provisions.** All of §3.2:
- Cloud Run services and jobs, functions, Eventarc triggers;
- Cloud SQL, Memorystore, Firestore;
- Pub/Sub, Cloud Tasks, Cloud Scheduler;
- VPC and subnet;
- Secret Manager with random passwords;
- 7 service accounts and IAM;
- Artifact Registry and buckets;
- the log metric, alert policy and notification channel.

**Lab 5 §6 parallel.** Terraform's dependency graph injects the function URL into its callers as
env vars, with no hard-coded endpoints:
- `PAYMENT_GATEWAY_URL = module.mock_payment_gateway.uri` (orders);
- `MOCK_PAYMENT_GATEWAY_URL` (gateway);
- `REDIS_URL = module.memorystore.url`.

**Who owns what** (ADR-0004).
- **Terraform owns config. CI owns the code (image or source) and the traffic.** The prewarmer owns
  the gateway and queue minimums. Terraform marks these as `ignore_changes`.
- Runtime switches are Terraform variables, changed only through `make`, never with a hand-run
  `apply` and never in the console:

  | Variable | Changed with |
  | -------- | ------------ |
  | `env_on` | `make up` / `make down` |
  | `redis_enabled` | `make redis-up` / `make redis-down` |
  | `mock_fault_mode` | `make fault MODE=` |

- CI `infra.yml` runs fmt, validate and plan on every PR.

**Honest exceptions.** These are bootstrapped outside Terraform, as documented in the
`infra/README.md` prerequisites:
- the project and enabled APIs;
- the state bucket;
- the WIF pool and the `github-ci` service account;
- the default auto-mode VPC.

### 5.4 Build and deployment

**Artifact (immutable).**
- One container image per unit, tagged with the **full git SHA**:
  `southamerica-east1-docker.pkg.dev/aforo-dev-teamf/aforo/<unit>:<sha>`.
- Artifact Registry tags are immutable.
- Every deploy references the **`@sha256` digest**, and a re-run reuses the existing digest.
- Functions ship as `gs://aforo-dev-teamf-functions/<fn>/<sha>.zip` in a versioned bucket, uploaded
  with `--no-clobber`.

**Pipeline** (GitHub Actions, reusable `_service.yml` and `_function.yml`, one workflow per unit
with path filters, WIF auth).
- The **check** job runs on every PR: `npm ci`, build `@aforo/common`, lint, test, `docker build`.
- Deploy runs on `workflow_dispatch` via `make deploy SERVICE=…`. Auto-deploy on merge is off.
- Contracts are linted (Redocly); infra is planned.

**Strategy: blue/green with Cloud Run revision tags** (D-19). Write the steps as a figure:
1. Point the migrate job at the new digest and run `aforo-<svc>-migrate --wait` (expand-only
   migrations).
2. Deploy the revision with `--no-traffic --tag sha-<short>`; this is the "green" revision.
3. Smoke-test the tag URL's `/health/ready` with an ID token, 5 tries × 5 s.
4. Shift traffic with `update-traffic --to-latest`. The previous revision ("blue") stays deployed.
5. Rollback is one `update-traffic --to-revisions <prev>=100` command, printed in the job summary.

**Evidence** (Oct 9, orders `1b8ce63`):
- Dispatch to 100 % took **3 min 6 s**: migrate 28 s, deploy 14 s, smoke < 1 s, shift 6 s.
- **Rollback took 8.3 s**; roll-forward took 5.6 s.
- The protection worked in practice. The Oct 8 orders image that could not boot (bug #38, revision
  `00005-zod`) **never received traffic**.
- Source: `docs/evidence/deployment/`.

Functions deploy all-at-once with no pre-traffic smoke test; say so. Rollback for a function is
also `update-traffic`.

**Schema and contract change sequencing.** The guide asks "if applicable". Source:
[build-and-deploy.md](../architecture/build-and-deploy.md) §schema changes.
- **Schema:** expand → migrate job with the new image *before* the revision exists → new code
  writes both and reads new → traffic shift → a later release contracts. Because the old revision
  still serves traffic during the migration, migrations must be backward compatible.
- **Contract:** compatible changes ship provider first, then consumers. Breaking changes ship as
  `/v2` or event `version: 2`, served in parallel.
- **Be honest:** the mechanism is wired and ran in every deploy (for example execution
  `aforo-orders-migrate-9q5s4`), but only with the initial schema. **No real expand/contract change
  was shipped.**
  - Option: describe a hypothetical worked example, such as adding a nullable column, then
    backfilling, then requiring it.
  - Better option, if time allows Sunday: ship one tiny real one.

### 5.5 Links

- Repository: https://github.com/Arquitectura-en-la-Nube-2026/aforo
- Deployed system: **not permanently public**. `dev` is off by default (D-11, E-07). State that the
  web URL is live during the demo (`make up` + `make redis-up`), and point to the recorded video.

---

## 6. Discussion and reflection

### 6.1 Design-to-construction rationale: where construction revealed gaps or errors

Present this as a table: earlier design → what construction showed → resolution.

1. **Redis as a Cloud Run container (plan D-15) was impossible.** Cloud Run has no raw TCP ingress,
   and a sidecar breaks statelessness. Construction landed on Memorystore created on demand
   (ADR-0001), which is what Entrega 3 TO-01/TO-02 had implied.
2. **The design assumed always-on CPU.** Three parts relied on it:
   - an outbox poller;
   - Entrega 2's "acknowledge the webhook now, process later";
   - a per-instance admission timer.

   Cloud Run throttles CPU between requests. That led to ADR-0002: flush after commit, housekeeping
   via Cloud Scheduler, a webhook that answers after processing, and one lock-guarded exception.
3. **Dual write between the reservation commit and the expiry task.** It could lock seats forever.
   The drafted expire statement also ignored Entrega 2's "expiry instant reached" guard. Fixed in
   ADR-0003: Cloud Tasks plus a sweep, and `expires_at <= now()`.
4. **Terraform and CI both wrote the same Cloud Run fields,** and the planned `gcloud` switches
   bypassed IaC. Fixed in ADR-0004 with a split ownership model and switches as Terraform variables.
5. **Connection budget** (E3 weakness W-03). db-f1-micro allows 25 connections, so instances ×
   pools had to be capped. Two more problems surfaced:
   - an in-memory breaker across instances made the demo non-deterministic;
   - the default Pub/Sub backoff and consumers that ack poison messages would miss E-05.

   All three were fixed in ADR-0005.
6. **The plan lacked FaaS, a circuit breaker, immutable artifacts and a deployment strategy,** all of
   which the Delivery 4 guide requires. This led to decisions D-16…D-21. Entrega 3 had rejected FaaS
   for services; D-21 reconciled that by using FaaS for the tactics instead.
7. **The 2 s timeout convention was too short at the gateway.** The orders payment path takes about
   6.5 s with retries, and the queue's cold start is about 3.2 s. Per-upstream timeouts were set
   instead: orders 15 s, queue 8 s, mock 10 s.
8. **The E-02 p95 ≤ 300 ms target is unreachable** under a simultaneous burst on the smallest DB
   (808 ms). It is reachable when admission is metered (75 ms). This is empirical support for the
   waiting room as an admission-control tactic, not only a UX feature.
9. **Delivery 1 E-06 (extend the expiry) contradicted RF-09.** It was corrected in Entrega 3
   (E3-ADR-03) and built that way.
10. **Deliberate deviations.** Each one, with its "way back", is in
    [target-vs-slice.md](../architecture/target-vs-slice.md):
    - D-06: simulated login;
    - D-07: queue pass never verified;
    - no Edge, CAPTCHA, issuance or notifications;
    - the mock gateway;
    - dev sizing.

### 6.2 Implementation challenges

These come from git history and the evidence.

- **#38** — the orders image could not boot. `class-validator` resolved only through a hoisted copy
  present on dev machines. Blue/green kept it from receiving traffic.
- **#39** — the gateway turned Orders' empty `text/html` 200 into a 500. Cloud Tasks retried 5×,
  and the inbox absorbed every retry (one `OrderPaid`). This was a real-world test of
  idempotency.
- **#40** — the queue's cold start (~3.2 s) exceeded the gateway's 2.5 s timeout, so the first join
  after a pause returned 500. Fixed with an 8 s timeout.
- **Breaker recovery.** The half-open probe hit a cold mock (2.8 s > 2 s) and re-opened once. It
  closed on the next probe. This is the "the provider did the work but we timed out" case.
- **Queue and SSE robustness.** Fixes included:
  - streams leaking past the shutdown drain;
  - a CRLF split across chunks that lost an admission;
  - the pass being kept per tab instead of per buyer;
  - projection and inbox writes made atomic.
- **Operations.** Memorystore takes about 10 min to create. Cloud SQL start-up made the seed retry.
  A Terraform permanent diff appeared on the scheduler retry config. `make deploy` sometimes
  watched the wrong run.
- **Process.**
  - No one can run the full stack locally (D-10), so every integration loop went through cloud
    deploys.
  - The contract freeze plus Prism mocks let six fronts work in parallel.
  - The orders owner was never added to the GitHub organization.
  - Ownership concentrated in Platform: 75 of 156 commits landed on Oct 5.

### 6.3 Quality attribute verification

For each scenario, give the target, the measured value, the verdict and the method. Be explicit
about partial results. Everything ran on `dev`, Oct 8–9.

| Scen. | Target (E3) | Measured | Verdict | How verified / evidence |
| ----- | ----------- | -------- | ------- | ----------------------- |
| E-01 | Warm before opening; no cold start in first minute; (3,000 users, p95 ≤ 2 s) | Gateway and queue 0 → 1 **3 s after publish**, 3 min before opening; first join at opening **550 ms vs 4,070 ms cold**; back to 0 at close | **Met at slice level.** The load measure is not verified (no load test; min 1 instead of 2–3) | `e01.cjs`, `minimums.log` — `docs/evidence/e01-prewarming/` |
| E-02 | Overselling 0; p95 ≤ 300 ms | Burst of 200 through the gateway: **10 created / 190 SOLD_OUT, 0 oversold**, inventory p95 **808 ms**. Metered 20/s: 0 oversold, p95 **75 ms**. Local: p95 169 ms. A mutation check fails if the guard is removed | **Integrity met; latency met only when metered** | `e02-gateway.cjs`, `run-dev.json` — `docs/evidence/e02-concurrency/` |
| E-05 | DLQ alert ≤ 5 min; purchase traceable by correlationId | Poison message → 3 consumers × 5 attempts → dead letter at **+1 min 36 s** → incident and email at **+3 min 30 s**. One purchase traced end to end | **DLQ alert met.** Error-rate alert ≤ 60 s and distributed tracing not built | `docs/evidence/e05-observability/` (screenshots) |
| E-06 | Fail fast ≤ 50 ms when open; 0 double charges; recovers without deploy | Opened on the 5th failure; open-circuit calls **9.5–10.3 ms in orders**; closed after `MODE=none`; payment then 201 | **Met** | `e06.cjs`, `run.log` — `docs/evidence/e06-circuit-breaker/` |
| Expiry (reliability) | Seats return at TTL; order EXPIRED; no background process | 10 reservations expired by Cloud Tasks within ~2.8 s of `expiresAt`; seats 0 → 10; orders EXPIRED | **Met** (the sweep was not exercised) | `docs/evidence/reliability-expiry/` |
| E-07 | Idle ≤ 15 USD/month; total ≤ 50 USD/month | Off state verified (Cloud SQL STOPPED, no Redis, schedulers paused, min 0). Memorystore estimated at ~US$1–2/day when on | **Partial — billing numbers pending** | `docs/evidence/e07-cost/` |
| E-03 | 99.9 %, recovery ≤ 60 s | Health checks only | **Not demonstrated** (single-zone DB) | — |
| E-08 | WAF and token scenarios | Not run | **Not demonstrated** (no Edge) | — |
| FaaS | Cold start < 1 s | prewarmer 543 ms; dlq-monitor 1,077 ms | Met for prewarmer; dlq-monitor slightly over (latency does not matter for an alert path) | `docs/evidence/faas-cold-start/` |
| Happy path | Steps 1–10 of the acceptance script | Paid **4.7 s** after clicking Pay; General 198 → 196; one correlationId across services; `OrderPaid` published once | **Met** | `purchase.cjs` + 12 screenshots — `docs/evidence/happy-path/` |
| Fails well | SOLD_OUT, LIMIT_EXCEEDED, idempotent replay, duplicate webhook | All four as specified, nothing decremented on failure | **Met** | `docs/evidence/fails-well/` |

**Method.**
- Scripted Node and Playwright runs against `dev`.
- Server-side latencies taken from Cloud Run `httpRequest.latency` in Cloud Logging.
- Logs and screenshots stored under `docs/evidence/`.
- Each run is single and on the smallest sizing. Say so: these are proofs of mechanism, not
  load-test statistics.

### 6.4 Cloud-native evaluation (critical, about the running system)

Argue both sides.

**Strong:**
- Stateless containers on managed compute with scale to zero.
- Managed data and messaging; no VMs or clusters.
- Everything in Terraform, with environment on/off as a code change.
- Immutable artifacts with blue/green and an 8 s rollback.
- At-least-once messaging made safe by the outbox, inbox and idempotency keys.
- Design that accepts platform behavior instead of fighting it: CPU throttling (ADR-0002),
  instance churn (idempotency is persisted, not held in memory), cold starts (the prewarmer).
- **Cost follows use:** the environment is off unless a person turns it on (RN-03, E-07).
- FaaS used where its profile fits, not everywhere.

**Weak or not cloud-native yet:**
- Single zone with no failover (E-03).
- No edge, WAF or identity provider (E-08).
- No tracing.
- An in-memory breaker caps orders at 1 instance.
- One shared DB instance.
- Elasticity proven only at minimum scale (no load test).
- Functions deploy with no pre-traffic smoke test.
- The CI service account is project Owner.

**Verdict to argue:** cloud-native in its *construction* (12-factor, IaC, managed, elastic,
disposable, observable by correlation). Partially cloud-native in its *operational guarantees*:
availability, security at the edge, and load-proven elasticity were sized out for budget (RN-01,
≤ 50 USD/month). Every one of them has a written way back in
[target-vs-slice.md](../architecture/target-vs-slice.md).

### 6.5 Lessons learned

**Technical:**
- The platform's runtime model (CPU throttling, instance churn, no raw TCP) shapes the design more
  than the diagrams did. Validate the design against it before building.
- Idempotency and the inbox were proven by a real bug (#39), not only by tests.
- Load tactics need load to be proven. The E-02 numbers show why the waiting room exists.
- Splitting the IaC/CI ownership early avoids drift.

**Organizational:**
- Contract-first with mocks made parallel work possible.
- The plan predated the guide, so FaaS, the breaker and blue/green arrived late (D-16…D-21). Read
  the final rubric first.
- Ownership concentrated in one front, which is a bus-factor risk.
- No local full stack slowed integration.

---

## 7. Graded prototype items → evidence (checklist for the PDF and the demo)

| Item (guide §3.3) | Evidence to show | Live demo? |
| ----------------- | ---------------- | :--------: |
| End-to-end scenario | `docs/evidence/happy-path/` (12 screenshots) + video (**pending**) | Yes |
| Architectural style and patterns | §3.4 pattern map → code paths; Pub/Sub topology in console | Show code |
| Quality attribute tactics | E-06 breaker (`make fault MODE=timeout`), E-02 run, expiry, E-01 prewarm, E-05 poison | Yes (runbook) |
| Multiple persistence paradigms | Cloud SQL (3 DBs) + Memorystore + Firestore | Console |
| FaaS component | `prewarmer`, `dlq-monitor` logs and minimums | Yes |
| Containers + IaC | Artifact Registry digests, revision list with tags, `terraform plan` of `make redis-up` | Console / terminal |

---

## 8. Figures to produce (none exist yet in final form)

1. Logo (existing PNG).
2. C&C view: the target (existing PNG) and the slice, with the functions (new).
3. Deployment view of the slice on GCP (new). The target is in the existing PNGs.
4. Sequence diagram of the happy path (from `overview.md` mermaid) and of the saga branches.
5. State diagrams: Reservation, Order, Payment, Queue entry (from `state-machines.md`).
6. ER diagrams for catalog, inventory and orders, plus a Redis key table.
7. Blue/green pipeline flow (check → build → migrate → no-traffic tag → smoke → shift → rollback).
8. Evidence screenshots: correlation trace, breaker logs, DLQ incident and email, prewarm minimums.

---

## 9. Do NOT overclaim (honest answers for the presentation too)

- **E-02 latency** is met only when metered: 808 ms in a burst against 75 ms metered. Integrity (0
  oversold) is met.
- **E-01:** minimum 1 instance, not 2–3, and no 3,000-user load test.
- **E-03 and E-08** are not demonstrated. **E-04** was dropped in Entrega 3.
- **E-05:** only the DLQ alert exists. There is no error-rate alert and no tracing. The alert closes
  30 min later, not on recovery.
- **E-06:** jitter is cockatiel's default (decorrelated), not explicitly tuned. The 0.5 s connect
  timeout is configured but not separately measured.
- **E-07:** no billing numbers yet.
- **Contracts** are linted, not contract-tested against deployed revisions. `e2e/` contains only a
  README.
- **Expand/contract** is wired, but no real migration was shipped beyond `001_init.sql`.
- **The queue pass is never verified downstream (D-07).** Reserving without the queue works.
  Inventory also does not check the sale window. The waiting room is enforced by the UI only. This
  is the most likely critical question; RD-04 is not met.
- **Login is simulated (D-06).** RF-18 and RT-03 are partial.
- **Firestore** backs only the test double.
- **Not built:** CAPTCHA (RF-24), ticket issuance (RF-15), notifications (RF-13), the organizer UI.
  `OrderPaid` has no consumer.
- **CI:** `packages/common` tests do not run in CI. The `github-ci` service account is project
  Owner (accepted for the prototype).
- **Known edge cases** (open questions):
  - Inventory confirms a payment approved after `expires_at` if the expiry has not run yet.
  - A crash between reserve and order insert can leave a PENDING_PAYMENT order that can never be
    paid.

---

## 10. Before submitting (decisions and loose ends)

- [ ] **E-07 billing screenshots** (billing lags a day; Oct 10 or later).
- [ ] **Recorded video** plus a **dress rehearsal** from a cold `make up`.
- [ ] Decide whether to ship one real **expand/contract** migration, or describe a hypothetical one.
- [ ] Choose the **full ADR** for §3.5. Recommended: ADR-0001.
- [ ] Draw the new figures listed in §8.
- [ ] Optional quick doc fixes found while compiling this brief:
  - [build-and-deploy.md](../architecture/build-and-deploy.md) claims a function smoke test that
    `_function.yml` does not have;
  - [target-vs-slice.md](../architecture/target-vs-slice.md) says only the queue uses the VPC, but
    the gateway does too;
  - [state-machines.md](../architecture/state-machines.md) does not draw EXPIRED → REFUND_PENDING;
  - `contracts/events/README.md` says the mock has no database, but it uses Firestore.
- [ ] `make down` after the last demo.
