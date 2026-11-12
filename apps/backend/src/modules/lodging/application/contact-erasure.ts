import { DELETED_CUSTOMER_NAME } from '@agent-sales/contracts';
import { phoneDigitVariants } from '@agent-sales/shared';
import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';

import {
  CONTACT_LIFECYCLE,
  type ContactErasure,
  type ContactLifecycle,
} from '../../crm/api/index.js';
import { BOOKING_ERASURE_STORE, type BookingErasureStore } from './ports/booking-erasure-store.js';

/**
 * Lodging's part of deleting a customer (docs/09 §10, crm `ContactLifecycle`, `detach` phase). Stay
 * bookings are business records and stay, with the guest name replaced by `DELETED_CUSTOMER_NAME`,
 * the phone cleared and the customer link removed; a booking found only by the phone is the
 * customer's when its guest name is theirs or empty. The bot's pending hold summaries go.
 */
@Injectable()
export class BookingErasure implements OnModuleInit {
  constructor(
    @Inject(BOOKING_ERASURE_STORE) private readonly store: BookingErasureStore,
    @Inject(CONTACT_LIFECYCLE) @Optional() private readonly lifecycle?: ContactLifecycle,
  ) {}

  onModuleInit(): void {
    this.lifecycle?.onDetach((e) => this.detach(e));
  }

  async detach(e: ContactErasure): Promise<void> {
    e.counts.bookings += await this.store.run(e.workspaceId, async (tx) => {
      await tx.deleteHoldDrafts(e.contactId, e.conversationIds);
      return tx.anonymizeBookings({
        contactId: e.contactId,
        conversationIds: e.conversationIds,
        phoneDigits: e.phoneE164 ? phoneDigitVariants(e.phoneE164) : [],
        contactName: e.name,
        guestName: DELETED_CUSTOMER_NAME,
      });
    });
  }
}
