# Owner assistant 1c: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the assistant get better with use: owner, learned and shadow skills with a ledger and undo, a background review that writes memory and skills after conversations, a deterministic curator, proactive suggestions, 👍/👎 feedback, and owner settings (review on/off, toolsets).

**Architecture:**
- **Skills:** owner, learned and shadow skills are rows in `assistant_skills`. Platform skills stay files. The skill catalog merges both kinds per owner.
- **Ledger:** every skill change appends to `assistant_skill_events` with before/after, so any single change can be undone.
- **Background work:** the review and the curator run in the **worker** process as Postgres-leased jobs (`assistant_jobs`), with the same tick and lease pattern as `modules/integration/application/sync-runner.ts`. They do not use BullMQ.
- **Review tools:** the review reuses the chat turn's system prompt and the memory and skill tools, with actor `review`.

**Tech Stack:** NestJS 12, Drizzle + PostgreSQL 16 (RLS through `withAccount`, `app_system` for the worker), Zod 4, Vitest, React 19 + TanStack Query, i18next.

**Spec:** `docs/superpowers/specs/2026-11-02-owner-assistant-core-design.md` §4, §10, §11, §13, §14, §19. ADR: `docs/adr/ADR-023-owner-assistant.md`.

## Global Constraints

- Everything from the 1b plan's Global Constraints still applies:
  - owners only;
  - every table has `account_id` and `owner_user_id`, the account RLS policy and the `app_system` policy;
  - every repository method filters on both columns;
  - no prompt, memory or skill text in logs;
  - `pnpm check` must pass;
  - commit messages end with `(T-170)` and the Co-Authored-By line.
- New migration number: `0058` (main owns 0055; the assistant has 0056 and 0057). Additive only.
- Approval gates (spec §1, constraint 5):
  - memory written by the review is saved automatically and can be undone;
  - a **new learned skill needs one owner tap** (`pending_approval`);
  - review patches to learned skills apply automatically, with a ledger entry and undo;
  - platform skills are immutable (the owner edits a shadow copy);
  - owner skills are active at once.
- Every skill write runs `lintSkill` (Task 1 of 1b) and the safety scan. Skills are instructions only and can never add tools or widen permissions.
- The review never writes to the thread transcript. Its run is `assistant_runs.kind = 'review'`.
- Limits:
  - review budget: 8 rounds, 200 000 input tokens;
  - at most 5 pending suggestions per owner, and a dismissal is permanent per `dedup_key`;
  - at most 50 active owner/learned skills per owner.

## Rulings taken while planning

- **1c-R1:** Postgres-leased jobs (`assistant_jobs`) in the worker, not BullMQ. This matches the integration runner and needs no new infrastructure. Cost if wrong: a later move to BullMQ.
- **1c-R2:** The "💡 Trợ lý vừa học" notice is built from a `GET /assistant/learning` feed: skill ledger rows by `review`, plus memory entries with `origin = 'review'`, from the last 7 days. It is not a thread message. Cost if wrong: an extra endpoint.
- **1c-R3:** In 1c a suggestion is only a stored card (`kind` `skill` | `setup` | `schedule`). Accepting a `schedule` suggestion only marks it accepted, until schedules exist (capability 3). Cost if wrong: none.
- **1c-R4:** The curator runs from the worker tick at most once per day per owner, not weekly. Its thresholds are 30/90 days as in the spec. A daily scan is cheap and simpler to test. Cost if wrong: none.
- **1c-R5:** LLM skill consolidation stays out of scope, as the spec says.

---

### Task 1: Migration 0058 and repositories

**Files:**
- Create: `packages/db/migrations/0058_assistant_1c.sql`
- Modify: `packages/db/src/schema/assistant.ts`, the repository port and both implementations (Drizzle and in-memory)
- Add integration tests next to the 1b ones.

