# Decisions driven by the Delivery 4 guide

The implementation plan was written before the official Delivery 4 guide
(*[CBSE_2026ii] Project Delivery #4*) was published. Comparing the two showed gaps that the plan
could not cover as written. This file records each decision taken to close them, in ADR form, so
the Delivery 4 artifact can cite them in *Design-to-Construction Rationale*.

The one-line summary of every decision is in [decisions.md](decisions.md). The
requirement-by-requirement map is in [delivery-4.md](delivery-4.md).

| ID | Title | Status |
| -- | ----- | ------ |
| [D-01 (rev.)](#d-01-rev--node-24) | Node 24 instead of Node 22 | Accepted |
| [D-14 (rev.)](#d-14-rev--schedule-moves-to-the-oct-12-deadline) | Schedule moves to the Oct 12 deadline | Accepted |
| [D-16](#d-16--the-mock-payment-gateway-becomes-a-faas-component) | Mock payment gateway becomes a FaaS component | **Amended by D-21**: stays a function, not counted as a FaaS component |
| [D-17](#d-17--dlq-monitor-as-the-second-faas-component) | DLQ monitor as the second FaaS component | **Accepted** (by D-21) |
| [D-18](#d-18--circuit-breaker-and-fault-injection-on-the-payment-path) | Circuit breaker and fault injection on the payment path | **Accepted** (built; [evidence](../evidence/e06-circuit-breaker/)) |
| [D-19](#d-19--immutable-artifacts-and-bluegreen-deployment) | Immutable artifacts and blue/green deployment | **Accepted** (built; [evidence](../evidence/deployment/)) |
| [D-20](#d-20--the-inventory-concurrency-test-is-not-cuttable) | The Inventory concurrency test is not cuttable | **Accepted** (built; [evidence](../evidence/e02-concurrency/)) |
| [D-21](#d-21--faas-components-are-the-pre-warmer-and-the-dlq-monitor) | FaaS components are the pre-warmer (E-01) and the DLQ monitor (E-05) | **Accepted** |
| [Open](#open--bring-back-queue-pass-verification-d-07) | Bring back queue-pass verification (D-07) | **Closed**: not built; D-07 stands and is justified in the artifact |

All of these are implemented and were demonstrated on `dev` on Oct 8–9; see [docs/evidence/](../evidence/README.md).

---

## D-01 (rev.) · Node 24 instead of Node 22

- **Status:** Accepted · **Date:** 2026-09-26
- **Guide requirement:** none directly; it's a construction prerequisite.

**Context.** The plan fixed Node 22. The current Prism CLI (5.16), which the team uses to mock
contracts, requires Node ≥ 24.18 (it crashed with an ESM error on Node 20); staying on Node 22
would pin the team to Prism 5.14. Angular 20 (`^20.19 || ^22.12 || >=24`) and NestJS 11 (`>=20`) support Node 24.

**Decision.** Node 24 (LTS) everywhere: `.nvmrc`, `engines`, CI, `node:24-slim` base images and
Cloud Run functions runtime `nodejs24`.

**Consequences.** One runtime for the whole team and current tooling. If `nodejs24` is not
available for Cloud Run functions in `southamerica-east1`, the functions alone fall back to
`nodejs22`.

---

## D-14 (rev.) · Schedule moves to the Oct 12 deadline

- **Status:** Accepted · **Date:** 2026-09-26
- **Guide requirement:** §3.4 — deadline Monday, October 12, 2026, 23:59.

**Context.** The plan ran Sept 21 – Oct 2. The guide sets the deadline on Oct 12 and asks for a
written artifact in addition to the prototype. The repository was created on Sept 26.

**Decision.** Rebase the same sequence of milestones onto Mon Sept 28 – Mon Oct 12: contract
freeze Tue Sept 29, milestones on Fri Oct 2, Wed Oct 7 and Fri Oct 9 (code freeze), weekend
Oct 10–11 for the PDF, submission Oct 12. Details in
[team-and-schedule.md](team-and-schedule.md).

**Consequences.** Four extra working days, partly consumed by D-16…D-19. Presentation date is
still unknown; the environment must be turned on for it.

---

## D-16 · The mock payment gateway becomes a FaaS component

- **Status:** Amended by D-21 (stays a function, not counted as a FaaS component) · **Supersedes:** D-09 (mock inside Orders)
- **Guide requirement:** §2.2 "At least two components must be implemented following
  Functions-as-a-Service principles"; §3.1 Construction "the specific FaaS component and how it
  addresses cold start and execution-time constraints".

**Context.** The plan has no FaaS component. Entrega 3 (§5.2) rejected FaaS for the services
because of the execution-time limit (the queue's SSE stream) and unstable connection pools
against Cloud SQL (E-02). Any FaaS component must therefore be something without long-lived
connections or DB pools, and must not add functional scope ("no new functional scope" — §2.1).

**Options considered.**

| Option | Verdict |
| ------ | ------- |
| Turn a logic service into functions | Rejected: contradicts Entrega 3 §5.2 for the exact reasons it gave |
| Ticket issuance as a function consuming `OrderPaid` | Rejected: new functional scope (RF-15…) |
| **Mock payment gateway as a function** | **Chosen**: it stands in for an external system, is stateless, short-lived, HTTP-triggered |
| Pre-warming scheduler for the sales window (E-01) | Kept as alternative; **chosen later in D-21** |

**Decision.** `functions/mock-payment-gateway` is a Cloud Run function with its own contract
([mock-payment-gateway.yaml](../../contracts/openapi/mock-payment-gateway.yaml)). Orders reaches
it only through its payment adapter. The browser reaches the checkout page through the Gateway
(`/mock-gateway/**`). The 2-second delayed webhook is a Cloud Tasks task on queue
`payment-webhooks`, not a sleep, because a function must finish its work before responding.

**Consequences.**
- The Anti-Corruption Layer and the circuit breaker (D-18) now protect a real network hop, which
  makes both patterns visible in the running system.
- The mock's owner is still the Orders owner; the Gateway gets one more route target.
- New resources: one function, one Cloud Tasks queue, optionally a Firestore `payments`
  collection for payment state (decide at the freeze; it would add a third persistence paradigm).
- The artifact must explain why FaaS is used here after being rejected in Entrega 3: the
  reasons for that rejection (SSE, DB pools) do not apply to this component.

---

## D-17 · DLQ monitor as the second FaaS component

- **Status:** Accepted (by D-21)
- **Guide requirement:** §2.2 two FaaS components; §2.2 "at least one … tactic must be
  demonstrable"; Entrega 3 E-05 "DLQ with messages generates alert ≤ 5 min".

**Context.** A second FaaS component is required. The plan dropped alerts ("only verifiable
under load"), yet the DLQ alert of E-05 does not need load: one poison message is enough.

**Decision.** `functions/dlq-monitor` is triggered by the `<subscription>-dlq` topics (six since D-21). It
writes one structured `ERROR` log per dead letter (`event=dead_letter`, subscription, type,
messageId, correlationId). A log-based metric and an alert policy in Terraform fire when the
count is > 0 within 5 minutes. `make poison` publishes a malformed message to demonstrate it.

**Consequences.** Adds an observability tactic without functional scope, and an event-triggered
function to complement the HTTP one (two different trigger models to discuss in the artifact).
Owner: Platform.

---

## D-18 · Circuit breaker and fault injection on the payment path

- **Status:** Accepted
- **Guide requirement:** §2.2 "realize the architectural style(s) and patterns defined in
  Delivery #2 … show where each pattern actually lives"; §2.2 "at least one resilience,
  elasticity, or reliability tactic must be demonstrable against the running system".

**Context.** Circuit Breaker is a Delivery 2 pattern and E-06 is a Delivery 3 scenario, but the
plan kept only timeouts. A timeout alone is hard to show live, and with the mock inside Orders
there was no real dependency to fail.

**Decision.** Orders' payment adapter applies the Entrega 3 §6.2 parameters: timeouts (0.5 s
connect, 2 s response), circuit breaker (opens after 5 consecutive failures, half-open after
30 s, fails in ≤ 50 ms while open), retry with exponential backoff 200 ms → 5 s and jitter. While
the circuit is open, the buyer gets `503 PAYMENT_UNAVAILABLE` (new error code). The reservation
expiry is never extended (ADR-03). The mock supports `FAULT_MODE = none | error | timeout`,
switched with `make fault MODE=…` (a Terraform switch, ADR-0004), and circuit state changes are
logged. Orders runs one instance in dev so the demo shows a single breaker (ADR-0005).

**Consequences.** The live demo shows the full E-06 cycle: fail slow → circuit opens → fail fast →
recovery. One new error code in the contract. Small dependency in Orders (`opossum` or
`cockatiel`).

---

## D-19 · Immutable artifacts and blue/green deployment

- **Status:** Accepted
- **Guide requirement:** §2.2 "The build-and-deployment process must produce an immutable
  artifact and apply a deliberate deployment strategy"; §3.1 "how a schema or contract change
  was sequenced against it".

**Context.** The plan said "merge to `main` builds the image and deploys to Cloud Run", which is
neither immutable (no identity rule) nor a deliberate strategy.

**Options considered.** Rolling (Cloud Run default: shifts all traffic at once — not deliberate),
canary (meaningless with demo traffic), **blue/green with revision tags** (chosen: verifiable
before any user sees it, one-command rollback).

**Decision.** Images tagged with the full git SHA and deployed by digest; function sources
archived as `<sha>.zip`. Each release deploys a revision with `--no-traffic --tag sha-<short>`,
smoke-tests the tag URL, then shifts 100 % of traffic; rollback shifts back. DB migrations are
expand/contract and run as a Cloud Run job before the shift. Incompatible contract changes create
`/v2` served in parallel. Details: [build-and-deploy.md](../architecture/build-and-deploy.md).

**Consequences.** More pipeline work for Platform. At least one real expand/contract change must
be shipped (planned for Thu Oct 8) to have evidence for the artifact.

---

## D-20 · The Inventory concurrency test is not cuttable

- **Status:** Accepted
- **Guide requirement:** §2.2 demonstrable tactic; §3.3 "the quality attribute tactics" in the
  prototype evaluation.

**Context.** The plan listed "my orders" screens and the Inventory concurrency test as the first
things to cut if time ran short.

**Decision.** The concurrency test (200 concurrent reservations, 10 seats → exactly 10
reservations and 190 `SOLD_OUT`) stays. It is the only running evidence of E-02, the scenario
the whole inventory design exists for. The first cut becomes the "my orders" **list** screen;
the order detail stays because the demo needs it.

**Consequences.** Inventory's load (10 points) absorbs the test; it was already the lightest front.

---

## D-21 · FaaS components are the pre-warmer and the DLQ monitor

- **Status:** Accepted · **Date:** 2026-10-03 · **Amends:** D-16 · **Accepts:** D-17
- **Guide requirement:** §2.2 "At least two components must be implemented following
  Functions-as-a-Service principles".
- **Input:** the professor confirmed FaaS components are required, but **not as components added
  only to comply**.

**Context.** D-16 made the payment mock our first FaaS component. A mock is a test double for an
external system, not part of Aforo, so it reads as added for compliance. Converting a
microservice was also considered and rejected: every service in the slice keeps the reason
Entrega 3 §5.2 gave for containers (SSE in `queue`, DB pools in `inventory`, saga and
circuit-breaker state in `orders`, continuous traffic in `gateway`/`web`; `catalog` would be a
rewrite split by routes, a Lab 5 anti-pattern).

**Options considered.**

| Option | Verdict |
| ------ | ------- |
| Convert a microservice to functions | Rejected: contradicts Entrega 3 §5.2 for the reasons it gave |
| Ticket issuance as a function consuming `OrderPaid` (RF-15) | Rejected for now: new functional scope, new store, read endpoint and UI with nine days left |
| **Pre-warmer for the sales window (E-01)** | **Chosen**: a tactic Entrega 3 designed and the slice had dropped |
| **DLQ monitor (E-05)** | **Kept** (D-17): a tactic Entrega 3 designed |

**Decision.** The two FaaS components are:

1. `functions/prewarmer`: realizes the E-01 tactic "pre-warming per sales window". Triggered
   by `EventPublished`, it schedules two named Cloud Tasks per event (warm before
   `salesOpensAt`, cool at `salesClosesAt`). Each task makes it set service-level minimum
   instances on `gateway` and `queue` through the Cloud Run Admin API.
2. `functions/dlq-monitor`: realizes the E-05 tactic "a DLQ with messages raises an alert" (D-17).

The payment mock **stays a Cloud Run function** (already specified, no extra cost) but is
presented as a test double for the external gateway, not as one of the FaaS components.

**Consequences.**
- E-01 moves from "partially demonstrable" to demonstrable: publish an event that opens in
  ~12 minutes and watch the minimum instances rise before the opening.
- The artifact gets two different trigger models (Pub/Sub event + delayed tasks, and DLQ
  events), both on work that is rare, short and stateless (Lab 5 decision tree).
- Terraform stops managing `min_instance_count` on `gateway` and `queue`: the pre-warmer owns
  it (ADR-0004, amended).
- One more Cloud Tasks queue (`prewarm-windows`) and a service account allowed to update only
  those two services. Owner: Platform.

---

## Open · Bring back queue-pass verification (D-07)

- **Status:** Closed (Oct 9): verification was not built. D-07 stands; the artifact justifies it
  with [target-vs-slice.md](../architecture/target-vs-slice.md)
- **Guide requirement:** §1 and §2.1 "build … exactly as it was designed".

**Context.** D-07 is the largest deviation from the design: without pass verification RD-04 is
not met and the waiting room is a UI control, not a system control. The plan estimates the fix at
"two endpoints and half a day", and the contract already carries `X-Queue-Pass`.

**Proposal.** If Milestone 2 lands on time, implement verification (sign the pass in Queue,
verify in Orders or Inventory) before the code freeze. Otherwise, justify the deviation
explicitly in the artifact using [target-vs-slice.md](../architecture/target-vs-slice.md).
