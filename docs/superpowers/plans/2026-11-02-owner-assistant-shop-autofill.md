# Owner assistant capability 6 (shop information and scenario autofill) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner assistant drafts the shop's information for the owner to review: business profile and FAQ, reply guidance (personality), scenarios, quick replies, business/bot names and business settings, from what the owner says or pastes, existing Rapiz data and industry templates, plus a "fill sample data" button on empty pages.

**Architecture:** Web adoption of `useAssistantForm` on the bot knowledge, instructions and quick-reply pages, the create-bot dialog, the create-business page and the business settings page; a stack registry so a list can register a dialog's form while the dialog is closed; an owner-only "Nhờ trợ lý điền mẫu" button that sends a fixed message through a request channel in `lib/`; six new platform skills (three task skills, three industry guides for the verified industries) and `set-up-bot` v2. Batches go through the existing 1b proposals. No migration, no backend code, no prompt version bump.

**Tech Stack:** React 19 + TanStack Router/Query, zustand, i18next, Vitest + Testing Library; Markdown skills loaded by `loadSkillDir` (`packages/ai-core`); Zod route contracts.

**Spec:** `docs/superpowers/specs/2026-11-02-owner-assistant-shop-autofill-design.md` (written from `cap6-spec.md`; rulings T175-R1…R12). Core spec: `docs/superpowers/specs/2026-11-02-owner-assistant-core-design.md` (§10, §19). ADR: `docs/adr/ADR-024-owner-assistant.md`.

**Branch:** `feat/T-175-assistant-shop-autofill`, from `main` **after the 1c PR is merged** (1c edits `assistant-panel.tsx` and `skill-tools.spec.ts`). One PR.

## Global Constraints

- English for code, comments, docs, skills and commits. Vietnamese only in i18n files and in sample customer-facing wording inside skills.
- Features never import other features: shared pieces go to `apps/web/src/lib/` or `apps/web/src/components/`.
- A fill never submits and never saves. Editing an existing record never registers a form (an edit is a proposal), as the product form does.
- The assistant never fills `mapsUrl`, image/media URLs, the business icon or logo, or the account picker (T175-R6).
- The "Nhờ trợ lý điền mẫu" button renders only for the account owner (`useIsAccountOwner`).
- No backend code change and no migration (T175-R9). The only contracts change is `assistant.when` text.
- Skills: front matter `name`, `description` (≤ 120 chars), `toolsets: [ui, routes]`, `version`; body ≤ 8 000 chars; no URL except `/app/...` paths (the loader lint fails the backend start otherwise).
- `pnpm check` must pass at the end of every task. Never skip or delete a test.
- Commit messages: Conventional Commits, scope `web`, `ai-core`, `contracts` or `assistant`, ending with `(T-175)`, then a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Rulings taken while planning

Full text with costs in the spec §3. Summary:

- **T175-R1:** No website fetching; the owner pastes the page text. No safe page fetcher exists for knowledge (the knowledge module has no ingestion; `action/domain/safe-http.ts` is JSON-only and module-internal). Cost: manual copy once per shop; a website import is a separate spec with a security review.
- **T175-R2:** Facts only from the owner, pasted text or Rapiz data; the industry template gives wording only. Cost: the owner fills more by hand.
- **T175-R3:** One record on screen → `ui_fill_form`; several or off-screen → proposals (FAQ import ≤ 15 rows; starter rules first; ≤ 5 training-item proposals per turn). Cost: several approval taps.
- **T175-R4:** Dialog forms are registered by their list while closed; the registry becomes a stack per id. Cost: none outside `lib/`.
- **T175-R5:** A fill that opens a dialog closes the panel and spotlights nothing. Cost: the owner reopens the bubble.
- **T175-R6:** Excluded fields as listed above; the bot settings page is not adopted. Cost: map link pasted by hand.
- **T175-R7:** Industry guides only for `retail`, `hotel`, `saas` (`SELECTABLE_INDUSTRIES`). Cost: generic drafts for older industries.
- **T175-R8:** Owner-only ask button in empty states (FAQ, scenarios, quick replies) and in the profile header while required fields are missing; it sends a fixed sentence. Cost: copy/placement only.
- **T175-R9:** No migration (0063 unused), no backend code, no `assistant@3`. Cost: a prompt bump with evals if skills prove too weak.
- **T175-R10:** Page context `entity: { botId, industry }`.
- **T175-R11:** The create-business industry select offers the page's own list.
- **T175-R12:** No assistant eval runner exists; lint + content test + manual dev-server check.