**Tables:**
- `assistant_skills`:
  - `id`, `account_id`, `owner_user_id`;
  - `name` (`^[a-z0-9][a-z0-9-]*$` ≤ 64), `description` ≤ 120, `body` ≤ 8 000, `toolsets text[]`;
  - `provenance` (`owner` | `learned` | `shadow`), `shadow_of` (a platform skill name, NULL unless shadow);
  - `state` (`pending_approval` | `active` | `stale` | `archived`), `pinned` bool;
  - counters `use_count`, `view_count`, `patch_count`, `last_used_at`, `last_patched_at`, `created_at`, `updated_at`.
  - Unique `(account_id, owner_user_id, name)` where `state <> 'archived'`.
- `assistant_skill_events`:
  - `id`, `account_id`, `owner_user_id`, `skill_id`;
  - `actor` (`owner` | `assistant` | `review` | `curator`);
  - `action` (`create` | `patch` | `archive` | `restore` | `approve` | `reject` | `undo`);
  - `before jsonb`, `after jsonb` (snapshots of name, description, body, state);
  - `run_id`, `undone_at`, `created_at`.
- `assistant_suggestions`:
  - `id`, `account_id`, `owner_user_id`;
  - `kind` (`schedule` | `skill` | `setup`), `dedup_key` ≤ 120, `title` ≤ 200, `payload jsonb`;
  - `status` (`pending` | `accepted` | `dismissed`), `created_at`, `decided_at`.
  - Unique `(account_id, owner_user_id, dedup_key)`.
- `assistant_settings`:
  - `(account_id, owner_user_id)` PK, `review_enabled bool default true`, `disabled_toolsets text[] default '{}'`, `updated_at`.
- `assistant_jobs`:
  - `id`, `account_id`, `owner_user_id`, `thread_id` (nullable);
  - `kind` (`review` | `curator`), `review_scope` (`memory` | `skills` | `combined`, nullable);
  - `status` (`queued` | `running` | `done` | `failed` | `cancelled`), `run_after`, `lease_until`, `attempts`, `error_code`, `created_at`, `finished_at`.
  - Index `(status, run_after)`.
- `assistant_messages` add `feedback smallint` (−1 or 1, NULL means none).
- `assistant_threads` add `review_owner_turns int default 0`, `review_tool_rounds int default 0`, `last_review_at timestamptz`.
- RLS loop as in 0056/0057 for the five new tables.

**Repository methods:**
- Every method takes an `OwnerScope`.
- Worker variants take an explicit `{ accountId, ownerUserId }` and use `withAccount` with that account, so RLS still applies.
- Skills: `listSkills`, `getSkill`, `getSkillByName`, `createSkill`, `updateSkill` (with optimistic `updated_at`), `appendSkillEvent`, `listSkillEvents(skillId | since)`, `markSkillEventUndone`.
- Suggestions: `listSuggestions`, `upsertSuggestion` (it ignores a `dedup_key` that already exists in any status), `decideSuggestion`.
- Settings: `getSettings` (defaults when there is no row), `saveSettings`.
- Feedback: `setFeedback(messageId, value)`. The message must be an assistant message in the owner's thread.
- Review counters: `bumpReviewCounters(threadId, { ownerTurns, toolRounds })`, `resetReviewCounters(threadId)`.
- Jobs:
  - `enqueueJob`: at most one `queued` job per thread and kind; if one exists, update its `run_after` and `review_scope`;
  - `claimJobs(now, limit, leaseMs)`: `FOR UPDATE SKIP LOCKED`, runs as `app_system` across accounts, returns the owner and account;
  - `finishJob`, `cancelJob`.
- Curator: `listLearnedSkillsForCurator(accountId, owner)`, `ownersWithLearnedSkills()` (system).
- Integration tests:
  - isolation of skills and suggestions between two accounts;
  - `claimJobs`: two claimers get disjoint jobs;
  - the unique dedup key;
  - feedback only on the owner's own assistant message.
- Commit `feat(db): add assistant skills, ledger, suggestions, settings and jobs (T-170)`.

### Task 2: Owner, learned and shadow skills, the ledger and the skill routes

