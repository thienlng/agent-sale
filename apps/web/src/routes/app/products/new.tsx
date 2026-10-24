import { createFileRoute } from '@tanstack/react-router';

import { ProductForm } from '@/features/commerce/components/product-form';

export const Route = createFileRoute('/app/products/new')({ component: () => <ProductForm /> });
