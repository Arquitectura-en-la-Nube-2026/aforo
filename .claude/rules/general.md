# General rules (all files)

## Language
- Everything is in English: identifiers, comments, log messages, error `title`/`detail`, docs,
  commit messages, PR titles and descriptions, branch names.
- User-facing UI text may be in Spanish **only** inside `apps/web` i18n/text files, never in code
  identifiers. (Decide once in `apps/web/README.md` and keep it consistent.)
- Domain names follow `docs/architecture/glossary.md`. Do not invent synonyms
  (it is `reservation`, not `booking`/`hold`; `order`, not `purchase`; `event`, not `show`).

## Scope discipline
- If a task is not required by `docs/plan/acceptance.md`, do not implement it. Leave a
  `// OUT-OF-SCOPE(D-xx): …` comment only where a future hook is explicitly planned (e.g. pass
  verification).
- Do not add dependencies, services, or GCP resources that the plan does not mention without a
  note in the PR explaining why.

## Git workflow
- One branch per person/feature: `<name>/<short-topic>` (e.g. `luis/reservation-tx`).
- Conventional Commits with the unit as scope: `feat(inventory): conditional seat decrement`,
  `fix(gateway): …`, `docs(contracts): …`, `chore(infra): …`.
- A PR touches one unit. Contract changes go in their own PR (see `contracts.md`).
- Merge to `main` only with green CI and one approving review. Whoever breaks `main` fixes it
  before continuing their own work.

## Secrets
- Never commit secrets, `.env` files, service-account keys, or Terraform state.
- Every service ships a `.env.example` listing every variable it reads, with safe placeholder values.