**Files:**
- Create: `apps/backend/src/modules/assistant/application/skills.service.ts`
- Modify: `skill-tools.ts`, `prompt-builder.ts` (index), `chat-turn.service.ts`, the facade, the controller and the contracts (`assistant.schema.ts`, `assistant.routes.ts`, all routes `assistant: { use: 'never' }`)
- Tests.

**Catalog per owner (`SkillsService.catalog(scope)`):**
- The platform skills (files), then the owner's rows in state `active`.
- A `shadow` row with `shadow_of = X` replaces platform skill X in the index and in `load_skill`.
- The index shows `name: description`, sorted by name, with no provenance marker. It stays byte-stable.
- The frozen prompt is rebuilt only at thread start and after compaction, as for memory.

**`load_skill`:**
- Resolves the name through the catalog.
- Bumps `use_count` and `last_used_at` for row skills.
- Records the name in the turn context (`loadedSkills`) for the read-before-write rule.

**`skill_manage` tool** (new, toolset `skills`, registered in the chat turn and in the review):

```
input: { action: 'create' | 'patch' | 'archive', name, description?, body?, reason? }
```

- **Chat actor (`assistant`):**
  - `create` makes an `owner` skill, active at once. The tool description says: only when the owner explicitly asks to save a procedure ("lưu thành quy trình").
  - `patch` only for owner skills and learned skills loaded in this turn.
  - Platform skills can never be patched: `platform_skill_immutable`. The owner customises them from the page.
- **Review actor (`review`):**
  - `create` makes a `learned` skill in `pending_approval`;
  - `patch` applies at once to a learned or owner skill **loaded in this review run** (otherwise `load_first`), with `patch_count` +1;
  - `archive` is allowed for learned skills only.
- **Every write:**
  - `lintSkill`; failure gives `invalid_skill:<problems>`;
  - a name collision gives `name_taken`;
  - more than 50 active or pending skills gives `skill_limit`;
  - one ledger row with before/after.

**Routes:**

| Route | Returns / does |
|---|---|
| `GET /assistant/skills` | `AssistantSkillList`: platform entries (`provenance: 'platform'`, `shadowed: bool`) plus rows, with state and counters |
| `GET /assistant/skills/{skillRef}` | Body. `skillRef` is a row id or `platform:<name>` |
| `POST /assistant/skills` | Owner creates `{ name, description, body }` → active, ledger actor `owner` |
| `PATCH /assistant/skills/{skillId}` | Owner edits description/body/pinned. Ledger `patch` |
| `POST /assistant/skills/{skillId}/approve` | `pending_approval` → `active`, ledger `approve` |
| `POST /assistant/skills/{skillId}/reject` | → `archived`, ledger `reject` |
| `POST /assistant/skills/{skillId}/archive` | Ledger `archive` |
| `POST /assistant/skills/{skillId}/restore` | `stale`/`archived` → `active`, ledger `restore` |
| `POST /assistant/skills/platform/{name}/shadow` | Creates the shadow, copying the platform body. Answers 409 if one exists |
| `DELETE /assistant/skills/{skillId}` | Shadow only: deletes it, so the original comes back |
| `GET /assistant/skills/{skillId}/events` | The ledger |
| `POST /assistant/skill-events/{eventId}/undo` | Restores the `before` snapshot (or archives a created skill), appends an `undo` row and marks the event `undone_at`. Undo of an undone event or a stale snapshot gives 409 |

**Tests:**
- the shadow replaces the platform skill in the index;
- `platform_skill_immutable`;
- review create → pending, then approve → active and in the catalog;
- read-before-write;
- undo of a patch restores the body;
- staff get 403 on the skill routes;
- another owner gets 404.

Commit `feat(assistant): owner, learned and shadow skills with a ledger and undo (T-170)`.

### Task 3: Background review (worker job)

