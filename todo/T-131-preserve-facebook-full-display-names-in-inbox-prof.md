---
id: T-131
title: Preserve Facebook full display names in inbox profiles
status: review
type: bug
priority: P1
owner: '@agent:codex'
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: fix/T-126-web-acceptance
pr:
parent: T-126
---

## Context

An owner-authorized Facebook Graph v24 profile comparison on the owner's own test conversation confirmed that the provider's full `name` contains the correct display-name order and middle names, while joining `first_name` and `last_name` produces a different shortened name. The existing adapter requests only the latter fields. Actual customer identity and raw provider responses remain private outside the repository.

## Goal

Preserve the provider's Facebook full display name instead of reconstructing it from incomplete components.

## Scope

- Facebook profile request includes `name` and prefers that returned value, retaining its internal order/spacing after existing outer-trim and length bounds.
- Fall back to existing first-name/last-name joining when the full name is missing, invalid or blank.
- Add synthetic regressions for full Vietnamese name order/middle names, whitespace, legacy fallback and unchanged Instagram/avatar behavior.
- Update existing inbox profile documentation; recommend a safe application-level own-profile refresh for parent verification.

## Out of scope

- Extra customer fields, scraping, changes to profile-cache timing, schema/endpoints, manual SQL profile changes or shared service restarts.
- Changing other agents' tests, the T-126 run ledger or root tooling configuration.

## Acceptance criteria

- [x] A failing regression reproduces the incorrect reconstructed name with synthetic data.
- [x] Facebook fetch requests full name and preserves provider ordering/internal spacing; blank/missing full-name fallback remains compatible.
- [x] Instagram request/name-to-username behavior, token secrecy, avatar HTTPS restrictions and typed errors remain intact.
- [x] Targeted package tests/typecheck/lint pass; parent coordinates full repository gate and private live verification.
- [x] Documentation records the adapter behavior and scope without committing real identity data.

## Plan

1. Write failing synthetic Facebook full-name and whitespace/fallback tests; preserve existing Instagram and transport-safety coverage.
2. Update only Facebook profile field selection and name preference in the adapter.
3. Run focused adapter/package checks and review the diff; update existing profile documentation with the verified-date/evidence boundary.
4. Inspect current application refresh hooks read-only and propose one-profile refresh through its facade, without changing endpoint/schema/cache policy or executing it.

## Log

- 2026-10-29 — Claimed under owner-authorized T-126 bug fixing. Parent already performed the private scoped provider comparison; this agent will not make live provider/browser requests or restart services.

- 2026-10-29 — RED: `pnpm --filter @agent-sales/channels exec vitest run src/meta.test.ts` failed2/13 on synthetic full-name ordering/middle-name and internal-spacing assertions; existing11 passed. Evidence `/tmp/t131-red.log`.
- 2026-10-29 — Facebook fields now append `name` to the existing first/last/picture request and prefer it after the established outer trim/200-character bound. Existing first/last fallback, Instagram fields/name-to-username, token header, HTTPS/avatar bounds and typed errors retained. No schema, endpoint or cache policy changed.
- 2026-10-29 — GREEN: same focused adapter command passed13/13 (`/tmp/t131-green.log`); channels package typecheck and targeted ESLint passed (`/tmp/t131-typecheck.log`, `/tmp/t131-eslint.log`); formatting and whitespace checks passed. These synthetic tests do not claim live combined-field/profile persistence verification. Parent coordinates the final full-repository check.
- 2026-10-29 — Existing profile lookup is daily-TTL-gated; a list only backfills unnamed profiles and detail GET does not force a named profile refresh. Proposed but NOT executed: a module-owned, tenant-scoped application operation verifies the single own test target, invalidates only its freshness stamp under a read/merge/write transaction (with expected-stamp guard), then invokes the existing profile-refresh facade so provider data is written through the normal application path. Do not directly patch the stored name, mass-refresh, change the global TTL or add an unapproved endpoint. Without that scoped invalidation, fresh provider verification is possible through the channel facade but the cached UI may wait for its normal refresh.
- 2026-10-29 — Updated docs/meta-inbox.md with full-name preference, fallback, live-evidence boundary and unchanged Instagram/avatar behavior. No raw provider profile, real customer identity, credentials or private screenshot added. No provider call, service restart or build performed by this agent.

- 2026-10-29 — Independent QA approved production diff and the one-record application refresh plan. Parent built channels, verified expected prior stamp/name under tenant row lock, invalidated only own-thread profile freshness via ConversationStore and invoked the production profile refresh with its production MetaAdapter. Persisted full name matched fresh provider name; only customerName/customerAvatarUrl/profileFetchedAt changed. Mode, revision and activity timestamp unchanged. Sanitized private operational result: /tmp/t131-refresh-evidence.json. Whole-repository final gate remains T-126-owned.

## Links

- packages/channels/src/meta.ts
- packages/channels/src/meta.test.ts
- docs/meta-inbox.md (Customer profiles)
- Related tasks: T-126
