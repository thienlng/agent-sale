import { createFileRoute, Navigate } from '@tanstack/react-router';

import { Skeleton } from '@/components/ui/skeleton';
import { ProductsList } from '@/features/commerce/components/products-list';
import { usePmsLink } from '@/features/integration/api/integrations';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
import { industryGroup, offeringKindOf } from '@/features/workspace/utils/industry-group';

export const Route = createFileRoute('/app/products/')({
  component: function ProductsRoute() {
    const workspace = useCurrentWorkspace();
    const pmsLink = usePmsLink();
    if (workspace.isPending) return <Skeleton className="h-96 rounded-xl" />;
    // A hotel business sells places, not products (T-160).
    if (workspace.data?.industry === 'hotel') return <Navigate to="/app/properties" replace />;
    // Until the business is known the KiotViet hint stays hidden. Hotels never see it, nor do
    // education and spa businesses, which have no PMS.
    const service = industryGroup(workspace.data?.industry) === 'service';
    return (
      <ProductsList
        pmsLink={workspace.data && !service ? pmsLink : undefined}
        offeringKind={offeringKindOf(workspace.data?.industry)}
      />
    );
  },
});