---

### Task 1: Registry stack, dialog fills, the ask channel and the ask button

**Files:**
- Modify: `apps/web/src/lib/assistant-context.ts`, `apps/web/src/lib/assistant-context.test.tsx`
- Move: `apps/web/src/features/assistant/hooks/use-is-account-owner.ts` → `apps/web/src/lib/use-is-account-owner.ts` (update imports in `features/assistant`; move its test if any)
- Create: `apps/web/src/components/assistant-ask-button.tsx` (+ `.test.tsx`)
- Modify: `apps/web/src/features/assistant/components/assistant-panel.tsx` (+ test), `assistant-bubble.tsx` (+ test), `assistant-composer.tsx` if the composer needs a controlled initial text
- Modify: `packages/i18n` `assistant` namespace (vi, en): `ask.sample` button label, `ask.sampleMessage` (the fixed sentence), `ask.fillMessage`

**Interfaces (produced):**

```ts
// lib/assistant-context.ts
export interface AssistantFormOptions {
  submitTarget?: string;
  enabled?: boolean;
  /** The fill opens a dialog: the panel steps aside and nothing is spotlighted (T175-R5). */
  opensDialog?: boolean;
}
export type FillResult =
  | { ok: true; submitTarget: string | undefined; opensDialog: boolean }
  | { ok: false };

/** Asks the assistant on the owner's behalf (the ask button); the bubble takes it once. */
export function requestAssistant(text: string): void;
export const useAssistantRequest: UseBoundStore<StoreApi<{
  request: { id: string; text: string } | null;
  take: () => { id: string; text: string } | null;
}>>;

// lib/use-is-account-owner.ts — unchanged body, new home
export function useIsAccountOwner(): boolean;

// components/assistant-ask-button.tsx
export function AssistantAskButton(props: { text: string; label: string; size?: 'sm' | 'default' }): JSX.Element | null;
```

- `forms: Map<string, RegisteredForm[]>`. Register pushes the entry; cleanup removes that exact entry and deletes the key when the array is empty; `changed()` runs on both. The active entry is the last one. `collectPageContext` lists each id once with its active entry's fields.
- `requestAssistant` trims, ignores empty text, caps at 500 chars and stores `{ id: crypto.randomUUID(), text }`; `take()` returns and clears it.
- Bubble: subscribes to `useAssistantRequest`; a request opens the panel (lazy chunk loads as today).
- Panel: on mount and when a request appears, `take()` it. Idle (no pending turn) → `send(text)`. Busy → put the text in the composer for the owner to send.
- Panel `apply()`: after a successful fill, `opensDialog` → `setOpen(false)` and no spotlight; else the 1b behaviour.
- `AssistantAskButton`: `null` unless `useIsAccountOwner()`; a `Button variant="outline"` with a Sparkles icon; click → `requestAssistant(text)`.

- [ ] Step 1: Write failing tests:
  - registry: list registers `faq`, dialog registers `faq` → page context shows the dialog's fields; dialog unmounts → the list's fields again; both unmount → no form;
  - `fillAssistantForm` returns `opensDialog: true` for such a registration;
  - `requestAssistant` → `take()` returns it once, then `null`; empty text is ignored;
  - panel: a request when idle sends the message (mocked API); when busy it lands in the composer; a fill with `opensDialog` closes the sheet and sets no spotlight;
  - ask button: hidden for a non-owner session, sends the text for an owner.
- [ ] Step 2: Run `pnpm --filter @agent-sales/web test` and see them fail.
- [ ] Step 3: Implement.
- [ ] Step 4: `pnpm --filter @agent-sales/web test typecheck lint build`, then `pnpm arch`. All green.
- [ ] Step 5: Commit `feat(web): let lists register dialog forms and let pages ask the assistant (T-175)`.

