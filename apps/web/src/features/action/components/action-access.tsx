import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useCan } from '@/lib/permissions';

/** API actions carry third-party secrets: the pages open for `bots.manage` only, like the API. */
export function ActionAccess({ children }: { children: ReactNode }) {
  const { t } = useTranslation('action');
  if (!useCan('bots.manage'))
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        {t('noPermission')}
      </p>
    );
  return <>{children}</>;
}
