# Deployment: immutable artifact, migrations, blue/green, rollback (D-19)

**When:** Fri Oct 9, 2026, 13:58–14:04 UTC.
**What:** `make deploy SERVICE=orders` from `main` at `1b8ce63` (orders' code unchanged since
`a44ee7e`, so the new revision behaves the same; the point is the pipeline), then a timed rollback
and roll-forward.
**Run:** [GitHub Actions 37940782038](https://github.com/Arquitectura-en-la-Nube-2026/aforo/actions/runs/37940782038)
(`workflow_dispatch`, `.github/workflows/_service.yml`).

## Pipeline

| Step | UTC | Took | Result |
| ---- | --- | ---: | ------ |
| check: `npm ci`, build `@aforo/common`, lint, unit tests, `docker build` | 13:59:03 → 14:00:00 | 57 s | ✅ |
| Build and push (or reuse) | 14:00:13 → 14:01:15 | 62 s | Image tagged with the full git SHA; digest `orders@sha256:b6a6cf56…8e3e` |
| **Migrate with the new image** | 14:01:15 → 14:01:43 | 28 s | Job `aforo-orders-migrate` updated to the new digest; execution `aforo-orders-migrate-9q5s4` completed |
| **Deploy without traffic** | 14:01:43 → 14:01:57 | 14 s | Revision `aforo-orders-00009-guv`, **0 %** traffic, tag URL `https://sha-1b8ce63---aforo-orders-u3phfgwoza-rj.a.run.app` |
| **Smoke test on the tag URL** | 14:01:58 | < 1 s | `GET /health/ready` with an ID token → `200` on attempt 1 |
| **Shift traffic** | 14:01:58 → 14:02:04 | 6 s | `--to-latest` → `00009-guv` 100 % |

Total from dispatch to 100 %: **3 min 6 s**. The new code took traffic only after its schema was
migrated and its own health check passed on its private URL. If the new revision does not become
ready or fails the smoke test, the job stops and the old revision keeps 100 %: on Oct 8 the orders
image that could not boot (`#38`, `00005-zod`) never got traffic.

## Rollback

[rollback.log](rollback.log):

| UTC | Action | Time to 100 % |
| --- | ------ | ------------: |
| 14:03:15 | `gcloud run services update-traffic aforo-orders --to-revisions aforo-orders-00006-sk7=100` | **8.3 s** |
| 14:03:24 | Gateway `GET /api/v1/orders` → `200` on the old revision | — |
| 14:03:31 | Roll forward: `--to-revisions aforo-orders-00009-guv=100` | 5.6 s |

No rebuild and no redeploy: the previous revision is still there, pinned to its digest, so going
back is only a traffic change.

## Revisions = digests

```
aforo-orders-00009-guv  2026-10-09 14:01  orders@sha256:b6a6cf56…  (CI, sha-1b8ce63)
aforo-orders-00006-sk7  2026-10-09 00:31  orders@sha256:c6994b46…  (Terraform: config change, same digest)
aforo-orders-00006-guh  2026-10-08 23:50  orders@sha256:c6994b46…  (CI, sha-a44ee7e)
aforo-orders-00005-zod  2026-10-08 23:35  orders@sha256:b21d182d…  (CI, sha-77eabb4; the image that could not boot, #38; never served)
aforo-orders-0000[1-3]  2026-10-05        hello@sha256:ea86b59c…  (Terraform placeholder before the first CI deploy)
```

`00006-sk7` shows the split of ADR-0004: Terraform owns configuration (a runtime switch created a
new revision) but keeps the image CI deployed; CI owns code and traffic.

Commands:

```bash
gcloud run revisions list --service aforo-orders --region southamerica-east1
gcloud run jobs executions list --job aforo-orders-migrate --region southamerica-east1
```

## Found

`make deploy` waits 5 s and then watches the newest run of the workflow; this time GitHub had not
listed the new run yet, so it printed the previous run's result ("already completed"). The deploy
itself was fine; it was followed with `gh run watch 37940782038`.
