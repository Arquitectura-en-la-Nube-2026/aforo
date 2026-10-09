# Runbook · Live demo in class

> Owner: Platform (Julián). Every step below ran on `dev` on Oct 8–9; the results and log queries
> are in [docs/evidence/](../evidence/README.md). If a live step fails, open its evidence folder
> and show the recorded run instead: say so, and move on.

Two roles: the **presenter** talks and clicks the web; the **operator** runs the terminal and the
Cloud console. All scripts are Node 24 and need no credentials beyond `gcloud` login; the `make`
targets that change Terraform switches (`up`, `down`, `redis-up`, `fault`) need Terraform on the
operator's machine.
The scripts append to the `run.log` of their evidence folder: after a rehearsal or the class,
`git checkout docs/evidence` unless that run is meant to be kept.

## The URL to open

Always **https://aforo-web-68220265740.southamerica-east1.run.app**. The other URL Cloud Run shows
(`…-u3phfgwoza-rj.a.run.app`) breaks CORS and the return from payment.

## The day before

1. `make up`, `make redis-up`.
2. Deploy anything merged since the last deploy (`make deploy SERVICE=<unit>`). `make deploy`
   can print the *previous* run as "already completed"; if so, `gh run list --workflow
   service-<unit>.yml --limit 1` and `gh run watch <id>`.
3. Full rehearsal with this runbook, recorded (it is the fallback video). Then `make down`.

## Demo day, 30 minutes before

| Check | How |
| ----- | --- |
| Environment on | `make up`, `make redis-up` (Memorystore takes ~10 min) |
| No fault left on | `make status` → `mock_fault_mode=none` |
| Three seeded events listed | Open the web; "Festival Estéreo 2026" shows "Venta abierta" |
| Queue warm | Open the waiting room once (the first join after idle takes ~4 s) |
| "Noche de Jazz" Mesa has 10 seats | `curl -s https://aforo-gateway-68220265740.southamerica-east1.run.app/api/v1/events/8f1b2c3d-0000-4000-8000-000000000003/availability` |
| Fresh buyer emails | The per-person maximum is 4: use a new email for each live purchase |

Tabs to open (project `aforo-dev-teamf`):

1. The web, logged out.
2. Logs Explorer, empty (queries below are pasted live into the **query editor**, not the search
   bar; a `timestamp` in the query overrides the time picker).
3. Monitoring → Alerting.
4. Cloud Run → `aforo-gateway` and `aforo-queue` (to show minimum instances).
5. A terminal at the repo root.

## Order (≈ 25 min)

The slow scenarios start first and pay off later, while the fast ones run in between.

| Min | Who | What | Pays off at |
| --: | --- | ---- | ----------- |
| 0 | operator | **E-05** poison message | ~4 min |
| 1 | operator | **E-01** demo event (opens in 3 min, closes in 8) | 4 and 9 min |
| 2 | presenter | **Happy path** in the web | now |
| 6 | operator | E-05: dead letters and the alert | now |
| 7 | operator | E-01: minimum instances at 1, join at the opening | now |
| 8 | operator | **E-02** 200 buyers on 10 seats | now; expiry at ~16 min |
| 10 | operator | **E-06** circuit breaker | ~5 min with the two `make fault` |
| 15 | operator | **Fails well** | now |
| 16 | operator | **Expiry**: E-02's seats came back, orders `EXPIRED` | now |
| 17 | operator | E-01: back to 0 at the close | now |
| 18 | operator | **Deployment**: revisions per digest, rollback | now |
| 22 | presenter | Cost and wrap-up | — |

### 0 · E-05 · A bad message raises an alert (start)

```bash
make poison TOPIC=aforo.catalog.event-published
```

