import { createFileRoute } from '@tanstack/react-router';

import { ImageUploadZone } from '@/features/commerce/components/image-upload-zone';
import type { GalleryUploadSlot } from '@/features/lodging/components/gallery-editor';
import { HotelOnly } from '@/features/lodging/components/hotel-only';
import { PropertyEditor } from '@/features/lodging/components/property-editor';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';

/** Photo upload is owned by commerce (shared product image storage); composed here. */
const galleryUpload: GalleryUploadSlot = ({ remaining, onUploaded }) => (
  <ImageUploadZone remaining={remaining} onUploaded={onUploaded} />
);

export const Route = createFileRoute('/app/properties/$propertyId')({
  component: function PropertyRoute() {
    const workspace = useCurrentWorkspace();
    const { propertyId } = Route.useParams();
    return (
      <HotelOnly workspace={workspace}>
        <PropertyEditor
          key={propertyId}
          propertyId={propertyId}
          renderGalleryUpload={galleryUpload}
        />
      </HotelOnly>
    );
  },
});
