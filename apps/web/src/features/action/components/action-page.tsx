import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { useAction } from '../api/actions';
import { ActionFormView } from './action-form';

/** Create page (no `actionId`) or edit page (loads the stored action first). */
export function ActionPage({ botId, actionId }: { botId: string; actionId?: string }) {
  const { t } = useTranslation('action');
  const action = useAction(botId, actionId);
  if (!actionId) return <ActionFormView botId={botId} />;
  if (action.isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (action.isError || !action.data)
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p>{t('form.loadError')}</p>
        <Button asChild variant="outline">
          <Link to="/app/bots/$botId/actions" params={{ botId }}>
            {t('form.cancel')}
          </Link>
        </Button>
      </div>
    );
  return <ActionFormView key={action.data.id} botId={botId} action={action.data} />;
}
