# @agent-sales/backend

NestJS 12 (ESM) on Fastify — the modular monolith. One codebase, four entrypoints (`src/entries/`): `api` (HTTP), `worker` (BullMQ groups via `WORKER_QUEUES`), `agent` (AI runtime, the only LLM caller), `realtime` (SSE/presence). Same Docker image, separate deployments.

## Run

```bash
pnpm --filter @agent-sales/backend dev          # api with reload (tsx)
pnpm --filter @agent-sales/backend test         # unit + contract + HTTP (fastify inject) + architecture tests
pnpm --filter @agent-sales/backend build && node apps/backend/dist/entries/api.js
```

Env: see `src/common/config.ts` (validated at boot) and `/.env.example`.

## Where things go

Read `docs/ARCHITECTURE.md` §2. Copy the **golden module** `src/modules/workspace`. Create new modules with `pnpm gen module <name>` — never by hand.

Conventions that keep NestJS "magic" small (ADR-009): providers are injected by **token** (`@Inject(TOKEN)`), ports are interfaces + symbol tokens, no request-scoped providers, controllers are thin (Zod pipe → facade → DTO), domain services are framework-free, no circular module imports.
