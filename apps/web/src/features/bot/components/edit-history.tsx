import type { TrainingHistoryDto } from '@agent-sales/contracts';
import { History } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

import { useEditHistory, useRestoreHistory } from '../api/history';
import { defaultRange, filterHistory, type HistoryOrder, type HistoryTab } from '../utils/history';
import { HistoryEntry } from './history-entry';

/**
 * "Lịch sử chỉnh sửa": who changed the bot's settings or training data and
 * when, with a one-click restore of the state before a change.
 */
export function EditHistory({ botId }: { botId: string }) {
  const { t } = useTranslation('training');
  const { t: common } = useTranslation();
  const history = useEditHistory(botId);
  const restore = useRestoreHistory(botId);
  const [range, setRange] = useState(defaultRange);
  const [order, setOrder] = useState<HistoryOrder>('newest');
  const [tab, setTab] = useState<HistoryTab>('settings');
  const [pending, setPending] = useState<TrainingHistoryDto | null>(null);

  const entries = useMemo(
    () => filterHistory(history.data ?? [], { tab, order, ...range }),
    [history.data, tab, order, range],
  );

  function confirmRestore() {
    if (!pending) return;
    restore.mutate(pending.id, {
      onSuccess: () => toast.success(t('space.history.restored')),
      onError: (err) => toast.error(errorMessage(common, err)),
      onSettled: () => setPending(null),
    });
  }

  const sortButton = (value: HistoryOrder) => (
    <Button
      type="button"
      variant="outline"
      aria-pressed={order === value}
      onClick={() => setOrder(value)}
      className={cn(order === value && 'border-primary text-primary')}
    >
      {t(`space.history.${value}`)}
    </Button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3 border-b pb-4">
        <h1 className="mr-auto text-lg font-semibold">{t('space.history.title')}</h1>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            className="h-9 w-auto"
            aria-label={t('space.history.from')}
            value={range.from}
            max={range.to || undefined}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
          />
          <span aria-hidden className="text-muted-foreground">
            –
          </span>
          <Input
            type="date"
            className="h-9 w-auto"
            aria-label={t('space.history.to')}
            value={range.to}
            min={range.from || undefined}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          />
        </div>
        <div className="flex gap-2">
          {sortButton('newest')}
          {sortButton('oldest')}
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as HistoryTab)}>
        <TabsList variant="line" className="w-full justify-start border-b">
          <TabsTrigger value="settings" className="flex-none px-2 data-active:text-primary">
            {t('space.history.tabs.settings')}
          </TabsTrigger>
          <TabsTrigger value="training" className="flex-none px-2 data-active:text-primary">
            {t('space.history.tabs.training')}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {history.isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      ) : history.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p>{t('error')}</p>
          <Button variant="outline" onClick={() => void history.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : entries.length ? (
        <ol className="flex flex-col pt-2">
          {entries.map((entry) => (
            <HistoryEntry key={entry.id} entry={entry} onRestore={setPending} />
          ))}
        </ol>
      ) : (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <History aria-hidden className="size-8 text-muted-foreground" />
          <p className="font-medium">{t('space.history.emptyTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('space.history.emptyBody')}</p>
        </div>
      )}

      <AlertDialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('space.history.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('space.history.confirmBody', { title: pending?.title ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restore.isPending}>
              {common('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={restore.isPending}
              onClick={(e) => {
                e.preventDefault();
                confirmRestore();
              }}
            >
              {t('space.history.restore')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
