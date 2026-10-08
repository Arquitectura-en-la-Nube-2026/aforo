FROM node:24-slim AS build
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages/common/package.json packages/common/package.json
COPY services/inventory/package.json services/inventory/package.json
RUN npm ci

COPY packages/common/tsconfig.json packages/common/tsconfig.json
COPY packages/common/src packages/common/src
COPY services/inventory/tsconfig.json services/inventory/tsconfig.json
COPY services/inventory/src services/inventory/src
COPY services/inventory/migrations services/inventory/migrations
RUN npm run build --workspace=@aforo/common && npm run build --workspace=@aforo/inventory
RUN npm prune --omit=dev

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/packages/common/package.json ./packages/common/package.json
COPY --from=build --chown=node:node /workspace/packages/common/dist ./packages/common/dist
COPY --from=build --chown=node:node /workspace/services/inventory/package.json ./services/inventory/package.json
COPY --from=build --chown=node:node /workspace/services/inventory/dist ./services/inventory/dist
COPY --from=build --chown=node:node /workspace/services/inventory/migrations ./services/inventory/migrations
USER node
CMD ["node", "services/inventory/dist/main.js"]
