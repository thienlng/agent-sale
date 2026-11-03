# Education and spa verticals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `education` and `spa` verified verticals.
- The bot answers from a catalog of courses and services, and records placement-test, trial-class, consultation and appointment requests on the CRM customer, with industry statuses.
- Staff work those requests on the customer list and in the inbox.
- The owner assistant knows both industries.
- Both are added to `SELECTABLE_INDUSTRIES`.

**Architecture:**
- The saas built-in tool becomes one industry-configured `record_request` tool. Its per-industry config lives in contracts and its writer in `crm`. A request is a `contact_history` entry, a signed note and a status move. There is no new table (ADR-020 pattern).
- Courses and services are commerce products with a typed nullable `offering` jsonb (migration 0064).
- The request industries (saas, education, spa) share a new `sales-agent@19` prompt.
- The assistant gets a `service` industry group, two industry skills, SQL views and a `new_requests` report/alert template.

**Tech Stack:** NestJS 12 on Fastify, Drizzle + PostgreSQL 16 (RLS), Zod 4, Vitest, React 19 + TanStack Query/Router, i18next.

**Spec:** `docs/superpowers/specs/2026-11-04-education-spa-verticals-design.md`, copied from the scratchpad `spec.md` in Task 8. ADR: `docs/adr/ADR-025-request-verticals-education-spa.md` (Task 8). It generalises ADR-020 §4.

## Global Constraints

- English for code, comments, docs and commits. Vietnamese only in i18n files, seed packs, starter rules, note labels and request-profile labels (business content).
- **Tenant isolation.**
  - Every new read or write runs in the workspace transaction (`store.run(ws, …)`) under RLS.
  - The new assistant_sql view exposes no name, phone, email or free text.
  - Logs carry ids, tool names and error classes only. Never log details, phone, notes or prompt text.
- **Saas behaviour is byte-identical except the tool name.** That covers the kinds, the required fields, the `requested` forward-only move and the note text. A test pins the note text.
- **Migration `0064_service_verticals.sql` is additive only.** It is the next free number after `0063_bot_turn_traces.sql` on origin/main `b0d76d39`. Re-check `ls packages/db/migrations` before you create it, and take the next free number if main moved.
- **Route contracts and handlers land in the same commit.** `apps/backend/test/http.spec.ts` checks that every contract route is served. So a lane that serves a route also declares it. Task 1 adds only schemas and DTOs.
- Every new workspace route declares `assistant` (`routes.assistant.test.ts`). Both new crm routes are `read`.
- `pnpm check` must pass at the end of every task. Never skip or delete a test. Fake-mode evals run inside `pnpm test`.
- Do not edit `AGENTS.md`, `.agents/`, `.github/` or root tooling config.
- **Branches.**
  - One feature, one branch, one PR: `feat/education-spa-verticals`.
  - Each lane works in its own worktree on a lane branch cut from the Task 1 commit (`feat/esv-<lane>`), then merges back into the feature branch with a normal merge.
  - Squash happens only at the final PR merge.
- **Commits.** Conventional Commits, with scope `contracts`, `db`, `crm`, `commerce`, `ai`, `bot`, `knowledge`, `web`, `assistant` or `docs`. End each message with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No mass test sends to real Pages. Playground and fake evals only. Live evals run once per lane that changes bot behaviour (Task 4) and in Task 8.

## Rulings taken while planning

Full table with costs in spec §12. These are the ones that shape the tasks:

- **ESV-R1:** One `record_request` tool. Its config is `REQUEST_PROFILES` in `packages/contracts/src/crm/customer-request.ts`, and its writer is `crm` (`CrmFacade.recordBotRequest`). `ai` drops its `saas` dependency and gains a `crm` one (tier 2 → tier 2; `crm` depends on neither `ai` nor `saas`). Cost if wrong: low. Saas traces show a new tool name; the old one is still rendered.
- **ESV-R2:** No requests table. A request is the history entry `contact.request_recorded` (or `contact.request_updated` for the same kind within 24 h), plus a note and a status move. Cost if wrong: medium. A later `customer_requests` table can backfill from history.
- **ESV-R3:** The education and spa moves are "move unless at a confirmed status" (`keep` list). Saas stays forward-only. Cost if wrong: low.
- **ESV-R4:** No requests page. The customer-list strip, the requests card in the sheet and the inbox, and status filters do the job. Cost if wrong: low.
- **ESV-R5:** Courses and services use a typed `offering` jsonb on products (migration 0064), not description conventions. Cost if wrong: medium.
- **ESV-R6:** One `sales-agent@19` for saas, education and spa, with no per-industry prompt file. Saas moves to @19 only if its live evals are no worse than on @15. Otherwise map saas back to @15 (one line in `PROMPT_BY_INDUSTRY`). Cost if wrong: medium.
- **ESV-R7:** Request-industry bots never get order tools, and the web hides orders and PMS for the `service` group. Cost if wrong: low.
- **ESV-R8:** The lanes are worktree branches merged into one feature branch. The final PR is one squash, as rule 02 requires. Cost if wrong: none.
- **ESV-R9:** Removing `SaasFacade.recordBotRequest` and `SaasLeadService.recordFromBot` waits for Task 8. Lanes 2 and 4 then never break each other: Task 4 stops calling saas, and Task 8 deletes the dead code. Cost if wrong: dead code for a few hours.
- **ESV-R10:** No tracker id exists for this work, so commit subjects carry none. Add `(T-xxx)` if the owner assigns one. Cost if wrong: none.

