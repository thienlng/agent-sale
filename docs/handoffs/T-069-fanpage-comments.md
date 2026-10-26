# T-069 handoff: Facebook posts, comments and originating-post context

Last updated: 2026-10-25. The owner asked Codex to document the current state so Claude can finish. **Implementation is substantial but is not declared done: the final gate failed on one existing web-test timeout, production build/E2E remain to be completed, and no implementation commit or PR has been created.**

## Start here: use the correct worktree

- Implementation worktree: `/home/kenknight/Workspace/agent-sale-fanpage`
- Implementation branch: `feat/T-069-fanpage-comments`
- Base runtime commit: `9903bc7` (the tip of `origin/feat/T-053-bot-reply-quality-and-chat-feel` at the last fetch).
- Current branch HEAD is still the initial plan commit `7376aee`; **the implementation is uncommitted, including many untracked source/test files.** Do not clean/reset this worktree or assume `git diff` alone includes everything.
- Task: `todo/T-069-implement-context-aware-facebook-post-replies-and-.md` in that worktree.
- Behavior/configuration documentation: `docs/integrations/facebook-comments.md` in that worktree.
- This handoff is copied into the primary checkout solely for discoverability. The implementation source is in the sibling worktree, not the primary checkout.

The primary checkout `/home/kenknight/Workspace/agent-sale` is being used by another agent. Its branch was `feat/T-070-instruction-rules-v2` when this handoff was written; another worktree `agent-sale-inbox` also exists for T-068. Preserve their work and do not switch their branches, stage their files, apply migrations to their databases, or overwrite their changes.

The provisional task id was T-056. After fetching upstream, we found main already assigned T-056 to another feature, so this work was renamed to **T-069**. The deletion of the old task file and addition of the T-069 file in this worktree are intentional. Only our task/board entry was synchronized into the primary checkout.

## User requirement

The owner showed Diro settings with automatic private replies to commenters and automatic hiding of negative comments, and explicitly required AI replies to use **the context of the exact originating fanpage post**. They subsequently said to implement it, not merely audit it. Keep Vietnamese chat and UI, but English code, tests and technical docs.

## Implemented

1. **Feed-comment ingress.** `packages/channels/src/meta-comments.ts` parses signed Facebook Page feed comment adds, edits and removals, retains page/post/comment/parent/author identity, distinguishes lifecycle events for deduplication, and separates comments from Messenger messages. Page child replies are observed for staff takeover/own-echo detection. Webhook HTTP signature/dedup coverage was added.
2. **Graph adapter.** `packages/channels/src/facebook-posts.ts` lists the latest 50 owned posts, reads the post/current comment/parent, verifies actual Page author and comment owning object, sends public replies, sends private replies using `recipient.comment_id`, and hides/unhides. No external URLs from customer data are fetched and no POST is automatically retried. The exact returned post id must match the requested id.
3. **Tenant-scoped settings/state.** Migration `packages/db/migrations/0024_fanpage_comments.sql` creates settings/comments tables, forced RLS, composite workspace/connection foreign keys and a GIN index for private-reply provenance. The number 0024 avoids migrations already on main and the parallel action task's 0015. No shared/live database was migrated.
4. **Channel facade.** New `FANPAGE_FACADE`, `FanpageFacadeImpl`, store port and PostgreSQL adapter own settings, source snapshots, comment lifecycle, staff override and action records. Action reservations are serialized with an advisory lock and row lock. Pending/unknown results are retained instead of blind re-sending. Staff user id is recorded. Before sending, current bot/schedule/settings/post exclusions/comment revision and queued staff/edit/delete interruptions are checked again.
5. **Out-of-order staff replies.** Interruption checks include retained completed Page-child reply events, so a staff reply received before its delayed parent comment still prevents automation. Bot-generated reply echoes are distinguished from staff replies.
6. **Separate comment processor.** `FanpageCommentProcessor` is wired into the existing agent/inbox tick without putting comments into Messenger conversations. It obtains source context, grounds an AI answer, rereads and compares actual post/thread content after inference, cancels stale answers, and routes uncertain cases to staff review. Public output has an additional phone/email guard.
7. **AI context.** The request contract adds optional structured `postContext`. Post text enriches FAQ/product retrieval and number grounding; parent comments cannot authorize prices. Delimiter characters in serialized post data are escaped. The existing base `sales-agent@7` is composed with a separate **`fanpage-context@1` overlay**, avoiding the parallel action agent's `sales-agent@8` file. Ordinary chats keep the base prompt. Comment AI runs use nullable conversation id and are still metered.
8. **Private-reply provenance.** Successful private sends record returned recipient PSID and source context. Later Messenger messages query source provenance independently of the UI's latest-100-comments window. The facade distinguishes `none`, `ready`, `ambiguous`, and `unavailable`; ambiguous/unavailable provenance triggers handoff instead of ordinary catalog guessing.
9. **API/UI.** Workspace-scoped settings/posts/comments/manual-action endpoints are declared in contracts and guarded by existing membership authentication. Channels now includes a Facebook posts/comments panel, independent automation switches, per-post exclusions, keyword configuration, source text/action outcomes, staff public/private reply and hide/unhide. Strings are in vi/en catalogs. Settings/loading/error/empty states and narrow-screen wrapping are included.
10. **Docs/tests.** Integration docs and related module/feature READMEs, AI/channel docs and task tracking were updated. New unit, HTTP, PostgreSQL, UI and Playwright coverage exists.

