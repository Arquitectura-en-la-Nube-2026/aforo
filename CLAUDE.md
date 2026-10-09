# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What this is

Aforo is a ticketing platform. This repo is the **Delivery 4 prototype of one purchase happy
path** (login → catalog → waiting room → reserve → mock payment → paid order), deployed on GCP
(`aforo-dev-teamf`, `southamerica-east1`). Five NestJS services and one Next.js SSR app on Cloud Run,
two FaaS components (Cloud Run functions: `prewarmer`, `dlq-monitor`, D-21), Pub/Sub, Cloud Tasks, Cloud Scheduler, Cloud SQL, and
Memorystore for Redis created only for live tests and demos (ADR-0001).
Node 24. Deadline: **Mon Oct 12, 2026**. Requirement-by-requirement map: `docs/plan/delivery-4.md`.

## Before you change anything

1. Identify which folder you are in and read its `README.md` — it is the spec for that unit.
2. Read the contract it implements in `contracts/` (OpenAPI or event schema). **The contract wins**
   over any README, comment, or code. If they disagree, the code is wrong or the contract must be
   changed through its owner (see `.claude/rules/contracts.md`).
3. Check scope in `docs/plan/scope.md`. Nothing enters scope unless it appears in the acceptance
   script (`docs/plan/acceptance.md`). Do not build "half" of an out-of-scope feature.

## Hard rules (summary — details in `.claude/rules/`)

- **English only**: code, identifiers, comments, logs, docs, commits, PRs.
- **Stay in your folder.** A PR touches one unit (`services/<x>`, `functions/<x>`, `apps/web`,
  `infra`, `packages/common`, `contracts`) unless it is an agreed cross-cutting change.
- **No service reads another service's database.** Data crosses boundaries via REST or events.
- **Cross-cutting behavior comes from `@aforo/common`** (errors, correlation ID, idempotency,
  outbox, inbox, envelope, logging, health). Never re-implement it locally.
- Public routes under `/api/v1`, internal routes under `/internal/v1`. Breaking change = new `/v2`.
- Errors are always `application/problem+json` with an agreed `code`.
- Money is integer cents + `currency: "COP"`. Dates are ISO-8601 UTC. IDs are UUID v4 strings.
- Every state-changing endpoint honors `Idempotency-Key`.
- Events are published **only** through the transactional outbox (`OutboxPublisher.flush()` after
  commit, plus housekeeping), never by calling Pub/Sub directly.
- **No work outside a request**: Cloud Run throttles CPU between requests. No timers, no pollers,
  no "respond now, process later"; periodic work goes in `/internal/v1/housekeeping` (ADR-0002).
  The one exception is the queue's admission tick (CPU always allocated, a Redis lock per tick, ADR-0002).
- Every GCP resource is declared in Terraform under `infra/`. Nothing is created in the console.
  Terraform owns config, CI owns code and traffic; environment switches only via `make` (ADR-0004).
- Lifecycle entities follow `docs/architecture/state-machines.md`; transitions are conditional updates.
- Services are stateless and shut down gracefully on `SIGTERM`. Functions finish all work before
  responding and keep cold start small (no NestJS).
- Artifacts are immutable (git SHA, deploy by digest); releases are blue/green (D-19).
- `main` is always deployable. No merge without green CI and one reviewer.

## Where things live

| Need                                   | Path                                  |
| -------------------------------------- | ------------------------------------- |
| Who works where, what to read          | `docs/developer-guide.md`             |
| Scope, decisions, schedule, acceptance | `docs/plan/`                          |
| Why Delivery 4 changed the plan        | `docs/plan/delivery-4-decisions.md`   |
| Architecture, flows, glossary          | `docs/architecture/`                  |
| State machines                         | `docs/architecture/state-machines.md` |
| Build & deployment strategy            | `docs/architecture/build-and-deploy.md` |
| FaaS components                        | `functions/<name>/`                   |
| Cross-service conventions (normative)  | `contracts/conventions.md`            |
| REST contracts                         | `contracts/openapi/<service>.yaml`    |
| Event contracts                        | `contracts/events/`                   |
| Terraform                              | `infra/`                              |
| Runbooks (up/down, demo)               | `docs/runbooks/`                      |
| Decision records (implementation)      | `docs/adr/` (index in its README)     |
| Map of everything, with the reasoning  | `docs/atlas/index.html` (Platform Atlas) |
| What ran on `dev`, with numbers        | `docs/evidence/`                      |

## Commands

```bash
make help
make mock SERVICE=<gateway|catalog|queue|orders|inventory|mock-payment-gateway>   # Prism on :4010
make lint-contracts
make up | make down | make seed | make deploy SERVICE=<name>
make redis-up | make redis-down         # Memorystore for the queue: live tests and demos only
make fault MODE=<none|error|timeout>    # E-06 demo (Terraform switch, ~1 min)
make poison TOPIC=<topic>               # E-05 DLQ demo
```

Inside a service: `npm run dev`, `npm test`, `npm run lint` (to be defined by each owner with
the same script names).

## Known, deliberate gaps (do not "fix" without a decision)

- The queue pass (`X-Queue-Pass`) is forwarded and logged but **never verified** downstream (D-07).
- Login is simulated by the Gateway (HS256 JWT, no password) (D-06).
- No Edge/CDN/WAF/CAPTCHA, no ticket issuance, no notifications in this slice.
- The payment gateway is a mock (a Cloud Run function, but a test double, not one of the FaaS
  components) with deliberate fault injection.
- `OrderPaid` is published but nobody consumes it.
