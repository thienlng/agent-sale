import { createFileRoute } from '@tanstack/react-router';
import { StayRequestsPage } from '@/features/commerce/components/stay-requests-page';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/app/stays')({
  component: function Stays() {
    const workspace = useCurrentWorkspace(),
      { t } = useTranslation();
    if (workspace.isPending) return <p role="status">{t('lodging.loading')}</p>;
    if (workspace.isError)
      return (
        <div role="alert">
          {t('lodging.loadError')}
          <Button onClick={() => void workspace.refetch()}>{t('lodging.retry')}</Button>
        </div>
      );
    if (workspace.data?.industry !== 'hotel') return <p role="alert">{t('lodging.hotelOnly')}</p>;
    return <StayRequestsPage />;
  },
});
