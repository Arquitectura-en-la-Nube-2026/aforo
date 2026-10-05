# CI/CD workflows

> Owner: Julián (Platform)

One workflow per folder, triggered by `paths`. GitHub Actions authenticates to GCP with
Workload Identity Federation — no service-account keys in the repo.

| Workflow | Trigger paths | On PR | On merge to `main` | Status |
| -------- | ------------- | ----- | ------------------ | ------ |
| `contracts.yml` | `contracts/**` | Redocly lint | Redocly lint | ✅ in place |
| `common.yml` | `packages/common/**` | lint, test, build | publish/build | TODO |
| `service-<name>.yml` ×5 | `services/<name>/**`, `packages/common/**` | lint, test, docker build | lint, test, docker build; deploy (push by SHA, `--no-traffic --tag`, smoke, `--to-latest`) only if `DEPLOY_ON_MERGE=true` or run by hand | ✅ in place |
| `web.yml` | `apps/web/**` | lint, test, build | same as services for `aforo-web` | ✅ in place |
| `function-<name>.yml` ×3 | `functions/<name>/**`, `packages/common/**` | lint, test, bundle | lint, test, bundle; deploy (upload `<sha>.zip`, `gcloud functions deploy --source`, no env flags) only if `DEPLOY_ON_MERGE=true` or run by hand | ✅ `dlq-monitor`, `prewarmer`, `mock-payment-gateway` (runs once its code is on `main`) |
| `infra.yml` | `infra/**` | `terraform fmt -check`, `validate`, `make plan` | — (Platform runs `make apply` by hand from `main`) | ✅ in place |
| `e2e.yml` | manual (`workflow_dispatch`) | — | run acceptance tests against `dev` | TODO |

Every deploy follows D-19: artifact tagged by git SHA and deployed by digest, new revision with
no traffic, smoke test on its tag URL, then 100 % traffic
([build-and-deploy.md](../../docs/architecture/build-and-deploy.md)).

Deploy steps change **only** the image/source and traffic. Env vars, secrets and scaling are
Terraform's (ADR-0004). `infra.yml` goes through `make plan`; applies are manual `make apply` runs, and both keep the
runtime switches (`env_on`, `redis_enabled`, `mock_fault_mode`) as they are.

The service workflow is written once as a reusable workflow (`_service.yml`) and called from the
five thin `service-<name>.yml` files and `web.yml`. Each unit's Dockerfile lives in its folder and
is built with the repo root as context.

Function archives contain `dist/` as built by the unit. If the build doesn't write
`dist/package.json`, the workflow derives one from the unit's `package.json` (runtime
`dependencies` minus the bundled `@aforo/*` workspace packages), so dependencies left external by
esbuild get installed by the platform.

## Turning deploys on

Deploys are **off on merge** until the team is ready, so merges to `main` cost nothing.

- Deploy one unit now: Actions → `service-<name>` (or `web`) → **Run workflow** on `main`.
- Deploy on every merge: `gh variable set DEPLOY_ON_MERGE --body true` (unset it to stop).

The smoke test calls `/health/ready` on the new revision, so run `make up` first for units with a
database; if it fails, traffic stays on the previous revision.
