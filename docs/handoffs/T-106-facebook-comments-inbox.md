# T-106 — Facebook comments inside Inbox

Owner: external Claude implementation agent. Author: Codex. Product owner approved this parallel block in chat on 2026-10-27. Status: implementation specification; no comment feature is claimed delivered by this document.

## Outcome and approved boundaries

Staff select the existing Facebook-comments tab, find a received comment, read the originating post/parent context, then reply publicly or privately or hide/unhide without leaving Inbox. Reuse T-069 delivery and moderation behavior, retaining Rapiz branding and the current global sidebar. Build on main `e3b4b11` or newer, with this handoff/task available.

The companion T-107 work by Codex changes DM text-draft persistence and personal Enter preference. Both branches start from the same baseline. Comments remain channel-owned records, not synthetic Messenger conversations. Do not redesign other screens or extend the tenant/shop model.

Relevant parent requirements: INB-COM-01…06, INB-CTX-01/04/05, INB-MSG-02, INB-SEND-01, INB-NFR-01…06 in the [BA specification](../business/rapiz-inbox-meta-ba.vi.md). This slice supports Facebook only; Instagram comments remain explicitly unavailable. Calls, payments, generic automation, historical provider import and comment deletion are separate work.

## Current reality to preserve

Read [the comment integration behavior and verification limits](../integrations/facebook-comments.md), [architecture](../ARCHITECTURE.md) and T-069 before implementing.

- `CommentsEntry` currently explains the limitation and links to `/app/channels`.
- Fanpage endpoints are authenticated/workspace-scoped, owned by `channel`. Posts return up to 50 currently published Page-owned posts; stored comments return the latest 100 ordered by update time. Neither is a complete historical thread.
- Stored comments include connection/post/comment/parent IDs, author external ID, text/time/version/deleted/review flags, source context and action records. A reliable author display name/avatar and every historical child reply are not guaranteed. Do not invent them.
- Existing actions are `public_reply`, `private_reply`, `hide`, `unhide`; manual request UUIDs support idempotency. Pending/unknown outcomes require inspection, not blind replay. A successful private reply may return a scoped recipient ID; absence never authorizes matching by name.
- Manual staff activity pauses automation for that comment. Provider context is revalidated before acting; edits/deletes can invalidate a generated reply. A comment does not itself open an unrestricted DM window.
- Existing settings/configuration screen remains functional and consumes the existing endpoints. Keep old no-query response behavior backward compatible if extending those endpoints.
- Existing manual endpoints use workspace-member authorization. This slice must explicitly check an existing write capability for new staff controls/endpoints (prefer the current inbox write permission, `contacts.edit`, if consistent with actual permission definitions). Viewer/analyst must remain view-only. Verify this mapping and document it; do not invent a new role hierarchy.

## Interaction specification

### FB-01 — Entry and channel scope

The current Facebook-comments tab opens an embedded workspace in the existing Inbox content region. Keep the normal header/channel navigation. Show a Page picker restricted to authorized Facebook connections in the sidebar-selected business. Auto-select the sole available Page; with several Pages restore a still-authorized previous choice or request a Page once. This increment uses one selected Page, not a misleading global latest-100 aggregator.

Changing business/Page clears the selected comment, loaded pages, pending UI action confirmation and incompatible post filter. Drafts are isolated by user/workspace/connection/comment and public/private reply mode. Returning to a previously viewed comment during the same tab session restores its draft. A response for the previous context must never update the current pane.

No connected Page, expired permissions, no received comments, filtered-empty, loading and service error have distinct states. Reconnect/configuration links preserve business/channel and require appropriate permission. A failed comments fetch must not claim that a Page has no comments.

### FB-02 — List and retrieval coverage

List received comment records, newest activity first, with author name when supplied or an honest external-ID fallback, short text/media-unavailable preview, time, originating post, and explicit review/deleted/action-state indicators. Selection must remain stable while refreshing. Do not display unread, assignment or Done controls unless those comment-level capabilities are actually implemented in this task; DM fields are not reusable truth for comments.

Add cursor pagination over **stored received comments**, with a bounded page size and deterministic tie-breaker. Expose Load more until exhausted; no duplicates or skipped equal-time records under a stable fixture. New arrivals are refreshed at the top without clearing an older selected record or forcing scroll to top. A separate selected-record detail lookup must keep a selected older comment accessible when it is outside the newest list page, subject to current permission.

