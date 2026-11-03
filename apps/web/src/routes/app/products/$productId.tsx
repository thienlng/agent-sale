import { createFileRoute, Navigate } from '@tanstack/react-router';

import { NotFound } from '@/components/route-errors';
import { Skeleton } from '@/components/ui/skeleton';
import { useProduct } from '@/features/commerce/api/commerce';
import { ProductForm } from '@/features/commerce/components/product-form';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
import { offeringKindOf } from '@/features/workspace/utils/industry-group';
import { usePmsLink } from '@/features/integration/api/integrations';
import { ApiClientError } from '@/lib/api-client';

export const Route = createFileRoute('/app/products/$productId')({
  component: function ProductPage() {
    const { productId } = Route.useParams();
    const workspace = useCurrentWorkspace();
    const hotel = workspace.data?.industry === 'hotel';
    const product = useProduct(hotel ? undefined : productId);
    const pmsLink = usePmsLink();
    // A hotel business edits places on /app/properties (T-160).
    if (hotel) return <Navigate to="/app/properties" replace />;
    if (product.error instanceof ApiClientError && product.error.status === 404)
      return <NotFound />;
    return product.data && !workspace.isPending ? (
      <ProductForm
        key={product.data.updatedAt}
        product={product.data}
        pmsLink={pmsLink}
        offeringKind={offeringKindOf(workspace.data?.industry)}
      />
    ) : (
      <Skeleton className="h-96 rounded-xl" />
    );
  },
});
