# Inbox redesign handoff — 2026-10-25

## Stop instruction and resume entrypoint

The owner explicitly asked Codex to stop implementation and document all state so Claude can continue. Do not interpret this file as permission to merge. No more implementation, commits, pushes or CI changes were made after the stop request; only this handoff and local backups were prepared.

**Continue from the existing dirty worktree:**

```bash
cd /home/kenknight/Workspace/agent-sale-inbox
```

Read AGENTS.md, repo rules and relevant skills before proceeding. Preserve the working tree. Do not reset, clean, switch the original workspace's branch, or apply the backup patch on top of the current changes.

The shared original workspace is being used by another agent. The inbox was deliberately isolated to avoid overwriting their changes.

## Exact Git state

| Item | State at handoff |
| --- | --- |
| Worktree | `/home/kenknight/Workspace/agent-sale-inbox` |
| Branch | `feat/T-068-sales-inbox` |
| Local HEAD | `7092fa8812a0a61e897deedd8816c2385d27e352` |
| Base / last fetched `origin/main` | `3cfba8d448230e0e14b60de2c7d473defe90ad74` |
| Remote inbox branch | `18adb903e67c99b931f64af2c7d473defe90ad74` |
| Divergence | Local branch is ahead 2, behind 1 because its draft implementation commit was amended locally |
| PR | https://github.com/thienlng/agent-sale/pull/59 — **draft** |
| Working changes before this handoff | 37 modified/untracked entries, all related to the remaining inbox convenience task |

Local commits:

1. `d758baa` — start T-068 and record plan.
2. `e46e8b6` — main sales inbox redesign; replaces remote commit `18adb90`, removes a scanner false positive, adds screenshots and local verification.
3. `7092fa8` — deterministic existing team integration test fix and T-068/T-071 tracking.

**The PR does not reflect the latest local commits or uncommitted convenience features.** Do not assume reviewing the remote diff is enough.

## Important task ID collision

Task IDs were allocated independently in concurrent worktrees. This must be coordinated before final publication/merge:

- Inbox-local **T-068**: main inbox redesign, archived at `todo/done/T-068-redesign-the-sales-inbox-workspace.md`.
- Inbox-local **T-071**: CI test blocker fix, archived at `todo/done/T-069-make-team-assignment-history-integration-coverage-.md`.
- Inbox-local **T-072**: follow-ups, saved views, product sharing, CRM quick controls and shortcuts, currently `todo/T-070-complete-inbox-follow-ups-saved-views-and-sales-sh.md`.
- Another agent already uses **T-071** for Facebook post/comment work in `/home/kenknight/Workspace/agent-sale-fanpage`, branch `feat/T-069-fanpage-comments`.
- Another agent already uses **T-072** for instruction rules in `/home/kenknight/Workspace/agent-sale`, branch `feat/T-070-instruction-rules-v2`.

Their task files are:

- `/home/kenknight/Workspace/agent-sale/todo/T-071-implement-context-aware-facebook-post-replies-and-.md`
- `/home/kenknight/Workspace/agent-sale/todo/T-072-instruction-rules-v2-toggles-sections-starter-pack.md`

Do not edit those agents' files. Coordinate unique IDs for the inbox-local blocker/convenience tasks, then update the inbox board, filenames, parent links, commit/task references and PR body consistently. Do not blindly allocate another ID from just one worktree.

## User-approved design and implemented core

The owner asked for a practical sales inbox inspired by Preny/Diro screenshots, with many useful actions, and explicitly requested an independent QA agent. The owner approved the brainstorming and implementation.

Committed core work includes:

- Three-column inbox with page/account filtering and accurately scoped sales queues.
- Desktop customer panel collapse, mobile conversation/details navigation, bounded viewport scrolling.
- AI takeover/resume state, resume time, resolve/reopen, message search.
- Separate customer reply and private note modes; per-user/workspace/conversation tab-memory drafts.
- Quick replies inserted at the caret; staged attachment preview and explicit send.
- Safe request-key handling for confirmed failed vs unconfirmed sends; async completion across remounts.
- History reading without forced jumps; new-message detection uses latest ID even when API retains exactly 200 messages.
- Explicit CRM profile search/selection, current contact fetched through `useContact`, phone copy and profile drawer.
- Embedded real commerce order form, shared in-flight protection, stable draft request IDs, expanded details dialog.
- Order completion recorded even after switching customers, with no automatic customer message.
- Optional `expectedRevision` on conversation PATCH, checked under existing tenant row lock. No migration.

Feature boundaries are preserved: CRM/commerce/conversation are composed at the route. Do not import one feature directly from another.

Canonical behavior/limits guide: `docs/18-sales-inbox-workspace.md`.

## Uncommitted convenience work

The remaining approved convenience features are implemented locally, but need final verification/commit/publication:

### Follow-ups

