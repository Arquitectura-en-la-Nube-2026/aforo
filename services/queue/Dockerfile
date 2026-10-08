FROM node:24-slim AS build
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages/common/package.json packages/common/package.json
COPY services/queue/package.json services/queue/package.json
RUN npm ci

COPY packages/common/tsconfig.json packages/common/tsconfig.json
COPY packages/common/src packages/common/src
COPY services/queue/tsconfig.json services/queue/tsconfig.json
COPY services/queue/src services/queue/src
RUN npm run build --workspace=@aforo/common && npm run build --workspace=@aforo/queue
RUN npm prune --omit=dev

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/packages/common/package.json ./packages/common/package.json
COPY --from=build --chown=node:node /workspace/packages/common/dist ./packages/common/dist
COPY --from=build --chown=node:node /workspace/services/queue/package.json ./services/queue/package.json
COPY --from=build --chown=node:node /workspace/services/queue/dist ./services/queue/dist
USER node
CMD ["node", "services/queue/dist/main.js"]
