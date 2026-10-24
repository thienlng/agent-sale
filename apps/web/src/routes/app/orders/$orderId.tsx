import { createFileRoute } from '@tanstack/react-router';

import { OrderDetail } from '@/features/commerce/components/order-detail';

export const Route = createFileRoute('/app/orders/$orderId')({
  component: function OrderPage() {
    const { orderId } = Route.useParams();
    return <OrderDetail key={orderId} orderId={orderId} />;
  },
});
