# Runbook · Turning the `dev` environment on and off

> Owner: Platform (Julián). Due Tue Sept 29. Status: **draft — commands exist, Terraform pending**.

Everything below is a Terraform apply of the runtime switches (ADR-0004). Never change these
resources with `gcloud` or the console, and never run `terraform apply` by hand.

## The three states

| State | Command | What exists / runs | Cost |
| ----- | ------- | ------------------ | ---- |
| **Off** | `make down` | Cloud SQL stopped, no Memorystore, housekeeping jobs paused, fault reset to `none` | Disk + storage only |
| **On** | `make up` | Cloud SQL running, housekeeping every minute, seed run. Queue without Redis (answers `500`) | Cloud SQL hours |
| **Demo** | `make redis-up` | On + Memorystore + queue subscriptions, seed re-run | + ≈ US$1–2/day |

`make status` prints the current switches. `make up` keeps Redis as it is; `make down` turns
everything off.

## Rules
- Announce `make down` and `make redis-down` in the team channel before running them: they
  affect everyone.
- Turn Memorystore on only for live tests, e2e runs, recording and the presentation (ADR-0001).
- Last one to finish turns everything off. Check the billing dashboard every Friday.

## `make up`
1. Terraform: `env_on = true` → Cloud SQL `ALWAYS`, Cloud Scheduler jobs resumed.
2. Wait for `/health/ready` of catalog, orders and inventory (DB checks).
3. Run the idempotent catalog seed (re-emits events; Inventory rehydrates its projection).

## `make redis-up` (≥ 15 minutes before a live test or demo)
1. Terraform: `env_on = true`, `redis_enabled = true` → Memorystore instance (several minutes,
   up to ~10), `queue-*` subscriptions + DLQs, `REDIS_URL` on `queue` (new revision).
2. Run the seed again, so Queue builds its projection in the new, empty Redis.
3. Check `queue` `/health/ready` = 200 and that `GET /api/v1/queue/{eventId}/status` answers.

## `make redis-down`
Terraform: `redis_enabled = false` → Memorystore and the queue subscriptions are destroyed,
`REDIS_URL` emptied. Queue positions are lost (acceptable, ADR-0001).

## `make down`
Terraform: `env_on = false`, `redis_enabled = false`, `mock_fault_mode = none` → Cloud SQL
`NEVER` (data survives; only disk is billed), Memorystore destroyed, scheduler paused. Cloud Run
services and functions need nothing: they scale to zero.

## `make fault MODE=none|error|timeout`
Terraform updates `FAULT_MODE` on `mock-payment-gateway`; a new revision takes traffic in about
a minute. Always leave it at `none` (`make down` resets it).

## Verify
- TODO: exact commands, expected output, how long each step takes (measure on Thu Oct 1).

## Troubleshooting
- A service doesn't answer after `make up`: its DB was still starting; `/health/live` is 200 and
  `/health/ready` recovers within a minute.
- Queue answers `500 INTERNAL` "queue store not available": Memorystore is off → `make redis-up`.
- `make` fails at `tf-state`: Terraform can't read the state (auth or network). Fix that first;
  the targets refuse to guess the switches.
- TODO
