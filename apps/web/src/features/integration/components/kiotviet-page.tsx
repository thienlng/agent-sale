import { Link } from '@tanstack/react-router';
import { ChevronLeft, CircleAlert, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/permissions';

import { kiotVietConnection, useIntegrations } from '../api/integrations';
import { KiotVietConnectionView } from './kiotviet-connection-view';
import { KiotVietWizard } from './kiotviet-wizard';

/** /app/integrations/kiotviet: the connect wizard until connected, then the connection view. */
export function KiotVietPage() {
  const { t } = useTranslation('integration');
  const canManage = useCan('settings.manage');
  const list = useIntegrations();
  const connection = kiotVietConnection(list.data);

  let body;
  if (list.isPending)
    body = (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  else if (list.isError)
    body = (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertDescription>{t('hub.loadError')}</AlertDescription>
      </Alert>
    );
  else if (connection)
    body = <KiotVietConnectionView connection={connection} canManage={canManage} />;
  else if (canManage) body = <KiotVietWizard />;
  else
    body = (
      <Alert role="note">
        <Info />
        <AlertDescription>{t('wizard.notConnected')}</AlertDescription>
      </Alert>
    );

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link
          to="/app/integrations"
          className="-ml-1 inline-flex min-h-11 items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft aria-hidden className="size-4" />
          {t('wizard.backToHub')}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {connection || list.isPending ? t('providers.kiotviet.name') : t('wizard.title')}
        </h1>
      </header>
      {body}
    </section>
  );
}
