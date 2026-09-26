---
paths:
  - "contracts/**"
---

# Contract rules

- `contracts/` is the single source of truth for every REST endpoint and every event.
  Code must match it; the Definition of Done checks it.
- Owner and arbiter: the Gateway/contracts front (Juan José). After the freeze (Tue Sept 29), **only
  the owner merges contract changes**. Anyone may open the PR.
- A contract change PR must:
  1. touch only `contracts/` (and `docs/` if needed),
  2. say which services are affected and whether the change is compatible,
  3. be announced in the team channel the same day.
- Compatible changes (new optional field, new endpoint, new error code) stay in `v1`.
  Incompatible changes (rename/remove a field, change a type, make a field required) create
  `/v2` routes or a new event `version`. Never edit `v1` semantics in place.
- Shared pieces (Problem, pagination, headers, Pub/Sub push body) live in
  `contracts/openapi/components/common.yaml` and are referenced with `$ref`, never copied.
- Event payloads are JSON Schema (draft 2020-12). File name: `<topic-suffix>.v<N>.schema.json`.
- Every schema/operation has an `example` so Prism mocks return realistic data.
- Run `make lint-contracts` before opening the PR.
