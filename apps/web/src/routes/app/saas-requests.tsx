import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { SaasRequestsPage } from '@/features/saas/components/saas-requests-page';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';

export const Route = createFileRoute('/app/saas-requests')({
  component: function SaasRequests() {
    const workspace = useCurrentWorkspace(),
      { t } = useTranslation();
    if (workspace.isPending) return <p role="status">{t('saas.loading')}</p>;
    if (workspace.isError)
      return (
        <div role="alert">
          {t('saas.loadError')}
          <Button onClick={() => void workspace.refetch()}>{t('saas.retry')}</Button>
        </div>
      );
    if (workspace.data?.industry !== 'saas') return <p role="alert">{t('saas.saasOnly')}</p>;
    return <SaasRequestsPage />;
  },
});
