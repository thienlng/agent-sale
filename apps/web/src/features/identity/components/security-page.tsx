import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { useMfaStatus } from '../api/mfa';
import { EnableMfaDialog, ReauthMfaDialog } from './mfa-dialogs';

/** Account security (ADM-04): two-step verification with an authenticator app. */
export function SecurityPage() {
  const { t } = useTranslation();
  const status = useMfaStatus();
  const [enabling, setEnabling] = useState(false);
  const [reauth, setReauth] = useState<'disable' | 'regenerate' | null>(null);

  return (
    <section className="max-w-2xl rounded-lg border p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('wsettings.security.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('wsettings.security.hint')}</p>
        </div>
        {status.data ? (
          <Badge variant={status.data.enabled ? 'default' : 'secondary'}>
            {status.data.enabled ? t('wsettings.security.on') : t('wsettings.security.off')}
          </Badge>
        ) : null}
      </div>
      {status.isPending ? (
        <Skeleton className="mt-4 h-9 w-48" />
      ) : status.data?.enabled ? (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {t('wsettings.security.recoveryLeft', { count: status.data.recoveryCodesLeft })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setReauth('regenerate')}>
              {t('wsettings.security.newCodes')}
            </Button>
            <Button variant="outline" onClick={() => setReauth('disable')}>
              {t('wsettings.security.disable')}
            </Button>
          </div>
        </div>
      ) : (
        <Button className="mt-4" onClick={() => setEnabling(true)}>
          {t('wsettings.security.enable')}
        </Button>
      )}
      <EnableMfaDialog open={enabling} onClose={() => setEnabling(false)} />
      <ReauthMfaDialog mode={reauth} onClose={() => setReauth(null)} />
    </section>
  );
}
