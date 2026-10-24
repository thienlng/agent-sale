import { z } from 'zod';

import { ContactDto } from './contact.schema.js';

// ─── Typed filters (CRM-02) ───────────────────────────────────────────────────

/** Fields a filter rule can test, by kind. Each kind has its own operators. */
export const CONTACT_FILTER_FIELDS = {
  name: 'text',
  phone: 'text',
  email: 'text',
  address: 'text',
  profileNote: 'text',
  adRef: 'text',
  gender: 'enum',
  sourceId: 'ref',
  statusId: 'ref',
  salesUserId: 'ref',
  careUserId: 'ref',
  tagId: 'tag',
  createdAt: 'date',
  updatedAt: 'date',
  birthday: 'date',
} as const;
export type ContactFilterField = keyof typeof CONTACT_FILTER_FIELDS;
export type ContactFilterKind = (typeof CONTACT_FILTER_FIELDS)[ContactFilterField];

/**
 * Operators per kind. Null rule: a customer without the value matches
 * `is_empty`, `neq`, `not_contains`, `not_in` and `has_none`, and never a positive operator.
 */
export const FILTER_OPERATORS = {
  text: ['contains', 'not_contains', 'eq', 'neq', 'is_set', 'is_empty'],
  enum: ['in', 'not_in', 'is_set', 'is_empty'],
  ref: ['in', 'not_in', 'is_set', 'is_empty'],
  tag: ['has_any', 'has_none'],
  date: ['before', 'after', 'between', 'is_set', 'is_empty'],
} as const satisfies Record<ContactFilterKind, readonly string[]>;

const NO_VALUE = new Set(['is_set', 'is_empty']);

export const ContactFilterRule = z
  .object({
    field: z.enum(
      Object.keys(CONTACT_FILTER_FIELDS) as [ContactFilterField, ...ContactFilterField[]],
    ),
    op: z.string(),
    /** Text for text ops; a list for in/not_in/has_*; a date or {from,to} for dates. */
    value: z
      .union([
        z.string().max(200),
        z.array(z.string().max(100)).max(100),
        z.object({ from: z.iso.date(), to: z.iso.date() }),
      ])
      .optional(),
  })
  .superRefine((r, ctx) => {
    const kind = CONTACT_FILTER_FIELDS[r.field];
    const ops: readonly string[] = FILTER_OPERATORS[kind];
    if (!ops.includes(r.op)) {
      ctx.addIssue({
        code: 'custom',
        path: ['op'],
        message: `unsupported operator for ${r.field}`,
      });
      return;
    }
    if (NO_VALUE.has(r.op)) return;
    const v = r.value;
    const ok =
      r.op === 'between'
        ? typeof v === 'object' && v !== null && !Array.isArray(v)
        : ['in', 'not_in', 'has_any', 'has_none'].includes(r.op)
          ? Array.isArray(v) && v.length > 0
          : kind === 'date'
            ? z.iso.date().safeParse(v).success
            : typeof v === 'string' && v.trim() !== '';
    if (!ok) ctx.addIssue({ code: 'custom', path: ['value'], message: 'missing or invalid value' });
  });
export type ContactFilterRule = z.infer<typeof ContactFilterRule>;

/** Versioned query: `all` = AND, `any` = OR over the rules. */
export const ContactFilter = z.object({
  v: z.literal(1).default(1),
  match: z.enum(['all', 'any']).default('all'),
  rules: z.array(ContactFilterRule).max(20).default([]),
  /** Only customers whose normalized phone is shared with another customer (empty phones never). */
  duplicatesOnly: z.boolean().default(false),
});
export type ContactFilter = z.infer<typeof ContactFilter>;
export type ContactFilterInput = z.input<typeof ContactFilter>;

export const ContactSort = z
  .array(
    z.object({
      field: z.enum(['name', 'createdAt', 'updatedAt', 'birthday']),
      dir: z.enum(['asc', 'desc']),
    }),
  )
  .max(3)
  .default([{ field: 'createdAt', dir: 'desc' }]);
export type ContactSort = z.infer<typeof ContactSort>;

/** Search: name, phone or email contains `q` (accent-insensitive), AND the filter. */
export const ContactQueryRequest = z.object({
  q: z.string().trim().max(100).optional(),
  filter: ContactFilter.default({ v: 1, match: 'all', rules: [], duplicatesOnly: false }),
  sort: ContactSort,
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export type ContactQueryRequest = z.input<typeof ContactQueryRequest>;

export const ContactListResponse = z.object({
  data: z.array(ContactDto),
  /** Counted with the same compiled query as the rows. */
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type ContactListResponse = z.infer<typeof ContactListResponse>;

// ─── Saved views ──────────────────────────────────────────────────────────────

/** A named query with sort and columns. Private views are visible to their owner only. */
export const SavedViewDto = z.object({
  id: z.uuid(),
  name: z.string(),
  visibility: z.enum(['private', 'shared']),
  isOwner: z.boolean(),
  ownerName: z.string().nullable(),
  q: z.string(),
  filter: ContactFilter,
  sort: ContactSort,
  columns: z.array(z.string()),
  version: z.number().int(),
  updatedAt: z.iso.datetime(),
});
export type SavedViewDto = z.infer<typeof SavedViewDto>;
export const SavedViewList = z.object({ data: z.array(SavedViewDto) });

export const CreateSavedViewRequest = z.object({
  name: z.string().trim().min(1).max(80),
  visibility: z.enum(['private', 'shared']).default('private'),
  q: z.string().trim().max(100).default(''),
  filter: ContactFilter,
  sort: ContactSort,
  columns: z.array(z.string().max(40)).max(40).default([]),
});
export type CreateSavedViewRequest = z.input<typeof CreateSavedViewRequest>;

export const UpdateSavedViewRequest = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  visibility: z.enum(['private', 'shared']).optional(),
  q: z.string().trim().max(100).optional(),
  filter: ContactFilter.optional(),
  sort: ContactSort.optional(),
  columns: z.array(z.string().max(40)).max(40).optional(),
  expectedVersion: z.number().int().min(1),
});
export type UpdateSavedViewRequest = z.input<typeof UpdateSavedViewRequest>;
