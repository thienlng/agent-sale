# T-106 independent snapshot review — 32747d7

Date: 2026-10-28 (Asia/Bangkok). Reviewer: fresh-context same-model agent `qa_t106_handoff_acceptance`, coordinated by Codex.

Scope: immutable commit `32747d7` against documentation baseline `466b256`, not the external Claude worktree's ongoing uncommitted changes. No tests, browser/provider actions or code edits were performed by this reviewer. Reconcile these findings with any newer changes before applying fixes.

Verdict for this snapshot: request changes. This is not final delivery acceptance or a claim of full Meta parity.

## P2 — Keep recorded pending attempts locked

`apps/web/src/features/channel/lib/comment-send.ts:12–13` maps recorded `pending` to `unknown`. `comment-drafts.ts:74–84` then unlocks and gives the next click a new UUID.

Reproduce: first public request times out while still running; retry with the same UUID returns `action:null`; reconciliation finds `pending`; next Send creates a second public action. Preserve distinct pending state and its original UUID; permit status reconciliation until a terminal outcome. Add a regression for this exact sequence.

## P2 — Reconcile an existing request before fresh-source rejection

`apps/backend/src/modules/channel/application/fanpage.facade.impl.ts:223–225` validates the current source before recognizing existing action keys at lines 236–244. If a successful response was lost and the source is edited/deleted, the same-ID retry receives a new refusal instead of the recorded send. `comment-send.ts:29–31` treats it as definitive without reading the stored action, allowing another public attempt.

Resolve an existing authorized request ID before validating a new action, or reconcile the uncertain previous action before treating refusal as definitive. Test timeout → action actually sent → source edited → same-ID retry. Preserve permission and cross-tenant checks before exposing the action.

## P2 — Preserve moderation request IDs after transport failures

`apps/web/src/features/channel/components/comments/comment-detail.tsx:281–294` generates a fresh UUID for every hide/unhide click and discards it after an unconfirmed outcome. Retrying can reserve a second operation while the first is unresolved; opposite operations may race.

Keep the original attempt per comment/action, reconcile it and reuse its UUID on retry. Do not allow an opposing moderation action until the earlier action is resolved. Test an unconfirmed hide followed by retry and attempted unhide.

## P2 — Paginate the stored-post selector

`apps/backend/src/modules/channel/application/fanpage-comment-inbox.ts:130` silently caps known posts at 200 without continuation. `comments-pane.tsx:36–45` builds its filter only from those results, hiding older stored posts on a Page with at least 201 posts.

Add pagination or server search over known stored posts and a >200-post fixture. Keep the UI honest about synchronized comments and preserve the existing comments cursor/detail scoping.

## Positive checks and boundaries

Comment pagination, pure stored detail reads, server capability checks on actions, mode-separated draft keys and route composition otherwise match the handoff. The snapshot does not modify T-107's DM draft/preference helpers.

Canonical scope: `/home/kenknight/Workspace/agent-sale-t106/docs/handoffs/T-106-facebook-comments-inbox.md`.
External implementation workspace: `/home/kenknight/Workspace/agent-sale-t106`.

## Copyable instruction for Claude

Review `/tmp/T-106-review-32747d7.md` against your latest work. Address the four concrete snapshot findings that remain, add their regression tests, and request fresh QA before claiming T-106 complete. Do not change Codex T-107 DM draft/preference helpers. Keep existing provider safety and permission checks. Re-run your required checks with synthetic customers only.

## Integration coordination

As of this handoff, the external worktree has advanced to implementation commit `5f3c32c` and follow-up commit `cb258fb`; this report is not acceptance of those newer revisions. Reconcile findings before applying changes.

The external follow-up uses T-108, which collides with PR #72's T-108 scanner blocker. PR #72 also allocates T-109 for the statistics acceptance timezone blocker. Allocate a fresh unused ID for the external fanpage authorization follow-up and update its tracking references before integrating branches. Preserve both tasks. Do not edit Codex's DM draft/preference helpers.
