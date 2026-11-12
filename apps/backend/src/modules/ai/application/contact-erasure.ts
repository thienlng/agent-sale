import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';

import {
  CONTACT_LIFECYCLE,
  type ContactErasure,
  type ContactLifecycle,
} from '../../crm/api/index.js';
import {
  CONVERSATION_SUMMARY_REPOSITORY,
  type ConversationSummaryRepository,
} from '../domain/ports/conversation-summary.repository.js';

/**
 * The AI's part of deleting a customer (docs/09 §10, crm `ContactLifecycle`, `detach` phase): the
 * running summaries of the customer's long conversations hold what they said, so they go. Turn
 * traces are redacted and expire after 30 days; metering rows hold no text and stay.
 */
@Injectable()
export class SummaryErasure implements OnModuleInit {
  constructor(
    @Inject(CONVERSATION_SUMMARY_REPOSITORY)
    private readonly summaries: ConversationSummaryRepository,
    @Inject(CONTACT_LIFECYCLE) @Optional() private readonly lifecycle?: ContactLifecycle,
  ) {}

  onModuleInit(): void {
    this.lifecycle?.onDetach((e) => this.detach(e));
  }

  async detach(e: ContactErasure): Promise<void> {
    await this.summaries.deleteFor(e.workspaceId, e.conversationIds);
  }
}
