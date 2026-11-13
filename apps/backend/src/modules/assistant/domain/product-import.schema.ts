/**
 * The data shapes of the product import (T-173, spec §5): the mapping spec the model writes, the
 * owner's overrides, and the drafts the engine (`product-import.ts`) produces. Pure.
 */
import { z } from 'zod';

// ─── Limits ───────────────────────────────────────────────────────────────────

export const IMPORT_MAX_DATA_ROWS = 300;
export const IMPORT_MAX_COLUMNS = 40;
export const IMPORT_MAX_VARIANTS = 100;
export const IMPORT_MAX_OVERRIDES = 300;
export const MAX_IMAGES = 5;
export const NAME_MAX = 200;
export const DESCRIPTION_MAX = 5_000;
export const CATEGORY_MAX = 120;
export const VARIANT_NAME_MAX = 120;
export const CODE_MAX = 64;
export const DERIVED_CODE_MAX = 48;
export const WEIGHT_MAX = 1_000_000;
export const STOCK_MAX = 10_000_000;
export const VARIANT_NAME_COLUMNS = 3;
/** The contract's Code rule (commerce.schema.ts). */
export const CODE_RULE = /^[\p{L}\p{N}._\-/]+$/u;

// ─── The mapping spec (the `import_preview` tool input for sheets) ────────────

const Column = z
  .number()
  .int()
  .min(0)
  .max(IMPORT_MAX_COLUMNS - 1);
const Scalar = z.union([z.string().max(1_000), z.number()]);

export const ImportTransform = z.union([
  z.enum([
    'trim',
    'collapse_spaces',
    'upper',
    'lower',
    'title',
    'money_vnd',
    'number_vi',
    'weight_grams',
    'code',
  ]),
  z
    .object({
      map: z
        .record(z.string().max(1_000), z.string().max(1_000))
        .refine((m) => Object.keys(m).length <= 50, 'at most 50 map entries'),
    })
    .strict(),
  z.object({ default: Scalar }).strict(),
]);
export type ImportTransform = z.infer<typeof ImportTransform>;

const Transforms = z.array(ImportTransform).max(10).optional();

export const ImportSource = z.union([
  z.object({ col: Column, transforms: Transforms }).strict(),
  z.object({ const: Scalar, transforms: Transforms }).strict(),
  z
    .object({
      concat: z.array(Column).min(1).max(5),
      sep: z.string().max(5).optional(),
      transforms: Transforms,
    })
    .strict(),
]);
export type ImportSource = z.infer<typeof ImportSource>;

export const ImportSpec = z
  .object({
    headerRow: z.number().int().min(0).max(9),
    fields: z
      .object({
        name: ImportSource,
        price: ImportSource,
        code: ImportSource.optional(),
        sku: ImportSource.optional(),
        variantName: ImportSource.optional(),
        description: ImportSource.optional(),
        category: ImportSource.optional(),
        cost: ImportSource.optional(),
        weightGram: ImportSource.optional(),
        stock: ImportSource.optional(),
        imageUrls: ImportSource.optional(),
      })
      .strict(),
    groupBy: z.object({ col: Column }).strict().optional(),
    defaults: z
      .object({
        category: z.string().max(CATEGORY_MAX).optional(),
        visibleToBot: z.boolean().optional(),
      })
      .strict()
      .optional(),
    skipRows: z.array(z.number().int().min(0).max(400)).max(50).optional(),
  })
  .strict();
export type ImportSpec = z.infer<typeof ImportSpec>;

const NumberInput = z.union([z.number(), z.string().max(50)]).nullable();

export const ImportVariantOverride = z
  .object({
    /** 0-based index of the draft's variant. */
    index: z
      .number()
      .int()
      .min(0)
      .max(IMPORT_MAX_VARIANTS - 1),
    sku: z.string().max(200).optional(),
    name: z.string().max(1_000).optional(),
    price: NumberInput.optional(),
    cost: NumberInput.optional(),
    weightGram: NumberInput.optional(),
    stock: NumberInput.optional(),
  })
  .strict();
export type ImportVariantOverride = z.infer<typeof ImportVariantOverride>;

export const ImportDraftOverride = z
  .object({
    name: z.string().max(1_000).optional(),
    code: z.string().max(200).optional(),
    description: z.string().max(10_000).optional(),
    category: z.string().max(1_000).nullable().optional(),
    visibleToBot: z.boolean().optional(),
    variants: z.array(ImportVariantOverride).max(IMPORT_MAX_VARIANTS).optional(),
  })
  .strict();
