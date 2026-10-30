---
name: open-pr
description: Open a pull request for a finished feature — final checks, update the branch with main, PR body from the template with a verification report. Use when the whole feature is complete and pnpm check is green.
---

# Open a pull request

One finished feature → one PR (Rule 02). Do not open a PR for partial work.

## Pre-flight (all must be true)

- [ ] The feature is complete; related fixes and docs are in the same branch.
- [ ] Branch updated with `main` (`git fetch origin && git merge origin/main`), conflicts resolved keeping both sides' intent.
- [ ] `pnpm check` passes locally.
- [ ] Tests cover the new behavior; no test was skipped/deleted.
- [ ] Docs updated; ADR added if architectural (Rule 05).
- [ ] No secrets, no PII, no `console.log`, no commented-out code.

## Create

```bash
git push -u origin <branch>
gh pr create --title "<type>(<scope>): <subject>" --body-file <(…)   # body from .github/PULL_REQUEST_TEMPLATE.md
```

- **Summary** — what and why, and where to start reading.
- **Verification** — exact commands and results; screenshots for UI; eval scores for AI changes.
- **Checklist** — tick honestly; unticked items need a reason.

## Merge

1. Watch CI; fix failures with new commits.
2. Right before merging, update the branch with `main` again if it moved, resolve conflicts, rerun `pnpm check`, push, wait for CI green.
3. Squash merge, then delete the branch.
