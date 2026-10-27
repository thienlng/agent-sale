---
id: T-097
title: Website chat: tasks, ADR and channel docs
status: done
type: docs
priority: P1
owner: @agent:claude
feature_ids: [CHN-05]
created: 2026-10-27
updated: 2026-10-27
branch: feat/T-097-website-chat-channel
pr: direct merge to main (owner-approved, 2026-10-27)
parent:
---

## Context

The website chat channel (CHN-05) needs its tasks, an ADR for the deviation from docs/07 section 5 (Shadow DOM instead of an iframe, polling before SSE) and updated channel docs before code lands. Spec: `docs/superpowers/specs/2026-10-27-website-chat-channel-design.md`. Plan (Task 1): `docs/superpowers/plans/2026-10-27-website-chat-channel.md`.

## Goal

Record the website chat decisions (ADR-011) and the channel design in the docs, and create the task set T-097..T-104.

## Scope

- In scope: Task files T-097..T-104 and board lines
- In scope: ADR-011 and its index line
- In scope: Rewrite docs/07 section 5 to match the spec

## Out of scope

- Any code
- docs/04, 05, 09 changes (they land with the tasks that change the behavior)

## Acceptance criteria

- [x] Task files and TODO.md lines exist for T-097..T-104
- [x] ADR-011 is Accepted and indexed in docs/adr/README.md
- [x] docs/07 section 5 matches the spec and links ADR-011
- [x] Formatting check passes
- [x] Docs updated (or "no docs impact" stated)

## Plan

See the plan section (Task 1) linked above.

## Log

- 2026-10-27 — created. Started: docs only.
- 2026-10-27: T-104 verification pass, set to review: docs, ADR-011 and task files reviewed against the code as built. `pnpm check` exit 0.
- 2026-10-27: merged into `main` (squash, owner-approved direct merge); status done.

## Links

- Spec: `docs/superpowers/specs/2026-10-27-website-chat-channel-design.md`
- Plan: `docs/superpowers/plans/2026-10-27-website-chat-channel.md`
- Docs: `docs/adr/ADR-011-website-widget-shadow-dom-and-polling.md`, `docs/07-channel-integrations.md` section 5
- Related tasks: T-097..T-104
