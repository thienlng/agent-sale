import { z } from 'zod';

/**
 * Integration events published by the crm module through the outbox
 * ("<module>.<thing>.<verb>.v<n>"). Consumers: analytics projections (ANA-02).
 */
const base = {
  workspaceId: z.uuid(),
  contactId: z.uuid(),
  actorUserId: z.uuid().nullable(),
  occurredAt: z.iso.datetime(),
};

export const ContactCreatedV1 = z.object({
  type: z.literal('crm.contact.created.v1'),
  ...base,
  sourceId: z.uuid().nullable(),
});
export const ContactUpdatedV1 = z.object({
  type: z.literal('crm.contact.updated.v1'),
  ...base,
  fields: z.array(z.string()),
});
export const ContactStatusChangedV1 = z.object({
  type: z.literal('crm.contact.status_changed.v1'),
  ...base,
  fromStatusId: z.uuid().nullable(),
  toStatusId: z.uuid().nullable(),
});
export const ContactAssignedV1 = z.object({
  type: z.literal('crm.contact.assigned.v1'),
  ...base,
  role: z.enum(['sales', 'care']),
  fromUserId: z.uuid().nullable(),
  toUserId: z.uuid().nullable(),
});
export const TagAssignedV1 = z.object({
  type: z.literal('crm.tag.assigned.v1'),
  ...base,
  assignmentId: z.uuid(),
  tagId: z.uuid(),
  scope: z.enum(['contact', 'conversation']),
});
export const TagRemovedV1 = z.object({
  type: z.literal('crm.tag.removed.v1'),
  ...base,
  assignmentId: z.uuid(),
  tagId: z.uuid(),
  scope: z.enum(['contact', 'conversation']),
});

export const CrmEvents = z.discriminatedUnion('type', [
  ContactCreatedV1,
  ContactUpdatedV1,
  ContactStatusChangedV1,
  ContactAssignedV1,
  TagAssignedV1,
  TagRemovedV1,
]);
export type CrmEvent = z.infer<typeof CrmEvents>;
