import { createFileRoute } from '@tanstack/react-router';

import { ProductsList } from '@/features/commerce/components/products-list';
import { AccommodationList } from '@/features/commerce/components/accommodation-list';
import { usePmsLink } from '@/features/integration/api/integrations';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';

export const Route = createFileRoute('/app/products/')({
  component: function ProductsRoute() {
    const workspace = useCurrentWorkspace();
    const pmsLink = usePmsLink();
    if (workspace.data?.industry === 'hotel') return <AccommodationList />;
    // Until the business is known the KiotViet hint stays hidden: hotels never see it.
    return <ProductsList pmsLink={workspace.data ? pmsLink : undefined} />;
  },
});
