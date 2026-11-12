# ADR-032: Business deletion: soft delete, 30-day restore, purge

- Status: Proposed
- Date: 2026-11-12
- Decision makers: thienlng (design decided in the task brief, 2026-11-12; docs/09 §10)
- Amends: ADR-004 (one more `app_system` user: the business purge)

## Context

An owner could export a business (SET-10) but not delete it. docs/09 §10 asks for "30-day soft
delete → hard delete + delete object storage + revoke channel tokens". A business (workspace)
spans ~90 tables with `workspace_id` owned by ~20 modules, public media under four key prefixes,
private export archives, Meta page tokens and a KiotViet connection. Constraints:

- Every tenant table is owned by one module; modules never touch each other's tables
  (ARCHITECTURE §2). A per-module "delete my rows" hook in each of ~20 modules would be large,
  and a module that forgets its hook leaves personal data behind silently.
- `audit_events` is append-only with ≥ 1 year retention; `app_system` has no `DELETE` on it, and
  it references `workspaces`. Account-scoped tables (`assistant_*`, ADR-024) and
  `account_subscriptions.source_workspace_id` also reference `workspaces`.
- Bots, the care agent, the Business Brain, outbound webhooks, KiotViet sync and scheduled reports
  must stop the moment the owner deletes, not after 30 days, and must restart only on restore.
- Restore must be safe against a purge starting at the same moment.

## Decision

1. **States.** `workspaces.status`: `active` → `pending_deletion` (owner deleted it; `deleted_at`
   set, new column `purge_after = deleted_at + 30 days`) → `purging` (the purge claimed it; no
   restore any more) → `deleted` (purged tombstone, new column `purged_at`). Restore within the
   window returns to `active` and clears both timestamps. `purging` keeps `deleted_at`, so every
   gate treats it like `pending_deletion` (no access, no lists, billing inactive), and it is not
   listed as restorable. Migration 0077 adds the two columns, a partial index for the purge scan
   and explicit `SELECT, DELETE` grants to `app_system` on every table with `workspace_id` except
   `audit_events`; migration 0078 adds the back-off columns (`purge_attempts`, `purge_next_at`,
   `purge_last_error`), widens the index to `pending_deletion` and `purging`, and adds the missing
   `app_system` policies of `fanpage_settings`, `fanpage_comments` and `stay_requests`.
2. **Request** — `POST /workspaces/{workspaceId}/deletion` `{ confirmName }`, owner only (the
   member row with role `owner`; a non-owner member gets 403, anyone else 404), the name typed
   exactly (trimmed, case-sensitive; else 400 `name_mismatch`). No re-authentication: the typed
   name is the guard. One tenant transaction writes the status, the audit event
   `workspace.deletion_requested` and `workspace.workspace.deletion_requested.v1`.
   **Restore** — `POST /workspaces/{workspaceId}/restore`, owner only, before `purge_after` (409
   `restore_window_closed` after it or once the purge claimed the business; the window is checked
   by one conditional `UPDATE … where status = 'pending_deletion' and purge_after > now()` on the
   database clock, never the app clock); audit `workspace.restored`,
   `workspace.workspace.restored.v1`. **List** — `GET /workspaces/deleted` (the caller's
   restorable businesses). None of them is workspace-scoped: a deleted business no longer passes
   the workspace guard. All three are `assistant: never`.
3. **Gates reuse what exists.** `deleted_at` was already honoured by membership lookups (the auth
   guard answers 404 `workspace_access`, so the web falls back to the overview), the business
   lists and switcher, the platform admin lists, `listActiveIds` (worker scans) and the
   `assistant_sql` views; the assistant schedule runner and API keys already ask for a membership.
   For the rest the **billing entitlements** are the gate: `BillingService` asks the new
   `WorkspaceFacade.isActive` and resolves an inactive business to *nothing* (every limit 0,
   including `brain.evaluations.daily` and `care.messages.daily`, every feature off, an allowance
   of 0, `reserveReply` refused). Bot replies and comment replies (`reserveReply`), Brain
   evaluations, care messages and public API webhooks (`feature.public_api`) already consult it,
   so one check stops all of them, like an account suspension stops replies.
4. **Side effects through a lifecycle hook.** `WORKSPACE_LIFECYCLE` (workspace `api/`, like
   `BOT_LIFECYCLE`) lets modules above `workspace` react without `workspace` importing them.
   After the deletion committed: `channel` removes every Facebook/Instagram page (sealed token
   wiped, Meta webhook unsubscribed, best effort) and turns website chats off; `integration`
   disconnects KiotViet (deletes its webhooks, best effort). A failing hook is logged by module
   name and does not fail the request (the billing gate already blocks). The purge runs the same
   hooks again before it deletes any row, so a hook that failed at deletion time (Meta or the
   database unreachable) gets more chances; the hooks are idempotent (`channel` lists only pages
   not removed yet and website chats still on; `integration` acts only on a live KiotViet
   connection). A failing hook fails the purge attempt (back-off, below) for the first 4 attempts;
   from the 5th on the purge logs it and goes ahead, because deleting the data outranks the
   remote clean-up. Restore leaves them disconnected; the owner reconnects.
