# Rapiz (agent-sales)

Source code of an **AI Sales Agent platform for Vietnamese SMEs**: a multichannel AI sales bot (Facebook, Instagram, Zalo, TikTok, website) with a team inbox, mini CRM, orders & shipping, remarketing, workflows, credit-based billing and affiliates. Functional reference: Preny; the design and improvements are documented in [`docs/`](docs/README.md).

> **Coding agents and contributors: read [`AGENTS.md`](AGENTS.md) first.** It is mandatory and links every rule.

## Status

Phase 0 — repository foundation done; product code starts with the tasks in [`TODO.md`](TODO.md). Decisions pending from humans are tracked in `T-002`.

## Quick start

```bash
nvm use                      # Node 24 (see .nvmrc); pnpm via corepack
pnpm install
pnpm check                   # lint + typecheck + test + build
bash scripts/verify-setup.sh # environment + agent setup check
```

## Layout

| Path | What |
|---|---|
| `AGENTS.md`, `.agents/` | Rules and skills for all coding agents (Claude Code, Codex, OpenCode, …) |
| `TODO.md`, `todo/` | Task board and task files |
| `docs/` | Design docs (English), ADRs, research reference |
| `apps/` | Deployable apps (api, web, webhook, worker, widget, admin, site) |
| `packages/` | Shared libraries |
| `scripts/` | Repo maintenance scripts |
| `.github/` | CI, PR checks, templates, CODEOWNERS |

## Workflow in one paragraph

Pick a task from `TODO.md` → branch `type/T-xxx-slug` → write the plan in the task file → implement with tests → `pnpm check` → open a PR from the template → a human reviews and squash-merges. Details: [`.agents/rules/`](.agents/rules/).

## Stack

TypeScript · pnpm + Turborepo · Vite + React SPA (TanStack) · Astro site · NestJS on Fastify · PostgreSQL + pgvector · Redis + BullMQ · multi-provider LLM gateway. Decisions: [`docs/adr/`](docs/adr/README.md).

## License

Proprietary — all rights reserved.
