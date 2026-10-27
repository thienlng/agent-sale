---
id: T-105
title: Allow agents to push and merge to main with owner approval
status: done
type: chore
priority: P1
owner: "@agent:claude"
feature_ids: []
created: 2026-10-27
updated: 2026-10-27
branch: main
pr:
parent:
---

## Context

The owner works with several coding agents and asked on 2026-10-26 and again on 2026-10-27 that finished work lands directly on `main` instead of piling up in branches and worktrees. The repo rules still said agents never push or merge to `main`, and the Claude Code settings denied those commands.

## Goal

Rules and agent settings no longer forbid agents from pushing or merging to `main` when the owner asks for it.

## Scope

- In scope: `.husky/pre-push`, `CONTRIBUTING.md`, `AGENTS.md` §6, `.agents/rules/02-git-and-pr.md`, `.agents/skills/open-pr/SKILL.md`, `.claude/settings.json` deny list.

## Out of scope

- GitHub branch protection.

## Acceptance criteria

- [x] The "agents never merge / never push to main" sentences are removed.
- [x] The push/merge deny entries are removed from `.claude/settings.json`; secret-file read denies stay.
- [x] No docs impact beyond the rule files themselves.

## Log

- 2026-10-27 — created and done. The edits had been staged in the primary checkout earlier; the owner chose "push to main" for them during the branch and worktree cleanup.
- 2026-10-27 — Owner asked to let agents push `main` too: the pre-push hook now allows fast-forward pushes and only refuses force pushes and deleting `main`; rule 02 and CONTRIBUTING updated. The `Main guard` workflow (.github) is unchanged.
- 2026-10-27 — Owner asked to drop the `Main guard` workflow too: `.github/workflows/main-guard.yml` removed and its mentions updated.
