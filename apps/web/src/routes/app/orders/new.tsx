import { createFileRoute } from '@tanstack/react-router';

import { OrderForm } from '@/features/commerce/components/order-form';

export const Route = createFileRoute('/app/orders/new')({ component: OrderForm });
