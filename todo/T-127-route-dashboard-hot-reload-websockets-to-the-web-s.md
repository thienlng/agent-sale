---
id: T-127
title: Route dashboard hot reload WebSockets to the web server
status: review
type: bug
priority: P1
owner: '@agent:codex'
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: fix/T-126-web-acceptance
pr:
parent: T-126
---

## Context

Live public-tunnel inspection found Vite's hot-reload WebSocket failing and a client exception. The development proxy routes normal root requests to the marketing preview; its upgrade handler currently reuses that HTTP route, so Vite's root `/?token=...` WebSocket also reaches the marketing site instead of the dashboard dev server.

## Goal

Preserve normal landing/API routing while forwarding Vite HMR WebSocket upgrades to the dashboard.

## Scope

- Reproduce routing with local stub upstreams and a separate proxy process; no active proxy restart during the parent's live conversation checks.
- Add protocol-level regression coverage for root HTTP, token-bearing Vite HMR upgrades, non-HMR API upgrades and existing API/webhook path routing.
- Fix only the development proxy upgrade dispatch and document the explicit regression command.

## Out of scope

- Production WebSocket architecture, application business behavior, root tooling configuration and restarting shared services.

## Acceptance criteria

- [x] An unchanged-proxy protocol regression proves a root Vite HMR upgrade reaches the wrong upstream.
- [x] Root HTTP remains on the site, Vite HMR reaches the web upstream and other route behavior stays intact.
- [x] Targeted protocol regressions and static checks pass without paid APIs or external messages.
- [x] Parent coordinates the active-proxy restart and public-browser recheck.

## Plan

1. Start isolated HTTP/upgrade stub upstreams and a temporary proxy with dynamic ports in a Node built-in test.
2. Assert root HTTP and a real `vite-hmr` upgrade use different intended upstreams; cover retained API/OAuth/webhook routing.
3. Preserve HTTP route behavior and recognize the Vite HMR subprotocol in upgrade dispatch.
4. Run the protocol test and lint/format, update the site development documentation, then hand off to the parent for coordinated public recheck.

## Log

- 2026-10-29 — Created under owner-authorized T-126 acceptance bug fixing. Source inspection confirms HTTP and upgrade dispatch currently share the site-root route; no active service restarted.

- 2026-10-29 — New isolated Node protocol regression failed on the unchanged proxy: both root Vite HMR and comma-separated vite-hmr subprotocol upgrades reached site instead of web (strict site != web assertions). Other HTTP/API route checks passed; evidence /tmp/t127-red.log.
- 2026-10-29 — Upgrade dispatch now recognizes the vite-hmr subprotocol and preserves the root path/token while targeting WEB_PORT. Ordinary root/site assets HTTP and non-HMR API upgrade routing remain unchanged; no active service restarted by this agent.
- 2026-10-29 — node --test scripts/dev-tunnel-proxy.test.mjs passed6/6, with actual temporary HTTP upstreams and upgrade handshakes; no external service/customer call. Targeted eslint for both scripts and formatting passed. Evidence /tmp/t127-green.log and /tmp/t127-eslint.log. Site README documents the protocol behavior and exact test command. Whole-repository pnpm check is coordinated by parent T-126.
- 2026-10-29 — Parent must restart the active proxy at an appropriate point and recheck public-browser WebSocket success/no Vite client error before marking the live QLT-005/007 variant passed. This public recheck remains pending at handoff.

- 2026-10-29 — Parent restarted only the development proxy and independently rechecked the public login page: HMR socket received a frame with no socket/page error. Protocol regression independently reran 6/6. Whole-repository gate remains under T-126.

## Links

- scripts/dev-tunnel-proxy.mjs
- apps/site/README.md
- docs/qa/web-acceptance/04-supporting-and-quality.md (QLT-005/007)
- Related tasks: T-121, T-126
