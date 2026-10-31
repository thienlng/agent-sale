import type { OrderDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { CommerceFacade } from '../api/commerce.facade.js';
import { BotOrderService } from './bot-order.service.js';
import { OrderService } from './order.service.js';

/** The commerce public API: staff orders read by id, and the bot's order flow (ADR-016). */
@Injectable()
export class CommerceFacadeImpl implements CommerceFacade {
  constructor(
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(BotOrderService) private readonly botOrders: BotOrderService,
  ) {}

  getOrder(ws: WorkspaceId, orderId: string): Promise<OrderDto> {
    return this.orders.get(ws, orderId);
  }

  prepareBotOrder(
    ws: WorkspaceId,
    input: Parameters<CommerceFacade['prepareBotOrder']>[1],
  ): ReturnType<CommerceFacade['prepareBotOrder']> {
    return this.botOrders.prepareBotOrder(ws, input);
  }

  confirmBotOrder(
    ws: WorkspaceId,
    input: Parameters<CommerceFacade['confirmBotOrder']>[1],
  ): ReturnType<CommerceFacade['confirmBotOrder']> {
    return this.botOrders.confirmBotOrder(ws, input);
  }

  cancelBotOrderDraft(ws: WorkspaceId, conversationId: string): Promise<boolean> {
    return this.botOrders.cancelBotOrderDraft(ws, conversationId);
  }

  hasBotOrderDraft(
    ws: WorkspaceId,
    conversationId: string,
  ): ReturnType<CommerceFacade['hasBotOrderDraft']> {
    return this.botOrders.hasBotOrderDraft(ws, conversationId);
  }
}
