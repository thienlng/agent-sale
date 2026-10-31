# Bot orders, calculator and orders review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The bot computes figures with an exact `calculate` tool, closes sales by preparing an order summary with quick-reply buttons and creating the order on the customer's confirmation, and staff review bot orders in a redesigned orders list.

**Architecture:**
- A contracts and schema task (Task 0) fixes every shared shape.
- Wave 1 runs six tasks in parallel worktrees: calculator, commerce backend, ai order tools and prompts, channel quick replies, the orders web UI, and the test chat with bot settings.
- Wave 2 adds evals and docs. The controller gate then runs acceptance QA.

**Tech Stack:** NestJS modular monolith, Drizzle/Postgres (forced RLS), Zod contracts, mathjs (BigNumber), React + Tailwind v4 + shadcn/Radix, Vitest, Testcontainers.

**Spec:** `docs/superpowers/specs/2026-10-31-bot-orders-and-calculator-design.md` (read it; this plan argues from it).

## Global Constraints

- Branch base `feat/bot-orders`. Each task works in its own worktree and touches only its listed files. Never push, never merge. Never modify `/home/kenknight/Workspace/NetClaw_1.1.0/**`.
- Rules: `AGENTS.md`, `.agents/rules/*.md`, `docs/ARCHITECTURE.md`.
  - Modules talk through `api/` facades.
  - `domain/` must not import frameworks or `@agent-sales/ai-core`.
  - Files stay under 400 lines.
  - English in code and docs. Vietnamese only in prompts, customer-facing summary text and the vi i18n file.
- Conventional Commits with valid scopes (`ai`, `ai-core`, `commerce`, `conversation`, `channel`, `bot`, `db`, `web`, `docs`, `repo`). Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never use `--no-verify`. Never delete or skip a test to go green.
- No sends to Messenger, ever. No `--live` evals by implementers.
- Logs carry the tool name and error class only: never arguments, customer text, phone numbers or addresses.
- Money is integer VND (`Money`, bigint in the DB). Prices always come from the catalog. The model never sets a price.
- Values, verbatim from the spec:
  - quick replies `✅ Đặt hàng` / payload `ORDER_CONFIRM` and `✏️ Sửa thông tin` / payload `ORDER_EDIT`;
  - draft TTL 30 min;
  - `prepare_order` items 1..20, qty 1..99, name ≤ 120, address ≤ 300, note ≤ 300;
  - calculator expression ≤ 300 chars, `|exponent| ≤ 15`, result ≤ 1e15, BigNumber precision 64;
  - order `client_request_id = bot:<conversationId>:<amounts_hash>`;
  - review states `pending|approved`;
  - hover card open delay 300 ms, close delay 100 ms, width ≈ 320 px, max height 360 px, thumbnails 40×40;
  - approve undo window 5 s;
  - "Phí ship: shop báo sau" when no default shipping fee.
- Build changed packages before their dependents: `pnpm --filter @agent-sales/contracts build`, `@agent-sales/db`, `@agent-sales/ai-core`, `@agent-sales/channels`, `@agent-sales/shared`.
- Do not run `pnpm check` (the controller runs the gate). Run the focused commands your task lists. On this loaded host, rerun a web test that times out at 5 s with `--testTimeout=30000`, and say so.

---

## Task 0: Contracts, schema and migration (wave 0, single agent)

**Files:**
- Modify:
  - `packages/contracts/src/commerce/commerce.schema.ts`
  - `packages/contracts/src/commerce/commerce.routes.ts` (or the file holding the order routes)
  - `packages/contracts/src/ai/ai.schema.ts`
  - `packages/contracts/src/bot/bot.schema.ts`
  - `packages/db/src/schema/commerce.ts`
  - `packages/db/src/schema/bot.ts`
  - `apps/backend/src/modules/commerce/api/commerce.facade.ts`
  - `apps/backend/src/modules/ai/api/reply-options.ts`
  - `packages/channels/src/adapter.ts`
- Create: `packages/db/migrations/0039_bot_orders.sql`
- Tests: the contracts schema tests next to each schema. Extend the db schema/RLS policy test if one lists tenant tables.

