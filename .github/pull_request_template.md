## What

<!-- One or two sentences. Which unit does this touch? (one unit per PR) -->

## Why

<!-- Link the acceptance step, RF, or decision (D-xx / ADR-NNNN) this serves. -->

## Contract impact

- [ ] No contract change
- [ ] Contract change in a separate PR, approved by the contracts owner and announced: #

## Definition of Done (tick what applies to this PR)

- [ ] Matches its OpenAPI / event schema in `contracts/`
- [ ] `/health/live` and `/health/ready` respond
- [ ] Dockerfile + deploy from CI
- [ ] Resources declared in Terraform (and idle cost stated below)
- [ ] Structured logs with `correlationId`
- [ ] Errors in `problem+json` with agreed `code`s
- [ ] Tests of its own rules, including repeated `Idempotency-Key`
- [ ] README updated (how to run, env vars)
- [ ] Graceful shutdown (services) / cold start + timeout noted (functions)
- [ ] State-machine transitions it owns are tested
- [ ] Migrations are expand/contract (backward compatible with the revision serving traffic)
- [ ] Boots with its DB/Redis off; no timers or work after the response (ADR-0002)
- [ ] Config changes go through Terraform / `make`, not `gcloud` (ADR-0004)
- [ ] Records a new cross-unit decision as an ADR and updates the rule it changes

## Idle cost (infra PRs only)

<!-- What does the new resource cost when nobody uses it? -->
