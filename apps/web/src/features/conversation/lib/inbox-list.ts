import type { ConversationDto, MetaProvider } from '@agent-sales/contracts';

export type SortOrder = 'newest' | 'oldest';

export interface ListState {
  q: string;
  provider: MetaProvider | 'all';
  status: 'open' | 'resolved' | 'all';
  mode: 'bot' | 'human' | 'all';
  order: SortOrder;
  queue: SalesQueue;
  channelId: string;
}

/** Channel filter entries; the ones without a provider are listed as coming soon. */
export type ChannelFilterKey = MetaProvider | 'zalo' | 'website' | 'lazada' | 'tiktok';
export const CHANNEL_FILTERS: readonly { key: ChannelFilterKey; available: boolean }[] = [
  { key: 'facebook', available: true },
  { key: 'zalo', available: false },
  { key: 'website', available: false },
  { key: 'instagram', available: true },
  { key: 'lazada', available: false },
  { key: 'tiktok', available: false },
];

/** Orders by last activity; ties keep a stable order by id. */
export function sortConversations(
  items: readonly ConversationDto[],
  order: SortOrder,
): ConversationDto[] {
  const sign = order === 'newest' ? -1 : 1;
  return [...items].sort((a, b) => {
    const diff = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
    return diff ? sign * diff : a.id.localeCompare(b.id);
  });
}

/** Keeps only the selected provider (the API filters too; this guards stale cached pages). */
export function filterByProvider(
  items: readonly ConversationDto[],
  provider: MetaProvider | 'all',
): ConversationDto[] {
  return provider === 'all' ? [...items] : items.filter((c) => c.provider === provider);
}

/** dd/MM/yyyy in local time. */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** The API stores "[image]"-style markers for media-only messages; show them localized. */
export function previewText(text: string, tr: (key: string) => string): string {
  if (!text) return tr('noMessage');
  const media = /^\[(image|video|audio|file|sticker)\]$/.exec(text)?.[1];
  return media
    ? tr(media === 'image' || media === 'sticker' ? 'attachment.image' : 'attachment.file')
    : text;
}

export type SalesQueue = 'all' | 'human' | 'mine' | 'unassigned' | 'bot' | 'due';
export const SALES_QUEUES: readonly SalesQueue[] = [
  'all',
  'human',
  'mine',
  'unassigned',
  'bot',
  'due',
];

/** Queue membership uses persisted state, never guesses whether the last message was answered. */
export function filterSalesQueue(
  items: readonly ConversationDto[],
  queue: SalesQueue,
  userId: string | undefined,
  now = Date.now(),
): ConversationDto[] {
  return items.filter((item) => {
    if (queue === 'due')
      return (
        item.status === 'open' &&
        Boolean(item.followUpAt) &&
        Date.parse(item.followUpAt ?? '') <= now
      );
    if (queue === 'human') return item.mode === 'human';
    if (queue === 'bot') return item.mode === 'bot';
    if (queue === 'unassigned') return item.assigneeId === null;
    if (queue === 'mine') return Boolean(userId) && item.assigneeId === userId;
    return true;
  });
}

export function filterInbox(
  items: readonly ConversationDto[],
  filters: {
    provider: MetaProvider | 'all';
    channelId: string;
    status: 'all' | 'open' | 'resolved';
    mode: 'all' | 'bot' | 'human';
  },
): ConversationDto[] {
  return filterByProvider(items, filters.provider).filter(
    (item) =>
      (filters.channelId === 'all' || item.channelId === filters.channelId) &&
      (filters.status === 'all' || item.status === filters.status) &&
      (filters.mode === 'all' || item.mode === filters.mode),
  );
}