## Parallel lanes

```
Task 1 (foundation: contracts + db + facade stubs)          ── serial, first
   ├─ Task 2  crm: request writer, statuses, routes          ┐
   ├─ Task 3  commerce: offering persistence                 │
   ├─ Task 4  ai: record_request, @19, catalog view, evals   │  parallel, one worktree each,
   ├─ Task 5  bot + knowledge: packs and starter rules       │  all cut from the Task 1 commit
   ├─ Task 6  web                                            │
   └─ Task 7  assistant (Thỏ Rapiz)                          ┘
Task 8 (flip SELECTABLE_INDUSTRIES, delete dead saas code, docs, live evals) ── serial, last
```

Each lane owns its files. No file is edited by two lanes:

| Lane | Owns |
|---|---|
| 2 | `apps/backend/src/modules/crm/**` (but not `crm/api/crm.facade.ts`, which Task 1 changed), `packages/contracts/src/crm/crm.routes.ts`, `apps/backend/test/crm-requests.integration.spec.ts` |
| 3 | `apps/backend/src/modules/commerce/**`, `apps/backend/test/commerce-offering.integration.spec.ts` |
| 4 | `apps/backend/src/modules/ai/**`, `packages/ai-core/prompts/sales-agent@19.md`, `apps/backend/evals/requests/**`, `apps/backend/evals/README.md` |
| 5 | `apps/backend/src/modules/bot/domain/packs.ts` (+ spec), `apps/backend/src/modules/knowledge/domain/starter-rules.ts` (+ spec) |
| 6 | `apps/web/src/**` except `features/assistant/**`, `packages/i18n/src/messages/*/common.json` |
| 7 | `apps/backend/src/modules/assistant/**`, `packages/ai-core/assistant-skills/**`, `packages/contracts/src/assistant/schedule.schema.ts`, `apps/web/src/features/assistant/**`, `packages/i18n/src/messages/*/{assistant,notification}.json`, `apps/backend/evals/assistant/**` |

Merge order into the feature branch: any order. After each merge, run `pnpm check` on the feature branch.

Lanes 4, 6 and 7 test against fakes of the Task 1 interfaces. The real behaviour is checked in Task 8, on the merged branch.

---

### Task 1: Foundation — contracts, migration 0064, Drizzle schema, crm facade stubs

**Files:**
- Create: `packages/contracts/src/crm/customer-request.ts` and `customer-request.test.ts`. Export them from `packages/contracts/src/crm/index.ts` (or wherever crm exports are collected) and from `src/index.ts`.
- Modify: `packages/contracts/src/commerce/commerce.schema.ts` (`OfferingDetails`, `ProductDto.offering`, `UpsertProductRequest.offering` plus the refine), and `commerce.schema.test.ts`.
- Modify: `packages/contracts/src/bot/profile.ts` (new keys `branches` 2000 [education, spa] and `reschedule` 500 [spa]; `promotion` adds education and spa; `payment` adds education; `refundPolicy` adds education), and `profile.test.ts`.
- Modify: `packages/contracts/src/saas/saas.schema.ts`. `SaasRequestKind` and `SaasLeadDetails` become deprecated aliases derived from the saas request profile; the inferred types stay the same.
- Modify: `packages/i18n/src/messages/{vi,en}/training.json`, the labels and placeholders for `branches` and `reschedule`.
- Create: `packages/db/migrations/0064_service_verticals.sql` (spec §7).
- Modify: `packages/db/src/schema/commerce.ts`: `offering: jsonb('offering').$type<Record<string, unknown> | null>()` and the check.
- Modify: `apps/backend/src/modules/crm/api/crm.facade.ts`. Add `recordBotRequest` and `requestsRecorded` (signatures below), plus the result types.
- Modify: `apps/backend/src/modules/crm/application/crm.facade.impl.ts`. Add both methods as stubs that throw `new Error('not implemented')`; Task 2 replaces them. Also update any test fake of `CrmFacade` that must satisfy the interface: grep for `implements CrmFacade` and `: CrmFacade =`.

**Interfaces (produced):**

