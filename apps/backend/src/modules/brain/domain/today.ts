import type { TodayConversationQueueKey } from '@agent-sales/contracts';

import { nextHcmMidnight } from './schedule.js';
import type { ConversationSignal } from './signal.js';

/** A customer waits this long without an answer before Today lists them as unanswered. */
export const UNANSWERED_AFTER_MS = 15 * 60_000;
/** A price question followed by this much silence is "asked a price, then went quiet". */
export const PRICE_SILENT_AFTER_MS = 24 * 3_600_000;

/** The conversation facts Today reads (`ConversationFacade.todayCandidates`). */
export interface TodayFacts {
  id: string;
  provider: string;
  status: 'open' | 'resolved' | 'spam';
  contactId: string | null;
  customerName: string;
  customerAvatarUrl: string | null;
  assigneeId: string | null;
  awaitingSince: string | null;
  lastInboundAt: string | null;
  followUpAt: string | null;
  followUpNote: string;
  lastHumanReplyAt: string | null;
}

/** Who looks at Today: sales and care (no `contacts.view_all`) see their own and unassigned. */
export interface TodayViewer {
  userId: string;
  viewAll: boolean;
}

/** One conversation placed in a queue. */
export interface TodayEntry {
  queue: TodayConversationQueueKey;
  facts: TodayFacts;
  signal: ConversationSignal | null;
  reason: string;
  at: Date;
}

const time = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** The end of the local (Asia/Ho_Chi_Minh) day of `now`: "due today" means before it. */
export const endOfHcmDay = (now: Date): Date => nextHcmMidnight(now);

/** The conversation is visible to the viewer (the `contacts.view_all` rule). */
export function visibleTo(f: Pick<TodayFacts, 'assigneeId'>, viewer: TodayViewer): boolean {
  return viewer.viewAll || f.assigneeId === null || f.assigneeId === viewer.userId;
}

/** Dismissed on Today and the customer has not written since. */
export function isDismissed(f: TodayFacts, s: ConversationSignal | null): boolean {
  const dismissed = s?.dismissedUntilMessageAfter?.getTime();
  if (dismissed === undefined) return false;
  const last = time(f.lastInboundAt);
  return last === null || last <= dismissed;
}

/**
 * The queue of one conversation (spec §5), or null. The first matching rule wins, in queue order:
 * - attention: the signal says complaint or needs a person, the conversation is open, and no
 *   person of the shop replied after the messages that evaluation covered;
 * - unanswered: open and waiting for 15 minutes or more (a fact, no signal needed);
 * - ready: the signal's stage is `ready`;
 * - price_silent: the stage is `price_asked` and the customer has been silent for 24 hours;
 * - follow_up: the signal's follow-up time has come, or the conversation's reminder is due today.
 */
export function classify(
  f: TodayFacts,
  s: ConversationSignal | null,
  now: Date,
): Omit<TodayEntry, 'facts' | 'signal'> | null {
  const nowMs = now.getTime();
  if (f.status === 'spam') return null;
  if (s && f.status === 'open' && (s.mood === 'complaint' || s.needsHuman)) {
    const covered = (s.evaluatedUntil ?? s.evaluatedAt)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const replied = time(f.lastHumanReplyAt);
    if (replied === null || replied <= covered) {
      return {
        queue: 'attention',
        reason: s.needsHumanReason ?? s.intent ?? '',
        at: s.evaluatedUntil ?? s.evaluatedAt ?? now,
      };
    }
  }
  const waiting = time(f.awaitingSince);
  if (f.status === 'open' && waiting !== null && waiting <= nowMs - UNANSWERED_AFTER_MS) {
    return { queue: 'unanswered', reason: s?.intent ?? '', at: new Date(waiting) };
  }
  const lastInbound = time(f.lastInboundAt);
  if (s?.stage === 'ready') {
    return {
      queue: 'ready',
      reason: s.intent ?? '',
      at: s.evaluatedUntil ?? (lastInbound !== null ? new Date(lastInbound) : now),
    };
  }
  if (s?.stage === 'price_asked' && lastInbound !== null) {
    if (lastInbound <= nowMs - PRICE_SILENT_AFTER_MS) {
      return { queue: 'price_silent', reason: s.intent ?? '', at: new Date(lastInbound) };
    }
  }
  const signalDue = s?.followUpAt && s.followUpAt.getTime() <= nowMs ? s.followUpAt : null;
  const reminder = time(f.followUpAt);
  const reminderDue =
    reminder !== null && reminder < endOfHcmDay(now).getTime() ? new Date(reminder) : null;
  if (signalDue || reminderDue) {
    const useSignal =
      signalDue !== null && (reminderDue === null || signalDue.getTime() <= reminderDue.getTime());
    return {
      queue: 'follow_up',
      reason: useSignal
        ? (s?.followUpReason ?? s?.intent ?? '')
        : f.followUpNote || s?.followUpReason || '',
      at: useSignal ? signalDue : (reminderDue ?? now),
    };
  }
  return null;
}

/** Oldest first where waiting matters, newest first where recency matters. */
const ORDER: Record<TodayConversationQueueKey, 'asc' | 'desc'> = {
  attention: 'desc',
  unanswered: 'asc',
  ready: 'desc',
  price_silent: 'asc',
  follow_up: 'asc',
};

/**
 * Places every visible, not dismissed conversation in its first matching queue, each queue
 * sorted (spec §5). `signals` maps conversation ids to their signal.
 */
export function buildQueues(
  conversations: readonly TodayFacts[],
  signals: ReadonlyMap<string, ConversationSignal>,
  viewer: TodayViewer,
  now: Date,
): Record<TodayConversationQueueKey, TodayEntry[]> {
  const out: Record<TodayConversationQueueKey, TodayEntry[]> = {
    attention: [],
    unanswered: [],
    ready: [],
    price_silent: [],
    follow_up: [],
  };
  const seen = new Set<string>();
  for (const f of conversations) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    if (!visibleTo(f, viewer)) continue;
    const s = signals.get(f.id) ?? null;
    if (isDismissed(f, s)) continue;
    const placed = classify(f, s, now);
    if (placed) out[placed.queue].push({ ...placed, facts: f, signal: s });
  }
  for (const key of Object.keys(out) as TodayConversationQueueKey[]) {
    const dir = ORDER[key] === 'asc' ? 1 : -1;
    out[key].sort(
      (a, b) => dir * (a.at.getTime() - b.at.getTime()) || a.facts.id.localeCompare(b.facts.id),
    );
  }
  return out;
}
