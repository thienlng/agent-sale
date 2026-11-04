import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { BusinessGallery } from '@/features/workspace/components/business-gallery';
import { GallerySearch } from '@/features/workspace/lib/business-gallery';

export const Route = createFileRoute('/app/businesses/')({
  validateSearch: GallerySearch,
  component: function BusinessesRoute() {
    const search = Route.useSearch();
    const navigate = useNavigate({ from: '/app/businesses/' });
    return (
      <BusinessGallery
        search={search}
        onSearch={(next) => void navigate({ search: next, replace: true })}
      />
    );
  },
});
