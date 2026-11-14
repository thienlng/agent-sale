# Production images (docs/runbooks/deploy-vps.md). Build from the repo root:
#   docker build -f infra/deploy/Dockerfile --target app  -t rapiz-app  .
#   docker build -f infra/deploy/Dockerfile --target edge -t rapiz-edge .
# `app` runs api / agent / worker / webhook / migrations (the command picks one);
# `edge` is Caddy serving the static web, site and widget and proxying the rest.
# Base images are pinned by digest (Dependabot `docker` updates them, .github/dependabot.yml).

FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS build
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

# Production dependencies of the backend and the webhook (and the workspace packages they use)
# only (`--filter-prod`: devDependency links such as @agent-sales/testing are not followed): no dev
# tool chain, no web/site/widget libraries. Built outputs stay in place, so the four
# entries and the migrate CLI keep their paths. Lifecycle scripts already ran in `build`.
FROM build AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    rm -rf node_modules apps/*/node_modules packages/*/node_modules && \
    pnpm install --prod --frozen-lockfile --offline --ignore-scripts \
      --filter-prod '@agent-sales/backend...' --filter-prod '@agent-sales/webhook...'

FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS app
ENV NODE_ENV=production
WORKDIR /repo
# Only what api / agent / worker / webhook / migrate run: no web, site or widget sources, docs,
# scripts or agent configuration.
COPY --from=prod-deps /repo/package.json /repo/pnpm-workspace.yaml ./
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/packages ./packages
COPY --from=prod-deps /repo/apps/backend ./apps/backend
COPY --from=prod-deps /repo/apps/webhook ./apps/webhook
# The server files of this release; deploy-ssh.sh copies them out of the image it deploys.
COPY infra/deploy/compose.yml infra/deploy/*.sh /repo/infra/deploy/
COPY infra/deploy/postgres /repo/infra/deploy/postgres
USER node
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
CMD ["node", "apps/backend/dist/entries/api.js"]

FROM caddy:2-alpine@sha256:78bd35025c7ba85961dd149ae670315129954e77abe2383ac47c89106b35ade9 AS edge
# Caddy runs unprivileged; the binary keeps cap_net_bind_service for :80. Its state lives outside
# the root-owned volumes of older deploys (auto_https is off, so there are no certificates).
RUN adduser -D -H -u 10002 caddy-edge && install -d -o caddy-edge -m 700 /var/lib/caddy-edge
ENV XDG_DATA_HOME=/var/lib/caddy-edge/data XDG_CONFIG_HOME=/var/lib/caddy-edge/config
COPY infra/deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv/web
COPY --from=build /repo/apps/site/dist /srv/site
COPY --from=build /repo/apps/widget/dist /srv/widget
USER caddy-edge
