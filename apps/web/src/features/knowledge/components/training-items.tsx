import {
  CreateTrainingItemRequest,
  type TrainingItemDto,
  type TrainingKind,
} from '@agent-sales/contracts';
import { foldVietnamese } from '@agent-sales/shared';
import { FileText, Image, Pencil, Plus, Search, Trash2 } from 'lucide-react';
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
import { TrainingTable } from './training-table';
import { useDeleteTrainingItem, useSaveTrainingItem, useTrainingItems } from '../api/training';

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

export function TrainingItems({
  botId,
  kind,
  introduction,
}: {
  botId: string;
  kind: TrainingKind;
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
    foldVietnamese(`${item.title} ${item.content} ${item.trigger}`).includes(
      foldVietnamese(search),
    ),
  );
  const title =
    kind === 'scenario' ? 'scenarioTitle' : kind === 'quick_reply' ? 'quickTitle' : 'mediaTitle';
  const subtitle =
    kind === 'scenario'
      ? 'scenarioSubtitle'
      : kind === 'quick_reply'
        ? 'quickSubtitle'
        : 'mediaSubtitle';
  return (
    <section className="min-w-0 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-tight">{t(title)}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(subtitle)}</p>
        </div>
        <Button onClick={() => setEditor({ item: null })}>
          <Plus />
          {t('add')}
        </Button>
      </header>
      {introduction}
      <div className="relative">
        <Search aria-hidden className="absolute top-3 left-3 size-4 text-muted-foreground" />
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          className="pl-9"
        />
      </div>
      {items.isPending ? (
        <Skeleton className="h-52 w-full" />
      ) : items.isError ? (
        <div role="alert" className="rounded-xl border p-6">
          <p>{t('error')}</p>
          <Button variant="outline" className="mt-3" onClick={() => void items.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : !all.length ? (
        <div className="rounded-xl border border-dashed px-4 py-14 text-center">
          <FileText className="mx-auto size-8 text-primary" aria-hidden />
          <h3 className="mt-3 font-semibold">{t('empty')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('emptyBody')}</p>
          <Button variant="outline" className="mt-4" onClick={() => setEditor({ item: null })}>
            <Plus />
            {t('add')}
          </Button>
        </div>
      ) : !visible.length ? (
        <p className="py-8 text-center text-muted-foreground">{t('noResults')}</p>
      ) : kind !== 'media' ? (
        <TrainingTable
          key={search}
          items={visible}
          kind={kind}
          onEdit={(item) => setEditor({ item })}
          onDelete={setDeleting}
        />
      ) : (
        <ul className="divide-y rounded-xl border">
          {visible.map((item) => (
            <li key={item.id} className="flex min-w-0 items-start gap-2 p-4">
              <div className="min-w-0 flex-1">
                {kind === 'media' ? (
                  <Image className="mb-2 size-5 text-primary" aria-hidden />
                ) : null}
                <h3 className="break-words font-medium">{item.title}</h3>
                {item.trigger ? (
                  <p className="mt-1 break-words text-sm text-primary">{item.trigger}</p>
                ) : null}
                <p className="mt-1 line-clamp-3 break-words whitespace-pre-wrap text-sm text-muted-foreground">
                  {item.content}
                </p>
                {item.mediaUrl ? (
                  <a
                    className="mt-2 block truncate text-sm text-primary underline"
                    href={item.mediaUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {item.mediaUrl}
                  </a>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('edit')}
                onClick={() => setEditor({ item })}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('delete')}
                onClick={() => setDeleting(item)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {items.data ? (
        <p className="text-sm text-muted-foreground">{t('total', { count: all.length })}</p>
      ) : null}
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
