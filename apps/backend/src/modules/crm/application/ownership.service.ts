import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { CRM_STORE, type CrmStore } from './ports/crm-store.js';

/** Ownership changes made from outside the CRM screens, e.g. when a member is removed. */
@Injectable()
export class OwnershipService {
  constructor(@Inject(CRM_STORE) private readonly store: CrmStore) {}

  ownedContactCounts(ws: WorkspaceId, userId: string) {
    return this.store.run(ws, (tx) => tx.contacts.countOwnedBy(userId));
  }

  /** Moves a member's customers to someone else (or nobody), leaving a trail per customer. */
  reassignContacts(
    ws: WorkspaceId,
    input: { from: string; to: string | null; actor: { userId: string; name: string | null } },
  ) {
    return this.store.run(ws, async (tx) => {
      const now = new Date();
      const moved = { sales: 0, care: 0 };
      for (const [role, field] of [
        ['sales', 'salesUserId'],
        ['care', 'careUserId'],
      ] as const) {
        const ids = await tx.contacts.reassignOwner(role, input.from, input.to, now);
        moved[role] = ids.length;
        for (const id of ids) {
          await tx.history.add({
            id: newId(),
            contactId: id,
            type: 'contact.assigned',
            changes: { [field]: { from: input.from, to: input.to } },
            data: { reason: 'member_removed' },
            actorUserId: input.actor.userId,
            actorName: input.actor.name,
            createdAt: now,
          });
          await tx.outbox(ws, {
            type: 'crm.contact.assigned.v1',
            aggregateId: id,
            payload: event(ws, id, input.actor.userId, now, {
              role,
              fromUserId: input.from,
              toUserId: input.to,
            }),
          });
        }
      }
      return moved;
    });
  }
}

function event(
  ws: WorkspaceId,
  contactId: string,
  actor: string | null,
  at: Date,
  extra: Record<string, unknown>,
) {
  return { workspaceId: ws, contactId, actorUserId: actor, occurredAt: at.toISOString(), ...extra };
}
