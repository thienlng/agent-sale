# Production images (docs/runbooks/deploy-vps.md). Build from the repo root:
#   docker build -f infra/deploy/Dockerfile --target app  -t rapiz-app  .
#   docker build -f infra/deploy/Dockerfile --target edge -t rapiz-edge .
# `app` runs api / agent / worker / webhook / migrations (the command picks one);
# `edge` is Caddy serving the static web, site and widget and proxying the rest.

FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true HUSKY=0
RUN corepack enable
WORKDIR /repo
# Dependencies first so code changes reuse the cached store.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline
# Same-origin builds: the site, dashboard, widget and API share one public host, so the
# images do not depend on the domain (it lives only in the server's .env).
ENV VITE_SITE_URL=/ VITE_WIDGET_URL=/widget.js PUBLIC_APP_URL=/
RUN pnpm turbo run build \
      --filter=@agent-sales/backend --filter=@agent-sales/webhook --filter=@agent-sales/db \
      --filter=@agent-sales/web --filter=@agent-sales/site --filter=@agent-sales/widget

FROM node:24-bookworm-slim AS app
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo /repo
USER node
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
CMD ["node", "apps/backend/dist/entries/api.js"]

FROM caddy:2-alpine AS edge
COPY infra/deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv/web
COPY --from=build /repo/apps/site/dist /srv/site
COPY --from=build /repo/apps/widget/dist /srv/widget
