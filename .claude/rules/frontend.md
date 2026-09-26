---
paths:
  - "apps/web/**"
---

# Frontend rules (Angular 20 + SSR)

- Seven screens only (see `apps/web/README.md`). No new screens without a scope decision.
- Use an existing component library; do not design a custom visual system.
- SSR only for public routes `/` and `/events/:id`. Queue, buy and orders render client-side.
- All HTTP goes through the Gateway (`API_BASE_URL`). Never call a service URL directly.
- One HTTP interceptor adds `Authorization`, `X-Correlation-Id` (if you create one), and
  `X-Queue-Pass` when a pass exists. A `401` redirects to `/login`.
- `passToken` lives in memory and is mirrored in `sessionStorage`. The turn countdown uses
  `passExpiresAt`; at zero, go back to the queue. Never auto-renew.
- `Idempotency-Key`: generate once when the buy screen opens (UUID v4), reuse it on every retry
  of that attempt, regenerate only when sector or quantity changes.
- Errors are shown by `code`, never by `detail`. `SOLD_OUT`, `LIMIT_EXCEEDED`,
  `RESERVATION_EXPIRED` have their own messages; anything else shows a generic message **with the
  `correlationId` visible**.
- Order detail polls `GET /orders/{id}` every 2 s while `status === 'PENDING_PAYMENT'`.
- The frontend never compares dates to decide if a sale is open: it uses `saleState`.
- Generate API types from `contracts/openapi/*.yaml`; do not hand-write response interfaces.
