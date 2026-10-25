import type { TrainingItemDto, TrainingSection } from '@agent-sales/contracts';
import { Copy, Lock, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  useAddStarterRules,
  useDeleteTrainingItem,
  useSaveTrainingItem,
  useToggleTrainingItem,
  useTrainingItems,
} from '../api/training';
import { matchesText } from '../utils/table-data';
import { DataError, DataPageHeader, DataSearch, tableFrame } from './data-page';
import { TrainingItemEditor } from './training-items';

const SYSTEM_RULES = ['sources', 'handover', 'secrecy', 'noInvent', 'actions'] as const;

function Group({
  title,
  hint,
  locked,
  children,
}: {
  title: string;
  hint?: string;
  locked?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <header>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {locked ? <Lock className="size-4 text-muted-foreground" aria-hidden /> : null}
          {title}
        </h2>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </header>
      <div className={cn(tableFrame, 'overflow-hidden')}>{children}</div>
    </section>
  );
}

function RuleRow({
  item,
  number,
  busy,
  onToggle,
  copyBusy,
  onCopy,
  onEdit,
  onDelete,
}: {
  item: TrainingItemDto;
  number: number;
  busy: boolean;
  copyBusy: boolean;
  onToggle: (enabled: boolean) => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('training');
  return (
    <li
      data-enabled={item.enabled}
      className="flex items-start gap-3 border-b px-3 py-3 last:border-b-0"
    >
      <span className="w-6 pt-0.5 text-center text-xs text-muted-foreground">{number}</span>
      <button
        type="button"
        className={cn(
          'min-w-0 flex-1 text-left hover:text-primary focus-visible:underline',
          !item.enabled && 'opacity-50',
        )}
        onClick={onEdit}
      >
        <h3 className="font-medium break-words">{item.title}</h3>
        {item.trigger ? (
          <p className="mt-1 text-xs break-words text-primary">{item.trigger}</p>
        ) : null}
        <p className="mt-1 line-clamp-2 text-xs break-words whitespace-pre-wrap text-muted-foreground">
          {item.content}
        </p>
        {!item.enabled ? (
          <span className="mt-1 inline-block text-xs text-muted-foreground">
            {t('rules.disabled')}
          </span>
        ) : null}
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        <Switch
          checked={item.enabled}
          disabled={busy}
          aria-label={t('rules.toggle', { title: item.title })}
          onCheckedChange={onToggle}
          className="mr-1"
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('rules.copy')}
          disabled={copyBusy}
          onClick={onCopy}
        >
          <Copy />
        </Button>
        <Button variant="ghost" size="icon" aria-label={t('edit')} onClick={onEdit}>
          <Pencil />
        </Button>
        <Button variant="ghost" size="icon" aria-label={t('delete')} onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}

/** The model gets at most this many enabled rules (backend MAX_SITUATIONS). */
const MAX_ENABLED_RULES = 20;
/** The counter appears once the owner is this close to the cap. */
const COUNTER_FROM = 15;

const byCreation = (a: TrainingItemDto, b: TrainingItemDto) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** "Hướng dẫn" page: rules grouped by section with switch, copy, edit, delete and search. */
export function RulesList({ botId, introduction }: { botId: string; introduction?: ReactNode }) {
  const { t } = useTranslation('training');
  const { t: common } = useTranslation();
  const items = useTrainingItems(botId);
  const save = useSaveTrainingItem(botId);
  const toggle = useToggleTrainingItem(botId);
  const remove = useDeleteTrainingItem(botId);
  const starter = useAddStarterRules(botId);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<{ item: TrainingItemDto | null } | null>(null);
  const [deleting, setDeleting] = useState<TrainingItemDto | null>(null);
  const rules = (items.data ?? []).filter((item) => item.kind === 'scenario').sort(byCreation);
  const bySection = (section: TrainingSection) => rules.filter((r) => r.section === section);
  const searching = search.trim() !== '';
  const onError = (error: unknown) => toast.error(errorMessage(common, error));

  function copy(item: TrainingItemDto) {
    if (save.isPending) return;
    save.mutate(
      {
        kind: 'scenario',
        title: t('rules.copyTitle', { title: item.title }).slice(0, 2000),
        content: item.content,
        trigger: item.trigger,
        notes: item.notes,
        mediaUrl: null,
        folderId: null,
        enabled: item.enabled,
        section: item.section,
      },
      { onSuccess: () => toast.success(t('rules.copied')), onError },
    );
  }

  function addStarter() {
    starter.mutate(undefined, {
      onSuccess: (created) =>
        toast.success(
          created.length
            ? t('rules.starterAdded', { count: created.length })
            : t('rules.starterNone'),
        ),
      onError,
    });
  }

  function renderGroup(section: TrainingSection, title: string) {
    const all = bySection(section);
    const shown = all
      .map((item, index) => ({ item, number: index + 1 }))
      .filter(({ item }) => matchesText(`${item.title} ${item.content} ${item.trigger}`, search));
    if (searching && !shown.length) return null;
    return (
      <Group title={title}>
        {shown.length ? (
          <ul>
            {shown.map(({ item, number }) => (
              <RuleRow
                key={item.id}
                item={item}
                number={number}
                busy={toggle.isPending && toggle.variables?.id === item.id}
                copyBusy={save.isPending}
                onToggle={(enabled) => toggle.mutate({ id: item.id, enabled }, { onError })}
                onCopy={() => copy(item)}
                onEdit={() => setEditor({ item })}
                onDelete={() => setDeleting(item)}
              />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {t('rules.groupEmpty')}
          </p>
        )}
      </Group>
    );
  }

  const enabledCount = rules.filter((r) => r.enabled).length;

  const noMatches =
    searching && !rules.some((r) => matchesText(`${r.title} ${r.content} ${r.trigger}`, search));

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <DataPageHeader title={t('rules.title')} subtitle={t('rules.subtitle')} />
      <div className="flex flex-wrap items-center gap-2">
        <DataSearch value={search} onChange={setSearch} placeholder={t('rules.search')} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {enabledCount >= COUNTER_FROM ? (
            <span
              data-testid="rules-counter"
              className={cn(
                'text-xs text-muted-foreground',
                enabledCount > MAX_ENABLED_RULES && 'font-medium text-destructive',
              )}
            >
              {t('rules.enabledCount', { count: enabledCount, max: MAX_ENABLED_RULES })}
            </span>
          ) : null}
          <Button
            variant="outline"
            className="h-9"
            disabled={starter.isPending}
            onClick={addStarter}
          >
            <Sparkles />
            {t('rules.starter')}
          </Button>
          <Button className="h-9" onClick={() => setEditor({ item: null })}>
            <Plus />
            {t('rules.add')}
          </Button>
        </div>
      </div>
      {items.isPending ? (
        <Skeleton className="h-52 w-full rounded-xl" />
      ) : items.isError ? (
        <DataError onRetry={() => void items.refetch()} />
      ) : (
        <>
          {introduction ? <Group title={t('rules.groupIntro')}>{introduction}</Group> : null}
          {!rules.length ? (
            <p className="text-sm text-muted-foreground">{t('rules.empty')}</p>
          ) : null}
          {noMatches ? (
            <p className="text-sm text-muted-foreground">{t('rules.noResults')}</p>
          ) : null}
          {renderGroup('general', t('rules.groupGeneral'))}
          {renderGroup('after_order', t('rules.groupAfterOrder'))}
          <Group title={t('rules.groupSystem')} hint={t('rules.systemHint')} locked>
            <ul data-testid="system-rules">
              {SYSTEM_RULES.map((key, index) => (
                <li
                  key={key}
                  className="flex items-start gap-3 border-b bg-muted/30 px-3 py-3 text-sm last:border-b-0"
                >
                  <span className="w-6 pt-0.5 text-center text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  <p className="min-w-0 flex-1">{t(`rules.system.${key}`)}</p>
                  <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="sr-only">{t('rules.locked')}</span>
                </li>
              ))}
            </ul>
          </Group>
        </>
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
            kind="scenario"
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
                    onError,
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
