import { createFileRoute } from '@tanstack/react-router';

import { OrderSourcePolicies } from '@/features/commerce/components/order-source-policies';

export const Route = createFileRoute('/app/order-settings/sources')({
  component: OrderSourcePolicies,
});
