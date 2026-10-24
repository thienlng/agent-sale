import { z } from 'zod';

import { TagAssignmentDto } from './crm-settings.schema.js';

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
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ContactDto = z.infer<typeof ContactDto>;

// ─── Notes and history ────────────────────────────────────────────────────────

export const ContactNoteDto = z.object({
  id: z.uuid(),
  body: z.string(),
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

export const CONTACT_HISTORY_TYPES = [
  'contact.created',
  'contact.updated',
  'contact.status_changed',
  'contact.assigned',
  'note.added',
  'note.edited',
  'tag.added',
  'tag.updated',
  'tag.removed',
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
