import type { ContactDeletionResult } from '@agent-sales/contracts';
import { isUuid, userId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';
import {
  CONTACT_LIFECYCLE,
  type ContactErasure,
  type ContactLifecycle,
} from '../api/contact-lifecycle.js';
import { ContactNotFoundError } from '../domain/crm.errors.js';
import { event } from './contact.service.js';
import { canSee, type Viewer } from './crm-rules.js';
import { CRM_STORE, type CrmStore } from './ports/crm-store.js';

const log = new Logger('ContactDeletion');

/**
 * Deletes a customer on request (docs/09 §10, PDPA): the modules that hold the customer's
 * conversations, orders, bookings and visitor records erase or anonymize them first through
 * `ContactLifecycle`, then the profile, notes, history, tags and tasks go in one transaction with
 * the audit event and `crm.contact.deleted.v1`. A failure before that transaction leaves the
 * customer in place; every step is idempotent, so the delete can simply be retried.
 */
@Injectable()
export class ContactDeletionService {
  constructor(
    @Inject(CRM_STORE) private readonly store: CrmStore,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
    @Inject(CONTACT_LIFECYCLE) @Optional() private readonly lifecycle?: ContactLifecycle,
  ) {}

  async delete(ws: WorkspaceId, contactId: string, viewer: Viewer): Promise<ContactDeletionResult> {
    const contact = await this.store.run(ws, async (tx) => {
      const c = isUuid(contactId) ? await tx.contacts.find(contactId) : null;
      if (!c || !canSee(c, viewer)) throw new ContactNotFoundError(contactId);
      return c;
    });
    const actorName = await this.identity.displayName(userId(viewer.userId));
    const erasure: ContactErasure = {
      workspaceId: ws,
      contactId,
      phoneE164: contact.phoneNormalized,
      conversationIds: [],
      counts: { conversations: 0, messages: 0, files: 0, orders: 0, bookings: 0 },
    };
    await this.lifecycle?.beforeDelete(erasure);
    await this.store.run(ws, async (tx) => {
      // A concurrent delete already finished: the outcome is the same, report what this one did.
      if (!(await tx.contacts.find(contactId, { forUpdate: true }))) return;
      await tx.eraseContact(contactId, erasure.conversationIds);
      const now = new Date();
      // Ids and counts only: the person's name, phone and messages must not survive in the trail.
      await tx.audit(ws, {
        actorUserId: viewer.userId,
        actorName,
        action: 'contact.deleted',
        targetType: 'contact',
        targetId: contactId,
        data: { ...erasure.counts },
      });
      await tx.outbox(ws, {
        type: 'crm.contact.deleted.v1',
        aggregateId: contactId,
        payload: event(ws, contactId, viewer.userId, now, {}),
      });
    });
    log.log(
      `Customer ${contactId} deleted in workspace ${ws}: ${erasure.counts.conversations} conversations removed, ${erasure.counts.orders} orders and ${erasure.counts.bookings} bookings anonymized`,
    );
    return { contactId, ...erasure.counts };
  }
}
