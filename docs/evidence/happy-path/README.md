# Happy path on `dev` (acceptance steps 1–10)

**When:** Thu Oct 8, 2026, 20:04 (Bogotá) · 2026-10-09 01:04 UTC.
**How:** the real web at `https://aforo-web-68220265740.southamerica-east1.run.app`, driven by
Playwright ([purchase.cjs](purchase.cjs)) as user `claude-test@aforo.dev`, with `make up` and
`make redis-up` on. Screenshots in this folder.

Deployed at the time: gateway `04f8e13`, catalog `77eabb4`, orders, inventory and the mock
`a44ee7e`, queue and web `21e03d6`.

## Result

| Step | Acceptance script | Observed | Screenshot |
| ---- | ----------------- | -------- | ---------- |
| 1 | Login with email, get a session | Session issued | [01-login.png](01-login.png) |
| 2 | Three published events; open the one on sale | 3 events: two "Venta abierta", one "Próximamente" | [02-events.png](02-events.png), [02b-detail.png](02b-detail.png) |
| 3 | Join the queue, see the position | Position 1 | [03-queue.png](03-queue.png) |
| 4 | Admitted; buy enabled, pass countdown | "Es tu turno" ~2 s after joining | [04-admitted.png](04-admitted.png) |
| 5 | Pick a sector and two tickets | General × 2 | [05-buy.png](05-buy.png) |
| 6 | Order `PENDING_PAYMENT`; availability drops by two | Order `9f92a640-3cce-45e4-8b1a-cfeff7d6a3c7`; General 198 → 196 | [06-pay.png](06-pay.png) |
| 7 | Pay in the mock, return to the order | Checkout page through `/mock-gateway`, redirected back | [07-mock.png](07-mock.png) |
| 8 | `PAID` in under 5 s | **4.7 s** from clicking Pay to "Pago confirmado" | [08-paid.png](08-paid.png) |
| 9 | Listed in `GET /orders` | "Pagado" in "Mis pedidos" | [09-orders.png](09-orders.png) |
| 10 | Follow it by `correlationId`, including the bus | See below | — |

The mock delivered the payment notification once (`/webhook-dispatch` 204 at 01:05:17 UTC).

## Step 10: following a purchase

The order creation of the first run (order `8dc99ccf-5358-45d6-a80d-4f0b0474f2b5`):

```
jsonPayload.correlationId="ecd0fae3-dcf8-4ec7-a332-3695a82c852e"
```

| UTC | Service | Line |
| --- | ------- | ---- |
| 00:39:18.972 | orders | `queue_pass_received` (`p_XTeL…`, logged, never verified, D-07) |
| 00:39:19.791 | inventory | `POST /internal/v1/reservations` 201 |
| 00:39:19.813 | orders | `POST /api/v1/orders` 201 |
| 00:39:19.818 | gateway | `POST /api/v1/orders` 201 |

The hop through the bus: the seed's facts carry one `correlationId` from catalog to inventory and
the queue (`jsonPayload.event="seed_published"`, then the `inventory-*` and `queue-*` push
deliveries, all `204`).

**Still to capture for the artifact:** the same trace as a Cloud Logging screenshot, and one that
shows `OrderPaid` leaving through the outbox (see the missing list).

## Earlier run (same evening, 00:39 UTC)

Also passed steps 1–10, with `PAID` at 6.1 s (cold calls) and two bugs found and fixed
(`#38` orders image, `#39` webhook 500). A later run hit a queue cold start on the first join
(`#40`). Details in [../../status/2026-10-08-done.md](../../status/2026-10-08-done.md).

## Rerun

```bash
cd docs/evidence/happy-path
npm i playwright   # once, in a scratch folder if preferred
node purchase.cjs  # CHROME=<path to a Chromium> if Playwright's own is not installed
```

It buys 2 tickets each run; the per-person maximum is 4, so change the email after two runs.
