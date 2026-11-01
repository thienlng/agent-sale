export {
  CRM_FACADE,
  type ConversationTagFilter,
  type ConversationTagMatch,
  type CrmFacade,
} from './crm.facade.js';
export * from './crm.events.js';
export {
  CONTACT_SYNC_FACADE,
  ContactAlreadyLinkedError,
  type ContactExternalSource,
  ContactExternalLinkConflictError,
  type ContactSyncFacade,
  type ExternalContactInput,
  InvalidExternalContactIdError,
  type PushableContact,
  type UpsertExternalContactResult,
} from './contact-sync.facade.js';
