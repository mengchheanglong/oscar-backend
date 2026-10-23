FROM node:24.14.0-bookworm-slim AS base
RUN npm install --global pnpm@10.32.1
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY tsconfig*.json ./
COPY src ./src
RUN pnpm build

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --prod --frozen-lockfile

FROM base AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=43101
LABEL org.opencontainers.image.title="OSCAR Backend"
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY scripts/hermes/bridge.py ./scripts/hermes/bridge.py
COPY package.json ./
RUN mkdir -p /app/var/uploads && chown -R node:node /app/var
USER node
EXPOSE 43101
CMD ["node", "dist/main.js"]
