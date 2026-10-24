import { z } from 'zod';

/** `#rrggbb`: the color of a source, status or tag chip. */
export const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'a color like #f26b1d')
  .transform((c) => c.toLowerCase());

// ─── Sources and pipeline statuses (docs/02 CRM-08, CRM-09) ───────────────────

/**
 * A customer source or a pipeline status. Ids are stable: renaming keeps the id,
 * and a definition in use is archived (hidden from pickers) instead of deleted,
 * so history and reports keep their labels.
 */
export const CrmOptionDto = z.object({
  id: z.uuid(),
  /** Set on built-in defaults (e.g. `hotline`, `new_data`); null for options the shop added. */
  key: z.string().nullable(),
  name: z.string(),
  color: z.string(),
  position: z.number().int(),
  archived: z.boolean(),
});
export type CrmOptionDto = z.infer<typeof CrmOptionDto>;
export const CrmOptionList = z.object({ data: z.array(CrmOptionDto) });

export const CreateCrmOptionRequest = z.object({
  name: z.string().trim().min(1).max(60),
  color: HexColor.default('#64748b'),
});
export type CreateCrmOptionRequest = z.input<typeof CreateCrmOptionRequest>;

export const UpdateCrmOptionRequest = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: HexColor.optional(),
  archived: z.boolean().optional(),
});
export type UpdateCrmOptionRequest = z.input<typeof UpdateCrmOptionRequest>;

/** The full order of the options, first to last (drag to reorder). */
export const ReorderCrmOptionsRequest = z.object({ ids: z.array(z.uuid()).min(1).max(200) });

// ─── Tags (docs/02 CRM-07) ────────────────────────────────────────────────────

/**
 * - `classification`: a label (VIP, Khách sỉ); at most one active per customer.
 * - `attribute`: a label carrying values (fields below); at most one active per customer.
 * - `work`: a task-like tag that may repeat (execution and reminders come with CRM-05).
 */
export const TagType = z.enum(['classification', 'attribute', 'work']);
export type TagType = z.infer<typeof TagType>;

/** Where a tag assignment lives. Contact and conversation tags are kept apart. */
export const TagScope = z.enum(['contact', 'conversation']);
export type TagScope = z.infer<typeof TagScope>;

export const TagFieldType = z.enum(['text', 'number', 'date', 'select', 'boolean']);

const FieldKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, 'lowercase letters, digits and _ (start with a letter)');

export const TagFieldDef = z.object({
  /** Stable key of the value in assignments; never changes once used. */
  key: FieldKey,
  label: z.string().trim().min(1).max(60),
  type: TagFieldType,
  required: z.boolean().default(false),
  /** For `select`: archived options stay readable on old assignments but cannot be chosen. */
  options: z
    .array(
      z.object({
        id: FieldKey,
        label: z.string().trim().min(1).max(60),
        archived: z.boolean().default(false),
      }),
    )
    .max(50)
    .default([]),
  archived: z.boolean().default(false),
});
export type TagFieldDef = z.infer<typeof TagFieldDef>;

export const TagDto = z.object({
  id: z.uuid(),
  name: z.string(),
  color: z.string(),
  type: TagType,
  description: z.string(),
  fields: z.array(TagFieldDef),
  /** Bumped when the fields change; assignments record the version they were filled with. */
  schemaVersion: z.number().int(),
  isSystem: z.boolean(),
  archived: z.boolean(),
  createdByName: z.string().nullable(),
  /** Active assignments on customers. */
  activeCount: z.number().int(),
  version: z.number().int(),
  updatedAt: z.iso.datetime(),
});
export type TagDto = z.infer<typeof TagDto>;
export const TagList = z.object({ data: z.array(TagDto) });

const uniqueKeys = (fields: Array<{ key: string }>) =>
  new Set(fields.map((f) => f.key)).size === fields.length;

