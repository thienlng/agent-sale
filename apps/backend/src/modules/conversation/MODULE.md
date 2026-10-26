# conversation

**Purpose:** The multichannel inbox: conversations and messages per customer, staff sends, human takeover and the bot reply pipeline for Meta events.

**Owned tables:** `conversations`, `conversation_messages` (schema in `packages/db/src/schema/conversation.ts`, migrations 0007, 0024). `conversations.data` is the document; the index columns (`unread_count`, `awaiting_since`, …) are derived from it by the store on every save and are what the list filters on.

**Public API (`api/`):**

- `CONVERSATION_FACADE` → `list(ws, query, viewerId)` (filters, tabs, counts), `get`, `update` (incl. `assigneeId`), `markRead`, `markUnread`, `addNote`, `refreshCustomerProfile`, `listTags`, `addTag`, `send`, `receive`, `getReplyContext`, `commitBotReply`, `handOff`, `commitBotImage`
- `CONVERSATION_RUNNER` (`MetaInboxProcessor.tick`) — run only by the `agent` entry.
- HTTP: `/conversations`, `/conversations/{id}`, `/conversations/{id}/messages`, `/conversations/{id}/read`, `/conversations/{id}/unread`, `/conversations/{id}/notes`, `/conversations/{id}/tags` (GET, POST; the tag library is crm's, removal via crm's `/tag-assignments/{id}/remove`).

**Events published (outbox):** `conversation.message.received.v1` (+ `channelId`, `occurredAt`, `firstMessage`), `conversation.reply.reserved.v1`, `conversation.reply.completed.v1` (+ `channelId`, `sender`, `occurredAt`), `conversation.control.updated.v1` — statistics read the first and third.

**Events consumed:** none (claims `channel_webhook_events` through the channel facade).

**Invariants:**

- Every receipt is persisted before inference; a burst is answered once, for its newest customer message in **receipt order** (claim order), never Meta timestamps. The model gets all messages in that order and every consecutive customer message after the last bot/staff message **of any status** (sent, failed, pending, unknown: a reply attempt, even a failed one, means the earlier messages were answered; only sent text is shown to the model as an assistant turn) is merged into ONE customer turn (newline-joined, attachment notes once, `jobs/reply-turns.ts`), so one reply answers every question after the last reply; a message claimed in a later tick gets its own reply; a retry of an event whose reply was already attempted (last stored message is outbound) is skipped, never answered or sent twice. A skipped customer message is logged with its reason.
- Message ids are monotonic UUIDv7 (`nextMessageId`), so "newest" and "already answered" are decided by storage order, not by Meta timestamps or `createdAt` (which is the Meta time for inbound).
- Customer images: with `BOT_IMAGE_VISION` on, the newest 3 image attachments of the pending turn are fetched by the SSRF-safe `SafeImageFetcher` (Meta CDN allowlist, `BOT_IMAGE_EXTRA_HOSTS` for tests, never logged or stored) and sent with the turn; failures degrade to the text-only note/handoff below.
- Media the model cannot see: a text message with attachments carries an explicit note in the customer turn; media-only unanswered content gets the bot's `handoffMessage` once and the conversation switches to `human`.
- Bot pictures: after the text reply is committed, the processor sends each `images` entry of the AI answer (max 3) through `commitBotImage` (attachment `image`, empty text, key `bot:<event id>:img<n>`), sequentially. It needs only that the bot still holds the conversation (no revision check: the text reply already bumped it) and the open 24-hour window. A failure is a failed/unknown outbound message, never an event failure, retry or handoff; a null result (takeover, bot off) or a closed window stops the remaining pictures.
- A staff send or an unmatched Meta echo pauses the bot (`mode: human`, optional auto-resume per bot settings). A bot reply is dropped if control or revision changed after generation.
- The echo of an uncertain (`unknown`/`pending`) send is matched by text and attachment count, not treated as a staff reply.
- Only a customer message opens the 24-hour window. A message is either text or one HTTPS attachment.
- Failed processing retries after 20 s, then 60 s; after the last attempt the conversation is handed to staff.

- Read state is shared by the shop and never bumps `revision` or `updatedAt`. `awaitingSince` is set by a customer message and cleared by any outbound one (human, bot or staff echo).
- The agent entry calls `refreshCustomerProfile` (not awaited) after each customer message; it stamps `profileFetchedAt` first, so Meta is asked at most once a day after a success and every 15 minutes after a failure, and it never throws.
- Tag chips are filled from `CrmFacade` on list, detail and mutation responses and are never stored; tag filters ask crm for id sets (`idsIn`/`idsNotIn`) that the SQL query applies.
- Assignees are validated through `TeamFacade` (active members only), names come from `IdentityFacade`.

**Do not:** read other modules' tables; put HTTP/Drizzle types in `domain/`; call LLMs outside `ai-core`.

**Test:** `pnpm --filter @agent-sales/backend test -- conversation`
