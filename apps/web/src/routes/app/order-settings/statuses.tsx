import { createFileRoute } from '@tanstack/react-router';

import { OrderStatusSettings } from '@/features/commerce/components/order-settings';

export const Route = createFileRoute('/app/order-settings/statuses')({
  component: OrderStatusSettings,
});