```ts
// customer-request.ts — see spec §4.1 for the full table
export const CustomerRequestKind = z.enum(['demo', 'trial', 'consultation', 'placement_test', 'appointment']);
export type CustomerRequestKind = z.infer<typeof CustomerRequestKind>;
export const REQUEST_INDUSTRIES = ['saas', 'education', 'spa'] as const satisfies readonly Industry[];
export type RequestIndustry = (typeof REQUEST_INDUSTRIES)[number];
export function isRequestIndustry(industry: string): industry is RequestIndustry;
export type RequestFieldKey =
  | 'name' | 'phone' | 'email' | 'company' | 'teamSize' | 'need' | 'planInterest'
  | 'studentName' | 'studentAge' | 'studentLevel' | 'course' | 'goal'
  | 'service' | 'branch' | 'preferredDate' | 'preferredTime' | 'guests' | 'note';
/** A requirement group: a key, or "at least one of" these keys. */
export type RequestFieldRule = RequestFieldKey | readonly RequestFieldKey[];
export type RequestStatusMove =
  | { key: string; move: 'forward_only' }
  | { key: string; move: 'unless'; keep: readonly string[] };
export interface RequestFieldDef { key: RequestFieldKey; max: number; label: string; describe: string }
export interface RequestProfile {
  toolName: 'record_request';
  actionName: string;
  description: string;
  kinds: readonly CustomerRequestKind[];
  kindLabels: Partial<Record<CustomerRequestKind, string>>;
  fields: readonly RequestFieldDef[];
  required: Partial<Record<CustomerRequestKind, readonly RequestFieldRule[]>>;
  recommended: Partial<Record<CustomerRequestKind, readonly RequestFieldRule[]>>;
  status: Partial<Record<CustomerRequestKind, RequestStatusMove>>;
}
export const REQUEST_PROFILES: Readonly<Record<RequestIndustry, RequestProfile>>;
export function requestProfileFor(industry: string): RequestProfile | null;
export function requestDetailsSchema(industry: RequestIndustry): z.ZodObject<z.ZodRawShape>;
/** Field keys of `rules` not satisfied by `details` (a group counts as one entry: its first key). */
export function unmetRules(rules: readonly RequestFieldRule[] | undefined, details: Record<string, unknown>): RequestFieldKey[];
export const CustomerRequestDto, CustomerRequestList, RequestSummaryDto; // spec §4.1
```

- `requestDetailsSchema` details:
  - every field is `z.string().trim().max(def.max)` and optional, defaulting to `''`;
  - `email` is `Email.nullable().default(null)`;
  - `preferredDate` is `''` or `YYYY-MM-DD` (regex plus a real-date refine);
  - `name` and `phone` are `.min(1)`;
  - the object is `strip`, not strict: the model may send extra keys.
- **Saas profile.** Fields, maxima and labels come from today's `SaasLeadDetails` and `leadNote`: `Tên`, `Công ty`, `Quy mô`, `Nhu cầu`, `Thời gian mong muốn`, `Gói quan tâm`, `Email`, in that note order.
  - The `description` is today's `SAAS_REQUEST_DEFINITION.description`, word for word.
  - The `actionName` is today's `SAAS_REQUEST_NAME`.
- **Education and spa profiles.** Spec §4.1 table. Each tool description, in English:
  - says when to call;
  - says what to collect first;
  - says to call again when the customer adds or corrects details;
  - says `recorded true` means saved;
  - says "staff confirm: never promise a slot, a teacher or a result".
  - The spa description also says: "`preferredDate` is YYYY-MM-DD only when the customer named a day; otherwise put their words in `preferredTime`".

```ts
// crm.facade.ts additions
export type BotRequestResult =
  | { outcome: 'recorded' | 'updated'; contactId: string; created: boolean; missing: RequestFieldKey[]; dateLabel: string | null }
  | { outcome: 'preview'; missing: RequestFieldKey[]; dateLabel: string | null }
  | { outcome: 'invalid'; problems: string[] };
recordBotRequest(workspaceId: WorkspaceId, input: { kind: CustomerRequestKind; details: unknown; preview: boolean }): Promise<BotRequestResult>;
requestsRecorded(workspaceId: WorkspaceId, q: { since: Date; until: Date }): Promise<{
  count: number;
  byKind: { kind: CustomerRequestKind; count: number }[];
  byStatus: { key: string | null; name: string; count: number }[];
}>;
```

- [ ] Step 1: Write failing tests. Contracts:
  - each profile's kinds have a label, a status move and `required` entries;
  - every `required` and `recommended` key is one of the profile's fields;
  - the saas details schema accepts exactly what `SaasLeadDetails` accepted (a fixture from `saas-lead.spec.ts`);
  - `unmetRules` with groups;
  - `preferredDate` validation;
  - `OfferingDetails` defaults, and offering + accommodation being refused;
  - the profile fields for education and spa include `branches`, and spa includes `reschedule`;
  - `REQUEST_INDUSTRIES ⊂ Industry`.
- [ ] Step 2: Implement the contracts, the migration and the Drizzle column.
  - Run `pnpm --filter @agent-sales/db test`.
  - Run the db integration tests that apply migrations (`pnpm --filter @agent-sales/db test:integration` if present) so that 0064 applies after 0063.
  - Run `apps/backend/test/assistant-sql.integration.spec.ts`. It must still pass with the replaced `customers` view.
