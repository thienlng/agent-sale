import type { ContactDto, CustomerRequestKind } from '@agent-sales/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { WorkspaceId } from '@agent-sales/shared';

import type {
  BotRequestResult,
  CrmFacade,
  ConversationTagFilter,
  RequestsRecorded,
} from '../api/crm.facade.js';
import { ConversationTagsService } from './conversation-tags.service.js';
import { ContactService } from './contact.service.js';
import { CustomerRequestService } from './customer-request.service.js';
import { OwnershipService } from './ownership.service.js';

/** Delegates to the use-case services; no logic of its own. */
@Injectable()
export class CrmFacadeImpl implements CrmFacade {
  constructor(
    @Inject(ContactService) private readonly contacts: ContactService,
    @Inject(OwnershipService) private readonly ownership: OwnershipService,
    @Inject(ConversationTagsService)
    private readonly conversationTagsService: ConversationTagsService,
    @Inject(CustomerRequestService) private readonly requests: CustomerRequestService,
  ) {}

  getContact(ws: WorkspaceId, id: string): Promise<ContactDto> {
    return this.contacts.get(ws, id);
  }

  ownedContactCounts(ws: WorkspaceId, userId: string) {
    return this.ownership.ownedContactCounts(ws, userId);
  }

  contactsCreated(ws: WorkspaceId, q: { since: Date; until: Date }) {
    return this.ownership.contactsCreated(ws, q);
  }

  contactNames(ws: WorkspaceId, ids: readonly string[]) {
    return this.ownership.namesOf(ws, ids);
  }

  reassignContacts(ws: WorkspaceId, input: Parameters<OwnershipService['reassignContacts']>[1]) {
    return this.ownership.reassignContacts(ws, input);
  }

  upsertLeadByPhone(ws: WorkspaceId, input: Parameters<ContactService['upsertLead']>[1]) {
    return this.contacts.upsertLead(ws, input);
  }

  upsertLeadByEmail(ws: WorkspaceId, input: Parameters<ContactService['upsertLeadByEmail']>[1]) {
    return this.contacts.upsertLeadByEmail(ws, input);
  }

  moveContactStatus(
    ws: WorkspaceId,
    contactId: string,
    statusKey: string,
    opts: { forwardOnly: boolean; keep?: readonly string[] },
  ) {
    return this.contacts.moveStatusByKey(ws, contactId, statusKey, opts);
  }

  addContactNote(ws: WorkspaceId, contactId: string, body: string, authorName: string) {
    return this.contacts.addSystemNote(ws, contactId, { body }, authorName);
  }

  recordContactBot(ws: WorkspaceId, contactId: string, botId: string) {
    return this.contacts.recordBot(ws, contactId, botId);
  }

  conversationTags(ws: WorkspaceId, ids: readonly string[]) {
    return this.conversationTagsService.chips(ws, ids);
  }

  conversationIdsByTags(ws: WorkspaceId, filter: ConversationTagFilter) {
    return this.conversationTagsService.idsByTags(ws, filter);
  }

  listConversationTags(ws: WorkspaceId, conversationId: string) {
    return this.conversationTagsService.list(ws, conversationId);
  }

  assignConversationTag(ws: WorkspaceId, conversationId: string, input: unknown, actor: string) {
    return this.conversationTagsService.assign(ws, conversationId, input, actor);
  }

  recordBotRequest(
    ws: WorkspaceId,
    input: {
      kind: CustomerRequestKind;
      details: unknown;
      preview: boolean;
      catalogNames?: readonly string[];
    },
  ): Promise<BotRequestResult> {
    return this.requests.recordFromBot(ws, input);
  }

  requestsRecorded(
    ws: WorkspaceId,
    q: { since: Date; until: Date; kinds?: readonly CustomerRequestKind[] },
  ): Promise<RequestsRecorded> {
    return this.requests.recorded(ws, q);
  }
}
