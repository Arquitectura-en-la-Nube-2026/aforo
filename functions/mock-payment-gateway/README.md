# mock-payment-gateway — function standing in for the payment gateway (HTTP)

> Owner: Daniel Felipe (with Orders) · Contract: [contracts/openapi/mock-payment-gateway.yaml](../../contracts/openapi/mock-payment-gateway.yaml)
> Decision: D-16 (replaces D-09), amended by D-21 · Status: not started
>
> Built as a Cloud Run function and following the same FaaS rules, but it is a **test double for
> an external system**, so it is not presented as one of Aforo's FaaS components (those are
> `prewarmer` and `dlq-monitor`, D-21).

Stands in for the external payment gateway (Wompi in the target design). It lives **outside**
Orders so that Orders' payment adapter is a real Anti-Corruption Layer and its circuit breaker
protects against a real network dependency. When Wompi arrives, only Orders' adapter changes.

## Endpoints

| Endpoint | Caller | Does |
| -------- | ------ | ---- |
| `POST /payments` | Orders (service auth) | Create a payment for an order, return `checkoutUrl` |
| `POST /payments/{paymentId}/refunds` | Orders (service auth) | Refund an approved payment (idempotent) |
| `GET /checkout/{paymentId}` | Browser, via Gateway `/mock-gateway/**` | HTML page with **Pay** / **Decline** |
| `GET /checkout/{paymentId}/complete?outcome=` | Browser | Enqueue signed webhook (+2 s) and redirect to the order |
| `POST /webhook-dispatch` | Cloud Tasks (service auth) | Send the signed notification to Orders' webhook |

## Rules

- **Stateless:** payment state lives in Firestore (collection `payments`) — or, if the team
  prefers fewer resources, it is encoded in a signed `paymentId`-bound record; decide at the
  freeze. (Firestore adds a third persistence paradigm: document store.)
- **Delayed webhook without background work:** `complete` creates a Cloud Tasks task on queue
  `payment-webhooks` with `scheduleTime = now + 2 s` and name = `notificationId`, then redirects.
  The task calls `/webhook-dispatch`, which signs the body
  (`X-Signature: sha256=<HMAC(raw body, WEBHOOK_SECRET)>`) and POSTs it to `ORDERS_WEBHOOK_URL`.
  If Orders answers non-2xx, `/webhook-dispatch` answers non-2xx too, so Cloud Tasks retries
  (Orders processes the webhook synchronously, ADR-0002).
- **Fault injection (D-18):** env `FAULT_MODE` = `none` | `error` (HTTP 503) | `timeout`
  (sleeps `FAULT_DELAY_MS`, default 5000, before answering) applied to `POST /payments`.
  `FAULT_MODE` is the Terraform switch `mock_fault_mode`: change it only with
  `make fault MODE=timeout` (about a minute; Terraform updates the env and a new revision takes
  traffic). Never with `gcloud` (ADR-0004).
- Idempotency: `POST /payments` and refunds honor `Idempotency-Key`.

## FaaS constraints

| Constraint | How it is handled |
| ---------- | ----------------- |
| Cold start | Single bundled file, no framework, Firestore/Tasks clients lazily created in module scope. Target < 1 s; measure and record here |
| Execution time | Timeout 30 s. The 2 s delay is **not** a sleep: it's a Cloud Tasks schedule |
| Deployment | CI uploads `<sha>.zip` and runs `gcloud functions deploy --source gs://…/<sha>.zip` (no env flags; config is Terraform's). All-at-once, rollback with `update-traffic` (ADR-0004) |
| Statelessness | No module-level state except SDK clients |

## Configuration

See [.env.example](.env.example).
