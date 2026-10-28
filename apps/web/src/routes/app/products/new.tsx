import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ProductForm } from '@/features/commerce/components/product-form';

/** `botId`: opened from a bot's product page; the new product is selected for that bot. */
const Search = z.object({ botId: z.uuid().optional().catch(undefined) });

export const Route = createFileRoute('/app/products/new')({
  validateSearch: Search,
  component: function NewProductPage() {
    const { botId } = Route.useSearch();
    return <ProductForm {...(botId ? { botId } : {})} />;
  },
});