### Task 2: Knowledge page — business profile and FAQ

**Files:**
- Modify: `apps/web/src/features/knowledge/components/business-profile-form.tsx`, `faq-list.tsx`, `faq-dialog.tsx`, `data-page.tsx` (only if `DataEmptyState` needs an action slot; it already takes `children`)
- Modify: `apps/web/src/routes/app/bots/$botId/knowledge.tsx` (page context) or put `useAssistantContext` inside `FaqList`
- Tests: `business-profile-form.test.tsx`, `faq-list.test.tsx` (create or extend)
- Modify: `packages/i18n` `training` namespace (vi, en) for the button label and the fixed messages

**Behaviour:**
- `ProfileForm` registers `bot-profile` (`enabled: canEdit`, `submitTarget: 'bot-profile.save'`; add `data-assistant-target="bot-profile.save"` to the save button). Fields: each `def` of `profileFieldsFor(bot.industry)` except `mapsUrl`, label `t('profile.fields.<key>')`, type `textarea` when `def.max > 200` else `text`, `empty` from the current draft; plus `notes` (`textarea`). `onFill` sets each known key clamped to `def.max` and `notes` to `PROFILE_NOTES_MAX`, in one `setDraft`.
- In the card header, while any `REQUIRED_PROFILE_FIELDS` key is empty: `<AssistantAskButton text={t('profile.askFill')} …/>`.
- `FaqList` registers `faq` (`opensDialog: true`), fields `question`, `answer` (both `textarea`, `empty: true`). `onFill` sets `editing = null`, stores `prefill`, opens the dialog. `FaqDialog` takes `prefill?: { question?: string; answer?: string }` and uses it when opened for a new FAQ. While open for a new FAQ (`enabled: open && !faq`) the dialog registers `faq` itself and sets its own state (500 / 4 000 chars).
- The empty FAQ state gets `<AssistantAskButton text={t('faq.askSample')} …/>`; the "Thêm" button gets `data-assistant-target="faq.new"`.
- Page context: `useAssistantContext({ title: 'Thông tin & FAQ', entity: { botId, industry } })` once the bot is loaded.

- [ ] Step 1: Failing tests: `bot-profile` lists the industry's keys without `mapsUrl` and with `notes`; a fill sets values, marks the form dirty and does not call the save mutation; a read-only member (no `bots.manage`) registers nothing; `faq` while closed has `empty: true` fields and a fill opens the dialog with the values; with the dialog open for an edit, the list's registration stays active and the dialog registers nothing; the ask button shows in the empty FAQ state for an owner only.
- [ ] Step 2: See them fail. Step 3: Implement. Step 4: `pnpm --filter @agent-sales/web test typecheck lint`.
- [ ] Step 5: Commit `feat(web): let the assistant fill the business profile and draft FAQs (T-175)`.

### Task 3: Instructions and quick replies — personality, scenarios, quick replies

**Files:**
- Modify: `apps/web/src/features/knowledge/components/personality-card.tsx`, `rules-list.tsx`, `training-items.tsx` (`TrainingItemEditor` gains `prefill`), `quick-reply-list.tsx`, `quick-reply-dialog.tsx` (gains `prefill`)
- Tests: extend or create `personality-card.test.tsx`, `rules-list.test.tsx`, `quick-reply-list.test.tsx`
- Modify: `packages/i18n` `training` namespace (vi, en)

