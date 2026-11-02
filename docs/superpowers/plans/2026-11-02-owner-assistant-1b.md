# Owner assistant 1b — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner assistant hands and a memory: route-derived tools (reads run, writes become owner-approved proposals), bounded memory, platform skills, auto-compaction and `ui_fill_form`.

**Architecture:** Pure pieces (safety scanner, SKILL.md parser, compaction planner) go into `packages/ai-core/src/agent`. Route contracts gain an `assistant` field, and the backend builds a tool catalog from `allRoutes`. Reads execute in-process through Fastify `inject` with the owner's own bearer token, so the real auth, membership and RLS apply. Writes are stored as `assistant_proposals` and executed only when the owner approves. The `assistant` module gains memory, skills, compaction and proposals on top of the 1a turn service.

**Tech Stack:** NestJS 12 on Fastify, Drizzle + PostgreSQL 16 (RLS through `withAccount`), Zod 4, Vitest, React 19 + TanStack Query, zustand, i18next.

**Spec:** `docs/superpowers/specs/2026-11-02-owner-assistant-core-design.md` (§4, §5, §6, §9, §10, §18). ADR: `docs/adr/ADR-023-owner-assistant.md`.

## Global Constraints

- English for code, comments, docs and commits. Vietnamese only in i18n files and in the assistant's persona and answers.
- Account owners only. Every new assistant route and tool goes through `resolveOwnerScope` (403 for staff, billing and other accounts; 404 for another owner's rows).
- Every assistant table carries `account_id` and `owner_user_id`, has the account RLS policy (`app.account_id`) plus the `app_system` policy, and every repository method filters on both columns explicitly (Ruling R4 from 1a).
- The model never executes a write. A `write` route tool only creates a proposal. The proposal executes on `POST /assistant/proposals/{id}/approve` with the approving owner's own bearer token.
- Routes marked `assistant.use = 'never'` are never tools: auth, sessions, billing payment, member and role changes, channel OAuth, secrets and credentials, account deletion, and the assistant's own routes.
- Memory limits: `owner_profile` 1 400 chars, `notes` 2 200 chars, `business:<uuid>` 1 000 chars. Every memory write runs the safety scan.
- Each tool result the model sees is ≤ 8 000 chars, and tool output per turn is ≤ 40 000 chars.
- The turn stays synchronous with a 90 s budget, as in 1a. Streaming is not part of 1b (Ruling 1b-R1).
- Logs carry only ids, tool names and error classes. Never log or store a bearer token, prompt text, memory text or tool arguments.
- New migration number: `0057`, additive only.
- `pnpm check` must pass at the end of every task. Never skip or delete a test.
- Commit messages: Conventional Commits, scope `assistant` (or `ai-core`, `contracts`, `db`, `web`), ending with `(T-170)`, then a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Rulings taken while planning

- **1b-R1:** No streaming in 1b. The synchronous 90 s turn and polling from 1a stay. Moving the turn to a worker needs a delegated-session design, and that is a separate slice. Cost if wrong: the docs/16 exception lives longer.
- **1b-R2:** Route tools use the caller's own `Authorization` header, passed from the controller to the facade in memory only. That is the "delegated owner session" for a synchronous turn. Cost if wrong: an async turn later needs a minted short-lived token.
- **1b-R3:** Platform skills live in `packages/ai-core/assistant-skills/<name>/SKILL.md` next to `prompts/`, exported as `ASSISTANT_SKILLS_DIR`, because backend `tsc` does not copy `.md` files. The spec named the module folder. Cost if wrong: moving the folder.
- **1b-R4:** Owner, learned and shadow skills (the `assistant_skills` table) move to 1c with the review loop. 1b ships platform skills only. Cost if wrong: owners cannot save their own procedure until 1c.
- **1b-R5:** Context window for the compaction trigger is a constant, `ASSISTANT_CONTEXT_TOKENS = 128_000`, with 16 000 reserved for output. Compaction also triggers above 80 active messages. The 1a cap of 40 messages becomes a safety cap of 200. Cost if wrong: compaction fires early or late on models with other windows.
- **1b-R6:** Memory written during a thread joins the frozen system prompt only on the next compaction or in a new thread, as Hermes does. The `memory` tool result tells the model the entry is saved. Cost if wrong: none for correctness.

---

### Task 1: Pure agent pieces in ai-core (safety, skills, compaction)

**Files:**
- Create: `packages/ai-core/src/agent/safety.ts`, `packages/ai-core/src/agent/skills.ts`, `packages/ai-core/src/agent/compaction.ts`, with tests `*.test.ts` alongside
- Modify: `packages/ai-core/src/agent/index.ts` (export them), `packages/ai-core/src/index.ts` if the agent index is re-exported there
- Create: `packages/ai-core/assistant-skills/` with `ASSISTANT_SKILLS_DIR` exported from `packages/ai-core/src/agent/skills.ts`, resolved like `PROMPTS_DIR` in `src/prompts.ts`. Make sure the package `files`/build keeps the folder, as it does for `prompts/`.

**Interfaces (produced):**

```ts
// safety.ts
export type SafetyIssue = 'injection' | 'role_override' | 'invisible_unicode' | 'url' | 'phone' | 'email' | 'secret';
export interface SafetyResult { ok: boolean; issues: SafetyIssue[] }
export function scanUntrustedText(text: string): SafetyResult;
```

- `injection`: phrases such as "ignore (all|previous|above) instructions", "bỏ qua (mọi|các) hướng dẫn", "system prompt", "you are now", "developer mode". Match case-insensitively and on the unaccented form of Vietnamese text.
- `role_override`: lines that start with `system:`, `assistant:` or `<system`.
- `invisible_unicode`: U+200B–U+200F, U+202A–U+202E, U+2060–U+2064, U+FEFF.
- `url`: `https?://` or `www.`.
- `phone`: Vietnamese mobile numbers (`(\+84|0)(3|5|7|8|9)\d{8}`, also when written with spaces or dots).
- `email`.
- `secret`: `sk-[A-Za-z0-9]{16,}`, `Bearer\s+\S{16,}`, or a run of 32+ characters of hex/base64.
- `ok` is true exactly when `issues` is empty.

```ts
// skills.ts
export interface SkillDoc { name: string; description: string; toolsets: string[]; version: number; body: string }
export function parseSkill(source: string): SkillDoc;
export function lintSkill(doc: SkillDoc): string[];
export function renderSkillIndex(skills: Pick<SkillDoc, 'name' | 'description'>[]): string;
export async function loadSkillDir(dir: string): Promise<SkillDoc[]>;
export const ASSISTANT_SKILLS_DIR: string;
```

- `parseSkill` takes `---` front matter with `name`, `description`, `toolsets` (YAML inline list `[a, b]` or empty) and `version` (integer), then the body. It throws `Error('invalid_skill: <reason>')` on missing front matter or fields. Parse the front matter by hand with a minimal `key: value` parser; no new dependency.
- `lintSkill` returns a list of problems, empty when the skill is clean:
  - `name` must match `^[a-z0-9][a-z0-9-]*$` and be ≤ 64 chars;
  - `description` 1–120 chars;
  - body ≤ 8 000 chars;
  - the safety scan finds no issues, except that `url` is allowed for `/app/...` paths only, so strip those before scanning.
- `renderSkillIndex` returns lines `- <name>: <description>`, sorted by name. It is byte-stable.
- `loadSkillDir` reads `<dir>/<name>/SKILL.md` for every subfolder, sorted by folder name. It throws if a skill fails lint or its `name` ≠ folder name.

```ts
// compaction.ts
export interface CompactionMessage { id: string; role: 'user' | 'assistant' | 'tool' | 'event'; content: string; isSummary: boolean; toolCalls?: unknown }
export interface CompactionPlan { pruneToolIds: string[]; summarizeIds: string[]; keepHeadIds: string[]; keepTailIds: string[]; previousSummary: string | null }
export function shouldCompact(i: { lastInputTokens: number; activeMessages: number; contextTokens: number; maxOutputTokens: number }): boolean;
export function planCompaction(messages: CompactionMessage[], opts?: { headKeep?: number; tailMinMessages?: number }): CompactionPlan | null;
export function buildCompactionPrompt(previousSummary: string | null, transcript: CompactionMessage[]): { system: string; user: string };
export const COMPACTION_SUMMARY_PREFIX: string;
export const PRUNED_TOOL_TEXT = '[tool output cleared — use session_search]';
```

- `shouldCompact` is true when `lastInputTokens ≥ 0.75 × (contextTokens − maxOutputTokens)` or `activeMessages > 80`.
- `planCompaction` works over the active messages in order.
  - It keeps the first 3 non-summary messages as the head (default `headKeep = 3`).
  - It keeps a tail of at least 20 messages (default `tailMinMessages = 20`). The tail must start at a `user` or `event` message, so a tool call is never split from its results, and it must contain at least one user message.
  - An existing summary message is folded into the middle: its text becomes `previousSummary` and its id goes into `summarizeIds`.
  - The middle is everything between head and tail. Return `null` if it has fewer than 6 messages.
  - `pruneToolIds` lists the `tool` messages in the middle with content longer than 200 chars.
- `buildCompactionPrompt` asks for these sections, in English headings:
  - `Goal`
  - `Owner preferences and constraints`
  - `Completed actions` (lines `N. ACTION target — outcome [tool]`)
  - `Pending proposals`
  - `Key decisions`
  - `Figures already given (with source tool)`
  - `Open questions`

  The summary is written in the owner's language. If `previousSummary` is given, the prompt asks the model to update it, not restart. Tool messages in the transcript are cut to 500 chars.
- `COMPACTION_SUMMARY_PREFIX` = `'REFERENCE ONLY — summary of earlier conversation. The owner\'s latest message wins.\n\n'`.

- [ ] Step 1: Write failing tests:
  - safety: each issue kind, with Vietnamese injection text with and without accents; a clean Vietnamese sentence is ok;
  - skills: parse ok, missing field throws, lint catches a bad name / long body / phone number, the index is sorted and stable, `loadSkillDir` on a temp dir;
  - compaction: the trigger maths, null for short threads, the tail starts at a user message, a summary is folded, tool pruning.
- [ ] Step 2: Run `pnpm --filter @agent-sales/ai-core test` and see them fail.
- [ ] Step 3: Implement.
- [ ] Step 4: Run the tests, then `pnpm --filter @agent-sales/ai-core build typecheck lint`. All must pass.
- [ ] Step 5: Commit `feat(ai-core): add the safety scanner, skill parser and compaction planner for the assistant (T-170)`.

### Task 2: Contracts — the `assistant` field on every route, plus the 1b assistant DTOs

**Files:**
- Modify: `packages/contracts/src/common/routes.ts`. Add:

  ```ts
  export interface RouteAssistantUse { use: 'read' | 'write' | 'never'; when?: string }
  // on RouteContract:
  assistant?: RouteAssistantUse;
  ```

  `when` (≤ 160 chars, English) says when the assistant should use the route; it is needed for `read`/`write`. Also export `routeKey(r) => \`${r.method.toUpperCase()} ${r.path}\``.
- Modify: every `packages/contracts/src/**/*.routes.ts`. Add `assistant` to **every route with `workspaceScoped: true`**:
  - `read`: GET routes that return business data useful to the owner, such as lists and details of products, orders, contacts, bots, conversations, analytics, integrations status and settings.
  - `write`: POST/PATCH/PUT/DELETE routes that change business data an owner would plausibly ask for: create/update a product, an order or its status, a contact, bot instructions/knowledge/FAQ, settings, etc.
  - `never`: auth, sessions, billing payment, member/role/invite changes, channel connect/OAuth/disconnect, anything that stores secrets, API keys or credentials (bot API action secrets, integration credentials), account/business deletion, file upload endpoints (multipart), webhook management, and every `/assistant/...` route.
  - When unsure between `write` and `never`, choose `never`.
  - Routes that are not workspace-scoped may stay without the field.
- Create: `packages/contracts/src/common/routes.assistant.test.ts`. It imports `allRoutes` and checks:
  1. every `workspaceScoped` route has `assistant`;
  2. every `read`/`write` route has a non-empty `when`;
  3. every `read` route is a GET;
  4. no `/assistant` route and no `/auth` route is `read` or `write`.
- Modify: `packages/contracts/src/assistant/assistant.schema.ts`:
  - `AssistantPageContext` gains `forms: z.array(AssistantPageForm).max(5).optional()` where:

    ```ts
    AssistantPageForm = z.object({
      id: z.string().max(60),
      fields: z.array(z.object({
        name: z.string().max(60),
        label: z.string().max(120),
        type: z.enum(['text', 'textarea', 'number', 'select']),
        options: z.array(z.string().max(80)).max(30).optional(),
        empty: z.boolean(),
      })).max(30),
    })
    ```

  - `AssistantUiAction` gains the variant `{ type: 'fill_form', formId: string ≤ 60, values: z.record(z.string().max(60), z.union([z.string().max(4000), z.number()])) }`.
  - New DTOs:
    - `AssistantProposalDto`: `{ id, threadId, businessId, routeKey, summary, preview: unknown, status: 'pending'|'executing'|'done'|'failed'|'rejected'|'expired', errorCode: string|null, createdAt, expiresAt, decidedAt: string|null }`.
    - `AssistantProposalList`: `{ items }`.
    - `AssistantMemoryDto`: `{ stores: { store: string, label: string, limit: number, used: number, entries: { id, text, createdAt }[] }[] }`.
- Modify: `packages/contracts/src/assistant/assistant.routes.ts`. Add these routes, all with `auth: true`, `workspaceScoped: true` and `assistant: { use: 'never' }` (also set `never` on the six 1a routes):
  - `GET /assistant/threads/{threadId}/proposals` → `AssistantProposalList`
  - `POST /assistant/proposals/{proposalId}/approve` → 200 `AssistantProposalDto`
  - `POST /assistant/proposals/{proposalId}/reject` → 200 `AssistantProposalDto`
  - `GET /assistant/memory` → `AssistantMemoryDto`
  - `DELETE /assistant/memory/{store}/entries/{entryId}` → 204
- Do **not** add backend handlers in this task. The backend's contract-vs-served test (`apps/backend/test/...`; find it by grepping for `allRoutes`) will fail for the five new routes. Ruling R5 from 1a requires that test to stay green at every commit, so put the five new route declarations in Task 4/5 instead. Task 2 only adds the schemas, the `assistant` field and annotations, and the `forms`/`fill_form` additions.
- [ ] Steps:
  - write the arch test (fails);
  - annotate all routes;
  - add the schemas plus unit tests for `AssistantPageForm` and the `fill_form` action;
  - run `pnpm --filter @agent-sales/contracts test build`, then `pnpm typecheck`;
  - commit `feat(contracts): declare assistant use on every workspace route and add the 1b assistant schemas (T-170)`.

### Task 3: Database — migration 0057, schema and repository methods

**Files:**
- Create: `packages/db/migrations/0057_assistant_1b.sql`
- Modify: `packages/db/src/schema/assistant.ts`, `apps/backend/src/modules/assistant/domain/ports/assistant.repository.ts`, both repository implementations (Drizzle and in-memory), and `packages/db/src/account.integration.test.ts` (or a new `assistant-1b.integration.test.ts` next to it)

The migration does three things. Use the same RLS loop pattern as 0056 for the two new tables.

1. Create `assistant_memory`:

   ```
   account_id uuid NOT NULL REFERENCES accounts(id)
   owner_user_id uuid NOT NULL REFERENCES users(id)
   store text NOT NULL CHECK (store ~ '^(owner_profile|notes|business:[0-9a-f-]{36})$')
   entries jsonb NOT NULL DEFAULT '[]'
   updated_at timestamptz NOT NULL DEFAULT now()
   PRIMARY KEY (account_id, owner_user_id, store)
   ```

2. Create `assistant_proposals`:

   ```
   id uuid PK
   account_id uuid NOT NULL
   owner_user_id uuid NOT NULL
   thread_id uuid NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE
   run_id uuid
   business_id uuid NOT NULL REFERENCES workspaces(id)
   route_key text NOT NULL
   path text NOT NULL            -- concrete path with params filled, relative to /api/v1
   query jsonb
   body jsonb
   summary text NOT NULL CHECK (char_length(summary) <= 300)
   preview jsonb
   status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','executing','done','failed','rejected','expired'))
   error_code text
   result_preview text
   expires_at timestamptz NOT NULL
   decided_at timestamptz
   created_at timestamptz NOT NULL DEFAULT now()
   ```

   Index `(account_id, owner_user_id, thread_id, created_at)`.

3. Add to `assistant_threads`:
   - `cache_root_id uuid` (nullable);
   - `compacted_at timestamptz`;
   - `compaction_failed_at timestamptz`;
   - `compaction_saved_pcts real[] NOT NULL DEFAULT '{}'` (last two savings, for anti-thrash).

**Repository additions (port and both implementations):**

- **Memory:**
  - `getMemory(scope): Promise<MemoryStoreRecord[]>`
  - `saveMemoryStore(scope, store, entries)`: upsert.
  - `MemoryStoreRecord = { store: string; entries: { id: string; text: string; origin: 'assistant' | 'owner'; createdAt: string }[]; updatedAt: Date }`.
- **Proposals:**
  - `createProposal(scope, p)`
  - `listProposals(scope, threadId)`
  - `getProposal(scope, id)`
  - `transitionProposal(scope, id, from: ProposalStatus[], to: ProposalStatus, patch?: { errorCode?, resultPreview?, decidedAt? }): Promise<ProposalRecord | null>`: a conditional UPDATE … WHERE status = ANY(from), returning null if no row changed. This is the atomic approve guard.
  - `expireProposals(scope, now)`: pending with `expires_at < now` become `expired`.
- **Compaction:**
  - `applyCompaction(scope, threadId, { deactivateIds, prunedToolIds, summary: NewMessage, savedPct, systemPrompt })`. In one transaction:
    - set `active=false, compacted=true` on `deactivateIds`;
    - set `content = PRUNED_TOOL_TEXT` on `prunedToolIds` that stay active;
    - insert the summary row with `is_summary=true`, `seq = max(seq)+1` and `sort_seq = (min seq of the deactivated middle) - 0.5`. The migration adds `assistant_messages.sort_seq numeric NOT NULL`, backfilled from `seq`, with an index on `(thread_id, sort_seq)`; active history is ordered by `sort_seq`, and new messages get `sort_seq = seq`;
    - update the thread's `system_prompt`, `compacted_at` and `compaction_saved_pcts` (keep the last two).
  - `markCompactionFailed(scope, threadId, at)`.
- Every method takes the `OwnerScope` (account + owner), runs in `withAccount`, filters both columns, and checks the thread belongs to the scope before any write (R4).

- [ ] Steps:
  - Write integration tests for memory upsert isolation (two accounts), the proposal conditional transition (two concurrent approves → exactly one wins), and compaction ordering (the summary sorts before the tail).
  - Write in-memory repository unit tests mirroring them.
  - Implement.
  - Run `pnpm --filter @agent-sales/db test` with the integration env the 1a tests used (see `packages/db/package.json` scripts and the 1a ledger notes in the PR body), then `pnpm --filter @agent-sales/backend test -- assistant`.
  - Commit `feat(db): add assistant memory, proposals and compaction columns (T-170)`.

### Task 4: Backend — memory tool, platform skills, prompt v2, memory routes

**Files:**
- Create: `packages/ai-core/prompts/assistant@2.md`. It is a copy of `@1` with these changes:
  - The "You cannot change any data yet" rule is replaced by: "You change data only through proposals. A write tool call creates a proposal the owner approves in the chat. Never say a change is done until a later event message says the proposal was applied."
  - A `Skills` section: "Before guiding the owner through a task listed below, call load_skill with its name.\n{{skills.index}}".
  - A `Memory` section: `{{memory.block}}`, which is empty text when there is no memory.
  - Tool guidance for `memory`, `tool_search`, `tool_describe`, `tool_call` and `ui_fill_form` (one line each).
  - The prompt version used by the turn service becomes 2.
- Create: platform skills `packages/ai-core/assistant-skills/{add-products,set-up-bot,connect-channels,handle-orders,read-revenue}/SKILL.md`.
  - Each has front matter plus a concise English procedure that names dashboard paths from the map and the controls the owner should use.
  - `toolsets` lists `ui`, `routes` or both.
  - Use only facts from the dashboard map and the routes you can see in `packages/contracts`. Do not invent features.
- Create: `apps/backend/src/modules/assistant/application/memory-tools.ts`. It holds the `memory` tool:

  ```ts
  input: z.object({
    action: z.enum(['add', 'replace', 'remove']),
    store: z.string(),
    text: z.string().max(1000).optional(),
    match: z.string().max(200).optional(),
  })
  ```

  - `store` is `owner_profile` | `notes` | `business:<uuid>`, where the uuid must be one of `scope.businessIds`; otherwise the tool returns `{ ok: false, errorCode: 'unknown_store' }`.
  - `add` needs `text`. `replace` needs `match` (a unique substring of one entry) and `text`. `remove` needs `match`.
  - Reject on: an exact duplicate (`duplicate`), the safety scan (`unsafe:<issues>`), the store limit, and a non-unique or missing match (`match_not_unique` / `match_not_found`).
  - When the store is full, return the entries plus "consolidate: replace or remove entries first".
  - After 3 failed memory calls in one turn, return `{ ok: false, errorCode: 'stop_retrying' }`.
  - The result is a short confirmation with `used/limit`.
- Create: `apps/backend/src/modules/assistant/application/skill-tools.ts`:
  - `skills_list`: no input; returns the name and description of each skill.
  - `load_skill`: `{ name }`; returns the body, or `{ ok: false, errorCode: 'unknown_skill' }`.
  - Load the skills once at module init through `loadSkillDir(ASSISTANT_SKILLS_DIR)` behind a small `SkillCatalog` provider.
- Modify: `prompt-builder.ts`.
  - `buildSystemPrompt(template, snap, today, extras: { skillsIndex: string; memory: MemoryStoreRecord[] })`.
  - The memory block renders each non-empty store as a header with its usage, e.g. `owner_profile [67% — 940/1400]`, followed by `- <text>` lines.
  - Entries that fail the safety scan at render time are skipped.
  - Store order: owner_profile, notes, then business stores sorted by id.
  - The output stays byte-stable for the same inputs.
- Modify: the chat turn and thread creation to use prompt `assistant@2`, register the memory and skill tools, and build the system prompt with the skills index and memory.
- Modify: the facade, controller and contracts.
  - Add `GET /assistant/memory` and `DELETE /assistant/memory/{store}/entries/{entryId}` (declared in contracts in this task, with `assistant: { use: 'never' }`), served through the facade with the owner check.
  - The labels in `AssistantMemoryDto` are English keys (`owner_profile`, `notes`, or the business name for `business:<id>`). The web translates them.
- Tests:
  - the memory tool unit (each error code, limits, the business store check, stop_retrying);
  - prompt byte-stability with memory and skills;
  - a facade test for the memory routes (owner ok, staff 403);
  - the platform skills load and pass lint (a test that calls `loadSkillDir` on the real folder).
- Commit `feat(assistant): add memory, platform skills and prompt v2 to the owner assistant (T-170)`.

### Task 5: Backend — route tools and proposals

**Files:**
- Create: `apps/backend/src/modules/assistant/application/route-catalog.ts`. It is built from `allRoutes` filtered to `assistant.use ∈ {read, write}` and keyed by `routeKey`. Each entry is `{ key, use, summary, when, method, path, pathParams: string[], query?: ZodObject, body?: ZodType }`.
  - `searchCatalog(query, pageRoute?)` scores entries by token overlap of the unaccented, lowercased query against key, summary and `when`. It boosts entries whose path's first segment matches the current page route's first segment after `/app/`. It returns the top 8.
- Create: `apps/backend/src/modules/assistant/domain/ports/route-invoker.port.ts`:

  ```ts
  export interface RouteInvocation { method: string; path: string; query?: Record<string, unknown>; body?: unknown; businessId: string; authorization: string; idempotencyKey?: string }
  export interface RouteInvocationResult { status: number; body: unknown }
  export interface RouteInvoker { invoke(i: RouteInvocation): Promise<RouteInvocationResult> }
  export const ROUTE_INVOKER = Symbol('ROUTE_INVOKER');
  ```

- Create: `apps/backend/src/modules/assistant/infrastructure/http/fastify-route-invoker.ts`.
  - It uses Nest `HttpAdapterHost` to get the Fastify instance and calls `inject` with `method`, `url: '/api/v1' + path + querystring` and headers `{ authorization, 'x-workspace-id': businessId, 'x-actor': 'assistant', 'idempotency-key'? }`. JSON payload.
  - It parses the JSON body.
  - It never logs headers.
- Create: `apps/backend/src/modules/assistant/application/route-tools.ts`, with three tools.
  - **`tool_search({ query })`** returns `[{ key, use, summary, when }]`.
  - **`tool_describe({ key })`** returns `{ key, use, pathParams, query: JSONSchema?, body: JSONSchema? }`, built with `z.toJSONSchema(..., { io: 'input', unrepresentable: 'any' })` and cut to 8 000 chars.
  - **`tool_call({ key, businessId?, params?: Record<string,string>, query?: Record<string,unknown>, body?: unknown, summary?: string })`**:
    - `businessId` defaults to the page context business, else the only business; it must be in `scope.businessIds`, otherwise `unknown_business`. Each path param must be in `params` and match `^[A-Za-z0-9_-]{1,64}$`, otherwise `bad_params`.
    - Validate `query` and `body` with the route's Zod schemas, returning `invalid_input` plus the first 5 issues.
    - **read:** invoke, then return `{ status, body }` as JSON, capped at 8 000 chars with `…[truncated]`. Count it toward a per-turn 40 000-char budget; when the budget is spent, return `turn_budget_exhausted`. HTTP ≥ 400 → `{ ok: false, errorCode: 'http_<status>' }`. A 403 adds the message "Tài khoản của anh/chị không có quyền này".
    - **write:** requires `summary` (≤ 300 chars, Vietnamese, what will change), otherwise `summary_required`. Create a proposal with `expiresAt = now + 24h`. The `preview` is `{ body, query }` plus, for PATCH/PUT/DELETE where a GET exists on the same path, the current state from a read invoke (`before`). Add the proposal id to a turn-level list. Return `{ status: 'awaiting_owner_approval', proposalId }`.
  - Tools that don't change anything (reads, search, describe, memory, skills) may run in parallel if the loop supports it; writes run in order. Do not change the loop for this.
- Modify: the chat turn. Pass `authorization` (from the controller: `@Headers('authorization')`, held in memory only) and the page context into the tool context. Register the three route tools.
  - The send-message response is unchanged.
  - The assistant message created at the end of a turn that made proposals gets no special field. The web fetches proposals per thread.
- Modify: the facade, controller and contracts. Add the three proposal routes (declared in contracts in this task, with `assistant: { use: 'never' }`).
  - **list:** first expire stale pending proposals, then list.
  - **approve:** owner check, then `transitionProposal(pending → executing)`. Null → 409 `proposal_not_pending`. If expired, transition to `expired` and answer 409 `proposal_expired`.
    - Invoke with the **approver's** authorization and `idempotencyKey = 'asst:' + id`.
    - 2xx → `done` with `resultPreview` (≤ 1 000 chars); otherwise `failed` with `error_code = 'http_<status>'`.
    - Append an `event` message to the thread (Vietnamese, e.g. `Đã áp dụng: <summary>` or `Không áp dụng được: <summary> (<code>)`), so the next turn sees it.
    - Return the DTO.
  - **reject:** pending → `rejected`, plus an event message `Anh/chị đã bỏ: <summary>`.
  - The business of a proposal must still be in the approver's scope; otherwise 404.
- Tests:
  - unit tests: catalog search ranking; `tool_call` validation errors; the write path creates a proposal and never invokes; read truncation and turn budget; a `never` route is absent from the catalog (pick one, e.g. a members route).
  - integration test in `apps/backend/test/assistant.integration.spec.ts`:
    - the owner's turn (fake LLM gateway, as 1a's test does) calls `tool_call` on a read route, e.g. `GET /products`, which goes through real auth and returns data;
    - a write route makes a pending proposal; approve executes it and the product exists; a second approve → 409;
    - reject → rejected;
    - staff → 403 on the proposal routes.
