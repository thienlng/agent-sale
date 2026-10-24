import {
  CreateTrainingItemRequest,
  type TrainingItemDto,
  type TrainingKind,
} from '@agent-sales/contracts';
import { Plus } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/errors';
import { useDeleteTrainingItem, useSaveTrainingItem, useTrainingItems } from '../api/training';
import { matchesText } from '../utils/table-data';
import { DataEmptyState, DataError, DataPageHeader, DataSearch, tableFrame } from './data-page';
import { TrainingTable } from './training-table';

function TrainingItemEditor({
  botId,
  kind,
  item,
  onClose,
}: {
  botId: string;
  kind: TrainingKind;
  item: TrainingItemDto | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('training');
  const { t: common } = useTranslation();
  const save = useSaveTrainingItem(botId);
  const [title, setTitle] = useState(item?.title ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [content, setContent] = useState(item?.content ?? '');
  const [trigger, setTrigger] = useState(item?.trigger ?? '');
  const [mediaUrl, setMediaUrl] = useState(item?.mediaUrl ?? '');
  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = CreateTrainingItemRequest.safeParse({
      kind,
      notes,
      title,
      content,
      trigger,
      mediaUrl: mediaUrl.trim() || null,
    });
    if (!parsed.success) {
      toast.error(t('invalid'));
      return;
    }
    save.mutate(
      { ...parsed.data, ...(item ? { id: item.id } : {}) },
      {
        onSuccess: () => {
          toast.success(t('saved'));
          onClose();
        },
        onError: (error) => toast.error(errorMessage(common, error)),
      },
    );
  }
  return (
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{t(item ? 'edit' : 'add')}</DialogTitle>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="training-title">{t('title')}</Label>
          <Input
            id="training-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={kind === 'scenario' ? 2000 : 160}
            required
          />
        </div>
        {kind !== 'media' ? (
          <div className="space-y-2">
            <Label htmlFor="training-trigger">{t('trigger')}</Label>
            <Input
              id="training-trigger"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              maxLength={500}
            />
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="training-content">{t('content')}</Label>
          <Textarea
            id="training-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={kind === 'scenario' ? 4000 : 8000}
            rows={7}
            required
          />
        </div>
        {kind === 'scenario' ? (
          <div className="space-y-2">
            <Label htmlFor="training-notes">{t('notes')}</Label>
            <Textarea
              id="training-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
              rows={3}
            />
            <p className="text-right text-xs text-muted-foreground">{notes.length}/2000</p>
          </div>
        ) : null}
        {kind === 'media' ? (
          <div className="space-y-2">
            <Label htmlFor="training-url">{t('mediaUrl')}</Label>
            <Input
              id="training-url"
              type="url"
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              maxLength={2000}
            />
            <p className="text-sm text-muted-foreground">{t('mediaHint')}</p>
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t('save')}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

/** Scenario ("Hướng dẫn") and legacy quick-reply list: page header, search, table. */
export function TrainingItems({
  botId,
  kind,
  introduction,
}: {
  botId: string;
  kind: 'scenario' | 'quick_reply';
  introduction?: ReactNode;
}) {
  const { t } = useTranslation('training');
  const { t: common } = useTranslation();
  const items = useTrainingItems(botId);
  const remove = useDeleteTrainingItem(botId);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<{ item: TrainingItemDto | null } | null>(null);
  const [deleting, setDeleting] = useState<TrainingItemDto | null>(null);
  const all = (items.data ?? []).filter((item) => item.kind === kind);
  const visible = all.filter((item) =>
    matchesText(`${item.title} ${item.content} ${item.trigger}`, search),
  );
  const scenario = kind === 'scenario';
  return (
    <section className="flex min-w-0 flex-col gap-5">
      <DataPageHeader
        title={scenario ? t('data.instructions.title') : t('quickTitle')}
        subtitle={scenario ? t('data.instructions.subtitle') : t('quickSubtitle')}
      />
      {introduction}
      <div className="flex flex-wrap items-center gap-2">
        <DataSearch
          value={search}
          onChange={setSearch}
          placeholder={scenario ? t('data.instructions.search') : t('search')}
        />
        <Button className="ml-auto h-9" onClick={() => setEditor({ item: null })}>
          <Plus />
          {scenario ? t('data.instructions.add') : t('add')}
        </Button>
      </div>
      {items.isPending ? (
        <Skeleton className="h-52 w-full rounded-xl" />
      ) : items.isError ? (
        <DataError onRetry={() => void items.refetch()} />
      ) : !visible.length ? (
        <div className={tableFrame}>
          <DataEmptyState
            message={
              all.length ? t('noResults') : scenario ? t('data.instructions.empty') : t('empty')
            }
          >
            {all.length ? null : (
              <Button variant="outline" onClick={() => setEditor({ item: null })}>
                <Plus />
                {scenario ? t('data.instructions.add') : t('add')}
              </Button>
            )}
          </DataEmptyState>
        </div>
      ) : (
        <TrainingTable
          key={search}
          items={visible}
          kind={kind}
          onEdit={(item) => setEditor({ item })}
          onDelete={setDeleting}
        />
      )}
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        {editor ? (
          <TrainingItemEditor
            botId={botId}
            kind={kind}
            item={editor.item}
            onClose={() => setEditor(null)}
          />
        ) : null}
      </Dialog>
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirm', { title: deleting?.title })}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (deleting)
                  remove.mutate(deleting.id, {
                    onSuccess: () => {
                      toast.success(t('deleted'));
                      setDeleting(null);
                    },
                    onError: (error) => toast.error(errorMessage(common, error)),
                  });
              }}
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
