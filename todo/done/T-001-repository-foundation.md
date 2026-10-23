---
id: T-001
title: Repository foundation: agent rules, skills, tooling, CI
status: done
type: chore
priority: P0
owner: @agent:claude
feature_ids: []
created: 2026-10-23
updated: 2026-10-23
branch: main
pr: initial commit
parent:
---

## Context

The product will be built mostly by coding agents (Claude Code, Codex, OpenCode) and reviewed by two humans. Before any product code exists, the repository needs a collaboration framework that every agent must read and follow, plus tooling that keeps CI green from the first commit.

## Goal

A repository where any coding agent can onboard from `AGENTS.md`, pick a task, implement it under enforced rules, and open a reviewable PR without breaking the product over time.

## Scope

- `AGENTS.md` as the single source of truth; `CLAUDE.md`/`GEMINI.md` pointers.
- `.agents/rules/` (8 rules) and `.agents/skills/` (6 skills), symlinked for Claude Code and OpenCode.
- MCP config for Claude Code, OpenCode, Codex.
- Task tracking: `TODO.md`, `todo/_template.md`, `scripts/new-todo.sh`.
- Monorepo tooling: pnpm workspaces, Turborepo, TypeScript strict, ESLint, Prettier, Vitest, commitlint, husky, lint-staged.
- `packages/shared` seed package with a test so the pipeline is exercised.
- GitHub: CI workflow, PR checks, PR/issue templates, CODEOWNERS, Dependabot, branch-protection script.
- English-only design docs in `docs/` (Vietnamese drafts removed).

## Out of scope

- Any product code (apps). See T-003..T-008.

## Acceptance criteria

- [x] `pnpm check` passes on a clean clone.
- [x] `bash scripts/verify-setup.sh` passes.
- [x] `pnpm todo:new "x"` creates a task file and a board line.
- [x] Skills are discoverable from `.claude/skills` and `.opencode/skill`.

## Plan

Done in one pass; see repository layout in `AGENTS.md`.

## Log

- 2026-10-23 — created and completed in the initial commit.

## Links

- Docs: `docs/11-code-structure-and-conventions.md`
