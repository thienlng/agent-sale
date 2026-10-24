/** Integration events published by crm. Payload schemas live in packages/contracts/src/crm/. */
export {
  ContactAssignedV1,
  ContactCreatedV1,
  ContactStatusChangedV1,
  ContactUpdatedV1,
  CrmEvents,
  type CrmEvent,
  TagAssignedV1,
  TagRemovedV1,
} from '@agent-sales/contracts';

export const CRM_EVENT_TYPES = [
  'crm.contact.created.v1',
  'crm.contact.updated.v1',
  'crm.contact.status_changed.v1',
  'crm.contact.assigned.v1',
  'crm.tag.assigned.v1',
  'crm.tag.removed.v1',
] as const;
