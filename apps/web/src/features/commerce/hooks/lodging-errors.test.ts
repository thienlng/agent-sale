import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { ApiClientError } from '@/lib/api-client';

import { productSaveErrorMessage, skuProblemsOf } from './lodging-errors';

const t = ((key: string) => key) as unknown as TFunction;
const linked = new ApiClientError(400, 'VALIDATION_FAILED', 'm', undefined, {
  reason: 'IMAGE_NOT_UPLOADED',
  field: 'imageUrls[0]',
});

describe('linked-image save errors', () => {
  it('shows the readable message for a product save', () => {
    expect(productSaveErrorMessage(t, linked)).toBe('products.form.imageNotUploaded');
  });
  it('keeps the generic mapping for other errors', () => {
    expect(productSaveErrorMessage(t, new Error('boom'))).not.toBe(
      'products.form.imageNotUploaded',
    );
  });
});

describe('skuProblemsOf (TM-7)', () => {
  it('reads the repeated SKU from the validation issue path', () => {
    const error = new ApiClientError(400, 'VALIDATION_FAILED', 'Request validation failed', 't', {
      issues: [
        { path: 'variants.2.sku', message: 'each variant needs a different SKU' },
        { path: 'name', message: 'required' },
      ],
    });
    expect([...skuProblemsOf(error, ['A', 'B', 'a'])]).toEqual([[2, 'duplicate']]);
  });

  it('matches the SKU another product holds, case-insensitively', () => {
    const error = new ApiClientError(409, 'CONFLICT', 'dup', 't', { field: 'sku', value: 'qa-1' });
    expect([...skuProblemsOf(error, ['X', ' QA-1 '])]).toEqual([[1, 'taken']]);
  });

  it('ignores other errors', () => {
    const code = new ApiClientError(409, 'CONFLICT', 'dup', 't', { field: 'code', value: 'A' });
    expect(skuProblemsOf(code, ['A']).size).toBe(0);
    expect(skuProblemsOf(new Error('x'), ['A']).size).toBe(0);
  });
});
