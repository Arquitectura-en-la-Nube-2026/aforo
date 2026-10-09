# FaaS cold start and execution time

**Target:** report each function's cold start and execution time (FaaS #1 `prewarmer` < 1 s ✅,
FaaS #2 `dlq-monitor` measured; the mock is a test double and misses < 1 s on its first payment); functions keep cold start
small (no NestJS, CLAUDE.md).

Numbers are Cloud Run request latency (`httpRequest.latency`) of the function's own request log;
"cold" is the request that triggered `Starting new instance`.

| Function | Cold (first after idle) | Warm | When | Source |
| -------- | ----------------------: | ---: | ---- | ------ |
| `prewarmer` (FaaS #1) | 543 ms | 3–6 ms | Oct 9, 13:27 UTC | E-05 poison run, 5 deliveries ([e05](../e05-observability/)) |
| `dlq-monitor` (FaaS #2) | 1 077 ms | 4–6 ms | Oct 9, 13:28 UTC | E-05 poison run, 3 dead letters ([e05](../e05-observability/)) |
| `mock-payment-gateway` (test double) | 2.8 s (first `POST /payments` on a fresh instance: lazy Firestore + Cloud Tasks clients) | 120 ms | Oct 9, 03:32 UTC | E-06 recovery ([e06](../e06-circuit-breaker/)) |

Warm calls on the poison message are short because the handler rejects it right away. With real
work (E-01, Oct 9 13:38–13:46 UTC, [e01](../e01-prewarming/)), `prewarmer`'s execution time is
dominated by the Google APIs it calls, not by its own start:

| `prewarmer` route | Calls | Execution time |
| ----------------- | ----- | -------------: |
| `POST /events/prewarmer-event-published` | 2 × Cloud Tasks create | 1.15 s |
| `POST /windows/warm` | 2 × Cloud Run Admin get + patch | 1.61 s |
| `POST /windows/cool` | Cloud Tasks list + 2 × Cloud Run Admin get + patch | 2.08 s |

All well inside the 30 s function timeout, and none of it is on a buyer's path.

Query (change the service name):

```
resource.type="cloud_run_revision"
resource.labels.service_name="aforo-dlq-monitor"
(httpRequest.latency:* OR textPayload:"Starting new instance")
timestamp>="2026-10-09T13:26:50Z" timestamp<="2026-10-09T13:29:00Z"
```
