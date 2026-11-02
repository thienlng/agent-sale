/**
 * What the import needs to know about a set of drafts: the codes to check against the catalog
 * and a stable hash a proposal pins (T-173). Pure.
 */
import { createHash } from 'node:crypto';

import { validCode } from './import-fields.js';
import type { ImportDraft } from './product-import.schema.js';

const MATCH_MAX_CODES = 500;
const MATCH_MAX_SKUS = 1_000;

/**
 * The valid, distinct codes and SKUs of the drafts, for POST /products/match-codes. Capped at the
 * route's limits (the first 500 codes and 1 000 SKUs), silently: drafts past the caps get no
 * `exists_*` error in the preview, and the approval's 409 still refuses a duplicate.
 */
export function codesOf(drafts: ImportDraft[]): { codes: string[]; skus: string[] } {
  const codes = new Map<string, string>();
  const skus = new Map<string, string>();
  for (const d of drafts) {
    const p = d.product;
    if (!p) continue;
    if (validCode(p.code) && !codes.has(p.code.toLowerCase()))
      codes.set(p.code.toLowerCase(), p.code);
    for (const v of p.variants) {
      if (validCode(v.sku) && !skus.has(v.sku.toLowerCase())) skus.set(v.sku.toLowerCase(), v.sku);
    }
  }
  return {
    codes: [...codes.values()].slice(0, MATCH_MAX_CODES),
    skus: [...skus.values()].slice(0, MATCH_MAX_SKUS),
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** sha256 (hex) of the drafts' canonical JSON (sorted keys): what a proposal pins. */
export function draftsHash(drafts: ImportDraft[]): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(drafts)))
    .digest('hex');
}
