import { and, eq, isNull, schema, sql, writeAudit, type TenantTx } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type { CrmTx } from '../../application/ports/crm-store.js';

const c = schema.contacts;
const notes = schema.contactNotes;
const h = schema.contactHistory;
const a = schema.crmTagAssignments;
const t = schema.tasks;

/** One array parameter instead of one per id. */
const uuidArray = (ids: readonly string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`;

/** Deleting a customer (docs/09 §10) and its audit event, inside the use case's transaction. */
export function contactErasureTx(tx: TenantTx): Pick<CrmTx, 'eraseContact' | 'audit'> {
  return {
    async eraseContact(contactId, conversationIds) {
      const ids = uuidArray(conversationIds);
      await tx.delete(notes).where(eq(notes.contactId, contactId));
      await tx.delete(h).where(eq(h.contactId, contactId));
      await tx
        .delete(a)
        .where(
          sql`(${a.scope} = 'contact' and ${a.entityId} = ${contactId}) or (${a.scope} = 'conversation' and ${a.entityId} = any(${ids}))`,
        );
      // The customer's tasks go with it (the foreign key cascades too); customer-less tasks of its
      // conversations would otherwise point at nothing.
      await tx.delete(t).where(eq(t.contactId, contactId));
      if (conversationIds.length)
        await tx.delete(t).where(and(isNull(t.contactId), sql`${t.conversationId} = any(${ids})`));
      await tx.delete(c).where(eq(c.id, contactId));
    },
    async audit(workspaceId: WorkspaceId, e) {
      await writeAudit(tx, { workspaceId, ...e });
    },
  };
}
