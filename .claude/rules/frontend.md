---
paths:
  - "apps/web/**"
---

# Frontend rules (Next.js + SSR)

- Seven screens only (see `apps/web/README.md`). No new screens without a scope decision.
- Use an existing component library; do not design a custom visual system.
- SSR only for public routes `/` and `/events/:id`. Queue, buy and orders render client-side.
- All HTTP goes through the Gateway (`API_BASE_URL`). Never call a service URL directly.
- One API client (the only place that calls `fetch`) adds `Authorization`, `X-Correlation-Id`
  (if you create one), and `X-Queue-Pass` when a pass exists. A `401` redirects to `/login`.
- The image is built once and configured at runtime (ADR-0004): never use `NEXT_PUBLIC_*`; read
  `API_BASE_URL` on the server and pass it to the browser from the root layout.
- The app answers `GET /health/live` and `GET /health/ready` itself (no auth).
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
