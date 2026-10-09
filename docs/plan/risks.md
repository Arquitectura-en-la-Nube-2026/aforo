# Risks

| Risk | Likelihood | Mitigation |
| ---- | :--------: | ---------- |
| No local environment: every test goes through a deploy and the loop gets slow | High | Unit and service tests locally against Prism mocks; the cloud is for integrating, not for testing a function |
| One shared environment: someone breaks `dev` and blocks all six | High | Nobody deploys without green CI; whoever breaks `main` fixes it first |
| Environment left on over a weekend eats the credits | Medium | `make down` mandatory when done; check the billing dashboard every Friday |
| `make down` wipes the DB and the next `make up` has no data | Medium | The seed is idempotent and always runs inside `make up` |
| Contracts keep changing after the freeze (Tue Sept 29) | High | Only the contracts owner touches them; late changes are announced the same day and versioned |
| Cloud Run cuts the queue SSE | Medium | Plan B: poll `status` every 3 s, same contract, one hour of work |
| Memorystore takes several minutes to create and starts empty | High | `make redis-up` ≥ 15 min before any live test or demo; it re-runs the seed so the projection rebuilds; positions rebuild when people re-join; rehearse on Thu Oct 1 (ADR-0001) |
| Direct VPC egress not available for Cloud Run in `southamerica-east1` | Low | Check on day one; fallback: Serverless VPC Access connector under the same `redis_enabled` switch |
| Someone runs `terraform apply` by hand and resets the switches (e.g. destroys Redis mid-demo) | Medium | Only `make` targets apply; they read the current switches from state (ADR-0004) |
| Background work silently stalls on Cloud Run (CPU throttled after the response) | Medium | No timers or post-response work outside `queue`; outbox flush after commit + housekeeping (ADR-0002) |
| Integration piles up at the end | High | Two fixed integration points (Wed Sept 30 and Mon Oct 5) with real deploys |
| Someone drops out due to academic load | Medium | Redistribute the 14/13-point fronts first; the "my orders" list screen is cut first (see team-and-schedule) |
| Delivery 4 requirements not visible in the running system (FaaS, tactic demo, deployment strategy) | Medium | Tracked item by item in [delivery-4.md](delivery-4.md); rehearsed on Thu Oct 8 |
| Cloud Run functions runtime `nodejs24` not available in the region | Low | Fall back to `nodejs22` for the functions only |

## Shared-environment etiquette

- When debugging a consumer locally, create **your own** subscription with your initial as a
  suffix (e.g. `inventory-event-published-le`) or you will steal messages from the deployed service.
- `make down` affects all six people: announce it in the channel first.
- Last one out turns it off.

## Pending

- ~~Compare the delivery guide with the acceptance script.~~ Done: see [delivery-4.md](delivery-4.md).
  Deadline moved to Mon Oct 12; D-16 … D-21 decided and built.
- Presentation date is still to be defined by the course; the environment must be turned on for it.
- The environment is turned off after the presentation. Evidence is the video and the repo.
