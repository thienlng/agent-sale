import type { TFunction } from 'i18next';
import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';

/** True when the server rejected a save because a picture is still an old external link. */
export function isImageNotUploaded(error: unknown): boolean {
  return error instanceof ApiClientError && error.details?.reason === 'IMAGE_NOT_UPLOADED';
}

/** Toast text for a failed product save: the linked-image rule first, then the generic mapping. */
export function productSaveErrorMessage(t: TFunction, error: unknown): string {
  return isImageNotUploaded(error) ? t('products.form.imageNotUploaded') : errorMessage(t, error);
}

/** Why a variant's SKU cannot be saved: repeated in this product, or used by another product. */
export type SkuProblem = 'duplicate' | 'taken';

/**
 * The SKU fields a failed product save points at (TM-7), by variant index: a `VALIDATION_FAILED`
 * issue on `variants.<i>.sku` (a SKU repeated in the product) or a `CONFLICT` naming a SKU another
 * product holds (`details.field = 'sku'`, matched case-insensitively). Empty for other errors.
 */
export function skuProblemsOf(error: unknown, skus: readonly string[]): Map<number, SkuProblem> {
  const found = new Map<number, SkuProblem>();
  if (!(error instanceof ApiClientError)) return found;
  if (error.code === 'VALIDATION_FAILED') {
    const issues = Array.isArray(error.details?.['issues']) ? error.details['issues'] : [];
    for (const issue of issues) {
      const path = (issue as { path?: unknown }).path;
      const m = typeof path === 'string' ? /^variants\.(\d+)\.sku$/.exec(path) : null;
      if (m) found.set(Number(m[1]), 'duplicate');
    }
  } else if (error.code === 'CONFLICT' && error.details?.['field'] === 'sku') {
    const value = String(error.details['value'] ?? '')
      .trim()
      .toLowerCase();
    skus.forEach((sku, i) => {
      if (value && sku.trim().toLowerCase() === value) found.set(i, 'taken');
    });
  }
  return found;
}