**Produces (exact names, used by every later task):**
```ts
// contracts commerce
export const OrderReviewState = z.enum(['pending', 'approved']);
export const OrderCreatedByKind = z.enum(['agent', 'bot', 'import', 'api']);
// OrderSummaryDto and OrderDto gain:
createdByKind: OrderCreatedByKind, reviewState: OrderReviewState.nullable(),
reviewedByName: z.string().nullable(), reviewedAt: z.iso.datetime().nullable(), conversationId: z.uuid().nullable()
// OrderSummaryDto.itemsPreview items become:
{ name: string, qty: number, variantName: string | null, unitPrice: Money, imageUrl: string | null }
// OrderListQuery gains: review: z.enum(['pending']).optional()
// new route: POST /orders/{id}/approve  body ApproveOrderRequest = { approve: boolean }  → 200 OrderDto
// new route: GET /orders/review-count → { pending: number }
// contracts ai: PlaygroundResponse.messages[] items gain
quickReplies: z.array(z.object({ title: z.string().max(20), payload: z.string().max(100) })).max(3).optional()
// contracts bot: bot settings DTO + update request gain
orderTaking: z.boolean(), orderShippingFeeVnd: Money.nullable()
```
```ts
// reply-options.ts
export interface QuickReply { title: string; payload: string }
export interface OutgoingMessage { text?: string; images: {...}[]; quickReplies?: QuickReply[] }
// channels adapter.ts: the outbound message gains quickReplies?: { title: string; payload: string }[];
// the inbound message event gains quickReplyPayload?: string
```
```ts
// commerce/api/commerce.facade.ts — interface only (Task 2 implements)
export interface BotOrderItemInput { sku: string; qty: number }
export interface BotOrderRecipient { name: string; phone: string; address: string }
export type BotOrderProblem = { code: 'unknown_sku'|'inactive'|'insufficient_stock'|'missing_name'|'missing_phone'|'invalid_phone'|'missing_address'; sku?: string; available?: number };
export type PrepareBotOrderResult =
  | { ok: true; summaryText: string; productIds: string[] }
  | { ok: false; problems: BotOrderProblem[] };
export type ConfirmBotOrderResult =
  | { ok: true; orderId: string; orderCode: string }
  | { ok: false; code: 'expired' | 'insufficient_stock' | 'nothing_pending' };
// added to CommerceFacade:
prepareBotOrder(ws: WorkspaceId, input: { botId: string; conversationId: string; channel: string; items: BotOrderItemInput[]; recipient: BotOrderRecipient; note?: string; shippingFeeVnd: number | null }): Promise<PrepareBotOrderResult>;
confirmBotOrder(ws: WorkspaceId, input: { botId: string; botName: string; conversationId: string }): Promise<ConfirmBotOrderResult>;
cancelBotOrderDraft(ws: WorkspaceId, conversationId: string): Promise<boolean>;
hasBotOrderDraft(ws: WorkspaceId, conversationId: string): Promise<{ pending: boolean; storedAt: Date | null }>;
```
- Migration `0039_bot_orders.sql`, additive. It holds everything in spec §5:
  - orders columns plus their indexes;
  - `bot_order_drafts` with forced RLS, using the same policy pattern as other tenant tables;
  - the bot settings columns (`order_taking boolean not null default false`, `order_shipping_fee_vnd bigint null`).
  - Mirror every change in the Drizzle schema.
- Bot settings: read and update the two fields through the existing bot service and repository (backend `bot` module) so the API returns and persists them. This is a minimal plumbing change with one round-trip test.

- [ ] Step 1: write failing contract tests (new fields parse; `quickReplies` max 3 / title ≤ 20; `review=pending` query).
- [ ] Step 2: implement contracts, the db schema, the migration, the interfaces, and the bot settings plumbing.
- [ ] Step 3: build contracts, db, channels. Run the contracts tests, `cd apps/backend && npx tsc --noEmit -p .`, the bot module tests, and `pnpm arch`. The backend must still compile. A temporary `throw new Error('not implemented')` stub for the new facade methods in the commerce facade impl is acceptable, because Task 2 replaces it.
- [ ] Step 4: commit `feat(commerce): contracts and schema for bot orders and review`.

---

## Task 1: Calculator tool (wave 1)

**Files:**
- Create: `apps/backend/src/modules/ai/application/calculator.ts`, `__tests__/calculator.spec.ts`
- Modify: `apps/backend/src/modules/ai/application/reply-pipeline.ts`, only to add `calculate` to the read-only tool list in `turnTools`. Add one line and the import.
- Add the dependency `mathjs` to `apps/backend/package.json` and update the lockfile with `pnpm install`.

**Produces:**
- `export function calculate(expression: string): { value: string; formatted: string } | { error: 'invalid_expression' | 'out_of_range' }`
- `export const calculateTool: RunnableTool`, with name `calculate`, `readOnly: true`, schema `{ expression: string ≤ 300 }`, and a description telling the model to use it for every total, discount, deposit and quantity.

