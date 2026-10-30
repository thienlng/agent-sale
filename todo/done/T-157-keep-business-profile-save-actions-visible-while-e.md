---
id: T-157
title: Keep business profile save actions visible while editing
status: done
type: bug
priority: P1
owner: agent:codex
feature_ids: []
created: 2026-10-30
updated: 2026-10-30
branch: feat/T-155-villas-a17-business
pr: 88
---

## Context

The owner could not find Save after editing the business information page. The only action row was below all basic fields, industry fields and notes.

## Goal

Make profile save actions visible from the first field and while scrolling the form.

## Scope

Business profile form action placement, regression coverage and operator documentation; a small follow-up on the current business acceptance branch.

## Out of scope

API, schema, stored merchant content and permission changes.

## Acceptance criteria

- [x] Save and Undo appear before the first field and remain visible when editing lower fields.
- [x] Save still patches only edits, respects validation and permissions, and preserves failed drafts.
- [x] Responsive checks and pnpm check pass.
- [x] Document explicit saving and action placement.

## Plan

1. Add browser regression for save visibility at the first and last fields on narrow and desktop screens.
2. Move existing action row above the card into a sticky toolbar, respecting sticky/scroll header preferences.
3. Run profile tests, browser layout regression and pnpm check; update documentation and this task.

## Log

- 2026-10-30 — Confirmed Save exists only at the bottom of the long profile card. Existing tests cover patch payloads, errors, permissions, dirty state and navigation blocking.
- 2026-10-30 — merged to main (PR #88); closed in the version 1 close-out (T-158).

## Links

- docs/training-workspace.md
- Related: T-155; PR #88.

- 2026-10-30 — Browser regression reproduced Save outside the viewport in all four cases before the change. After moving the controls outside the overflow-hidden card, all four cases passed. Existing profile tests passed 15/15. Synthetic desktop screenshot visually checked at `/tmp/t157-profile-save.png`.
- 2026-10-30 — Combined Playwright visibility/responsive run: 125/129 passed initially; four page-heading load timeouts passed 4/4 when rerun sequentially, without code/assertion/timeout changes. Initial `pnpm check` reached web tests with lint, architecture and type checks passing, but four unrelated UI tests exceeded their existing five-second limit under concurrent load (604/608 passed). Retrying the full gate with `VITEST_MAX_WORKERS=1 TURBO_ENV_MODE=loose pnpm check`; no repository configuration or test timeout changes.

- 2026-10-30 — Full retry gate passed: lint/architecture, 22 typecheck tasks, 19 test tasks (web 95 files/608 tests; backend 78 files/1268 tests) and 13 build tasks. Initial bundle 241.7 KB gzip under 250 KB budget. Implementation and local acceptance complete; remote PR remains draft pending integration with main and current-head CI. API health returned 200.

- 2026-10-30 — After push d508773, fresh GitHub verification shows PR #88 conflicts with main (mergeable=false, state=dirty), so no current-head check run exists. The previous e01b872 CI run 40975576999 executed: check passed and integration failed. The former billing blocker no longer describes the current state. Record the new remote acceptance blocker; the UI fix and full local gate are complete.
