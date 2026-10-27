# Contributing

Humans and coding agents follow the same rules. Everything is in [`AGENTS.md`](AGENTS.md) and [`.agents/rules/`](.agents/rules/):

1. [Language](.agents/rules/01-language.md) — English in the repo.
2. [Git & PRs](.agents/rules/02-git-and-pr.md) — branches, Conventional Commits, PR process, squash merge.
3. [Task tracking](.agents/rules/03-task-tracking.md) — `TODO.md` + `todo/`.
4. [Code quality](.agents/rules/04-code-quality.md) — tests, `pnpm check`, Definition of Done.
5. [Architecture guardrails](.agents/rules/05-architecture-guardrails.md).
6. [Documentation](.agents/rules/06-documentation.md).
7. [Security](.agents/rules/07-security.md).
8. [Agent behavior](.agents/rules/08-agent-behavior.md).

## For reviewers

- Review the task file's **Plan** before the diff when the PR is large.
- Use the reviewer checklist in the PR template and the `review-pr` skill checklist.
- Merge with **squash**; the PR title becomes the commit subject. Confirm `TODO.md` and the task file were moved to done in the PR.
- Changes to protected files (rules, CI, tooling, ADRs) need extra scrutiny — see `.github/CODEOWNERS`.

## Repository administration

- Branch protection: `bash scripts/github-branch-protection.sh <owner>/<repo>` (admin only). Not available while the repo is private on GitHub Free; until then the `pre-push` hook refuses force pushes and deletion of `main`; fast-forward pushes to `main` are allowed (T-105).
- GitHub Environments and secrets for deployments are set up in T-008.
