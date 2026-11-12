import { and, eq, schema, sql, withTenant, type Database, type SQL } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type {
  BookingErasureStore,
  BookingErasureTx,
} from '../../application/ports/booking-erasure-store.js';

const b = schema.lodgingBookings;
const h = schema.lodgingBotHoldDrafts;
const uuidArray = (ids: readonly string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`;
const textArray = (v: readonly string[]) => sql`${`{${v.join(',')}}`}::text[]`;

export class DrizzleBookingErasureStore implements BookingErasureStore {
  constructor(private readonly db: Database) {}

  run<T>(ws: WorkspaceId, fn: (tx: BookingErasureTx) => Promise<T>): Promise<T> {
    return withTenant(this.db, ws, (tx) =>
      fn({
        async anonymizeBookings({ contactId, conversationIds, phoneDigits, guestName }) {
          const match: SQL[] = [eq(b.contactId, contactId)];
          if (conversationIds.length)
            match.push(sql`${b.conversationId} = any(${uuidArray(conversationIds)})`);
          if (phoneDigits.length)
            match.push(
              sql`regexp_replace(${b.guestPhone}, '\\D', '', 'g') = any(${textArray(phoneDigits)})`,
            );
          // Blocks have no guest; the version moves so an open edit form reloads.
          const rows = await tx
            .update(b)
            .set({
              guestName,
              guestPhone: '',
              contactId: null,
              version: sql`${b.version} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(b.workspaceId, ws),
                sql`${b.kind} <> 'block'`,
                sql`(${sql.join(match, sql` or `)})`,
              ),
            )
            .returning({ id: b.id });
          return rows.length;
        },
        async deleteHoldDrafts(contactId, conversationIds) {
          const match: SQL[] = [eq(h.contactId, contactId)];
          if (conversationIds.length)
            match.push(sql`${h.conversationId} = any(${uuidArray(conversationIds)})`);
          await tx
            .delete(h)
            .where(and(eq(h.workspaceId, ws), sql`(${sql.join(match, sql` or `)})`));
        },
      }),
    );
  }
}
