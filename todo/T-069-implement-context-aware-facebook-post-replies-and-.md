---
id: T-069
title: Implement context-aware Facebook post replies and comment automation
status: review                 # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner: "@agent:codex, @agent:claude"
feature_ids: [CHN-08]
created: 2026-10-25
updated: 2026-10-25
branch: feat/T-069-fanpage-comments
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

The owner requested a fanpage post/comment feature audit on 2026-10-25, using a Diro screenshot showing automatic private replies to commenters and automatic hiding of negative comments. The owner explicitly requires replies to use the originating post context. CHN-08 is specified but is not implemented in the current messaging pipeline.

Audit evidence (working tree, 2026-10-25):

- `packages/channels/src/meta.ts:31`: parsing only iterates `entry.messaging`; post/comment changes produce no normalized events. `apps/webhook/src/server.ts` acknowledges the parsed event count, so unsupported payloads can receive HTTP 200 without being stored.
- `apps/backend/src/modules/channel/infrastructure/clients/meta-oauth.ts:30` and `:228`: configured permissions and subscription fields cover messaging; no feed subscription is requested. Required permissions and current Meta policies must be verified against official documentation before implementation.
- `apps/backend/src/modules/conversation/application/jobs/meta-inbox.processor.ts:130`: processing explicitly skips event types other than `message`.
- `packages/channels/src/meta.ts:65`: outbound delivery supports peer messaging only; no public comment reply, comment-targeted private reply or hide/unhide operation exists.
- `packages/channels/src/adapter.ts`: `comment` exists as a union member only; no post/comment/parent identifiers are modeled. `packages/contracts/src/ai/ai.schema.ts` and the processor's AI request carry chat messages/images, without structured originating-post context.
- `apps/backend/src/modules/conversation/application/conversation.facade.impl.ts:144`: conversation lookup groups by channel and sender. Reusing this grouping for comments without per-comment post context would risk mixing different posts from the same customer. Its inbound-window logic must also distinguish comments from Messenger messages.
- Bot settings, channel/conversation contracts, database schemas and web UI contain no implemented post management, private-reply automation or negative-comment moderation settings found in this audit.

## Goal

Support Facebook post comments, grounded public/private replies and configurable moderation, preserving the exact originating post throughout the pipeline.

## Scope

- Normalize and persist comment lifecycle events with page, post, comment, parent and author identifiers; handle own-page replies and duplicate deliveries safely.
- Fetch and tenant-scope originating post text, available media metadata, permalink and retrieval time; include relevant parent/reply thread context.
- Pass bounded, explicitly untrusted post/thread context into AI retrieval and reply generation; preserve provenance on public and private replies.
- Provide separate controls for public replies, private replies and negative-comment hiding, with per-page defaults and per-post enable/disable (CHN-08).
- Add adapter operations, idempotent action records, staff visibility, moderation reasons and manual unhide/override.

## Out of scope

- Publishing or scheduling new fanpage posts; unrelated bot API actions (T-055), typography (T-054), and changes to existing agents' work.
- Instagram comment support is a separately verified follow-up; do not imply existing Messenger/Instagram messaging support includes comments.

## Acceptance criteria

- [ ] Verify current official Meta permissions, subscription payloads, identifier semantics and public/private reply eligibility; document source URLs and verification date before implementing provider behavior.
- [ ] A signed comment event reaches storage and processing with its originating post and thread identifiers; duplicate deliveries do not duplicate replies or moderation actions.
- [ ] A comment such as "How much is this?" under two posts about different products/prices receives the correct post-specific answer, even from the same author in interleaved events.
- [ ] Public replies and private replies both retain the source post context. Product retrieval and numerical grounding do not discard legitimate post-specific offers or invent missing values.
- [ ] Deleted/unreadable posts, stale or conflicting offers, unavailable images and missing permissions produce an explicit safe fallback or handoff rather than a guessed answer.
- [ ] Prompt injection in posts/comments cannot override system rules; post context and caches are isolated by workspace and connected page.
- [ ] Page-generated replies cannot trigger loops; comment edit/delete events and concurrent staff replies are covered by tests.
- [ ] Private replies obey separately verified comment-reply rules; a comment does not automatically open the existing Messenger reply window or assume a comment author ID is a messaging recipient ID.
- [ ] Settings actually control each action independently, including per-post exclusions, with permission checks, cross-tenant rejection and Vietnamese/English UI states.
- [ ] Moderation distinguishes complaints from abuse/spam using a documented policy; uncertain cases remain visible for staff review, with reason/action records and manual unhide.
- [ ] Timeout/unknown delivery outcomes do not cause blind duplicate sends; re-auth, retries and exhausted events remain visible to staff.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (or "no docs impact" stated)

## Plan

1. Isolate work from concurrent T-055/T-054 in a worktree based on the latest pre-action runtime commit (9903bc7); do not switch or clean the shared checkout.
2. Add normalized feed-comment lifecycle parsing and bounded Graph adapter operations; test signatures, identifiers, own-page loops, post ownership, public/private targets and errors.
3. Add tenant-scoped fanpage settings, comment snapshots and durable action reservations with an additive migration numbered 0024 (0015 belongs to T-055). Preserve unknown send outcomes and version checks.
4. Route comment jobs separately from Messenger; fetch fresh post/thread context, enrich retrieval and numerical grounding, and version the prompt with eval coverage. Use deterministic configured keyword moderation, avoiding guessed sentiment decisions.
5. Add workspace-scoped settings/posts/comments/manual-action APIs and a panel under existing channel screens, with vi/en strings, error/loading/empty states and cross-tenant tests.
6. Run focused tests, integration tests, evals and pnpm check; document actual behavior and remaining live Meta verification limitations. Prepare reviewable commits/PR without merging.

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-25 — created.
- 2026-10-25 — Static audit traced OAuth subscription, webhook parsing, outbound adapter, conversation grouping and AI input. Existing concurrent T-054/T-055 changes were left intact. No live Meta calls or real comment actions were performed.

- 2026-10-25 — Owner requested a written handoff for Claude. Implementation remains uncommitted in the isolated worktree. Final gate passed lint/arch/typecheck and all 501 backend tests but failed on an existing integrations-view web test timeout (103 web tests passed); production build/E2E remain. All six PostgreSQL integration tests passed. Fresh-context review reported no remaining blockers, conditional on green checks. See the handoff for exact continuation commands and provider limitations.

## Links

- [Claude continuation handoff](../docs/handoffs/T-069-fanpage-comments.md)

- [CHN-08](../docs/02-functional-requirements.md)
- [Current messaging behavior](../docs/meta-inbox.md)
- [Channel integration design](../docs/07-channel-integrations.md)
- [AI design](../docs/06-ai-engine.md)

- 2026-10-25 — Claude took over from the handoff. The `integrations-view` web timeout did not reproduce in isolation (8/8 focused tests passed) and the full `pnpm check` then passed end to end (lint, arch, typecheck, tests, build; 501 backend, 22 web files). Playwright on the production build with an isolated config (port 4178): 10/10 passed (fanpage at 375/768/1280/1920 plus the existing responsive suite); the desktop screenshot showed no layout problem. Not verified: live Meta Graph behaviour (no authorised test Page); the Graph fields and permissions still need acceptance on an app-approved test Page. Acceptance criteria about official Meta verification and live provider behaviour stay unchecked on purpose.
