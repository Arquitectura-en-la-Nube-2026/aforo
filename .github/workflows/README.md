# CI/CD workflows

> Owner: Julián (Platform)

One workflow per folder, triggered by `paths`. GitHub Actions authenticates to GCP with
Workload Identity Federation — no service-account keys in the repo.

| Workflow | Trigger paths | On PR | On merge to `main` | Status |
| -------- | ------------- | ----- | ------------------ | ------ |
| `contracts.yml` | `contracts/**` | Redocly lint | Redocly lint | ✅ in place |
| `common.yml` | `packages/common/**` | lint, test, build | publish/build | TODO |
| `service-<name>.yml` ×5 | `services/<name>/**`, `packages/common/**` | lint, test, docker build | build, push by SHA, deploy `--no-traffic --tag`, smoke, `--to-latest` | TODO |
| `web.yml` | `apps/web/**` | lint, test, build | same as services for `aforo-web` | TODO |
| `function-<name>.yml` ×3 | `functions/<name>/**`, `packages/common/**` | lint, test, bundle | upload `<sha>.zip`, `gcloud functions deploy --source` (no env flags), smoke | TODO |
| `infra.yml` | `infra/**` | `terraform fmt -check`, `validate`, `make plan` | — (Platform runs `make apply` by hand from `main`) | ✅ in place |
| `e2e.yml` | manual (`workflow_dispatch`) | — | run acceptance tests against `dev` | TODO |

Every deploy follows D-19: artifact tagged by git SHA and deployed by digest, new revision with
no traffic, smoke test on its tag URL, then 100 % traffic
([build-and-deploy.md](../../docs/architecture/build-and-deploy.md)).

Deploy steps change **only** the image/source and traffic. Env vars, secrets and scaling are
Terraform's (ADR-0004). `infra.yml` goes through `make plan`; applies are manual `make apply` runs, and both keep the
runtime switches (`env_on`, `redis_enabled`, `mock_fault_mode`) as they are.

Suggestion: write the service workflow once as a reusable workflow (`_service.yml` with
`workflow_call` and a `service` input) and call it from the five thin per-service files.
