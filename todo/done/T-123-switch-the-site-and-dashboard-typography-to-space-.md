---
id: T-123
title: Switch the site and dashboard typography to Space Grotesk with JetBrains Mono accents
status: done
type: feature
priority: P1
owner: '@agent:claude'
feature_ids: []
created: 2026-10-28
updated: 2026-10-28
branch: feat/T-123-space-grotesk-fonts
pr: none (pushed directly to main, owner request)
parent:
---

## Context

Owner liked the type pairing of reelcrew.io (Space Grotesk for text and headings, JetBrains Mono
for small uppercase labels and terminal-like details) and asked to use it on both the landing
page and the app (2026-10-28). Both fonts are SIL OFL 1.1 (free for commercial use; keep the
licence with the files). While checking, the dashboard turned out to declare Be Vietnam Pro but
never load it (no `@fontsource` import), so it rendered in the OS fallback font.

## Goal

The site and the dashboard render Space Grotesk text and JetBrains Mono labels from self-hosted
files, with Vietnamese subsets, and the licences are published.

## Scope

- In scope: `packages/ui` font tokens (`--font-sans`, `--font-heading`, `--font-mono`);
  `apps/web` loads `@fontsource-variable/space-grotesk` + `jetbrains-mono` (drops the unused
  `@fontsource/be-vietnam-pro`); sidebar section labels in mono uppercase; site typography and
  display headings (700, tightened), mono eyebrow/labels; site drops Fraunces/Plus Jakarta files;
  OFL notices and licence texts (`/licenses/`); tests; docs.

## Out of scope

- Colour or layout changes; dark-first redesign in the style of reelcrew.io.

## Acceptance criteria

- [x] Dashboard body, headings and controls compute to Space Grotesk and the files load (no OS fallback).
- [x] Sidebar section labels and existing `font-mono` spots use JetBrains Mono.
- [x] Landing headings/text in Space Grotesk (headings bold); eyebrow, "Demo", chat date, bot name and channel panel title in mono uppercase.
- [x] Vietnamese text renders from the Vietnamese subset; no third-party font requests.
- [x] OFL notices in both apps; licence texts served at `/licenses/*.txt`.
- [x] No horizontal overflow at 360–1440 px on the site; dashboard responsive checks unchanged.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (apps/site, apps/web, packages/ui READMEs)

## Plan

1. Tokens + web imports; sidebar label class.
2. Site typography.css via fontsource; heading weight/tracking; mono label selectors; remove old font files and preload.
3. `apps/site/e2e/fonts.spec.ts` rewritten (fonts render, Vietnamese subset, same-origin, licences).
4. QA agent review, `pnpm check`.

## Log

- 2026-10-28 — created; owner chose the reelcrew.io pairing for both the site and the app.
- 2026-10-28 — fresh-context QA agent review: accept. Verified computed fonts (site and dashboard), Vietnamese subsets loading, stacked diacritics, same-origin font requests, no overflow at 375 px on site and /app/contacts, /orders, /inbox, /settings/profile. Fixed: the mobile hero heading left "lo." alone on the last line → `text-wrap: balance` on display headings. Checked and left as is: a 1 px vertical scroll on the settings tab row comes from the existing `-mb-px` underline, not the font.
- 2026-10-28 — verified: `pnpm check` green; site 8/8 Playwright; web responsive + statistics e2e: overflow checks pass; failures in a first run under heavy load were 5 s heading timeouts, all 19 re-run green; `every layout preference combination` is the known T-122 failure.

## Links

- Related tasks: T-121 (site), T-120 (account menu)
