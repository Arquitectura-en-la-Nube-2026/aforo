FROM node:24-slim AS build
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages/common/package.json packages/common/package.json
COPY services/gateway/package.json services/gateway/package.json
RUN npm ci

COPY packages/common/tsconfig.json packages/common/tsconfig.json
COPY packages/common/src packages/common/src
COPY services/gateway/tsconfig.json services/gateway/tsconfig.json
COPY services/gateway/src services/gateway/src
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/packages/common/package.json ./packages/common/package.json
COPY --from=build --chown=node:node /workspace/packages/common/dist ./packages/common/dist
COPY --from=build --chown=node:node /workspace/services/gateway/package.json ./services/gateway/package.json
COPY --from=build --chown=node:node /workspace/services/gateway/dist ./services/gateway/dist
USER node
CMD ["node", "services/gateway/dist/main.js"]
