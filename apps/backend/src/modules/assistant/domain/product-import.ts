/**
 * The declarative product import engine (T-173, spec §5). The model writes a mapping spec
 * (columns → product fields, plus a closed list of transforms); this pure code applies it to the
 * owner's rows, or to the photo drafts, and reports each draft's problems. No regex, formula or
 * expression from the model is ever evaluated. Pure: no Nest, no DB, no clock, no randomness.
 */
import { UpsertProductRequest } from '@agent-sales/contracts';

import {
  cell,
  columnsOf,
  cut,
  evaluate,
  numeric,
  NUMERIC_BAD,
  text,
  codeOf,
  validCode,
  dataRows,
  differingColumns,
  groupRows,
  type Evaluated,
  type NumericField,
  type Sink,
} from './import-fields.js';
import {
  CATEGORY_MAX,
  CODE_MAX,
  DERIVED_CODE_MAX,
  DESCRIPTION_MAX,
  hasErrors,
  IMPORT_MAX_VARIANTS,
  MAX_IMAGES,
  NAME_MAX,
  severityOf,
  VARIANT_NAME_MAX,
  type BuildDraftsInput,
  type ImportDraft,
  type ImportDraftOverride,
  type ImportPhotoGroup,
  type ImportProblem,
  type ImportSource,
  type ImportSpec,
  type ProblemCode,
  type VisionDraft,
} from './product-import.schema.js';

export * from './product-import.schema.js';
export { codeOf } from './import-fields.js';
export { codesOf, draftsHash } from './import-digest.js';
export { photoSample, sheetSample } from './import-samples.js';

// ─── Building drafts ──────────────────────────────────────────────────────────

/** A draft while it is being built: the mapped values before codes are settled. */
interface Working {
  key: string;
  rows: number[];
  firstRow: number | undefined;
  name: string;
  description: string;
  category: string | null;
  visibleToBot: boolean;
  imageUrls: string[];
  /** The mapped product code; '' when it must be derived. */
  code: string;
  variants: {
    row: number | undefined;
    sku: string;
    name: string;
    price: number | null;
    cost: number | null;
    weightGram: number | null;
    stock: number | null;
    priceBad: boolean;
  }[];
  problems: ImportProblem[];
  sink: Sink;
}

function newWorking(key: string, rows: number[]): Working {
  const problems: ImportProblem[] = [];
  const seen = new Set<string>();
  return {
    key,
    rows,
    firstRow: rows[0],
    name: '',
    description: '',
    category: null,
    visibleToBot: true,
    imageUrls: [],
    code: '',
    variants: [],
    problems,
    sink: {
      add(field, code, row) {
        const id = `${field}|${code}|${row ?? ''}`;
        if (seen.has(id)) return;
        seen.add(id);
        problems.push({
          field,
          code,
          severity: severityOf(code),
          ...(row === undefined ? {} : { row }),
        });
      },
    },
  };
}

const PRODUCT_TEXT_FIELDS = ['name', 'code', 'description', 'category'] as const;

function sheetDrafts(rows: string[][], spec: ImportSpec): Working[] {
  const f = spec.fields;
  const usedColumns = new Set<number>([
    ...Object.values(f).flatMap((s) => columnsOf(s)),
    ...(spec.groupBy ? [spec.groupBy.col] : []),
  ]);
  return groupRows(rows, dataRows(rows, spec), spec).map((group) => {
    const w = newWorking(`r${group[0]}`, group);
    const first = group[0] as number;
    const at = (source: ImportSource | undefined, i: number) =>
      source ? evaluate(source, rows[i]) : undefined;

    w.name = cut(text(at(f.name, first)), NAME_MAX, 'name', w.sink, first);
    w.code = text(at(f.code, first));
    w.description = cut(
      text(at(f.description, first)),
      DESCRIPTION_MAX,
      'description',
      w.sink,
      first,
    );
    const category = text(at(f.category, first)) || (spec.defaults?.category ?? '').trim();
    w.category = category ? cut(category, CATEGORY_MAX, 'category', w.sink, first) : null;
    w.visibleToBot = spec.defaults?.visibleToBot ?? true;

    // Product fields come from the first row; a different value further down is a conflict.
    for (const field of PRODUCT_TEXT_FIELDS) {
      const source = f[field];
      if (!source) continue;
      const firstValue = text(at(source, first));
      for (const i of group.slice(1)) {
        const v = text(at(source, i));
        if (v !== '' && v !== firstValue) {
          w.sink.add(field, 'group_conflict', i);
          break;
        }
      }
    }
    if (f.imageUrls && group.some((i) => text(at(f.imageUrls, i)) !== '')) {
      w.sink.add('imageUrls', 'image_column_ignored', first);
    }

    if (group.length > IMPORT_MAX_VARIANTS) {
      w.sink.add('variants', 'too_many_variants', first);
    }
    const differing = f.variantName ? [] : differingColumns(rows, group, usedColumns);
    for (const i of group.slice(0, IMPORT_MAX_VARIANTS)) {
      const variantName = f.variantName
        ? text(at(f.variantName, i))
        : differing
            .map((c) => cell(rows[i], c).trim())
            .filter((v) => v !== '')
            .join(' / ');
      const price = numeric('price', at(f.price, i));
      const variant = {
        row: i,
        sku: text(at(f.sku, i)),
        name: cut(variantName, VARIANT_NAME_MAX, 'variantName', w.sink, i),
        price: price.value,
        priceBad: price.bad,
        cost: numericWarn('cost', at(f.cost, i), w.sink, i),
        weightGram: numericWarn('weightGram', at(f.weightGram, i), w.sink, i),
        stock: numericWarn('stock', at(f.stock, i), w.sink, i),
      };
      w.variants.push(variant);
    }
    return w;
  });
}

