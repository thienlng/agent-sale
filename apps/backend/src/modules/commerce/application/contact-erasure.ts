import { DELETED_CUSTOMER_NAME } from '@agent-sales/contracts';
import { phoneDigitVariants } from '@agent-sales/shared';
import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';

import {
  CONTACT_LIFECYCLE,
  type ContactErasure,
  type ContactLifecycle,
} from '../../crm/api/index.js';
import { anonymizeOrderPeople } from '../domain/order-anonymize.js';
import { orderSearchText } from './order.mappers.js';
import { ORDER_ERASURE_STORE, type OrderErasureStore } from './ports/order-erasure-store.js';

/**
 * Commerce's part of deleting a customer (docs/09 §10, crm `ContactLifecycle`, `detach` phase).
 * Orders are business records and stay, with the customer's name replaced by
 * `DELETED_CUSTOMER_NAME` and their phone, email and address removed: the orders of the customer's
 * conversations and those whose customer phone is the customer's (orders carry no customer id).
 * The bot's pending order summaries of those conversations are deleted.
 */
@Injectable()
export class OrderErasure implements OnModuleInit {
  constructor(
    @Inject(ORDER_ERASURE_STORE) private readonly store: OrderErasureStore,
    @Inject(CONTACT_LIFECYCLE) @Optional() private readonly lifecycle?: ContactLifecycle,
  ) {}

  onModuleInit(): void {
    this.lifecycle?.onDetach((e) => this.detach(e));
  }

  async detach(e: ContactErasure): Promise<void> {
    const phones = e.phoneE164 ? phoneDigitVariants(e.phoneE164) : [];
    e.counts.orders += await this.store.run(e.workspaceId, async (tx) => {
      await tx.deleteDrafts(e.conversationIds);
      const orders = await tx.ordersOf(e.conversationIds, phones);
      for (const order of orders) {
        const people = anonymizeOrderPeople(order, phones, DELETED_CUSTOMER_NAME);
        await tx.anonymize(order.id, people, orderSearchText({ ...order, ...people }));
      }
      return orders.length;
    });
  }
}
