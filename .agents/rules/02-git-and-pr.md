# Rule 02 — Git, commits and pull requests

Two rules matter most (owner decision 2026-10-30):

1. **Few, large PRs: one finished feature → one branch → one PR.** Group related work until the feature is complete, then open the PR. Do not open PRs for partial work, single fixes of a feature still in progress, or board/doc updates — those ride along in the feature branch.
2. **Before merging, bring the branch up to date with `main` and resolve the conflicts**, then merge.

## Branches

- Branch from an up-to-date `main`. Name: `<type>/<short-slug>`, e.g. `feat/lodging-bookings`.
- Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `ci`, `build`, `revert`.
- History on `main` is never rewritten: no force pushes, no deletion (the `pre-push` hook refuses both).
- Delete the branch after merge.

## Commits — Conventional Commits

```
<type>(<scope>): <subject>

<body — what and why, not how. Lines ≤ 100 chars.>
```

- `scope` = app, package or module name (`web`, `backend`, `db`, `commerce`, …); see `commitlint.config.js`. Omit it for repo-wide changes.
- Subject: imperative, lowercase first letter, no trailing period, ≤ 72 chars.
- Commit in reviewable steps; each commit should build.
- `commitlint` runs on `commit-msg`, `lint-staged` on `pre-commit`. Never bypass hooks (`--no-verify` is forbidden).

## Pull requests

- Title follows the commit convention: `feat(commerce): add lodging bookings`.
- Body (template in `.github/PULL_REQUEST_TEMPLATE.md`): what the feature does, where to start reading, and how it was verified (commands and results, screenshots for UI).
- Ready for review when `pnpm check` passes locally and CI is green.

## Merging

1. Update the branch: `git fetch origin && git merge origin/main` (merge, not rebase, so nobody needs a force-push).
2. Resolve every conflict keeping **both** sides' intent — read what `main` changed, do not just pick one side. Migrations: keep numbers unique and ordered.
3. Run `pnpm check`, push, wait for CI green.
4. **Squash merge.** The squash commit message is the PR title + body.

## Dependabot PRs

Merge minor/patch updates when CI is green. Majors get a quick read of the release notes first. If Dependabot stops rebasing a PR, re-apply the bump in a normal PR and close the old one.
