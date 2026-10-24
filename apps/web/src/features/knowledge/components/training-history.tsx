import { History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTrainingHistory } from '../api/training';

export function TrainingHistory({ botId }: { botId: string }) {
  const { t, i18n } = useTranslation('training');
  const history = useTrainingHistory(botId);
  return (
    <section className="min-w-0 space-y-5">
      <header>
        <h2 className="text-xl font-semibold">{t('historyTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('historySubtitle')}</p>
      </header>
      {history.isPending ? (
        <Skeleton className="h-48" />
      ) : history.isError ? (
        <div role="alert">
          <p>{t('error')}</p>
          <Button variant="outline" onClick={() => void history.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : !history.data?.length ? (
        <div className="rounded-xl border border-dashed px-4 py-14 text-center">
          <History className="mx-auto size-8 text-primary" />
          <h3 className="mt-3 font-semibold">{t('historyEmpty')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('historyEmptyBody')}</p>
        </div>
      ) : (
        <ul className="divide-y rounded-xl border">
          {history.data.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
              <div className="min-w-0">
                <p className="break-words font-medium">{entry.title}</p>
                <p className="text-sm text-muted-foreground">
                  {t(entry.kind === 'media' ? 'mediaKind' : entry.kind)} ·{' '}
                  {t(entry.action === 'deleted' ? 'deletedAction' : entry.action)}
                </p>
              </div>
              <time className="text-xs text-muted-foreground" dateTime={entry.createdAt}>
                {new Date(entry.createdAt).toLocaleString(i18n.language)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