Say: the topic has three consumers (inventory, queue, `prewarmer`); each will reject it with `400`,
Pub/Sub retries 5 times with backoff, then moves it to that consumer's DLQ, `dlq-monitor`
(FaaS #2) logs it and an alert fires. Note the printed `correlationId`.

### 1 · E-01 · Pre-warming (start)

```bash
node docs/evidence/e01-prewarming/e01.cjs    # creates "Demo pre-warming (E-01)", publishes it
```

Say: the opening time comes from the catalog, so the platform warms the entry path before the
crowd arrives and lets it scale to zero the rest of the time. Each run leaves one more demo event
in the catalog (there is no delete).

### 2 · Happy path (acceptance steps 1–9)

Presenter, in the web, with a fresh email:

1. Login → three events → "Festival Estéreo 2026".
2. "Entrar a la fila" → position → "Es tu turno" (≈ 2 s).
3. General × 2 → confirm → order `PENDING_PAYMENT`; availability dropped by 2.
4. Pay in the mock → back to the order → `PAID` (≈ 5 s).
5. "Mis pedidos" lists it as "Pagado".

Step 10 (operator): take the order id from the URL and follow it. Paste:

```
resource.labels.service_name=("aforo-gateway" OR "aforo-orders" OR "aforo-inventory")
httpRequest.requestUrl=~"orders|reservations"
timestamp>="<a minute before the purchase, UTC>"
```

then click a line's `correlationId` → "Show matching entries". Recorded version:
[happy-path/10-trace.png](../evidence/happy-path/10-trace.png),
[10b-orderpaid.png](../evidence/happy-path/10b-orderpaid.png).

Fallback: [docs/evidence/happy-path/](../evidence/happy-path/) (screenshots of every step).

### 6 · E-05 · Payoff

```
jsonPayload.correlationId="<the id make poison printed>"
```

Shows the `400`s from the three consumers and three `dead_letter` lines. Then Monitoring →
Alerting: incident **aforo: message dead-lettered** (≈ 3.5 min after publishing; ~2 min after the
dead letters) and the email. Recorded: [e05-observability/](../evidence/e05-observability/).

### 7 · E-01 · Payoff

```bash
gcloud run services describe aforo-queue --region southamerica-east1 \
  --format='value(metadata.annotations."run.googleapis.com/minScale")'   # 1 now, empty = 0
gcloud tasks list --queue prewarm-windows --location southamerica-east1   # the cool-… task
```

and `jsonPayload.event=("prewarm_scheduled" OR "prewarm_applied")`. The script prints the
queue-join latency at the opening (550 ms recorded, vs ~4 s cold).
Recorded: [e01-prewarming/](../evidence/e01-prewarming/).

### 8 · E-02 · Zero overselling

```bash
node docs/evidence/e02-concurrency/e02-gateway.cjs 200          # all at once
```

Prints `answers: {"201":10,"409 SOLD_OUT":190}` and `oversold=0`. Say: the conditional decrement
lets exactly 10 through; under a 200-at-once spike p95 in inventory misses 300 ms (808 ms
recorded), metered like the waiting room releases buyers it is 75 ms; that is why the queue exists.
The 10 orders stay unpaid on purpose: they are the expiry demo. Recorded:
[e02-concurrency/](../evidence/e02-concurrency/).

### 10 · E-06 · Circuit breaker

```bash
make fault MODE=timeout                                # ~1 min; explain meanwhile:
                                                       # 2 s timeout, 3 attempts, opens after 5, 30 s reset
node docs/evidence/e06-circuit-breaker/e06.cjs trip    # ~6.7 s, ~4.8 s, then ~0.2 s each: open
make fault MODE=none                                   # ~1 min
# open the mock once (or wait 30 s) so the half-open probe does not hit its cold start
node docs/evidence/e06-circuit-breaker/e06.cjs recover # 503 until it closes, then 201
```

Logs: `jsonPayload.event=("circuit_state" OR "payment_retry")` → `CLOSED → OPEN`, later
`OPEN → HALF_OPEN → CLOSED`. Recorded: [e06-circuit-breaker/](../evidence/e06-circuit-breaker/).

### 15 · Fails well

```bash
node docs/evidence/fails-well/fails-well.cjs
```

Prints `409 SOLD_OUT` (Palco stays at 2), `409 LIMIT_EXCEEDED`, and the replay with
`Idempotent-Replayed: true` and the same `orderId`. It takes 4 Palco seats for 8 min: run it once.
The duplicate webhook is the recorded retry storm in
[fails-well/](../evidence/fails-well/) (a hand-made one is impossible without the mock's secret).

### 16 · Expiry

Availability of "Noche de Jazz" Mesa is back to 10 (8 min after E-02); the orders are `EXPIRED`:

```
resource.labels.service_name="aforo-inventory"
httpRequest.requestUrl=~"/expire"
```

Recorded: [reliability-expiry/](../evidence/reliability-expiry/).

### 17 · E-01 · Back to zero

The same `describe` shows empty (0); `prewarm_applied` shows `COOL 1 → 0` for both services.

### 18 · Deployment (D-19)

Do not deploy live unless there is time (≈ 3 min); show the recorded run instead:
[deployment/](../evidence/deployment/) (pipeline steps, migrate job, no-traffic revision, smoke
test, shift). Live, only the rollback, which takes seconds:

```bash
gcloud run revisions list --service aforo-orders --region southamerica-east1
gcloud run services update-traffic aforo-orders --region southamerica-east1 --to-revisions <previous>=100
gcloud run services update-traffic aforo-orders --region southamerica-east1 --to-latest
```

### 22 · Cost and wrap-up

Everything scales to zero and `make down` stops Cloud SQL and deletes Memorystore; the evidence is
in [e07-cost/](../evidence/e07-cost/).

## Known gotchas

| Symptom | Cause | Do |
| ------- | ----- | -- |
| First queue join takes ~4 s | Queue scaled to zero | Warm it before class (checklist) |
| E-06 recovery re-opens once | Half-open probe hit the mock's new revision cold (2.8 s > 2 s timeout) | Open the mock once after `make fault MODE=none` |
| Alert not visible yet | Log-based alert lags ~2 min after the dead letters | Show the `dead_letter` lines first |
| `LIMIT_EXCEEDED` on a live purchase | Same email bought 4 already | New email |
| E-02 prints fewer than 10 created | Mesa seats still held by a previous run | Wait for expiry (8 min) or show the recorded run |
| `make deploy` says "already completed" | It watched the previous run | `gh run list` + `gh run watch <id>` |

## After the presentation

`make down`. The environment is not left on for later review.