- [ ] Step 3: Add the facade signatures and stubs. `pnpm typecheck` must be green.
- [ ] Step 4: Run `pnpm check`.
- [ ] Step 5: Commit `feat(contracts): add the customer request profiles, product offerings and service profile fields, with migration 0064`.

### Task 2: crm — request writer, education and spa statuses, request routes  ‖ parallel

**Files:**
- Create: `apps/backend/src/modules/crm/domain/customer-request.ts` and `customer-request.spec.ts` (pure):
  - `requestNote(profile, kind, details, update): string`;
  - `decideStatusMove(move, currentKey, positions): boolean` (the forward-only rule needs `positions`);
  - `dateLabel(yyyyMmDd): string`, for example `Thứ Bảy 08/11/2026`;
  - `isPastDate(yyyyMmDd, now): boolean` in Asia/Ho_Chi_Minh;
  - `UPDATE_WINDOW_MS = 24 * 3_600_000`.
- Create: `apps/backend/src/modules/crm/application/customer-request.service.ts`. It holds `recordFromBot`, `listForContact`, `summary` and `recorded`.
- Modify: `crm/domain/crm-defaults.ts` (`EDUCATION_STATUSES`, `SPA_STATUSES`, `defaultStatusesFor`); `crm/application/contact.service.ts` (`moveStatusByKey` opts `keep`; a shared private `#record` call for the new history types); `crm/application/crm.facade.impl.ts` (replace the stubs); `crm/application/ports/*` and both stores (Drizzle and in-memory if one exists), adding:
  - `latestRequestEntry(contactId, kind, since)`;
  - `insertHistory(type, data)` if there is none yet;
  - `requestEntries(contactId, limit)`;
  - `requestCounts(since, until)`;
  - `openRequests(limit, since)`.
- Modify: `crm/interface/http/*`. Add a controller, or extend the contacts controller, for `GET /crm/requests/summary` and `GET /contacts/{contactId}/requests`.
- Modify: `packages/contracts/src/crm/crm.routes.ts`. Declare both routes with `assistant: { use: 'read', when: … }` (spec §4.4), `apiKey` as the neighbouring contact reads have it, and the permission (`contacts.view_all` for the summary).
- Modify: `crm/MODULE.md`.
- Create: `apps/backend/test/crm-requests.integration.spec.ts`. Port the request cases of `test/saas.integration.spec.ts` (lines ~230–270) to `crm.recordBotRequest`, and add the education and spa cases below.

**Behaviour:** spec §5.1, in this exact order:
1. industry → profile;
2. kind offered;
3. parse;
4. required groups → `missing:<key>` problems;
5. phone normalise;
6. past date;
7. preview;
8. upsert by phone;
9. the transaction (lock the contact, update window, status move, history entry, note).

The note uses `BOT_AUTHOR = 'Bot AI'`. The history `data` is `{ kind, details: <fields except phone and email, empty ones dropped>, dateLabel }`. The summary returns 404 (`CrmError NOT_FOUND`) outside `REQUEST_INDUSTRIES`.

- [ ] Step 1: Write failing unit tests:
  - the saas `requestNote` equals the old `leadNote` for the `saas-lead.spec.ts` fixtures, byte for byte;
  - the education and spa notes;
  - `decideStatusMove` for every row of the spec §4.1 status table;
  - `dateLabel` for each weekday;
  - `isPastDate` around local midnight;
  - every status key named in `REQUEST_PROFILES` exists in `defaultStatusesFor(industry)`.
- [ ] Step 2: Write failing integration tests on the test database:
  - education placement_test → the customer is created and at `test_requested`, with one history entry, one note and `missing` listing the unmet recommended groups;
  - a second call within 24 h → `updated`, the `contact.request_updated` history type and a second note;
  - an `enrolled` customer keeps `enrolled`;
  - a `lost` customer moves to `test_requested`;
  - a spa appointment without a date → `invalid` with `missing:preferredDate`;
  - a spa appointment with a past date → `past_date`;
  - a spa customer at `visited` moves to `booking_requested`, and one at `booked` stays;
  - saas: same as the ported tests;
  - preview writes nothing;
  - an unknown kind for the industry → `kind_not_offered`;
  - a retail workspace → `kind_not_offered`;
  - RLS: workspace B never sees A's requests through either route;
  - the summary counts per status, with `open` only holding customers still at the target status;
  - the summary is 403 for a member without `contacts.view_all`;
  - `GET /contacts/{id}/requests` is 404 for an invisible contact;
  - `requestsRecorded` counts only `request_recorded`, not updates.
- [ ] Step 3: Implement.
- [ ] Step 4: Run `pnpm --filter @agent-sales/backend test` and the crm integration specs, then `pnpm check`.
- [ ] Step 5: Commit `feat(crm): record bot requests for saas, education and spa on the customer, with industry statuses and request routes`.

### Task 3: commerce — product offerings  ‖ parallel

**Files:**
- Modify:
  - `apps/backend/src/modules/commerce/application/*`: the product service, mappers and validation;
  - `infrastructure/persistence/*`: read and write `offering`;
  - the bot order path (`prepareBotOrder`: an offering variant → problem `not_sold`);
  - the low-stock read used by reports and the commerce view: exclude offering products;
  - `MODULE.md`.
