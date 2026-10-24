import { createFileRoute } from '@tanstack/react-router';

import { NotFound } from '@/components/route-errors';
import { Skeleton } from '@/components/ui/skeleton';
import { useProduct } from '@/features/commerce/api/commerce';
import { ProductForm } from '@/features/commerce/components/product-form';
import { ApiClientError } from '@/lib/api-client';

export const Route = createFileRoute('/app/products/$productId')({
  component: function ProductPage() {
    const { productId } = Route.useParams();
    const product = useProduct(productId);
    if (product.error instanceof ApiClientError && product.error.status === 404)
      return <NotFound />;
    return product.data ? (
      <ProductForm key={product.data.updatedAt} product={product.data} />
    ) : (
      <Skeleton className="h-96 rounded-xl" />
    );
  },
});
