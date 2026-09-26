# 0004 · Terraform owns configuration, CI owns code and traffic

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** Julián (Platform)
- **Affects:** `infra/`, `.github/workflows/`, `Makefile`, `functions/*`, runbooks

## Context

Two tools change the same Cloud Run services: Terraform (RT-04: every resource as code) and the
CI pipeline (D-19: deploy by digest, blue/green with revision tags). Without a clear split, the
next `terraform apply` reverts the image CI deployed, or CI overwrites what Terraform declared.
The planned `make fault` and `make up/down` also changed resources with `gcloud`, outside
Terraform, which contradicts "nothing outside IaC".

## Decision

**Who owns what**

| Concern | Owner | How |
| ------- | ----- | --- |
| Every resource, env vars, secrets, scaling, probes, IAM, VPC | Terraform | `make apply` |
| Container image of services and web | CI | `gcloud run deploy --image <repo>@<digest> --no-traffic --tag sha-<short>` |
| Traffic split of services and web | CI | smoke on the tag URL, then `gcloud run services update-traffic --to-latest` |
| Source of functions | CI | `gcloud functions deploy <fn> --source gs://aforo-dev-functions/<fn>/<sha>.zip` (source flag only, never env flags) |
| Runtime switches (`env_on`, `redis_enabled`, `mock_fault_mode`) | Terraform variables | only through `make up/down/redis-up/redis-down/fault` |

- Cloud Run services in Terraform declare
  `lifecycle { ignore_changes = [template[0].containers[0].image, traffic, client, client_version] }`
  and are first created with a public placeholder image. Functions ignore
  `build_config[0].source` and are first created from a placeholder archive.
- CI promotes with `--to-latest` (the revision it just deployed is the latest), so traffic
  keeps following the latest revision and a later Terraform config change goes live too.
  Rollback: `update-traffic --to-revisions <previous>=100`; the next deploy unpins it.
- **Runtime switches are persisted as Terraform outputs.** Each `make` target reads the current
  values back from state (`terraform output -raw switch_*`) and passes all of them to
  `terraform apply`, changing only the one it is about. So no apply, by anyone, flips a switch by
  accident. Nobody runs `terraform apply` by hand.

  | Switch | Default | Controls |
  | ------ | ------- | -------- |
  | `env_on` | `false` | Cloud SQL activation policy (`ALWAYS`/`NEVER`), Cloud Scheduler jobs paused or not |
  | `redis_enabled` | `false` | Memorystore instance, queue subscriptions, `REDIS_URL` ([ADR-0001](0001-memorystore-on-demand.md)) |
  | `mock_fault_mode` | `none` | `FAULT_MODE` env var of `mock-payment-gateway` (`none`/`error`/`timeout`) |

- **Startup and liveness probes point to `/health/live`, never `/health/ready`.** A missing
  dependency (Cloud SQL off, Redis absent) must not stop a revision from deploying.
  `/health/ready` is what the pipeline smoke test and operators check.
- **Functions deploy all-at-once** to a new revision with the immutable SHA archive; smoke right
  after; rollback = `gcloud run services update-traffic <fn> --to-revisions <previous>=100` on
  the function's underlying Cloud Run service. Blue/green with `--no-traffic` stays the strategy
  for the five services and web.
- Wiring between resources goes through Terraform references, never copied URLs: e.g. Orders'
  `PAYMENT_GATEWAY_URL = google_cloudfunctions2_function.mock_payment_gateway.service_config[0].uri`,
  `INVENTORY_URL = google_cloud_run_v2_service.inventory.uri` (Lab 5 §6).

## Consequences

- No drift between tools, and every environment change is visible in a Terraform plan.
- `make fault` now takes about a minute (Terraform updates the function's env, which creates a
  revision) instead of seconds. Acceptable: during the demo, narrate while it applies.
- Config changes applied by Terraform go live all-at-once, not blue/green. Only code rollouts
  are blue/green. That is deliberate: the artifact is the image, config is environment.
- Functions have no pre-traffic smoke test. Accepted: they are the mock and the DLQ monitor,
  and rollback is one command.
