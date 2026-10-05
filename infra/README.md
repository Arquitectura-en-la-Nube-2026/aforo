# infra — Terraform

> Owner: Julián · Status: in progress (bootstrap done; foundation: Artifact Registry, functions bucket, team access)

Everything in GCP is declared here (RT-04). Nothing is created by hand in the console, and no
`gcloud` command changes a resource Terraform owns. That is also what makes turning the
environment off and on possible.

## Prerequisites (done by Julián before Mon Sept 28, the only manual step)

Project `aforo-dev-teamf` (`aforo-dev` was taken globally) with billing, six accounts with editor role, APIs enabled (Cloud Run,
Cloud SQL, Pub/Sub, Cloud Tasks, Cloud Scheduler, Secret Manager, Artifact Registry,
IAM Credentials, Cloud Functions, Cloud Build, Eventarc, Memorystore for Redis, Compute Engine
(VPC), Monitoring), a GCS bucket for Terraform state, and Workload Identity Federation for
GitHub Actions.

## Layout

```
infra/
  modules/
    cloud-run-service/   one Cloud Run service: placeholder image, env, secrets, probes, min/max instances, invoker IAM, ignore_changes
    pubsub-topic/        topic + push subscriptions + DLQ topics + Pub/Sub agent IAM
    cloud-sql/           instance + one database and one user per service
    cloud-function/      one Cloud Run function: placeholder archive, trigger, runtime, SA, ignore_changes
    cloud-tasks-queue/   queue with retry config
    memorystore/         Redis instance (count = redis_enabled)
    monitoring/          log-based metrics and alert policies (DLQ alert)
  envs/
    dev/                 the only environment: main.tf, variables.tf, outputs.tf, backend.tf, terraform.tfvars
```

## Resources (dev)

| Resource | Amount | Cost when idle |
| -------- | ------ | -------------- |
| Cloud Run | 6 services: web, gateway, catalog, queue, orders, inventory | Nothing (scale to zero) |
| Cloud SQL PostgreSQL | 1 `db-f1-micro` instance, 3 databases (`catalog`, `orders`, `inventory`) | Disk only, when `env_on = false` |
| Memorystore for Redis | Basic 1 GB, **only while `redis_enabled = true`** (ADR-0001) | Nothing: it doesn't exist. ≈ US$1–2/day while on |
| VPC | `aforo-vpc` + one subnet in the region, Direct VPC egress for `queue` only | Nothing |
| Pub/Sub | 4 topics, 6 push subscriptions, 6 DLQs (the 2 `queue-*` subscriptions + DLQs only with Redis on) | Negligible |
| Cloud Tasks | 3 queues: `reservation-expiry`, `payment-webhooks`, `prewarm-windows` | Negligible |
| Cloud Scheduler | 3 jobs → `POST /internal/v1/housekeeping` on catalog, inventory, orders every minute; paused when `env_on = false` (ADR-0002) | Free tier (3 jobs) |
| Cloud Run functions | 3: `prewarmer` (Pub/Sub push + Cloud Tasks, D-21), `dlq-monitor` (Pub/Sub trigger via Eventarc), `mock-payment-gateway` (HTTP, test double) | Nothing (scale to zero). While a window is warm, `gateway` and `queue` keep 1 instance (≤ `PREWARM_HOLD_SECONDS`, 1 h) |
| Cloud Monitoring | log-based metric + alert policy for dead letters | Free tier |
| Cloud Storage | bucket for function sources (versioned) | Cents |
| Secret Manager | login secret, webhook HMAC secret, DB passwords | Cents |
| Artifact Registry | 1 repository | Image storage |

Topic and subscription names must match [contracts/events/README.md](../contracts/events/README.md).

## Runtime switches (ADR-0004)

The only things that change between "off", "on" and "demo". They are Terraform variables, and
`outputs.tf` exposes each one back (`switch_env_on`, `switch_redis_enabled`,
`switch_mock_fault_mode`) so the Makefile can read the current value before every apply.

| Variable | Default | `true` / value means | Changed by |
| -------- | ------- | -------------------- | ---------- |
| `env_on` | `false` | Cloud SQL `activation_policy = ALWAYS`; Cloud Scheduler jobs not paused | `make up`, `make down` |
| `redis_enabled` | `false` | Memorystore exists; queue subscriptions + DLQs exist; `queue` gets `REDIS_URL` | `make redis-up`, `make redis-down`, `make down` |
| `mock_fault_mode` | `none` | `FAULT_MODE` env of `mock-payment-gateway` (`none`/`error`/`timeout`) | `make fault MODE=…`; `make down` resets it |

