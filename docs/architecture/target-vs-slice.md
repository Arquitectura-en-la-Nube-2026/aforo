# Target architecture (Entrega 3) vs. this prototype

The prototype is a slice of the Entrega 3 design. This table tells you what is simplified, so you
don't build the target by accident and you know where the hook for it is.

| Concern | Target (Entrega 3) | Prototype | Way back |
| ------- | ------------------ | --------- | -------- |
| Ingress | Global L7 load balancer + Cloud CDN + Cloud Armor (WAF, rate limit), created per sales window | Browser hits the Gateway directly; Gateway applies per-IP quota | Add LB in Terraform in front of `web` and `gateway` |
| Identity | Identity Platform (OIDC), Gateway validates against JWKS | Gateway issues HS256 JWT with OIDC claims (D-06) | Replace token validation in the Gateway; drop `/auth/login` |
| Queue pass | ES256-signed pass, key in Secret Manager, verified locally by Inventory | Opaque token in Redis, forwarded as `X-Queue-Pass`, never verified (D-07) | Sign in Queue, verify in Orders/Inventory — two endpoints, half a day |
| Bot protection | reCAPTCHA Enterprise before joining the queue | None | — |
| Queue store | Memorystore for Redis, per window, with replica | Memorystore Basic (no replica), created only for live tests and demos (ADR-0001) | Standard tier in Terraform |
| Database | Cloud SQL, window profile 100 conns + standby in zone b | One `db-f1-micro`, three databases, single zone; 25 connections split by instance caps × pools (ADR-0005) | Terraform profile |
| Network | VPC, private IPs, Cloud NAT for egress, internal ingress for logic services | One VPC used only by `queue` → Memorystore (Direct VPC egress); Cloud Run private via IAM; Cloud SQL via connector | Extend the VPC to every service, add NAT |
| Payments | Wompi with circuit breaker, timeouts, retries | Mock payment gateway as a Cloud Run **function**; Orders' adapter keeps circuit breaker, timeouts, retries (D-16, D-18) | Implement a Wompi adapter |
| Ticket issuance, notifications | Services with their own queues and DLQs | Out; `OrderPaid` topic exists with no subscriber | Add subscriber, no change in Orders |
| Observability | Logs, traces, metrics, alerts | Structured JSON logs with correlation ID + DLQ alert via `dlq-monitor` function (D-17) | Add OpenTelemetry + error-rate alerts |
| Compute model | Serverless containers only (FaaS rejected for SSE and connection pools, §5.2) | Same containers for every service; **two FaaS components** for designed tactics where those limits don't apply: `prewarmer` (E-01) and `dlq-monitor` (E-05) (D-21) | — |
| Load-dependent tactics | Pre-warming, connection cap, multi-zone, load tests | Pre-warming kept (`prewarmer`, minimum 1 instead of 2–3, warm for at most 1 h); connection cap kept as dev sizing (ADR-0005); multi-zone and load tests dropped | Raise the warm minimums in `TARGET_SERVICES` |

Design sources (Spanish): Entrega 3 PDF and the implementation plan. Store copies in
`docs/design/` if the team wants them versioned.
