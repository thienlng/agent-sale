import { createFileRoute, Navigate } from '@tanstack/react-router';

import { Skeleton } from '@/components/ui/skeleton';
import { ProductsList } from '@/features/commerce/components/products-list';
import { usePmsLink } from '@/features/integration/api/integrations';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';

export const Route = createFileRoute('/app/products/')({
  component: function ProductsRoute() {
    const workspace = useCurrentWorkspace();
    const pmsLink = usePmsLink();
    if (workspace.isPending) return <Skeleton className="h-96 rounded-xl" />;
    // A hotel business sells places, not products (T-160).
    if (workspace.data?.industry === 'hotel') return <Navigate to="/app/properties" replace />;
    // Until the business is known the KiotViet hint stays hidden: hotels never see it.
    return <ProductsList pmsLink={workspace.data ? pmsLink : undefined} />;
  },
});
