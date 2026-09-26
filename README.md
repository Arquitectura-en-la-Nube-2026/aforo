# Aforo

Ticketing platform for mass events (concerts, festivals, sports). This repository holds the
**Delivery 4 prototype** (due Mon Oct 12, 2026): a single purchase happy path, fully deployed on
Google Cloud. Team F — Cloud-Based Software Engineering 2026-II, Universidad Nacional de Colombia.

> A buyer logs in, browses the catalog, joins the waiting room, gets admitted, reserves seats,
> pays against a mock gateway and sees the order as paid. Nothing else is built.

## Start here

| If you want to know…                           | Read                                                         |
| ---------------------------------------------- | ------------------------------------------------------------ |
| What we build, what we don't, and why          | [docs/plan/scope.md](docs/plan/scope.md)                     |
| Decisions (D-01 … D-20) and proposals          | [docs/plan/decisions.md](docs/plan/decisions.md)             |
| Who owns what and the day-by-day schedule      | [docs/plan/team-and-schedule.md](docs/plan/team-and-schedule.md) |
| When something is "done" + the acceptance demo | [docs/plan/acceptance.md](docs/plan/acceptance.md)           |
| **New to the repo? Where do I work?**          | [docs/developer-guide.md](docs/developer-guide.md)           |
| How we meet each Delivery 4 requirement        | [docs/plan/delivery-4.md](docs/plan/delivery-4.md)           |
| Why the plan changed for Delivery 4            | [docs/plan/delivery-4-decisions.md](docs/plan/delivery-4-decisions.md) |
| Lifecycle state machines                       | [docs/architecture/state-machines.md](docs/architecture/state-machines.md) |
| Build artifacts and deployment strategy        | [docs/architecture/build-and-deploy.md](docs/architecture/build-and-deploy.md) |
| How the pieces talk to each other              | [docs/architecture/overview.md](docs/architecture/overview.md) |
| Rules every service must follow                | [contracts/conventions.md](contracts/conventions.md)         |
| The exact API / event contract of a service    | [contracts/](contracts/)                                     |
| What *your* unit must do                       | `services/<name>/`, `functions/<name>/` or `apps/web/` README |

## Repository layout

```
aforo/
  apps/web/             Angular 20 SSR frontend
  services/gateway/     API Gateway + simulated login
  services/catalog/     Events, sectors, sales rules + idempotent seed
  services/queue/       Waiting room and admission (Redis)
  services/orders/      Orders, checkout saga, payment adapter (circuit breaker)
  services/inventory/   Availability and reservations
  functions/mock-payment-gateway/   FaaS: stand-in for the payment gateway, with fault injection
  functions/dlq-monitor/            FaaS: dead-letter alerting
  packages/common/      @aforo/common: envelope, outbox, inbox, errors, auth, logs, health
  contracts/            OpenAPI per service + JSON Schemas for events (source of truth)
  infra/                Terraform (everything in GCP is declared here)
  e2e/                  End-to-end tests of the acceptance script
  docs/                 Plan, architecture, ADRs, runbooks
  Makefile              up, down, seed, deploy, mock
```

## Everyday commands

```bash
make help                       # list targets
make mock SERVICE=inventory     # run a Prism mock of a service contract on :4010
make lint-contracts             # validate every OpenAPI file
make up / make down             # turn the dev environment on / off (see runbook)
make redis-up / redis-down      # Memorystore for the queue: only for live tests and demos
make status                     # current environment switches
make fault MODE=timeout         # inject payment-gateway failures (circuit breaker demo)
```

Requires **Node 24** (`nvm use`). Each unit runs on its own with `npm run dev` against the cloud
`dev` dependencies. Nobody runs the full stack locally (D-10).

## Language

Everything in this repository — code, comments, docs, commit messages, PRs — is written in
**English**. The design deliverables (Entregas 1–3) are in Spanish; see the glossary in
[docs/architecture/glossary.md](docs/architecture/glossary.md) for the name mapping.
