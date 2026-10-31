import { describe, expect, it } from 'vitest';

import { ApiClientError } from '@/lib/api-client';

import { imageUploadErrorKey } from './commerce';

const err = (status: number, reason?: string) =>
  new ApiClientError(status, 'X', 'm', undefined, reason ? { reason } : undefined);

describe('imageUploadErrorKey', () => {
  it('maps the server reason to a message', () => {
    expect(imageUploadErrorKey(err(400, 'INVALID_IMAGE'))).toBe('products.form.imageInvalid');
    expect(imageUploadErrorKey(err(413, 'PAYLOAD_TOO_LARGE'))).toBe('products.form.imageTooLarge');
    expect(imageUploadErrorKey(err(413))).toBe('products.form.imageTooLarge');
    expect(imageUploadErrorKey(err(503, 'MEDIA_STORAGE_UNAVAILABLE'))).toBe(
      'products.form.imageStorageUnavailable',
    );
  });
  it('falls back to the generic message', () => {
    expect(imageUploadErrorKey(err(400, 'IMAGE_NOT_UPLOADED'))).toBe(
      'products.form.imageUploadFailed',
    );
    expect(imageUploadErrorKey(new Error('boom'))).toBe('products.form.imageUploadFailed');
  });
});