The UI must say it displays synchronized/received comments, not every historical comment on Facebook. No provider-history backfill is included. Search text and post filter, if offered, run over the full stored matching dataset on the server, not only loaded rows. Supply a post selector from known stored post IDs/context so comments outside the provider's latest-50 post response remain reachable. It may enrich labels from the posts endpoint, but must not hide older stored posts when that lookup fails.

Keep scope to Page + originating post + optional text search for this slice. Do not add a complete CRM filter system, provider sentiment or lead scoring.

### FB-03 — Context and history

The middle pane identifies the selected comment, author and Page, with a source-post card showing actual available post text/permalink and source time/freshness where known. Show parent-comment text from known context, the selected received comment and locally recorded action history in chronological order. Distinguish a captured snapshot from a freshly fetched source. Missing/deleted sources display an explanation and disabled actions where appropriate.

A locally recorded public reply is an outbound action, not proof that the UI has fetched every reply from Facebook. Label the scope of history honestly; do not fabricate a complete Messenger-style remote thread. If broader child-thread retrieval is essential to the design, add an explicit verified provider capability before exposing it and retain the bounded snapshot fallback.

Open-original links are derived from validated provider/context values, use safe external-link behavior and never expose credentials. A textless/image-only post can still be shown with an unavailable-context explanation; do not generate factual content from unseen image pixels.

### FB-04 — Public/private composer

Provide two clearly labelled modes directly above the composer: Public reply and Private message. Each mode has its own draft and identifies where the message will appear. Enter defaults to newline with an explicit Send button in this new comment composer; selecting/changing mode or a template never sends. Do not couple this task to T-107's DM preference store; supporting shared preferences later is additive.

Before public send, show the Page identity and parent target. Retain existing public-output privacy guards. Before private send, check existing eligibility, prior private-reply attempts and channel state. An unavailable private action explains why; never bypass provider restrictions by targeting a guessed Messenger recipient. Preserve text on failure, disallow blank/oversized input, and block double clicks while pending.

For each **attempt**, generate one UUID. Retrying a transport failure with an unconfirmed result must reuse that request key and follow the existing backend reservation behavior. A definitive rejection is not the same as unknown; preserve the stricter existing private-reply once-only reservation policy instead of generating a new request ID to circumvent it. No automatic resend. Statuses pending, sent, failed, unknown and cancelled must be distinguishable and reconciled after refresh.

Sending successfully clears only the matching draft/attempt for the original context; a later edit or a different comment/mode must remain untouched. Navigating away while a send resolves must not clear another draft or show the result as belonging to the newly selected comment. Reopening a screen does not send a restored draft.

Attachments/local upload, product insertion and full quick-reply management are excluded from this first comment slice; do not put inactive icons in the composer.

### FB-05 — Hide/unhide

Expose the existing hide/unhide actions near the comment, with text labels/tooltips and pending feedback. Derive the state only from reliable source/action outcomes; an uncertain hide result must be shown as uncertain and refreshed rather than optimistically relabelled as hidden. Restore via Unhide is explicit. Do not add Delete or Report with invented semantics.

Preserve current keyword moderation and manual-interruption behavior. Viewing a comment or switching a reply tab must not pause or enable automation; manual actions retain the current pause behavior. Do not modify global bot activation or the fanpage automation settings when simply replying.

### FB-06 — Private-reply continuation and customer context

After a successful private reply, offer Open DM only when an actual authorized conversation/scoped identity relationship is resolvable. Otherwise show sent status and explain that a DM conversation may become available after provider synchronization/customer reply. Never create a fake conversation or match a CRM customer by display name.

The existing customer panel may only show a real authorized linked customer. If there is none, show available source identity/context, not a blank editable CRM form that creates an accidental customer. Full comment-to-CRM mapping, assignment, tags and status persistence are separate tasks unless already represented accurately by existing relationships.

### FB-07 — Responsive and accessible operation

At desktop sizes the list and context/composer work inside the current Inbox layout. Reuse shell/panel tokens and controls; do not add a second global sidebar. On narrow screens move from list to selected comment with a clear Back control; Back preserves Page/post filters and drafts. Preserve reading position when loading older history. All buttons have accessible names and focus states; mode changes are operable by keyboard and do not rely on color alone.

## Data and implementation boundary

Use the `channel` facade/read ports for comment data. The web feature boundary prohibits importing channel-feature internals directly into conversation-feature components. Compose a channel-owned comment workspace through a route/page slot (the existing Inbox sales-panel/render-tools pattern is a reference), or implement an equivalent architecture-compliant composition. Keep provider I/O in `packages/channels`, never components/controllers.

