# audit

**Purpose:** a tamper-evident, per-workspace trail of security-relevant changes (members, invitations, roles, shop profile, logo) that owners and admins can read.

**Owned tables:** `audit_events` (tenant, forced RLS, append-only) — migration 0016; schema in `packages/db/src/schema/audit.ts`.

**Public API (`api/`):** none for reading by other modules. Writers call `writeAudit(tx, …)` from `packages/db` inside their own tenant transaction, so an event exists exactly when its change does. HTTP: `GET /audit-events` (capability `audit.view`: owner, admin) with keyset pagination (`before` + `beforeId`), an `action` filter (exact or prefix ending in `.`) and `from`/`to` dates.

**Events consumed:** none.

**Invariants:**

- Append-only: `UPDATE` and `DELETE` are revoked from `app_tenant`; a tenant never sees another tenant's events.
- Actions are `<area>.<verb>` (`member.role_changed`, `workspace.profile_updated`); `data` holds what changed (`{ field: { from, to } }`) and context, never secrets, tokens or link secrets.
- Pagination is keyset on `(at, id)` so equal timestamps neither repeat nor skip.
- Account-level events that belong to no workspace (two-factor changes) are not recorded here yet.

**Do not:** write audit rows outside the change's transaction; put personal secrets in `data`.

**Test:** `test/team.integration.spec.ts`, `test/profile.integration.spec.ts`.
