import type { AssistantThreadDto } from '@agent-sales/contracts';
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Longest thread title the server takes (`UpdateAssistantThreadRequest`). */
const TITLE_MAX = 120;

/** What a row's menu does; the list runs the mutations. */
export interface RowActions {
  rename: (thread: AssistantThreadDto, title: string) => void;
  pin: (thread: AssistantThreadDto) => void;
  archive: (thread: AssistantThreadDto) => void;
  unarchive: (thread: AssistantThreadDto) => void;
  askDelete: (thread: AssistantThreadDto) => void;
}

/**
 * One conversation: the pick button and its "⋯" menu side by side (never a button in a button).
 * The menu shows on hover or keyboard focus, and always on the current row and on touch screens.
 */
export function ThreadRow({
  thread,
  current,
  onPick,
  actions,
}: {
  thread: AssistantThreadDto;
  current: boolean;
  onPick: (threadId: string) => void;
  actions: RowActions;
}) {
  const { t } = useTranslation('assistant');
  const [renaming, setRenaming] = useState(false);
  // The menu hands focus back to its trigger on close; not when the rename field takes it.
  const toRename = useRef(false);
  const title = thread.title || t('untitled');

  return (
    <li
      className={cn(
        'group/row flex h-8 min-w-0 items-center rounded-md text-sm text-foreground/85 transition-colors hover:bg-muted/60 hover:text-foreground',
        current && 'bg-muted font-medium text-foreground hover:bg-muted',
      )}
    >
      {renaming ? (
        <RenameField
          initial={thread.title}
          label={t('threadMenu.renameLabel')}
          onDone={(next) => {
            setRenaming(false);
            if (next !== null) actions.rename(thread, next);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => onPick(thread.id)}
          aria-current={current ? 'true' : undefined}
          title={title}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pl-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {thread.pinned ? (
            <Pin className="size-3.5 shrink-0 text-brand-text" aria-label={t('pinned')} />
          ) : null}
        </button>
      )}
      {renaming ? null : (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('threadMenu.open', { title })}
              className={cn(
                'mx-1 grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition-opacity hover:bg-background/70 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100',
                current ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100',
              )}
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              if (!toRename.current) return;
              toRename.current = false;
              event.preventDefault();
            }}
          >
            {thread.archived ? (
              <DropdownMenuItem onSelect={() => actions.unarchive(thread)}>
                <ArchiveRestore />
                {t('threadMenu.unarchive')}
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem
                  onSelect={() => {
                    toRename.current = true;
                    setRenaming(true);
                  }}
                >
                  <Pencil />
                  {t('threadMenu.rename')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.pin(thread)}>
                  {thread.pinned ? <PinOff /> : <Pin />}
                  {thread.pinned ? t('threadMenu.unpin') : t('threadMenu.pin')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.archive(thread)}>
                  <Archive />
                  {t('threadMenu.archive')}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => actions.askDelete(thread)}>
              <Trash2 />
              {t('threadMenu.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

/**
 * The inline title editor: Enter or leaving the field saves, Escape keeps the old title.
 * `onDone(null)` when nothing changed.
 */
function RenameField({
  initial,
  label,
  onDone,
}: {
  initial: string;
  label: string;
  onDone: (title: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const finished = useRef(false);
  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const next = value.trim();
    onDone(save && next && next !== initial ? next : null);
  };
  return (
    <Input
      autoFocus
      aria-label={label}
      value={value}
      maxLength={TITLE_MAX}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      className="mx-0.5 h-7 flex-1 px-1.5 md:text-sm"
    />
  );
}
