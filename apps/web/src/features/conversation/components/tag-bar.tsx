import { Check, ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { InboxTagChip } from '../lib/inbox-v2-types';
import { TagChip } from './tag-chip';

export interface LibraryTag {
  id: string;
  name: string;
  color: string;
  /** Conversations and customers carrying the tag; the most used are suggested first. */
  activeCount?: number;
}

/** Library tags most used first; ties keep the library order. */
export function suggestTags(
  library: readonly LibraryTag[],
  applied: readonly InboxTagChip[],
): LibraryTag[] {
  const used = new Set(applied.map((tag) => tag.id));
  return library
    .map((tag, index) => ({ tag, index }))
    .filter(({ tag }) => !used.has(tag.id))
    .sort((a, b) => (b.tag.activeCount ?? 0) - (a.tag.activeCount ?? 0) || a.index - b.index)
    .map(({ tag }) => tag);
}

/**
 * One line above the composer: this conversation's tags (filled, removable), then the most used
 * library tags as one-click outline chips, then "+ Tag" for a searchable picker. The chevron
 * shows every tag; the choice is remembered by the caller.
 */
export function TagBar({
  tags,
  library,
  expanded,
  onExpandedChange,
  pickerOpen,
  onPickerOpenChange,
  onAttach,
  onRemove,
  readOnly = false,
}: {
  tags: readonly InboxTagChip[];
  library: readonly LibraryTag[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  onAttach: (tag: LibraryTag) => void;
  onRemove: (tag: InboxTagChip & { assignmentId: string }) => void;
  /** Without permission to edit, tags are shown but cannot change. */
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.v2.tagBar.${key}`, options ?? {});
  const suggestions = readOnly ? [] : suggestTags(library, tags);
  const applied = (tagId: string) => tags.find((tag) => tag.id === tagId);
  return (
    <div
      role="group"
      aria-label={tr('label')}
      className="flex shrink-0 items-start gap-1.5 border-t bg-background px-3 py-1.5"
    >
      <ul
        className={cn(
          'flex min-w-0 flex-1 flex-wrap items-center gap-1 overflow-hidden',
          // Collapsed: a single row; whatever does not fit is clipped, the picker lists all tags.
          !expanded && 'max-h-6',
        )}
      >
        {tags.map((tag) => (
          <li key={tag.id} className="max-w-full">
            <TagChip name={tag.name} color={tag.color} className="h-6 bg-muted/60 pr-0.5 text-xs">
              {tag.assignmentId && !readOnly ? (
                <button
                  type="button"
                  aria-label={tr('remove', { name: tag.name })}
                  className="grid size-4 place-items-center rounded-sm hover:bg-foreground/10"
                  onClick={() => onRemove({ ...tag, assignmentId: tag.assignmentId as string })}
                >
                  <X className="size-3" aria-hidden />
                </button>
              ) : null}
            </TagChip>
          </li>
        ))}
        {suggestions.map((tag) => (
          <li key={tag.id} className="max-w-full">
            <button
              type="button"
              aria-label={tr('attach', { name: tag.name })}
              onClick={() => onAttach(tag)}
              className="inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-dashed px-1.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
            >
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full bg-primary"
                style={
                  /^#[0-9a-fA-F]{6}$/.test(tag.color) ? { backgroundColor: tag.color } : undefined
                }
              />
              <span className="truncate">{tag.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex shrink-0 items-center gap-0.5">
        {readOnly ? null : (
          <Popover open={pickerOpen} onOpenChange={onPickerOpenChange}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs"
                aria-label={tr('addLabel')}
                aria-keyshortcuts="T"
              >
                <Plus />
                {tr('add')}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" side="top" className="w-64 p-0">
              <Command>
                <CommandInput placeholder={tr('search')} />
                <CommandList>
                  <CommandEmpty>{library.length ? tr('empty') : tr('none')}</CommandEmpty>
                  <CommandGroup>
                    {library.map((tag) => {
                      const current = applied(tag.id);
                      return (
                        <CommandItem
                          key={tag.id}
                          value={`${tag.name} ${tag.id}`}
                          data-checked={current ? 'true' : undefined}
                          onSelect={() => {
                            if (!current) onAttach(tag);
                            else if (current.assignmentId)
                              onRemove({ ...current, assignmentId: current.assignmentId });
                          }}
                        >
                          <TagChip name={tag.name} color={tag.color} />
                          {current ? <Check className="ml-auto size-4 text-primary" /> : null}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6"
          aria-expanded={expanded}
          aria-label={tr(expanded ? 'collapse' : 'expand')}
          onClick={() => onExpandedChange(!expanded)}
        >
          {expanded ? <ChevronUp /> : <ChevronDown />}
        </Button>
      </div>
    </div>
  );
}
