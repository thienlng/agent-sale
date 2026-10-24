import type { TrainingItemDto } from '@agent-sales/contracts';

import { matchesText } from './table-data';

export type ImageFilter = 'all' | 'with' | 'without';

/** Quick replies matching the search text (shortcut or content) and the image filter. */
export function filterQuickReplies(
  items: readonly TrainingItemDto[],
  query: string,
  image: ImageFilter,
): TrainingItemDto[] {
  return items.filter(
    (item) =>
      item.kind === 'quick_reply' &&
      (image === 'all' || (image === 'with') === Boolean(item.mediaUrl)) &&
      matchesText(`${item.trigger} ${item.title} ${item.content}`, query),
  );
}

export const MAX_SHORTCUT_LENGTH = 100;

/** "/abc " → "abc": the stored trigger never carries the leading slash. */
export function normalizeShortcut(input: string): string {
  return input.trim().replace(/^\/+/, '');
}

export function isValidShortcut(shortcut: string): boolean {
  return shortcut.length > 0 && shortcut.length <= MAX_SHORTCUT_LENGTH && !/\s/.test(shortcut);
}

/** How a shortcut is shown to agents: "/abc". Falls back to the title for older items. */
export function displayShortcut(item: Pick<TrainingItemDto, 'trigger' | 'title'>): string {
  return `/${normalizeShortcut(item.trigger || item.title)}`;
}
