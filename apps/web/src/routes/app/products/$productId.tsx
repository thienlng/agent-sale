import { createFileRoute } from '@tanstack/react-router';

import { NotFound } from '@/components/route-errors';
import { Skeleton } from '@/components/ui/skeleton';
import { useProduct } from '@/features/commerce/api/commerce';
import { ProductForm } from '@/features/commerce/components/product-form';
import { AccommodationForm } from '@/features/commerce/components/accommodation-form';
import { useNavigate } from '@tanstack/react-router';
import { ApiClientError } from '@/lib/api-client';

export const Route = createFileRoute('/app/products/$productId')({
  component: function ProductPage() {
    const { productId } = Route.useParams();
    const navigate = useNavigate();
    const product = useProduct(productId);
    if (product.error instanceof ApiClientError && product.error.status === 404)
      return <NotFound />;
    return product.data ? (
      product.data.accommodation ? (
        <AccommodationForm
          key={product.data.updatedAt}
          product={product.data}
          onSaved={() => void navigate({ to: '/app/accommodations' })}
        />
      ) : (
        <ProductForm key={product.data.updatedAt} product={product.data} />
      )
    ) : (
      <Skeleton className="h-96 rounded-xl" />
    );
  },
});
