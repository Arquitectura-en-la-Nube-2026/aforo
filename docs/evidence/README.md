# Delivery 4 evidence

What we observed on the running system, stored where the artifact can cite it. One folder per
scenario; each has a `README.md` with **when** it ran, **what was run**, the **result** against the
target, and the **log queries** used, plus its screenshots or raw output.

The checklist of what is still to collect is [../status/2026-10-08-missing.md](../status/2026-10-08-missing.md).

| Folder | Scenario | Collected |
| ------ | -------- | :-------: |
| [happy-path/](happy-path/) | Acceptance steps 1–10 on `dev` | ✅ Oct 8 |
| [e02-concurrency/](e02-concurrency/) | E-02 zero overselling | ⚠️ local only |
| `e06-circuit-breaker/` | E-06 payment gateway resilience | — |
| `e05-observability/` | E-05 traceability + DLQ alert | — |
| `e01-prewarming/` | E-01 pre-warming (FaaS #1) | — |
| `reliability-expiry/` | Reservation expiry restores seats | — |
| `fails-well/` | Sold out, limit, idempotent order, duplicate webhook | — |
| `deployment/` | Blue/green and rollback | — |
| `faas-cold-start/` | Cold start and execution time per function | — |
| `e07-cost/` | Cost follows use | — |

Conventions: screenshots as `NN-what.png`; times in UTC; project `aforo-dev-teamf`. Log queries
are written so they can be pasted into Cloud Logging as they are.
