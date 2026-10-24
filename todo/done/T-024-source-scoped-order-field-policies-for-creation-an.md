---
id: T-024
title: Source-scoped order field policies for creation and confirmation
status: done
type: feature
priority: P1
owner: @agent:claude
feature_ids: [ORD-03, ORD-05, ORD-06]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-023-orders-parity-fixes
pr:
parent:
---

## Context

GitHub issues #17 and #18 (RZ-ORD-002/003): the form required a phone for every draft (Hotline drafts had to use 0000000000), and order settings had no per-source requirements.

## Goal

Each order source has its own required fields to save an order and to fulfil it, enforced by the API and shown in the form.

## Scope

- Contracts: phone and address may be blank; `OrderSourcePolicy` (`create`, `confirm` field sets), `defaultOrderPolicy`, `FULFILMENT_ORDER_STATUSES`; settings carry `policies` and `version`.
- Migration 0005: `order_settings.policies` JSONB and `version` (optimistic concurrency; stale save → 409).
- API enforcement on create, on entering a fulfilment status and on editing the people of an order; errors list the missing fields.
- Web: required markers and field errors from the selected source's policy; new "Theo nguồn đơn" settings tab with a source selector; settings saves send the loaded version.

## Out of scope

- Per-source "require note" statuses and a "require confirmation step" switch (kept workspace-wide; the UI says so). Revisit with sources as entities.
- Phone number normalisation beyond the existing format check.

## Acceptance criteria

- [x] Hotline saves a draft without phone/address, cannot be confirmed until they are filled (API + live e2e).
- [x] Facebook keeps the stricter default; changing Hotline does not change Facebook.
- [x] Stale settings save refused with 409; settings unchanged.
- [x] Saving a draft never sends a shipment (no carrier integration exists; noted for T-020).
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (docs/05 §6, commerce MODULE.md)

## Log

- 2026-10-24 — created from #17 and #18; done.
