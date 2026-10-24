import type { ContactDto } from '@agent-sales/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { WorkspaceId } from '@agent-sales/shared';

import type { CrmFacade } from '../api/crm.facade.js';
import { ContactService } from './contact.service.js';
import { OwnershipService } from './ownership.service.js';

/** Delegates to the use-case services; no logic of its own. */
@Injectable()
export class CrmFacadeImpl implements CrmFacade {
  constructor(
    @Inject(ContactService) private readonly contacts: ContactService,
    @Inject(OwnershipService) private readonly ownership: OwnershipService,
  ) {}

  getContact(ws: WorkspaceId, id: string): Promise<ContactDto> {
    return this.contacts.get(ws, id);
  }

  ownedContactCounts(ws: WorkspaceId, userId: string) {
    return this.ownership.ownedContactCounts(ws, userId);
  }

  contactNames(ws: WorkspaceId, ids: readonly string[]) {
    return this.ownership.namesOf(ws, ids);
  }

  reassignContacts(ws: WorkspaceId, input: Parameters<OwnershipService['reassignContacts']>[1]) {
    return this.ownership.reassignContacts(ws, input);
  }
}
