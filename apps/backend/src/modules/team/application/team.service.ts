import {
  type AcceptedInvitation,
  type AssignableRole,
  type CreatedInvitation,
  CreateInvitationRequest,
  type InvitationDto,
  type InvitationPreview,
  type MemberDto,
} from '@agent-sales/contracts';
import { isUuid, newId, userId, type UserId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

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
  InvitationEmailMismatchError,
  InvitationNotFoundError,
  InvitationUnusableError,
} from '../domain/team.errors.js';
import {
  INVITATION_STORE,
  type InvitationRecord,
  type InvitationStore,
} from './ports/invitation-store.js';

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

/**
 * Members and invitation links (docs/02 SET-01). Admins manage sales, CSKH and
 * analysts; only the owner invites, changes or removes admins. The owner's
 * own membership never changes (workspace module rule).
 */
@Injectable()
export class TeamService implements TeamFacade {
  constructor(
    @Inject(INVITATION_STORE) private readonly invitations: InvitationStore,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
  ) {}

  async listMembers(ws: WorkspaceId, actor: Actor): Promise<MemberDto[]> {
    const members = await this.workspaces.listMembers(ws, { includeRemoved: true });
    return Promise.all(
      members.map(async (m) => {
        const p = await this.identity.profile(m.userId);
        return {
          userId: m.userId,
          name: p?.name ?? '—',
          email: p?.email ?? '',
          role: m.role,
          status: m.status,
          joinedAt: m.joinedAt.toISOString(),
          isYou: m.userId === actor.userId,
        };
      }),
    );
  }

  async changeRole(ws: WorkspaceId, target: string, role: AssignableRole, actor: Actor) {
    await this.#assertManages(ws, target, role, actor);
    await this.workspaces.changeMemberRole(ws, userId(target), role);
    return this.#member(ws, target, actor);
  }

  async remove(ws: WorkspaceId, target: string, actor: Actor) {
    await this.#assertManages(ws, target, undefined, actor);
    await this.workspaces.removeMember(ws, userId(target));
    return this.#member(ws, target, actor);
  }

  async listInvitations(ws: WorkspaceId): Promise<InvitationDto[]> {
    return (await this.invitations.list(ws)).map(toInvitationDto);
  }

  /** A new link replaces any pending one for the same email. */
  async invite(ws: WorkspaceId, raw: unknown, actor: Actor): Promise<CreatedInvitation> {
    const { email, role } = CreateInvitationRequest.parse(raw);
    if (role === 'admin' && actor.role !== 'owner') throw new AdminOnlyByOwnerError();
    const members = await this.workspaces.listMembers(ws);
    for (const m of members) {
      if ((await this.identity.profile(m.userId))?.email.toLowerCase() === email) {
        throw new AlreadyMemberError();
      }
    }
    const { token, hash } = newInvitationToken();
    const now = new Date();
    const record: InvitationRecord = {
      id: newId(),
      workspaceId: ws,
      email,
      role,
      tokenHash: hash,
      invitedByUserId: actor.userId,
      invitedByName: await this.identity.displayName(userId(actor.userId)),
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
      createdAt: now,
    };
    await this.invitations.revokePending(ws, email);
    await this.invitations.insert(ws, record);
    return { invitation: toInvitationDto(record), token };
  }

  async revoke(ws: WorkspaceId, id: string): Promise<InvitationDto> {
    const r = isUuid(id) ? await this.invitations.revoke(ws, id) : null;
    if (!r) throw new InvitationNotFoundError();
    return toInvitationDto(r);
  }

  async preview(token: string, user: UserId): Promise<InvitationPreview> {
    const i = await this.#byToken(token);
    const [workspace, profile] = await Promise.all([
      this.workspaces.getById(i.workspaceId as WorkspaceId),
      this.identity.profile(user),
    ]);
    return {
      workspaceName: workspace.name,
      role: i.role,
      email: i.email,
      status: invitationStatus(i),
      emailMatches: profile?.email.toLowerCase() === i.email,
    };
  }

  /**
   * Joins the workspace of a pending invitation sent to the signed-in user's
   * email. Accepting the same invitation again is a no-op that answers the same.
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
    await this.workspaces.joinMember(ws, user, i.role);
    await this.invitations.markAccepted(i.id, user, new Date());
    return done;
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  async #byToken(token: string): Promise<InvitationRecord> {
    const i = await this.invitations.findByTokenHash(hashInvitationToken(token));
    if (!i) throw new InvitationNotFoundError();
    return i;
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
