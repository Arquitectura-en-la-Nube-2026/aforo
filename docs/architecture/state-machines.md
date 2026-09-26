# State machines of lifecycle entities

Normative. Every transition is implemented as a **conditional update** on the current state
(`UPDATE … SET status = :to WHERE id = :id AND status = :from`), so concurrent actors cannot both
win. Any transition not drawn here is a bug. Each service has tests for every arrow.

## Reservation (inventory)

```mermaid
stateDiagram-v2
  [*] --> ACTIVE: reserve (seats decremented)
  ACTIVE --> CONFIRMED: confirm (buyer total += quantity)
  ACTIVE --> EXPIRED: expire (Cloud Tasks) — seats restored, ReservationExpired published
  ACTIVE --> RELEASED: release — seats restored
  CONFIRMED --> [*]
  EXPIRED --> [*]
  RELEASED --> [*]
```

- `confirm` and `expire` race for `ACTIVE`; whoever updates one row wins, the other returns the
  final state. Repeating any transition returns the current state (idempotent).
- `expire` also requires `expires_at <= now()` (Entrega 2 §5.4). It is triggered by Cloud Tasks
  and, as a safety net, by the one-minute housekeeping sweep (ADR-0003).
- Terminal states never change. An expired reservation is **never** reactivated (ADR-03).

## Order (orders)

```mermaid
stateDiagram-v2
  [*] --> PENDING_PAYMENT: create (reservation ACTIVE)
  PENDING_PAYMENT --> PAID: webhook APPROVED + confirm → CONFIRMED (OrderPaid via outbox)
  PENDING_PAYMENT --> REFUND_PENDING: webhook APPROVED + confirm → EXPIRED (refund requested)
  PENDING_PAYMENT --> EXPIRED: ReservationExpired received
  PENDING_PAYMENT --> PENDING_PAYMENT: webhook DECLINED (buyer may retry)
  PAID --> [*]
  EXPIRED --> [*]
  REFUND_PENDING --> [*]
```

- No order is created if Inventory rejects the reservation.
- `EXPIRED` + late `APPROVED` webhook: confirm returns `EXPIRED` → the order goes (or stays) in the
  refund path; a refund is requested with an idempotency key. *Owner to define:* whether an order
  already `EXPIRED` moves to `REFUND_PENDING` on a late approval (recommended: yes — money was taken).

## Payment (orders, mirrored by the mock gateway)

```mermaid
stateDiagram-v2
  [*] --> CREATED: payment intent created
  CREATED --> APPROVED: webhook APPROVED
  CREATED --> DECLINED: webhook DECLINED
  DECLINED --> [*]
  APPROVED --> REFUNDED: refund (only if reservation expired)
  APPROVED --> [*]
  REFUNDED --> [*]
```

A new attempt after `DECLINED` creates a new payment (new `Idempotency-Key` from the UI).

## Queue entry (queue, Redis)

```mermaid
stateDiagram-v2
  [*] --> WAITING: join (ZADD NX, score per RF-05)
  WAITING --> WAITING: re-join (same score)
  WAITING --> ADMITTED: admission job (pass with 10 min TTL)
  ADMITTED --> [*]: pass TTL elapses (buyer must re-join)
```

## Event (catalog)

```mermaid
stateDiagram-v2
  [*] --> DRAFT: create
  DRAFT --> DRAFT: configure sales rules
  DRAFT --> PUBLISHED: publish (requires rules) — EventPublished + SalesRulesConfigured
  PUBLISHED --> PUBLISHED: change rules — SalesRulesConfigured
```

`saleState` (`SCHEDULED` → `OPEN` → `CLOSED`) is not stored: it is derived from the clock.
