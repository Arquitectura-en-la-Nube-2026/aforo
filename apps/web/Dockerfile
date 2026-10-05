# Built from the repo root: docker build -f apps/web/Dockerfile .   (see .github/workflows/_service.yml)
FROM node:24-slim AS build
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY apps/web apps/web
# Next inlines nothing environment-specific: API_BASE_URL is read at runtime (ADR-0004, ADR-0007).
RUN npm run build --workspace @aforo/web

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=4000 \
    HOSTNAME=0.0.0.0
WORKDIR /workspace
# `standalone` output traces the monorepo from the repo root, so the server lives at apps/web/server.js.
COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /workspace/apps/web/public ./apps/web/public
USER node
EXPOSE 4000
CMD ["node", "apps/web/server.js"]
