import { createFileRoute } from '@tanstack/react-router';

import { ProductsList } from '@/features/commerce/components/products-list';
import { AccommodationList } from '@/features/commerce/components/accommodation-list';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';

export const Route = createFileRoute('/app/products/')({
  component: function ProductsRoute() {
    const workspace = useCurrentWorkspace();
    return workspace.data?.industry === 'hotel' ? <AccommodationList /> : <ProductsList />;
  },
});