- Optional `followUpAt` and `followUpNote` added to conversation DTO/PATCH contracts.
- Existing JSON persistence retains them; no SQL migration or new module.
- Existing revision and tenant checks apply; private follow-up note is excluded from audit metadata.
- Editor shows device timezone, saves UTC, rejects invalid local times, preserves drafts/conflicts and allows clear.
- Due queue requires open conversation and timestamp in the past; minute clock updates membership.
- **No background/push notification, scheduled job or automatic customer message.** This limitation is explicit.

### Saved views and shortcuts

- Up to five device-local filter views, scoped by user/workspace; customer search text is excluded.
- Apply/delete/storage-error handling, validated storage data.
- J/K switches visible conversations, `/` focuses search, R focuses current visible reply/private-note editor, E resolves/reopens.
- Editors, dialogs, menus, IME and modified key combinations are guarded.
- A type-only circular dependency was fixed by moving `ListState` into `features/conversation/lib/inbox-list.ts`.

### Product sharing and CRM controls

- Commerce `ProductShare` is injected into the composer through a route render slot.
- Choosing a variant inserts exact catalog name/variant/price into the draft; it never sends automatically.
- ProductPicker avoids stale placeholder results and displays error/retry states.
- Selected CRM contact exposes a version-checked status dropdown and existing tag controls directly in the panel; respects `contacts.edit`.

### Main new files to read

- `apps/web/src/features/commerce/components/product-share.tsx`
- `apps/web/src/features/conversation/components/follow-up-editor.tsx`
- `apps/web/src/features/conversation/components/saved-inbox-views.tsx`
- `apps/web/src/features/conversation/hooks/use-inbox-shortcuts.ts`
- `apps/web/src/features/conversation/hooks/use-conversation-shortcuts.ts`
- `apps/web/src/features/conversation/hooks/use-saved-inbox-views.ts`
- `apps/web/src/features/conversation/lib/follow-up-draft.ts`
- `apps/web/src/routes/app/-components/inbox-contact-controls.tsx`
- `packages/contracts/src/conversation/conversation.schema.test.ts`

There are associated behavior tests next to these files. `git status --short` and the backup manifest list every changed/untracked file.

## Latest verification — distinguish historical passes from current state

### Passed before the last caret fix

- `TURBO_ENV_MODE=loose VITEST_MAX_WORKERS=1 pnpm check`: **passed** with **732 tests across 92 files**, lint, architecture, typecheck and all builds.
- Initial production bundle: **245.4 KB gzip**, within the 250 KB budget.
- Log: `/tmp/t070-final-check.log`.
- Worker count was limited because simultaneous local agents caused timeout failures with default parallelism. No assertion, timeout, test or tooling rule was weakened.

### Latest production browser run

```bash
pnpm --filter @agent-sales/web exec playwright test e2e/inbox-sales.spec.ts e2e/responsive.spec.ts --workers=1
```

Result: **14 passed / 2 failed out of 16**. Log: `/tmp/t070-production-e2e.log`.

Failures and fixes already applied locally:

1. **Real caret bug:** R focus → fill draft → product picker inserted at start because selection was tracked only by `onSelect`.
   - Fixed in `message-composer.tsx`: `rememberSelection` runs on change, blur and select.
   - Added two regressions for fill-without-select and caret movement before blur.
   - Composer targeted suite after fix: **15/15 passed**, ESLint passed (reported by the composer agent).
   - **Not yet rebuilt/retested in production after this fix.**
2. **Test fixture selected an archived status:** CRM test tried `Chốt đơn`, which the fixture intentionally marks archived and the UI correctly excludes.
   - Changed the test to select active `Trial` and expect it after the versioned PATCH.
   - **Not yet rerun after this test correction.**

Do not report the latest full browser suite as green yet. Build before rerunning: `dist` predates the last caret fix.

### Other verified evidence

- Core inbox before convenience additions: 705 tests/84 files and 12 production browser tests passed.
- Existing team integration blocker was reproduced deterministically, then full team suite passed **11/11** on isolated Testcontainers PostgreSQL.
- Log: `/tmp/t069-repro.log` (expected failing assertion), `/tmp/t069-team-integration.log` (green).
- Pinned gitleaks 8.24.3 scan of cleaned local HEAD history found no leaks: `/tmp/t068-gitleaks-local.log`.
- The final uncommitted convenience diff has not yet had its own committed-history scan.

## QA review

An independent QA agent reviewed core and convenience code using the repo review checklist. Blocking findings were fixed: order completion after unmount, hidden F2 submit, stale note revision, stale CRM snapshots and 200-message windows. The final quick CRM controls also received a code approval.

The QA agent's verdict was **approve on code**, conditional on parent verification. No agent clicked GitHub approval. Browser testing subsequently caught the caret issue described above; its targeted fix passed but needs full verification.

All sub-agents are completed. No remaining Node/pnpm/Vite/Vitest/Git process was found with a cwd inside the inbox worktree at the stop point. No inbox preview server was intentionally left running.

## PR and CI state

PR #59 remains draft and points to the old remote commit `18adb90`.

