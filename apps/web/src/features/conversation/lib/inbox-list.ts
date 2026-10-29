import type { ChannelProvider } from '@agent-sales/contracts';
import type {
  InboxConversation,
  InboxCounts,
  InboxListQuery,
  InboxTab,
  WaitingFilter,
} from './inbox-v2-types';

/** Work folder: the queue (`open`), Done (`resolved`), Spam, or every folder. */
export type StatusFilter = 'open' | 'resolved' | 'spam' | 'all';
export type ModeFilter = 'bot' | 'human' | 'all';
export type PhoneFilter = 'all' | 'yes' | 'no';
/** Last-activity window: presets end now; `custom` uses `timeFrom`/`timeTo` (local dates). */
export type TimeFilter = 'any' | 'today' | 'yesterday' | 'last7' | 'last30' | 'custom';

/** Everything the list can be narrowed by. */
export interface ListState {
  q: string;
  tab: InboxTab;
  tagsAny: string[];
  tagsAll: string[];
  tagsExclude: string[];
  untagged: boolean;
  waiting: WaitingFilter | 'off';
  mode: ModeFilter;
  /** `all`, `me`, `none` or a member id. */
  assignee: string;
  provider: ChannelProvider | 'all';
  /** `all` or a connected page / account id. */
  channelId: string;
  /** `all`, `none` (no bot answers) or the id of the bot answering now. */
  botId: string;
  time: TimeFilter;
  /** `YYYY-MM-DD`, inclusive; empty for an open start. Only used by `time: 'custom'`. */
  timeFrom: string;
  /** `YYYY-MM-DD`, inclusive; empty for an open end. Only used by `time: 'custom'`. */
  timeTo: string;
  hasPhone: PhoneFilter;
  status: StatusFilter;
  /** Quick filter "Ưu tiên": starred conversations only. */
  starred: boolean;
  /** Quick filter "Trao đổi thêm": a follow-up reminder is set. */
  followUp: boolean;
}

export const DEFAULT_LIST_STATE: ListState = {
  q: '',
  tab: 'all',
  tagsAny: [],
  tagsAll: [],
  tagsExclude: [],
  untagged: false,
  waiting: 'off',
  mode: 'all',
  assignee: 'all',
  provider: 'all',
  channelId: 'all',
  botId: 'all',
  time: 'any',
  timeFrom: '',
  timeTo: '',
  hasPhone: 'all',
  status: 'open',
  starred: false,
  followUp: false,
};

/** The advanced-filter fields (everything except search, queue tab, channel tab and quick filters). */
export function advancedPart(state: ListState): Partial<ListState> {
  const {
    q: _q,
    tab: _tab,
    provider: _provider,
    starred: _starred,
    followUp: _followUp,
    ...rest
  } = state;
  return rest;
}

/** Number of filter groups that differ from the default (the search box and tabs do not count). */
export function activeFilterCount(state: ListState): number {
  return [
    state.tagsAny.length > 0 || state.tagsAll.length > 0 || state.tagsExclude.length > 0,
    state.untagged,
    state.waiting !== 'off',
    state.mode !== 'all',
    state.assignee !== 'all',
    // The provider is the channel tab, not an advanced filter.
    state.channelId !== 'all',
    state.botId !== 'all',
    state.time !== 'any',
    state.hasPhone !== 'all',
    state.status !== DEFAULT_LIST_STATE.status,
  ].filter(Boolean).length;
}

/** True when anything, including search text, tab and quick filters, differs from the default. */
export function isFiltered(state: ListState): boolean {
  return (
    activeFilterCount(state) > 0 ||
    state.q !== '' ||
    state.tab !== 'all' ||
    state.starred ||
    state.followUp
  );
}

export type FilterChip =
  | { id: string; kind: 'tagsAny' | 'tagsAll' | 'tagsExclude'; tagId: string }
  | { id: string; kind: 'untagged' | 'waiting' | 'mode' | 'hasPhone' | 'status' }
  | { id: string; kind: 'assignee'; value: string }
  | { id: string; kind: 'provider' | 'channelId' | 'botId'; value: string }
  | { id: string; kind: 'time' };

