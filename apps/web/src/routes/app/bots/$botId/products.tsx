import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ProductsList } from '@/features/commerce/components/products-list';
export const Route = createFileRoute('/app/bots/$botId/products')({
  component: function ProductsPage() {
    const { t } = useTranslation('training');
    return (
      <div className="min-w-0 space-y-4">
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          {t('catalogShared')}
        </p>
        <ProductsList />
      </div>
    );
  },
});
