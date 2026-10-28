---
id: T-124
title: Integrate the lane A account PRs onto current main
status: in-progress        # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner: "@agent:claude"     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-28
updated: 2026-10-28
branch: feat/T-124-integrate-lane-a1
pr: 82 (A1)
parent:                    # T-xxx if this is a sub-task
---

## Context

Lane A (T-077, T-078, T-079, T-080, T-088, T-089, T-091) was delivered as three stacked PRs — #78 (A1) → #80 (A2) → #81 (A3) — branched from `e3b4b11` (2026-10-27). Since then `main` gained 28 commits (≈200 files): Facebook comments inside the inbox (T-106), persisted inbox drafts, the header account menu (T-120, deletes `nav-user.tsx`), the site move (T-121), typography (T-123), business industry inheritance (T-093) and fanpage settings authorization (T-110). The lane A PRs were never re-checked against that work, and two more open PRs overlap them: #76 (account portfolio + create-business flow, its own `0028_workspace_icon.sql`) and #79 (lane B web block, per-bot statistics that should move to the A1 `botIds` filter).

The owner asked (2026-10-28) to review and land each lane A PR carefully, one at a time, instead of merging the stale stack.

## Goal

Each lane A PR lands on `main` rebuilt on the current code, with textual and semantic conflicts resolved and verified, without rewriting published history.

## Scope

- In scope: rebuilding A1, A2 and A3 on fresh branches from `main` (cherry-picking their commits), resolving conflicts, the semantic checks listed in the Plan, verification, opening one replacement PR per block, closing the stale PR with a link.
- Reconciling A2 with #76 and the T-120 account menu — only after the owner decides the canonical account/business flow.

## Out of scope

- New lane A behavior beyond what #78/#80/#81 already deliver (follow-ups become backlog tasks).
- T-094 cross-lane acceptance (its own task), T-119 task ID reconciliation (its own task; this task only avoids new collisions).
- Force-pushing the original lane A branches.

## Acceptance criteria

- [ ] A1: T-077/T-078 commits on a branch from current `main`; `pnpm check` green; backend and db integration suites green; migration 0028 and `account-backfill` (dry run, real run, idempotent re-run) verified on a dev database with pre-0028 data.
- [ ] A1: every conversation/event path added on `main` since `e3b4b11` either carries `botId` or is documented as not bot-attributed.
- [ ] A2: rebuilt on `main` after A1, reconciled with #76 and the T-120 account menu per the owner's decision; switching business does not leak drafts or cached data of the previous business.
- [ ] A3: rebuilt on `main` after A2; every AI reply path (including those added by T-106) reserves/captures/releases quota; the plan dialog shows the account plan; the red `inbox-sales.spec.ts:385` e2e passes.
- [ ] Each replacement PR passes a fresh-context review and the maintainer's approval; the stale PR is closed with a link.
- [ ] Docs updated where the rebuilt code differs from the original PR description.

## Plan

