# Platform Atlas

> Owner: Platform (Julián). Snapshot of `main` at `b19409a` and of `dev` on Oct 9, 2026 (dev off).

An interactive map of the Delivery 4 slice: every component (services, web, functions, data,
topics, task queues, schedulers, jobs, platform pieces), what it is, what it serves, the decisions
behind it, where it is declared, how it runs on GCP, what it depends on, and what we measured on
`dev`. It also lays out the purchase flow step by step, the quality scenarios with their results,
all recorded decisions, and how Delivery 1–3 became this slice.

**Open [index.html](index.html) in a browser.** It is one self-contained file (fonts from Google
Fonts; works offline with fallback fonts).

## How it was made

Five research passes on Oct 9, each following [research-spec.md](research-spec.md) and writing
one file in [data/](data/):

| File | Covers | Sources |
| ---- | ------ | ------- |
| `services.json` | gateway, catalog, queue, orders, inventory, web, the three databases, `@aforo/common`, the purchase flow | READMEs, `src/`, migrations, OpenAPI, `infra/envs/dev/services.tf`, `gcloud run services describe` |
| `async.json` | the three functions, Firestore, Pub/Sub topics and DLQs, Cloud Tasks queues, schedulers, migrate and seed jobs | `functions/`, `contracts/events/`, `infra/envs/dev/{messaging,tasks,scheduler,functions}.tf`, `gcloud … list` |
| `platform.json` | Cloud SQL, Memorystore, VPC, Artifact Registry, secrets (names only), IAM, Terraform, `make` switches, CI, logging, the DLQ alert, contracts | `infra/`, `Makefile`, `.github/workflows/`, `gcloud … describe` |
| `decisions.json` | D-xx, R-xx, ADRs, Delivery 4 decisions, risks, quality scenarios, known gaps | `docs/plan/`, `docs/adr/`, `docs/architecture/`, `docs/status/` |
| `deliveries.json` | Delivery 1–3: requirements, target components, quality scenarios, and what the slice kept | `docs/design/*.pdf`, `docs/architecture/target-vs-slice.md` |

[build.py](build.py) merges them into [template.html](template.html). It also drops notes that
quoted documents fixed afterwards (PRs #42, #43) and holds the hand-written parts: the ten
purchase-flow steps, the scenario verdicts and the "Still open" list.

## Rebuild

```bash
python3 docs/atlas/build.py      # rewrites docs/atlas/index.html
```

Edit the JSON in `data/` (or re-run a research pass with the spec) when a component, decision or
result changes, then rebuild. The page is a snapshot: it does not read GCP live.
