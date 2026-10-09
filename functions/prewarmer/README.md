# prewarmer — FaaS #1 (Pub/Sub push + Cloud Tasks, HTTP)

> Owner: Julián (Platform) · Contract: [contracts/openapi/prewarmer.yaml](../../contracts/openapi/prewarmer.yaml)
> Consumes: `EventPublished` ([contracts/events](../../contracts/events/README.md))
> Decision: D-21 · Status: implemented and demonstrated on dev (Oct 9, [evidence](../../docs/evidence/e01-prewarming/))

Realizes the Entrega 3 E-01 tactic **"pre-warming per sales window"**: the entry path already has
instances running when a sale opens, because the opening time comes from the catalog. It fixes
the containers' cold start at the one moment it matters, and lets the rest of the time scale to
zero (E-07). No functional scope: buyers see nothing different.

## Behavior

**1. `POST /events/prewarmer-event-published`** (push subscription on `aforo.catalog.event-published`)

1. Not a valid envelope → `400` (dead-letters, so `dlq-monitor` sees it). Uses only the payload:
   never calls Catalog.
2. `warmAt = salesOpensAt − PREWARM_LEAD_SECONDS`;
   `coolAt = min(salesClosesAt, salesOpensAt + PREWARM_HOLD_SECONDS)` (the spike is at the opening,
   so instances are not kept warm for a weeks-long window).
3. `coolAt <= now` → nothing to do. `warmAt > now + 30 days` (Cloud Tasks limit) → log and skip:
   the seed re-emits the event on every `make up`, so it gets scheduled later.
4. Create two **named** tasks on queue `prewarm-windows`, targeting this function:
   - `warm-{eventId}-{epoch(salesOpensAt)}` at `max(warmAt, now)` → `POST /windows/warm`
   - `cool-{eventId}-{epoch(salesClosesAt)}` at `coolAt` → `POST /windows/cool`

   `ALREADY_EXISTS` counts as success (the seed re-emits events; a published window never
   changes). Answer `204`. Transient API errors → `503` (Pub/Sub retries).

**2. `POST /windows/warm`** (Cloud Tasks) — for each target in `TARGET_SERVICES`, set the
service-level `scaling.minInstanceCount` to `max(current, target)`.

**3. `POST /windows/cool`** (Cloud Tasks) — list the pending tasks of `prewarm-windows`. If another
event's window is still open (its `cool-*` task is pending and its `warm-*` task is not), keep
the instances; otherwise set `minInstanceCount` back to `BASELINE_MIN_INSTANCES` (0).
**The queue is the state**: no store, no memory between invocations.

Every change logs one line: `event=prewarm_applied`, `action`, `service`, `from`, `to`,
`eventId`, `correlationId`.

## Targets (dev)

| Service | Warm minimum | Why |
| ------- | :----------: | --- |
| `aforo-gateway` | 1 | Every request enters through it |
| `aforo-queue` | 1 | Joining the queue is the opening spike (E-01) |

Entrega 3 §6.4 says 2 and 3 for a real window; dev uses 1 to keep cost low (≈ one hour per
demo window, `PREWARM_HOLD_SECONDS`). Terraform does **not** manage these services' service-level
`min_instance_count`: this function owns it (ADR-0004, amended by D-21).

## FaaS constraints (Lab 5 phases)

| Phase | How it is handled |
| ----- | ----------------- |
| Granularity | One responsibility: open and close warm windows. Three routes, one concern |
| Trigger and contract | Pub/Sub push (event) + Cloud Tasks (delayed), both OIDC; OpenAPI in `contracts/` |
| State externalization | None kept: the window lives in the event payload and in the pending tasks |
| Idempotency | Named tasks dedupe scheduling; `warm` raises to a target (repeatable); `cool` re-checks the queue |
| Resilience and limits | Timeout 30 s; `max_instance_count = 1`, concurrency 1, so warm/cool never race |
| Cold start | No SDK clients: Cloud Run Admin and Cloud Tasks REST calls through `google-auth-library`, created lazily in module scope; single bundled file. Target < 1 s; measured on dev: **543 ms** cold, 3–6 ms warm ([numbers](../../docs/evidence/faas-cold-start/)) |

Delays are never `sleep`s: Cloud Tasks holds the time.

## Demo (E-01)

Create an event through the organizer API that opens in 3 minutes and closes in 8, publish it,
and show `aforo-gateway` and `aforo-queue` minimum instances go to 1 right away (the warm time is
already past) and back to 0 at the close. Steps in [docs/runbooks/demo.md](../../docs/runbooks/demo.md).

## Implementation

| File | What |
| ---- | ---- |
| `src/window.ts` | Pure logic: envelope and task-body parsing, window math, task names, the "another window open" rule |
| `src/handlers.ts` | The three routes, with Cloud Tasks / Cloud Run calls injected (unit-tested with a fake) |
| `src/gcp.ts` | REST calls through one lazily created `GoogleAuth`; service-level minimum set with `PATCH …?updateMask=scaling.minInstanceCount` (verified: no new revision, other fields untouched) |
| `src/index.ts` | `prewarmer` HTTP entry point and routing; Google API failures → `503` |

- Task callbacks and pushes use the function's deterministic URL (`SELF_URL`) as the OIDC
  audience, because Cloud Run functions have no custom audiences.
- Terraform: `aforo-prewarmer` in `infra/envs/dev/functions.tf` (timeout 30 s, max 1 instance,
  concurrency 1) and the `prewarmer-event-published` subscription in `messaging.tf`.

```bash
npm test --workspace functions/prewarmer
npm run build --workspace functions/prewarmer
```

## Permissions

Service account `aforo-prewarmer-run`: `roles/run.developer` **only** on `aforo-gateway` and
`aforo-queue`, `roles/iam.serviceAccountUser` on their runtime service accounts (required to
update a service), enqueue/list on `prewarm-windows`, and act-as on the Cloud Tasks invoker
service account. Only the Pub/Sub push SA and the Cloud Tasks SA may invoke it.

## Risks

- Service-level minimum instances (`scaling.minInstanceCount`) must be available through the
  Admin API and the Terraform provider in our versions; check on day one. Fallback: patch the
  revision template's minimum (creates a revision; traffic follows latest, ADR-0004).

## Configuration

See [.env.example](.env.example).