Additive contract needs are bounded stored-comment listing (query/page cursor/post/search), authorized detail lookup, and any minimal projection needed by the workspace. Preserve old consumers and document response/query compatibility. Cursors must bind the Page/filter/order, reject malformed input and never accept another tenant's IDs as authorization. Query every page/detail under workspace + connection, validate role/permissions and add cross-tenant tests. If an index/migration is needed, make it additive and coordinate migration numbering immediately before merging.

Do not alter the shared bot/tenant model, conversation send/idempotency semantics or T-107's draft helpers. Existing fanpage settings controls must keep working. Add a separate list hook instead of loading settings/posts/automations as unavoidable dependencies of every comments view.

## Parallel ownership agreement

| Claude — T-106 owns | Codex — T-107 owns |
|---|---|
| Comment workspace components/hooks and route composition | DM `message-composer`, `composer-draft` and new preferences helpers |
| `channel` fanpage facade/store/controller and additive contracts | Browser private-state cleanup helper and minimal session wiring |
| Comment-specific tests and new comment browser suite | Composer/draft/preference/session tests and compose browser suite |
| Comment API/query keys and pagination | DM attachment behavior remains unchanged |

Coordinate these shared files through small independent patches: `TODO.md`, docs index, `inbox-page.tsx`/route slots, `conversation-view.tsx`, and vi/en channel-inbox JSON. Claude uses `channelInbox.commentsWorkspace.*`; Codex uses `channelInbox.composeContinuity.*`. Codex does not need `inbox-page.tsx` changes. Do not overwrite the other task's board entry or rewrite a whole translation file from an old version.

## Acceptance matrix

| ID | Scenario | Required result |
|---|---|---|
| C01 | Select comments tab/Page/post | Real stored records in the current business; correct original post/context |
| C02 | More than 100 stored records, equal timestamps | Older records reachable; stable cursor, no silent truncation, selected detail remains accessible |
| C03 | Search/filter with matches only on later pages | Server-scoped matching and pagination, honest empty state |
| C04 | Public/private switch, comment/Page/business switch | Drafts remain separate; no accidental public leak or stale selection/data |
| C05 | Double submit or timeout then retry | Single reserved action, same key for unconfirmed attempt; no blind private-reply replay |
| C06 | Comment edited/deleted or staff acts while job pending | Existing revalidation/interruption behavior preserved; UI shows current outcome |
| C07 | Hide/unhide fails or outcome unknown | No fake success/hidden state; safe retry/inspection guidance |
| C08 | No private eligibility or recipient/conversation mapping | Explain and disable/omit unavailable action; no guessed recipient or fabricated CRM link |
| C09 | Foreign workspace/Page/detail/cursor; view-only member | No data leak; unauthorized reads/writes rejected consistently, new endpoint isolation covered |
| C10 | Refresh after action or navigating during send | Recorded status reconciles; only original matching draft clears; no replay |
| C11 | Post missing/outside latest 50 or provider permission expired | Stored comments remain reachable; truthful unavailable/reconnect behavior |
| C12 | Mobile 390px, desktop, keyboard, dark mode | Main flow usable without overflow; mode/target/focus readable |
| C13 | Existing Channels fanpage settings and DM inbox | Existing behavior and T-107 branch remain compatible |

## Delivery instructions for Claude

1. Read repository onboarding/start-task rules and claim T-106 on a separate branch/worktree. Record an implementation plan before code. If the slice exceeds one day, follow the skill's draft-plan review step; the agreed product scope does not remove that workflow requirement.
2. Treat this document as the approved bounded scope. Reuse T-069 policy, adapters and outcome handling. Identify actual schema/permission gaps before coding; ask only for scope/security/architecture decisions that cannot be resolved from the approved behavior.
3. No live customer sends/hides/calls, token access, Meta-account changes or paid services in tests. Use synthetic data, provider fakes and scoped fixtures.
4. Run targeted unit/integration/browser checks, then `pnpm check`; obtain a fresh-context review. State exactly which live provider behavior was not verified.
5. Update task/docs with shipped behavior and remaining limitations. Push the branch/open a reviewable PR; coordinate any main landing with the product owner and Codex to avoid racing main.

Copyable kickoff:

> Implement T-106 using docs/handoffs/T-106-facebook-comments-inbox.md. Stay within its Facebook-only scope, keep existing T-069 safety rules, add real pagination over stored comments, and follow the parallel ownership agreement with Codex T-107. Begin with repository onboarding and a task plan. Use synthetic customers only; verify with pnpm check and independent QA. Do not modify DM draft/preference helpers or unrelated screens.
