---
id: T-121
title: Move the marketing site into apps/site and link it with the dashboard
status: in-progress
type: feature
priority: P1
owner: '@agent:claude'
feature_ids: []
created: 2026-10-28
updated: 2026-10-28
branch: feat/T-120-header-account-menu
pr:
parent:
---

## Context

The Rapiz landing page was built in a separate repository (`ai-sale-landingpage`, Astro, one
commit). ADR-009 and docs/04 already place the marketing site at `apps/site` (Astro, static,
root domain) with the dashboard at `app.<domain>`. Owner request 2026-10-28: merge it into this
repo, delete the standalone folder, and connect the two the usual SaaS way (landing header:
"Đăng nhập" + "Dùng thử miễn phí"; inside the app the logo stays in the app; the marketing site
is reachable from the account menu and from the sign-in pages).

## Goal

`apps/site` builds and is tested inside the monorepo, and the site and dashboard link to each other.

## Scope

- In scope: copy the site (src, public, fonts, images) into `apps/site` as `@agent-sales/site`;
  `PUBLIC_APP_URL` links (header, hero, closing section, demo dialog, footer, phone menu);
  copy that claimed "no sign-up" updated; port the standalone verify scripts to Playwright
  (`apps/site/e2e`); typecheck script; design records to `docs/designs/T-121/`; sign-in page
  logo links to the site (`VITE_SITE_URL`); lint/format ignores for Astro's generated types; a `site` CI job (build + Playwright), mirroring the `web` job;
  docs/11 tree; delete the standalone folder (its GitHub remote stays as an archive).

## Out of scope

- "Vào trang quản lý" for signed-in visitors on the site (needs a shared session hint across domains).
- Deploy pipeline for the site (T-008), blog/docs content collections, Tailwind tokens on the site.
- Visual redesign of the landing page.

## Acceptance criteria

- [x] `pnpm --filter @agent-sales/site build` produces static `dist/`; typecheck passes.
- [x] Header shows "Đăng nhập" (→ `<app>/login`) and "Dùng thử miễn phí" (→ `<app>/signup`); phones keep one CTA (≥44 px) and move log-in into the menu.
- [x] Hero, closing section and demo dialog offer the free trial; demo stays a secondary action.
- [x] Ported browser checks pass (tabs, keyboard, dialog, FAQ, 5 widths, sticky header, reduced motion, theme persistence/sync/blocked storage).
- [x] Dashboard links back: account menu row and the sign-in page logo.
- [x] Standalone folder removed after confirming its only commit is on GitHub.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (apps/site/README.md, docs/11, docs/designs/T-121, apps/web/README.md)

## Plan

1. Copy, package as `@agent-sales/site`, wire `src/lib/app-links.ts`.
2. Update CTAs and copy; `src/styles/app-links.css` for the new header/phone elements.
3. Playwright config (`astro preview --ignore-lock` on :4322) and `e2e/landing.spec.ts`.
4. Docs, dev server on :4321 (logs in `.dev-logs/site.log`), delete the old folder.

## Log

- 2026-10-28 — created; owner asked to merge the landing page and delete the external copy.
- 2026-10-28 — Astro 7 `preview`/`dev` keep a lock file and report "already running" instead of starting; Playwright uses `--ignore-lock`.
- 2026-10-28 — fonts: `packages/ui` on `main` has no typography/fonts, so the site keeps its committed WOFF2 copy; the old sync script was dropped.
- 2026-10-28 — fresh-context QA agent review: accept with fixes. Fixed: site browser checks now run in CI (`site` job); font checks restored as `e2e/fonts.spec.ts` (checksums vs SOURCES.json, OFL licences, no Google Fonts requests, Fraunces renders); unused Plus Jakarta Sans preload removed (page is set in Fraunces); unit test for the sign-in logo link; design-records README wording. Not changed: desktop header CTA is 40 px (phones get 44 px), the phone menu toggle keeps its original 21 px width.
- 2026-10-28 — verified: `pnpm check` green (3 pre-existing lint warnings); site `typecheck`, `build`, 8/8 Playwright; dev server on :4321 serves links to the local app.

## Links

- Docs: docs/adr/ADR-009-tech-stack-for-speed-and-scale.md, docs/04-system-architecture.md
- Related tasks: T-120 (account menu "Trang chủ Rapiz" row), T-008 (deploy)
