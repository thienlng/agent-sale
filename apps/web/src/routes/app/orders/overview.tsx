import { createFileRoute } from '@tanstack/react-router';

import { OrdersOverview } from '@/features/commerce/components/orders-overview';

export const Route = createFileRoute('/app/orders/overview')({ component: OrdersOverview });
