import { TrainingPurpose } from './training-purpose';
import type { FaqDto } from '@agent-sales/contracts';
import { Download, Trash2 } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';

import { useDeleteFaqs, useFaqs } from '../api/faqs';
import { downloadFaqCsv } from '../utils/faq-csv';
import { matchesText, paginate } from '../utils/table-data';
import { BusinessProfileForm } from './business-profile-form';
import {
  AddMenuButton,
  DataEmptyState,
  DataError,
  DataPageHeader,
  DataPagination,
  DataSearch,
  tableFrame,
} from './data-page';
import { FaqDialog } from './faq-dialog';
import { FaqTable } from './faq-table';
import { FaqImportDialog } from './faq-transfer';

/** "Thông tin" page: the bot's FAQ table with search, selection, import/export. */
export function FaqList({ botId }: { botId: string }) {
  const { t } = useTranslation('training');
  const { t: common } = useTranslation();
  const faqs = useFaqs(botId);
  const removeMany = useDeleteFaqs(botId);
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<FaqDto | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const visible = useMemo(
    () => (faqs.data ?? []).filter((f) => matchesText(f.question, deferred)),
    [faqs.data, deferred],
  );
  const current = paginate(visible, page, pageSize);

  const open = (faq: FaqDto | null) => {
    setEditing(faq);
    setDialogOpen(true);
  };
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const toggleAll = (checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const faq of current.items) {
        if (checked) next.add(faq.id);
        else next.delete(faq.id);
      }
      return next;
    });
  const deleteSelected = () => {
    const ids = [...selected];
    removeMany.mutate(ids, {
      onSuccess: () => toast.success(t('data.faq.bulkDeleted', { count: ids.length })),
      onError: (err) => toast.error(errorMessage(common, err)),
      onSettled: () => setSelected(new Set()),
    });
    setConfirmBulk(false);
  };

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <DataPageHeader title={t('data.faq.title')} subtitle={t('data.faq.subtitle')} />
      <TrainingPurpose botId={botId} kind="facts" />
      <BusinessProfileForm botId={botId} />
      <h2 className="-mb-2 text-base font-semibold">{t('profile.faqTitle')}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <DataSearch
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
          placeholder={t('data.faq.search')}
        />
        {selected.size ? (
          <Button variant="destructive" className="h-9" onClick={() => setConfirmBulk(true)}>
            <Trash2 />
            {t('data.delete')} ({selected.size})
          </Button>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="icon-lg"
            disabled={!faqs.data?.length}
            aria-label={t('data.faq.exportCsv')}
            title={t('data.faq.exportCsv')}
            onClick={() => downloadFaqCsv(faqs.data ?? [], `bot-${botId}-faqs.csv`)}
          >
            <Download />
          </Button>
          <AddMenuButton
            label={t('data.faq.add')}
            onManual={() => open(null)}
            onImport={() => setImportOpen(true)}
          />
        </div>
      </div>

      {faqs.isPending ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : faqs.isError ? (
        <DataError onRetry={() => void faqs.refetch()} />
      ) : (
        <>
          <div className={tableFrame}>
            {current.items.length ? (
              <div className="overflow-x-auto">
                <FaqTable
                  rows={current.items}
                  offset={current.offset}
                  selected={selected}
                  onToggle={toggle}
                  onToggleAll={toggleAll}
                  onOpen={open}
                />
              </div>
            ) : (
              <DataEmptyState
                message={faqs.data.length ? t('data.faq.empty') : t('data.faq.emptyStart')}
              />
            )}
          </div>
          <DataPagination
            total={t('data.faq.total', { count: visible.length })}
            page={current.page}
            pages={current.pages}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </>
      )}

      <FaqDialog botId={botId} open={dialogOpen} faq={editing} onOpenChange={setDialogOpen} />
      <FaqImportDialog botId={botId} open={importOpen} onOpenChange={setImportOpen} />
      <AlertDialog open={confirmBulk} onOpenChange={setConfirmBulk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('data.faq.bulkConfirm', { count: selected.size })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('data.faq.bulkConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('data.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={deleteSelected}>
              {t('data.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
