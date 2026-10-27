import { WebsiteVisitorDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { CONVERSATION_FACADE, type ConversationFacade } from '../../conversation/api/index.js';
import type { WebchatFacade } from '../api/webchat.facade.js';
import { WebchatNotFoundError } from '../domain/webchat.errors.js';
import { VISITOR_STORE, type VisitorStore } from './ports/visitor-store.js';

@Injectable()
export class WebchatFacadeImpl implements WebchatFacade {
  constructor(
    @Inject(CONVERSATION_FACADE) private readonly conversations: ConversationFacade,
    @Inject(VISITOR_STORE) private readonly visitors: VisitorStore,
  ) {}

  async getVisitor(ws: WorkspaceId, conversationId: string): Promise<WebsiteVisitorDto> {
    // Resolving through the conversation keeps this correct before the visitor ever polled
    // (`webchat_visitors.conversation_id` is filled lazily).
    const { conversation: c } = await this.conversations.get(ws, conversationId);
    if (c.provider !== 'website') throw new WebchatNotFoundError(conversationId);
    const v = await this.visitors.find(ws, c.channelId, c.customerId);
    if (!v) throw new WebchatNotFoundError(conversationId);
    return WebsiteVisitorDto.parse({
      firstUrl: v.firstUrl,
      referrer: v.referrer,
      lastUrl: v.lastUrl,
      lastTitle: v.lastTitle,
      phone: v.phoneE164,
      contactId: v.contactId,
      createdAt: v.createdAt,
    });
  }
}
