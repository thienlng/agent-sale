import { createFileRoute, Navigate } from '@tanstack/react-router';

import { Skeleton } from '@/components/ui/skeleton';
import { ProductsList } from '@/features/commerce/components/products-list';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';

export const Route = createFileRoute('/app/products/')({
  component: function ProductsRoute() {
    const workspace = useCurrentWorkspace();
    if (workspace.isPending) return <Skeleton className="h-96 rounded-xl" />;
    // A hotel business sells places, not products (T-160).
    if (workspace.data?.industry === 'hotel') return <Navigate to="/app/properties" replace />;
    return <ProductsList />;
  },
});