- Check: the KiotViet sync upsert in `modules/integration` must not overwrite `offering`. If it writes the products row with an explicit column list, add nothing. If it spreads a DTO, the commerce write path must keep the stored `offering` when the input omits it. Add a test either way.
- Create: `apps/backend/test/commerce-offering.integration.spec.ts`.

- [ ] Step 1: Write failing tests:
  - create and read a product with `offering`;
  - update with `offering` omitted keeps it;
  - `offering: null` clears it;
  - `offering` plus `accommodation` → 400 `VALIDATION_FAILED`;
  - the list and detail return `offering` (`null` for old rows);
  - the low-stock figures ignore offering variants;
  - `prepareBotOrder` with an offering SKU → `not_sold`;
  - a PMS-synced product update keeps `offering`.
- [ ] Step 2: Implement, then run the commerce unit and integration tests and `pnpm check`.
- [ ] Step 3: Commit `feat(commerce): store course and service details on products (offering)`.

### Task 4: ai — `record_request`, prompt `sales-agent@19`, offering catalog view, evals  ‖ parallel

**Files:**
- Rename and rewrite: `ai/application/saas-tools.ts` → `ai/application/request-tools.ts`, and `__tests__/saas-tools.spec.ts` → `__tests__/request-tools.spec.ts`. Keep `contactVouched` and its tests.
- Modify:
  - `ai/application/reply-pipeline.ts`: `turnTools` option `requests?: RequestToolContext | null` replaces `saas`.
  - `ai/application/playground.service.ts`:
    - `PROMPT_BY_INDUSTRY`;
    - `SalesPromptVersion` adds 19;
    - inject `CRM_FACADE` as optional;
    - remove the `SAAS_FACADE` injection;
    - no order tools when `isRequestIndustry(bot.industry)`;
    - build `requests` for request industries.
  - `ai/ai.module.ts`: import `CrmModule` and drop `SaasModule`. First check that no cycle is created: `CrmModule` must not import `AiModule`, directly or transitively.
  - `ai/domain/product-view.ts` and `ai/domain/catalog-context.ts`: offering view (spec §5.3).
  - `ai/application/catalog-tools.ts`: only if it builds rows itself.
  - `ai/application/trace-detail.ts` and its spec: `record_request`, plus the legacy name.
  - `ai/MODULE.md`.
- Create: `packages/ai-core/prompts/sales-agent@19.md`. Copy `@15` and apply the four edits of spec §5.3, word for word as written there.
- Modify:
  - `ai/evals/case.ts`: `Product.offering: OfferingDetails.optional()`; `expect.request_recorded`, `request_kind` and `request_updated`.
  - `ai/evals/runner.ts`: wire the fake.
  - `ai/evals/checks.ts`: the new expectations.
  - `__tests__/evals.spec.ts`: the format tests for the new keys.
- Create: `ai/evals/requests.ts`. It is the in-memory `Pick<CrmFacade, 'recordBotRequest'>` of spec §8. Reuse `requestDetailsSchema` and `unmetRules`. Use a local copy of `dateLabel` and `isPastDate`: crm's domain is not importable from ai. The copy keeps the same output and is pinned by an eval-format test.
- Create: `apps/backend/evals/requests/*.yaml`, the 15 cases of spec §8. Each scripts its `fake_turns`, including a `search_products` call before any catalog figure. Tag the ★ cases `critical`.
- Modify: `apps/backend/evals/README.md`. Add a "Requests" paragraph like "Orders" and "Lodging holds".

**Interfaces:**

```ts
export const REQUEST_TOOL = 'record_request';
export const LEGACY_SAAS_REQUEST_TOOL = 'record_saas_request'; // trace rendering only
export interface RequestToolContext {
  facade: Pick<CrmFacade, 'recordBotRequest'>;
  ws: WorkspaceId;
  profile: RequestProfile;          // requestProfileFor(bot.industry)!
  isTest: boolean;
  customerTexts: readonly string[];
  calls: ActionCall[];
  onError?(error: unknown): void;
}
export function requestTools(ctx: RequestToolContext): ToolSet;
// tool input = z.object({ kind: z.enum(profile.kinds) }).extend(requestDetailsSchema shape, all optional for the model)
```

The results the model sees:
- `{ ok: true, recorded: true, updated: boolean, kind, missing: string[], dateLabel: string | null }`;
- `{ ok: false, error: 'contact_not_from_customer' | 'invalid_arguments' | 'not_recorded_retry_later', problems? }`.

The `actions` entry is `{ name: profile.actionName, ok, statusCode }`, as today.

- [ ] Step 1: Port the saas tool tests to `requestTools` with the saas profile, unchanged in meaning. Then add:
  - education and spa schemas;
  - `kind` limited to the profile's kinds;
  - the preview in the playground;
  - `updated` passed through;
  - `missing` and `dateLabel` passed through.
