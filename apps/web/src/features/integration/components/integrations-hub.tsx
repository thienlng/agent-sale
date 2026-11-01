import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/permissions';

import { kiotVietConnection, useIntegrations } from '../api/integrations';
import { ProviderCard } from './provider-card';

/** "Tích hợp PMS" (/app/integrations): the point-of-sale systems a shop can connect. */
export function IntegrationsHub() {
  const { t } = useTranslation('integration');
  const canManage = useCan('settings.manage');
  const list = useIntegrations();
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('hub.title')}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t('hub.subtitle')}</p>
      </header>
      {list.isError ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{t('hub.loadError')}</AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.data
            ? list.data.providers.map((p) => (
                <ProviderCard
                  key={p.provider}
                  provider={p.provider}
                  available={p.available}
                  connection={p.provider === 'kiotviet' ? kiotVietConnection(list.data) : null}
                  canManage={canManage}
                />
              ))
            : Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      )}
    </section>
  );
}