function numericWarn(
  field: Exclude<NumericField, 'price'>,
  e: Evaluated | undefined,
  sink: Sink,
  row?: number,
): number | null {
  const r = numeric(field, e);
  if (r.bad) sink.add(field, NUMERIC_BAD[field], row);
  return r.value;
}

function attributeLines(vision: VisionDraft): string {
  return vision.attributes
    .map((a) => `- ${a.name.trim()}: ${a.value.trim()}`)
    .filter((line) => line !== '- : ')
    .join('\n');
}

function photoDrafts(groups: ImportPhotoGroup[]): Working[] {
  return groups.map((g, index) => {
    const w = newWorking(`p${index}`, []);
    const v = g.vision;
    if (g.visionError !== null || !v) w.sink.add('name', 'vision_failed');
    for (const warning of g.visionWarnings ?? []) {
      if (warning.startsWith('unsafe_text:')) {
        w.sink.add(warning.slice('unsafe_text:'.length), warning as ProblemCode);
      }
    }
    w.name = cut((v?.name ?? '').trim(), NAME_MAX, 'name', w.sink);
    const description = [v?.description.trim() ?? '', v ? attributeLines(v) : '']
      .filter((part) => part !== '')
      .join('\n\n');
    w.description = cut(description, DESCRIPTION_MAX, 'description', w.sink);
    const category = (v?.category ?? '').trim();
    w.category = category ? cut(category, CATEGORY_MAX, 'category', w.sink) : null;
    w.visibleToBot = false;
    w.imageUrls = g.imageUrls.slice(0, MAX_IMAGES);
    w.variants.push({
      row: undefined,
      sku: '',
      name: '',
      price: null,
      priceBad: false,
      cost: null,
      weightGram: null,
      stock: null,
    });
    return w;
  });
}

function applyOverride(w: Working, o: ImportDraftOverride): void {
  const row = w.firstRow;
  if (o.name !== undefined) w.name = cut(o.name.trim(), NAME_MAX, 'name', w.sink, row);
  if (o.code !== undefined) w.code = o.code.trim();
  if (o.description !== undefined) {
    w.description = cut(o.description.trim(), DESCRIPTION_MAX, 'description', w.sink, row);
  }
  if (o.category !== undefined) {
    const category = (o.category ?? '').trim();
    w.category = category ? cut(category, CATEGORY_MAX, 'category', w.sink, row) : null;
  }
  if (o.visibleToBot !== undefined) w.visibleToBot = o.visibleToBot;
  for (const vo of o.variants ?? []) {
    const variant = w.variants[vo.index];
    if (!variant) {
      w.sink.add(`variants.${vo.index}`, `invalid:override.variants.${vo.index}`, row);
      continue;
    }
    const vRow = variant.row;
    if (vo.sku !== undefined) variant.sku = vo.sku.trim();
    if (vo.name !== undefined) {
      variant.name = cut(vo.name.trim(), VARIANT_NAME_MAX, 'variantName', w.sink, vRow);
    }
    if (vo.price !== undefined) {
      const r = numeric('price', { value: vo.price, bad: false });
      variant.price = r.value;
      variant.priceBad = r.bad;
    }
    for (const field of ['cost', 'weightGram', 'stock'] as const) {
      const value = vo[field];
      if (value === undefined) continue;
      const r = numeric(field, { value, bad: false });
      if (r.bad) w.sink.add(field, NUMERIC_BAD[field], vRow);
      variant[field] = r.value;
    }
  }
}

function withSuffix(base: string, n: number): string {
  const suffix = `-${n}`;
  return base.slice(0, CODE_MAX - suffix.length) + suffix;
}

/**
 * Turns the owner's rows (with the model's mapping spec) or the photo drafts into product drafts
 * with their problems. Deterministic, in source order (sheet rows) or photo order.
 */