- [ ] Step 2: Write failing playground tests (`playground.spec.ts` or a new `industry-wiring.spec.ts`):
  - `@19` for saas, education and spa; `@18` for hotel; `@15` for retail;
  - `record_request` is offered only to request industries;
  - no `prepare_order` for a spa bot with `orderTaking: true`;
  - a retail bot still gets it.
- [ ] Step 3: Write failing product-view tests:
  - an offering product has `catalogKind` and no `inStock` or `available`;
  - an all-zero-price product has no `fromVnd`/`toVnd` and carries `priceNote`;
  - a retail product is unchanged (snapshot).
- [ ] Step 4: Implement, write `@19` and the eval cases, then run `pnpm --filter @agent-sales/backend test` (fake evals included) and `pnpm --filter @agent-sales/backend eval --group requests`.
- [ ] Step 5: Live evals (one run, needs the dev LLM route):
  - `eval --live --group requests`;
  - `eval --live` for every saas-industry case, on both `@15` (`PROMPT_VERSION_OPTION` = 15) and `@19`.
  - Paste the summary into the lane's merge commit message body.
  - If saas on `@19` fails a critical case that passes on `@15`, map saas to `@15` (ESV-R6) and note it.
- [ ] Step 6: Run `pnpm check`.
- [ ] Step 7: Commit `feat(ai): one record_request tool for saas, education and spa, prompt sales-agent@19 and course/service catalog facts`.

### Task 5: bot + knowledge — education and spa seed packs and starter rules  ‖ parallel

**Files:**
- Modify: `apps/backend/src/modules/bot/domain/packs.ts`: the education and spa `mission`, `greeting` and `faqs` (spec §5.4). No `{{placeholders}}`.
- Modify: `apps/backend/src/modules/knowledge/domain/starter-rules.ts`: `EDUCATION_RULES` and `SPA_RULES` (spec §5.4), wired into `starterRulesFor`.
- Modify: `bot/domain/bot.spec.ts`, `knowledge/domain/starter-rules.spec.ts`, and `knowledge/MODULE.md` if it lists the rule packs.

Rule content constraints. The existing comment in `starter-rules.ts` explains why each one holds:
- no sample amounts;
- no slot or availability claims;
- no outcome promises;
- no delivery address;
- every rule that asks for details ends with "rồi ghi nhận yêu cầu để nhân viên xác nhận";
- the `after_order` rule: thank the customer briefly, at most 25 words, say staff will confirm, and "Không chuyển cho nhân viên chỉ vì đã ghi nhận yêu cầu".

- [ ] Step 1: Write failing tests:
  - education and spa get their own packs;
  - no rule mentions "địa chỉ nhận hàng" or "giao hàng";
  - no rule contains a digit followed by `k` or `đ`;
  - titles are unique per pack;
  - each pack has exactly one `after_order` rule;
  - the education and spa missions do not contain `{{`.
- [ ] Step 2: Implement, then run `pnpm check`.
- [ ] Step 3: Commit `feat(knowledge): education and spa seed packs and starter rules`.

### Task 6: web — service group, offering form, request strip and card  ‖ parallel

**Files:**
- Create: `apps/web/src/features/workspace/utils/industry-group.ts` and its test: `industryGroup(industry) → 'shop' | 'hotel' | 'saas' | 'service' | undefined`.
- Modify: `apps/web/src/components/layout/app-sidebar.tsx` and its test:
  - the `service` group shows products under `nav.courses` (education) or `nav.services` (spa);
  - no orders and no PMS;
  - the loading skeleton is unchanged.
- Modify: `features/commerce/components/product-form.tsx` and its test:
  - in a `service` business, an offering section with the spec §4.2 fields;
  - a "Đây là sản phẩm bán lẻ" switch (default off; on sends `offering: null`);
  - the stock editor is hidden while `offering` is set.
  - Also `products-list.tsx` and its test: a duration/sessions cell instead of stock for offering rows.
- Create: `features/crm/api/requests.ts` (TanStack Query hooks for both routes), `features/crm/components/request-summary-strip.tsx`, `features/crm/components/customer-requests-card.tsx`, and their tests.
- Modify:
  - `routes/app/contacts.tsx`: the strip and `renderOverviewExtra` for `service`;
  - `routes/app/-components/inbox-sales-panel.tsx`: education and spa render `CustomerRequestsCard` in place of the orders block, and the `ContactSheet` extra;
  - `features/crm/components/contact-history.tsx`: a body for `contact.request_*` (kind label + details line).
- Modify: the bot settings component that renders the `orderTaking` switch (grep `orderTaking` under `apps/web/src/features`). Hide it for `isRequestIndustry`.
- Modify: `features/knowledge/utils/faq-profile-topics.ts` and its test (new fields).
- Modify: `packages/i18n/src/messages/{vi,en}/common.json`:
  - `nav.courses`, `nav.services`;
  - `crm.history.type.contact.request_recorded` and `crm.history.type.contact.request_updated`;
  - `crm.requests.*` (strip, card, kind labels for the five kinds);
  - `commerce.offering.*` (section titles, field labels, format options, the retail switch).