**Files:**
- Create: `packages/ai-core/prompts/assistant-review@1.md`, `apps/backend/src/modules/assistant/application/review.service.ts`, `apps/backend/src/modules/assistant/application/assistant-runner.ts`, and an `ASSISTANT_RUNNER` export in `api/`
- Modify: `apps/backend/src/entries/worker.ts` (import `AssistantModule`, tick the runner every 15 s like the others), `chat-turn.service.ts` (counters + enqueue), `memory-tools.ts` (an `origin` parameter: `assistant` | `review`)
- Tests.

**Triggers (in the chat turn, after a turn that answered):**
- Bump `review_owner_turns` +1 and `review_tool_rounds` by the turn's tool rounds.
- If the assistant itself wrote memory or skills in this turn, reset both counters.
- `review_owner_turns ≥ 8` → enqueue `review`/`memory`, `run_after = now`.
- `review_tool_rounds ≥ 10` → enqueue `review`/`skills`, `run_after = now`.
- Otherwise, if `review_owner_turns ≥ 3` → enqueue `review`/`combined` with `run_after = now + 30 min`. This is the idle trigger: each later turn pushes `run_after` back, because enqueue updates the existing queued job.
- Never for `schedule` threads, interrupted or failed turns, or when settings say `review_enabled = false`.
- Counters reset when a job is enqueued with `run_after = now`.

**Claiming and cancellation:**
- The runner claims up to 3 due jobs per tick with a 5-minute lease.
- It cancels a review job if the thread's `last_message_at` is after the job's `created_at`, the owner turned review off, or the owner is no longer an active owner. For the owner check, resolve the scope through the same facade calls as `resolveOwnerScope`, using the thread's `business_id` or any business of the account the owner is a member of.

**Review run:**
- **Prompt:** the thread's frozen system prompt, plus `assistant-review@1.md` as the user instruction. Port the Hermes review instructions (see spec §11; local copy `~/Workspace/NetClaw_1.1.0/hermes-agent`, grep for the review prompt):
  - owner corrections and frustration are first-class signals;
  - preference order: patch a skill loaded in this thread → patch a broader skill → create a new class-level skill;
  - do not capture transient errors, one-off stories, unresolved failures or customer data;
  - memory = who the owner is, skills = how to do this class of task for this owner;
  - "nothing to save" is a valid answer;
  - the scope (memory / skills / combined) says what to focus on.
- **Messages:** the last 24 active messages of the thread as a digest (role + text; tool results cut to 300 chars). This is the transcript the review reads.
- **Tools:** `memory` (origin `review`), `skills_list`, `load_skill`, `skill_manage` (actor `review`), `session_search`, and a new `suggest` tool:
  - input `{ kind, dedup_key, title, payload }`;
  - at most 5 pending per owner (`suggestion_limit`).
- **Model:**
  - tier `pro`, `promptCacheKey` the same as the thread's;
  - 8 rounds, a 120 s budget, and it stops once the run's input tokens reach 200 000;
  - recorded as `assistant_runs` `kind = 'review'` with its steps.
- **Ending:** reset the counters and set `last_review_at`. A failure gives job `failed`, one retry (`attempts < 2`) with a 10-minute delay, and is logged by id and error class only.

**Learning feed (Ruling 1c-R2):**
- `GET /assistant/learning?days=7` returns the owner's ledger rows by actor `review`/`curator` plus memory entries with origin `review`, newest first, at most 20.
- Each item says what changed and has an undo handle (`skillEventId`, or memory `store` + `entryId`, whose undo is the existing delete).

**Tests:**
- trigger maths, including the counter reset;
- job cancellation on a newer message;
- a review with a fake gateway that calls `memory` and `skill_manage` → the memory entry has origin `review`, and the skill is `pending_approval` with a ledger row;
- read-before-write in the review;
- the runner claims jobs and skips cancelled ones;
- the learning feed.

Commit `feat(assistant): background review that learns memory and skills (T-170)`.

### Task 4: Curator, settings, toolsets, feedback, suggestions routes

**Curator (`curator.service.ts`, run by the same runner):**
- Once per day per owner with learned skills: track `last curator run` on `assistant_settings`, adding the column in 0058 if Task 1 forgot it.
- Rules for an `active` learned skill:
  - if `last_used_at` (or `created_at` when it was never used) is older than 30 days, it becomes `stale`;
  - if `stale` and older than 90 days, it becomes `archived`.
