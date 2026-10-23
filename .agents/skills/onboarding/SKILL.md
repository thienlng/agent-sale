---
name: onboarding
description: First-session checklist for any coding agent in this repo. Reads the mandatory rules and docs, verifies the local environment, and confirms readiness before any task is started. Use on your first session, after a long break, or when rules changed.
---

# Onboarding

Goal: be able to answer "what is this project, how do I work here, what is the current state" without asking a human.

## Steps

1. Read, in full and in order: `AGENTS.md`, every file in `.agents/rules/` (01 → 08), `TODO.md`, `docs/README.md`.
2. Read the docs relevant to the area you will work in. For any backend/data work read `docs/04-system-architecture.md`, `docs/05-data-model.md`, `docs/11-code-structure-and-conventions.md`. For AI work add `docs/06-ai-engine.md`. For integrations add `docs/07-channel-integrations.md`. Skim `docs/adr/README.md`.
3. Verify the environment: `bash scripts/verify-setup.sh`. It checks Node/pnpm versions, installs dependencies if needed, checks the skill symlinks and runs `pnpm check`. Fix only what the script tells you is wrong with your machine; do not change repo config.
4. Look at the current state: `git log --oneline -20`, `git status`, open PRs (`gh pr list` if available), **In progress** and **Blocked** sections of `TODO.md`.
5. Write a 5–10 line summary to the human: what the product is, the stack, the task you intend to take (or ask for one), anything in the board that looks inconsistent. Then stop and wait, or continue with the `start-task` skill if a task was assigned.

## Do not

- Do not start coding during onboarding.
- Do not "tidy up" files you notice along the way. Create a backlog task instead.