- Commit `feat(assistant): route-derived tools with owner-approved proposals (T-170)`.

### Task 6: Backend — auto-compaction and `ui_fill_form`

**Files:**
- Create: `apps/backend/src/modules/assistant/application/compaction.service.ts`.
  - `maybeCompact(scope, thread, lastRun)`: reads the active messages ordered by `sort_seq` and calls `shouldCompact` with the last chat run's `input_tokens + cached_tokens`, `ASSISTANT_CONTEXT_TOKENS = 128_000` and `ASSISTANT_MAX_OUTPUT_TOKENS = 16_000`.
  - Skip it when the last two `compaction_saved_pcts` are both < 10, or when `compaction_failed_at` is within 10 minutes.
  - Then `planCompaction`, then one LLM call on tier `basic` with `buildCompactionPrompt`, recorded as `assistant_runs.kind = 'compaction'` and keyed with the same `promptCacheKey` family `asst:<owner>:<cache_root_id ?? thread.id>`.
  - The summary content is `COMPACTION_SUMMARY_PREFIX + text`, plus a re-injected list of pending proposals (summary, id) for the thread.
  - Rebuild the system prompt with fresh memory (`buildSystemPrompt`).
  - `savedPct` = 1 − (chars after / chars before) over the active messages.
  - `applyCompaction(...)`; on failure, `markCompactionFailed` and keep the history.
