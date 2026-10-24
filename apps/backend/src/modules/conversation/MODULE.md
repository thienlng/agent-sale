# conversation

**Purpose:** The multichannel inbox: conversations and messages per customer, staff sends, human takeover and the bot reply pipeline for Meta events.

**Owned tables:** `conversations`, `conversation_messages` (schema in `packages/db/src/schema/conversation.ts`, migration 0007).

**Public API (`api/`):**

- `CONVERSATION_FACADE` → `list`, `get`, `update`, `send`, `receive`, `getReplyContext`, `commitBotReply`
- `CONVERSATION_RUNNER` (`MetaInboxProcessor.tick`) — run only by the `agent` entry.
- HTTP: `/conversations`, `/conversations/{id}`, `/conversations/{id}/messages`.

**Events consumed:** none (claims `channel_webhook_events` through the channel facade).

**Invariants:**

- Every receipt is persisted before inference; a burst is answered once, for its newest customer message in **receipt order** (claim order), never Meta timestamps. The model gets all messages in that order and every consecutive customer message after the last bot/staff message **of any status** (sent, failed, pending, unknown: a reply attempt, even a failed one, means the earlier messages were answered; only sent text is shown to the model as an assistant turn) is merged into ONE customer turn (newline-joined, attachment notes once, `jobs/reply-turns.ts`), so one reply answers every question after the last reply; a message claimed in a later tick gets its own reply; a retry of an event whose reply was already attempted (last stored message is outbound) is skipped, never answered or sent twice. A skipped customer message is logged with its reason.
- Message ids are monotonic UUIDv7 (`nextMessageId`), so "newest" and "already answered" are decided by storage order, not by Meta timestamps or `createdAt` (which is the Meta time for inbound).
- Customer images: with `BOT_IMAGE_VISION` on, the newest 3 image attachments of the pending turn are fetched by the SSRF-safe `SafeImageFetcher` (Meta CDN allowlist, `BOT_IMAGE_EXTRA_HOSTS` for tests, never logged or stored) and sent with the turn; failures degrade to the text-only note/handoff below.
- Media the model cannot see: a text message with attachments carries an explicit note in the customer turn; media-only unanswered content gets the bot's `handoffMessage` once and the conversation switches to `human`.
- A staff send or an unmatched Meta echo pauses the bot (`mode: human`, optional auto-resume per bot settings). A bot reply is dropped if control or revision changed after generation.
- The echo of an uncertain (`unknown`/`pending`) send is matched by text and attachment count, not treated as a staff reply.
- Only a customer message opens the 24-hour window. A message is either text or one HTTPS attachment.
- Failed processing retries after 20 s, then 60 s; after the last attempt the conversation is handed to staff.

**Do not:** read other modules' tables; put HTTP/Drizzle types in `domain/`; call LLMs outside `ai-core`.

**Test:** `pnpm --filter @agent-sales/backend test -- conversation`
