# Scope of the slice

One path, complete and deployed: the buyer logs in, sees the catalog, joins the waiting room,
receives a pass, reserves seats, pays against a mock and sees the paid order.
**No other path is built, not even partially.**

The final delivery is judged on a complete, working prototype — not on design coverage.
Nothing enters scope unless it appears in the acceptance script ([acceptance.md](acceptance.md)).

## Components

| C&C component                     | In slice | Notes                                                                 |
| --------------------------------- | :------: | --------------------------------------------------------------------- |
| SSR frontend                      | Yes      | Simulated login, catalog, detail, queue, selection, mock payment, my orders |
| API Gateway                       | Yes      | Issues and validates the session token, generates correlation ID, routes |
| Catalog & events                  | Yes      | No organizer UI: events are loaded via API or seed                    |
| Waiting room & admission          | Yes      | Position, paced admission, pass with expiry                           |
| Orders & checkout                 | Yes      | Saga, outbox, payment adapter with circuit breaker (D-18)             |
| Inventory & reservations          | Yes      | Reserve, confirm, release, expire                                     |
| Event bus                         | Yes      | Pub/Sub, 4 topics, push subscriptions with DLQ                        |
| Expiry queue                      | Yes      | Cloud Tasks with delayed delivery + one-minute sweep (ADR-0003)       |
| Payment gateway (mock)            | Yes      | FaaS component outside Orders, with fault injection (D-16)            |
| DLQ monitor                       | Yes      | FaaS component, alert on dead letters (D-17)                          |
| Managed identity                  | No       | Simulated login in the Gateway; Identity Platform only if time allows |
| Pass verification in Orders/Inventory | No   | The queue orders and admits, but nobody validates the pass downstream |
| Managed edge, CDN, WAF, CAPTCHA   | No       | The browser talks directly to the Gateway                             |
| Ticket issuance                   | No       | `OrderPaid` is published but nobody consumes it                       |
| Notifications (+ queue and DLQ)   | No       | Entirely out                                                          |
| Gate validation                   | No       | Entirely out                                                          |

## Requirements covered

- Covered: RF-01 to RF-05, RF-08 to RF-12, and the orders half of RF-14.
- Partial: **RF-06** — a pass with expiry is issued, but since nobody verifies it downstream, a
  reservation sent without a pass is not rejected.
- Out: RF-07, RF-13, RF-15 to RF-26.

### Biggest conscious deviation from Entrega 2

Without pass verification, **RD-04 is not met**: any valid session can call `/orders` without
going through the queue; the waiting room is a UI control, not a system control. Say so openly
in the presentation, with the way back: verifying the pass is two endpoints and half a day, and
the contract already leaves the hole (`X-Queue-Pass` header).

## Tactics kept from Entrega 3

Kept because the happy path needs them to be correct: transactional outbox, idempotent consumer,
idempotency key, correlation ID, health checks, timeouts.

Added for Delivery 4, because the guide requires a tactic that is **demonstrable on the running
system**: circuit breaker + retry with backoff and jitter on the payment adapter (E-06), DLQ
alert (E-05). See [delivery-4.md](delivery-4.md).

Kept because they cost only configuration: aggregate concurrency limit (instance caps × DB
pools, E-02, ADR-0005) and the in-memory store created per window by IaC (E-07, ADR-0001).

Dropped because they are only verifiable under load, not in a functional demo: pre-warming,
multi-zone replica, window-sized DB profile, error-rate alerts, load tests.

## Relation to the target architecture

The target design (Entrega 3: WAF, Identity Platform, ES256 signed pass, Memorystore, VPC + NAT,
ticket issuance, notifications) is summarized in
[../architecture/target-vs-slice.md](../architecture/target-vs-slice.md).
