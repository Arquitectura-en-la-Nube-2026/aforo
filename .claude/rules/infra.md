---
paths:
  - "infra/**"
  - "Makefile"
  - ".github/workflows/**"
  - "**/Dockerfile"
---

# Infrastructure rules (Terraform, GCP, CI/CD)

- Everything in GCP is declared in Terraform (RT-04). No console clicks, not even "temporary",
  and no `gcloud` command that changes a resource Terraform owns.
- **Ownership split (ADR-0004).** Terraform owns resources and configuration (env, secrets,
  scaling, probes, IAM, network). CI owns the deployed image/source and the traffic split.
  Cloud Run services declare
  `lifecycle { ignore_changes = [template[0].containers[0].image, traffic, client, client_version] }`
  and are created with a placeholder image; functions ignore `build_config[0].source` and are
  created from a placeholder archive. `gateway` and `queue` also ignore the service-level
  `scaling[0].min_instance_count`: the pre-warmer function owns it (D-21).
- **Runtime switches** `env_on`, `redis_enabled`, `mock_fault_mode` are Terraform variables,
  exposed back as outputs `switch_env_on`, `switch_redis_enabled`, `switch_mock_fault_mode`.
  Apply only through `make apply | up | down | redis-up | redis-down | fault`, which read the
  current values from state so nothing flips by accident. Never `terraform apply` by hand.
- **Wiring through references, never copied URLs**: env vars that point to another resource take
  its Terraform attribute (e.g. `PAYMENT_GATEWAY_URL =
  google_cloudfunctions2_function.mock_payment_gateway.service_config[0].uri`).
- Project `aforo-dev-teamf`, region `southamerica-east1`. Region and project are variables, never
  hard-coded in modules.
- Resource names: `aforo-<service>` for Cloud Run, topics `aforo.<producer>.<fact>`,
  subscriptions `<consumer>-<fact>`, DLQs `<subscription>-dlq`. Match `contracts/events/README.md`.
- Every resource gets labels `app=aforo`, `env=dev`, `owner=<front>`.
- Secrets live in Secret Manager and are mounted as env vars in Cloud Run. Never in tfvars, never
  in the repo.
- Cloud Run: logic services are private (IAM invoker only). Only `web` and `gateway` allow
  unauthenticated invocation. Only `queue` has CPU always allocated (`cpu_idle = false`, SSE and
  admission timer) and a high request timeout; every other service keeps request-based CPU
  (ADR-0002).
- Startup and liveness probes call `/health/live`, never `/health/ready` (ADR-0004).
- Sizing follows the connection budget in ADR-0005: `max_instance_count` per service and
  `DB_POOL_MAX` env var together; `orders` max 1 instance; everything `min_instance_count = 0`
  (the pre-warmer raises `gateway` and `queue` during sales windows, D-21).
- Memorystore (queue) exists only when `redis_enabled = true`, together with the queue's push
  subscriptions and their DLQs; `queue` reaches it through Direct VPC egress on `aforo-vpc`
  (`PRIVATE_RANGES_ONLY`) (ADR-0001).
- Cloud Scheduler: one job per Postgres service calling `POST /internal/v1/housekeeping` every
  minute with OIDC; `paused = !var.env_on` (ADR-0002).
- Pub/Sub push subscriptions: OIDC push auth, `retry_policy` 10 s → 60 s,
  `max_delivery_attempts = 5`, DLQ topic per subscription; grant the Pub/Sub service agent
  publisher on the DLQ and subscriber on the subscription (ADR-0005).
- Cost: anything that bills while idle must be behind a switch that `make down` turns off.
  Before merging a new resource, write in the PR what it costs when nobody uses it.
- `make up` and `make redis-up` end by running the idempotent catalog seed. `make down` is
  announced in the team channel before running — it affects everyone.
- CI: one workflow per folder, triggered by `paths`. PR = lint + test + `terraform plan`.
  Merge to `main` = build, push to Artifact Registry, deploy to Cloud Run via Workload Identity
  Federation. No service-account keys in GitHub.
- Dockerfiles: multi-stage, `node:24-slim` runtime, non-root user, image < 150 MB.
- **Immutable artifacts (D-19)**: images tagged with the full git SHA and deployed **by digest**.
  Never `latest`, never re-tag, never rebuild to promote. Function sources are archived by SHA.
- **Deployment strategy (D-19)**: blue/green with Cloud Run revisions for services and web —
  deploy `--no-traffic --tag sha-<short>`, smoke-test the tag URL, then
  `update-traffic --to-latest`. Rollback = `--to-revisions <previous>=100`. Functions deploy
  all-at-once from the SHA archive, with the same one-command rollback (ADR-0004).
  See `docs/architecture/build-and-deploy.md`.
- DB migrations are expand/contract and run as a Cloud Run job before the traffic shift.
- Functions (`google_cloudfunctions2_function`): runtime `nodejs24` (fallback `nodejs22`),
  `min_instance_count = 0`, explicit `timeout_seconds`, dedicated service account.