- [ ] Step 1: failing tests:
  - `calculate('2*880000 + 460000')` gives `{value:'2220000', formatted:'2.220.000'}`;
  - `'1.760.000 + 30.000'` gives `1790000`;
  - `'0.1+0.2'` gives `'0.3'`;
  - `'2220000 * 10%'` gives `222000`;
  - `'round(1234.567, 2)'`;
  - `'2 x 3'` and `'2 × 3'` give `6`;
  - `'1,5 * 2'` gives `3`;
  - rejected: `'import({}, {})'`, `'createUnit("x")'`, `'f(x)=x'`, `'[1,2]'`, `'5 cm'`, `'evaluate("1")'`, `'10^16'` (out_of_range), a 301-char string, and `'1/0'` (out_of_range).
- [ ] Step 2: implement it with the mathjs restricted-instance pattern from the spec §3, and register the tool.
- [ ] Step 3: run `npx vitest run src/modules/ai/__tests__/calculator.spec.ts src/modules/ai`, then tsc and eslint. Commit `feat(ai): add an exact calculate tool for the sales agent`.

---

## Task 2: Commerce backend — drafts, bot orders, approve, list (wave 1)

**Files (commerce module and its tests):**
- Create:
  - `commerce/domain/order-summary.ts`, the summary text builder from spec §4.4;
  - `commerce/application/bot-order.service.ts`;
  - `commerce/infrastructure/persistence/bot-order-draft.drizzle.ts`, with an in-memory twin;
  - the tests.
- Modify:
  - `commerce/application/order.service.ts`: write `created_by_kind='agent'` on staff create, add the `review` filter on list, add `itemsPreview` image/variant/unitPrice, add the `approve` method and the review count;
  - `commerce/interface/http/orders.controller.ts`, for the approve and review-count routes;
  - `commerce/api/commerce.facade.ts` and the facade impl;
  - `commerce.module.ts` and `commerce/MODULE.md`.
- Create `docs/adr/ADR-016-bot-orders.md` and add it to the index. Update `docs/05-data-model.md` §6.

**Consumes:** the Task 0 interfaces, `computeAmounts` from `@agent-sales/shared`, the existing `stockTransition`/inventory apply, the CRM facade `upsertLeadByPhone`, and the existing Vietnamese phone detector (reuse it through its public API; otherwise use a local `normalizeVnPhone` in the commerce domain).

**Behaviour:** as described in spec §4.1, §4.3, §4.5, §5 and §6.3 (approve endpoint).
- `prepareBotOrder`:
  - scopes SKUs to the bot's catalog through the existing bot catalog rules;
  - validates and computes amounts;
  - upserts the draft (one per conversation, expiring 30 min ahead);
  - returns `summaryText` and `productIds`.
- `confirmBotOrder`:
  - takes the draft in a transaction;
  - re-checks stock;
  - creates the order with `status 'new'`, `source` taken from the channel, `created_by_kind 'bot'`, `created_by_name` = botName, `review_state 'pending'`, the `conversation_id`, and history "Bot tạo đơn từ hội thoại";
  - is idempotent through `client_request_id`;
  - upserts the CRM lead.
- `approve`:
  - requires staff auth in the workspace;
  - only works on bot orders;
  - `approve:true` sets `approved` plus the reviewer and time, and writes history "Đã duyệt đơn do bot tạo";
  - `approve:false` reverts to `pending`, only within 5 s of the approval and only by the same user.
- The list `itemsPreview.imageUrl` is the product's current primary image.

- [ ] Step 1: failing tests:
  - unit tests for the summary builder (shipping fee present or absent, the note, truncation after many lines, money formatting);
  - service tests with in-memory stores for each problem code;
  - draft replacement;
  - confirm creates the expected row, reserves stock and writes history;
  - idempotent confirm;
  - expired;
  - stock changed between prepare and confirm;
  - approve and undo rules;
  - list `review=pending` and the count;
  - integration tests (testcontainers, same style as the existing commerce integration specs): forced RLS on `bot_order_drafts` (cross-tenant read and write denied) and confirm inside a real transaction.
- [ ] Step 2: implement it.
- [ ] Step 3: run `npx vitest run src/modules/commerce` plus the commerce integration specs and `test/architecture.spec.ts`, then tsc, eslint and `pnpm arch`. Commit `feat(commerce): let the bot prepare and create orders that staff review` and `docs(commerce): record bot orders (ADR-016)`.

---

## Task 3: AI order tools and prompts (wave 1)

