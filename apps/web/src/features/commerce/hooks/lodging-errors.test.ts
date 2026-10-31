import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { ApiClientError } from '@/lib/api-client';

import { lodgingErrorMessage, productSaveErrorMessage } from './lodging-errors';

const t = ((key: string) => key) as unknown as TFunction;
const linked = new ApiClientError(400, 'VALIDATION_FAILED', 'm', undefined, {
  reason: 'IMAGE_NOT_UPLOADED',
  field: 'imageUrls[0]',
});

describe('linked-image save errors', () => {
  it('shows the readable message for a product save', () => {
    expect(productSaveErrorMessage(t, linked)).toBe('products.form.imageNotUploaded');
  });
  it('shows the readable message for a lodging save', () => {
    expect(lodgingErrorMessage(t, linked)).toBe('products.form.imageNotUploaded');
  });
  it('keeps the generic mapping for other errors', () => {
    expect(productSaveErrorMessage(t, new Error('boom'))).not.toBe(
      'products.form.imageNotUploaded',
    );
  });
});
