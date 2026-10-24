import type { TrainingItemDto } from '@agent-sales/contracts';
import { ListFilter, Plus } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';

import { useDeleteTrainingItem, useTrainingItems } from '../api/training';
import { displayShortcut, filterQuickReplies, type ImageFilter } from '../utils/quick-replies';
import { paginate } from '../utils/table-data';
import {
  DataEmptyState,
  DataError,
  DataPageHeader,
  DataPagination,
  DataSearch,
  tableFrame,
} from './data-page';
import { QuickReplyDialog } from './quick-reply-dialog';
import { QuickReplyTable } from './quick-reply-table';

/** The footer only appears once there is more than the smallest page to browse. */
const PAGE_SIZE_THRESHOLD = 10;

const FILTERS = [
  ['all', 'data.quick.filterAll'],
  ['with', 'data.quick.filterWithImage'],
  ['without', 'data.quick.filterWithoutImage'],
] as const;

function ImageFilterButton({
  value,
  onChange,
}: {
  value: ImageFilter;
  onChange: (value: ImageFilter) => void;
}) {
  const { t } = useTranslation('training');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9" aria-label={t('data.quick.filter')}>
          {t('data.quick.filter')}
          {value !== 'all' ? (
            <span className="size-1.5 rounded-full bg-primary" aria-hidden />
          ) : null}
          <ListFilter aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56">
        <RadioGroup value={value} onValueChange={(v) => onChange(v as ImageFilter)}>
          {FILTERS.map(([key, label]) => (
            <div key={key} className="flex items-center gap-2">
              <RadioGroupItem id={`quick-filter-${key}`} value={key} />
              <Label htmlFor={`quick-filter-${key}`} className="font-normal">
                {t(label)}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </PopoverContent>
    </Popover>
  );
}

/** "Tin nhắn nhanh" page: shortcut → content (+ optional image) used by agents and the bot. */
export function QuickReplyList({ botId }: { botId: string }) {
  const { t } = useTranslation('training');
  const { t: common } = useTranslation();
  const items = useTrainingItems(botId);
  const remove = useDeleteTrainingItem(botId);
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [filter, setFilter] = useState<ImageFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editor, setEditor] = useState<{ item: TrainingItemDto | null } | null>(null);
  const [deleting, setDeleting] = useState<TrainingItemDto | null>(null);

  const all = items.data ?? [];
  const total = all.filter((i) => i.kind === 'quick_reply').length;
  const visible = filterQuickReplies(all, deferred, filter);
  const current = paginate(visible, page, pageSize);
  const images = all.filter((i) => i.kind === 'media' && i.mediaUrl);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <DataPageHeader title={t('data.quick.title')} />
      <Separator />
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="quick-search">{t('data.searchLabel')}</Label>
          <div className="flex gap-2">
            <DataSearch
              id="quick-search"
              value={query}
              onChange={(value) => {
                setQuery(value);
                setPage(1);
              }}
              placeholder={t('data.quick.search')}
              className="sm:w-72"
            />
            <ImageFilterButton
              value={filter}
              onChange={(value) => {
                setFilter(value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <Button className="ml-auto h-9" onClick={() => setEditor({ item: null })}>
          <Plus />
          {t('data.quick.add')}
        </Button>
      </div>
      <p className="text-sm">{t('data.quick.total', { count: total })}</p>

      {items.isPending ? (
        <Skeleton className="h-60 rounded-xl" />
      ) : items.isError ? (
        <DataError onRetry={() => void items.refetch()} />
      ) : (
        <>
          <div className={tableFrame}>
            {current.items.length ? (
              <div className="overflow-x-auto">
                <QuickReplyTable
                  rows={current.items}
                  onEdit={(item) => setEditor({ item })}
                  onDelete={setDeleting}
                />
              </div>
            ) : (
              <DataEmptyState message={t('data.quick.empty')} />
            )}
          </div>
          {visible.length > PAGE_SIZE_THRESHOLD ? (
            <DataPagination
              total={t('data.quick.total', { count: visible.length })}
              page={current.page}
              pages={current.pages}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          ) : null}
        </>
      )}

      <Dialog open={editor !== null} onOpenChange={(open) => !open && setEditor(null)}>
        {editor ? (
          <QuickReplyDialog
            botId={botId}
            item={editor.item}
            images={images}
            onClose={() => setEditor(null)}
          />
        ) : null}
      </Dialog>
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('data.quick.deleteConfirm', {
                shortcut: deleting ? displayShortcut(deleting).slice(1) : '',
              })}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('data.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (!deleting) return;
                remove.mutate(deleting.id, {
                  onSuccess: () => toast.success(t('data.quick.deleted')),
                  onError: (error) => toast.error(errorMessage(common, error)),
                });
                setDeleting(null);
              }}
            >
              {t('data.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
