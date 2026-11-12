import { randomBytes } from 'node:crypto';

import { and, eq, schema, withSystem, type Database } from '@agent-sales/db';
import { newId } from '@agent-sales/shared';

import type { MetaDataDeletionStore } from '../meta-data-deletion.js';

const r = schema.metaDataDeletionRequests;

/** 24 upper-case hex characters: alphanumeric, as Meta asks, and unguessable. */
export const newConfirmationCode = (): string => randomBytes(12).toString('hex').toUpperCase();

/**
 * One pending request per Facebook user (partial unique index): a repeated or concurrent callback
 * gets the pending request's code. Uses the restricted system role (the table is global).
 */
export class DrizzleMetaDataDeletionStore implements MetaDataDeletionStore {
  constructor(private readonly db: Database) {}

  request(userHash: string): Promise<{ confirmationCode: string }> {
    return withSystem(this.db, async (tx) => {
      const pending = () =>
        tx
          .select({ confirmationCode: r.confirmationCode })
          .from(r)
          .where(and(eq(r.userHash, userHash), eq(r.status, 'pending')))
          .limit(1);
      const [existing] = await pending();
      if (existing) return existing;
      const [inserted] = await tx
        .insert(r)
        .values({ id: newId(), confirmationCode: newConfirmationCode(), userHash })
        .onConflictDoNothing()
        .returning({ confirmationCode: r.confirmationCode });
      if (inserted) return inserted;
      // A concurrent callback for the same person won the insert.
      const [winner] = await pending();
      if (!winner) throw new Error('Data deletion request could not be stored');
      return winner;
    });
  }
}
