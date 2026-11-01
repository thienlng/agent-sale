import { createFileRoute, Navigate } from '@tanstack/react-router';
import { z } from 'zod';

import { Skeleton } from '@/components/ui/skeleton';
import { ProductForm } from '@/features/commerce/components/product-form';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';

/** `botId`: opened from a bot's product page; the new product is selected for that bot. */
const Search = z.object({ botId: z.uuid().optional().catch(undefined) });

export const Route = createFileRoute('/app/products/new')({
  validateSearch: Search,
  component: function NewProductPage() {
    const { botId } = Route.useSearch();
    const workspace = useCurrentWorkspace();
    if (workspace.isPending) return <Skeleton className="h-96 rounded-xl" />;
    // A hotel business adds places on /app/properties (T-160).
    if (workspace.data?.industry === 'hotel') return <Navigate to="/app/properties" replace />;
    return <ProductForm {...(botId ? { botId } : {})} />;
  },
});
