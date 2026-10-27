# Rule 02 — Git, commits and pull requests

## Branches

- `main` is protected: no direct pushes, no force pushes, PR + 1 human approval + green CI required.
  - GitHub-side branch protection is not available on the current plan (private repo, GitHub Free). Until it is enabled (`scripts/github-branch-protection.sh`), the rule is enforced by the `pre-push` git hook, the `Main guard` workflow (fails on any commit that reaches `main` without a merged PR) and reviewer discipline. A red `Main guard` run means someone bypassed the process: revert and open a PR.
- **One milestone (or coherent block of related tasks) → one branch → one PR.** The maintainer prefers few, larger PRs over many small ones (decision 2026-10-23). Group related tasks; keep **one commit (or a few) per task** inside the PR so history stays reviewable. Branch name: `<type>/T-<id>-<short-slug>` using the first/main task id, e.g. `feat/T-013-m1-foundation`. Small fixes and docs/board updates ride along in the current milestone branch instead of their own PR.
- Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `ci`, `build`.
- Branch from an up-to-date `main`. Rebase (do not merge `main` into your branch) if you need newer changes.
- Delete the branch after merge.

## Commits — Conventional Commits

```
<type>(<scope>): <subject>

<body — what and why, not how. Wrap at 100 chars.>

Refs: T-012
```

- `type` as above. `scope` = app or package name (`api`, `web`, `worker`, `shared`, `db`, `ai-core`, `channels`, `billing`, `docs`, `ci`, `repo`). Omit scope only for repo-wide changes.
- Subject: imperative mood, lowercase first letter, no trailing period, ≤ 72 chars. Example: `feat(api): add contact import endpoint`.
- Body is required for anything non-trivial. Explain the reason and any trade-off.
- Footer `Refs: T-<id>` is required (use `Closes: T-<id>` on the final commit that finishes the task). Add `BREAKING CHANGE:` footer when applicable.
- Agents add their attribution footer as required by their tool (e.g. `Co-Authored-By:`).
- Commit small and often; each commit should build. Squash fixup noise before opening the PR (`git rebase -i` is not available to agents — use `git commit --fixup` + `git rebase --autosquash` or craft commits cleanly).
- `commitlint` runs on `commit-msg`; `lint-staged` runs on `pre-commit`. Never bypass hooks (`--no-verify` is forbidden).

## Pull requests

- Title follows the commit convention: `feat(api): add contact import endpoint (T-012)`.
- Use `.github/PULL_REQUEST_TEMPLATE.md` fully. The PR body must reference the task (`Closes T-012` or `Refs T-012`) and link the task file.
- Size: no fixed line limit. Make large PRs reviewable instead: per-task commits, a PR description with one section per task (what, why, how verified), and a "where to start reading" pointer. Split only when tasks are unrelated or one part is risky enough to need separate review (e.g. a destructive migration).
- A PR is ready for review only when: `pnpm check` passes locally, CI is green, the task file is updated, docs are updated, and the PR description lists how you verified the change.
- Draft PRs are encouraged early for visibility, but mark them ready only when the above holds.
- Respond to every review comment (fix, or explain why not). Push follow-up commits; do not force-push after review has started unless the reviewer asks.
- Merge strategy: **squash merge**. The squash commit message is the PR title + body.

## Dependabot PRs

Dependabot is exempt from the branch-name, task-reference and commitlint checks (its format is fixed by `.github/dependabot.yml`), but not from `pnpm check`. Humans merge them weekly: minor/patch when CI is green; majors get a quick read of the release notes first and, if they touch runtime code, a task.

## Reviewers (humans)

Review checklist lives in `.github/PULL_REQUEST_TEMPLATE.md` (reviewer section). Reviewers check scope, tests, architecture guardrails, docs, and that the task file status matches reality.
