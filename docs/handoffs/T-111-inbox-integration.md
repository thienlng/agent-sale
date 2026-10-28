# Parallel Inbox integration — T-111

Date: 2026-10-28. Destination requested by the owner: `feat/tung-dev`.

## Included delivery

- T-106 / PR #73: Facebook comments inside Inbox, Page/post selection, paginated stored comments and posts, search, source context, public/private replies, hide/unhide, capability and tenant checks, and explicit uncertain-send handling.
- T-107 / PR #72: device-local DM text drafts, personal Enter behavior, cross-tab conflict protection, shared send identities and private-session cleanup.
- T-108/T-109: exact existing public-fixture scanner fingerprints and the live statistics browser timezone fix needed for acceptance.

Source heads are `3f2ef52` (Claude) and `d92ff58` (Codex). Merge commit `fb076b7` preserves both as parents. No source history was rewritten and main was not changed.

## Merge resolution

Only the task board and vi/en `channel-inbox.json` catalogs conflicted. Both `commentsWorkspace` and `composeContinuity` namespaces are preserved exactly. Application code and sales Inbox documentation merged without conflicts. T-106 stays in review with PR #73; T-107/T-108/T-109 retain their delivered records. The external follow-up was already renumbered to T-110, so no task-ID collision remains.

## Independent QA

Fresh same-model reviewer `/root/qa_t106_final_integration` approved the final T-106 source and combined route/i18n boundaries. It independently passed 29 frontend tests across three focused files and 20 backend facade tests. It verified all four former findings have regressions: pending attempts retain request IDs, existing authorized IDs are recognized before new source validation, uncertain moderation retains IDs, and stored posts paginate beyond 200.

The reviewer verified that T-107's composer, draft, session and private-browser-state files are byte-identical to `d92ff58`. Comments are composed through the route slot and preserve the user/workspace remount boundary.

## Verification

All checks below ran on the combined source. Synthetic data only; no Meta provider or customer actions.

- `pnpm check`: passed (lint, architecture, typecheck, tests and build). Initial bundle: 231.9 KB gzip, below the 250 KB budget.
- Production-build Playwright: 28/28 passed across comments, compose continuity, sales Inbox, layout, fanpage and smoke.
- Unit suite: frontend 72 files / 491 tests passed; backend 67 files / 1,100 tests passed.
- Full-history Gitleaks 8.24.3: passed over 123 commits, with no leaks found.
- Rebuilt integration: 2 files / 10 tests passed (`fanpage.store.integration.spec.ts`, `fanpage-comments.integration.spec.ts`), including stored posts/comments pagination and HTTP permission/tenant checks.
- Initial direct HTTP integration run used the previous built contracts package and failed two tests with an undefined schema. The source exports were present; rebuilding dependencies and rerunning resolved both failures. No test assertions were weakened.

## Remaining boundaries

T-110 remains a separate P1 backlog task: require `settings.manage` when changing fanpage automation settings. This pre-existing authorization gap is not silently marked fixed by comment action permissions.

Real Meta behavior for hidden-comment reads, generated post links and feed ordering remains unverified. The delivery covers received/stored Facebook comments, not complete Meta feature parity, Instagram comments or direct uploads. Main and the two source PRs remain unchanged by this branch consolidation.