- It skips pinned skills and skills younger than 30 days.
- Ledger actor `curator`. It makes no LLM call.

**Routes:**
- **Settings:**
  - `GET /assistant/settings` → `{ reviewEnabled, disabledToolsets, toolsets: [{ id, labelKey, toolCount, uses30d }] }`. `uses30d` counts `assistant_run_steps` of the owner's runs from the last 30 days, grouped by tool → toolset.
  - `PATCH /assistant/settings`. The `core` and `ui` toolsets cannot be disabled (400).
  - Toolsets: `core` (`session_search`, `todo` if present), `ui`, `memory`, `skills`, `routes`.
  - Disabled toolsets are removed from the chat turn's tool list. The disabled set enters the prompt-cache key as a sorted suffix, so the cache stays correct.
- **Feedback:** `POST /assistant/messages/{messageId}/feedback` `{ value: 1 | -1 | 0 }` (0 clears it). Messages in the DTO gain `feedback`.
- **Suggestions:**
  - `GET /assistant/suggestions`: pending only.
  - `POST /assistant/suggestions/{id}/accept`: kind `skill`: the payload `{ name, description, body }` creates an owner skill through the skills service. Kind `setup`: just accepted, and the payload's `path` is returned so the web can navigate. Kind `schedule`: accepted only (1c-R3).
  - `POST /assistant/suggestions/{id}/dismiss`.

**Tests:**
- curator thresholds (29/31/89/91 days, pinned, young);
- settings validation;
- a disabled toolset is absent from the turn's tools;
- feedback on another owner's message → 404;
- suggestion accept/dismiss;
- the dedup key is permanent after dismiss.

Commit `feat(assistant): curator, owner settings, feedback and suggestions (T-170)`.

### Task 5: Web

All strings go in the i18n `assistant` namespace (vi + en). Use the panel's existing views pattern (the memory view from 1b).

- **"Kỹ năng" view in the panel:**
  - Sections Đang chờ duyệt / Của anh/chị / Đã học / Có sẵn (platform) / Lưu trữ.
  - A pending learned skill is a one-tap card (Duyệt / Bỏ) with a collapsible body.
  - Each skill opens an editor (description + body textarea, Lưu) and its ledger with "Hoàn tác" per entry.
  - Platform skills have "Tinh chỉnh" (create a shadow). A shadow has "Khôi phục bản gốc".
  - Archived skills can be restored.
- **Learning notice:** at the top of the thread list (or under the header), one quiet line per learning feed item: "💡 Trợ lý vừa học: …" with "Hoàn tác" and, for a pending skill, "Xem".
- **Suggestions:** cards above the composer when pending exist (title, Đồng ý / Bỏ qua). A `setup` acceptance navigates through the safe path guard.
- **👍/👎** under every assistant answer, toggling; the backend value is kept in the message DTO.
- **"Cài đặt trợ lý" view:**
  - Review on/off switch ("Cho trợ lý tự học từ các cuộc trò chuyện").
  - The toolsets list with uses in the last 30 days and switches (core and ui are locked).
  - A link to the memory view.
- Tests:
  - pending skill approve;
  - undo from the ledger;
  - shadow create;
  - learning notice undo;
  - suggestion accept navigates;
  - feedback toggle;
  - settings switch.
- Commit `feat(web): skills, learning notices, suggestions, feedback and settings in the assistant (T-170)`.

### Task 6: Docs

- Spec: add §20 "Adjustments made while building 1c", with rulings 1c-R1…R5 and anything the tasks changed, and mark 1c shipped in the capability table.
- ADR-023: a consequences line for 1c.
- `MODULE.md`: tables, routes, tools, the worker runner.
- docs/04: routes and the worker runner.
- docs/05: tables.
- docs/06: the assistant review.
- docs/16: the worker tick and the review budget.
- Commit `docs(assistant): record the 1c slice (T-170)`.
