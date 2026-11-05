import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { imageUploadErrorKey, useUploadProductImage } from '@/features/commerce/api/commerce';
import { HotelOnly } from '@/features/lodging/components/hotel-only';
import { PropertyEditor } from '@/features/lodging/components/property-editor';
import { GalleryUploadError } from '@/features/lodging/lib/gallery-model';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
import { ImageUnreadableError, resizeImage } from '@/lib/resize-image';

/** `folder`: the open folder of the "Ảnh & video" tab, so Back returns to the folder list. */
const Search = z.object({ folder: z.string().max(40).optional().catch(undefined) });

export const Route = createFileRoute('/app/properties/$propertyId')({
  validateSearch: Search,
  component: function PropertyRoute() {
    const { t } = useTranslation();
    const workspace = useCurrentWorkspace();
    const { propertyId } = Route.useParams();
    const { folder } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    const { mutateAsync } = useUploadProductImage();
    // Photo upload is owned by commerce (resize to JPEG + shared product image storage).
    const uploadImage = useCallback(
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
    const onFolderChange = useCallback(
      (id: string | undefined) => void navigate({ search: id ? { folder: id } : {} }),
      [navigate],
    );
    return (
      <HotelOnly workspace={workspace}>
        <PropertyEditor
          key={propertyId}
          propertyId={propertyId}
          uploadImage={uploadImage}
          folderId={folder}
          onFolderChange={onFolderChange}
        />
      </HotelOnly>
    );
  },
});
