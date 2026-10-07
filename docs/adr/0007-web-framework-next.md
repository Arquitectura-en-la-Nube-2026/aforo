# 0007 · Frontend framework: Next.js instead of Angular

- **Status:** Accepted (2026-10-07, Julián) · supersedes D-02
- **Date:** 2026-10-05
- **Deciders:** Cristian
- **Affects:** `apps/web`, `.claude/rules/frontend.md`, `apps/web/README.md`, `apps/web/CLAUDE.md`

## Context

D-02 chose Angular 20 with SSR. `apps/web` had no code yet (only `README.md` and `CLAUDE.md`), so
nothing has to be migrated. The team that builds the screens works in React, and the screens
need no Angular-specific feature: seven routes, two of them server-rendered.

Constraints that stay the same: one container on Cloud Run listening on port 4000
(`infra/envs/dev/services.tf`), built by `.github/workflows/web.yml` from `apps/web/Dockerfile`
and deployed by digest, with `GET /health/ready` answering 200 for the smoke test.

## Decision

`apps/web` is a **Next.js (App Router, TypeScript)** app. SSR stays limited to `/` and
`/events/[id]`; queue, buy, pay and orders are client components. UI comes from an existing
component library (shadcn/ui on Radix and Tailwind), as before: no custom visual system.

## Consequences

- The seven screens, client rules and error handling in `apps/web/README.md` do not change.
- The image is built once and configured at runtime (ADR-0004), so `NEXT_PUBLIC_*` variables,
  which Next inlines at build time, are not used. The API base URL is read from `API_BASE_URL`
  on the server and handed to the browser through the root layout.
- `apps/web` exposes `/health/live` and `/health/ready` itself, because Next has no built-in
  health route.
- The Terraform module and the CI workflow need no change: same port, same env var names
  (`API_BASE_URL`, `SSR_API_BASE_URL`).
- Anyone who already started an Angular scaffold must drop it: the folder was empty on
  `main` when this was written.