Last inspected CI for that old commit:

- Passed: check, mocked web smoke/Lighthouse, live-backend web e2e, Python Hermes tests, conventions.
- Failed: secret scan and integration.

Both failures have local fixes, not yet published:

1. Secret scan was a **false positive** for a synthetic UUID assigned to `idempotencyKey` in `composer-draft.test.ts`. It is now generated with `crypto.randomUUID()`. No real credential was found, no scanner config/allowlist was weakened.
2. Team integration used first response from concurrent contact creation and assumed latest history was creation even after removing that contact's owner. T-071 now selects a Chi-owned contact and checks both creation and transfer history without depending on order.

Because the scanner scans history, the original draft implementation commit was amended locally. The remote therefore requires a careful history update, not an ordinary fast-forward push. Last checked GitHub review count was zero; recheck it and the remote SHA before proceeding. Never force-push main or another agent's/shared branch, and respect repo rules if review has started.

The draft PR body is outdated. A partially updated body exists at `/tmp/t068-pr-body.md`, but it still needs the convenience task, corrected IDs, latest results and final task links.

`gh` was unavailable. `/tmp/t068-github.py` is a small temporary REST/GraphQL helper using the configured Git credential in memory; no credential is stored in the file. Inspect it before use, never print credential values. `/tmp/t068-pr.json` contains only PR number/URL/node ID. These temporary helpers are not repo changes.

## Suggested completion sequence

1. Read this handoff and inspect the dirty worktree; coordinate task ID collisions before finalizing tracking.
2. Rebuild current web/dependencies, then rerun the two corrected browser cases first:

   ```bash
   pnpm exec turbo run build --filter=@agent-sales/web
   pnpm --filter @agent-sales/web exec playwright test e2e/inbox-sales.spec.ts --workers=1 --grep 'product sharing|selected CRM profile'
   ```

3. Resolve any actual failures. Do not relax timeouts/assertions or skip tests. Then run the full inbox + responsive production suite and full gate:

   ```bash
   pnpm --filter @agent-sales/web exec playwright test e2e/inbox-sales.spec.ts e2e/responsive.spec.ts --workers=1
   TURBO_ENV_MODE=loose VITEST_MAX_WORKERS=1 pnpm check
   ```

4. Refresh `docs/reference/inbox-redesign/*.png` from the newest successful screenshots. Current committed images predate the convenience additions. Optional newer screenshots are `/tmp/t070-follow-up.png` and `/tmp/t070-saved-views.png`.
5. Update task status/logs and TODO with non-colliding IDs; archive the completed convenience task according to repo skills. Update PR title/body around final scope and real verification.
6. Commit the convenience work, scan final history with pinned gitleaks, and publish the correct local history under repo rules. Existing remote SHA is recorded above; do not blindly overwrite any new remote changes.
7. Watch all CI jobs, fix genuine failures, and mark the draft ready only when gates/CI are green. Human maintainer review/merge is still required.

## Backups and artifacts

The local snapshot directory is:

`/home/kenknight/Workspace/agent-sale-inbox-handoff-2026-10-25`

It contains:

- `commits.bundle` — local inbox commits relative to the recorded origin/main prerequisite.
- `uncommitted.patch` — tracked working-tree changes against local HEAD, including binary data if any.
- `untracked.tar.gz` — new source/test/doc/task files not yet tracked.
- `state.json` — exact branch/SHAs/status/untracked manifest.
- `SHA256SUMS` — snapshot checksums.

The current worktree is the preferred continuation point. Use backups only to recover into a clean isolated worktree; do not reapply them onto the current dirty worktree.

Important local logs/artifacts:

- `/tmp/t070-final-check.log` — last full green gate before caret fix.
- `/tmp/t070-production-e2e.log` — latest 14-pass/2-fail browser run.
- `/tmp/t068-check-final.log` — earlier full core gate.
- `/tmp/t069-team-integration.log` — 11 team PostgreSQL tests passed.
- `/tmp/t068-gitleaks-local.log` — cleaned committed history scan passed.
- `apps/web/test-results/` — latest failure traces and error contexts.
- `/tmp/t068-inbox-order-1440.png`, `/tmp/t068-inbox-order-375.png`, `/tmp/t068-inbox-customer.png`, `/tmp/t068-inbox-order-details.png` — browser screenshots, potentially newer than committed copies.

## Known product limits to retain honestly

- Queues, including due reminders, cover the latest 100 loaded results, not all historical conversations.
- Thread search covers the loaded 200-message API window.
- Drafts live in tab memory and do not survive reload; saved follow-up metadata does survive reload.
- Saved views are device-local; no teammate/device synchronization.
- No background follow-up notifications or recurring CRM tasks.
- No automatic CRM identity matching by name; Meta sender ID is not a CRM UUID.
- Session-created order cards are not complete historical purchase linkage.
- Updates still use existing polling; no new realtime transport or direct attachment upload was added.