export const CreateTagRequest = z.object({
  name: z.string().trim().min(1).max(60),
  color: HexColor.default('#f26b1d'),
  type: TagType,
  description: z.string().trim().max(300).default(''),
  fields: z
    .array(TagFieldDef)
    .max(20)
    .default([])
    .refine(uniqueKeys, 'each field needs a different key'),
});
export type CreateTagRequest = z.input<typeof CreateTagRequest>;

export const UpdateTagRequest = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: HexColor.optional(),
  description: z.string().trim().max(300).optional(),
  fields: z
    .array(TagFieldDef)
    .max(20)
    .refine(uniqueKeys, 'each field needs a different key')
    .optional(),
  archived: z.boolean().optional(),
  /** The version you loaded; a newer one answers CONFLICT. */
  expectedVersion: z.number().int().min(1),
});
export type UpdateTagRequest = z.input<typeof UpdateTagRequest>;

/** Values of an attribute tag on one customer: field key → value. */
export const TagValues = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
export type TagValues = z.infer<typeof TagValues>;

export const TagAssignmentDto = z.object({
  id: z.uuid(),
  tagId: z.uuid(),
  scope: TagScope,
  entityId: z.uuid(),
  values: TagValues,
  /** Tag schema version the values were validated against. */
  schemaVersion: z.number().int(),
  assignedAt: z.iso.datetime(),
  assignedByName: z.string().nullable(),
  removedAt: z.iso.datetime().nullable(),
  version: z.number().int(),
});
export type TagAssignmentDto = z.infer<typeof TagAssignmentDto>;
export const TagAssignmentList = z.object({ data: z.array(TagAssignmentDto) });

export const AssignTagRequest = z.object({
  tagId: z.uuid(),
  values: TagValues.default({}),
});
export type AssignTagRequest = z.input<typeof AssignTagRequest>;

export const UpdateTagAssignmentRequest = z.object({
  values: TagValues,
  expectedVersion: z.number().int().min(1),
});
export type UpdateTagAssignmentRequest = z.input<typeof UpdateTagAssignmentRequest>;

export const RemoveTagAssignmentRequest = z.object({
  reason: z.string().trim().max(300).optional(),
});
export type RemoveTagAssignmentRequest = z.input<typeof RemoveTagAssignmentRequest>;

// ─── Assignees ────────────────────────────────────────────────────────────────

/** Active members who can be picked as Sales or CSKH. */
export const CrmAssigneeList = z.object({
  data: z.array(z.object({ userId: z.uuid(), name: z.string(), role: z.string() })),
});
export type CrmAssigneeList = z.infer<typeof CrmAssigneeList>;

// ─── Auto-assignment by source (SET-02 "phân chia khách hàng", T-033) ─────────

/**
 * New customers from a source go to the Sales members listed here, in
 * proportion to their weights (weighted round robin). A customer created with
 * a Sales owner, or from a source without an enabled policy, is not touched.
 */
export const AssignmentPolicyDto = z.object({
  sourceId: z.uuid(),
  enabled: z.boolean(),
  candidates: z.array(z.object({ userId: z.uuid(), weight: z.number().int().min(1).max(10) })),
  /** 0 = never saved. */
  version: z.number().int().min(0),
});
export type AssignmentPolicyDto = z.infer<typeof AssignmentPolicyDto>;
export const AssignmentPolicyList = z.object({ data: z.array(AssignmentPolicyDto) });

export const PutAssignmentPolicyRequest = z
  .object({
    enabled: z.boolean(),
    candidates: z
      .array(z.object({ userId: z.uuid(), weight: z.number().int().min(1).max(10) }))
      .max(50),
    expectedVersion: z.number().int().min(0),
  })
  .refine((p) => new Set(p.candidates.map((c) => c.userId)).size === p.candidates.length, {
    message: 'each member at most once',
    path: ['candidates'],
  })
  .refine((p) => !p.enabled || p.candidates.length > 0, {
    message: 'an enabled policy needs at least one member',
    path: ['candidates'],
  });
export type PutAssignmentPolicyRequest = z.input<typeof PutAssignmentPolicyRequest>;
