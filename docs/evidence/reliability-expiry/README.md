# Reliability · Reservation expiry restores seats

**Target:** a reservation not paid within its TTL (8 min) expires on time; the seats return to
availability and the order becomes `EXPIRED`, with no user action and no process running between
requests (ADR-0002).

**When:** Fri Oct 9, 2026, 13:12 → 13:20 UTC.
**What:** the 10 unpaid orders left by the E-02 run on `dev`
([../e02-concurrency/created.txt](../e02-concurrency/created.txt)): "Noche de Jazz", sector
"Mesa", 10 seats, all reserved at 13:12:00.
**Deployed:** orders and inventory `a44ee7e`.

## Chain

```
Cloud Tasks (task created with the reservation, ETA = expiresAt)
  → inventory POST /internal/v1/reservations/{id}/expire     RESERVED → EXPIRED, seats += 1, outbox row
  → outbox flush → Pub/Sub aforo.inventory.reservation-expired
  → push → orders POST /internal/v1/events/orders-reservation-expired   PENDING_PAYMENT → EXPIRED
```

The one-minute housekeeping sweep (Cloud Scheduler) is the backstop if a task is lost; here the
tasks did all the work.

## Result

| Target | Observed |
| ------ | -------- |
| Seats come back at the TTL | ✅ "Mesa" `available` 0 at 13:19:57 → **10 at 13:20:07** |
| Each reservation expires on time | ✅ 10 `POST …/expire` from `Google-Cloud-Tasks`, 13:19:59.286 → 13:20:08.136, all `200` |
| Order becomes `EXPIRED` | ✅ 10 `ReservationExpired` pushes accepted by orders (`204`); `GET /api/v1/orders/7a525ba4-…` as its buyer → `"status":"EXPIRED"` |
| Same `correlationId` end to end | ✅ e.g. `2f9a8a93-…` and `98dad2fe-…`: order creation at 13:12 → expiry push to orders at 13:20 |

Example, order `7a525ba4-0c24-4bac-b793-1d301703dbff`:

| UTC | Hop |
| --- | --- |
| 13:12:00.157 | Order created, `PENDING_PAYMENT`, reservation `7114890c-…`, `expiresAt` 13:19:59.311 |
| 13:20:02.137 | Cloud Tasks → inventory `POST /internal/v1/reservations/7114890c-…/expire` → `200` |
| 13:20:03.598 | `ReservationExpired` pushed to orders → `204` (same `correlationId` `98dad2fe-…` as the order creation) |
| afterwards | `GET /api/v1/orders/7a525ba4-…` as the buyer → `EXPIRED`, `paidAt: null` |

Cloud Tasks delivered the 10 expiries about one second apart (13:19:59 → 13:20:08), each within
seconds of its reservation's `expiresAt` (2.8 s for the example above).

## Log queries

```
resource.type="cloud_run_revision"
resource.labels.service_name="aforo-inventory"
httpRequest.requestUrl=~"/expire"
timestamp>="2026-10-09T13:19:00Z" timestamp<="2026-10-09T13:21:00Z"
```

```
resource.type="cloud_run_revision"
resource.labels.service_name="aforo-orders"
jsonPayload.route="/internal/v1/events/orders-reservation-expired"
timestamp>="2026-10-09T13:19:00Z" timestamp<="2026-10-09T13:21:00Z"
```

## For the live demo

8 minutes is long for a class. Run E-02 (or reserve once without paying) at the start, and come
back to availability and "Mis pedidos" ~8 min later.
