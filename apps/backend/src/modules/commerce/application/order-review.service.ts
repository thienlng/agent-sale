import type { OrderDto, OrderReviewCountResponse } from '@agent-sales/contracts';
import { isUuid, userId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';
import {
  APPROVAL_UNDONE_HISTORY_NOTE,
  APPROVED_HISTORY_NOTE,
  reviewDecision,
} from '../domain/bot-order.js';
import {
  ApprovalUndoNotAllowedError,
  NotBotOrderError,
  OrderNotFoundError,
} from '../domain/commerce.errors.js';
import { loadOrderDto } from './order-rules.js';
import { COMMERCE_STORE, type CommerceStore, type OrderRecord } from './ports/commerce-store.js';

/** Staff review of the orders the bot created (spec §6.3, ADR-016). */
@Injectable()
export class OrderReviewService {
  constructor(
    @Inject(COMMERCE_STORE) private readonly store: CommerceStore,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
  ) {}

  /**
   * Staff review of a bot order. `approve:true` is idempotent; `approve:false` takes an approval
   * back, only for the user who gave it and within the undo window (spec §6.3).
   */
  async approve(
    ws: WorkspaceId,
    orderId: string,
    approve: boolean,
    actorUserId: string,
  ): Promise<OrderDto> {
    const actorName = await this.identity.displayName(userId(actorUserId));
    return this.store.run(ws, async (tx) => {
      const o = isUuid(orderId) ? await tx.orders.find(orderId, { forUpdate: true }) : null;
      if (!o) throw new OrderNotFoundError(orderId);
      if (o.createdByKind !== 'bot' || o.reviewState === null) throw new NotBotOrderError();
      const now = new Date();
      const decision = reviewDecision(
        {
          reviewState: o.reviewState,
          reviewedByUserId: o.reviewedByUserId,
          reviewedAt: o.reviewedAt,
        },
        approve,
        actorUserId,
        now,
      );
      if (decision === 'undo_not_allowed') throw new ApprovalUndoNotAllowedError();
      if (decision === 'unchanged') return loadOrderDto(tx, o);
      const approved = decision === 'approve';
      const next: OrderRecord = {
        ...o,
        reviewState: approved ? 'approved' : 'pending',
        reviewedByUserId: approved ? actorUserId : null,
        reviewedByName: approved ? actorName : null,
        reviewedAt: approved ? now : null,
        updatedAt: now,
      };
      await tx.orders.update(next);
      await tx.orders.addHistory(ws, o.id, {
        fromStatus: o.status,
        toStatus: o.status,
        note: approved ? APPROVED_HISTORY_NOTE : APPROVAL_UNDONE_HISTORY_NOTE,
        actorUserId,
        actorName,
        createdAt: now,
      });
      return loadOrderDto(tx, next);
    });
  }

  reviewCount(ws: WorkspaceId): Promise<OrderReviewCountResponse> {
    return this.store.run(ws, async (tx) => ({ pending: await tx.orders.countPendingReview() }));
  }
}
