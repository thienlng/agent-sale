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
