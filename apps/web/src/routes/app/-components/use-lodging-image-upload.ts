import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { imageUploadErrorKey, useUploadProductImage } from '@/features/commerce/api/commerce';
import { GalleryUploadError, type GalleryImageUpload } from '@/features/lodging/lib/gallery-model';
import { ImageUnreadableError, resizeImage } from '@/lib/resize-image';

/**
 * Photo upload of the lodging galleries (a property's and its units'): owned by commerce
 * (resize to JPEG + shared product image storage), composed here because features never
 * import each other.
 */
export function useLodgingImageUpload(): GalleryImageUpload {
  const { t } = useTranslation();
  const { mutateAsync } = useUploadProductImage();
  return useCallback(
    async (file: File) => {
      try {
        return await mutateAsync(await resizeImage(file));
      } catch (error) {
        throw new GalleryUploadError(
          error instanceof ImageUnreadableError
            ? t('products.form.imageUnreadable')
            : t(imageUploadErrorKey(error)),
        );
      }
    },
    [mutateAsync, t],
  );
}
