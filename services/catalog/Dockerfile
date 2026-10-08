FROM node:24-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/common packages/common
COPY services/catalog services/catalog
RUN npm ci --workspace packages/common --workspace services/catalog
RUN npm run build --workspace packages/common && npm run build --workspace services/catalog

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages/common/package.json packages/common/package.json
COPY --from=build /repo/packages/common/dist packages/common/dist
COPY --from=build /repo/services/catalog/package.json services/catalog/package.json
COPY --from=build /repo/services/catalog/dist services/catalog/dist
COPY --from=build /repo/services/catalog/migrations services/catalog/migrations
RUN npm ci --omit=dev --workspace packages/common --workspace services/catalog
WORKDIR /repo/services/catalog
USER node
CMD ["node", "dist/main.js"]
