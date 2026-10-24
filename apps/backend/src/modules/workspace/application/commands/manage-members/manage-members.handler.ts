import { newId, type UserId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { MemberRole, Membership } from '../../../domain/ports/member.repository.js';
import {
  MemberNotFoundError,
  OwnerMembershipError,
  SeatLimitError,
} from '../../../domain/workspace.errors.js';
import type { Actor } from '../../ports/audit-writer.js';
import { WORKSPACE_UOW, type WorkspaceUnitOfWork } from '../../ports/workspace-unit-of-work.js';

type GivenRole = Exclude<MemberRole, 'owner'>;

/**
 * Membership changes. The owner's membership is fixed (one owner per
 * workspace); everyone else can join, change role, leave and come back. Every
 * change appends an audit event in the same transaction.
 */
@Injectable()
export class ManageMembersHandler {
  constructor(@Inject(WORKSPACE_UOW) private readonly uow: WorkspaceUnitOfWork) {}

  /**
   * Adds the user, or reactivates them with the new role; an active owner stays
   * owner. A new active member needs a free seat: the check and the insert run
   * under a per-workspace lock, so two joins cannot take the last seat together.
   * Members already active (also above a reduced limit) are never removed here.
   */
  join(
    ws: WorkspaceId,
    user: UserId,
    role: GivenRole,
    seatLimit: number | null,
    actor: Actor,
  ): Promise<Membership> {
    return this.uow.run(ws, async ({ members, audit }) => {
      await members.lockSeats(ws);
      const current = await members.find(ws, user);
      if (current?.role === 'owner' || (current?.status === 'active' && current.role === role)) {
        return current;
      }
      const becomesActive = !current || current.status !== 'active';
      if (becomesActive && seatLimit !== null) {
        const used = await members.countActive(ws);
        if (used >= seatLimit) throw new SeatLimitError(seatLimit, used);
      }
      const next: Membership = current
        ? { ...current, role, status: 'active' }
        : { id: newId(), workspaceId: ws, userId: user, role, status: 'active' };
      if (current) await members.update(next);
      else await members.add(next);
      await audit.record(ws, actor, {
        action: 'member.joined',
        targetType: 'member',
        targetId: user,
        data: { role, rejoined: Boolean(current) },
      });
      return next;
    });
  }

  changeRole(ws: WorkspaceId, user: UserId, role: GivenRole, actor: Actor): Promise<Membership> {
    return this.uow.run(ws, async ({ members, audit }) => {
      const current = await members.find(ws, user);
      if (!current || current.status !== 'active') throw new MemberNotFoundError(user);
      if (current.role === 'owner') throw new OwnerMembershipError();
      if (current.role === role) return current;
      const next = { ...current, role };
      await members.update(next);
      await audit.record(ws, actor, {
        action: 'member.role_changed',
        targetType: 'member',
        targetId: user,
        data: { role: { from: current.role, to: role } },
      });
      return next;
    });
  }

  remove(ws: WorkspaceId, user: UserId, actor: Actor): Promise<Membership> {
    return this.uow.run(ws, async ({ members, audit }) => {
      const current = await members.find(ws, user);
      if (!current) throw new MemberNotFoundError(user);
      if (current.role === 'owner') throw new OwnerMembershipError();
      if (current.status === 'removed') return current;
      const next: Membership = { ...current, status: 'removed' };
      await members.update(next);
      await audit.record(ws, actor, {
        action: 'member.removed',
        targetType: 'member',
        targetId: user,
        data: { role: current.role },
      });
      return next;
    });
  }
}
