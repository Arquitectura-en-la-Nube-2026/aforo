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
| [openapi/mock-payment-gateway.yaml](openapi/mock-payment-gateway.yaml) | FaaS stand-in for the external payment gateway (D-16) |
| [openapi/components/common.yaml](openapi/components/common.yaml) | Shared schemas, headers, responses |
| [events/](events/) | Bus topics, envelope and payload JSON Schemas |

**Status: DRAFT — to be frozen on Tue Sept 29 by the contracts owner (Juan José).**
Rules for changing these files: [`.claude/rules/contracts.md`](../.claude/rules/contracts.md).

## Using them

```bash
make mock SERVICE=inventory     # Prism mock of inventory.yaml on http://localhost:4010
make lint-contracts             # Redocly lint of every OpenAPI file
```

Frontend and services generate types from these files (e.g. `openapi-typescript`), rather than
hand-writing them.

## Open points for the freeze

1. Confirm the English names for event types and reservation statuses (see glossary, R-01).
2. Confirm `sub` = UUID v5(email) (R-02).
3. Confirm the mock completion route (R-03) and extra error codes (R-04).
4. The webhook payload field `eventId` (plan) is the **notification id**, not a catalog event.
   Proposal: rename to `notificationId` before the freeze to avoid confusion. Currently drafted
   as `notificationId`.
5. `POST /queue/{eventId}/join` is naturally idempotent per user (re-join returns the same
   position), so `Idempotency-Key` is optional there.
6. Confirm D-16/D-17 (two FaaS components) and the `PAYMENT_UNAVAILABLE` code.
7. Review the changes from ADR-0002…0005 (all compatible, drafted on Sept 26):
   `POST /internal/v1/housekeeping` on catalog, inventory and orders; the
   `Idempotent-Replayed` response header (R-06); `422` vs `400` (R-07); the webhook processed
   synchronously with a `503` on failure; `expire` conditioned on `expires_at`; consumers
   answering `400` to invalid envelopes.
