# Rapiz (agent-sales)

Source code of an **AI Sales Agent platform for Vietnamese SMEs**: a multichannel AI sales bot (Facebook, Instagram, Zalo, TikTok, website) with a team inbox, mini CRM, orders & shipping, remarketing, workflows, credit-based billing and affiliates. Functional reference: Preny; the design and improvements are documented in [`docs/`](docs/README.md).

> **Coding agents and contributors: read [`AGENTS.md`](AGENTS.md) first.** It is mandatory and links every rule.

## Status

Version 1 is on `main` (2026-10-30); version 2 starts from there.

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
| `docs/` | Design docs (English), ADRs, research reference |
| `apps/` | Deployable apps (api, web, webhook, worker, widget, admin, site) |
| `packages/` | Shared libraries |
| `scripts/` | Repo maintenance scripts |
| `.github/` | CI, PR checks, templates, CODEOWNERS |

## Workflow in one paragraph

Branch `type/short-slug` from `main` → build the whole feature with tests → `pnpm check` → open one PR from the template → before merging, merge `main` into the branch and resolve conflicts → a human reviews and squash-merges. Details: [`.agents/rules/`](.agents/rules/).

## Stack

TypeScript · pnpm + Turborepo · Vite + React SPA (TanStack) · Astro site · NestJS on Fastify · PostgreSQL + pgvector · Redis + BullMQ · multi-provider LLM gateway. Decisions: [`docs/adr/`](docs/adr/README.md).

## License

Proprietary — all rights reserved.
