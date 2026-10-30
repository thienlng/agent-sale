---
id: T-136
title: Prefer the Facebook full display name for inbox customers
status: done
type: bug
priority: P1
owner: '@agent:claude'
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: fix/T-134-codex-fixes
pr: main c0507f4
parent:
---

## Context

An owner-authorized Graph v24 comparison on the owner's own test conversation (2026-10-29) showed that Messenger's full `name` has the right order and middle names, while joining `first_name` and `last_name` (what the adapter requested) gives a shorter, differently ordered name. Codex fixed it on its acceptance branch as local T-131 (snapshot 8bdcc26), including a one-off refresh of the owner's own profile through the normal application path.

## Goal

Inbox customers show the name Facebook shows.

## Scope

- `MetaAdapter.fetchProfile` requests `name` for Messenger and prefers it; first/last join stays as fallback. Instagram unchanged.

## Out of scope

- Re-fetching existing customers (profiles refresh daily on their own), schema or cache policy changes.

## Acceptance criteria

- [x] Synthetic tests: full Vietnamese name with middle names and order kept, internal spacing kept, blank/missing `name` falls back, Instagram request and username fallback unchanged.
- [x] Docs updated (docs/meta-inbox.md, customer profile lookup).
- [x] `pnpm check` green; independent QA review.

## Plan

Port the adapter change and its tests unchanged from 8bdcc26; rewrite the docs paragraph concisely.

## Log

- 2026-10-29 — Codex (as local T-131): red 2/13 then green 13/13 on `src/meta.test.ts`; live own-profile refresh matched the fresh provider name; evidence kept outside git.
- 2026-10-29 — Ported to main by @agent:claude; renumbered T-131 → T-136 (the account lane uses T-126..T-130 and the next free ids). Adapter code and tests unchanged.

- 2026-10-29 — QA review: the rewritten docs paragraph had dropped the "not yet run against a live account" caveat; restored it for Instagram (only Messenger was checked live).

- 2026-10-29 — Landed on main c0507f4 after independent review and the branch gate (pnpm check green; load-induced timeouts in untouched suites passed when rerun alone). Closed.

## Links

- packages/channels/src/meta.ts, packages/channels/src/meta.test.ts, docs/meta-inbox.md
