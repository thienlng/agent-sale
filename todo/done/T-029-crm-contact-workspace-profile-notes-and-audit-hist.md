---
id: T-029
title: CRM contact workspace: profile, notes and audit history
status: done
type: feature
priority: P1
owner: @agent:claude
feature_ids: [CRM-01, CRM-02, CRM-03]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-029-m3a-crm-core
pr:
parent:
---

## Context

GitHub #26, child of the CRM and statistics epic #25 (BA analysis of 2026-10-24). Milestone M3a "CRM core" ships the BA's delivery steps 1–2.

## Goal

CRM contact workspace: profile, notes and audit history.

## Scope

- `crm` module (generator), migration 0006, contracts `packages/contracts/src/crm`.
- Contacts: create (name-only allowed, idempotent per form), version-checked edits, provided-at timestamps, first source, E.164 phones.
- Notes (separate from the 500-char profile note, editable with revisions in history) and the audit history (type/actor/date/order filters).
- Outbox events for created/updated/status/assignment/tag changes.
- Web: customer list, create dialog, detail drawer (Overview / Details / History / Files placeholder).

## Acceptance criteria

- [x] Name-only create, reload, exactly one record (integration + live e2e, C01).
- [x] Address, Hotline source and Trial status: profile and list agree (C02–C05).
- [x] A note keeps actor/time and does not change the profile note (C06).
- [x] Two edits with the same version: one 409, nothing lost.
- [x] Another workspace gets 404 on contact, notes, history and tags (C20).
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (crm MODULE.md, docs/05 §5)

## Log

- 2026-10-24 — created from GitHub #26; done. Verified with `apps/backend/test/crm.integration.spec.ts` and `apps/web/e2e-live/crm.spec.ts`.
