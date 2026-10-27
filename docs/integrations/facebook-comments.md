# Facebook posts and comment automation (T-069)

Facebook comment automation is separate from the Messenger inbox. It retains the exact originating post and parent comment when generating an answer. Instagram comments and post publishing/scheduling are not implemented.

## Enable and operate

1. Apply migration `0024_fanpage_comments.sql`. Migration 0015 belongs to the concurrent bot-actions task; this migration does not depend on it.
2. In Meta's Facebook Login for Business configuration, add `pages_read_engagement`, `pages_read_user_content` and `pages_manage_engagement` alongside existing `pages_show_list`, `pages_messaging` and `pages_manage_metadata`. Configure the Page object's `feed` webhook field as well as messaging, then reconnect the Page. Basic messaging grants remain sufficient for the existing messaging connection; missing comment permissions cause comment reads/actions to fail visibly instead of disabling messaging.
3. Open **Channels → Facebook posts and comments**, select a connected Page and bind an active bot through the existing connection controls.
4. Enable public replies, private replies and/or keyword hiding independently. All default to off. Enter hide keywords one per line (3–80 characters, at most 50). Save changes, including any posts excluded from automation. The view lists the latest 50 published posts; saved exclusions also apply to posts outside this window.
5. The settings screen lists the latest 100 received comments with originating-post text, action text, status and moderation reason. Day-to-day handling happens in **Inbox → Facebook comments** (T-106, [workspace behaviour](../18-sales-inbox-workspace.md)), which pages over every stored comment. Staff can reply publicly/privately or hide/unhide a comment. Manual activity pauses automatic replies for that comment. A comment marked for review is left for staff rather than guessed at.

**Moderation policy:** this release uses explicit shop-configured keyword matching (case/diacritic-insensitive substring matching), not inferred sentiment. A complaint that does not match a configured keyword stays visible; a match is hidden, never deleted, and further automated replies pause. Shops should choose narrow keywords; the matcher cannot understand negation, quotation or sarcasm. Hidden content can be restored with Unhide. Keyword hiding applies to new and edited comments and does not depend on a bound or active bot; replies still require an active bot within its schedule. A reply that Meta explicitly rejected or that was cancelled before sending may be retried; an unknown outcome still blocks replay.

## Processing and context

- The signed webhook parser handles Page `feed` changes with `item=comment` and `verb=add|edited|remove`. It retains Page/post/comment/parent/author identifiers and keeps comment events out of Messenger conversation grouping. A comment never opens the Messenger 24-hour reply window.
- Page-generated child comments are consumed only to distinguish our own reply echoes from external staff replies. Bot echoes do not loop; an external staff reply pauses the parent comment. Edits/deletes are persisted and invalidate pending automated answers. An unreadable, missing, stale or textless source is marked for review.
- Each answer fetches the Page-owned post using its sealed Page token, validates the actual post author and the comment's owning object, then fetches the current comment text and parent. Webhook text must still match the current Graph comment. No URLs supplied by a commenter are fetched.
- AI receives bounded post text (12,000 characters), up to ten media titles/descriptions, parent text (4,000 characters) and the customer's current comment. Post text enriches FAQ/product retrieval. Post text/media descriptions authorize numerical facts; parent/customer text does not authorize money. Parent text is not inserted into numerical grounding sources.
- `sales-agent@7 + fanpage-context@1` treats post/thread content as data and directs the model to use the originating product, avoid expired or conflicting offers, resist injected instructions and avoid public disclosure of contact/order details. A deterministic public-reply guard also rejects phone/email output. Media pixels are not fetched: image-only offers without adequate text/description require staff review.
- After inference the post/thread is fetched again. A changed content fingerprint cancels the old answer. Before each send, current settings, post exclusion, bot activation/schedule, comment version and queued edits/deletes/staff replies are rechecked. External changes after the final check and before Meta accepts a request remain an unavoidable distributed-system race.
- Public replies use the comment's replies edge; private replies use the Page messages endpoint with `recipient.comment_id`, never a presumed Messenger recipient id. Private-reply eligibility is checked using the freshly read comment creation time, separately from Messenger rules.
- Successful private replies record Meta's returned recipient id and originating context. Later Messenger replies query this provenance independently of the staff UI's 100-comment window and refetch the source. Multiple source posts or unavailable/deleted context cause handoff, not ordinary catalog inference. Provenance is retained with comment history and has no automatic expiry in this release: once multiple source posts are associated with a recipient, ambiguous follow-ups continue to require staff rather than silently selecting a post by recency. Staff use the existing inbox takeover controls; there is no automatic disambiguation reset. If Meta does not return a recipient id or a send has an unknown outcome, staff must inspect the thread; this release cannot safely infer a scoped-id mapping.

## Delivery and persistence

The channel module owns `fanpage_settings` and `fanpage_comments`. Both use forced RLS, workspace-scoped queries and composite workspace/connection foreign keys to prevent foreign-tenant connection references even in direct storage calls. Comment documents retain lifecycle state, source snapshots and action records; staff action records include the acting user id. No post/comment content, token or private message is logged.

