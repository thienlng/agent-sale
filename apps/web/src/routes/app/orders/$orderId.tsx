import { createFileRoute } from '@tanstack/react-router';

import { OrderDetail } from '@/features/commerce/components/order-detail';
import { useRetryOrderPush } from '@/features/integration/api/integrations';

export const Route = createFileRoute('/app/orders/$orderId')({
  component: function OrderPage() {
    const { orderId } = Route.useParams();
    const retryPush = useRetryOrderPush();
    return <OrderDetail key={orderId} orderId={orderId} onRetryPush={retryPush.mutateAsync} />;
  },
});