- Do not change `SELECTABLE_INDUSTRIES` here (Task 8).

- [ ] Step 1: Write failing tests (Vitest + Testing Library, API mocked as in `saas.test.tsx`):
  - the sidebar per group;
  - the product form sends `offering` for a spa business and `null` with the retail switch on;
  - the strip renders counts, and a click navigates with the `statusId` filter;
  - the card lists requests with `dateLabel`;
  - the inbox panel shows the card and not the orders block for a spa conversation;
  - the order switch is hidden for education.
- [ ] Step 2: Implement, then run `pnpm --filter @agent-sales/web test typecheck lint build` and `pnpm check`.
- [ ] Step 3: Commit `feat(web): courses and services, the customer request strip and card for education and spa businesses`.

### Task 7: assistant — service group, industry skills, SQL views, `new_requests` report  ‖ parallel

**Files:**
- Modify: `apps/backend/src/modules/assistant/domain/dashboard-map.ts` and its spec. Add the `service` group, the products purpose per group, `/app/integrations` → shop and hotel only, and the contacts purpose (spec §5.5).
- Modify: `assistant/application/route-catalog.ts` and its spec: `INDUSTRY_SECTIONS.service` and the service item words.
- Create: `packages/ai-core/assistant-skills/industry-education/SKILL.md` and `industry-spa/SKILL.md`, shaped like `industry-saas`:
  - front matter `toolsets: [ui, routes]`, `version: 1`, `title` and `description_vi`;
  - a body that starts with `# ` and contains "Use this when";
  - profile fields exactly as `profileFieldsFor('education' | 'spa')` lists them, in backticks;
  - a "Sources in Rapiz" section (GET /products for courses and services with their `offering`, GET /crm/requests/summary);
  - what customers ask, starter rules, sample scenarios, sample quick replies (the shortcuts of spec §9.6) and "Never" (no slot promises, no medical advice, no outcome guarantees, no prices outside the catalog).
  - No phone numbers, no links, no `{{`.
- Modify: `set-up-bot`, `draft-reply-guidance`, `fill-shop-info`, `fill-sample-data`, `add-products`, `import-products`, `answer-data-questions` and `read-revenue` (`SKILL.md`):
  - list `industry-education` and `industry-spa`;
  - add the `offering` fields where products are drafted or imported;
  - a service business's revenue note in `read-revenue`;
  - bump `version` on each one changed.
- Modify: `assistant/__tests__/autofill-skills.spec.ts` (`INDUSTRY_SKILLS` gains education and spa) and `skill-tools.spec.ts` (the skill list).
- Modify: `assistant/application/sql/sql-views.ts`: `customers.status_key`, the `customer_requests` view with its columns and an example, and the `SQL_RULES` line (spec §5.5). The view names and columns must match migration 0064 (`assistant-sql.integration.spec.ts`).
- Modify: `packages/contracts/src/assistant/schedule.schema.ts`:
  - `new_requests` in `ScheduleTemplate` and `ALERT_TEMPLATES`;
  - `NewRequestsAlertParams { minCount 1..1000 default 1 }`;
  - `scheduleParamsSchema`: report → `PeriodParams`, alert → `NewRequestsAlertParams`.
- Modify: `assistant/domain/ports/report-data-source.port.ts` (`requests(ws, since, until): Promise<RequestFigures>`), its infrastructure implementation (`crm.requestsRecorded`), `application/report.service.ts` (the case, with alert mode using `alertCursor` like `new_orders`), `domain/report-render.ts` and its spec, `application/schedule-tools.ts` (the template description), and `domain/schedule.ts` if it lists the templates.
- Modify: `apps/web/src/features/assistant/components/schedule-editor.tsx` (the template option) and `packages/i18n/src/messages/{vi,en}/{assistant,notification}.json`.
- Create: `apps/backend/evals/assistant/requests.yaml`, the two assistant cases of spec §8.
- Modify: `assistant/MODULE.md`.

- [ ] Step 1: Write failing tests:
  - the dashboard map for `education` lists products and contacts, but not orders or integrations; `saas` and `hotel` are unchanged;
  - route-catalog boosts `/crm/requests/summary` for "khách đặt lịch";
  - the autofill-skills spec passes with the new skills;
  - report-render for `new_requests` (vi/en, report and alert);
  - `report.service` hits the alert only when `count >= minCount`;
  - the schedule schema accepts `new_requests` alert params;
  - the assistant evals in fake mode.
- [ ] Step 2: Implement, then run `pnpm --filter @agent-sales/backend test`, `pnpm --filter @agent-sales/backend eval:assistant` and `pnpm check`.
- [ ] Step 3: Commit `feat(assistant): education and spa in the dashboard map, industry skills, request views and the new_requests report`.

### Task 8: Flip, cleanup, docs and live verification (serial, last)

