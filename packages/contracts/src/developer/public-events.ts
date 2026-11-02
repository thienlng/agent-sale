import { z } from 'zod';

import { OrderSource, OrderStatus } from '../commerce/commerce.schema.js';
import { SaasBillingPeriod, SaasStage } from '../saas/saas.schema.js';

/**
 * The public event catalog (ADR-022 §7): the only events that leave the platform through
 * webhooks. Each public type maps from one internal outbox type to a stable `data` payload. Public
 * types carry no `.vN` suffix; a breaking change of a payload adds a new type (e.g.
 * `crm.contact.created.v2`) delivered next to the old one during a deprecation window.
 */
const contact = { contactId: z.uuid(), actorUserId: z.uuid().nullable() };
const booking = { bookingId: z.uuid(), code: z.string(), propertyId: z.uuid() };
const order = { orderId: z.uuid(), code: z.string(), actorUserId: z.uuid().nullable() };
const tag = { ...contact, tagId: z.uuid(), scope: z.enum(['contact', 'conversation']) };

export const PUBLIC_EVENT_DATA = {
  'crm.contact.created': z.object({
    ...contact,
    sourceId: z.uuid().nullable(),
    origin: z.enum(['channel', 'manual', 'import']),
    statusId: z.uuid().nullable(),
  }),
  'crm.contact.updated': z.object({ ...contact, fields: z.array(z.string()) }),
  'crm.contact.status_changed': z.object({
    ...contact,
    fromStatusId: z.uuid().nullable(),
    toStatusId: z.uuid().nullable(),
  }),
  'crm.contact.assigned': z.object({
    ...contact,
    role: z.enum(['sales', 'care']),
    fromUserId: z.uuid().nullable(),
    toUserId: z.uuid().nullable(),
  }),
  'crm.tag.assigned': z.object(tag),
  'crm.tag.removed': z.object(tag),
  'lodging.booking.created': z.object({
    ...booking,
    status: z.string(),
    checkIn: z.string(),
    checkOut: z.string(),
    source: z.string().nullable(),
  }),
  'lodging.booking.confirmed': z.object(booking),
  'lodging.booking.cancelled': z.object(booking),
  'lodging.booking.expired': z.object(booking),
  'lodging.booking.checked_in': z.object(booking),
  'lodging.booking.checked_out': z.object(booking),
  'commerce.order.created': z.object({
    ...order,
    status: OrderStatus,
    source: OrderSource,
    contactId: z.uuid().nullable(),
    total: z.number().int(),
    itemQty: z.number().int(),
  }),
  'commerce.order.status_changed': z.object({
    ...order,
    fromStatus: OrderStatus.nullable(),
    toStatus: OrderStatus,
  }),
  'saas.subscription.changed': z.object({
    subscriptionId: z.uuid(),
    contactId: z.uuid(),
    planName: z.string(),
    stage: SaasStage,
    fromStage: SaasStage.nullable(),
    billingPeriod: SaasBillingPeriod,
    mrr: z.number().int().min(0),
    trialEndsOn: z.iso.date().nullable(),
    renewsOn: z.iso.date().nullable(),
    canceledOn: z.iso.date().nullable(),
    actorUserId: z.uuid().nullable(),
  }),
} as const;

export type PublicEventType = keyof typeof PUBLIC_EVENT_DATA;
export const PUBLIC_EVENT_TYPES = Object.keys(PUBLIC_EVENT_DATA) as PublicEventType[];
export const PublicEventType = z.enum(
  PUBLIC_EVENT_TYPES as [PublicEventType, ...PublicEventType[]],
);

/** The internal outbox type each public type is mapped from. */
export const PUBLIC_EVENT_SOURCES = {
  'crm.contact.created': 'crm.contact.created.v1',
  'crm.contact.updated': 'crm.contact.updated.v1',
  'crm.contact.status_changed': 'crm.contact.status_changed.v1',
  'crm.contact.assigned': 'crm.contact.assigned.v1',
  'crm.tag.assigned': 'crm.tag.assigned.v1',
  'crm.tag.removed': 'crm.tag.removed.v1',
  'lodging.booking.created': 'lodging.booking.created.v1',
  'lodging.booking.confirmed': 'lodging.booking.confirmed.v1',
  'lodging.booking.cancelled': 'lodging.booking.cancelled.v1',
  'lodging.booking.expired': 'lodging.booking.expired.v1',
  'lodging.booking.checked_in': 'lodging.booking.checked_in.v1',
  'lodging.booking.checked_out': 'lodging.booking.checked_out.v1',
  'commerce.order.created': 'commerce.order.created.v1',
  'commerce.order.status_changed': 'commerce.order.status_changed.v1',
  'saas.subscription.changed': 'saas.subscription.changed.v1',
} as const satisfies Record<PublicEventType, string>;

/** Sent by "Send test event": not in the catalog, never produced by the platform otherwise. */
export const WEBHOOK_TEST_EVENT_TYPE = 'webhook.test';

/**
 * The JSON body of every webhook POST. `id` is stable across retries and resends: receivers
 * dedupe by it (delivery is at-least-once).
 */
export const WebhookEnvelope = z.object({
  id: z.uuid(),
  type: z.string(),
  workspaceId: z.uuid(),
  occurredAt: z.iso.datetime(),
  data: z.record(z.string(), z.unknown()),
});
export type WebhookEnvelope = z.infer<typeof WebhookEnvelope>;

/** Header names of a webhook POST (ADR-022 §5). */
export const WEBHOOK_HEADERS = {
  eventId: 'Rapiz-Event-Id',
  eventType: 'Rapiz-Event-Type',
  /** `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>` (one `v1` per active secret). */
  signature: 'Rapiz-Signature',
} as const;
