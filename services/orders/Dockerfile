FROM node:24-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/common packages/common
COPY services/orders services/orders
RUN npm ci --workspace packages/common --workspace services/orders
RUN npm run build --workspace packages/common && npm run build --workspace services/orders

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/packages/common/package.json packages/common/package.json
COPY --from=build /repo/packages/common/dist packages/common/dist
COPY --from=build /repo/services/orders/package.json services/orders/package.json
COPY --from=build /repo/services/orders/dist services/orders/dist
COPY --from=build /repo/services/orders/migrations services/orders/migrations
RUN npm ci --omit=dev --workspace packages/common --workspace services/orders
WORKDIR /repo/services/orders
USER node
CMD ["node", "dist/main.js"]
