import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { z } from 'zod';

import { HotelOnly } from '@/features/lodging/components/hotel-only';
import { UnitPage } from '@/features/lodging/components/unit-page';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
import { loadNamespace } from '@/lib/i18n';

import { useLodgingImageUpload } from '../-components/use-lodging-image-upload';

/** `folder`: the open folder of the unit's "Ảnh & video" tab, so Back returns to the list. */
const Search = z.object({ folder: z.string().max(40).optional().catch(undefined) });

/** A rental unit of a property (T-193); a lazy chunk (autoCodeSplitting) off the shell. */
export const Route = createFileRoute('/app/properties/$propertyId_/units/$unitId')({
  loader: () => loadNamespace('lodging'),
  validateSearch: Search,
  component: function UnitRoute() {
    const workspace = useCurrentWorkspace();
    const { propertyId, unitId } = Route.useParams();
    const { folder } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    const uploadImage = useLodgingImageUpload();
    const onFolderChange = useCallback(
      (id: string | undefined) => void navigate({ search: id ? { folder: id } : {} }),
      [navigate],
    );
    return (
      <HotelOnly workspace={workspace}>
        <UnitPage
          key={`${propertyId}/${unitId}`}
          propertyId={propertyId}
          unitId={unitId}
          uploadImage={uploadImage}
          folderId={folder}
          onFolderChange={onFolderChange}
        />
      </HotelOnly>
    );
  },
});
