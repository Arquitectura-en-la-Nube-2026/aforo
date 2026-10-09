# Build and deployment

> Owner: Platform (Julián). Implements D-19. Status: **implemented** in `.github/workflows/_service.yml`; run recorded in
[docs/evidence/deployment/](../evidence/deployment/).

## Immutable artifacts

| Unit | Artifact | Identity |
| ---- | -------- | -------- |
| Services + web | OCI image in Artifact Registry `southamerica-east1-docker.pkg.dev/aforo-dev-teamf/aforo/<unit>` | Tag = full git SHA; deployed **by digest** (`@sha256:…`). No `latest`, no re-tagging |
| Functions | Source archive `gs://aforo-dev-teamf-functions/<function>/<git-sha>.zip` (Cloud Build turns it into an image) | Object name = git SHA; bucket with versioning, objects never overwritten |
| Infra | Terraform plan artifact attached to the PR | Applied from `main` only |

The same artifact is promoted; nothing is rebuilt between test and release. Config comes from
env vars and Secret Manager, never baked into the image.

## Who changes what (ADR-0004)

Terraform owns every resource and its configuration (env, secrets, scaling, probes, IAM).
The pipeline owns only the deployed code (image or source archive) and the traffic split.
Terraform ignores those fields (`ignore_changes`), so neither tool undoes the other.

## Deployment strategy: blue/green with Cloud Run revisions (services and web)

```
1. gcloud run deploy aforo-<svc> --image <repo>@<digest> --no-traffic --tag sha-<short>
2. smoke test https://sha-<short>---aforo-<svc>-….run.app  (/health/ready with an ID token)
3. gcloud run services update-traffic aforo-<svc> --to-latest
4. rollback: gcloud run services update-traffic aforo-<svc> --to-revisions <previous>=100
```

Step 3 uses `--to-latest` (the revision from step 1 is the latest), so traffic keeps following
the latest revision and a later Terraform config change also goes live. After a rollback the
service is pinned to the previous revision until the next pipeline deploy.

`gcloud run deploy` passes only `--image`, `--no-traffic` and `--tag`: never env vars, secrets
or scaling flags — those are Terraform's.

A canary step (`=10` before `=100`) is optional; with demo traffic it proves nothing, so
blue/green is the default.

## Functions: all-at-once with instant rollback

Cloud Run functions don't take `--no-traffic`, so the three functions deploy all-at-once:

```
1. upload gs://aforo-dev-teamf-functions/<fn>/<git-sha>.zip
2. gcloud functions deploy <fn> --source gs://aforo-dev-teamf-functions/<fn>/<git-sha>.zip   (no env flags)
3. smoke test (HTTP: /health or a dry call; dlq-monitor: none, it is event-triggered)
4. rollback: gcloud run services update-traffic <fn> --to-revisions <previous>=100
```

Accepted trade-off: they are small, rarely changed (pre-warmer, DLQ monitor, payment mock), and rollback is one command.

## Probes

Startup and liveness probes call `/health/live`. `/health/ready` is checked by the smoke test
(step 2), not by Cloud Run, so a revision still deploys while Cloud SQL or Memorystore is off.

## Schema changes (expand / contract)

1. **Expand**: migration only adds (nullable column, new table, new index). Runs as a Cloud Run
   job `aforo-<svc>-migrate` using the new image, **before** step 3. The job is declared in
   Terraform (`jobs` of `infra/modules/cloud-run-service`) with the service's identity, env and
   Cloud SQL socket; CI sets its image to the new digest and runs it with `--wait` right after
   the push, before the no-traffic revision (`.github/workflows/_service.yml`).
2. Deploy code that writes both / reads new.
3. **Contract**: a later release removes the old column once no revision serving traffic uses it.

A migration that is not backward-compatible with the revision currently serving traffic is
rejected in review.

## Contract changes

Compatible changes stay in `v1` and ship provider first, then consumers. Incompatible changes
create `/v2` (or event `version: 2`), both served in parallel until every consumer moved.
Real example (orders, Oct 9): 3 min 6 s from dispatch to 100 %, rollback in 8.3 s —
[docs/evidence/deployment/](../evidence/deployment/).

## Pipeline per unit (GitHub Actions)

`PR` and push to `main`: lint → unit tests → build image (the `check` job). Contracts are linted
with Redocly in `contracts.yml`; there are no contract tests against Prism or deployed revisions.
`deploy` (manual `make deploy SERVICE=<unit>`, or on merge only if the repo variable
`DEPLOY_ON_MERGE=true`, unset today): build → push by SHA → migrate job (if any) → deploy
`--no-traffic` → smoke → shift traffic.
Authentication with Workload Identity Federation.
