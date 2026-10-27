---
id: T-108
title: Exclude exact public widget fixture fingerprints from secret scans
status: done
type: chore
priority: P1
owner: '@agent:codex'
feature_ids: []
created: 2026-10-27
updated: 2026-10-27
branch: feat/T-107-inbox-compose-continuity
pr: https://github.com/thienlng/agent-sale/pull/72
parent: T-107
---

## Context

PR #72 is blocked by the full-history secret scan. All three findings are generic-api-key false positives in the pre-existing synthetic WebsiteEmbedCode unit test, commit 9a7e45c6d02344d375a26283239178d2291aa743, lines 71/73/76. The value is a hard-coded public widget site-key fixture, not an authentication credential. The commit is already an ancestor of origin/main and predates T-107.

## Goal

Unblock the required full-history scan without weakening secret detection or rewriting history.

## Scope

This task explicitly covers creating the root scanner configuration file `.gitleaksignore`. Add only the three exact commit/path/rule/line fingerprints confirmed by CI. Document why they are non-secret fixtures. Keep the pinned scanner version, full-history command, default rules, workflow and every other path unchanged.

## Out of scope

Broad path/rule/value exclusions, real credential exemptions, history rewriting, changes to AGENTS/rules/workflows, changes to website behavior or test expectations.

## Acceptance criteria

- [x] Gitleaks 8.24.3 runs the exact CI full-history command successfully with the three fingerprint exclusions.
- [x] A fresh synthetic credential probe in a temporary repository is still rejected with exit 1 using the same ignore file.
- [x] An independent reviewer confirms all entries are exact pre-existing non-secret fixtures, not blanket suppression.
- [x] pnpm check passes locally, the PR stays draft until required CI is green, and docs/board identify this blocker separately from T-107 behavior.

## Plan

1. Inspect CI finding metadata and the existing fixture without exposing credentials; confirm the commit is already on main.
2. Verify the pinned tool's documented fingerprint-ignore behavior and add only the three reviewed fingerprints.
3. Run pinned full-history scan and a redacted synthetic negative control outside this repo.
4. Obtain independent review, record verification and rerun the existing repository gate before push.

## Log

- 2026-10-27 — CI secret scan failed on three public-widget dummy test values from main, not T-107. Exact findings obtained from the redacted CI log; no real credential printed or added. Existing source test and main ancestry confirmed.

- 2026-10-27 — Independent same-model reviewer approved the exact three non-secret fixture fingerprints and confirmed ancestry to main. Pinned Gitleaks 8.24.3 full-history scan: exit 0, 117 commits scanned, no leaks. A fresh randomly generated synthetic credential in an isolated temporary repository is still rejected with exit 1 using this ignore file. No actual credential was used or printed. Application source unchanged; final cached repository gate and CI rerun follow before readiness.

## Links

- [PR #72](https://github.com/thienlng/agent-sale/pull/72)
- [Pinned Gitleaks documentation](https://github.com/gitleaks/gitleaks/tree/v8.24.3#reducing-false-positives) — checked 2026-10-27
- [Compose QA record](../../docs/handoffs/T-107-compose-continuity-qa.md)
