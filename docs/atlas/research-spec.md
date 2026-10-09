# Platform bible — shared spec for research agents

Repo: this repository (Aforo ticketing platform, Delivery 4 prototype on GCP
project `aforo-dev-teamf`, region `southamerica-east1`). Read CLAUDE.md first.

Goal: a cross-linked map of every component, the decision behind it, where it is declared, how it
runs on GCP, its dependencies, and what was observed on dev. Your output is JSON, consumed by a
program; be factual, cite files, never invent. If something is unknown, say "unknown".

## Rules
- READ-ONLY. Do not edit, commit, deploy, or change anything. No `make up/down/fault/poison/deploy`,
  no terraform apply, no gcloud create/update/delete/execute, no minting tokens
  (`print-identity-token`, `print-access-token`, impersonation). Allowed gcloud: `list` and
  `describe` with `--project aforo-dev-teamf`. Dev is currently OFF (Cloud SQL stopped, no
  Memorystore); that is expected — report the configured state.
- English only. Keep each text field short (1–3 sentences), plain words, no marketing.
- Cite paths relative to the repo root (e.g. `infra/envs/dev/services.tf`), with `#Lnn` when useful.
- Evidence of what ran on dev lives in `docs/evidence/*/README.md` and `docs/status/2026-10-08-done.md`.

## Shared IDs (use exactly these when referring to these components)
Services/apps: svc-gateway, svc-catalog, svc-queue, svc-orders, svc-inventory, app-web
Functions: fn-prewarmer, fn-dlq-monitor, fn-mock-payment-gateway
Data: data-cloudsql (instance), db-catalog, db-orders, db-inventory (logical DBs), data-memorystore, data-firestore
Messaging: topic-<short> (e.g. topic-event-published, topic-sales-rules-configured,
  topic-reservation-expired, topic-order-paid), dlq-<subscription-short>, tq-<queue> (Cloud Tasks
  queues, e.g. tq-reservation-expiry, tq-payment-webhooks, tq-prewarm-windows), sched-<name>
Platform: infra-vpc, infra-artifact-registry, infra-secrets, infra-iam, infra-terraform,
  ops-make-switches, ci-pipeline, job-migrate (the per-service migrate jobs), job-seed,
  obs-logging, obs-dead-letter-alert, lib-common (packages/common), contracts
If you need a component not listed, create an id with the same style and list it.

Decision IDs: use the repo's own (`D-07`, `ADR-0002`, `RD-04`, `E-01`, `RF-03`, …) exactly as the
docs write them.

## Output schema (write ONE JSON file at the path your task gives; valid JSON, UTF-8)
{
  "components": [
    {
      "id": "svc-orders",
      "name": "Orders",
      "kind": "service | function | web | datastore | database | topic | dlq | task-queue | scheduler | job | platform | library | contract | observability | ci",
      "layer": "client | edge | core | async | faas | data | platform | delivery",
      "what": "What it is, one or two sentences.",
      "serves": "What it is for in the purchase flow / the platform.",
      "why": [{"ref": "D-16", "note": "how that decision shaped it"}],
      "declaredIn": ["infra/envs/dev/services.tf#L80", "services/orders/README.md"],
      "code": "services/orders",
      "contracts": ["contracts/openapi/orders.yaml"],
      "gcp": {"type": "Cloud Run service", "name": "aforo-orders", "config": "short: cpu/mem, min/max, concurrency, ingress, SA, audience", "state": "what describe/list shows now"},
      "dependsOn": [{"id": "svc-inventory", "how": "POST /internal/v1/reservations (sync, OIDC)"}],
      "patterns": ["saga", "outbox", "idempotency", "circuit breaker"],
      "tactics": ["E-06"],
      "observed": "What happened on dev (numbers, dates) with the evidence path, or empty.",
      "gotchas": ["short known issues / deliberate gaps"]
    }
  ],
  "decisions": [],     // only the decisions task fills this; others leave []
  "notes": "anything the orchestrator must know (conflicts between docs and code, unknowns)"
}
