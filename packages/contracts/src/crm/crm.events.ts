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
  /** Where the customer came from; events written before this field existed were all manual. */
  origin: z.enum(['channel', 'manual', 'import']).default('manual'),
  /** The customer was created with a phone number. */
  phoneCaptured: z.boolean().default(false),
});
export const ContactUpdatedV1 = z.object({
  type: z.literal('crm.contact.updated.v1'),
  ...base,
  fields: z.array(z.string()),
  /** This edit stored a phone number on a customer that had none. */
  phoneCaptured: z.boolean().default(false),
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
