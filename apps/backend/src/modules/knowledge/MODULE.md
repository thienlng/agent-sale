# knowledge

**Purpose:** the facts a bot may state — FAQ question/answer pairs, situation instructions, quick replies and media references; documents and embeddings later (docs/06 §2, §4).

**Owned tables:** `training_items`, `training_history` (migrations 0008, 0012, 0016) and `knowledge_items` (tenant, forced RLS — migration 0002; schema in `packages/db/src/schema/knowledge.ts`).

**Public API (`api/`):** `KNOWLEDGE_FACADE` → `listFaqs`, `createFaq`, `updateFaq`, `deleteFaq`, `seedFaqs`, `searchFaqs` (returns `FaqHit` with a 0..1 score). No HTTP of its own: the `bot` module serves `/bots/{botId}/faqs` after checking the bot belongs to the workspace.

**Training API:** `TRAINING_FACADE` → `list`, `create`, `update`, `delete`, `recordChange(s)`, `history`, `historyEntry`, `restoreItem`, `seedStarterRules`. The bot controller checks ownership before serving `/bots/{botId}/training-items` and `/training-history` (+ `/{historyId}/restore`). Material changes and history commit atomically; history keeps the actor name, changed fields and the item before the change. Media are HTTPS references, optionally grouped in `media_folder` items. Scenarios also have `enabled` and `section` (`general` | `after_order`; migration 0016): both are stored, diffed into the history and restored from snapshots. `seedStarterRules` (`domain/starter-rules.ts`) adds the Vietnamese starter situations of the bot's industry (`starterRulesFor(industry)`: hotel has its own set, other industries the shared non-style rules; style rules are personality settings and are not seeded) for titles the bot lacks (idempotent, recorded in history); the caller passes `options.industry`; `bot` calls it on bot creation and serves `POST /bots/{botId}/training-items/starter-rules`. See `docs/training-workspace.md`.

**Events consumed:** none.

**Invariants:**

- Question 3–500 chars, answer 1–4000 chars (trimmed).
- `search_text` = folded (lowercase, no diacritics, đ→d) question + answer, recomputed on every save; trigram-indexed. Customers typing without accents still match.
- `searchFaqs` drops hits below `MIN_SCORE` (0.15) so the AI is never handed irrelevant "sources".
- A media item's `folderId` points at a `media_folder` of the same bot; deleting a folder deletes (and records) its media first.
- Callers must have verified `botId` belongs to the workspace; RLS still guarantees no cross-tenant read.

**Do not:** import the bot module (dependency goes bot → knowledge); put AI/LLM logic here.

**Test:** `pnpm --filter @agent-sales/backend test -- knowledge`
- Bot image storage uses the shared S3-compatible adapter in `apps/backend/src/common/storage` (`S3PublicObjectStorage`, `decodeImage`, `InvalidImageError`, `MediaStorageUnavailableError`), also used by commerce for product pictures. Upload errors carry `details.reason` (`INVALID_IMAGE`, `MEDIA_STORAGE_UNAVAILABLE`).
