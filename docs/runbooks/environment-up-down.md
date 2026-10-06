# Runbook · Turning the `dev` environment on and off

> Owner: Platform (Julián). Status: **in use** — every command below has been run against `dev`.

Project `aforo-dev-teamf`, region `southamerica-east1`. Everything below is a Terraform apply of
the runtime switches (ADR-0004). Never change these resources with `gcloud` or the console, and
never run `terraform apply` by hand: it would reset every switch to its default.

## Prerequisites (once per laptop)

```bash
brew install --cask gcloud-cli                 # gcloud
# Terraform ≥ 1.9 on PATH (hashicorp/tap, or the release binary in ~/.local/bin)
gcloud auth login
gcloud auth application-default login           # credentials Terraform uses
gcloud config set project aforo-dev-teamf
gh auth login                                    # only for make deploy
```

Terraform state lives in `gs://aforo-dev-teamf-tfstate` (versioned). Two applies can't run at
the same time: the second waits for the state lock.

## The three states

| State | Command | What exists / runs | Cost |
| ----- | ------- | ------------------ | ---- |
| **Off** | `make down` | Cloud SQL stopped, no Memorystore, housekeeping jobs paused, fault reset to `none` | < US$1/month (Cloud SQL disk, storage) |
| **On** | `make up` | Cloud SQL running, housekeeping every minute, seed run. Queue without Redis (answers `500`) | + ≈ US$0.30/day (Cloud SQL `db-f1-micro`) |
| **Demo** | `make redis-up` | On + Memorystore + `queue-*` subscriptions, seed re-run | + ≈ US$1–2/day (Memorystore) |

Cloud Run services and functions scale to zero in every state and cost nothing while idle.
A budget alert on the billing account fires at 50 / 90 / 100 % of COP 80,000 (≈ US$20).

```bash
make status    # env_on=… redis_enabled=… mock_fault_mode=…
make plan      # what an apply would change, with the current switches
```

## Rules

- Announce `make down` and `make redis-down` in the team channel before running them: they
  affect everyone.
- Turn Memorystore on only for live tests, e2e runs, recording and the presentation (ADR-0001).
- Last one to finish runs `make down`. Check the billing dashboard every Friday.
- After merging an `infra/` PR, the Platform owner runs `make apply` from an up-to-date `main`
  and confirms the plan by hand. CI only plans (`infra.yml`).

## `make up`

1. Terraform: `env_on = true` → Cloud SQL `ALWAYS`, Cloud Scheduler jobs resumed.
2. Runs `make seed` (idempotent catalog seed; re-emits events so projections rebuild).
   Until catalog ships it, this prints `WARNING: seed not implemented yet … skipping` — expected.

Starting a stopped Cloud SQL instance takes a few minutes; `/health/ready` of catalog, orders and
inventory turns 200 once it accepts connections.

**First time a database or DB user is added:** apply it with `make up`, not `make apply`.
Cloud SQL can only create databases and users while the instance runs.

## `make redis-up` (≥ 15 minutes before a live test or demo)

1. Terraform: `env_on = true`, `redis_enabled = true` → Memorystore `aforo-queue` (several
   minutes, up to ~10), `queue-*` subscriptions + DLQs, `REDIS_URL` on `queue` (new revision).
2. Runs the seed again, so Queue builds its projection in the new, empty Redis.
3. Check `queue` `/health/ready` = 200 and that `GET /api/v1/queue/{eventId}/status` answers.

Not exercised yet: the first `make redis-up` also proves Direct VPC egress from `queue` in
`southamerica-east1` (ADR-0001 risk).

## `make redis-down`

Terraform: `redis_enabled = false` → Memorystore and the queue subscriptions are destroyed,
`REDIS_URL` emptied. Queue positions are lost (acceptable, ADR-0001).

## `make down`

Terraform: `env_on = false`, `redis_enabled = false`, `mock_fault_mode = none` → Cloud SQL
`NEVER` (data survives; only disk is billed), Memorystore destroyed, scheduler paused.

## `make fault MODE=none|error|timeout`

Terraform updates `FAULT_MODE` on `aforo-mock-payment-gateway`; a new revision takes traffic in
about a minute. Always leave it at `none` (`make down` resets it).

## `make deploy SERVICE=<unit>`

Starts the unit's CI workflow on `main` and waits for it: the same immutable artifact and
blue/green path as a merge (D-19). Units: `gateway catalog queue orders inventory web`,
`dlq-monitor prewarmer mock-payment-gateway`. Deploys on merge stay off until the team turns
them on (`gh variable set DEPLOY_ON_MERGE --body true`).

Services with a database smoke-test `/health/ready`, so `make up` before deploying them; if the
smoke test fails, traffic stays on the previous revision.

## Verify

```bash
make status && make plan                                   # expect "No changes"
gcloud sql instances describe aforo-pg --format='value(state,settings.activationPolicy)'
gcloud run services list --region southamerica-east1       # all Ready
gcloud scheduler jobs list --location southamerica-east1   # PAUSED when off, ENABLED when on
```

## Troubleshooting

- **A service doesn't answer after `make up`:** its DB was still starting; `/health/live` is
  200 and `/health/ready` recovers within a minute.
- **Queue answers `500 INTERNAL` "queue store not available":** Memorystore is off →
  `make redis-up`.
- **`make` fails at `tf-state`:** Terraform can't read the state (auth or network). Run
  `gcloud auth application-default login`. The targets refuse to guess the switches.
- **`Error acquiring the state lock`:** someone else's apply is running. Wait; never
  `force-unlock` unless you are sure that apply died.
- **A plan shows `revision = "aforo-<svc>-000NN-xxx" -> null` on a service:** expected after a
  CI deploy of that service (the deploy names its revision). Applying clears it and Cloud Run
  names the next revision. Never add `template[0].revision` to `ignore_changes`: Terraform would
  resend the old name with a new config and fail with `409 Revision named … already exists`.
- **A plan right after an apply still shows changes:** a provider/API default mismatch (e.g. an
  all-default block the API drops). Fix the Terraform, don't re-apply in a loop.
- **CI checks stuck or "job was not acquired by Runner":** a GitHub Actions incident
  (githubstatus.com). Re-run when it recovers; a local `make plan` is the fallback evidence.
- **`Invalid account type for --audiences`:** `gcloud auth print-identity-token --audiences`
  doesn't work under Workload Identity Federation; CI mints ID tokens with the auth action.
