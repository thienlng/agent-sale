# knowledge

**Purpose:** the facts a bot may state — FAQ question/answer pairs now; documents, URLs and embeddings later (docs/06 §2, §4).

**Owned tables:** `knowledge_items` (tenant, forced RLS — migration 0002; schema in `packages/db/src/schema/knowledge.ts`).

**Public API (`api/`):** `KNOWLEDGE_FACADE` → `listFaqs`, `createFaq`, `updateFaq`, `deleteFaq`, `seedFaqs`, `searchFaqs` (returns `FaqHit` with a 0..1 score). No HTTP of its own: the `bot` module serves `/bots/{botId}/faqs` after checking the bot belongs to the workspace.

**Events consumed:** none.

**Invariants:**
- Question 3–500 chars, answer 1–4000 chars (trimmed).
- `search_text` = folded (lowercase, no diacritics, đ→d) question + answer, recomputed on every save; trigram-indexed. Customers typing without accents still match.
- `searchFaqs` drops hits below `MIN_SCORE` (0.15) so the AI is never handed irrelevant "sources".
- Callers must have verified `botId` belongs to the workspace; RLS still guarantees no cross-tenant read.

**Do not:** import the bot module (dependency goes bot → knowledge); put AI/LLM logic here.

**Test:** `pnpm --filter @agent-sales/backend test -- knowledge`
