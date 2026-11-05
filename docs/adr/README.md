# Architecture Decision Records

Each ADR: Context → Decision → Consequences. Status: `Proposed` → `Accepted` / `Superseded by ADR-xxx`. Add a new ADR by copying `ADR-000-template.md`.

| ADR | Topic | Status |
|---|---|---|
| [001](ADR-001-typescript-nestjs-modular-monolith.md) | TypeScript + NestJS modular monolith, monorepo | Proposed |
| [002](ADR-002-postgresql.md) | PostgreSQL + pgvector instead of MongoDB | Proposed |
| [003](ADR-003-queue-bullmq.md) | Redis + BullMQ for asynchronous processing | Proposed |
| [004](ADR-004-multi-tenant-rls.md) | Multi-tenant shared schema + RLS | Proposed |
| [005](ADR-005-llm-gateway.md) | Multi-provider LLM Gateway, commercial tiers | Proposed |
| [006](ADR-006-hosting-region.md) | Hosting model (self-hosted only — decided) & data region (open) | Partially decided |
| [007](ADR-007-auth.md) | Build auth in-house | Proposed |
| [008](ADR-008-credit-ledger.md) | Immutable ledger, milli-credit unit | Proposed |
| [009](ADR-009-tech-stack-for-speed-and-scale.md) | Stack for perceived speed and ~1,000-tenant scale: Vite SPA + Astro + NestJS/Fastify; supersedes the Next.js dashboard choice | Proposed |
| [010](ADR-010-isolated-hermes-runtime.md) | Isolated `hermes-runtime` and first Meta ingress queue adapter | Accepted; tools/runtime-provider parts superseded by ADR-015 |
| [011](ADR-011-website-widget-shadow-dom-and-polling.md) | Website chat widget: single Shadow DOM script, ES2017, polling first, HMAC visitor token | Accepted |
| [012](ADR-012-accounts-own-businesses-bot-is-selling-unit.md) | Accounts own businesses (billing and portfolio); the bot is the selling unit, no shop entity | Proposed |
| [013](ADR-013-lodging-catalog-and-stay-requests.md) | Whole-property accommodation metadata and staff-confirmed stay requests inside commerce | Proposed; superseded in part by ADR-018 |
| [014](ADR-014-tool-calling-for-the-reply-agent.md) | Tool calling for the reply agent: catalog lookup on demand, actions as tools, focus products, emulated tools for Hermes | Proposed; JSON reply, 4-round loop, 3-images-per-turn cap and Hermes emulation superseded by ADR-015 |
| [015](ADR-015-agent-harness-v2.md) | Agent harness v2: free-text Hermes-style agent loop, `send_message`, 10 rounds / 120 s, interrupt, LISTEN/NOTIFY wake-up, no number guardrail on replies | Proposed |
| [016](ADR-016-bot-orders.md) | Bot orders: the ai module writes through new `CommerceFacade` methods; bot creates, customer confirms (quick replies), staff review; bot orders reserve stock | Proposed |
| [017](ADR-017-external-source-of-truth-pms.md) | PMS integration (KiotViet first): new tier-3 `integration` module; the PMS is the source of truth for linked products, stock, orders and customers; mirrored via webhooks + reconcile on lease jobs | Accepted |
| [018](ADR-018-lodging-module.md) | Lodging module: properties, units, nightly rates, unit-night calendar (PK as the anti-double-booking rule), lazy hold expiry, bookings; Rapiz is the calendar's source of truth; hotel bots read properties through a catalog facade | Proposed |
| [019](ADR-019-bot-lodging-holds.md) | Bot lodging holds: the ai module writes through `LODGING_BOT_FACADE`; one 30-minute draft per conversation, server-built summary with `HOLD_CONFIRM` / `HOLD_EDIT`, confirm through the staff booking path with a deterministic request id, staff review state; the facade is the seam for future availability providers | Proposed |
| [020](ADR-020-saas-vertical-requests-subscriptions-builtin-tool.md) | SaaS vertical: customer statuses, `saas` module with customer subscriptions; built-in bot tool records demo/trial requests on the customer | Proposed; §4 superseded in part by ADR-025 |
| [021](ADR-021-rapiz-hq-and-platform-admin.md) | Rapiz HQ is an ordinary `saas` workspace fed one way by platform events (account, billing, workspace) into the `saas` module; platform owns billing facts; operators act in `/admin` (plan catalog, trial settings, plan changes, VietQR confirm) with reason and audit | Proposed |
| [022](ADR-022-public-api-and-webhooks.md) | Public API (VRT-10): workspace API keys whose scopes are capabilities, on routes marked `apiKey` in `/api/v1`; per-key rate limits and idempotency; signed, retried webhooks of a public event catalog from the outbox; SSRF guard; `identity` owns keys, new `developer` module owns webhooks | Proposed |
| [023](ADR-023-email-codes-and-signup.md) | Transactional email through Resend (`Mailer` port); 6-digit email codes (15 min, 5 tries, 60 s resend); the signup page sends the code and signup needs it, so every user is verified; the first business (and trial) comes in onboarding; password reset by code | Proposed |
| [024](ADR-024-owner-assistant.md) | Owner assistant: owner-only, account-scoped `assistant` module (`withAccount`, ADR-004 amendment); route tools with proposals, read-only SQL lane, UI actions; no sandbox, no external MCP; Hermes-style memory, skills, review and curator ported to Postgres | Proposed |
| [025](ADR-025-request-verticals-education-spa.md) | Request verticals: one built-in `record_request` tool configured per industry (saas, education, spa), written by `crm` (`ai` → `crm` instead of `saas`); requests are customer history entries plus a note and a status move; courses and services are products with a typed `offering`; shared `sales-agent@19` | Proposed |
| [026](ADR-026-lodging-media-folders.md) | Lodging media folders: photos, uploaded MP4 videos (own upload route, 25 MB) and video links in folders stored in `lodging_properties.gallery`; `send_message` `albumId` sends the next 8 unsent photos of a folder, `videoId` one video; album cap 3 → 8 (deviates from ADR-015) | Proposed |
