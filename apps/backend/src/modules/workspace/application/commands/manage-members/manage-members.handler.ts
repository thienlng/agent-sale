import { newId, type UserId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { MemberRole, Membership } from '../../../domain/ports/member.repository.js';
import { MemberNotFoundError, OwnerMembershipError } from '../../../domain/workspace.errors.js';
import { WORKSPACE_UOW, type WorkspaceUnitOfWork } from '../../ports/workspace-unit-of-work.js';

type GivenRole = Exclude<MemberRole, 'owner'>;

/**
 * Membership changes. The owner's membership is fixed (one owner per
 * workspace); everyone else can join, change role, leave and come back.
 */
@Injectable()
export class ManageMembersHandler {
  constructor(@Inject(WORKSPACE_UOW) private readonly uow: WorkspaceUnitOfWork) {}

  /** Adds the user, or reactivates them with the new role; an active owner stays owner. */
  join(ws: WorkspaceId, user: UserId, role: GivenRole): Promise<Membership> {
    return this.uow.run(ws, async ({ members }) => {
      const current = await members.find(ws, user);
      if (current?.role === 'owner') return current;
      if (current) {
        const next: Membership = { ...current, role, status: 'active' };
        await members.update(next);
        return next;
      }
      const added: Membership = {
        id: newId(),
        workspaceId: ws,
        userId: user,
        role,
        status: 'active',
      };
      await members.add(added);
      return added;
    });
  }

  changeRole(ws: WorkspaceId, user: UserId, role: GivenRole): Promise<Membership> {
    return this.uow.run(ws, async ({ members }) => {
      const current = await members.find(ws, user);
      if (!current || current.status !== 'active') throw new MemberNotFoundError(user);
      if (current.role === 'owner') throw new OwnerMembershipError();
      const next = { ...current, role };
      await members.update(next);
      return next;
    });
  }

  remove(ws: WorkspaceId, user: UserId): Promise<Membership> {
    return this.uow.run(ws, async ({ members }) => {
      const current = await members.find(ws, user);
      if (!current) throw new MemberNotFoundError(user);
      if (current.role === 'owner') throw new OwnerMembershipError();
      if (current.status === 'removed') return current;
      const next: Membership = { ...current, status: 'removed' };
      await members.update(next);
      return next;
    });
  }
}