export type ImportDraftOverride = z.infer<typeof ImportDraftOverride>;

export const IMPORT_DRAFT_KEY = /^[rp]\d{1,3}$/;

/** `{[draftKey]: fields}`, applied after the mapping and winning over it. */
export const ImportOverrides = z
  .record(z.string().regex(IMPORT_DRAFT_KEY), ImportDraftOverride)
  .refine((o) => Object.keys(o).length <= IMPORT_MAX_OVERRIDES, 'at most 300 overridden drafts');
export type ImportOverrides = z.infer<typeof ImportOverrides>;

// ─── Drafts ───────────────────────────────────────────────────────────────────

export type ProblemCode =
  | 'missing_name'
  | 'missing_price'
  | 'bad_price'
  | 'bad_code'
  | 'bad_sku'
  | 'duplicate_code_in_file'
  | 'duplicate_sku_in_file'
  | 'exists_code'
  | 'exists_sku'
  | 'too_many_variants'
  | `invalid:${string}`
  | `cut:${string}`
  | 'bad_cost'
  | 'bad_weight'
  | 'bad_stock'
  | 'group_conflict'
  | 'code_generated'
  | 'image_column_ignored'
  | `unsafe_text:${string}`
  | 'vision_failed';

export interface ImportProblem {
  field: string;
  code: ProblemCode;
  severity: 'error' | 'warning';
  row?: number;
}

export interface ImportDraftVariant {
  sku: string;
  name: string;
  price: number | null;
  cost: number | null;
  weightGram: number | null;
  stock: number | null;
}

export interface ImportDraftProduct {
  code: string;
  name: string;
  description: string;
  category: string | null;
  visibleToBot: boolean;
  imageUrls: string[];
  variants: ImportDraftVariant[];
}

export interface ImportDraft {
  /** `r<first source row>` for a sheet, `p<group index>` for photos. Stable across previews. */
  key: string;
  /** Source row indexes (sheet) or [] (photos). */
  rows: number[];
  /** Always filled by this engine; nullable for forward compatibility of stored drafts. */
  product: ImportDraftProduct | null;
  problems: ImportProblem[];
  excluded: boolean;
}

export interface VisionDraft {
  name: string;
  description: string;
  category: string | null;
  attributes: { name: string; value: string }[];
}

export interface ImportPhotoGroup {
  imageUrls: string[];
  vision: VisionDraft | null;
  visionError: string | null;
  /** Safety findings on the vision text, e.g. `unsafe_text:description` (field dropped). */
  visionWarnings?: string[];
}

export type ImportSourceData =
  | { kind: 'sheet'; rows: string[][] }
  | { kind: 'photos'; grouping: 'per_photo' | 'one_product'; groups: ImportPhotoGroup[] };

export interface BuildDraftsInput {
  source: ImportSourceData;
  /** Required for sheets, null for photos. */
  spec: ImportSpec | null;
  overrides: ImportOverrides;
  excluded: string[];
  /** Codes and SKUs that already exist in the business (from POST /products/match-codes). */
  existing: { codes: string[]; skus: string[] } | null;
  /** Drafts with a `created` result: never flagged exists_*. */
  createdKeys: ReadonlySet<string>;
  /**
   * The safety scan of the final draft text (AS-6): true when a text reads like instructions to
   * an AI (prompt injection, a role override, invisible characters). A flagged field is cleared
   * and recorded as `unsafe_text:<field>`, so a cell never reaches the shop bot as product text.
   * Injected because the scanner lives in ai-core, which the domain may not import.
   */
  unsafeText?: (text: string) => boolean;
}

const ERROR_CODES = new Set<string>([
  'missing_name',
  'missing_price',
  'bad_price',
  'bad_code',
  'bad_sku',
  'duplicate_code_in_file',
  'duplicate_sku_in_file',
  'exists_code',
  'exists_sku',
  'too_many_variants',
]);

export function severityOf(code: ProblemCode): 'error' | 'warning' {
  return ERROR_CODES.has(code) || code.startsWith('invalid:') ? 'error' : 'warning';
}

export function hasErrors(d: ImportDraft): boolean {
  return d.problems.some((p) => p.severity === 'error');
}
