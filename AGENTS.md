# AGENTS.md — Read this first

This repository is the source code of an **AI Sales Agent platform for Vietnamese SMEs** (functional reference: Preny). Most code here is written by coding agents (Claude Code, Codex, OpenCode, …) and reviewed by humans. These instructions are **mandatory** for every agent and every human contributor. They apply to the whole repository.

If you are a coding agent and this is your first session in this repo, run the `onboarding` skill (`.agents/skills/onboarding/SKILL.md`) before doing anything else.

## 1. Mandatory reading order

Read these files, in order, before changing anything:

1. This file.
2. `.agents/rules/*.md` — all rule files (numbered; each is short).
3. `TODO.md` — the task board. Every piece of work starts from a task there.
4. `docs/ARCHITECTURE.md` — module shape, allowed imports, golden module (`apps/backend/src/modules/workspace`). Mandatory for any code change.
5. `docs/README.md` — index of the design docs. Read the docs relevant to your task (at minimum `docs/04-system-architecture.md` and `docs/11-code-structure-and-conventions.md`).
6. `docs/adr/README.md` — architecture decisions that must not be silently reverted.

Rules in `.agents/rules/` override anything in `docs/`. `docs/` describes the intended design; the code and tests describe the current reality. When they disagree, say so in your PR instead of guessing.

## 2. Non-negotiable rules (summary — details in `.agents/rules/`)

| # | Rule | Details |
|---|------|---------|
| 1 | **English** for code, identifiers, comments, commits, PRs, tests, todo files and technical docs. Vietnamese is allowed only in chat with humans, in product UI strings (i18n files) and in business/marketing content. | `01-language.md` |
| 2 | **One task → one branch → one PR.** Branch `type/T-123-short-slug`. Conventional Commits. PR must reference its task ID. | `02-git-and-pr.md` |
| 3 | **Work is tracked in `TODO.md` + `todo/`.** Never start work without a task file; keep its status current in the same PR. | `03-task-tracking.md` |
| 4 | **`pnpm check` must pass** (lint, typecheck, tests, build) before you claim anything is done. New behavior needs tests. Never delete or skip a test to make CI green. | `04-code-quality.md` |
| 5 | **Respect the architecture.** Module boundaries, tenant isolation (`workspace_id`), ledger rules, backward-compatible migrations. Architecture changes need an ADR. | `05-architecture-guardrails.md` |
| 6 | **Docs change with the code.** If behavior, API, schema or config changes, update `docs/` in the same PR. | `06-documentation.md` |
| 7 | **No secrets, no PII in logs, no unsafe shortcuts.** | `07-security.md` |
| 8 | **Stay in scope, verify before claiming, ask when blocked.** Do not edit `AGENTS.md`, `.agents/`, `.github/`, `CODEOWNERS` or root tooling config without a task that explicitly asks for it. | `08-agent-behavior.md` |

## 3. Repository map

```
AGENTS.md            ← you are here (single source of truth for all agents)
CLAUDE.md, GEMINI.md ← thin pointers to AGENTS.md for tools that look for them
.agents/
  rules/             ← numbered rule files (mandatory)
  skills/            ← reusable workflows (onboarding, start-task, open-pr, …)
.claude/ .codex/       ← per-tool config; Claude Code reads skills via .claude/skills → .agents/skills,
                         Codex and OpenCode read .agents/skills natively
.mcp.json, opencode.json, .codex/config.toml ← MCP servers per tool
TODO.md              ← task board (short). Details live in todo/T-xxx-*.md
todo/                ← one file per task; todo/done/ for finished tasks
docs/                ← design docs (English). docs/adr/ = decisions. docs/reference/ = research
apps/backend/        ← NestJS modular monolith; entries api | worker | agent | realtime; modules in src/modules/<name>
apps/webhook/        ← thin Fastify ingress (no business logic)
apps/web/            ← Vite + React SPA; features/<module> mirrors backend modules
apps/{admin,site,widget,mobile}/ ← later
packages/            ← shared (kernel) · contracts (Zod DTOs/events) · db · queue · ai-core · channels · ui · i18n · testing
turbo/generators/    ← `pnpm gen module <name>` / `pnpm gen feature <name>` — the only way to create a module
docs/ARCHITECTURE.md ← where code goes and which imports are allowed (enforced by `pnpm arch` + ESLint + tests)
scripts/             ← repo maintenance scripts
.github/             ← CI workflows, PR/issue templates, CODEOWNERS
```

## 4. Commands

```bash
pnpm install          # install (Node version in .nvmrc, pnpm version in package.json#packageManager)
pnpm check            # lint + arch + typecheck + test + build — the gate for every PR
pnpm lint / pnpm arch / pnpm typecheck / pnpm test / pnpm build / pnpm format
pnpm gen module <name>   # scaffold a backend module with the fixed shape (never create one by hand)
pnpm gen feature <name>  # scaffold a web feature folder
pnpm todo:new "Title" # create a new task file + TODO.md entry (see 03-task-tracking.md)
bash scripts/verify-setup.sh   # verify your local environment and the agent setup
```

## 5. Tech stack (decided — see `docs/adr/`)

TypeScript everywhere · pnpm workspaces + Turborepo · **Vite + React SPA** (TanStack Router/Query/Table, Tailwind v4, shadcn/ui) for dashboard and admin · **Astro** for the marketing site · Preact widget · **NestJS on Fastify** modular monolith (`api`, `webhook`, `agent`, `worker` processes) · PostgreSQL 16 + pgvector (Drizzle ORM, PgBouncer) · Redis + BullMQ · S3-compatible object storage · multi-provider LLM gateway (`packages/ai-core`) · Vitest, Playwright · OpenTelemetry, Sentry, Langfuse. Performance budgets are binding: `docs/16-performance-and-scale.md`.

## 6. Who reviews

Humans: `thienlng` and `tungdd7` (see `.github/CODEOWNERS`). Every PR needs one human approval. Agents never merge their own PRs and never push directly to `main`.
