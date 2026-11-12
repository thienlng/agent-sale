import { Inject, Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';

import { CHANNEL_FACADE, type ChannelFacade } from '../../channel/api/index.js';
import {
  CONTACT_LIFECYCLE,
  type ContactErasure,
  type ContactLifecycle,
} from '../../crm/api/index.js';
import { CONVERSATION_STORE, type ConversationStore } from './ports/conversation-store.js';
import { CUSTOMER_MEDIA, type CustomerMediaStorage } from './ports/customer-media.js';

const log = new Logger('ConversationErasure');

/**
 * The inbox's part of deleting a customer (docs/09 §10, crm `ContactLifecycle`): it names the
 * customer's conversations (`collect`) and, once every other module is done with them, deletes
 * them (`erase`): the website pictures the customer uploaded, the messages, the conversations (Brain
 * signals and care steps follow by foreign key) and the processed raw channel events.
 */
@Injectable()
export class ConversationErasure implements OnModuleInit {
  constructor(
    @Inject(CONVERSATION_STORE) private readonly store: ConversationStore,
    @Inject(CHANNEL_FACADE) private readonly channels: ChannelFacade,
    @Inject(CUSTOMER_MEDIA) private readonly media: CustomerMediaStorage,
    @Inject(CONTACT_LIFECYCLE) @Optional() private readonly lifecycle?: ContactLifecycle,
  ) {}

  onModuleInit(): void {
    this.lifecycle?.onCollect((e) => this.collect(e));
    this.lifecycle?.onErase((e) => this.erase(e));
  }

  async collect(e: ContactErasure): Promise<void> {
    const ids = await this.store.run(e.workspaceId, (tx) => tx.idsOfContact(e.contactId));
    e.conversationIds.push(...ids);
  }

  async erase(e: ContactErasure): Promise<void> {
    if (!e.conversationIds.length) return;
    const ws = e.workspaceId;
    // Files first: once the messages are gone nothing would remember them.
    const urls = await this.store.run(ws, (tx) => tx.attachmentUrls(e.conversationIds));
    e.counts.files += await this.media.removeVisitorUploads(ws, urls);
    const erased = await this.store.run(ws, (tx) => tx.erase(e.conversationIds));
    e.counts.conversations += erased.conversations;
    e.counts.messages += erased.messages;
    for (const peer of erased.peers) {
      try {
        await this.channels.forgetCustomerEvents(ws, peer.channelId, peer.customerId);
      } catch (error) {
        // The conversations are gone already; a leftover raw event is retried by nobody, so say so.
        log.warn(
          `Raw events of a deleted customer were not removed (channel ${peer.channelId}): ${(error as Error).name}`,
        );
      }
    }
  }
}
