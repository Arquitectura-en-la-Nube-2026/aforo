# Contracts

Single source of truth for how units talk to each other. **Code must match these files.**

| File | What |
| ---- | ---- |
| [conventions.md](conventions.md) | Normative rules for every service: routes, headers, identity, idempotency, errors, formats, logs |
| [openapi/gateway.yaml](openapi/gateway.yaml) | Simulated login (the rest of the Gateway is routing) |
| [openapi/catalog.yaml](openapi/catalog.yaml) | Events, sectors, sales rules |
| [openapi/queue.yaml](openapi/queue.yaml) | Join, status, SSE stream |
| [openapi/orders.yaml](openapi/orders.yaml) | Orders, payment intents, webhook |
| [openapi/inventory.yaml](openapi/inventory.yaml) | Public availability + internal reservation API |
| [openapi/mock-payment-gateway.yaml](openapi/mock-payment-gateway.yaml) | Function standing in for the external payment gateway (D-16, a test double) |
| [openapi/prewarmer.yaml](openapi/prewarmer.yaml) | FaaS that pre-warms the entry path before each sales window (D-21) |
| [openapi/components/common.yaml](openapi/components/common.yaml) | Shared schemas, headers, responses |
| [events/](events/) | Bus topics, envelope and payload JSON Schemas |

**Status: in use.** Every unit implements these files and the purchase path ran against them on
`dev` (Oct 8–9). CI lints them with Redocly (`contracts.yml`); there are no automated contract
tests against deployed revisions.
Rules for changing these files: [`.claude/rules/contracts.md`](../.claude/rules/contracts.md).

## Using them

```bash
make mock SERVICE=inventory     # Prism mock of inventory.yaml on http://localhost:4010
make lint-contracts             # Redocly lint of every OpenAPI file
```

Frontend and services generate types from these files (e.g. `openapi-typescript`), rather than
hand-writing them.

## Points settled at the freeze

Recorded in [docs/plan/decisions.md](../docs/plan/decisions.md) (R-01…R-07) and built as follows:

1. Event types and statuses use the English names of the glossary (R-01).
2. `sub` is the UUID v5 of the lower-cased email (R-02).
3. The mock completes via `GET /mock-gateway/checkout/{paymentId}/complete?outcome=…` (R-03);
   the extra error codes, `PAYMENT_UNAVAILABLE` included, are in `conventions.md` (R-04).
4. The webhook field is `notificationId` (the notification id, not a catalog event).
5. `POST /queue/{eventId}/join` is naturally idempotent per user; `Idempotency-Key` is optional there.
6. The FaaS components are the pre-warmer and the DLQ monitor (D-21), with `prewarmer.yaml` and
   the `prewarmer-event-published` subscription.
7. The ADR-0002…0005 changes are in: `POST /internal/v1/housekeeping` on catalog, inventory and
   orders; `Idempotent-Replayed` (R-06); `422` for schema errors (R-07); the webhook processed
   synchronously with `503` on failure; `expire` conditioned on `expires_at`; consumers answering
   `400` to invalid envelopes.
