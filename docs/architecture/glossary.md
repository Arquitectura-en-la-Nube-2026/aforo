# Glossary and name mapping

The design deliverables (Entregas 1–3 and the implementation plan) are in Spanish. The code is in
English. Use the **Code name** column everywhere in this repository.

## Domain

| Spanish (design docs) | Code name | Meaning |
| --------------------- | --------- | ------- |
| Evento | `event` | Something people buy tickets for (concert, festival, match). Not to be confused with a bus message; call those *messages* or *facts* |
| Sector / localidad | `sector` / `seat` | Area of the venue with capacity and price / one unit of that capacity |
| Reglas de venta | `salesRules` | `maxTicketsPerPerson`, `reservationTtlSeconds`, `openingWindowSeconds` |
| Ventana de venta | `sales window` (`salesOpensAt`…`salesClosesAt`) | When buying is allowed |
| Estado de la venta | `saleState` | `SCHEDULED`, `OPEN`, `CLOSED` — computed with the server clock |
| Sala de espera / fila | `queue` (service), `waiting room` (UI) | Orders buyers and admits them at a pace |
| Turno / pase | `pass` (`passToken`, `passExpiresAt`) | Proof of admission with expiry |
| Admisión | `admission` | Moving a buyer from waiting to admitted |
| Reserva | `reservation` | Seats held for a buyer until they pay or it expires |
| Pedido | `order` | The buyer's purchase; owns the payment |
| Pasarela de pago | `payment gateway` | External PSP (Wompi in the target design; mocked here) |
| Comprador | `buyer` (`buyerId` = `userId`) | Logged-in end user |
| Organizador | `organizer` | Creates events (no UI in this slice) |

## Statuses

| Spanish | Code |
| ------- | ---- |
| Reserva `ACTIVA` | `ACTIVE` |
| Reserva `CONFIRMADA` | `CONFIRMED` |
| Reserva `EXPIRADA` | `EXPIRED` |
| Reserva `LIBERADA` | `RELEASED` |
| Pedido | `PENDING_PAYMENT`, `PAID`, `EXPIRED`, `REFUND_PENDING` (already English) |
| Fila | `WAITING`, `ADMITTED` (already English) |
| Pago (webhook) | `APPROVED`, `DECLINED` |

## Bus messages (facts)

| Spanish | Code `type` | Topic |
| ------- | ----------- | ----- |
| `EventoPublicado` | `EventPublished` | `aforo.catalog.event-published` |
| `ReglasDeVentaConfiguradas` | `SalesRulesConfigured` | `aforo.catalog.sales-rules-configured` |
| `ReservaExpirada` | `ReservationExpired` | `aforo.inventory.reservation-expired` |
| `PedidoPagado` | `OrderPaid` | `aforo.orders.order-paid` |

## Services

| Spanish | Folder |
| ------- | ------ |
| Frontend SSR | `apps/web` |
| API Gateway | `services/gateway` |
| Catálogo y eventos | `services/catalog` |
| Sala de espera y admisión | `services/queue` |
| Pedidos y Checkout | `services/orders` |
| Inventario y reservas | `services/inventory` |
| Librería común | `packages/common` (`@aforo/common`) |
| Pasarela de pago (mock) | `functions/mock-payment-gateway` |
| — (new for Delivery 4) | `functions/dlq-monitor` |

## Requirement and design IDs

IDs are kept as in the design docs so they can be traced: `RF-xx` functional requirements,
`RD-xx` design restrictions, `RT-xx` technical restrictions, `RN-xx` business restrictions,
`E-xx` quality scenarios, `D-xx` plan decisions, `TO-xx` trade-offs, `ADR-xx` decision records.