## Intentional scope and remaining provider limitations

- Moderation is **configured keyword matching**, case/diacritic-insensitive substring matching, not a sentiment classifier. Nonmatching complaints stay visible. Hidden comments are not deleted and can be unhidden. Be explicit about this in the final report; do not claim semantic negative-comment classification.
- Source images are represented by supplied media titles/descriptions; pixels are not fetched. Textless/image-only offers without useful metadata require staff review.
- All three automation toggles default off. An active bound bot and its reply schedule are respected.
- Private replies have a separate seven-day initial-reply rule and never open Messenger's normal reply window by themselves. A fresh Graph creation time is used for eligibility.
- Historical private provenance does not expire automatically in this release. Multiple distinct historical source posts remain ambiguous and require staff handling. This conservative policy is documented; do not silently switch to a recent post without a clear attribution policy.
- When Meta does not return a recipient id or a private send has an unknown outcome, scoped-id attribution cannot safely be inferred; staff inspection is required.
- A crashed reserved action stays pending and visible, blocks automatic replay, and requires inspection. Private reply reservations are conservatively single-use, including uncertain outcomes.
- Lists are intentionally latest 50 posts / latest 100 comments; private provenance uses a separate indexed query. No post publishing/scheduling or Instagram-comment support.
- No live customer comment was sent, hidden, edited or deleted. Official Meta Private Replies documentation was fetched; other official Page/comment documentation fetches returned HTTP 429/unavailable. Graph fields/permission behavior still need live acceptance on an app-approved test Page. See the provider references and explicit limits in the integration doc.

## Verification: actual results

Most recent full command:

```bash
cd /home/kenknight/Workspace/agent-sale-fanpage
pnpm check > /tmp/t069-final-check.log 2>&1
```

**Result: failed in web tests, not green.** Lint, architecture and typecheck completed. Backend: **37 files, 501 tests passed**. Web: **21 files passed, 1 file failed; 103 tests passed, 1 timeout**:

```text
src/features/channel/components/integrations-view.test.tsx
IntegrationsView > workspace mode: "Chờ kích hoạt" lists connected pages without a bot
Test timed out in 5000ms.
```

This is an existing test, and the machine has concurrent agent checks. Treat CPU contention/flakiness as a hypothesis, not a proven cause. Rerun the focused test and inspect if it reproduces. **Do not skip the test, raise global timeouts, or weaken the gate just to pass.** Production build was not reached by this gate.

Other verified results:

- PostgreSQL integration: **6/6 passed**, including forced RLS, cross-tenant FK rejection, concurrent action reservation, private provenance beyond 100 newer comments, queued edit interruption and completed staff event arriving before parent. Command:

```bash
pnpm --filter @agent-sales/backend exec vitest run \
  src/modules/channel/__tests__/fanpage.store.integration.spec.ts \
  --config vitest.integration.config.ts
```

- Earlier focused backend run: 304 tests passed before the last additional regressions; the latest full backend run above supersedes that count.
- Earlier focused fanpage UI run: 2/2 passed. Latest full web test output includes the new fanpage panel; only the existing integrations-view test timed out.
- Earlier channel package run: 17/17 passed. Latest gate also ran package tests; consult the full log for the final package counts.
- `git diff --check` passed at handoff.
- New Playwright `apps/web/e2e/fanpage.spec.ts` has not been run yet. It covers context/settings/unhide and 375/768/1280/1920 px, and captures a desktop screenshot.
- Temporary isolated Playwright config is prepared at `/tmp/t069-playwright.config.mjs`: tests fanpage + responsive, serves this worktree's build on port 4178 instead of another agent's port 4173, writes artifacts to `/tmp/t069-playwright-results`. It is not a repo tooling change.

