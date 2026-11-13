import { and, eq, isNull, lt, schema, sql, type TenantTx } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import { TEST_HOLD_TAG } from '../../application/bot-hold-support.js';
import type { BotHoldDraftRecord, LodgingTx } from '../../application/ports/lodging-store.js';

const D = schema.lodgingBotHoldDrafts;
const B = schema.lodgingBookings;

export type BotHoldPort = Pick<
  LodgingTx,
  | 'countBotHoldsToReview'
  | 'botHoldDraft'
  | 'saveBotHoldDraft'
  | 'deleteBotHoldDraft'
  | 'sweepBotHoldDrafts'
>;

function toDraft(r: typeof D.$inferSelect): BotHoldDraftRecord {
  return {
    id: r.id,
    conversationId: r.conversationId,
    botId: r.botId,
    botName: r.botName,
    channel: r.channel,
    contactId: r.contactId,
    propertyId: r.propertyId,
    whole: r.whole,
    unitIds: r.unitIds,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    adults: r.adults,
    childAges: r.childAges,
    guestName: r.guestName,
    guestPhone: r.guestPhone,
    note: r.note,
    quoteHash: r.quoteHash,
    packageIds: r.packageIds,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  };
}

/**
 * Bot hold drafts (forced RLS) and the review count of bot holds (test-chat holds excluded), in
 * one tenant transaction.
 */
export function botHoldPort(tx: TenantTx, ws: WorkspaceId): BotHoldPort {
  return {
    async countBotHoldsToReview() {
      const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(B)
        .where(
          and(
            eq(B.workspaceId, ws),
            eq(B.source, 'bot'),
            eq(B.status, 'hold'),
            isNull(B.reviewedAt),
            // A test-chat hold lapses on its own: nobody has to handle it (VL2-9).
            sql`not (${B.tags} @> array[${TEST_HOLD_TAG}]::text[])`,
          ),
        );
      return row?.n ?? 0;
    },

    async botHoldDraft(conversationId, lock) {
      const q = tx
        .select()
        .from(D)
        .where(and(eq(D.workspaceId, ws), eq(D.conversationId, conversationId)))
        .limit(1);
      const [r] = lock ? await q.for('update') : await q;
      return r ? toDraft(r) : null;
    },

    async saveBotHoldDraft(draft) {
      const { conversationId: _c, ...replace } = draft;
      await tx
        .insert(D)
        .values({ ...draft, workspaceId: ws })
        .onConflictDoUpdate({ target: [D.workspaceId, D.conversationId], set: replace });
    },

    async deleteBotHoldDraft(conversationId, draftId) {
      const gone = await tx
        .delete(D)
        .where(
          and(
            eq(D.workspaceId, ws),
            eq(D.conversationId, conversationId),
            draftId ? eq(D.id, draftId) : undefined,
          ),
        )
        .returning({ id: D.id });
      return gone.length > 0;
    },

    async sweepBotHoldDrafts(now) {
      await tx.delete(D).where(and(eq(D.workspaceId, ws), lt(D.expiresAt, now)));
    },
  };
}
