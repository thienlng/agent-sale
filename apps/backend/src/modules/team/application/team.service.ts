import {
  type AcceptedInvitation,
  type AssignableRole,
  type CreatedInvitation,
  CreateInvitationRequest,
  type InvitationDto,
  type InvitationPreview,
  type MemberDto,
  type MemberList,
  MEMBERS_LIMIT,
  type RemovalPreview,
  RemoveMemberRequest,
  roleCan,
} from '@agent-sales/contracts';
import { isUuid, newId, userId, type UserId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { BILLING_FACADE, type BillingFacade } from '../../billing/api/index.js';
import { CRM_FACADE, type CrmFacade } from '../../crm/api/index.js';
import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import type { TeamFacade } from '../api/team.facade.js';
import {
  hashInvitationToken,
  INVITATION_TTL_MS,
  invitationStatus,
  newInvitationToken,
} from '../domain/invitation.js';
import {
  AdminOnlyByOwnerError,
  AlreadyMemberError,
  InvalidReassignmentError,
  InvitationEmailMismatchError,
  InvitationNotFoundError,
  InvitationUnusableError,
  ReassignmentRequiredError,
  SeatLimitReachedError,
} from '../domain/team.errors.js';
import {
  INVITATION_STORE,
  type InvitationRecord,
  type InvitationStore,
} from './ports/invitation-store.js';

/** `l***@shop.vn`: enough to recognise your own address, not to learn someone else's. */
function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

/** The person acting: their user id and role in the workspace (from the guard). */
export interface Actor {
  userId: string;
  role: string | undefined;
}

const toInvitationDto = (i: InvitationRecord): InvitationDto => ({
  id: i.id,
  email: i.email,
  role: i.role,
  invitedByName: i.invitedByName,
  status: invitationStatus(i),
  expiresAt: i.expiresAt.toISOString(),
  createdAt: i.createdAt.toISOString(),
});

/** Roles that may take over customers: they must be able to see and work them. */
const CAN_OWN_CUSTOMERS: ReadonlySet<string> = new Set(['owner', 'admin', 'sales', 'care']);

/**
 * Members and invitation links (docs/02 SET-01, ADM-01). Admins manage sales,
 * CSKH and analysts; only the owner invites, changes or removes admins. The
 * owner's own membership never changes (workspace module rule).
 *
 * Seats (`members.max`): an invitation is only created while active members plus
 * waiting invitations fit the limit (so links are never dead on arrival), and the
 * hard check runs atomically when a member is added (workspace module).
 */
@Injectable()
export class TeamService implements TeamFacade {
  constructor(
    @Inject(INVITATION_STORE) private readonly invitations: InvitationStore,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
    @Inject(BILLING_FACADE) private readonly billing: BillingFacade,
    @Inject(CRM_FACADE) private readonly crm: CrmFacade,
  ) {}

  /** Managers see emails and former members; everyone else sees active names and roles. */
  async listMembers(ws: WorkspaceId, actor: Actor): Promise<MemberDto[]> {
    const manager = roleCan(actor.role, 'members.manage');
    const members = await this.workspaces.listMembers(ws, { includeRemoved: manager });
    return Promise.all(
      members.map(async (m) => {
        const p = await this.identity.profile(m.userId);
        return {
          userId: m.userId,
          name: p?.name ?? '—',
          email: manager || m.userId === actor.userId ? (p?.email ?? '') : '',
          role: m.role,
          status: m.status,
          joinedAt: m.joinedAt.toISOString(),
          isYou: m.userId === actor.userId,
        };
      }),
    );
  }

  /** The member list with the seat indicator (used / waiting invitations / limit). */
  async overview(ws: WorkspaceId, actor: Actor): Promise<MemberList> {
    const manager = roleCan(actor.role, 'members.manage');
    const [data, limit, active, pending] = await Promise.all([
      this.listMembers(ws, actor),
      this.billing.limit(ws, MEMBERS_LIMIT),
      this.workspaces.listMembers(ws),
      manager ? this.invitations.countPending(ws, '') : Promise.resolve(0),
    ]);
    return { data, seats: { used: active.length, pending, limit } };
  }

  async changeRole(ws: WorkspaceId, target: string, role: AssignableRole, actor: Actor) {
    await this.#assertManages(ws, target, role, actor);
    await this.workspaces.changeMemberRole(ws, userId(target), role, await this.#who(actor));
    return this.#member(ws, target, actor);
  }

  /** How many customers a member owns, shown before removing them. */
  async removalPreview(ws: WorkspaceId, target: string, actor: Actor): Promise<RemovalPreview> {
    await this.#assertManages(ws, target, undefined, actor);
    const owned = await this.crm.ownedContactCounts(ws, target);
    return { ...owned, requiresReassignment: owned.sales + owned.care > 0 };
  }

  /**
   * Removes a member. If they own customers, the request must say where those go
   * (another member, or unassigned): never silently. Customers move first, then
   * the membership ends, so a failure in between leaves a member with no customers
   * rather than customers owned by someone without access; a retry is safe.
   */
  async remove(ws: WorkspaceId, target: string, raw: unknown, actor: Actor) {
    const { reassign } = RemoveMemberRequest.parse(raw ?? {});
    await this.#assertManages(ws, target, undefined, actor);
    const owned = await this.crm.ownedContactCounts(ws, target);
    const who = await this.#who(actor);
    if (owned.sales + owned.care > 0) {
      if (!reassign) throw new ReassignmentRequiredError(owned);
      let to: string | null = null;
      if (reassign.mode === 'transfer') {
        to = reassign.toUserId;
        const members = await this.workspaces.listMembers(ws);
        const dest = members.find((m) => m.userId === to);
        if (to === target || !dest || !CAN_OWN_CUSTOMERS.has(dest.role)) {
          throw new InvalidReassignmentError();
        }
      }
      await this.crm.reassignContacts(ws, { from: target, to, actor: who });
    }
    await this.workspaces.removeMember(ws, userId(target), who);
    return this.#member(ws, target, actor);
  }

  async listInvitations(ws: WorkspaceId): Promise<InvitationDto[]> {
    return (await this.invitations.list(ws)).map(toInvitationDto);
  }

  /** A new link replaces any pending one for the same email. */
  async invite(ws: WorkspaceId, raw: unknown, actor: Actor): Promise<CreatedInvitation> {
    const { email, role } = CreateInvitationRequest.parse(raw);
    return this.#issue(ws, email, role, actor, 'member.invited');
  }

  /** A fresh link for the same email and role; the old one stops working. */
  async resend(ws: WorkspaceId, id: string, actor: Actor): Promise<CreatedInvitation> {
    const old = isUuid(id) ? await this.invitations.find(ws, id) : null;
    if (!old) throw new InvitationNotFoundError();
    if (old.acceptedAt) throw new InvitationUnusableError('accepted');
    return this.#issue(ws, old.email, old.role, actor, 'member.invitation_resent');
  }

  async revoke(ws: WorkspaceId, id: string, actor: Actor): Promise<InvitationDto> {
    const r = isUuid(id)
      ? await this.invitations.revoke(ws, id, {
          actorUserId: actor.userId,
          actorName: await this.identity.displayName(userId(actor.userId)),
          action: 'member.invitation_revoked',
        })
      : null;
    if (!r) throw new InvitationNotFoundError();
    return toInvitationDto(r);
  }

  async preview(token: string, user: UserId): Promise<InvitationPreview> {
    const i = await this.#byToken(token);
    const [workspace, profile] = await Promise.all([
      this.workspaces.getById(i.workspaceId as WorkspaceId),
      this.identity.profile(user),
    ]);
    const emailMatches = profile?.email.toLowerCase() === i.email;
    return {
      workspaceName: workspace.name,
      role: i.role,
      // Someone else holding the link learns only a hint of the address.
      email: emailMatches ? i.email : maskEmail(i.email),
      status: invitationStatus(i),
      emailMatches,
    };
  }

  /**
   * Joins the workspace of a pending invitation sent to the signed-in user's
   * email. Accepting the same invitation again is a no-op that answers the same.
   * If no seat is free the claim is released, so the link works once a seat opens.
   */
  async accept(token: string, user: UserId): Promise<AcceptedInvitation> {
    const i = await this.#byToken(token);
    const ws = i.workspaceId as WorkspaceId;
    const workspace = await this.workspaces.getById(ws);
    const done = { workspaceId: ws, workspaceName: workspace.name, role: i.role };
    const status = invitationStatus(i);
    if (status === 'accepted' && i.acceptedByUserId === user) return done;
    if (status !== 'pending') throw new InvitationUnusableError(status);
    const profile = await this.identity.profile(user);
    if (profile?.email.toLowerCase() !== i.email) throw new InvitationEmailMismatchError();
    await this.#assertInviterStillMay(ws, i);
    // Claim the invitation first: a revoke or a second accept in between makes this fail.
    if (!(await this.invitations.markAccepted(i.id, user, new Date()))) {
      const now = await this.invitations.findByTokenHash(i.tokenHash);
      if (now?.acceptedByUserId === user) return done;
      throw new InvitationUnusableError(now ? invitationStatus(now) : 'revoked');
    }
    try {
      await this.workspaces.joinMember(ws, user, i.role, {
        seatLimit: await this.billing.limit(ws, MEMBERS_LIMIT),
        actor: { userId: user, name: profile.name },
      });
    } catch (error) {
      await this.invitations.releaseAccepted(i.id, user);
      throw error;
    }
    return done;
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  async #issue(
    ws: WorkspaceId,
    email: string,
    role: AssignableRole,
    actor: Actor,
    action: string,
  ): Promise<CreatedInvitation> {
    if (role === 'admin' && actor.role !== 'owner') throw new AdminOnlyByOwnerError();
    const members = await this.workspaces.listMembers(ws);
    for (const m of members) {
      if ((await this.identity.profile(m.userId))?.email.toLowerCase() === email) {
        throw new AlreadyMemberError();
      }
    }
    // Waiting invitations reserve seats at invite time (the same email's old link is replaced).
    const limit = await this.billing.limit(ws, MEMBERS_LIMIT);
    if (limit !== null) {
      const waiting = await this.invitations.countPending(ws, email);
      if (members.length + waiting >= limit) {
        throw new SeatLimitReachedError(limit, members.length, waiting);
      }
    }
    const { token, hash } = newInvitationToken();
    const now = new Date();
    const actorName = await this.identity.displayName(userId(actor.userId));
    const record: InvitationRecord = {
      id: newId(),
      workspaceId: ws,
      email,
      role,
      tokenHash: hash,
      invitedByUserId: actor.userId,
      invitedByName: actorName,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
      createdAt: now,
    };
    await this.invitations.replacePending(ws, record, {
      actorUserId: actor.userId,
      actorName,
      action,
      data: { emailHint: maskEmail(email) },
    });
    return { invitation: toInvitationDto(record), token };
  }

  async #who(actor: Actor) {
    return { userId: actor.userId, name: await this.identity.displayName(userId(actor.userId)) };
  }

  async #byToken(token: string): Promise<InvitationRecord> {
    const i = await this.invitations.findByTokenHash(hashInvitationToken(token));
    if (!i) throw new InvitationNotFoundError();
    return i;
  }

  /** A link is only as good as its inviter: removed or demoted inviters' links stop working. */
  async #assertInviterStillMay(ws: WorkspaceId, i: InvitationRecord): Promise<void> {
    const inviter = (await this.workspaces.listMembers(ws)).find(
      (m) => m.userId === i.invitedByUserId,
    );
    const may = inviter?.role === 'owner' || (inviter?.role === 'admin' && i.role !== 'admin');
    if (!may) throw new InvitationUnusableError('inviter_changed');
  }

  /** Admins cannot touch admins (or make someone admin); only the owner can. */
  async #assertManages(
    ws: WorkspaceId,
    target: string,
    newRole: AssignableRole | undefined,
    actor: Actor,
  ): Promise<void> {
    if (actor.role === 'owner') return;
    const current = (await this.workspaces.listMembers(ws, { includeRemoved: true })).find(
      (m) => m.userId === target,
    );
    if (current?.role === 'admin' || newRole === 'admin') throw new AdminOnlyByOwnerError();
  }

  async #member(ws: WorkspaceId, target: string, actor: Actor): Promise<MemberDto> {
    const all = await this.listMembers(ws, actor);
    const m = all.find((x) => x.userId === target);
    if (!m) throw new InvitationNotFoundError();
    return m;
  }
}
