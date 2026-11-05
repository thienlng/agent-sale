import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBot, useUpdateBot } from '@/features/bot/api/bots';
import { BotCatalogMode } from '@/features/commerce/components/bot-catalog-mode';
import { BotProductsTable } from '@/features/commerce/components/bot-products-table';
import { DataPageHeader } from '@/features/knowledge/components/data-page';
import { BotProperties } from '@/features/lodging/components/bot-properties';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
import { loadNamespace } from '@/lib/i18n';

export const Route = createFileRoute('/app/bots/$botId/products')({
  // Hotel bots list places from the lodging namespace; a failed load shows raw keys there
  // instead of the error page (retail bots never read it).
  loader: () => loadNamespace('lodging').catch(() => undefined),
  component: function ProductsPage() {
    const { botId } = Route.useParams();
    const workspace = useCurrentWorkspace();
    if (workspace.isPending) return <Skeleton className="h-96 rounded-xl" />;
    return workspace.data?.industry === 'hotel' ? (
      <HotelBotProperties botId={botId} />
    ) : (
      <BotProducts botId={botId} />
    );
  },
});

/** Hotel bots sell places ("Căn hộ & phòng"), read from the lodging module (T-160). */
function HotelBotProperties({ botId }: { botId: string }) {
  const { t } = useTranslation('lodging');
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <DataPageHeader title={t('bot.title')} subtitle={t('bot.subtitle')} />
      <BotProperties botId={botId} />
    </section>
  );
}

function BotProducts({ botId }: { botId: string }) {
  const { t } = useTranslation('training');
  const bot = useBot(botId);
  const update = useUpdateBot(botId);
  const mode = bot.data?.catalogMode ?? 'all';
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
      <BotCatalogMode
        mode={mode}
        disabled={!bot.data}
        onChange={(catalogMode) =>
          update.mutate(
            { catalogMode },
            { onError: () => toast.error(t('data.products.modeError')) },
          )
        }
      />
      <BotProductsTable botId={botId} selecting={mode === 'selected'} />
    </section>
  );
}
