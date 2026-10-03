# Developer guide — where to read, where to work

One page per front: what to read before writing code, which folders are yours, what you depend
on, and what you must hand over. If something here disagrees with a contract in `contracts/`,
the contract wins.

## Everyone, first day

1. `nvm use` (Node 24), then `npm install` at the root.
2. Read, in this order (≈ 30 min):
   1. [plan/scope.md](plan/scope.md) — what we build and what we don't.
   2. [architecture/overview.md](architecture/overview.md) — components and the happy path.
   3. [../contracts/conventions.md](../contracts/conventions.md) — rules every unit follows.
   4. [plan/acceptance.md](plan/acceptance.md) — Definition of Done and the demo script.
   5. [plan/team-and-schedule.md](plan/team-and-schedule.md) — your dates.
   6. [architecture/glossary.md](architecture/glossary.md) — English names for the Spanish design terms.
3. Skim [plan/delivery-4.md](plan/delivery-4.md) and
   [plan/delivery-4-decisions.md](plan/delivery-4-decisions.md): they explain why some things
   differ from the original plan (FaaS, circuit breaker, blue/green).
4. Read the [ADR index](adr/README.md). Two records change how **every** service is written:
   [ADR-0002](adr/0002-work-happens-inside-a-request.md) (no work outside a request: flush the
   outbox after commit, housekeeping endpoint) and
   [ADR-0004](adr/0004-terraform-owns-config-ci-owns-code.md) (probes on `/health/live`: boot
   without your DB; config is Terraform's).
5. Then go to your section below.

## How we work (all fronts)

| Step | Rule |
| ---- | ---- |
| Branch | `<name>/<short-topic>` from `main`, e.g. `luis/reservation-tx` |
| Scope of a PR | One unit (one folder). Contract changes in their own PR |
| Commits | Conventional Commits with the unit as scope: `feat(inventory): …` |
| Before pushing | `npm run lint && npm test` in your unit; `make lint-contracts` if you touched `contracts/` |
| PR | Fill the template (DoD checklist). CODEOWNERS assigns owner + backup as reviewers |
| Merge | Green CI + one approval. `main` must stay deployable; whoever breaks it fixes it first |
| Daily | Async note before 10 pm: done / next / blocked |
| Shared `dev` | Announce `make down`; last one out turns it off; debug consumers with your own subscription (suffix = your initials) |
| Working against others | `make mock SERVICE=<name>` runs a Prism mock of any contract on `:4010` |
| Using Claude Code | Open it inside your folder: its `CLAUDE.md` loads your spec, contract and rules automatically |

---

## Julián (`@djguzmanc`) — Platform, deployment and operations

**You work in:** `infra/`, `.github/workflows/`, `Makefile`, `e2e/`, `docs/runbooks/`,
`functions/dlq-monitor/`, `functions/prewarmer/`.

**Read:**
- [../infra/README.md](../infra/README.md) — resources, modules, service accounts
- [architecture/build-and-deploy.md](architecture/build-and-deploy.md) — immutable artifacts, blue/green, migrations
- [../.github/workflows/README.md](../.github/workflows/README.md) — workflows to build
- [../contracts/events/README.md](../contracts/events/README.md) — exact topic, subscription, DLQ and queue names
- [../functions/dlq-monitor/README.md](../functions/dlq-monitor/README.md) and
  [../functions/prewarmer/README.md](../functions/prewarmer/README.md) — the two FaaS components (D-21)
- [runbooks/](runbooks/) — the two runbooks you own
- Rules: `.claude/rules/infra.md`, `.claude/rules/functions.md`

**You unblock everyone.** By Tue Sept 29: GCP access for all, CI green, `make up`/`make down`,
one service deployed with the blue/green pipeline.

**Hand over:** Terraform for every resource (ADR-0001, 0004, 0005), CI/CD per unit,
`make up/down/redis-up/redis-down/seed/deploy/fault/poison/status`,
DLQ alert, pre-warmer, e2e suite, demo runbook.

---

## Juan José (`@JuanjMedina`) — Gateway, contracts, common library, catalog

**You work in:** `contracts/`, `packages/common/`, `services/gateway/`, `services/catalog/`.

**Read:**
- [../contracts/README.md](../contracts/README.md) — **open points you must close before the freeze**
- [plan/decisions.md](plan/decisions.md) — R-01…R-05 need your confirmation
- [../packages/common/README.md](../packages/common/README.md) — modules every service expects
- [../services/gateway/README.md](../services/gateway/README.md) — routing table and rules
- [../services/catalog/README.md](../services/catalog/README.md) — endpoints, outbox, seed
- Rules: `.claude/rules/contracts.md`, `.claude/rules/services.md`

**You unblock everyone.** By Tue Sept 29: contracts frozen, `@aforo/common` published (core +
`nest` entry points), Prism mocks working. After that you are the arbiter of every contract change.

**Hand over:** frozen contracts, `@aforo/common`, gateway with simulated login and routing,
catalog with idempotent seed (three demo events, one `OPEN`) by Wed Sept 30.

---

## Sergio (`@SergioR-02`) — Purchase frontend

**You work in:** `apps/web/` (every screen except `/events/:id/queue`).

**Read:**
- [../apps/web/README.md](../apps/web/README.md) — screens, client rules, suggested layout
- [../contracts/openapi/](../contracts/openapi/) — `gateway`, `catalog`, `inventory` (availability), `orders`
- [../contracts/conventions.md](../contracts/conventions.md) — errors by `code`, idempotency, headers
- [architecture/state-machines.md](architecture/state-machines.md) — order statuses you display
- Rules: `.claude/rules/frontend.md`

**Depends on:** mocks from Tue Sept 29 (`make mock SERVICE=catalog` etc.); real Gateway from Wed Sept 30.
Coordinate with Cristian on the shared session store and the queue → buy hand-off (`passToken`).

**Hand over:** login, catalog, detail, buy, pay, my orders, error handling by `code` with visible
`correlationId`, SSR deployment.

---

## Cristian (`@CristianMontane`) — Waiting room, end to end

**You work in:** `services/queue/` and `apps/web/src/app/features/queue/`.

**Read:**
- [../services/queue/README.md](../services/queue/README.md) — ordering (RF-05), admission, pass, Redis keys
- [../contracts/openapi/queue.yaml](../contracts/openapi/queue.yaml) — including the SSE format
- [../contracts/events/](../contracts/events/README.md) — `EventPublished`, `SalesRulesConfigured` (your projection)
- [architecture/state-machines.md](architecture/state-machines.md) — queue entry
- [../apps/web/README.md](../apps/web/README.md) — client rules for the pass and countdown
- Rules: `.claude/rules/services.md`, `.claude/rules/frontend.md` (for the screen)

**Depends on:** a local Redis (`docker run --rm -p 6379:6379 redis:7`) to develop; Memorystore in
`dev` only during live tests (`make redis-up`, ADR-0001); catalog events (Juan José). Start first (Mon Sept 28):
most domain logic. Decide early if SSE survives Cloud Run; plan B is polling `status` every 3 s.

**Hand over:** queue service with SSE, admission job, projection, and the queue screen.

---

## Daniel Felipe (*pending GitHub invite*) — Orders & checkout + mock payment gateway

**You work in:** `services/orders/`, `functions/mock-payment-gateway/`.

**Read:**
- [../services/orders/README.md](../services/orders/README.md) — saga, webhook, **payment adapter resilience policy**
- [../functions/mock-payment-gateway/README.md](../functions/mock-payment-gateway/README.md) — FaaS rules, fault injection
- [../contracts/openapi/orders.yaml](../contracts/openapi/orders.yaml) and [mock-payment-gateway.yaml](../contracts/openapi/mock-payment-gateway.yaml)
- [../contracts/openapi/inventory.yaml](../contracts/openapi/inventory.yaml) — the internal API you call
- [architecture/state-machines.md](architecture/state-machines.md) — Order and Payment
- [architecture/overview.md](architecture/overview.md) — saga branches table
- Rules: `.claude/rules/services.md`, `.claude/rules/functions.md`

**Depends on:** Inventory `confirm`/`expire` real by Thu Oct 1 — until then use
`make mock SERVICE=inventory`.

**Hand over:** saga with every branch, webhook with HMAC + inbox, circuit breaker demo
(`make fault`), mock function with page, delayed signed webhook and refunds.

---

## Luis Esteban (`@luleonr`) — Inventory & reservations

**You work in:** `services/inventory/`.

**Read:**
- [../services/inventory/README.md](../services/inventory/README.md) — the reservation transaction step by step
- [../contracts/openapi/inventory.yaml](../contracts/openapi/inventory.yaml)
- [../contracts/events/](../contracts/events/README.md) — projection inputs, `ReservationExpired`, Cloud Tasks queue
- [architecture/state-machines.md](architecture/state-machines.md) — Reservation (confirm vs. expire race)
- Rules: `.claude/rules/services.md`

**Others depend on you:** Orders needs `confirm`/`expire` by Thu Oct 1, plus the local
`ExpiryScheduler` dispatcher.

**Hand over:** reservation transaction, confirm/release/expire, Cloud Tasks integration, outbox,
and the **non-cuttable** concurrency test (200 requests, 10 seats → exactly 10).

---

## Where do I put…?

| Thing | Place |
| ----- | ----- |
| A new endpoint | First in `contracts/openapi/<unit>.yaml` (PR to Juan José), then the code |
| A new event or field in an event | `contracts/events/` (same process) |
| A helper more than one service needs | `packages/common/` |
| A GCP resource | `infra/` (never the console) |
| A decision others must know | `docs/adr/NNNN-title.md` + a line in the ADR index + the rule it changes |
| Something that must run periodically | Your service's `POST /internal/v1/housekeeping`, never a timer |
| An environment toggle | A Terraform switch driven by a `make` target, never `gcloud` |
| An env variable | Your unit's `.env.example` + README "Configuration" |
| A DB table or column | `services/<unit>/migrations/` (expand/contract) |
| A test of the acceptance script | `e2e/` |