5. **Purge** — the `worker` ticks `WORKSPACE_PURGE_RUNNER` every minute; it scans every 5 minutes
   for at most 3 businesses that are `purging`, or `pending_deletion` with `purge_after <= now`,
   and not backing off (`purge_next_at` null or past), oldest next attempt first. Per business it
   **claims** the row in one statement, `update workspaces set status = 'purging' where id = $1
   and (status = 'purging' or (status = 'pending_deletion' and purge_after <= now()))`; the
   restore is the mirror statement (`status = 'pending_deletion' and purge_after > now()`), both
   on the database clock and both taking the row lock, so exactly one of them matches and the
   loser sees 0 rows (restore: 409 `restore_window_closed`; purge: skip). Earlier drafts
   re-checked under `FOR UPDATE` in a transaction of their own and then deleted unlocked, while
   restore compared `purge_after` with the app clock: a restore could commit between the check
   and the deletes, or the two clocks could disagree; the claim closes both gaps. Then: re-runs
   the deletion hooks (§4); hard-deletes rows with `purgeWorkspaceRows` (`packages/db`); deletes
   objects; writes the tombstone (only from `purging`), the audit event `workspace.purged` and the
   platform event `workspace.workspace.purged.v1` (no workspace id on the outbox row, so nothing
   of the business remains in the outbox). Each step is idempotent. A failure leaves the business
   `purging`: `purge_attempts` + 1, `purge_last_error` = the error class and SQLSTATE (never a
   message or data), and `purge_next_at` = now + 5 min × 2^(attempts − 1), at most 24 h, so a
   permanently failing business cannot block the others; from the 5th failure on each failure is
   logged at error level with the business id. A run that died resumes at the next scan (a
   `purging` row is always due unless backing off).
6. **Which tables, in which order: derived from the Postgres catalog at run time.** Every ordinary
   or partitioned table of schema `public` with a `workspace_id` column is purged, except the
   maintained list `PURGE_RETAINED_TABLES` = `audit_events` (append-only, retention),
   `message_usage` (the account's allowance of the cycle; ids only) and `workspaces` (tombstone).
   Foreign keys between those tables (`pg_constraint`) give a children-first order (Kahn; a cycle
   throws); a self-referencing table without cascade is deleted in one statement, every other table
   in batches of 2 000 rows (`(tableoid, ctid)`), each batch its own `withSystem` transaction. A new
   tenant table is purged without anyone remembering to; only exceptions are maintained. An
   integration test (`packages/db/src/purge.integration.test.ts`) asserts that the order covers
   every `workspace_id` table except the retained ones and that `app_system` may delete from each,
   and the HTTP test fills many modules' tables and checks that none keeps a row of the purged
   business while another business keeps all of its rows.
7. **Tombstone.** The `workspaces` row stays with `status = 'deleted'`, name `Deleted business`,
   company name and deprecated profile texts emptied, logo cleared, icon reset; `owner_user_id`,
   `account_id`, industry, timezone and timestamps stay. It keeps the foreign keys of the audit
   trail, `message_usage` and the account-scoped references valid. `tenant_routes`, `members`,
   outbox rows and every other row of the business are deleted.
8. **Object storage.** Media keys are already laid out per business: `products/<ws>/`,
   `workspaces/<ws>/`, `webchat/<ws>/`, `lodging/<ws>/` (`businessMediaPrefixes` in
   `packages/contracts/src/common/media.ts`, next to the media path rules) in `S3_BUCKET`, and
   `exports/<ws>/` in `S3_EXPORT_BUCKET`. The purge lists each prefix and deletes object by object
   (`DeleteObject`, which every S3-compatible store accepts); a missing bucket counts as empty;
   without object storage configured there is nothing to delete. A new kind of stored object must
   live under one of these prefixes or add its prefix there.
9. **ADR-004 amendment.** The business purge runner (worker only) is a new `app_system` user: it
   reads `workspaces` and the catalog, deletes every row of one business that the owner deleted
   more than 30 days ago from the catalog-derived tables, and writes the tombstone, one audit row
   and one outbox row. It never reads business data.

## Options considered

- **Per-module purge hooks** (each module deletes its own tables, like the export sources).
  Respects table ownership, but ~20 modules must each implement and keep a hook; a forgotten one
  is silent data retention. Rejected for the hard delete; the catalog is the single source of
  which tables hold a business. Modules still own *behaviour* (the lifecycle hook for channels and
  KiotViet).
- **A maintained list of tables verified by a coverage test.** Fails loudly when a table is added
  without an entry, but every new tenant table then needs an edit in `packages/db` and an ordering
  decision by hand. Rejected in favour of deriving both at run time and maintaining only the
  exceptions (also coverage-tested).
- **`ON DELETE CASCADE` from `workspaces` and deleting the row.** Needs a migration altering ~85
  foreign keys (not backward-compatible in one step), one huge transaction per business, and it
  would delete the append-only audit trail. Rejected.
- **Delete the `workspaces` row.** Blocked by `audit_events` (no DELETE grant), `message_usage` and
  the account-scoped references; a tombstone with the name erased keeps them valid. Rejected.
- **Checking "is the business active" in every runner.** Many call sites across modules that do
  not depend on `workspace`; the billing entitlements are already the shared gate of every
  AI-cost and outbound path. Rejected.

## Consequences

- Positive: one owner action stops everything at once, can be undone for 30 days, and later leaves
  no business row behind in any tenant table, including tables added after this ADR.
- Positive: purges are idempotent and resumable; a crash costs one batch; a failing business
  backs off instead of blocking the others.
- Negative: `packages/db` deletes from tables owned by modules (only through this purge, only for a
  deleted business). The purge runs as `app_system` and bypasses each module's invariants, which
  is acceptable because nothing of the business survives.
- Negative: `BillingService` makes one more indexed system query per entitlement resolution.
- Negative: a hook failure (Meta or KiotViet unreachable) leaves the remote subscription in place;
  the page row is removed only if the database write succeeded. Ingress for a removed or purged
  page finds no live connection and drops the event.
- Follow-ups: account-scoped owner-assistant rows that name a deleted business (`assistant_*` with
  `business_id`) are kept with the account (another workstream owns them); deleting a whole
  account is not built; backups keep purged data until they expire (docs/09 §10, ADR-028).
