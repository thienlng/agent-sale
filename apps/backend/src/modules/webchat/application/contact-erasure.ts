import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';

import {
  CONTACT_LIFECYCLE,
  type ContactErasure,
  type ContactLifecycle,
} from '../../crm/api/index.js';
import { VISITOR_STORE, type VisitorStore } from './ports/visitor-store.js';

/**
 * Website chat's part of deleting a customer (docs/09 §10, crm `ContactLifecycle`, `detach`
 * phase): the visitor rows (pages seen, phone and email left) of the customer and of its
 * conversations go. The visitor's browser keeps its token; a new message starts a new visitor row.
 */
@Injectable()
export class VisitorErasure implements OnModuleInit {
  constructor(
    @Inject(VISITOR_STORE) private readonly visitors: VisitorStore,
    @Inject(CONTACT_LIFECYCLE) @Optional() private readonly lifecycle?: ContactLifecycle,
  ) {}

  onModuleInit(): void {
    this.lifecycle?.onDetach((e) => this.detach(e));
  }

  async detach(e: ContactErasure): Promise<void> {
    await this.visitors.forget(e.workspaceId, e.contactId, e.conversationIds);
  }
}
