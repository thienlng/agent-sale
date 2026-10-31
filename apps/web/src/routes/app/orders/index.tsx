import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { OrdersList } from '@/features/commerce/components/orders-list';
import { parseOrdersSearch } from '@/features/commerce/components/orders-search';

export const Route = createFileRoute('/app/orders/')({
  // Filters live in the URL; anything malformed falls back to "no filter", old links are mapped.
  validateSearch: parseOrdersSearch,
  component: function OrdersPage() {
    const search = Route.useSearch();
    const navigate = useNavigate({ from: '/app/orders/' });
    return (
      <OrdersList
        search={search}
        onSearch={(next) => void navigate({ search: next, replace: true })}
      />
    );
  },
});
