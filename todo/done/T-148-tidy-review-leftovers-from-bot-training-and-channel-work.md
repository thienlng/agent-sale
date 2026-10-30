---
id: T-148
title: Clean up review leftovers from the bot training and channel work
status: done
type: chore
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

Reviews of the bot training (T-140..T-144) and channel (T-106) work left small leftovers: an over-long store file, a duplicated constant, an optional language argument, and gaps in the business profile form and rules list.

## Goal

Land the review leftovers as a pure tidy-up with no behaviour change except the two listed fixes.

## Scope

- Split the OAuth discovery path out of `channel.store.ts` (400-line lint limit).
- One `REQUIRED_PROFILE_FIELDS` in `packages/contracts`; readiness profile keys required.
- `replyStyle` requires `language`.
- Business profile form: aria-describedby, unused i18n keys, naming, tests.
- Rules list `bareTrigger` fix and test; personality card `set()` is already functional.

## Out of scope

- New behaviour.

## Acceptance criteria

- [x] `channel.store.ts` under 400 lines, channel unit and store integration specs green
- [x] `REQUIRED_PROFILE_FIELDS` defined once and used by backend and web
- [x] `replyStyle` input requires `language`
- [x] Profile form a11y fixes, unused keys removed, three new form tests
- [x] Bare "Khách"/"Khi"/"Khi khách" triggers render no line; unit test added
- [x] Tests added/updated; `pnpm check` is run by the controller
- [x] No docs impact (internal refactor)

## Plan

1. Extract `oauth-discovery.ts` and `record-mappers.ts` next to `revive-removed.ts`.
2. Move the constant to contracts, rebuild, update users and specs.
3. Web form and rules list edits with tests.

## Log

- 2026-10-29 — created and implemented.
- Decision: the discovery/select path moved into `oauth-discovery.ts`; the two row mappers moved to `record-mappers.ts` because both stores need them.
- personality-card `set()` already used a functional `setDraft`; no change. Restoring a `profile` history entry is already covered in `settings-history.spec.ts`; no new test.
- Decision: the Undo button in the profile form is the existing `profile.reset` key ("Hoàn tác").

- 2026-10-29 — Independent review passed; batch gate: pnpm check — lint, arch, typecheck, backend 1245/1245, web 594/597 with 3 load timeouts in untouched channel suites that pass alone (88/88); web build 238.6 KB; e2e bot-profile, t023-training, settings-tabs, business-create 12/12. Landed on main and closed.

## Links

- Docs: docs/04-system-architecture.md, docs/11-code-structure-and-conventions.md
- Related tasks: T-106, T-144
