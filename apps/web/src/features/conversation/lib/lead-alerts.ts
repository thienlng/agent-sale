import type { InboxConversation } from './inbox-v2-types';

/** A lead staff have not opened yet: the "Số mới" badge. */
export function hasNewLead(c: Pick<InboxConversation, 'lead'>): boolean {
  return Boolean(c.lead && !c.lead.seenAt);
}

/** One key per captured number, so a replaced number alerts again but a refetch does not. */
export function leadKey(c: Pick<InboxConversation, 'id' | 'lead'>): string | null {
  return c.lead && !c.lead.seenAt ? `${c.id}:${c.lead.capturedAt}` : null;
}

/**
 * Splits the current unseen leads into the ones this tab has not announced yet. The first list a tab
 * loads only primes `known` (opening the inbox must not replay every old lead).
 */
export function freshLeads<T extends Pick<InboxConversation, 'id' | 'lead'>>(
  items: readonly T[],
  known: Set<string>,
  primed: boolean,
): T[] {
  const fresh: T[] = [];
  for (const c of items) {
    const key = leadKey(c);
    if (!key || known.has(key)) continue;
    known.add(key);
    if (primed) fresh.push(c);
  }
  return fresh;
}