**Files:**
- Create: `apps/backend/src/modules/ai/application/order-tools.ts` and `__tests__/order-tools.spec.ts`
- Create: prompts `packages/ai-core/prompts/sales-agent@15.md`, which is @13 plus the order and calculator guidance from spec §4.2 and §3, and `@16.md`, which is @15 plus @14's lodging section verbatim. Also `fanpage-context` stays as is.
- Modify:
  - `reply-pipeline.ts` `turnTools`: add the order tools when `bot.orderTaking`;
  - `output-tools.ts`: change the handoff description to drop "an order is ready";
  - the prompt version selection to use @15/@16;
  - the prompt snapshot test.

**Consumes:**
- the Task 0 `CommerceFacade` methods;
- `ReplyOptions.conversationId`, plus the channel kind (add `channel?: string` to `ReplyOptions` in this task if it is missing);
- the turn's `MessageSink`;
- `bot.orderTaking`, `bot.orderShippingFeeVnd` and `bot.name`.

**Behaviour (spec §4.1, §4.2, §4.6):**
- `prepare_order` (write):
  - calls `prepareBotOrder`;
  - on `ok`, the **tool itself** sends `{ text: summaryText, images: [], quickReplies: [ {title:'✅ Đặt hàng', payload:'ORDER_CONFIRM'}, {title:'✏️ Sửa thông tin', payload:'ORDER_EDIT'} ] }` through `options.sink`, or adds it to the collected output when there is no sink, so the playground shows it in `messages` with `via:'send_message'` and `quickReplies`;
  - it returns `{ok:true,status:'awaiting_customer_confirmation'}`;
  - it feeds `productIds` to focus products.
- `confirm_order` and `cancel_order_draft` are offered only when `hasBotOrderDraft` is pending and `storedAt` is before this turn started.
- Playground conversations (no real conversation) use the playground conversation key. Orders created from the playground are real orders in the workspace, flagged as bot orders; this is acceptable for owner testing.
- Logs carry only tool names and error classes.

- [ ] Step 1: failing tests with a fake `CommerceFacade` and a recording sink:
  - the tools are absent when `orderTaking` is off;
  - prepare sends exactly one sink message with both quick replies;
  - problems are returned without a send;
  - confirm is absent in the same turn and present on the next;
  - confirm ignores model args;
  - the snapshot for @15 contains "calculate" and "prepare_order", and @16 contains the lodging section.
- [ ] Step 2: implement it.
- [ ] Step 3: run `npx vitest run src/modules/ai`, build ai-core, then tsc, eslint and `pnpm arch`. Commit `feat(ai): close sales with prepare_order and confirm_order`.

---

## Task 4: Channel quick replies (wave 1)

**Files:**
- Modify:
  - `packages/channels/src/meta.ts`: outbound `quick_replies`, inbound `quick_reply.payload`, `capabilities.quickReplies = true`;
  - `packages/channels/src/website.ts`: pass quickReplies through, if not already;
  - `apps/backend/src/modules/conversation/application/jobs/reply-delivery.ts`: quick replies go on the last text bubble only;
  - the webchat delivery path if separate.
- Tests: the channels tests and the conversation delivery tests.

**Consumes:** Task 0's `OutgoingMessage.quickReplies` and the channels adapter fields.

- [ ] Step 1: failing tests:
  - the Meta send body for a text with 2 quick replies, which must match Graph's `message.quick_replies[{content_type:'text', title, payload}]`;
  - inbound parsing keeps the text and sets `quickReplyPayload`;
  - a two-bubble summary gets quick replies only on the second bubble;
  - idempotency keys are unchanged;
  - webchat outbound includes them.
- [ ] Step 2: implement it.
- [ ] Step 3: build channels; run `npx vitest run` in packages/channels and `cd apps/backend && npx vitest run src/modules/conversation src/modules/channel`, then tsc and eslint. Commit `feat(channel): send and receive quick replies on Messenger and Instagram`.

---

## Task 5: Orders list and order detail UI (wave 1, web)

**Files:**
- Create: `apps/web/src/components/ui/hover-card.tsx` (shadcn HoverCard on `@radix-ui/react-hover-card`; add the dependency), `apps/web/src/features/commerce/components/order-created-by-cell.tsx`, `order-items-hover-card.tsx`, `order-review-banner.tsx`, and tests.
- Modify:
  - `order-columns.tsx`: the "Người tạo" column is default visible and replaces `createdBy`; the product cell gets the hover card;
  - `orders-list.tsx`: the row menu gains "Duyệt đơn";
  - `orders-toolbar.tsx`: the quick filter chip with the count;
  - the order detail route component: the banner;
  - `routes/app/orders/index.tsx`: the `review` search param;
  - the commerce API hooks: approve mutation, review count;
  - `packages/i18n/src/messages/{vi,en}/common.json` (`orders.*`).