A transaction advisory lock plus a locked comment row serialize action reservations. Automatic actions are reserved once per comment/kind; private replies are reserved once even across manual requests. Manual request UUIDs are idempotency keys. Network I/O occurs after committing the reservation, with no automatic transport retries. An explicit rejection is `failed`; timeout/5xx/malformed success is `unknown`. An `auth_expired` write marks the connection for re-authentication. Uncertain outcomes require inspection rather than blind resending.

If a process dies between reservation and recording delivery, `pending` remains visible and blocks automatic replay of that kind; it means delivery may be uncertain. Staff can inspect Facebook directly and use manual moderation or a distinct public reply after confirming the outcome. Private replies remain conservatively blocked after an attempted reservation. Exhausted comment jobs are retained as dead letters, and their stored comments are marked for review where possible.

## API

Every endpoint is authenticated and workspace-scoped under `/api/v1`:

| Method | Path | Behavior |
| --- | --- | --- |
| GET / PATCH | `/channels/{id}/fanpage/settings` | Read / replace full validated settings |
| GET | `/channels/{id}/fanpage/posts` | Latest 50 Page-owned published posts |
| GET | `/channels/{id}/fanpage/comments` | Stored received comments, newest activity first: see below. Response `{ data, nextCursor }` |
| GET | `/channels/{id}/fanpage/comments/{commentId}` | One stored comment and its stored parent (`{ data, parent }`), read without side effects |
| GET | `/channels/{id}/fanpage/comments/{commentId}/source` | Fresh read-only Graph lookup of the post/thread: `fresh` (post, parent text, comment text, `matchesStored`) or `unavailable` with a reason (`reconnect`, `permission`, `missing`, `mismatch`, `provider`). Nothing is stored |
| GET | `/channels/{id}/fanpage/comment-posts` | Up to 200 posts known from stored comments, with counts and the newest snapshot text, so posts outside the latest-50 list stay selectable |
| POST | `/channels/{id}/fanpage/comments/{commentId}/actions` | Manual public/private reply or hide/unhide, with request UUID; requires `contacts.edit` |

**Listing (T-106).** Without query parameters the list keeps its original answer: the newest 100 (now also with `nextCursor`, an additive field). With any of `limit` (1–50, default 30), `cursor`, `postId` or `q`, it pages over the whole stored set by `(updated_at desc, comment_id desc)`, microsecond precision; equal times never skip or repeat a row. `q` matches comment text (case-insensitive, literal `%`/`_`) or an exact author id; `postId` filters by originating post. The cursor is opaque and bound to the Page, post filter and search text; a malformed cursor or one from another list or Page is rejected with 400. A comment updated while someone pages moves to the top (its activity changed) and is not repeated in that scan. Reads never pause automation, mark review or bump activity.

**Manual actions (T-106).** A request id that already has a recorded action is answered with `action: null` before any check, so retrying an attempt whose answer was lost never becomes a refusal that invites a second send. Otherwise, before reserving, every manual action reads the current comment on Facebook, even when a snapshot exists. A deleted comment, a version other than the optional `version` the staff member saw, Facebook text/author different from the stored record (the comment is then marked for review) or a post/comment no longer readable is refused with 409. An expired token or a Facebook read that did not answer is refused with 503 before anything is reserved; an expired token also marks the connection for re-authentication. The verified snapshot is stored with the action. A public reply containing a phone number or email (the same guard as automatic replies, `exposesContactDetails`) needs `confirmPublicContact: true`. Reservation, idempotency, once-only private reply and no-automatic-retry rules are unchanged. `action: null` (duplicate request id, already-attempted private reply, a version that changed during the check) is not a success: clients re-read the comment and match by request id.

Non-Facebook or foreign connections return 404. Foreign workspaces are rejected by the existing membership guard. Reads need workspace membership. Replies and moderation need `contacts.edit` (owner, admin, sales, care; not analyst), the same write capability as the Messenger inbox. Settings are unchanged by this task.

## Provider references and verification limits

Implementation targets the configured `META_GRAPH_VERSION` (default `v24.0`). Checked on **2026-10-25**:

- [Meta Private Replies](https://developers.facebook.com/docs/messenger-platform/discovery/private-replies): fetched successfully; documents one initial private reply, within seven days, with subsequent free-form messaging only after the customer responds. The request targets `/{PAGE-ID}/messages` with `recipient.comment_id`.
- [Meta Pages webhooks](https://developers.facebook.com/docs/pages-api/webhooks-for-pages/) and [Page webhook reference](https://developers.facebook.com/docs/graph-api/webhooks/reference/page/): official reference URLs; fetch attempts were rate-limited/unavailable. The feed payload behavior is covered with synthetic fixtures and still requires live acceptance on an app-approved Page.
- [Meta Comment reference](https://developers.facebook.com/docs/graph-api/reference/comment/): official reference URL; fetch attempts were rate-limited/unavailable. Comment fields, public replies, hide/unhide and app-specific permission behavior are adapter-tested but **not live-verified** in this task.

No real customer comments were sent, hidden or altered during automated verification. App Review, correct Page tasks, scopes and a public HTTPS webhook remain deployment prerequisites. Never claim the fixture suite proves Meta approval or live delivery.
