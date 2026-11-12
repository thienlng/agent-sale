import { z } from 'zod';

import { TagAssignmentDto } from './crm-settings.schema.js';
import { REQUEST_HISTORY_TYPES } from './customer-request.js';

// ─── Contacts (docs/02 CRM-01..03) ────────────────────────────────────────────

/** Blank means "not given". */
const optional = <T extends z.ZodType>(schema: T) =>
  schema
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null));

const Phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 .()-]{8,20}$/, 'invalid phone number');
const Email = z.email().max(254);
export const Gender = z.enum(['male', 'female', 'other']);

/** Editable profile fields; every one may be left out or cleared. */
const ContactFields = {
  name: optional(z.string().trim().min(1).max(120)),
  phone: optional(Phone),
  email: optional(Email),
  birthday: optional(z.iso.date()),
  gender: optional(Gender),
  address: optional(z.string().trim().max(300)),
  province: optional(z.string().trim().max(120)),
  ward: optional(z.string().trim().max(120)),
  sourceId: optional(z.uuid()),
  statusId: optional(z.uuid()),
  /** "Sales": who sells to this customer. */
  salesUserId: optional(z.uuid()),
  /** "CSKH": who takes care of this customer after the sale. */
  careUserId: optional(z.uuid()),
  /** Ad / campaign reference the customer came from. */
  adRef: optional(z.string().trim().max(120)),
  /** A short fixed note on the profile (not a timeline note). */
  profileNote: optional(z.string().trim().max(500)),
};

/** At least one of name, a usable phone or a valid email (CRM-02). */
export const CreateContactRequest = z
  .object({
    ...ContactFields,
    /** One per create form: sending it again returns the contact created the first time. */
    clientRequestId: z.uuid().optional(),
  })
  .refine((c) => Boolean(c.name || c.phone || c.email), {
    message: 'give a name, a phone number or an email',
    path: ['name'],
  });
export type CreateContactRequest = z.input<typeof CreateContactRequest>;

/** Only the fields sent change; `null` or "" clears one. Stale `expectedVersion` → CONFLICT. */
export const UpdateContactRequest = z.object({
  ...ContactFields,
  expectedVersion: z.number().int().min(1),
});
export type UpdateContactRequest = z.input<typeof UpdateContactRequest>;

export const ContactExternalLink = z.object({
  /** `kiotviet`: a PMS customer (ADR-017). `rapiz`: a platform account in Rapiz HQ (ADR-021). */
  source: z.enum(['kiotviet', 'rapiz']),
  id: z.string().min(1),
});
export type ContactExternalLink = z.infer<typeof ContactExternalLink>;

export const ContactDto = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  /** E.164 (`+84…`), used for duplicates and search; null when the phone is not usable. */
  phoneNormalized: z.string().nullable(),
  email: z.string().nullable(),
  birthday: z.iso.date().nullable(),
  gender: Gender.nullable(),
  address: z.string().nullable(),
  province: z.string().nullable(),
  ward: z.string().nullable(),
  /** When a phone / an address was first given (kept when only other fields change). */
  phoneProvidedAt: z.iso.datetime().nullable(),
  addressProvidedAt: z.iso.datetime().nullable(),
  sourceId: z.uuid().nullable(),
  firstSourceId: z.uuid().nullable(),
  statusId: z.uuid().nullable(),
  salesUserId: z.uuid().nullable(),
  careUserId: z.uuid().nullable(),
  adRef: z.string().nullable(),
  profileNote: z.string(),
  /** Active tags on the customer. */
  tags: z.array(TagAssignmentDto),
  /**
   * The PMS customer this customer is linked to (ADR-017). The PMS then owns name, phone, email,
   * address, birthday and gender; other fields stay editable here.
   */
  external: ContactExternalLink.nullable().default(null),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ContactDto = z.infer<typeof ContactDto>;

// ─── Notes and history ────────────────────────────────────────────────────────

export const ContactNoteDto = z.object({
  id: z.uuid(),
  body: z.string(),
  /** Null for system and bot notes. The author (or an owner or admin) may delete the note. */
  authorUserId: z.uuid().nullable().default(null),
  authorName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Set when the note was edited; earlier bodies are in the history. */
  editedAt: z.iso.datetime().nullable(),
  version: z.number().int(),
});
export type ContactNoteDto = z.infer<typeof ContactNoteDto>;
export const ContactNoteList = z.object({ data: z.array(ContactNoteDto) });

export const CreateContactNoteRequest = z.object({ body: z.string().trim().min(1).max(5000) });
export const UpdateContactNoteRequest = z.object({
  body: z.string().trim().min(1).max(5000),
  expectedVersion: z.number().int().min(1),
});

/**
 * The name a deleted customer's orders and stay bookings keep (docs/09 §10): business records stay,
 * the person's name, phone, email and address go. Stored as data, shown as it is.
 */
export const DELETED_CUSTOMER_NAME = 'Khách đã xoá';

/** What deleting a customer removed (`DELETE /contacts/{id}`); counts only. */
export const ContactDeletionResult = z.object({
  contactId: z.uuid(),
  /** Conversations removed with their messages, notes, care steps and Brain signals. */
  conversations: z.number().int().min(0),
  messages: z.number().int().min(0),
  /** Website chat pictures the customer uploaded, removed from storage. */
  files: z.number().int().min(0),
  /** Orders kept with the customer's name replaced and phone, email and address removed. */
  orders: z.number().int().min(0),
  /** Stay bookings kept the same way. */
  bookings: z.number().int().min(0),
});
export type ContactDeletionResult = z.infer<typeof ContactDeletionResult>;

export const CONTACT_HISTORY_TYPES = [
  'contact.created',
  'contact.updated',
  'contact.status_changed',
  'contact.assigned',
  'note.added',
  'note.edited',
  'note.deleted',
  'tag.added',
  'tag.updated',
  'tag.removed',
  ...REQUEST_HISTORY_TYPES,
] as const;
export const ContactHistoryType = z.enum(CONTACT_HISTORY_TYPES);
export type ContactHistoryType = z.infer<typeof ContactHistoryType>;

/** One audit entry: what changed (field → {from, to}), who and when. */
export const ContactHistoryEntry = z.object({
  id: z.uuid(),
  type: ContactHistoryType,
  changes: z.record(z.string(), z.object({ from: z.unknown(), to: z.unknown() })),
  /** Extra context, e.g. the note body or the tag id. */
  data: z.record(z.string(), z.unknown()),
  actorName: z.string().nullable(),
  at: z.iso.datetime(),
});
export type ContactHistoryEntry = z.infer<typeof ContactHistoryEntry>;

export const ContactHistoryQuery = z.object({
  type: ContactHistoryType.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  order: z.enum(['desc', 'asc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export const ContactHistoryList = z.object({ data: z.array(ContactHistoryEntry) });