**Consumes:** Task 0 DTO fields, `POST /orders/{id}/approve` and `GET /orders/review-count`.

**Behaviour:** spec §6.1–§6.5 exactly, covering the accessibility details, the new-tab link attributes, `stopPropagation`, optimistic approve with a 5 s undo toast, reduced motion, and the image fallback.

- [ ] Step 1: failing tests (Testing Library):
  - the three cell states;
  - the link has `href="/app/inbox?conversation=…"`, `target="_blank"` and `rel` including `noopener`, and a click does not navigate the row;
  - the chip toggles `review=pending` in the URL;
  - approve calls the endpoint, shows the toast with undo, and undo calls `approve:false`;
  - the hover card opens on focus and hover, shows full names, variant, `qty × price`, the fallback icon and the total;
  - the banner shows in both states.
- [ ] Step 2: implement it, reusing the existing `Badge`, `Button`, `Tooltip` and `DropdownMenu` and the theme tokens.
- [ ] Step 3: run `cd apps/web && npx vitest run src/features/commerce --testTimeout=30000`, then tsc, eslint and `pnpm --filter @agent-sales/web build`. Commit `feat(web): review bot orders and preview order products on hover`.

---

## Task 6: Test chat quick replies and bot "Chốt đơn" settings (wave 1, web)

**Files:**
- Modify:
  - `apps/web/src/features/ai/components/test-chat.tsx` and its tests: quick-reply pills under the last bubble of the newest bot message; a click sends the title as the next customer message and removes the pills;
  - the bot settings page/form under `apps/web/src/features/bot/**`: a "Chốt đơn" section with an `orderTaking` switch and an `orderShippingFeeVnd` money input that may be empty, plus helper text "Để trống: tóm tắt đơn ghi “Phí ship: shop báo sau”";
  - i18n (`bot.settings.orders.*`, `playground.quickReplies.*`).

**Consumes:** Task 0 `PlaygroundResponse.messages[].quickReplies` and the bot settings DTO fields.

- [ ] Step 1: failing tests:
  - the pills render only on the newest bot message, and a click sends the title and hides them;
  - the settings form round-trips both fields; an empty fee becomes null.
- [ ] Step 2: implement it.
- [ ] Step 3: run `cd apps/web && npx vitest run src/features/ai src/features/bot --testTimeout=30000`, then tsc, eslint and the web build. Commit `feat(web): quick replies in the test chat and bot order settings`.

---

## Task 7: Evals and docs (wave 2, after wave 1 is merged)

**Files:**
- Create: eval cases under `apps/backend/evals/orders/` and `apps/backend/evals/calculator/`.
- Modify: `apps/backend/src/modules/ai/evals/*`, adding support for asserting tool steps (`steps_include: ['calculate']`) and an `order_tools` bot flag in case setup, if missing; `apps/backend/evals/README.md`; `docs/06-ai-engine.md`; `docs/meta-inbox.md` (quick replies); `docs/02-functional-requirements.md` (ORD-07 now built).

**Cases (critical):**
- A total for 2 items plus a percent discount uses `calculate` and states the exact figure.
- An order request missing the phone or address makes the bot ask for them before `prepare_order`.
- A complete request leads to a `prepare_order` step and a summary message with 2 quick replies.
- Replying "✅ Đặt hàng" on the next turn leads to `confirm_order` and the order code in the reply.
- Insufficient stock makes the bot offer the available quantity, with no prepare success.

- [ ] Steps: implement them; the fake eval CLI must pass all cases; run the eval spec files, then tsc. Commit `test(ai): evaluate calculator and order closing` and `docs(ai): describe bot order closing`.

---

## Controller gate (not a subagent task)

1. Merge the wave branches and run `pnpm check`.
2. Back up the dev DB, migrate 0039, and turn on `orderTaking` for TinyMind with no shipping default.
3. Deploy to the dev servers: the api/agent/webhook processes and the bridge restart.
4. Run live evals on gpt-6.1-sol (critical 100 %).
5. Run the acceptance QA agent through the playground HTTP API and orders API:
   - a full order flow on TinyMind: gather details, summary with quick replies, confirm, then check that the order exists with `bot`/`pending`/conversation link/reserved stock;
   - approve through the API;
   - review-count and list filter;
   - calculator figures.
   - No Messenger sends.
6. Run a final whole-branch review (opus), push the branch, and open a PR stacked on #99.
