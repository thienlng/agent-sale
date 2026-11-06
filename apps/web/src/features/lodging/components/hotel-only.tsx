import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

/** The slice of the current-workspace query the guard needs; the route passes it in. */
export interface HotelOnlyWorkspace {
  isPending: boolean;
  isError: boolean;
  data?: { industry: string } | undefined;
  refetch: () => unknown;
}

/**
 * Renders its children only for a hotel business; other industries get a short
 * notice. The route composes it with `useCurrentWorkspace()` (features never
 * import each other).
 */
export function HotelOnly({
  workspace,
  children,
}: {
  workspace: HotelOnlyWorkspace;
  children: ReactNode;
}) {
  const { t } = useTranslation('lodging');
  if (workspace.isPending) return <p role="status">{t('loading')}</p>;
  if (workspace.isError)
    return (
      <div role="alert">
        {t('loadError')}
        <Button onClick={() => void workspace.refetch()}>{t('retry')}</Button>
      </div>
    );
  if (workspace.data?.industry !== 'hotel') return <p role="alert">{t('hotelOnly')}</p>;
  return children;
}
