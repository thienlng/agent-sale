import type { ConnectionDto, PmsProvider } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import { ConnectionStatusBadge } from './connection-status-badge';
import { KiotVietLogo } from './kiotviet-logo';

/** One PMS on the hub: value line and state ("Kết nối", its status, or "Sắp có"). */
export function ProviderCard({
  provider,
  available,
  connection,
  canManage,
}: {
  provider: PmsProvider;
  available: boolean;
  connection: ConnectionDto | null;
  canManage: boolean;
}) {
  const { t } = useTranslation('integration');
  const name = t(`providers.${provider}.name`);
  const live = provider === 'kiotviet' && available;
  return (
    <Card className={live ? undefined : 'opacity-75'}>
      <CardContent className="flex h-full flex-col gap-4">
        <div className="flex items-start gap-3">
          {provider === 'kiotviet' ? (
            <KiotVietLogo />
          ) : (
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Store aria-hidden className="size-5" />
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="font-semibold">{name}</h2>
            {provider === 'kiotviet' ? (
              <p className="text-sm text-muted-foreground">{t('providers.kiotviet.description')}</p>
            ) : null}
          </div>
        </div>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
          {!live ? (
            <Badge variant="secondary">{t('hub.comingSoon')}</Badge>
          ) : connection ? (
            <>
              <ConnectionStatusBadge status={connection.status} />
              <Button asChild variant="outline" className="h-11">
                <Link to="/app/integrations/kiotviet" aria-label={`${t('hub.manage')} ${name}`}>
                  {t('hub.manage')}
                </Link>
              </Button>
            </>
          ) : canManage ? (
            <Button asChild className="h-11">
              <Link to="/app/integrations/kiotviet" aria-label={`${t('hub.connect')} ${name}`}>
                {t('hub.connect')}
              </Link>
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">{t('hub.notConnected')}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
