---
name: open-pr
description: Open or finalize a pull request for a T-xxx task — final checks, task file and TODO.md update, PR body from the template, and a verification report. Use when implementation is complete and pnpm check is green.
---

# Open a pull request

## Pre-flight (all must be true)

- [ ] `pnpm check` passes locally (paste the summary into the Log).
- [ ] Branch is rebased on latest `main`; commits are clean Conventional Commits with `Refs: T-<id>`.
- [ ] Tests cover the new behavior; no test was skipped/deleted.
- [ ] Docs updated; ADR added if architectural (Rule 05).
- [ ] No secrets, no PII, no `console.log`, no commented-out code.
- [ ] One commit (or a few) per task; PR body has one section per task and a "start reading here" pointer.

## Update tracking (same branch)

- Task file: `status: review`, tick acceptance criteria, final Log entry "ready for review" with verification details.
- `TODO.md`: line moved to **In progress** stays there until merge; add `PR #<n>` once known (edit after creating the PR and push).
- If this PR finishes the task: in this same PR move the file to `todo/done/`, set `status: done`, and move the board line to **Done** (the human merging confirms). If more PRs will follow, say so in the PR.

## Create

```bash
git push -u origin <branch>
gh pr create --title "<type>(<scope>): <subject> (T-<id>)" --body-file <(…)   # or paste the template
```

Fill `.github/PULL_REQUEST_TEMPLATE.md` completely:
- **Summary** — what and why in 3–6 lines, linking the task file.
- **Changes** — bullet list by module.
- **Verification** — exact commands and results; screenshots for UI; eval scores for AI changes.
- **Checklist** — tick honestly; unticked items need a reason.
- **Follow-ups** — backlog tasks you created.

Mark the PR ready for review only when everything above holds; otherwise keep it as draft and say what is missing.

## After opening

- Watch CI; fix failures with new commits (no force-push after review started).
- Answer every review comment.