/** One removable chip per active value. */
export function filterChips(state: ListState): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const kind of ['tagsAny', 'tagsAll', 'tagsExclude'] as const)
    for (const tagId of state[kind]) chips.push({ id: `${kind}:${tagId}`, kind, tagId });
  if (state.untagged) chips.push({ id: 'untagged', kind: 'untagged' });
  if (state.waiting !== 'off') chips.push({ id: 'waiting', kind: 'waiting' });
  if (state.mode !== 'all') chips.push({ id: 'mode', kind: 'mode' });
  if (state.assignee !== 'all')
    chips.push({ id: 'assignee', kind: 'assignee', value: state.assignee });
  if (state.channelId !== 'all')
    chips.push({ id: 'channelId', kind: 'channelId', value: state.channelId });
  if (state.botId !== 'all') chips.push({ id: 'botId', kind: 'botId', value: state.botId });
  if (state.time !== 'any') chips.push({ id: 'time', kind: 'time' });
  if (state.hasPhone !== 'all') chips.push({ id: 'hasPhone', kind: 'hasPhone' });
  // The folder has its own "Đang xem: …" line, so it gets no chip.
  return chips;
}

/** The state without the value a chip stands for. */
export function removeChip(state: ListState, chip: FilterChip): Partial<ListState> {
  switch (chip.kind) {
    case 'tagsAny':
    case 'tagsAll':
    case 'tagsExclude':
      return { [chip.kind]: state[chip.kind].filter((id) => id !== chip.tagId) };
    case 'untagged':
      return { untagged: false };
    case 'waiting':
      return { waiting: 'off' };
    case 'mode':
      return { mode: 'all' };
    case 'assignee':
      return { assignee: 'all' };
    case 'provider':
      return { provider: 'all' };
    case 'channelId':
      return { channelId: 'all' };
    case 'botId':
      return { botId: 'all' };
    case 'time':
      return { time: 'any', timeFrom: '', timeTo: '' };
    case 'hasPhone':
      return { hasPhone: 'all' };
    case 'status':
      return { status: DEFAULT_LIST_STATE.status };
  }
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Local midnight of a `YYYY-MM-DD` date, `days` later; null for anything else. */
function localDay(date: string, days = 0): Date | null {
  const m = DATE.exec(date);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A custom range needs at least one end, and the start may not be after the end. */
export function customRangeValid(from: string, to: string): boolean {
  const [start, end] = [localDay(from), localDay(to)];
  if ((from && !start) || (to && !end) || (!start && !end)) return false;
  return !start || !end || start <= end;
}

/**
 * The last-activity window as instants: `from` inclusive, `to` exclusive. Boundaries are local
 * midnights, so the query stays the same all day. `null` for an unusable custom range.
 */
export function activityWindow(
  state: Pick<ListState, 'time' | 'timeFrom' | 'timeTo'>,
  now = new Date(),
): { from?: string; to?: string } | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo = (n: number) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - n).toISOString();
  switch (state.time) {
    case 'any':
      return {};
    case 'today':
      return { from: today.toISOString() };
    case 'yesterday':
      return { from: daysAgo(1), to: today.toISOString() };
    case 'last7':
      return { from: daysAgo(6) };
    case 'last30':
      return { from: daysAgo(29) };
    case 'custom': {
      if (!customRangeValid(state.timeFrom, state.timeTo)) return null;
      const from = localDay(state.timeFrom);
      const to = localDay(state.timeTo, 1);
      return {
        ...(from ? { from: from.toISOString() } : {}),
        ...(to ? { to: to.toISOString() } : {}),
      };
    }
  }
}

/** Maps the UI state to GET /conversations. */
export function toListQuery(state: ListState, limit = 100, now = new Date()): InboxListQuery {
  const query: InboxListQuery = { tab: state.tab, limit };
  if (state.q.trim()) query.q = state.q.trim();
  if (state.assignee !== 'all') query.assignee = state.assignee;
  if (state.channelId !== 'all') query.channelId = state.channelId;
  if (state.botId !== 'all') query.botId = state.botId;
  const window = activityWindow(state, now);
  if (window?.from) query.updatedFrom = window.from;
  if (window?.to) query.updatedTo = window.to;
  if (state.provider !== 'all') query.provider = state.provider;
  if (state.hasPhone !== 'all') query.hasPhone = state.hasPhone === 'yes';
  if (state.waiting !== 'off') query.waiting = state.waiting;
  if (state.status !== 'all') query.status = state.status;
  if (state.mode !== 'all') query.mode = state.mode;
  if (state.waiting === 'longest') query.sort = 'waitingLongest';
  if (state.tagsAny.length) query.tagsAny = state.tagsAny.join(',');
  if (state.tagsAll.length) query.tagsAll = state.tagsAll.join(',');
  if (state.tagsExclude.length) query.tagsExclude = state.tagsExclude.join(',');
  if (state.untagged) query.untagged = true;
  if (state.starred) query.starred = true;
  if (state.followUp) query.followUp = true;
  return query;
}

