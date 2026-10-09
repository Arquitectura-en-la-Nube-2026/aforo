# E-07 · Cost follows use

**Target (Delivery 3):** the platform costs close to nothing when nobody uses it, and only the
resources a demo needs exist during a demo; turning it on and off is one command (ADR-0001,
ADR-0004).

## What the switches change

Three Terraform variables, changed only through `make` (`infra/envs/dev`):

| Command | `env_on` | `redis_enabled` | Effect |
| ------- | :------: | :-------------: | ------ |
| `make up` | true | unchanged | Cloud SQL `activation_policy` → `ALWAYS` (starts the instance); the three housekeeping schedulers resume; seed runs |
| `make redis-up` | true | true | Also **creates** Memorystore (BASIC, 1 GB, ~10 min) and the queue's push subscription; seed runs |
| `make redis-down` | unchanged | false | **Destroys** Memorystore and the queue's push subscription |
| `make down` | false | false | Cloud SQL → `NEVER` (stops); schedulers paused; Memorystore destroyed; fault mode reset to `none` |

Always there, and free or near free when idle:

| Resource | Idle cost driver |
| -------- | ---------------- |
| Cloud Run services (5 + web) and functions (3) | Scale to zero: billed per request/CPU time only. Minimum instances are 0; the `prewarmer` raises them to 1 only during a sales window and puts them back (E-01) |
| Cloud SQL `db-f1-micro`, 10 GB | Stopped: only its disk is billed |
| Pub/Sub, Cloud Tasks, Cloud Scheduler, Firestore (mock) | Per message/operation; idle ≈ 0 |
| VPC and subnet | Free (ADR-0001) |
| Artifact Registry | Image storage (one image per deployed SHA) |
| Log-based metric + alert policy | Free at this volume |

Verified state after `make down` (Oct 9, ~14:20 UTC):

```
aforo-pg                       STOPPED  NEVER
redis:                         (none)
aforo-*-housekeeping           PAUSED ×3
aforo-gateway / aforo-queue    minScale empty (0)
```

## How `dev` was used (Oct 8–9, approximate times from this session)

| Day (UTC) | `dev` on | Memorystore | Why |
| --------- | -------- | ----------- | --- |
| Oct 8 (afternoon) → Oct 9 ~01:30 | yes | yes (from the evening) | First deploys of catalog, orders, inventory; happy-path runs |
| Oct 9 ~01:30 → ~02:30 | no | no | `make down` |
| Oct 9 ~02:30 → ~03:40 | yes | yes | Deploy `#40` and `#41`; E-06 |
| Oct 9 ~03:40 → ~13:00 | no | no | `make down` overnight |
| Oct 9 ~13:00 → ~14:20 | yes | yes | All tactic demos (E-06, E-02, expiry, E-05, E-01, fails well, deployment) |

## Billing report — pending

To capture (Billing → Reports, project `aforo-dev-teamf`, group by **Service**, daily, last 10
days): save as `01-billing-by-day.png`, and one filtered to a single off day vs Oct 9 as
`02-off-vs-demo.png`. Fill in:

| Day | Total | Largest items |
| --- | ----: | ------------- |
| Off day (pick one) | | |
| Demo day (Oct 9) | | |

Billing data lags up to a day, so take it on Oct 10 or later.
