---
id: T-043
title: Workspace members and invitation links
status: done
type: feature
priority: P0
owner: @agent:claude
feature_ids: [SET-01]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-043-m3b-team-access
pr:
parent: 
---

## Context

Owner request (2026-10-24) after M3a: roles, CRM object scope (#38) and auto-assignment (#28 / T-033) all need more than one member per shop, and members could not be added.

## Goal

Owners and admins invite people by email and role, manage roles and remove members; invitees join through a link.

## Scope

- New `team` module (invitations table, migration 0014); member changes through new `WorkspaceFacade` methods (`listMembers`, `joinMember`, `changeMemberRole`, `removeMember`); `IdentityFacade.profile`.
- Invitation links: 32-byte secret returned once, SHA-256 stored, 7 days, email must match the signed-in user, re-invite revokes the pending one.
- Web: Members & access page, invite dialog with a copyable link, `/join` page (sign in or sign up with redirect back; signup prefills the email from the link).

## Out of scope

- Sending invitation emails (needs SMTP/notifications), member quota by plan, custom roles (SET-03).

## Acceptance criteria

- [x] Invite → accept with the invited email → member with that role; another email gets 403; revoked/expired 409.
- [x] Admins manage sales/CSKH/analysts only; the owner cannot be removed or demoted.
- [x] A removed member loses access at once.
- [x] Live e2e: invite in the UI, join through the link.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (team and workspace MODULE.md, ARCHITECTURE §3, docs/05, docs/02 SET-01)

## Log

- 2026-10-24 — created and done.
