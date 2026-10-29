import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BotProductsTable } from '@/features/commerce/components/bot-products-table';
import { AccommodationList } from '@/features/commerce/components/accommodation-list';
import { useBot } from '@/features/bot/api/bots';
import { DataPageHeader } from '@/features/knowledge/components/data-page';

export const Route = createFileRoute('/app/bots/$botId/products')({
  component: function ProductsPage() {
    const { t } = useTranslation('training');
    const { botId } = Route.useParams();
    const bot = useBot(botId);
    if (bot.data?.industry === 'hotel') return <AccommodationList />;
    return (
      <section className="flex min-w-0 flex-col gap-4">
        <DataPageHeader title={t('data.products.title')} subtitle={t('data.products.subtitle')} />
        <Tabs value="products">
          <TabsList variant="line" className="w-full justify-start border-b">
            <TabsTrigger value="products" className="flex-none px-4">
              {t('data.products.tab')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-xs text-muted-foreground">{t('data.products.shared')}</p>
        <BotProductsTable />
      </section>
    );
  },
});
