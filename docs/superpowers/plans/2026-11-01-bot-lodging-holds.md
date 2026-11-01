# Lodging part 3 (bot availability, quotes and holds) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Hotel bots check the real calendar, quote exact totals, suggest alternatives and place expiring holds that staff confirm.

**Architecture:** Rules live in the `lodging` module behind a new bot facade (draft table, server-built summary, confirm through the existing booking path). The `ai` module gets `hold-tools.ts` modelled on `order-tools.ts`; prompt `sales-agent@18`. Web shows bot holds for review.

**Spec:** `docs/superpowers/specs/2026-11-01-bot-lodging-holds-design.md` (binding; read fully).

## Global Constraints

- Branch `feat/T-161-bot-lodging-holds` stacked on `feat/T-160-lodging-calendar`, worktree `/home/kenknight/Workspace/agent-sale-lodging`. Never touch `/home/kenknight/Workspace/agent-sale`.
- Dev servers (api/agent/web) run from this worktree in watch mode; keep code compiling; apply migrations with `pnpm db:migrate` (additive only).
- Migration number **0043** (0040–0042 taken). ADR number **ADR-019**.
- `lodging` must not import `ai` or `commerce`; `ai` imports only `lodging/api`.
- The model never sets prices, totals, weekdays or availability; every number and weekday label it states comes from a tool result.
- No cost prices and no property `internal_note` ever reach the bot.
- Events/logs carry no guest name/phone.
- English code/docs; Vietnamese only in i18n and in server-built customer-facing summary strings (kept in one domain file).
- TDD; `pnpm check` green before PR; subagents use `model: "opus"`; commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Lodging bot facade, drafts, review state (backend)

**Files:** `packages/db/migrations/0043_lodging_bot_holds.sql`, `packages/db/src/schema/lodging.ts`; `apps/backend/src/modules/lodging/domain/hold-summary.ts` (+spec), `domain/availability-ranking.ts` (+spec); `application/bot-hold.service.ts`, `application/ports/lodging-store.ts` (draft + review methods), `infrastructure/persistence/*`; `api/lodging.facade.ts` (+ `LODGING_BOT_FACADE`, types), `api/index.ts`; `interface/http/bookings.controller.ts` (`GET /lodging/bookings/review-count`, `source` filter); contracts additive (`BookingListQuery.source`, `ReviewCount`, `BookingDto.reviewedAt`); integration spec `apps/backend/test/lodging-bot-holds.integration.spec.ts`.

**Produces (exact):**
```ts
export const LODGING_BOT_FACADE = Symbol('LODGING_BOT_FACADE');
export interface BotAvailabilityInput { botId: string; checkIn: string; checkOut: string; adults: number; childAges: number[]; propertyId?: string }
export interface BotAvailabilityOption { propertyId: string; code: string; name: string; whole: boolean; unitNames: string[]; fits: boolean; overStandard: boolean; totalSell: number | null; nightly: { date: string; weekdayLabel: string; label: string; sell: number }[]; surcharges: { kind: 'extra_adult' | 'extra_child'; persons: number; nights: number; sell: number }[] }
export interface BotAvailabilityResult { nights: number; checkInWeekdayLabel: string; checkOutWeekdayLabel: string; requestedFull: boolean; options: BotAvailabilityOption[]; problems: ('past_date' | 'too_long' | 'not_sold')[] }
export interface PrepareBotHoldInput { botId: string; conversationId: string; contactId?: string | null; channel: string; propertyId: string; whole: boolean; unitIds?: string[]; checkIn: string; checkOut: string; adults: number; childAges: number[]; guestName: string; guestPhone: string; note?: string }
export type HoldProblem = 'missing_name' | 'missing_phone' | 'invalid_phone' | 'not_available' | 'not_sold' | 'over_max' | 'missing_rate' | 'past_date' | 'too_long';
export type PrepareBotHoldResult = { status: 'ready'; summary: string; holdMinutes: number } | { status: 'problems'; problems: HoldProblem[]; alternatives: BotAvailabilityOption[] };
export type ConfirmBotHoldResult = { status: 'held'; code: string; holdExpiresAt: string } | { status: 'expired' | 'no_draft' | 'price_changed' | 'not_available'; alternatives: BotAvailabilityOption[] };
export interface LodgingBotFacade {
  checkAvailabilityForBot(ws: WorkspaceId, input: BotAvailabilityInput): Promise<BotAvailabilityResult>;
  prepareBotHold(ws: WorkspaceId, input: PrepareBotHoldInput): Promise<PrepareBotHoldResult>;
  confirmBotHold(ws: WorkspaceId, input: { conversationId: string }): Promise<ConfirmBotHoldResult>;
  cancelBotHoldDraft(ws: WorkspaceId, input: { conversationId: string }): Promise<void>;
  hasBotHoldDraft(ws: WorkspaceId, conversationId: string): Promise<{ pending: boolean; storedAt: Date | null }>;
}
```
Rules: spec §3 exactly. Draft TTL 30 min (expired draft → `expired`, deleted). Confirm locks the draft row, re-quotes, compares a sha256 of (selection, party, totals) to the stored hash (`price_changed`), then creates the booking via the existing `BookingService` create path (status `hold`, source `bot`, `clientRequestId` = uuid v5/v7 derived deterministically from the draft id so a retry replays) and deletes the draft in the same tx. NIGHTS_TAKEN → `not_available` with alternatives computed in a fresh tx. Review: `reviewed_at/by` set by any staff status action or edit on a bot booking; `review-count` = bot holds with `status='hold' AND reviewed_at IS NULL`. Weekday labels Vietnamese ("Thứ Hai"… "Chủ Nhật") from a domain table, never from the model.