- Modify: the chat turn.
  - Call `maybeCompact` before building the history for the model; errors never fail the turn.
  - The history becomes all active messages by `sort_seq`, with a safety cap of the last 200 (starting at a user/event/summary message, as before).
  - `HISTORY_MAX_MESSAGES` becomes 200.
  - Set `cache_root_id` on first compaction, and keep the key stable: the key stays `asst:<owner>:<cache_root_id ?? threadId>`.
- Modify: `core-tools.ts`. Add `ui_fill_form({ formId, values })`.
  - `formId` must be one of `page.forms[].id` (otherwise `unknown_form`).
  - Each key must be a declared field (otherwise `unknown_field:<name>`).
  - A `select` value must be one of its `options`.
  - Strings are ≤ 4 000 chars.
  - It pushes a `fill_form` UI action.
  - The result says "filled as a draft; the owner reviews and saves it themselves".
  - Update the UI-action cap rule: keep the last navigate, the last spotlight and the last fill_form, in order navigate, fill_form, spotlight. Keep "no UI actions unless answered".
- Tests:
  - compaction service with the in-memory repo and a fake gateway: it triggers on message count, the summary row is inserted before the tail, the thread prompt is rebuilt, anti-thrash skips, a failure sets the cooldown and the turn still answers;
  - `ui_fill_form` validation;
  - the UI action cap.
