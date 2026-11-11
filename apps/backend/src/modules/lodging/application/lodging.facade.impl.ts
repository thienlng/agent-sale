import { isUuid, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { ConversationBooking, LodgingFacade, StayRevenue } from '../api/lodging.facade.js';
import { LODGING_STORE, type LodgingStore } from './ports/lodging-store.js';

/** The lodging use cases other modules may call. */
@Injectable()
export class LodgingFacadeImpl implements LodgingFacade {
  constructor(@Inject(LODGING_STORE) private readonly store: LodgingStore) {}

  listBotPropertyIds(ws: WorkspaceId, botId: string): Promise<string[]> {
    return this.store.run(ws, async (tx) => {
      const ids = await tx.botPropertyIds(botId);
      return ids ?? (await tx.properties({ activeOnly: true })).map((p) => p.id);
    });
  }

  latestBookingTimes(
    ws: WorkspaceId,
    conversationIds: readonly string[],
  ): Promise<{ conversationId: string; at: Date }[]> {
    const ids = [...new Set(conversationIds.filter(isUuid))].slice(0, 1000);
    if (!ids.length) return Promise.resolve([]);
    return this.store.run(ws, (tx) => tx.latestBookingByConversation(ids));
  }

  conversationBookings(
    ws: WorkspaceId,
    q: { since: Date; until: Date; bookingIds?: readonly string[] | undefined },
  ): Promise<ConversationBooking[]> {
    const bookingIds = q.bookingIds
      ? [...new Set(q.bookingIds.filter(isUuid))].slice(0, 1000)
      : undefined;
    if (bookingIds && !bookingIds.length) return Promise.resolve([]);
    return this.store.run(ws, (tx) =>
      tx.conversationBookings({ since: q.since, until: q.until, bookingIds }),
    );
  }

  stayRevenue(ws: WorkspaceId, range: { from: string; to: string }): Promise<StayRevenue> {
    return this.store.run(ws, async (tx) => {
      const t = await tx.stayTotals(range.from, range.to);
      return {
        bookings: t.bookings,
        nights: t.nights,
        revenue: t.revenue,
        profit: t.revenue - t.cost,
      };
    });
  }
}
