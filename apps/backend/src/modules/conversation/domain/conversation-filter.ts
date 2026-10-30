import type {
  ChannelProvider,
  ConversationCounts,
  ConversationListQuery,
  ConversationStatus,
  ConversationTab,
  ConversationView,
} from '@agent-sales/contracts';
import { ConversationError } from './conversation.errors.js';

/**
 * Filter the store applies. The SQL adapter and the in-memory test adapter both implement
 * these semantics; `matchesFilter` is the reference the integration test compares against.
 */
export interface ConversationFilter {
  tab: ConversationTab;
  /** A member id, or `none` for unassigned. */
  assignee?: string | undefined;
  channelId?: string | undefined;
  contactId?: string | undefined;
  hasPhone?: boolean | undefined;
  waiting?: 'any' | 'longest' | 'readNotReplied' | undefined;
  status?: ConversationStatus | undefined;
  starred?: boolean | undefined;
  /** `true`: a follow-up reminder is set; `false`: none is. */
  followUp?: boolean | undefined;
  mode?: 'human' | 'bot' | undefined;
  provider?: ChannelProvider | undefined;
  /** The bot answering now; `none`: conversations without one. */
  botId?: string | undefined;
  /** Last activity at or after this ISO instant. */
  updatedFrom?: string | undefined;
  /** Last activity strictly before this ISO instant. */
  updatedTo?: string | undefined;
  q?: string | undefined;
  sort: 'recent' | 'waitingLongest';
  /** Only these conversations (tag filters); `undefined` means no restriction. */
  idsIn?: readonly string[] | undefined;
  /** Never these conversations (tag filters). */
  idsNotIn?: readonly string[] | undefined;
  limit: number;
}

/** The store filter for a request; `assignee=me` is the viewer. Tag conditions are added by the caller. */
export function toListFilter(q: ConversationListQuery, viewerId?: string): ConversationFilter {
  if (q.assignee === 'me' && !viewerId)
    throw new ConversationError('VALIDATION_FAILED', 'assignee=me needs a signed-in user');
  return {
    tab: q.tab ?? 'all',
    assignee: q.assignee === 'me' ? viewerId : q.assignee,
    channelId: q.channelId,
    contactId: q.contactId,
    hasPhone: q.hasPhone,
    waiting: q.waiting,
    status: q.status,
    starred: q.starred,
    followUp: q.followUp,
    mode: q.mode,
    provider: q.provider,
    botId: q.botId,
    updatedFrom: q.updatedFrom,
    updatedTo: q.updatedTo,
    q: q.q,
    sort: q.sort ?? 'recent',
    limit: q.limit,
  };
}

export interface ConversationPage {
  data: ConversationView[];
  counts: ConversationCounts;
}

/** Every condition except the tab, so the counts stay comparable across tabs. */
export function matchesFilter(c: ConversationView, f: ConversationFilter): boolean {
  if (f.provider && c.provider !== f.provider) return false;
  if (f.status && c.status !== f.status) return false;
  if (f.starred !== undefined && c.starred !== f.starred) return false;
  if (f.followUp !== undefined && Boolean(c.followUpAt) !== f.followUp) return false;
  if (f.mode && c.mode !== f.mode) return false;
  if (f.channelId && c.channelId !== f.channelId) return false;
  if (f.contactId && c.contactId !== f.contactId) return false;
  if (f.botId && c.botId !== (f.botId === 'none' ? null : f.botId)) return false;
  if (f.updatedFrom && Date.parse(c.updatedAt) < Date.parse(f.updatedFrom)) return false;
  if (f.updatedTo && Date.parse(c.updatedAt) >= Date.parse(f.updatedTo)) return false;
  if (f.assignee === 'none' ? c.assigneeId !== null : f.assignee && c.assigneeId !== f.assignee)
    return false;
  if (f.hasPhone !== undefined && (c.customerPhone !== null) !== f.hasPhone) return false;
  if (f.waiting) {
    if (!isWaiting(c)) return false;
    if (f.waiting === 'readNotReplied' && c.unreadCount > 0) return false;
  }
  if (f.idsIn && !f.idsIn.includes(c.id)) return false;
  if (f.idsNotIn?.includes(c.id)) return false;
  if (f.q) {
    const haystack = `${c.customerName} ${c.customerId} ${c.customerPhone ?? ''} ${c.lastMessage}`;
    if (!haystack.toLowerCase().includes(f.q.toLowerCase())) return false;
  }
  return true;
}

/** Someone is waiting for a reply. `awaitingSince` survives "resolved", so reopening restores it. */
export function isWaiting(c: Pick<ConversationView, 'awaitingSince' | 'status'>): boolean {
  return c.awaitingSince !== null && c.status === 'open';
}

export function matchesTab(c: ConversationView, tab: ConversationTab): boolean {
  return tab === 'unread' ? c.unreadCount > 0 : tab === 'waiting' ? isWaiting(c) : true;
}

/** `waiting: longest` implies the longest-wait ordering. */
export function effectiveSort(f: Pick<ConversationFilter, 'sort' | 'waiting'>) {
  return f.waiting === 'longest' ? 'waitingLongest' : f.sort;
}

export function compareConversations(
  sort: 'recent' | 'waitingLongest',
): (a: ConversationView, b: ConversationView) => number {
  const recent = (a: ConversationView, b: ConversationView) =>
    b.updatedAt.localeCompare(a.updatedAt) || (a.id < b.id ? 1 : -1);
  if (sort === 'recent') return recent;
  return (a, b) => {
    const [wa, wb] = [isWaiting(a) ? a.awaitingSince : null, isWaiting(b) ? b.awaitingSince : null];
    if (wa !== wb) {
      if (wa === null) return 1;
      if (wb === null) return -1;
      return wa.localeCompare(wb);
    }
    return recent(a, b);
  };
}

/** Reference implementation over a full list (in-memory adapter and tests). */
export function filterConversations(
  all: readonly ConversationView[],
  f: ConversationFilter,
): ConversationPage {
  const base = all.filter((c) => matchesFilter(c, f));
  return {
    counts: {
      all: base.length,
      unread: base.filter((c) => matchesTab(c, 'unread')).length,
      waiting: base.filter((c) => matchesTab(c, 'waiting')).length,
    },
    data: base
      .filter((c) => matchesTab(c, f.tab))
      .sort(compareConversations(effectiveSort(f)))
      .slice(0, f.limit),
  };
}
