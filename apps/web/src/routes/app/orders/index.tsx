import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { RetryPushProvider } from '@/features/commerce/components/order-external';
import { OrdersList } from '@/features/commerce/components/orders-list';
import { parseOrdersSearch } from '@/features/commerce/components/orders-search';
import { useRetryOrderPush } from '@/features/integration/api/integrations';

export const Route = createFileRoute('/app/orders/')({
  // Filters live in the URL; anything malformed falls back to "no filter", old links are mapped.
  validateSearch: parseOrdersSearch,
  component: function OrdersPage() {
    const search = Route.useSearch();
    const navigate = useNavigate({ from: '/app/orders/' });
    const retryPush = useRetryOrderPush();
    return (
      // "Thử lại" on a failed KiotViet push: the integration feature owns the call.
      <RetryPushProvider value={retryPush.mutateAsync}>
        <OrdersList
          search={search}
          onSearch={(next) => void navigate({ search: next, replace: true })}
        />
      </RetryPushProvider>
    );
  },
});