/**
 * Re-applies the simple filters the previous API did not know about, so a stale cache or an
 * older server never shows rows the user filtered out. The new API already filters these.
 */
export function guardList(
  items: readonly InboxConversation[],
  state: ListState,
  userId: string | undefined,
  now = new Date(),
): InboxConversation[] {
  const window = activityWindow(state, now);
  return items.filter(
    (item) =>
      (state.status === 'all' || item.status === state.status) &&
      (!state.starred || item.starred) &&
      (!state.followUp || Boolean(item.followUpAt)) &&
      (state.mode === 'all' || item.mode === state.mode) &&
      (state.provider === 'all' || item.provider === state.provider) &&
      (state.channelId === 'all' || item.channelId === state.channelId) &&
      (state.botId === 'all' || item.botId === (state.botId === 'none' ? null : state.botId)) &&
      (!window?.from || Date.parse(item.updatedAt) >= Date.parse(window.from)) &&
      (!window?.to || Date.parse(item.updatedAt) < Date.parse(window.to)) &&
      (state.assignee === 'all' ||
        (state.assignee === 'none'
          ? item.assigneeId === null
          : item.assigneeId === (state.assignee === 'me' ? userId : state.assignee))),
  );
}

/** Server counts, or counts derived from the loaded page when the API has none. */
export function tabCounts(
  items: readonly InboxConversation[],
  counts: InboxCounts | undefined,
): InboxCounts {
  return (
    counts ?? {
      all: items.length,
      unread: items.filter((c) => c.unreadCount > 0).length,
      waiting: items.filter((c) => c.awaitingSince !== null).length,
    }
  );
}

const PROVIDER_LABEL: Record<ChannelProvider, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  website: 'Website',
};

/** The raw channel id is not a name: show "Khách Facebook ·1234" until Meta tells us the name. */
export function customerDisplayName(
  c: Pick<InboxConversation, 'customerName' | 'customerId' | 'provider'>,
  guest: (provider: string, last4: string) => string,
): string {
  const name = c.customerName.trim();
  if (name && name !== c.customerId) return name;
  return guest(PROVIDER_LABEL[c.provider], c.customerId.slice(-4));
}

export function customerInitial(name: string): string {
  return (Array.from(name.trim())[0] ?? '?').toUpperCase();
}

export const URGENT_WAIT_MINUTES = 15;

export function waitMinutes(awaitingSince: string | null, now: number): number | null {
  if (!awaitingSince) return null;
  const since = Date.parse(awaitingSince);
  return Number.isNaN(since) ? null : Math.max(0, Math.floor((now - since) / 60000));
}

/** Compact wait: minutes under an hour, then hours, then days. */
export function compactWait(minutes: number): { n: number; unit: 'm' | 'h' | 'd' } {
  if (minutes < 60) return { n: minutes, unit: 'm' };
  if (minutes < 1440) return { n: Math.floor(minutes / 60), unit: 'h' };
  return { n: Math.floor(minutes / 1440), unit: 'd' };
}

/** dd/MM/yyyy in local time. */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** HH:mm today, dd/MM otherwise: the row stays narrow. */
export function formatRowTime(iso: string, now: number): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = new Date(now);
  return d.toDateString() === today.toDateString()
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

/** The API stores "[image]"-style markers for media-only messages; show them localized. */
export function previewText(text: string, tr: (key: string) => string): string {
  if (!text) return tr('noMessage');
  const media = /^\[(image|video|audio|file|sticker)\]$/.exec(text)?.[1];
  return media
    ? tr(media === 'image' || media === 'sticker' ? 'attachment.image' : 'attachment.file')
    : text;
}

/** m:ss until the bot resumes, or null when there is no (future) resume time. */
export function resumeCountdown(autoResumeAt: string | null, now: number): string | null {
  if (!autoResumeAt) return null;
  const seconds = Math.ceil((Date.parse(autoResumeAt) - now) / 1000);
  if (Number.isNaN(seconds) || seconds <= 0) return null;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
