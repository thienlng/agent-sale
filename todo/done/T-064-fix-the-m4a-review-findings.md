---
id: T-064
title: Fix the M4a review findings: sessions on 2FA changes, owner removal, seat backfill, audit grants
status: done
type: bug
priority: P1
owner: @agent:claude
feature_ids: [ADM-01, ADM-04]
created: 2026-10-24
updated: 2026-10-24
branch: fix/T-064-m4a-review-fixes
pr:
parent:
---

## Context

Post-merge review of PR #53 (M4a admin foundation, merged as 019677d after a short review window). Nothing leaked across tenants or bypassed 2FA at login, but four findings change behaviour on the next deploy or let a role do more than intended.

## Goal

Fix the review findings that affect security or every existing shop before the next production deploy; route the rest to their owning tasks.

## Scope

- 2FA changes (enable, disable, new recovery codes) revoke every other refresh-token family of the user; the current session keeps working.
- Removing or re-roling the owner is refused before anything moves (it used to unassign the owner's customers, then fail with 409). Admins cannot revoke an admin invitation (only the owner manages admins).
- Migration 0020: shops created before billing (0015) without a subscription get a `members.max = null` override, so the upgrade does not drop them to one seat; `app_system` loses UPDATE/DELETE on `audit_events`.
- Profile form: a logo upload no longer wipes unsaved text edits (the refreshed profile only replaces untouched fields).
- Task bookkeeping for #53: T-053..T-057 `status: done`, `pr: 53`, board lines.

## Out of scope

- Subscription status and period end in entitlements: owned by T-059 (logged there).
- A shared (Redis) attempt limiter for the MFA throttle: needed before running several API replicas; the per-process limiter predates M4a.

## Acceptance criteria

- [x] Enabling 2FA from one device makes another device's refresh token fail; the current one still refreshes (unit + Postgres integration).
- [x] Owner removal by an admin or by the owner returns 409 and the owner's customers stay assigned; an admin revoking an admin invitation gets 403.
- [x] Upgrading an install with a pre-billing shop leaves it without a member limit; a shop created after 0015 stays on free; `app_system` gets 42501 on UPDATE/DELETE of `audit_events` (db integration test).
- [x] Logo upload keeps edits (`rebaseDraft` unit tests).
- [x] `pnpm check` green; db, team and MFA integration suites green.
- [x] Docs updated: docs/08 (grandfathered seats), docs/09 (session revocation, audit grants).

## Plan

1. `SessionRepository.revokeOtherFamilies` (Drizzle + in-memory), `SessionService.revokeOthers`, called by `MfaService` with the request's session id.
2. `#assertManages` refuses an owner target for every actor, first thing; `revoke` checks the invitation role.
3. Migration 0020 (backfill keyed on the `applied_at` of 0015, revoke on `audit_events`), plus `m4a-upgrade.integration.test.ts` that migrates in stages.
4. `rebaseDraft` helper for the profile form.

## Log

- 2026-10-24 — created from the #53 review; implemented and verified as above. The T-033 auto-assignment integration test failed once out of four full runs (its history assertion depends on which Sales gets the first customer); unrelated to this change, worth a separate fix.
- 2026-10-24 — migration number 0020 is also used by open PR #54 (analytics); whichever merges second renumbers.

## Links

- Review source: PR #53
- Related tasks: T-053, T-054, T-055, T-056, T-057, T-059