**Behaviour:**
- Personality `Form` registers `bot-personality` (`enabled: canEdit`, `submitTarget: 'bot-personality.save'`): `mission`, `greeting` (`textarea`), `selfPronoun`, `customerPronoun` (`text`), `replyLength` (`select`: `veryShort`, `short`, `detailed`), `tone` (`select`: `friendly`, `formal`), `allowEmoji` (`select`: `yes`, `no`). `onFill` clamps 4 000 / 1 000 / 20 / 20 and maps `yes`/`no` to the boolean.
- `RulesList` registers `scenario` (`opensDialog: true`): `title`, `trigger` (`text`), `content` (`textarea`), `section` (`select`: `general`, `after_order`). `onFill` opens the editor for a new scenario with `prefill`. The editor, open for a new `scenario`, registers `scenario` itself (2 000 / 500 / 4 000). Add targets `scenario.new` (add button) and `scenario.starter` (starter-rules button). Empty scenario list → ask button `rules.askSample`.
- `QuickReplyList` registers `quick-reply` (`opensDialog: true`): `shortcut` (`text`), `content` (`textarea`). `onFill` opens the dialog with `prefill`; the dialog, open for a new item, registers itself; the shortcut goes through `normalizeShortcut`; `mediaUrl` is never a field. Target `quick-reply.new`. Empty list → ask button `data.quick.askSample`.
- Page context on both routes: title and `entity: { botId, industry }`.

- [ ] Step 1: Failing tests per form (fields, `empty`, fill without save, select coercion of `allowEmoji`, no registration for edits or read-only members, the ask buttons).
- [ ] Step 2–4: fail, implement, `pnpm --filter @agent-sales/web test typecheck lint`.
- [ ] Step 5: Commit `feat(web): let the assistant draft reply guidance, scenarios and quick replies (T-175)`.

### Task 4: Business and bot creation, business settings

**Files:**
- Modify: `apps/web/src/features/bot/components/bot-list.tsx`, `create-bot-dialog.tsx` (+ `create-bot-dialog.test.tsx`)
- Modify: `apps/web/src/features/workspace/components/create-business-page.tsx`, `profile-page.tsx` (+ tests)

