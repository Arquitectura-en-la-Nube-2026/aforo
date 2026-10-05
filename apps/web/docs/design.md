# Web design notes

What the screens look like and why. The component library and the seven screens are fixed by the
plan; this file records the choices made inside those limits. Copy lives in
`src/lib/i18n/es.ts`, tokens in `src/app/globals.css`.

## Direction

Buying tickets is one tense moment (waiting for your turn) surrounded by calm, scannable screens
(browse, choose, pay). The design spends its boldness in two places and keeps the rest quiet:

- **The position number** on the queue screen: very large, tabular digits in the primary colour. It
  is the one thing the buyer came to see, so it gets the whole card.
- **The ticket stub**: a card with a dashed perforation and two notches. The perforation is
  information, not decoration: above it is _what_ (event, venue, date), below it is _how much_
  (sector, quantity, price, total). Events, order summary, queue and buy summary all use it.

| Token     | Value     | Use                                                  |
| --------- | --------- | ---------------------------------------------------- |
| `paper`   | `#f5f6f8` | page background                                      |
| `surface` | `#ffffff` | stubs, inputs                                        |
| `ink`     | `#101828` | text (> 15:1 on paper)                               |
| `muted`   | `#4b5565` | secondary text (7:1 on paper)                        |
| `primary` | `#2f3fe0` | the single action per screen, the position number    |
| `citrus`  | `#f2c230` | only for deadlines (turn and reservation countdowns) |
| `success` | `#0f7b4f` | sale open, paid                                      |
| `danger`  | `#b3261e` | errors, sold out, countdown under 30 s               |

Type: _Bricolage Grotesque_ for headings and figures, _Instrument Sans_ for text, both served from
npm (no third-party request at runtime). Numbers use tabular figures so a changing position or
countdown does not jitter. Components come from Radix primitives (shadcn style) and are themed
through the tokens above; there is no custom component system.

## One action per screen

| Screen              | Primary action                                        |
| ------------------- | ----------------------------------------------------- |
| `/login`            | Entrar                                                |
| `/`                 | open an event (the whole card is the link)            |
| `/events/:id`       | Entrar a la fila / Continuar con tu compra            |
| `/events/:id/queue` | none while waiting; Elegir mis entradas when admitted |
| `/events/:id/buy`   | Reservar entradas                                     |
| `/orders/:id/pay`   | Pagar ahora                                           |
| `/orders/:id`       | Pagar ahora only while the order is `PENDING_PAYMENT` |

## States per screen

| Screen | States covered                                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------------- |
| Login  | empty, field errors (email format, name), API error with `correlationId`, session expired banner                  |
| Events | list, empty, API unreachable (retry)                                                                              |
| Detail | sale `OPEN` / `SCHEDULED` / `CLOSED`, signed out, already admitted, sector sold out, not found                    |
| Queue  | joining, waiting (SSE live / polling fallback), admitted + pass countdown, pass expired, sale not open, API error |
| Buy    | no pass, pass expired, nothing chosen, quantity limits, `SOLD_OUT`, `LIMIT_EXCEEDED`, generic error               |
| Pay    | payable + reservation countdown, not payable (expired / already paid), payment error                              |
| Order  | pending, confirming payment, `PAID`, `EXPIRED`, `REFUND_PENDING`                                                  |
| Orders | list, empty, load more, API error                                                                                 |

## Accessibility

- Keyboard: skip link, visible focus ring on every control, minimum target 44 px.
- Screen readers: position and countdown are **not** announced every tick. The queue speaks when it
  is the buyer's turn and when the position is 5 or fewer or a multiple of 10; countdowns speak at
  60 s and 10 s. Focus moves to the new heading when the turn arrives, expires or the sale is closed.
- Status never relies on colour alone (every badge carries text); motion respects
  `prefers-reduced-motion`.
- Lighthouse (mobile, production build, event page): Accessibility 100, Best Practices 100, SEO 100.

## Not done on purpose

Dark mode, a language switcher, an organizer view and ticket download are outside the seven screens
and the acceptance script (`docs/plan/acceptance.md`).
