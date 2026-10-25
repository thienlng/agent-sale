# conversation

**Purpose:** The multichannel inbox: conversations and messages per customer, staff sends, human takeover and the bot reply pipeline for Meta events.

**Owned tables:** `conversations`, `conversation_messages` (schema in `packages/db/src/schema/conversation.ts`, migrations 0007, 0024). `conversations.data` is the document; the index columns (`unread_count`, `awaiting_since`, …) are derived from it by the store on every save and are what the list filters on.

**Public API (`api/`):**

- `CONVERSATION_FACADE` → `list(ws, query, viewerId)` (filters, tabs, counts), `get`, `update` (incl. `assigneeId`), `markRead`, `markUnread`, `addNote`, `send`, `receive`, `getReplyContext`, `commitBotReply`
- `CONVERSATION_RUNNER` (`MetaInboxProcessor.tick`) — run only by the `agent` entry.
- HTTP: `/conversations`, `/conversations/{id}`, `/conversations/{id}/messages`, `/conversations/{id}/read`, `/conversations/{id}/unread`, `/conversations/{id}/notes`.

**Events published (outbox):** `conversation.message.received.v1` (+ `channelId`, `occurredAt`, `firstMessage`), `conversation.reply.reserved.v1`, `conversation.reply.completed.v1` (+ `channelId`, `sender`, `occurredAt`), `conversation.control.updated.v1` — statistics read the first and third.

**Events consumed:** none (claims `channel_webhook_events` through the channel facade).

**Invariants:**

- Every receipt is persisted before inference; a burst is answered once, for its newest customer text.
- Message ids are UUIDv7, so "already answered" is decided by storage order, not by Meta timestamps.
- A staff send or an unmatched Meta echo pauses the bot (`mode: human`, optional auto-resume per bot settings). A bot reply is dropped if control or revision changed after generation.
- The echo of an uncertain (`unknown`/`pending`) send is matched by text and attachment count, not treated as a staff reply.
- Only a customer message opens the 24-hour window. A message is either text or one HTTPS attachment.
- Failed processing retries after 20 s, then 60 s; after the last attempt the conversation is handed to staff.

- Read state is shared by the shop and never bumps `revision` or `updatedAt`. `awaitingSince` is set by a customer message and cleared by any outbound one (human, bot or staff echo).
- Assignees are validated through `TeamFacade` (active members only), names come from `IdentityFacade`.

**Do not:** read other modules' tables; put HTTP/Drizzle types in `domain/`; call LLMs outside `ai-core`.

**Test:** `pnpm --filter @agent-sales/backend test -- conversation`