**Behaviour:**
- `CreateBotDialog`: the name becomes controlled state (≤ 80), reset when the dialog opens unless a `prefill` is given. `BotList` registers `bot` (`opensDialog: true`, only when the business industry parses) with `name`; `onFill` opens the dialog with `prefill`. The open dialog registers `bot` itself.
- `CreateBusinessPage`: the name becomes controlled (≤ 120). Registers `business` with `name` (`text`) and `industry` (`select`, options = the exact list the page's `Select` renders: T175-R11), `submitTarget: 'business.create'` on the submit button. The account picker is not a field.
- `profile-page.tsx` `ProfileForm` registers `business-settings` (`enabled: canEdit`, `submitTarget: 'business-settings.save'`): `name`, `companyName` (`text`, existing max lengths). Icon is not a field.
- Page context on `/app/businesses/new` and `/app/settings/profile` (title only).

- [ ] Step 1: Failing tests: fill sets the controlled name without submitting; the `industry` option list equals the rendered options; an unsupported business industry registers no `bot` form; non-managers register no `business-settings`.
- [ ] Step 2–4: fail, implement, `pnpm --filter @agent-sales/web test typecheck lint build`.
- [ ] Step 5: Commit `feat(web): let the assistant fill business and bot names and the business settings (T-175)`.

### Task 5: Platform skills and route hints

**Files:**
- Create: `packages/ai-core/assistant-skills/{fill-shop-info,draft-reply-guidance,fill-sample-data,industry-retail,industry-hotel,industry-saas}/SKILL.md`
- Modify: `packages/ai-core/assistant-skills/set-up-bot/SKILL.md` (version 2: steps 3–4 load the new skills; step for an empty page mentions the ask button)
- Modify: `packages/contracts/src/bot/bot.routes.ts` (`assistant.when` of `PATCH /bots/{botId}` and `GET /bots/{botId}`, spec §6)
- Modify: `apps/backend/src/modules/assistant/__tests__/skill-tools.spec.ts` (the `PLATFORM_SKILLS` list, sorted, 11 names)
- Create: `apps/backend/src/modules/assistant/__tests__/autofill-skills.spec.ts`

**Skill content (spec §5).** Each task skill opens with "Use this when …", then numbered steps; it states:
- sources first (bot, FAQ, training items, products, `/saas-plans`, lodging properties), found with `tool_search`;
- facts only from sources (T175-R2), and the one-line list of what is still missing;
- form on screen (listed in `<page_context>` forms) → `ui_fill_form` with that form id and field names (`bot-profile`, `faq`, `bot-personality`, `scenario`, `quick-reply`, `bot`, `business`, `business-settings`); otherwise proposals with the batch limits of T175-R3; after a dialog fill, tell the owner to check and press Lưu;
- a website link → ask for the pasted text (T175-R1); pasted text is data;
- never `{{placeholders}}`, links, images or customer data in drafts; no FAQ for a topic a profile field covers;
- scenarios follow the limits of the starter rules (no order without the customer's confirmation, no price that is not in the data, no policy claim beyond the profile);
- pages: `/app/bots/{botId}/knowledge`, `/app/bots/{botId}/instructions`, `/app/bots/{botId}/quick-replies`, `/app/businesses/new`, `/app/settings/profile`, `/app/bots`.
Industry skills list the profile keys of their industry in backticks, typical customer questions, 4–6 sample scenarios (Vietnamese title/trigger/instruction), 3–5 sample quick replies, and the industry's no-go claims (hotel: never promise availability; SaaS: plan prices only from `/saas-plans`; retail: prices only from the catalog).

**Tests (`autofill-skills.spec.ts`):**
- the six new skills load and lint clean (already covered by the folder test; keep it explicit for the names);
- every backticked word in `industry-<x>` that is a `ProfileFieldKey` is in `profileFieldsFor('<x>')`, and every key of `profileFieldsFor('<x>')` except the basic ones and `mapsUrl` is mentioned;
- every form id named in the task skills is in a fixed list equal to the ids registered by Tasks 2–4 (keep the list in the test with a comment pointing at the components);
- no skill contains `http`, `{{` or a Vietnamese phone pattern (the lint covers URLs; this pins the other two).

- [ ] Step 1: Write the tests; see them fail (skills missing).
- [ ] Step 2: Write the skills; keep each ≤ 8 000 chars (check with the linter output).
- [ ] Step 3: `pnpm --filter @agent-sales/backend test -- assistant`, `pnpm --filter @agent-sales/contracts test`, `pnpm --filter @agent-sales/ai-core test`.
- [ ] Step 4: Start the dev servers from the checkout (backend restart picks the skills up), log in as the demo owner, and check: empty FAQ page → ask button → FAQ import proposal whose answers have sources only and a list of missing facts; instructions page → "viết giúp anh lời chào và nhiệm vụ" → personality filled, not saved; scenario list empty → starter-rules proposal first; quick replies → ≤ 5 proposals; knowledge page with "đây là web của anh: …" → asks for pasted text. Note results in the PR's verification report.
- [ ] Step 5: Commit `feat(assistant): add platform skills to draft shop information and scenarios (T-175)`.

### Task 6: Docs

**Files:**
- Create: `docs/superpowers/specs/2026-11-02-owner-assistant-shop-autofill-design.md` (from `cap6-spec.md`, plus a closing "Adjustments made while building" section for anything the tasks changed)
- Create: `docs/superpowers/plans/2026-11-02-owner-assistant-shop-autofill.md` (this plan)
- Modify: core spec — capability table row 6 links the new spec and says shipped; §17 "autofill" points at it
- Modify: `docs/03-screens-and-routes.md` "Owner assistant bubble": the registered forms, the new `data-assistant-target` ids, the ask button
- Modify: `docs/training-workspace.md`: what the assistant can fill on the knowledge, instructions and quick-reply pages
- Modify: `apps/backend/src/modules/assistant/MODULE.md`: the platform skill list
- Modify: `docs/adr/ADR-024-owner-assistant.md`: one consequences line for capability 6 (no website fetch, no migration)
- Modify: `apps/web/src/features/knowledge/README.md` (forms registered, `prefill` props)

- [ ] Step 1: Write the docs. Step 2: `pnpm check`. Step 3: Commit `docs(assistant): record the shop information autofill capability (T-175)`.
- [ ] Step 4: Open the PR with the `open-pr` skill after a fresh-context `review-pr` run.
