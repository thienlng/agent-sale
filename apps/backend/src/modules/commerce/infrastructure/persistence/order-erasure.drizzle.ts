import { and, eq, schema, sql, withTenant, type Database, type SQL } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type {
  OrderErasureStore,
  OrderErasureTx,
} from '../../application/ports/order-erasure-store.js';

const o = schema.orders;
const d = schema.botOrderDrafts;
const uuidArray = (ids: readonly string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`;
const textArray = (v: readonly string[]) => sql`${`{${v.join(',')}}`}::text[]`;

export class DrizzleOrderErasureStore implements OrderErasureStore {
  constructor(private readonly db: Database) {}

  run<T>(ws: WorkspaceId, fn: (tx: OrderErasureTx) => Promise<T>): Promise<T> {
    return withTenant(this.db, ws, (tx) =>
      fn({
        async ordersOf(conversationIds, phoneDigits) {
          const match: SQL[] = [];
          if (conversationIds.length)
            match.push(sql`${o.conversationId} = any(${uuidArray(conversationIds)})`);
          // Digits only, so the phone typed as "0912 345 678" still matches.
          if (phoneDigits.length)
            match.push(
              sql`regexp_replace(coalesce(${o.customer}->>'phone', ''), '\\D', '', 'g') = any(${textArray(phoneDigits)})`,
            );
          if (!match.length) return [];
          return tx
            .select({
              id: o.id,
              code: o.code,
              trackingCode: o.trackingCode,
              customer: o.customer,
              recipient: o.recipient,
              noteInternal: o.noteInternal,
              notePrint: o.notePrint,
            })
            .from(o)
            .where(and(eq(o.workspaceId, ws), sql`(${sql.join(match, sql` or `)})`))
            .for('update');
        },
        async anonymize(id, people, searchText) {
          await tx
            .update(o)
            .set({ ...people, searchText, updatedAt: new Date() })
            .where(and(eq(o.workspaceId, ws), eq(o.id, id)));
        },
        async deleteDrafts(conversationIds) {
          if (!conversationIds.length) return;
          await tx
            .delete(d)
            .where(
              and(
                eq(d.workspaceId, ws),
                sql`${d.conversationId} = any(${uuidArray(conversationIds)})`,
              ),
            );
        },
      }),
    );
  }
}
