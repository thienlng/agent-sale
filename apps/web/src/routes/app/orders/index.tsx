import { OrderSource, OrderStatus } from '@agent-sales/contracts';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { OrdersList } from '@/features/commerce/components/orders-list';

/** Filters live in the URL; anything malformed falls back to "no filter". */
const Search = z.object({
  // One status (older links, `?status=confirmed`) or several.
  status: z
    .union([OrderStatus.transform((s) => [s]), z.array(OrderStatus).max(20)])
    .optional()
    .catch(undefined),
  statusMode: z.enum(['include', 'exclude']).optional().catch(undefined),
  createdBy: z.uuid().optional().catch(undefined),
  review: z.enum(['pending']).optional().catch(undefined),
  carrier: z.string().max(60).optional().catch(undefined),
  q: z.string().max(100).optional().catch(undefined),
  source: OrderSource.optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  sort: z
    .enum(['placed_desc', 'placed_asc', 'total_desc', 'total_asc'])
    .optional()
    .catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  pageSize: z.coerce
    .number()
    .int()
    .pipe(z.union([z.literal(20), z.literal(50), z.literal(100)]))
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/app/orders/')({
  validateSearch: Search,
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
