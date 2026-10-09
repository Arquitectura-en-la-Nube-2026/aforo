# E-02 · Zero overselling

**Target (Delivery 3):** overselling = 0; p95 reservation ≤ 300 ms.
**Test:** [services/inventory/test/concurrency/](../../../services/inventory/test/concurrency/):
200 concurrent reservations on a sector with 10 seats, real HTTP, a pool of 2 connections
(ADR-0005).

## Local run (Oct 8, embedded Postgres)

| Created | SOLD_OUT | Other | p50 | **p95** | Target |
| :-----: | :------: | :---: | :-: | :-----: | :----: |
| 10 | 190 | 0 | 138 ms | **169 ms** | p95 ≤ 300 ms, overselling = 0 |

The test fails if the seat guard is removed (mutation check), so it really checks overselling.

## Run against `dev` — pending

Seeded event "Noche de Jazz" `8f1b2c3d-0000-4000-8000-000000000003`, sector "Mesa"
`a3a3a3a3-0000-4000-8000-000000000001` (exactly 10 seats). The seats come back when the test's
reservations expire (8 min), so it can run again.

```bash
cd services/inventory
CONCURRENCY_BASE_URL=https://aforo-inventory-68220265740.southamerica-east1.run.app \
CONCURRENCY_EVENT_ID=8f1b2c3d-0000-4000-8000-000000000003 \
CONCURRENCY_SECTOR_ID=a3a3a3a3-0000-4000-8000-000000000001 \
CONCURRENCY_TOKEN=<ID token for audience aforo-inventory> \
node --test test/concurrency/
```

Record here: the printed counts and percentiles, the time, and a screenshot of the availability
afterwards (`GET /api/v1/events/{eventId}/availability` → `available: 0`).
