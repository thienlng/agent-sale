import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { z } from 'zod';

import { HotelOnly } from '@/features/lodging/components/hotel-only';
import { PropertyEditor } from '@/features/lodging/components/property-editor';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';

import { useLodgingImageUpload } from '../-components/use-lodging-image-upload';

/**
 * `folder`: the open folder of the "Ảnh & video" tab, so Back returns to the folder list.
 * `tab`: the tab to open first ("rooms" when coming back from a unit page).
 */
const Search = z.object({
  folder: z.string().max(40).optional().catch(undefined),
  tab: z.enum(['rooms']).optional().catch(undefined),
});

export const Route = createFileRoute('/app/properties/$propertyId')({
  validateSearch: Search,
  component: function PropertyRoute() {
    const workspace = useCurrentWorkspace();
    const { propertyId } = Route.useParams();
    const { folder, tab } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    const uploadImage = useLodgingImageUpload();
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
          initialTab={tab}
        />
      </HotelOnly>
    );
  },
});