**Files:**
- Modify: `packages/contracts/src/bot/industry.ts`: `SELECTABLE_INDUSTRIES = ['retail', 'hotel', 'saas', 'education', 'spa']`. Also update `create-business-page.test.tsx` and `create-business-dialog.test.tsx` if they pin the list, and the sign-up form test if it pins it.
- Delete the dead saas request code (ESV-R9):
  - `SaasFacade.recordBotRequest`;
  - `SaasLeadService.recordFromBot`. Keep `assertSaas`, which `saas-plan.service` and `saas-subscription.service` use;
  - `saas/domain/saas-lead.ts` `leadNote` and `REQUESTED_STATUS`, if unused;
  - `saas.facade.impl.ts`. Delete `api/saas.facade.ts` and `SAAS_FACADE` if nothing else uses them;
  - the request cases left in `test/saas.integration.spec.ts`, already ported in Task 2;
  - `saas/__tests__/saas-lead.spec.ts` cases for `recordFromBot`.
- Create: `docs/adr/ADR-025-request-verticals-education-spa.md` (use the `write-adr` skill). It records:
  - the generalised tool;
  - the writer in crm;
  - the `ai` → `crm` dependency;
  - requests as history entries (ESV-R2);
  - offerings;
  - `@19`.
  - Add it to `docs/adr/README.md`.
  - Add a "Superseded in part by ADR-025 (§4: the writer moved to crm, the tool became `record_request`)" note to ADR-020's header.
- Modify:
  - `docs/ARCHITECTURE.md`, the tier-2 row: `ai` depends on `crm` (built-in request tool, ADR-025) instead of `saas`;
  - `docs/17-multi-tenancy-and-verticals.md`: §3 lists the selectable verticals, plus a "Current education and spa slice (ADR-025)" section;
  - `docs/saas.md`, `docs/actions.md`: the tool name;
  - `docs/05` (data model): `products.offering`, the history types, the views;
  - `docs/06` (API): the two crm routes;
  - `docs/13` (testing): the requests eval group.
- Create: `docs/education-and-spa.md`, the operations doc for owners and support, like `docs/saas.md` and `docs/lodging.md`:
  - statuses and how a request moves them;
  - what the bot collects;
  - where staff see requests;
  - what the bot never promises.
- Copy the spec and this plan into `docs/superpowers/specs/2026-11-04-education-spa-verticals-design.md` and `docs/superpowers/plans/2026-11-04-education-spa-verticals.md`. Add a "§13 Adjustments made while building" section to the spec, listing whatever the lanes changed.
- [ ] Step 1: Flip and clean up. Run `pnpm check`.
- [ ] Step 2: On the merged branch, run `pnpm --filter @agent-sales/backend eval --live --group requests` plus the saas cases. Record the summary in the PR body.
- [ ] Step 3: Put the branch on the dev servers (project memory: the dev server comes before the owner tests). Seed one education and one spa demo business with the spec §9 contract. Walk through the spec §11.4 scenario in the playground and the dashboard.
- [ ] Step 4: Commit `feat(contracts): offer education and spa when creating a business` and `docs(verticals): record the education and spa verticals (ADR-025)`.
- [ ] Step 5: Open the PR with the `open-pr` skill, after a fresh-context `review-pr`.

---

## Demo seed contract

The full contract is spec §9: calls in order, crawl-field → body mapping, legacy mode, scenarios, quick replies, statuses and smoke questions. This summary is for a script author.

1. `POST /api/v1/auth/login` `{ email, password, client: 'native' }` → `accessToken`. The demo owner comes from env vars.
2. `POST /workspaces` `{ name, industry }` → `id`. Send it as `X-Workspace-Id` from here on.
3. `GET` then `PATCH /workspace/profile` `{ companyName, expectedVersion }`.
4. `POST /bots` `{ name, industry }`. This seeds the pack FAQs and starter rules.
5. `PATCH /bots/{botId}` `{ settings: { mission, greeting, profile: { fields, notes } } }`. Profile mapping: spec §9.2.
6. `GET /crm/statuses`. This seeds and verifies the industry statuses.
7. `GET /warehouses`, only when the crawl has retail `product` offerings.
8. For each offering:
   - `POST /products/images` `{ mimeType, base64 }`, at most 5;
   - `POST /products` with `offering` and variants (spec §9.3).
9. `POST /products/{id}/stock` `{ variantId, warehouseId, onHand }`, for retail products only.
10. `POST /bots/{botId}/faqs/import` `{ items }`, at most 100 per call, deduplicated.
11. `POST /bots/{botId}/training-items/starter-rules`.
12. `POST /bots/{botId}/training-items`, for scenarios (`kind: 'scenario'`, from `scenariosHints` through the topic templates).
13. `POST /bots/{botId}/training-items`, for quick replies (`kind: 'quick_reply'`, `title = trigger = shortcut`, content from profile fields).
14. `GET /bots/{botId}/readiness`. Every check is done except `channel`.
15. One `POST /bots/{botId}/playground` smoke question. Expect `outcome: 'answered'`.

No channel connection, no sends to real Pages and no crawled personal data. Steps 6–8 need Tasks 1–3 merged. Before that, use legacy mode (spec §9.4).
