# 0006 · Inventory is not sharded; `event_id` is its partition key when it must be

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** Julián (Platform)
- **Affects:** `services/inventory` (schema), Delivery 4 artifact (data design)

## Context

Entrega 3 TO-03 accepts that serializing the reservation on the sector counter caps write
throughput, and names "shard the inventory by event" as the way out when the instance cap is no
longer enough. Lab 4 §3 asks for that partition key to be chosen with an explicit criterion.
The slice runs one small Cloud SQL instance; sharding is not needed and not built.

## Options considered

| Criterion | `event_id` | `user_id` (buyer) | `reservation_id` | `created_at` |
| --------- | ---------- | ----------------- | ---------------- | ------------ |
| Cardinality | High across the catalog, but one hot event concentrates the load | Very high | Very high | Monotonic |
| Reservation transaction stays on one node | **Yes**: sector counter, reservation and buyer total are all per event | No: the sector counter is shared by every buyer | No | No |
| Per-person limit (RF-12) and one active reservation per buyer and event resolved locally | **Yes** | Yes for the buyer, no for the counter | No | No |
| Verdict | **Selected** | Rejected: splits the counter | Rejected: scatter-gather | Rejected: temporal hotspot |

## Decision

- Inventory stays on one database in the slice (no sharding).
- The partition key, when needed, is `event_id`: no business rule crosses events, so every
  reservation stays a local ACID transaction on one shard.
- The schema is shard-ready at no cost: every Inventory table carries `event_id`, and the main
  keys and indexes start with it (e.g. `sector_availability (event_id, sector_id)`, the partial
  unique index `(event_id, buyer_id) WHERE status = 'ACTIVE'`).

## Consequences

- Nothing to build now; the Delivery 4 data design can point to a justified key.
- Accepted limitation (TO-03): one very large event is still a single-node hotspot. Sharding
  by event does not help it; admission control by the waiting room does.
