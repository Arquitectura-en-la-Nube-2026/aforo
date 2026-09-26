---
paths:
  - "functions/**"
---

# FaaS rules (Cloud Run functions, Node 24, TypeScript)

Functions are the two FaaS components required by Delivery 4 (D-16, D-17). They follow FaaS
principles, so they are **not** NestJS apps.

## Must
- One entry point per function, built on `@google-cloud/functions-framework`. HTTP or CloudEvent
  (Pub/Sub) trigger only.
- **Cold start**: minimal dependencies, no framework bootstrap, lazy-init clients in module scope
  (reused across warm invocations), bundle to a single file (esbuild). `min-instances = 0`.
  Document the measured cold start in the function README.
- **Execution time**: finish all work **before** responding. No background work after the
  response (CPU is throttled after it). Anything delayed goes through Cloud Tasks. Set an explicit
  timeout (≤ 60 s) in Terraform.
- **Stateless**: no in-memory state across invocations; anything durable goes to a managed store.
- Idempotent: the same trigger delivered twice has the same effect (Pub/Sub is at-least-once).
- Structured JSON logs with `correlationId`, same shape as the services.
- Use only the framework-agnostic parts of `@aforo/common` (envelope, errors, logger) — never its
  Nest modules.
- Contract: HTTP functions have an OpenAPI in `contracts/openapi/`; event-triggered functions
  consume schemas in `contracts/events/`.
- Configuration is owned by Terraform (ADR-0004): CI deploys only the source archive
  (`gcloud functions deploy … --source gs://…/<sha>.zip`, no env flags). Behavior toggles such
  as `FAULT_MODE` change through `make fault`, never `gcloud`.

## Layout
```
functions/<name>/
  src/index.ts        exported handler(s)
  src/…               pure logic, unit-testable without the framework
  test/
  README.md           spec + cold start / timeout notes
  .env.example
```