## Fresh-context review

The required read-only fresh-context agent review used `review-pr` and initially found:

- Changed post content was not invalidating an in-flight AI answer.
- Ambiguous private provenance fell through to normal Messenger generation.
- Private provenance depended on the staff UI's 100-comment limit.
- A completed staff reply arriving before its parent was forgotten.

All four were fixed with regression coverage. Final reviewer message: **no remaining blocking findings; approve subject to green required checks and human maintainer approval**. Reviewer did not rerun checks. Do not equate this with human approval or claim a green gate.

## Next steps, in order

1. Read this file, repo rules and the T-069 task in the implementation worktree. Inspect both `git diff` and `git ls-files --others --exclude-standard`; preserve all implementation files.
2. Reproduce/isolate the web timeout:

```bash
pnpm --filter @agent-sales/web exec vitest run \
  src/features/channel/components/integrations-view.test.tsx \
  src/features/channel/components/fanpage-panel.test.tsx
```

3. Resolve any actual regression, then run a complete **green** `pnpm check`. If resource contention is confirmed, coordinate/check available per-run worker settings rather than changing repo config or disabling tests.
4. Run production-build Playwright coverage, including existing responsive tests:

```bash
pnpm --filter @agent-sales/web exec playwright test \
  --config=/tmp/t069-playwright.config.mjs
```

   If `/tmp` artifacts are gone, reconstruct an equivalent isolated config outside the repo using the existing Playwright config as a reference. Inspect the screenshot, fix real layout issues, and record results. Do not reuse an unrelated worktree's preview server.
5. Recheck Graph requests against accessible official docs and, if an explicitly authorized test Page is available, perform live acceptance. Never test against real customer comments. If unavailable, retain the documented limitation and do not claim live verification.
6. Update task criteria/log and this handoff with actual final results; leave incomplete criteria honest. The code is still uncommitted. Commit the implementation with `Refs: T-069`, preserving the task rename. The earlier plan-only commit still references provisional T-056; clean up that unpublished task-reference history if appropriate without changing other branches.
7. Apply `open-pr` when the gate is green. Do not merge. Use a stacked PR base `feat/T-053-bot-reply-quality-and-chat-feel` (parent PR **#57**, itself stacked on **#42**) unless the maintainer explicitly decides a different integration strategy. **Do not blindly rebase this runtime onto origin/main:** main has a separately advanced feature lineage, task/migration collisions and older versions of several bot runtime features. No main or other-agent work should be reverted.
8. No PR has been created for T-069. GitHub CLI was unavailable, but a read-only GitHub REST call using the existing git credential helper succeeded. If needed, REST can create the PR after checks/push; capture credentials only in process memory and never print them. Do not expose tokens in commands, logs or this document.

## File map

| Area | Entry points |
| --- | --- |
| Normalization/Graph | `packages/channels/src/meta-comments.ts`, `facebook-posts.ts`, `meta.ts`, `adapter.ts` |
| Contracts | `packages/contracts/src/channel/fanpage.schema.ts`, `channel.routes.ts`, `ai/ai.schema.ts` |
| Storage | `packages/db/migrations/0024_fanpage_comments.sql`, channel `application/ports/fanpage-store.ts`, `infrastructure/persistence/fanpage.store.ts` |
| Channel behavior/API | channel `api/fanpage.facade.ts`, `application/fanpage.facade.impl.ts`, `domain/comment-interruption.ts`, `interface/http/fanpage.controller.ts`, `channel.module.ts` |
| Agent/AI | conversation `application/jobs/fanpage-comment.processor.ts`, `meta-inbox.processor.ts`, `conversation.module.ts`; AI `application/playground.service.ts`; `packages/ai-core/prompts/fanpage-context@1.md` |
| Web | `apps/web/src/features/channel/{api/fanpage.ts,hooks/use-fanpage-form.ts,components/fanpage-panel.tsx,components/channel-page.tsx}` |
| Tests | channel fanpage/comment-interruption specs + PostgreSQL spec; conversation fanpage processor + Messenger provenance specs; AI playground eval cases; `apps/backend/test/http.spec.ts`; webhook `server.test.ts`; fanpage panel UI test; `apps/web/e2e/fanpage.spec.ts` |
| Docs | `docs/integrations/facebook-comments.md`, AI/channel/meta-inbox docs, module/feature READMEs, T-069 task |
