# conversation

**Purpose:** The multichannel inbox: conversations and messages per customer, staff sends, human takeover and the bot reply pipeline for Meta events.

**Owned tables:** `conversations`, `conversation_messages` (schema in `packages/db/src/schema/conversation.ts`, migration 0007).

**Public API (`api/`):**
- `CONVERSATION_FACADE` → `list`, `get`, `update`, `send`, `receive`, `getReplyContext`, `commitBotReply`
- `CONVERSATION_RUNNER` (`MetaInboxProcessor.tick`) — run only by the `agent` entry.
- HTTP: `/conversations`, `/conversations/{id}`, `/conversations/{id}/messages`.

**Events consumed:** none (claims `channel_webhook_events` through the channel facade).

**Invariants:**
- Every receipt is persisted before inference; a burst is answered once, for its newest customer text.
- Message ids are UUIDv7, so "already answered" is decided by storage order, not by Meta timestamps.
- A staff send or an unmatched Meta echo pauses the bot (`mode: human`, optional auto-resume per bot settings). A bot reply is dropped if control or revision changed after generation.
- The echo of an uncertain (`unknown`/`pending`) send is matched by text and attachment count, not treated as a staff reply.
- Only a customer message opens the 24-hour window. A message is either text or one HTTPS attachment.
- Failed processing retries after 20 s, then 60 s; after the last attempt the conversation is handed to staff.

**Do not:** read other modules' tables; put HTTP/Drizzle types in `domain/`; call LLMs outside `ai-core`.

**Test:** `pnpm --filter @agent-sales/backend test -- conversation`
