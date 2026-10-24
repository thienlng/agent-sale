import { createFileRoute } from '@tanstack/react-router';

import { ProductsList } from '@/features/commerce/components/products-list';

export const Route = createFileRoute('/app/products/')({ component: ProductsList });
