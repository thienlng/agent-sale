# Contributing

Humans and coding agents follow the same rules. Everything is in [`AGENTS.md`](AGENTS.md) and [`.agents/rules/`](.agents/rules/):

1. [Language](.agents/rules/01-language.md) — English in the repo.
2. [Git & PRs](.agents/rules/02-git-and-pr.md) — one finished feature per PR; update with `main` and resolve conflicts before a squash merge.
4. [Code quality](.agents/rules/04-code-quality.md) — tests, `pnpm check`, Definition of Done.
5. [Architecture guardrails](.agents/rules/05-architecture-guardrails.md).
6. [Documentation](.agents/rules/06-documentation.md).
7. [Security](.agents/rules/07-security.md).
8. [Agent behavior](.agents/rules/08-agent-behavior.md).

## For reviewers

- Read the PR summary's start-reading pointer before the diff when the PR is large.
- Use the reviewer checklist in the PR template and the `review-pr` skill checklist.
- Before merging, make sure the branch is up to date with `main` and conflicts are resolved; merge with **squash** — the PR title becomes the commit subject.
- Changes to protected files (rules, CI, tooling, ADRs) need extra scrutiny — see `.github/CODEOWNERS`.

## Repository administration

- Branch protection: `bash scripts/github-branch-protection.sh <owner>/<repo>` (admin only). Not available while the repo is private on GitHub Free; until then the `pre-push` hook refuses force pushes and deletion of `main`; fast-forward pushes to `main` are allowed.
- GitHub Environments and secrets for deployments are not set up yet.