export function buildDrafts(input: BuildDraftsInput): ImportDraft[] {
  const { source, spec, overrides, createdKeys } = input;
  let working: Working[];
  if (source.kind === 'sheet') {
    if (!spec) throw new Error('a sheet import needs a mapping spec');
    working = sheetDrafts(source.rows, spec);
  } else {
    working = photoDrafts(source.groups);
  }
  const excluded = new Set(input.excluded);

  for (const w of working) {
    const o = overrides[w.key];
    if (o) applyOverride(w, o);
    if (!w.name) w.sink.add('name', 'missing_name', w.firstRow);
    for (const v of w.variants) {
      if (v.priceBad) w.sink.add('price', 'bad_price', v.row);
      else if (v.price === null) w.sink.add('price', 'missing_price', v.row);
    }
  }

  // Codes and SKUs, in order. Excluded drafts do not claim codes; drafts already created do.
  const usedCodes = new Set<string>();
  const usedSkus = new Set<string>();
  for (const w of working) {
    const active = !excluded.has(w.key);
    let derived = false;
    if (!w.code) {
      derived = true;
      w.code = w.variants[0]?.sku || codeOf(w.name).slice(0, DERIVED_CODE_MAX);
    }
    if (!w.code) {
      if (w.name) w.sink.add('code', 'bad_code', w.firstRow);
    } else if (!validCode(w.code)) {
      w.sink.add('code', 'bad_code', w.firstRow);
    } else if (active) {
      if (derived) {
        w.sink.add('code', 'code_generated', w.firstRow);
        const base = w.code;
        for (let n = 2; usedCodes.has(w.code.toLowerCase()); n++) w.code = withSuffix(base, n);
      } else if (usedCodes.has(w.code.toLowerCase())) {
        w.sink.add('code', 'duplicate_code_in_file', w.firstRow);
      }
      usedCodes.add(w.code.toLowerCase());
    }

    w.variants.forEach((v, i) => {
      if (!v.sku && w.code) v.sku = w.variants.length === 1 ? w.code : withSuffix(w.code, i + 1);
      if (!v.sku) return;
      if (!validCode(v.sku)) {
        w.sink.add('sku', 'bad_sku', v.row);
        return;
      }
      if (!active) return;
      if (usedSkus.has(v.sku.toLowerCase())) w.sink.add('sku', 'duplicate_sku_in_file', v.row);
      usedSkus.add(v.sku.toLowerCase());
    });
  }

  if (input.existing) {
    const codes = new Set(input.existing.codes.map((c) => c.toLowerCase()));
    const skus = new Set(input.existing.skus.map((s) => s.toLowerCase()));
    for (const w of working) {
      if (createdKeys.has(w.key)) continue;
      if (w.code && codes.has(w.code.toLowerCase())) w.sink.add('code', 'exists_code', w.firstRow);
      for (const v of w.variants) {
        if (v.sku && skus.has(v.sku.toLowerCase())) w.sink.add('sku', 'exists_sku', v.row);
      }
    }
  }

  return working.map((w) => {
    const draft: ImportDraft = {
      key: w.key,
      rows: w.rows,
      product: {
        code: w.code,
        name: w.name,
        description: w.description,
        category: w.category,
        visibleToBot: w.visibleToBot,
        imageUrls: w.imageUrls,
        variants: w.variants.map((v) => ({
          sku: v.sku,
          name: v.name,
          price: v.price,
          cost: v.cost,
          weightGram: v.weightGram,
          stock: v.stock,
        })),
      },
      problems: w.problems,
      excluded: excluded.has(w.key),
    };
    // A preview must never say "ready" when the product API would answer 400.
    if (!hasErrors(draft)) {
      const parsed = UpsertProductRequest.safeParse(upsertOf(draft));
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const path = issue.path.map(String).join('.') || 'product';
          w.sink.add(path, `invalid:${path}`, w.firstRow);
        }
      }
    }
    return draft;
  });
}

function upsertOf(d: ImportDraft): UpsertProductRequest {
  const p = d.product;
  if (!p) throw new Error(`import draft ${d.key} has no product`);
  return {
    code: p.code,
    name: p.name,
    description: p.description,
    category: p.category,
    visibleToBot: p.visibleToBot,
    imageUrls: p.imageUrls,
    variants: p.variants.map((v) => ({
      sku: v.sku,
      name: v.name,
      price: v.price ?? 0,
      cost: v.cost ?? 0,
      weightGram: v.weightGram ?? 0,
    })),
  };
}

/** The product API body for a ready draft (stock is set separately). Throws when it has errors. */
export function toUpsertProductRequest(d: ImportDraft): UpsertProductRequest {
  if (hasErrors(d)) throw new Error(`import draft ${d.key} has errors`);
  return upsertOf(d);
}