- Commit `feat(assistant): auto-compaction and form autofill drafts (T-170)`.

### Task 7: Web — proposals, memory, form fill, page context in lib

**Files:**
- Move: `apps/web/src/features/assistant/hooks/use-assistant-context.ts` and its test → `apps/web/src/lib/assistant-context.ts`. Update the imports.
  - Add `useAssistantForm(formId, fields, onFill)`: a page registers a form and a fill callback in a small module-level registry (zustand or a Map with a subscribe).
  - The registered forms appear in the page context's `forms`, where `empty` is computed by the page from its current values. The hook takes a getter.
- Modify: the products create page (`apps/web/src/routes/app/products/new.tsx` and the form component it renders). Register form `product` with its main fields (name, price, description, SKU/category if present). The fill callback sets the values through the form library the page uses (react-hook-form `setValue` with `shouldDirty: true`, or the page's state setters). It never submits.
- Modify: the assistant panel's action handler.
  - A `fill_form` action calls the registered callback.
  - If the form is not on screen, show a toast `assistant.fill.notOnPage`.
  - After filling, spotlight the form's submit button if it has a `data-assistant-target`. Add `data-assistant-target="products.save"` to the save button.
- Create: `apps/web/src/features/assistant/components/assistant-proposals.tsx`.
  - It reads `GET /assistant/threads/{id}/proposals` (TanStack Query, refetched after each turn and after approve/reject).
  - Pending proposals render as cards under the last message: summary, business name, a collapsible JSON preview, and buttons "Áp dụng" / "Bỏ". Pressing "Áp dụng" calls approve and disables both buttons while it runs.
  - Decided proposals show a status line (done, failed + code, rejected, expired).
  - After approve/reject, refetch the messages so the event message shows.
- Create: `apps/web/src/features/assistant/components/assistant-memory.tsx`. A "Trợ lý nhớ gì" view (a tab or a menu item in the panel header) lists the stores with usage bars and lets the owner delete an entry (with a confirm).
- Modify: `packages/i18n` assistant namespace (vi and en if both exist; follow what 1a did) for all new strings.
- Tests (Vitest + Testing Library, as 1a):
  - the proposal card approve flow (mocked API);
  - the memory delete flow;
  - the fill registry (the page registers, the action fills, an unregistered form shows the toast);
  - the context includes forms.
- Run `pnpm --filter @agent-sales/web test typecheck lint build`.
- Commit `feat(web): proposal cards, memory view and form autofill in the assistant bubble (T-170)`.

### Task 8: Docs and the spec record

**Files:**
- Modify:
  - spec: add §19 "Adjustments made while building 1b" with the rulings 1b-R1…R6 and anything the tasks changed;
  - the capability table: mark 1b shipped;
  - `docs/adr/ADR-023-owner-assistant.md`: a consequences line for 1b;
  - `apps/backend/src/modules/assistant/MODULE.md`: tools, tables, routes;
  - `docs/05` (data model: the new tables and columns);
  - `docs/06` (API: the new routes);
  - `docs/04` §5 (route tools via in-process inject, proposals);
  - `docs/ARCHITECTURE.md` if it lists module dependencies (the assistant now depends on Nest `HttpAdapterHost`, not on other modules' internals);
  - `docs/16`: keep the synchronous-turn exception and add that route tool reads run inside the same 90 s budget.
- Also document in `docs/11` or the contracts README how a new route must declare `assistant`.
- Commit `docs(assistant): record the 1b slice (T-170)`.