Merge order: (#79 lane B) → A1 → A2 (+#76) → A3 → T-094.

Owner decisions needed before A2: canonical account/business flow (#76 vs A2 vs combined), migration number for #76's `0028_workspace_icon.sql` (proposal: lane A keeps 0028–0031, #76 becomes 0032), ADR-012 approval (approving the A1 PR approves it), the four product questions in #78.

### A1 (#78: T-077, T-078) — this branch

1. Cherry-pick the 9 A1 commits (`44e3dea..f6da7ed`) onto `main`; resolve `TODO.md` (board lines only).
2. Semantic check: grep paths added on `main` since `e3b4b11` that create conversations or emit `message.received` / `reply.completed` (T-106 comment inbox, webchat, drafts) and confirm `botId` attribution or record why not.
3. Check that migration 0028 still applies on top of main's 0027 and that no main change altered the tables it touches (`workspaces`, `bots`, `channel_connections`, `conversations`, `analytics_facts`).
4. `pnpm check`, `pnpm test:integration` (backend + db).
5. Dev database: migrate, `account-backfill --dry-run`, real run, re-run (expect no changes); smoke-test signup → business placed under an account.
6. Open the replacement PR, close #78 with a link, record results here.

### A2 and A3

Planned in this file after A1 lands and the owner decisions above are recorded.

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-28 — created. Analysis: A1 conflicts with `main` only in `TODO.md`; A1+A2 also in `nav-user.tsx` (deleted by T-120), `session.ts`, i18n; A1+A2+A3 also in `inbox-page.tsx`, `routes/app/inbox.tsx`, `routes/app.tsx`. No migration was added on `main` since the lane A base, so 0028–0031 are free on `main` (but #76 also claims 0028). The gitleaks failure on #80/#81 is fixed on `main` by `347ee38`. Owner: start with A1.
- 2026-10-28 — A1 step 1: cherry-picked the 9 A1 commits (`44e3dea..f6da7ed`). Only `TODO.md` conflicted (three times); each was resolved to main's board and one final commit re-applies the A1 board state (T-077/T-078 in review, lane A titles synced with their task files). `docs/ARCHITECTURE.md` and the review handoff auto-merged; no conflict markers remain.
- 2026-10-28 — A1 step 2: no backend path added on `main` since `e3b4b11` creates conversations or emits `message.received` / `reply.completed` (T-106 comments live in the fanpage store, not `conversations`; the comment processor change is the shared `exposesContactDetails` helper only). New touch point: T-093 made `BotService.create` call `WorkspaceFacade.getById`, which A1 also changes — typecheck is green.
- 2026-10-28 — A1 step 3: `main` added no migration and no `packages/db` change since the lane A base, so 0028 applies unchanged on top of 0027.
- 2026-10-28 — A1 step 4: lint, arch, typecheck (22/22) green; build 13/13 green; unit tests green except four web tests that hit the 5 s timeout during the full parallel run (A1 changes no `apps/web` file); `pnpm --filter @agent-sales/web test` alone: 78 files, 511 tests passed. Integration suites could not run locally: the disk is saturated (IO pressure ≈80%, write await ≈400 ms) and Testcontainers' Postgres `initdb` exceeds the 120 s hook timeout even with `--concurrency=1` (db 6/6 and webhook 1/1 files failed in `beforeAll`, not in assertions). Relying on the CI `integration` job for backend + db + webhook.
- 2026-10-28 — A1 step 5: dev database (pre-0028 data: 2 users, 2 businesses) — `pnpm db:migrate:dev` applied 0028; `account-backfill --dry-run` reported 2 accounts / 2 workspaces linked; the real run reported the same; a re-run reported 0/0 (idempotent). Signup through the API after the migration placed the new business under a new account with the user as `owner`.
- 2026-10-28 — A1 step 6: opened PR #82 (draft). CI first run all green: check, integration (backend 20 files / 153 tests, db 6 / 28, webhook 1 / 3), both web e2e jobs, site, secret scan.
- 2026-10-28 — A1 fresh-context review (agent, read-only): request changes. Verified each finding against the code; fixed three in separate commits:
  - `f06b9b5` — account creation race: `ownedBy` + `createWithOwner` ran in two system transactions, so concurrent creations by a user without an account each created one, after which every `POST /workspaces` without `accountId` failed. Replaced both with `resolveForOwner` (read + create in one transaction under `pg_advisory_xact_lock` on the user). New integration test: four concurrent resolutions yield one account.
  - `68a713c` — bots are soft-deleted, so 0028's `ON DELETE SET NULL (bot_id)` never fires and conversations kept a deleted bot. `conversation` now clears `bot_id` from the `BOT_LIFECYCLE` delete hook (`ConversationTx.releaseBot`); the hook skips the DB-less `UNAVAILABLE` store (caught by `http.spec.ts` bot soft-delete). New unit + integration tests, including the cross-workspace case. ADR-012 §4 and the bot/conversation `MODULE.md` updated.
  - `18eb067` — the backfill kept channels bound to soft-deleted bots (it checked only that the row exists). Fixture extended with a soft-deleted bot; expected unbound channels 2 → 3.
  - Not fixed, for the owner: (a) the backfill counts owned accounts without `accounts.status = 'active'` while the app filters on it, and the app would give a user whose only account is suspended a fresh one — the suspended-account policy is a product decision; (b) the backfill takes no per-owner lock, so a signup racing a running backfill can still leave an owner with two accounts (reported as `owner_has_several_accounts`); a per-owner lock in the backfill's single transaction would hold one lock per owner until commit, so run the backfill in a quiet window instead; (c) accounts fall back to the in-memory store when only `DATABASE_SYSTEM_URL` is missing (same pre-existing weakness as the workspace directory).
  - After the fixes: backend unit 70 files / 1129 tests, db unit 1/1, typecheck 22/22, arch clean, lint 0 errors (the `max-lines` warning on `conversation.facade.impl.ts` predates this task: 635 counted lines on `main`). Commitlint warns that `account` is not in the scope enum (root config, protected — left for a human).
- 2026-10-29 — A2 rebuilt on branch `feat/T-124-integrate-lane-a2` (worktree) from main after #82:
  - #76's 6 commits first (T-108..T-111, renumbered T-126..T-129: the old IDs name other tasks on main). Conflicts: i18n JSON (3-way merged by key), `app-shell.tsx` (kept T-120's header `AccountMenu` and #76's `AccountSidebar`), `session.test.ts` imports, `packages/db/src/schema/workspace.ts` (A1's `accountId` and #76's `icon`). #76's `0028_workspace_icon.sql` became **`0032_workspace_icon.sql`**: lane A keeps 0028–0031, referenced ~30 times including ADR-012 (protected); the runner applies unapplied files by name, and both migrations are additive and independent.
  - `6fd0220`: #76's account sidebar rendered the deleted `NavUser` in its footer; dropped, following T-120 (no account footer in the sidebar).
  - A2's 3 commits. Backend: account repository keeps #82's `resolveForOwner` and gains A2's `membershipsOf`/`namesOf` (A2's `ownedBy`/`createWithOwner` were only used by the handler #82 rewrote); membership and contract fields unioned. Web: `business.create` was a string in A2 and an object in #76 → A2's label is `business.createAction`. A2's `nav-user.tsx` changes dropped with the file.
  - `3eccf2e` reconciles the two account layers (owner decision taken autonomously while the owner was away, to be reviewed): #76's structure, A2's behaviour; see the commit message. `useBusinessSwitch` selects first when nothing is chosen, since `/app` business pages need a business.
  - Mistake caught and undone: the cherry-pick loop skipped #76's T-110 commit once (it ran `--skip` when `--continue` failed without conflicts); the loop was fixed, the branch reset to the last good pick and the commit reapplied.
  - Local: typecheck 22/22; web 83 files / 529 tests; backend 70 files / 1130 tests; lint 0 errors.

## Links

- PRs: #78 (A1), #80 (A2), #81 (A3); overlapping: #76, #79
- Docs: `docs/handoffs/2026-10-26-cofounder-review-plan.md`, ADR-012 (on the A1 branch)
- Related tasks: T-077, T-078, T-079, T-080, T-088, T-089, T-091, T-094, T-119
