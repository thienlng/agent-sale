import { normalizeBookingTag, normalizeBookingTags } from '@agent-sales/contracts';
import { Tag, X } from 'lucide-react';
import { type KeyboardEvent, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';

/** Contract limits (`BookingTags`): at most 8 tags of at most 30 characters. */
export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 30;
const SUGGESTED = ['deposit', 'regular', 'pickup', 'kids', 'company'] as const;

/** The suggested tags in the UI language (labels only; stored as typed). */
export function useSuggestedTags(): string[] {
  const { t } = useTranslation();
  return useMemo(
    () => SUGGESTED.map((k) => normalizeBookingTag(t(`lodging.tags.suggested.${k}`))),
    [t],
  );
}

/** NFC, trimmed, without empties or duplicates, first occurrence first (as the server stores them). */
export const cleanTags: (tags: readonly string[]) => string[] = normalizeBookingTags;

/** Read-only tag chips; `onSelect` turns each chip into a button (e.g. a list filter). */
export function TagChips({
  tags,
  className,
  onSelect,
}: {
  tags: readonly string[];
  className?: string;
  onSelect?: (tag: string) => void;
}) {
  if (tags.length === 0) return null;
  const chip =
    'inline-flex max-w-full items-center gap-1 truncate rounded-full border border-border bg-muted px-2 py-px text-[11px] leading-4 text-foreground';
  return (
    <ul className={cn('flex flex-wrap gap-1', className)}>
      {tags.map((tag) => (
        <li key={tag} className="min-w-0">
          {onSelect ? (
            <button
              type="button"
              className={cn(
                chip,
                'hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              )}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(tag);
              }}
            >
              {tag}
            </button>
          ) : (
            <span className={chip}>{tag}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Tag editor: suggested tags as toggles, free tags as removable chips, and a free-entry field. */
export function TagInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const suggested = useSuggestedTags();
  const [text, setText] = useState('');
  const full = value.length >= MAX_TAGS;
  // Compared NFC-normalised: an NFD "Đã cọc" is the same tag as the suggestion.
  const has = (tag: string) => value.some((x) => normalizeBookingTag(x) === tag);
  const toggle = (tag: string) =>
    onChange(
      has(tag) ? value.filter((x) => normalizeBookingTag(x) !== tag) : cleanTags([...value, tag]),
    );
  const add = () => {
    const tag = text.trim();
    if (!tag || full) return;
    onChange(cleanTags([...value, tag]));
    setText('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter (or a comma) adds the tag; it must never submit the booking form.
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !text && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };
  const free = value.filter((tag) => !suggested.includes(normalizeBookingTag(tag)));
  const chip =
    'h-7 rounded-full border border-border px-3 text-xs data-[state=on]:border-primary data-[state=on]:bg-primary-soft data-[state=on]:text-primary-strong';
  return (
    <div role="group" aria-labelledby={`${id}-label`} className="grid gap-1.5">
      <span id={`${id}-label`} className="flex items-center gap-1 text-xs font-medium">
        <Tag aria-hidden className="size-3.5" />
        {t('lodging.tags.label')}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {suggested.map((tag) => {
          const on = has(tag);
          return (
            <Toggle
              key={tag}
              size="sm"
              className={chip}
              pressed={on}
              disabled={!on && full}
              onPressedChange={() => toggle(tag)}
            >
              {tag}
            </Toggle>
          );
        })}
        {free.map((tag) => (
          <span
            key={tag}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-primary bg-primary-soft pr-1 pl-3 text-xs text-primary-strong"
          >
            {tag}
            <button
              type="button"
              aria-label={t('lodging.tags.remove', { tag })}
              className="rounded-full p-0.5 hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => onChange(value.filter((x) => x !== tag))}
            >
              <X aria-hidden className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <Input
        aria-label={t('lodging.tags.add')}
        placeholder={t('lodging.tags.addPlaceholder')}
        className="h-8 w-60"
        maxLength={MAX_TAG_LENGTH}
        disabled={full}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
      />
      {full && <p className="text-xs text-muted-foreground">{t('lodging.tags.limit')}</p>}
    </div>
  );
}
