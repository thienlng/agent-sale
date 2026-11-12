import type { AssistantMemoryEntryDto, AssistantMemoryStoreDto } from '@agent-sales/contracts';
import { Check, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

import {
  useApproveAssistantMemory,
  useAssistantMemory,
  useForgetAssistantMemory,
} from '../api/assistant';

/** `owner_profile` and `notes` have translated names; a business store carries its name. */
function useStoreLabel(store: AssistantMemoryStoreDto): string {
  const { t } = useTranslation('assistant');
  return store.store === 'owner_profile' || store.store === 'notes'
    ? t(`memory.stores.${store.store}`)
    : store.label;
}

function MemoryEntry({ store, entry }: { store: string; entry: AssistantMemoryEntryDto }) {
  const { t } = useTranslation('assistant');
  const [confirming, setConfirming] = useState(false);
  const forget = useForgetAssistantMemory();
  const approve = useApproveAssistantMemory();
  return (
    <li className="flex flex-col gap-2 rounded-lg border px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm break-words whitespace-pre-line">{entry.text}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {entry.pending ? <Badge variant="secondary">{t('memory.pending')}</Badge> : null}
            <span className="text-xs text-muted-foreground">
              {t(`memory.origin.${entry.origin}`)}
            </span>
          </div>
        </div>
        {entry.pending && !confirming ? (
          <Button
            variant="outline"
            size="sm"
            disabled={approve.isPending}
            onClick={() =>
              approve.mutate(
                { store, entryId: entry.id },
                {
                  onSuccess: () => toast.success(t('memory.approved')),
                  onError: () => toast.error(t('memory.approveError')),
                },
              )
            }
          >
            <Check />
            {t('memory.approve')}
          </Button>
        ) : null}
        {confirming ? null : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('memory.forget')}
            onClick={() => setConfirming(true)}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      {confirming ? (
        <div className="flex items-center gap-2" role="group" aria-label={t('memory.confirm')}>
          <span className="flex-1 text-xs text-muted-foreground">{t('memory.confirm')}</span>
          <Button
            size="sm"
            variant="destructive"
            disabled={forget.isPending}
            onClick={() =>
              forget.mutate(
                { store, entryId: entry.id },
                {
                  onSuccess: () => toast.success(t('memory.forgotten')),
                  onError: () => {
                    setConfirming(false);
                    toast.error(t('memory.forgetError'));
                  },
                },
              )
            }
          >
            {t('memory.confirmYes')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={forget.isPending}
            onClick={() => setConfirming(false)}
          >
            {t('memory.confirmNo')}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function MemoryStore({ store }: { store: AssistantMemoryStoreDto }) {
  const { t } = useTranslation('assistant');
  const label = useStoreLabel(store);
  const percent = store.limit > 0 ? Math.min(100, Math.round((store.used / store.limit) * 100)) : 0;
  return (
    <section className="flex flex-col gap-2" aria-label={label}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="truncate text-sm font-semibold">{label}</h3>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {t('memory.usage', { used: store.used, limit: store.limit })}
        </span>
      </div>
      <Progress
        value={percent}
        aria-label={t('memory.usage', { used: store.used, limit: store.limit })}
      />
      {store.entries.length ? (
        <ul className="flex flex-col gap-2">
          {store.entries.map((entry) => (
            <MemoryEntry key={entry.id} store={store.store} entry={entry} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t('memory.empty')}</p>
      )}
    </section>
  );
}

/**
 * "Trợ lý nhớ gì": every memory store with its use, and a confirmed delete per entry. An entry
 * waiting for approval (saved by the review or after the assistant read data) shows a badge and
 * an approve button; forgetting it rejects it.
 */
export function AssistantMemory() {
  const { t } = useTranslation('assistant');
  const memory = useAssistantMemory();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
      <h2 className="font-semibold">{t('memory.title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('memory.hint')}</p>
      {memory.isPending ? (
        <div className="mt-4 flex flex-col gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : memory.isError ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {t('loadError')}
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-5">
          {memory.data.stores.map((store) => (
            <MemoryStore key={store.store} store={store} />
          ))}
        </div>
      )}
    </div>
  );
}
