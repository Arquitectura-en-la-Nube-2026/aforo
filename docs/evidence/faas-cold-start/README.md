# FaaS cold start and execution time

**Target:** report each function's cold start and execution time; functions keep cold start
small (no NestJS, CLAUDE.md).

Numbers are Cloud Run request latency (`httpRequest.latency`) of the function's own request log;
"cold" is the request that triggered `Starting new instance`.

| Function | Cold (first after idle) | Warm | When | Source |
| -------- | ----------------------: | ---: | ---- | ------ |
| `prewarmer` (FaaS #1) | 543 ms | 3–6 ms | Oct 9, 13:27 UTC | E-05 poison run, 5 deliveries ([e05](../e05-observability/)) |
| `dlq-monitor` (FaaS #2) | 1 077 ms | 4–6 ms | Oct 9, 13:28 UTC | E-05 poison run, 3 dead letters ([e05](../e05-observability/)) |
| `mock-payment-gateway` (test double) | ~2.8 s (`POST /payments`, new revision) | 120 ms | Oct 9, 03:32 UTC | E-06 recovery ([e06](../e06-circuit-breaker/)) |

Warm calls on the poison message are short because the handler rejects it right away; a real
`EventPublished` on `prewarmer` also calls the Cloud Run Admin API (pending: measure in E-01).

Query (change the service name):

```
resource.type="cloud_run_revision"
resource.labels.service_name="aforo-dlq-monitor"
(httpRequest.latency:* OR textPayload:"Starting new instance")
timestamp>="2026-10-09T13:26:50Z" timestamp<="2026-10-09T13:29:00Z"
```
