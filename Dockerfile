# Built and run with Podman; see deploy/systemd/karaokej.service.

FROM node:24-alpine AS base
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Install the exact pnpm version pinned in package.json ("packageManager").
RUN npm install -g "$(node -p "require('./package.json').packageManager")"

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM base AS prod-deps
RUN pnpm install --prod --frozen-lockfile

FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    KARAOKEJ_LIBRARY=/library \
    KARAOKEJ_DB=/data/karaokej.db
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
# The song index lives here; mount your .kfn library read-only at /library.
# The health check is defined in the systemd unit (Podman ignores HEALTHCHECK in OCI images).
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "dist-server/index.mjs"]
