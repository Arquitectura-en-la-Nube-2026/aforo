# E-01 · Pre-warming per sales window (FaaS #1, `prewarmer`)

**Target (Delivery 3):** the entry path has instances running when a sale opens, because the
opening time comes from the catalog; the rest of the time it scales to zero (E-07).

**When:** Fri Oct 9, 2026, 13:38–13:47 UTC.
**How:** [e01.cjs](e01.cjs) through the public gateway: create "Demo pre-warming (E-01)"
(`e1a5f8cf-6166-52af-a20e-6e8b65454ccd`), sales open 13:41:36 and close 13:46:36, set its rules,
publish; join the queue 1 s after the opening. [minimums.log](minimums.log) samples each
service's minimum (`run.googleapis.com/minScale`) and the pending tasks every ~20 s.
Output in [run.log](run.log) (the first attempt failed on a bug in the script, not the platform).

Settings on dev (`infra/envs/dev/functions.tf`): lead 600 s before the opening, hold up to 3600 s,
targets `aforo-gateway:1, aforo-queue:1`, baseline 0. The opening was 3 min away, inside the lead,
so the warm task ran at once.

## Result

| Target | Observed |
| ------ | -------- |
| Publishing schedules the window | ✅ `prewarm_scheduled` 13:38:38: tasks `warm-…` (now) and `cool-…-1791553596` (13:46:36) on `prewarm-windows` |
| Gateway and queue warm before the opening | ✅ `prewarm_applied WARM` 0 → 1: gateway 13:38:39.4, queue 13:38:40.2 (**3 s after publishing**, 3 min before the opening) |
| First request at the opening is fast | ✅ queue join at 13:41:38: **550 ms**, vs **4 070 ms** for the first join after idle this morning (cold queue, see [status](../../status/2026-10-08-missing.md) item 0) |
| Back to zero at the close | ✅ `prewarm_applied COOL` 1 → 0: gateway 13:46:37.5, queue 13:46:38.2; no tasks left |

### Timeline (UTC)

| Time | Hop |
| ---- | --- |
| 13:38:36.9 | `POST /api/v1/events/{id}/publish` → `200 PUBLISHED`; outbox emits `EventPublished` |
| 13:38:37.4 | Pub/Sub push → `prewarmer` `POST /events/prewarmer-event-published` → `204` (1.15 s) |
| 13:38:38.5 | Cloud Tasks → `POST /windows/warm` → `200` (1.61 s) |
| 13:38:39.4 / 40.2 | gateway / queue minimum 0 → 1 |
| 13:41:36 | Sales open |
| 13:41:38 | Buyer joins the queue: `201 WAITING`, 550 ms |
| 13:46:36.1 | Cloud Tasks → `POST /windows/cool` → `200` (2.08 s) |
| 13:46:37.5 / 38.2 | gateway / queue minimum 1 → 0 |

One `correlationId` (`5ae9f875-52d9-4b0c-9c8e-4d66d96314c9`) runs from the gateway's publish request
through catalog, inventory's consumers and every `prewarmer` line, up to the cool-down 8 min later.

## Log queries

```
jsonPayload.event=("prewarm_scheduled" OR "prewarm_applied")
timestamp>="2026-10-09T13:38:00Z" timestamp<="2026-10-09T13:47:00Z"
```

```
jsonPayload.correlationId="5ae9f875-52d9-4b0c-9c8e-4d66d96314c9"
```

## For the live demo

`node e01.cjs` (≈ 3 min to the opening, 8 to the close). Show:

```bash
gcloud run services describe aforo-queue --region southamerica-east1 \
  --format='value(metadata.annotations."run.googleapis.com/minScale")'   # empty = 0
gcloud tasks list --queue prewarm-windows --location southamerica-east1
```

Each run adds a published demo event to the catalog (there is no delete), so the event list grows
by one; name it clearly.
