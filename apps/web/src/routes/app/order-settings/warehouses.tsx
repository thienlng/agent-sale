import { createFileRoute } from '@tanstack/react-router';

import { WarehousesManager } from '@/features/commerce/components/warehouses-manager';

export const Route = createFileRoute('/app/order-settings/warehouses')({
  component: WarehousesManager,
});