- [ ] Tests first (domain summary + ranking; integration: availability with/without propertyId and alternatives; prepare problems; prepare→confirm happy path creates hold with source bot and expiry; confirm after another booking took the nights → not_available + alternatives; rate change between prepare and confirm → price_changed; expired draft; RLS; review-count + reviewed_at on staff confirm; no cost / internal_note in any result).
- [ ] Implement; run lodging unit/integration, http.spec, architecture.spec, typecheck, `pnpm arch`, eslint; `pnpm db:migrate` on dev; commit `feat(lodging): bot availability, hold drafts and review state (T-161)`.

### Task 2: AI hold tools + prompt @18 + evals

**Files:** `apps/backend/src/modules/ai/application/hold-tools.ts` (+ `__tests__/hold-tools.spec.ts`), generalise helpers in `order-tools.ts` (`keepSummaryLast(decision, sent, confirmPayload)`, `announceCreated(decision, {code, line, …})`) without changing retail behaviour, `playground.service.ts` wiring (hotel bots: `check_availability` always; `prepare_hold`/`confirm_hold`/`cancel_hold_draft` when `bot.orderTaking`), `ai.module.ts` (inject `LODGING_BOT_FACADE`), `packages/ai-core/prompts/sales-agent@18.md` (copy @17, change lodging bullets per spec §4), `PROMPT_LODGING` → 18, evals `apps/backend/evals/lodging/*.yaml` (group `lodging-holds`, 6 cases from spec §4) and eval fakes in `apps/backend/src/modules/ai/evals/*` for the lodging bot facade, `docs/06-ai-engine.md`, ai `MODULE.md`.

Rules: quick replies `{ title: '✅ Giữ chỗ', payload: 'HOLD_CONFIRM' }`, `{ title: '✏️ Sửa thông tin', payload: 'HOLD_EDIT' }`; the summary is sent through the message sink exactly like the order summary; confirm/cancel tools offered only when `confirmableDraft` (generalised to take a `hasDraft` function) says the customer answered after the summary; one summary per turn; the held code + expiry announced exactly once ("Dạ em đã giữ chỗ {code} đến {HH:mm} ngày {dd/MM} ạ. Nhân viên sẽ gọi xác nhận sớm ạ." — time formatted in Asia/Ho_Chi_Minh in code). `check_availability` input: `{checkIn, checkOut, adults, childAges?, propertyCode?}` (the model passes the property code it saw; the tool maps code → id via the lodging catalog), output JSON passes through the facade result minus ids.

- [ ] Tests first (gating, summary-last, announce-once, retail unchanged, hotel without orderTaking only has check_availability, prompt version 18), offline evals green; live evals `--group lodging-a17` and `--group lodging-holds` run and recorded.
- [ ] Commit `feat(ai): hotel bots check availability and place holds (T-161)`.

### Task 3: Web review surface + docs + ADR-019

**Files:** `apps/web/src/features/lodging/*` (bookings table badge "Bot tạo", holds tab count, `source` filter, sheet hint + "Mở hội thoại", sidebar Booking count via `GET /lodging/bookings/review-count`, i18n vi/en), `docs/adr/ADR-019-bot-lodging-holds.md` + README row, `docs/lodging.md` (bot section), `docs/03-screens-and-routes.md`.

- [ ] Tests first (badge, count, filter, hint), implement, web vitest/typecheck/eslint/build (<250 KB initial).
- [ ] `pnpm check` green; final whole-branch review; push; open PR (base `feat/T-160-lodging-calendar` until #103 merges, then main).
