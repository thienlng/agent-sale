---
id: T-149
title: Suggest the matching profile field when an FAQ repeats a profile fact
status: done
type: feature
priority: P2
owner: @agent:claude
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: batch/2026-10-29-evening
pr: main (batch 2026-10-29 evening)
parent:
---

## Context

TinyMind's FAQ table repeated facts that now live in business profile fields (shipping, returns, warranty), so the bot could see two versions after an edit.

## Goal

While the owner types an FAQ question, hint at the profile field that should hold the fact instead.

## Scope

- Topic map (diacritic-insensitive) from question phrases to profile fields, limited to the fields of the bot's industry.
- Non-blocking hint in the FAQ dialog with a button that closes the dialog and focuses that field in the business information form above the table.
- i18n vi + en, unit and component tests.

## Out of scope

- Backend changes; detecting duplicates in saved FAQs.

## Acceptance criteria

- [x] Typing a shipping question on a retail bot shows the hint; saving stays allowed
- [x] No hint for an industry without that field or a question without a topic
- [x] Button closes the dialog and focuses the field
- [x] Tests added; `pnpm check` is run by the controller
- [x] No docs impact (UI hint)

## Plan

1. `utils/faq-profile-topics.ts` with tests.
2. Hint and focus handoff in `faq-dialog.tsx`.
3. i18n keys `profile.faqHint`, `profile.faqHintGo`.

## Log

- 2026-10-29 — created and implemented.
- Decision: uses `foldVietnamese` from `@agent-sales/shared` and whole-word matching so "ship" does not match "relationship". Industry-specific topics are checked before generic ones so "nhận phòng lúc mấy giờ" is check-in, not opening hours.
- Focus handoff runs in the dialog's `onCloseAutoFocus` so it wins over Radix returning focus to the opener.

- 2026-10-29 — Independent review passed; batch gate: pnpm check — lint, arch, typecheck, backend 1245/1245, web 594/597 with 3 load timeouts in untouched channel suites that pass alone (88/88); web build 238.6 KB; e2e bot-profile, t023-training, settings-tabs, business-create 12/12. Landed on main and closed.

## Links

- Docs: docs/04-system-architecture.md, docs/11-code-structure-and-conventions.md
- Related tasks: T-106, T-144
