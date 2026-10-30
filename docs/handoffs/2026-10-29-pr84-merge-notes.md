# Merging PR #84 (lane A2) onto current main — notes

Date: 2026-10-29. Audience: the maintainer rebuilding `feat/T-124-integrate-lane-a2` (PR #84). Written by @agent:claude; nothing on the PR branch was changed.

## Why there are conflicts

PR #84 branches from `0859328` (A1). Since then `main` landed, at the owner's request and without waiting for #84:

- T-132 inbox bot/time filters; T-133 soft page removal (migration 0033); T-142 reconnecting a removed page in another business (migration 0034).
- T-137…T-143 bot training redesign: per-bot structured business profile (`BotSettings.profile`, `replyLength`, `tone`, `allowEmoji`), prompt `sales-agent@9`, new "Thông tin doanh nghiệp" and "Hướng dẫn trả lời" screens, backfill CLI, readiness by profile. Spec: `docs/superpowers/specs/2026-10-29-bot-training-redesign-design.md`.
- T-144 business creation from the selector (dialog with template cards) and a simplified business settings page; settings tab strips fixed. Task file: `todo/done/T-144-create-businesses-and-simplify-business-settings.md`.

The owner decided (2026-10-29): industry/template belongs to the business; business facts belong to each bot; TinyMind and Villas are two businesses.

## Conflicting files (from `git merge-tree origin/main origin/feat/T-124-integrate-lane-a2`)

| File | main has | #84 has | Suggested resolution |
|---|---|---|---|
| `apps/web/src/components/layout/business-selector.tsx` | "+ Tạo business" action opening `CreateBusinessDialog` (render prop from `routes/app.tsx` → `AppShell` → `AppSidebar`) | `BusinessAvatar` in trigger and rows, links "Quản lý tài khoản" (`/app/overview`) and "Tạo business" (`/app/businesses/new`) | Keep #84's avatars and the account link; keep main's dialog for "Tạo business" (one create path from the selector). Drop the duplicate create link. |
| `apps/web/src/components/app-shell.tsx` | passes `createBusinessDialog` prop | account-level layer / sidebar changes | Keep both props. |
| `apps/web/src/features/workspace/api/create-business.ts` (add/add) | `useCreateBusiness` used by the dialog: POST `/workspaces`, `reloadSession`, `useBusinessSwitch().choose` | hook used by `create-business-page.tsx`, supports `accountId` for multi-account owners | Merge into one hook that accepts an optional `accountId`; both the dialog and the welcome/page flow use it. Add the account picker to the dialog when `session.accounts` has more than one owned account (main's dialog lacks it — known gap). |
| `apps/web/src/features/workspace/api/profile.ts` | on rename: set profile cache, invalidate `workspaceKeys.current`, `reloadSession()` | T-108 "show a renamed business in the selector without a reload" | Same intent; keep one implementation (main's covers selector, header and portfolio via session memberships). |
| `apps/web/src/features/workspace/components/profile-page.tsx` | single card: logo, one name field, read-only template summary, collapsible company name; `businessServices`/`productDescription` removed from the form (deprecated, not read by the AI); link to bot "Thông tin doanh nghiệp" | icon picker (`BUSINESS_ICONS`) added to the old form | Put #84's icon picker into main's single card next to the logo; do not re-add the two removed textareas. Keep main's test that the PATCH body omits them. |
| `apps/backend/src/modules/bot/domain/bot.ts` | profile merge, deep defaults, readiness by profile + answerable FAQs | catalog selection (`catalogMode`, bot products) | Independent features: keep both. Re-run `src/modules/bot` tests. |
| `apps/backend/src/modules/bot/MODULE.md` | profile/readiness text | catalog selection text | Keep both paragraphs. |
| `packages/i18n/src/messages/{vi,en}/common.json` | `business.create.*`, template descriptions, settings strings | `business.*` (welcome, account), icon names | Union of keys; where both define `business.create.*`, prefer main's dialog strings and keep #84's welcome/page strings. |
| `TODO.md` | T-132…T-145 lines (Done/In progress) | A2 lines (T-079, T-080, T-126…T-129, T-124) | Keep all lines. |

Auto-merged but worth a look: `apps/backend/src/modules/ai/application/playground.service.ts` (main: @9, profile block; #84: catalog per bot), `packages/contracts/src/bot/bot.schema.ts` (main: profile/style; #84: catalog mode), `apps/web/src/routes/app.tsx`, `apps/web/e2e/business-industry.spec.ts`, `apps/web/e2e/statistics-home.spec.ts`.

## Ids and migrations

- Task ids: main uses T-132…T-145. #84's T-126…T-129 (and T-130 on `build/T-130-i18next-26`) are free on main — keep them. The unmerged Codex branch `fix/T-126-web-acceptance` also used T-126…T-131 locally; those are being renumbered on main's side, not #84's.
- Migrations: #84 adds `0029_bot_catalog_selection` and `0032_workspace_icon`; main has `0033`, `0034`. The runner records files by name, so applying 0029/0032 after 0033/0034 on existing databases is fine. Do not renumber.

## After resolving

`pnpm check`, then the e2e suites for business selection/creation (`business-create`, `business-industry`, `statistics-home`), bot training (`bot-profile`, `t023-training`) and `settings-tabs`.
