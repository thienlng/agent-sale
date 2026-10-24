# team

**Purpose:** members and invitation links of a workspace (docs/02 SET-01): who is in the shop, with which role, and how new people join.

**Owned tables:** `invitations` (tenant, forced RLS — migration 0007; schema in `packages/db/src/schema/workspace.ts`). Member rows stay owned by `workspace`; this module changes them only through `WorkspaceFacade` (`listMembers`, `joinMember`, `changeMemberRole`, `removeMember`).

**Public API (`api/`):** `TEAM_FACADE` → `listMembers(workspaceId, actor)` (members with names and emails). HTTP: `/members`, `/members/{userId}` (role), `/members/{userId}/remove`, `/invitations`, `/invitations/{id}/revoke` (workspace-scoped, `members.manage`), `/invitation-links/{token}` and `/invitation-links/accept` (signed in, not workspace-scoped).

**Events consumed / published:** none yet.

**Invariants:**

- An invitation names an email and a role (admin, sales, care, analyst). The link secret (32 random bytes) is returned once at creation; only its SHA-256 is stored. Links expire after 7 days. A new invitation for the same email revokes the pending one.
- Accepting requires a session whose email equals the invited email (case-insensitive); anyone else gets 403 even with the link. Accepting twice by the same user answers the same; a used, revoked or expired link answers 409; an unknown one 404. Accept adds the member or reactivates a removed one.
- Admins manage sales, CSKH and analysts; only the owner invites, changes or removes admins. The owner's membership never changes (workspace rule, 409).
- Removing a member is immediate (the guard checks membership on every request); their history, notes and ownership of customers stay.
- No email is sent yet: the owner shares the link (chat, email). Sending invitation emails comes with an SMTP/notification task.

**Do not:** read `members` or `users` directly (use the workspace and identity facades); log link secrets.

**Test:** `test/team.integration.spec.ts` · live UI: `apps/web/e2e-live/team.spec.ts`
