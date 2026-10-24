# team

**Purpose:** members and invitation links of a workspace (docs/02 SET-01): who is in the shop, with which role, and how new people join.

**Owned tables:** `invitations` (tenant, forced RLS — migration 0007; schema in `packages/db/src/schema/workspace.ts`). Member rows stay owned by `workspace`; this module changes them only through `WorkspaceFacade` (`listMembers`, `joinMember`, `changeMemberRole`, `removeMember`).

**Public API (`api/`):** `TEAM_FACADE` → `listMembers(workspaceId, actor)` (members with names and emails). HTTP: `/members`, `/members/{userId}` (role), `/members/{userId}/remove`, `/invitations`, `/invitations/{id}/revoke` (workspace-scoped, `members.manage`), `/invitation-links/{token}` and `/invitation-links/accept` (signed in, not workspace-scoped).

**Events consumed / published:** none yet.

**Invariants:**

- An invitation names an email and a role (admin, sales, care, analyst). The link secret (32 random bytes) is returned once at creation; only its SHA-256 is stored. Links expire after 7 days. A new invitation for the same email revokes the pending one in the same transaction (at most one pending per email, unique index).
- Members without `members.manage` see active members' names and roles only (no emails, no former members).
- Accepting requires a session whose email equals the invited email (case-insensitive); anyone else gets 403 even with the link, and the preview shows them only a masked address. Accepting twice by the same user answers the same; a used, revoked or expired link answers 409; an unknown one 404. Accept claims the invitation first (conditional update), then adds the member or reactivates a removed one, so a revoke in between wins.
- A link is only as good as its inviter: if the inviter is no longer a member, or no longer may invite that role, the link answers 409.
- **Known gap (T-045):** emails are not verified at signup yet, so a leaked link plus an unregistered invited address is enough to join. Mitigated by masking, 7-day expiry, revocation and inviter checks; closed by email verification.
- Admins manage sales, CSKH and analysts; only the owner invites, changes or removes admins. The owner's membership never changes (workspace rule, 409).
- Removing a member is immediate (the guard checks membership on every request); their history, notes and ownership of customers stay.
- No email is sent yet: the owner shares the link (chat, email). Sending invitation emails comes with an SMTP/notification task.

**Do not:** read `members` or `users` directly (use the workspace and identity facades); log link secrets.

**Test:** `test/team.integration.spec.ts` · live UI: `apps/web/e2e-live/team.spec.ts`