Never run `terraform apply` by hand: it would reset every switch to its default.

## Ownership: Terraform vs CI (ADR-0004)

- Terraform owns resources and configuration (env, secrets, scaling, probes, IAM, network).
- CI owns the deployed image (services, web) or source archive (functions) and the traffic split.
- Cloud Run services: created with a placeholder image;
  `lifecycle { ignore_changes = [template[0].containers[0].image, traffic, client, client_version] }`.
- Functions: created from a placeholder archive; `ignore_changes = [build_config[0].source]`.
- `gateway` and `queue`: also `ignore_changes` on the service-level `scaling[0].min_instance_count`
  (created at 0): the pre-warmer owns it (D-21).
- Probes: startup and liveness on `/health/live`, never `/health/ready`, so a service with its DB
  or Redis off still deploys and boots.
- Cross-resource values come from references, never copied URLs:

  | Env var | Unit | Terraform value |
  | ------- | ---- | --------------- |
  | `PAYMENT_GATEWAY_URL` | orders | `google_cloudfunctions2_function.mock_payment_gateway.service_config[0].uri` |
  | `INVENTORY_URL` | orders | `google_cloud_run_v2_service.inventory.uri` |
  | `SELF_URL` | inventory, mock | deterministic Cloud Run URL `https://<name>-<project-number>.<region>.run.app` built from variables (a resource can't reference its own `uri`) |
  | `ORDERS_WEBHOOK_URL` | mock | gateway `uri` + `/api/v1/payments/webhook` |
  | `REDIS_URL` | queue | `redis://${host}:${port}` of Memorystore, `""` when off |

## Sizing and connection budget (ADR-0005)

`db-f1-micro` allows 25 connections, 3 reserved: 22 usable. Instance caps and pools are set
together.

| Unit | Max instances | Concurrency | CPU | `DB_POOL_MAX` | DB connections |
| ---- | :-----------: | :---------: | --- | :-----------: | :------------: |
| inventory | 3 | 80 | request-based | 2 | 6 |
| orders | **1** (single circuit breaker) | 80 | request-based | 3 | 3 |
| catalog | 2 | 80 | request-based | 2 | 4 |
| migration job | 1, one at a time | — | — | 1 | 1 |
| people running a unit locally against dev | ~5 | — | — | 1 | 5 |
| gateway | 3 | 80 | request-based | — | — |
| web | 2 | 80 | request-based | — | — |
| queue | 2 | 250 | **always allocated** (SSE + admission timer) | — | — |
| functions | 5 (`prewarmer`: 1) | 1 (default) | — | — | — |
| **Total DB connections** | | | | | **19 of 22** |

All `min_instance_count = 0`; during a sales window the pre-warmer raises `gateway` and `queue` to 1 (D-21).

## Pub/Sub settings (ADR-0005)

Push subscriptions with OIDC auth, `ack_deadline_seconds = 60`, `retry_policy` 10 s → 60 s,
`dead_letter_policy { max_delivery_attempts = 5 }`. Grant the Pub/Sub service agent
`roles/pubsub.publisher` on each DLQ topic and `roles/pubsub.subscriber` on each subscription.
`dlq-monitor` subscribes to the DLQ topics through Eventarc triggers (no DLQ of its own).

## Service accounts

One runtime service account per Cloud Run service with least privilege (e.g. only `orders` may
invoke `inventory`; only the Pub/Sub push SA may invoke `/internal/v1/events/*`; only the Cloud
Tasks SA may invoke `inventory`'s `/expire` and the mock's `/webhook-dispatch`; only the
Cloud Scheduler SA may invoke `/internal/v1/housekeeping`). The pre-warmer's SA has
`roles/run.developer` only on `aforo-gateway` and `aforo-queue`, `roles/iam.serviceAccountUser`
on their runtime SAs, and enqueue/list rights on `prewarm-windows`.

## Deployment

Immutable artifacts and blue/green: [docs/architecture/build-and-deploy.md](../docs/architecture/build-and-deploy.md).

## Up / down

`make up` / `make down` / `make redis-up` / `make redis-down` at the repo root — see
[docs/runbooks/environment-up-down.md](../docs/runbooks/environment-up-down.md).
