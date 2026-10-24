# conversation

**Purpose:** <one sentence: what business capability this module owns>

**Owned tables:** <list; schema in `packages/db/src/schema/conversation.ts`>

**Public API (`api/`):**
- `CONVERSATION_FACADE` → `ConversationFacade.<useCase>(...)`
- Events: `conversation.<thing>.<verb>.v1` (schemas in `packages/contracts/src/conversation/`)

**Events consumed:** <other modules' events handled in `application/event-handlers`>

**Invariants:**
- <rule the aggregate enforces>

**Do not:** read other modules' tables; put HTTP/Drizzle types in `domain/`; call LLMs outside `ai-core`.

**Test:** `pnpm --filter @agent-sales/backend test -- conversation`
