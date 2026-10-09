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

## Run on `dev` through the gateway (Oct 9, 13:11 UTC)

**How:** [e02-gateway.cjs](e02-gateway.cjs): 200 buyers log in, then all 200 send
`POST /api/v1/orders` (1 seat, "Mesa" of "Noche de Jazz", 10 seats) at the same moment, through
the public gateway → orders → inventory, as a real sale. The burst skips the waiting room: the
queue pass is not verified downstream (D-07). Services warmed with three calls first.
Raw output: [run-dev.log](run-dev.log), every answer in [run-dev.json](run-dev.json), the 10
orders in [created.txt](created.txt).

Deployed: gateway and web `6e69b9f`, orders and inventory `a44ee7e`.

| Created | SOLD_OUT | Other | Available before → after | **Oversold** |
| :-----: | :------: | :---: | :----------------------: | :----------: |
| 10 | 190 | 0 | 10 → 0 | **0** ✅ |

Latency per hop, from each service's request log (`httpRequest.latency`):

| Service | Requests | p50 | **p95** | max | Instances |
| ------- | :------: | --: | ------: | --: | :-------: |
| inventory (`POST /internal/v1/reservations`) | 200 | 632 ms | **808 ms** ❌ | 1 275 ms | 1 |
| orders (`POST /api/v1/orders`) | 200 | 658 ms | 1 264 ms | 1 796 ms | 1 |
| gateway (`POST /api/v1/orders`) | 200 | 994 ms | 1 643 ms | 3 580 ms | 3 (2 cold starts) |

The client in Bogotá saw p50 5.1 s / p95 5.9 s: 200 TLS connections opened at once from one
laptop, plus the gateway scaling from 1 to 3 instances.

### Same 200 buyers, metered (13:21 UTC)

The waiting room admits buyers in batches and they then take time to pick seats, so a real sale
reaches inventory spread out. Same test, the 200 orders sent evenly over 10 s (20/s):
`node e02-gateway.cjs 200 10000`, output in [run-dev-spread10000.json](run-dev-spread10000.json).

| Created | SOLD_OUT | Available before → after | **Oversold** |
| :-----: | :------: | :----------------------: | :----------: |
| 10 | 190 | 10 → 0 | **0** ✅ |

| Service | p50 | **p95** | max | Instances |
| ------- | --: | ------: | --: | :-------: |
| inventory | 24 ms | **75 ms** ✅ | 380 ms | 1 |
| orders | 42 ms | 291 ms | 887 ms | 1 |
| gateway | 57 ms | 364 ms | 958 ms | 1 |

Client from Bogotá: p50 238 ms, p95 542 ms.

**Reading:** the guarantee holds under a real burst: the conditional decrement let exactly 10
through and answered the rest `SOLD_OUT`. The p95 target is missed when all 200 transactions land
in the same instant on one inventory instance with a pool of 2 connections (ADR-0005): requests
wait for a connection, and the dev Cloud SQL is the smallest tier. Locally, with the same pool,
p95 was 169 ms. Metered at 20/s, the way the waiting room releases buyers, inventory's p95 is
75 ms. That is the argument for the queue in front of the purchase (E-03): it turns a spike that
inventory cannot absorb within target into a rate it serves in tens of milliseconds, while the
conditional decrement keeps overselling at zero either way.

Log query (any hop; change the service name):

```
resource.type="cloud_run_revision"
resource.labels.service_name="aforo-inventory"
httpRequest.requestUrl=~"reservations"
timestamp>="2026-10-09T13:11:58Z" timestamp<="2026-10-09T13:12:10Z"
```

## Rerun on `dev`

```bash
node e02-gateway.cjs 200   # needs the 10 seats back: the reservations expire after 8 min
```
