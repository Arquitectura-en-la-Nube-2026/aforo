FROM node:24-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/common packages/common
COPY services/inventory services/inventory
RUN npm ci --workspace packages/common --workspace services/inventory
RUN npm run build --workspace packages/common && npm run build --workspace services/inventory

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages/common/package.json packages/common/package.json
COPY --from=build /repo/packages/common/dist packages/common/dist
COPY --from=build /repo/services/inventory/package.json services/inventory/package.json
COPY --from=build /repo/services/inventory/dist services/inventory/dist
COPY --from=build /repo/services/inventory/migrations services/inventory/migrations
RUN npm ci --omit=dev --workspace packages/common --workspace services/inventory
WORKDIR /repo/services/inventory
USER node
CMD ["node", "dist/main.js"]
